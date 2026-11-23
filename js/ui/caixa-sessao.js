// caixa-sessao.js — tela de abertura e fechamento de caixa (dentro da aba Caixa).
// Não acessa o Firestore: as gravações e leituras chegam por parâmetro, como nas telas de Entradas e Saídas.
import { $, money, roundMoney, formatDate, escapeHtml, cleanOption, dateToday, dateTimeFor, fieldValue, onEvent, parseDecimal } from "../utils.js?v=20261104-1";
import { sales, saleReturns, saleCart, caixas, estadoUi, storeSettings } from "../estado.js?v=20261108-1";

let summarize = null;

const shortName = (email) => String(email || "").split("@")[0] || "usuário não identificado";

// A venda só exige caixa aberto quando o módulo Caixa está ativo e o banco já liberou a coleção "caixas".
export const caixaObrigatorio = () => Boolean(storeSettings.caixaAtivo) && estadoUi.caixasAvailable;

// Devoluções da memória com a forma de pagamento da venda original (a venda pode estar fora da janela:
// nesse caso o carregamento de dados já guardou a forma em formaPagamentoVenda).
function returnsWithPayment() {
  return saleReturns.map((item) => {
    const sale = sales.find((entry) => entry.id === item.vendaId);
    return { ...item, formaPagamentoVenda: sale?.formaPagamento ?? item.formaPagamentoVenda };
  });
}

function diffBadge(difference) {
  if (!difference) return '<span class="stock-badge">Confere</span>';
  return difference < 0
    ? `<span class="stock-badge low">Faltou ${money(-difference)}</span>`
    : `<span class="low-badge">Sobrou ${money(difference)}</span>`;
}

function renderHistory() {
  const list = $("#caixa-history-list");
  const closed = caixas.filter((item) => item.status === "fechado")
    .sort((a, b) => String(b.dataHoraFechamento || "").localeCompare(String(a.dataHoraFechamento || "")))
    .slice(0, 15);
  if (!closed.length) {
    list.innerHTML = '<div class="empty-state">Nenhum fechamento registrado ainda.</div>';
    return;
  }
  list.innerHTML = closed.map((caixa) => {
    const forms = (Array.isArray(caixa.formas) ? caixa.formas : [])
      .map((item) => `${escapeHtml(item.forma)}: ${money(item.liquido)}`).join(" · ");
    return `<article class="entry-card">
      <div class="item-title-row"><div class="item-title">Caixa de ${escapeHtml(formatDate(caixa.data))}</div>${diffBadge(Number(caixa.diferenca) || 0)}</div>
      <p>Aberto em ${escapeHtml(formatDate(caixa.dataHora))} por ${escapeHtml(shortName(caixa.abertoPor))} · Fechado em ${escapeHtml(formatDate(caixa.dataHoraFechamento))} por ${escapeHtml(shortName(caixa.fechadoPor))}</p>
      <p>Vendas líquidas: <strong>${money(caixa.totalLiquido)}</strong> (${Number(caixa.numeroVendas) || 0} venda(s)${Number(caixa.totalDevolucoes) ? `, ${money(caixa.totalDevolucoes)} devolvido` : ""})</p>
      ${forms ? `<p>${forms}</p>` : ""}
      <p>Dinheiro: abertura ${money(caixa.valorAbertura)} · esperado ${money(caixa.esperadoDinheiro)} · contado ${money(caixa.valorContado)}</p>
      ${caixa.observacaoAbertura ? `<p>Abertura: ${escapeHtml(caixa.observacaoAbertura)}</p>` : ""}
      ${caixa.observacaoFechamento ? `<p>Fechamento: ${escapeHtml(caixa.observacaoFechamento)}</p>` : ""}
      <p class="caixa-print-row">
        <button class="button quiet" type="button" data-caixa-print-open="${escapeHtml(caixa.id)}">Reimprimir abertura</button>
        <button class="button quiet" type="button" data-caixa-print-close="${escapeHtml(caixa.id)}">Reimprimir fechamento</button>
      </p>
    </article>`;
  }).join("");
}

export function renderCaixaSessao() {
  const required = Boolean(storeSettings.caixaAtivo);
  const available = estadoUi.caixasAvailable;
  const open = estadoUi.caixaAberto;
  $("#caixa-unavailable").hidden = !required || available;
  $("#caixa-closed-box").hidden = !(required && available && !open);
  $("#caixa-open-box").hidden = !(required && available && open);
  // Com o caixa fechado não há venda: o formulário de venda some até a abertura.
  $("#sale-form").hidden = required && available && !open;

  if (required && available && open && summarize) {
    const resumo = summarize({ caixa: open, vendas: sales, devolucoes: returnsWithPayment() });
    $("#caixa-open-title").textContent = `Aberto em ${formatDate(open.dataHora)} por ${shortName(open.abertoPor)}`;
    $("#caixa-stat-open").textContent = money(resumo.valorAbertura);
    $("#caixa-stat-sales").textContent = String(resumo.numeroVendas);
    $("#caixa-stat-total").textContent = money(resumo.totalLiquido);
    $("#caixa-stat-cash").textContent = money(resumo.esperadoDinheiro);
    const stale = $("#caixa-stale");
    const old = open.data && open.data !== dateToday();
    stale.hidden = !old;
    if (old) stale.textContent = `Este caixa foi aberto em ${formatDate(open.data)} e continua aberto. Feche-o e abra um novo caixa para o dia de hoje.`;
  }
  renderHistory();
}

export function initCaixaSessaoUI(dependencies) {
  const {
    summarizeCaixa, newCaixaId, openCaixa, closeCaixa, loadMovimentosCaixa,
    diaAnteriorComVendas, buildComparativo, variacaoPercentual,
    printAbertura, printFechamento, autoPrint,
    currentEmail, loadData, setFeedback, showToast, explainError
  } = dependencies;
  summarize = summarizeCaixa;

  let opening = false;
  let closing = false;
  let openAttempt = null; // { id, fingerprint }
  let closeAttempt = null; // { id, caixaId, resumo }

  // Último caixa fechado antes deste (para a nota de abertura comparar). Usa o que já está na memória da tela.
  function ultimoFechado(caixa) {
    const anterior = caixas
      .filter((item) => item.status === "fechado" && item.id !== caixa.id && String(item.dataHora || "") < String(caixa.dataHora || ""))
      .sort((a, b) => String(b.dataHoraFechamento || "").localeCompare(String(a.dataHoraFechamento || "")))[0];
    if (!anterior) return null;
    return {
      data: anterior.data,
      valorAbertura: anterior.valorAbertura,
      valorContado: anterior.valorContado,
      diferenca: anterior.diferenca,
      totalLiquido: anterior.totalLiquido,
      variacaoAbertura: variacaoPercentual(caixa.valorAbertura, anterior.valorAbertura)
    };
  }

  // A impressão nunca pode parecer falha de gravação: o caixa já foi salvo.
  function imprimir(funcao) {
    try { funcao(); } catch (error) { console.error("Falha ao imprimir a nota do caixa:", error); showToast("Caixa salvo, mas a nota não pôde ser impressa. Use Reimprimir."); }
  }

  async function refreshAfter(message) {
    try {
      await loadData();
    } catch (error) {
      console.error("Operação de caixa salva, mas falhou a atualização da tela:", error);
      showToast(message);
    }
  }

  // ----- Abertura -----
  onEvent("#caixa-open-form", "submit", async (event) => {
    event.preventDefault();
    if (opening) return;
    if (estadoUi.caixaAberto) return setFeedback("#caixa-open-feedback", "Já existe um caixa aberto. Atualize a tela.", true);
    const raw = parseDecimal(fieldValue("#caixa-open-value"));
    if (!Number.isFinite(raw) || raw < 0) {
      return setFeedback("#caixa-open-feedback", "Informe o dinheiro da gaveta (use 0 se estiver vazia).", true);
    }
    const valorAbertura = roundMoney(raw);
    const observacao = cleanOption(fieldValue("#caixa-open-note"));
    const date = dateToday();
    // O ID só muda quando o conteúdo muda: reenviar a mesma abertura não cria dois caixas.
    const fingerprint = JSON.stringify([valorAbertura, observacao, date]);
    if (!openAttempt || openAttempt.fingerprint !== fingerprint) openAttempt = { id: newCaixaId(), fingerprint };

    const button = $("#caixa-open-button");
    opening = true;
    button.disabled = true;
    setFeedback("#caixa-open-feedback", "Abrindo o caixa…");
    try {
      const result = await openCaixa({
        caixaId: openAttempt.id, valorAbertura, observacao, date, dateTime: dateTimeFor(date), userEmail: currentEmail()
      });
      const aberto = {
        id: openAttempt.id, valorAbertura, observacaoAbertura: observacao,
        data: date, dataHora: dateTimeFor(date), abertoPor: currentEmail()
      };
      openAttempt = null;
      $("#caixa-open-form").reset();
      if (!result?.alreadySaved && autoPrint()) imprimir(() => printAbertura(aberto, ultimoFechado(aberto)));
      setFeedback("#caixa-open-feedback", "");
      showToast(result?.alreadySaved ? "Este caixa já estava aberto." : "Caixa aberto.");
      await refreshAfter("Caixa aberto. Atualize a página para continuar.");
    } catch (error) {
      console.error("Falha ao abrir o caixa:", error);
      setFeedback("#caixa-open-feedback", explainError(error), true);
      if (error?.code === "caixa-ja-aberto") await refreshAfter("Atualize a página para ver o caixa aberto.");
    } finally {
      opening = false;
      button.disabled = false;
    }
  });

  // ----- Fechamento: primeiro mostra o resumo, depois confirma -----
  function comparativoHtml(comparativo) {
    if (!comparativo) return '<p class="caixa-sub">Sem dia anterior com vendas para comparar.</p>';
    const linhaCmp = (rotulo, item, formatar) => {
      const variacao = item.variacao;
      const texto = variacao === null ? "sem base" : `${variacao > 0 ? "+" : ""}${variacao.toFixed(1).replace(".", ",")}%`;
      const classe = variacao === null || variacao === 0 ? "" : (variacao > 0 ? "up" : "down");
      return `<div class="caixa-line"><span>${rotulo}</span><strong class="${classe}">${texto}</strong></div>
        <p class="caixa-sub">${formatar(item.atual)} hoje x ${formatar(item.anterior)}</p>`;
    };
    return `<div class="caixa-cmp"><p class="caixa-sub">Comparado com ${escapeHtml(formatDate(comparativo.dataAnterior))} (último dia anterior com vendas)</p>
      ${linhaCmp("Total líquido", comparativo.totalLiquido, money)}
      ${linhaCmp("Nº de vendas", comparativo.numeroVendas, String)}
      ${linhaCmp("Ticket médio", comparativo.ticketMedio, money)}</div>`;
  }

  function renderClosingSummary(resumo, comparativo) {
    const line = (label, value, cls = "") => `<div class="caixa-line ${cls}"><span>${label}</span><strong>${value}</strong></div>`;
    const forms = resumo.formas.map((item) => line(escapeHtml(item.forma), money(item.liquido))).join("");
    $("#caixa-close-summary").innerHTML = `
      ${line("Dinheiro na abertura", money(resumo.valorAbertura))}
      ${line(`Vendas (${resumo.numeroVendas})`, money(resumo.totalVendas))}
      ${resumo.numeroDevolucoes ? line(`Devoluções (${resumo.numeroDevolucoes})`, `− ${money(resumo.totalDevolucoes)}`) : ""}
      ${line("Total líquido", money(resumo.totalLiquido), "strong")}
      ${forms ? `<p class="caixa-sub">Por forma de pagamento (já descontadas as devoluções)</p>${forms}` : ""}
      ${resumo.numeroVendasCanceladas ? `<p class="caixa-sub">${resumo.numeroVendasCanceladas} venda(s) cancelada(s) ficaram fora dos totais.</p>` : ""}
      ${line("Dinheiro esperado na gaveta", money(resumo.esperadoDinheiro), "total")}
      <p class="caixa-sub">Esperado = dinheiro da abertura + vendas em dinheiro − devoluções de vendas em dinheiro.</p>
      ${comparativoHtml(comparativo)}`;
  }

  function updateDifference() {
    const element = $("#caixa-close-diff");
    const counted = parseDecimal(fieldValue("#caixa-close-counted"));
    if (!closeAttempt || !Number.isFinite(counted) || counted < 0) {
      element.textContent = "";
      element.className = "caixa-diff";
      return;
    }
    const difference = roundMoney(counted - closeAttempt.resumo.esperadoDinheiro);
    element.className = `caixa-diff ${difference === 0 ? "ok" : (difference < 0 ? "short" : "over")}`;
    element.textContent = difference === 0
      ? "Confere: sem diferença."
      : (difference < 0 ? `Faltam ${money(-difference)} em relação ao esperado.` : `Sobram ${money(difference)} em relação ao esperado.`);
  }

  function closeOverlay() {
    closeAttempt = null;
    $("#caixa-close-overlay").hidden = true;
    $("#caixa-close-form").reset();
    setFeedback("#caixa-close-overlay-feedback", "");
    $("#caixa-close-diff").textContent = "";
  }

  onEvent("#caixa-close-start", "click", async () => {
    const open = estadoUi.caixaAberto;
    if (closing || !open) return;
    if (estadoUi.saleInFlight) return setFeedback("#caixa-close-feedback", "Há uma venda sendo registrada. Aguarde e tente de novo.", true);
    if (saleCart.length) {
      return setFeedback("#caixa-close-feedback", "Há uma compra em andamento. Finalize ou limpe a compra antes de fechar o caixa.", true);
    }
    const button = $("#caixa-close-start");
    closing = true;
    button.disabled = true;
    setFeedback("#caixa-close-feedback", "Calculando o fechamento…");
    try {
      // Lê o banco de novo: o fechamento não pode depender do que estava na tela.
      const movimentos = await loadMovimentosCaixa(open);
      const resumo = summarizeCaixa({ caixa: open, ...movimentos });
      const comparativo = buildComparativo({ resumo, anterior: diaAnteriorComVendas({ caixa: open, ...movimentos }) });
      closeAttempt = { id: newCaixaId(), caixaId: open.id, resumo, comparativo, caixa: open };
      renderClosingSummary(resumo, comparativo);
      $("#caixa-close-form").reset();
      $("#caixa-close-diff").textContent = "";
      setFeedback("#caixa-close-overlay-feedback", "");
      setFeedback("#caixa-close-feedback", "");
      $("#caixa-close-overlay").hidden = false;
      $("#caixa-close-counted").focus();
    } catch (error) {
      console.error("Falha ao calcular o fechamento:", error);
      setFeedback("#caixa-close-feedback", `Não foi possível calcular o fechamento. ${explainError(error)}`, true);
    } finally {
      closing = false;
      button.disabled = false;
    }
  });

  onEvent("#caixa-close-dismiss", "click", closeOverlay);
  onEvent("#caixa-close-counted", "input", updateDifference);

  onEvent("#caixa-close-form", "submit", async (event) => {
    event.preventDefault();
    if (closing || !closeAttempt) return;
    if (!estadoUi.caixaAberto || estadoUi.caixaAberto.id !== closeAttempt.caixaId) {
      return setFeedback("#caixa-close-overlay-feedback", "O caixa mudou. Feche esta janela e tente de novo.", true);
    }
    const raw = parseDecimal(fieldValue("#caixa-close-counted"));
    if (!Number.isFinite(raw) || raw < 0) {
      return setFeedback("#caixa-close-overlay-feedback", "Informe o dinheiro contado na gaveta (use 0 se estiver vazia).", true);
    }
    const valorContado = roundMoney(raw);
    const difference = roundMoney(valorContado - closeAttempt.resumo.esperadoDinheiro);
    if (difference !== 0 && !window.confirm(
      `${difference < 0 ? "Faltam" : "Sobram"} ${money(Math.abs(difference))} em relação ao dinheiro esperado.\n\nFechar o caixa mesmo assim?`
    )) return;

    const button = $("#caixa-close-confirm");
    const date = dateToday();
    closing = true;
    button.disabled = true;
    setFeedback("#caixa-close-overlay-feedback", "Fechando o caixa…");
    try {
      const result = await closeCaixa({
        caixaId: closeAttempt.caixaId,
        fechamentoId: closeAttempt.id,
        valorContado,
        observacao: cleanOption(fieldValue("#caixa-close-note")),
        resumo: closeAttempt.resumo,
        comparativo: closeAttempt.comparativo,
        date,
        dateTime: dateTimeFor(date),
        userEmail: currentEmail()
      });
      const fechado = { ...closeAttempt.caixa, ...result.fechamento };
      closeOverlay();
      showToast(result.alreadySaved ? "Este caixa já estava fechado." : "Caixa fechado.");
      if (!result.alreadySaved && autoPrint()) imprimir(() => printFechamento(fechado));
      await refreshAfter("Caixa fechado. Atualize a página para continuar.");
    } catch (error) {
      console.error("Falha ao fechar o caixa:", error);
      setFeedback("#caixa-close-overlay-feedback", explainError(error), true);
    } finally {
      closing = false;
      button.disabled = false;
    }
  });

  // ----- Reimpressão das notas -----
  onEvent("#caixa-print-open", "click", () => {
    const aberto = estadoUi.caixaAberto;
    if (aberto) imprimir(() => printAbertura(aberto, ultimoFechado(aberto)));
  });
  onEvent("#caixa-history-list", "click", (event) => {
    const abertura = event.target.closest("[data-caixa-print-open]");
    const fechamento = event.target.closest("[data-caixa-print-close]");
    const id = abertura?.dataset.caixaPrintOpen || fechamento?.dataset.caixaPrintClose;
    const caixa = caixas.find((item) => item.id === id);
    if (!caixa) return;
    if (abertura) imprimir(() => printAbertura(caixa, ultimoFechado(caixa)));
    else imprimir(() => printFechamento(caixa));
  });
}
