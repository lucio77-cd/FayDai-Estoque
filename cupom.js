// cupom.js — cupom NÃO fiscal (térmica 80 mm) + apoio da tela do Caixa.
// Não acessa o Firebase e não altera dados.
const $ = (s) => document.querySelector(s);
const KEY = "faydai-cupom-auto";
const money = (v) => new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" }).format(Number(v) || 0);
const r2 = (v) => Math.round(((Number(v) || 0) + Number.EPSILON) * 100) / 100;
const esc = (v = "") => String(v).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const when = (v) => { const m = String(v || "").match(/^(\d{4})-(\d{2})-(\d{2})(.*)$/); return m ? `${m[3]}/${m[2]}/${m[1]}${m[4]}` : String(v || ""); };
const autoOn = () => { try { return localStorage.getItem(KEY) !== "no"; } catch (e) { return true; } };

// Arte do topo da nota (PNG na raiz do repositório). O cupom é escrito num iframe sem endereço próprio,
// então o caminho precisa ser absoluto; se o arquivo não carregar, a imagem some e a nota sai sem ela.
const NOTA_CSS = `@page{size:80mm auto;margin:0}
*{box-sizing:border-box}
html,body{margin:0;background:#fff;color:#000}
body{width:72mm;margin:0 auto;padding:3mm 0 10mm;font:12.5px/1.35 "Courier New",monospace}
.c{text-align:center}.b{font-weight:700}.big{font-size:1.2em}
.sep{border-top:1px dashed #000;margin:2mm 0}
.row{display:flex;justify-content:space-between;gap:2mm}
.it{margin-bottom:1.5mm;overflow-wrap:anywhere}
.tot{font-size:1.25em;font-weight:700}
.logo{display:block;margin:0 auto 2mm;width:auto;height:auto;max-width:56mm;max-height:26mm;object-fit:contain;filter:grayscale(1) contrast(1.3)}
.sub{font-weight:700;margin:1mm 0}.muted{font-size:.9em}.sign{margin-top:8mm;border-top:1px solid #000;text-align:center;padding-top:1mm}
`;
const LOGO_FILE = "logo01.png";
const logoUrl = () => { try { return new URL(LOGO_FILE, document.baseURI).href; } catch (e) { return ""; } };

function storeHead(store) {
  return [
    store.nome && `<div class="c b big">${esc(store.nome)}</div>`,
    store.endereco && `<div class="c">${esc(store.endereco)}</div>`,
    store.telefone && `<div class="c">Tel.: ${esc(store.telefone)}</div>`,
    store.cnpj && `<div class="c">CNPJ: ${esc(store.cnpj)}</div>`
  ].filter(Boolean).join("");
}
function logoTag() {
  const logoSrc = logoUrl();
  return logoSrc ? `<img class="logo" src="${esc(logoSrc)}" alt="" onerror="this.remove()">` : "";
}

function receiptHtml(sale, store) {
  const head = storeHead(store);
  const logo = logoTag();
  const items = Array.isArray(sale.itens) && sale.itens.length ? sale.itens
    : [{ produtoNome: sale.produtoNome || "Produto", quantidade: sale.quantidade || 0, precoUnitario: sale.precoUnitario || 0 }];
  const sub = (i) => (typeof i.subtotal === "number" ? i.subtotal : r2((Number(i.quantidade) || 0) * (Number(i.precoUnitario) || 0)));
  const total = Number(sale.total) || r2(items.reduce((s, i) => s + sub(i), 0));
  const rows = items.map((i) => `<div class="it"><div>${esc(i.produtoNome || i.nome || "Produto")}</div><div class="row"><span>${Number(i.quantidade) || 0} x ${money(i.precoUnitario)}</span><span>${money(sub(i))}</span></div></div>`).join("");
  const op = String(sale.usuario || "").split("@")[0];
  const cashRows = typeof sale.valorRecebido === "number"
    ? `<div class="row"><span>Recebido</span><span>${money(sale.valorRecebido)}</span></div><div class="row"><span>Troco</span><span>${money(sale.troco)}</span></div>` : "";
  return `<!doctype html><html><head><meta charset="utf-8"><title>Cupom</title><style>
${NOTA_CSS}
</style></head><body>
${logo}
${head}
<div class="sep"></div>
<div class="c b">CUPOM NÃO FISCAL</div>
<div>Venda: #${esc(String(sale.id || "").slice(-6).toUpperCase())}</div>
<div>${esc(when(sale.dataHora || sale.data))}</div>
${op ? `<div>Operador: ${esc(op)}</div>` : ""}
<div class="sep"></div>
${rows}
<div class="sep"></div>
<div class="row tot"><span>TOTAL</span><span>${money(total)}</span></div>
<div class="row"><span>Pagamento</span><span>${esc(sale.formaPagamento || "—")}</span></div>
${cashRows}
<div class="sep"></div>
<div class="c">Obrigado pela preferência!</div>
<div class="c">Este documento não tem valor fiscal.</div>
</body></html>`;
}

async function printHtml(html) {
  const frame = document.createElement("iframe");
  frame.setAttribute("aria-hidden", "true");
  frame.style.cssText = "position:fixed;right:0;bottom:0;width:0;height:0;border:0;visibility:hidden";
  document.body.appendChild(frame);

  try {
    const doc = frame.contentWindow.document;
    doc.open();
    doc.write(html);
    doc.close();

    // Aguarda imagens (incluindo o logo, quando integrado) e fontes antes de abrir a impressão.
    const imagesReady = Array.from(doc.images).map((image) => {
      if (image.complete) {
        return typeof image.decode === "function" ? image.decode().catch(() => {}) : Promise.resolve();
      }
      return new Promise((resolve) => {
        const finish = () => resolve();
        image.addEventListener("load", finish, { once: true });
        image.addEventListener("error", finish, { once: true });
      }).then(() => typeof image.decode === "function" ? image.decode().catch(() => {}) : undefined);
    });

    await Promise.all([
      Promise.all(imagesReady),
      doc.fonts?.ready?.catch(() => {}) || Promise.resolve()
    ]);

    frame.contentWindow.addEventListener("afterprint", () => frame.remove(), { once: true });
    frame.contentWindow.focus();
    frame.contentWindow.print();

    // Fallback caso o navegador não dispare afterprint.
    setTimeout(() => frame.remove(), 60000);
  } catch (error) {
    console.error("Falha ao preparar o cupom para impressão:", error);
    frame.remove();
  }
}

export function printSale(sale, store = {}) { printHtml(receiptHtml(sale, store || {})); }

// ---------- Notas de abertura e fechamento de caixa (não fiscais, 80 mm) ----------
const KEY_CAIXA = "faydai-caixa-nota-auto";
export const caixaNotaAuto = () => { try { return localStorage.getItem(KEY_CAIXA) !== "no"; } catch (e) { return true; } };

const pct = (v) => (typeof v === "number" && Number.isFinite(v) ? `${v > 0 ? "+" : ""}${v.toFixed(1).replace(".", ",")}%` : "sem base");
const nomeOperador = (email) => String(email || "").split("@")[0];
const linha = (rotulo, valor, cls = "") => `<div class="row ${cls}"><span>${rotulo}</span><span>${valor}</span></div>`;
const notaPagina = (titulo, store, corpo) => `<!doctype html><html><head><meta charset="utf-8"><title>${esc(titulo)}</title><style>
${NOTA_CSS}</style></head><body>
${logoTag()}
${storeHead(store)}
<div class="sep"></div>
${corpo}
<div class="sep"></div>
<div class="c muted">Este documento não tem valor fiscal.</div>
</body></html>`;

// caixa: { id, dataHora, abertoPor, valorAbertura, observacaoAbertura }
// ultimo (opcional): fechamento anterior { data, valorAbertura, valorContado, diferenca, totalLiquido, variacaoAbertura }
export function caixaAberturaHtml(caixa, ultimo, store = {}) {
  const op = nomeOperador(caixa.abertoPor);
  const comparacao = ultimo ? `
<div class="sep"></div>
<div class="sub">CAIXA ANTERIOR (${esc(when(ultimo.data))})</div>
${linha("Abertura", money(ultimo.valorAbertura))}
${linha("Variação da abertura", pct(ultimo.variacaoAbertura))}
${linha("Contado no fechamento", money(ultimo.valorContado))}
${linha("Diferença", money(ultimo.diferenca))}
${linha("Vendas líquidas", money(ultimo.totalLiquido))}` : "";
  return notaPagina("Abertura de caixa", store || {}, `
<div class="c b">ABERTURA DE CAIXA</div>
<div>Caixa: #${esc(String(caixa.id || "").slice(-6).toUpperCase())}</div>
<div>${esc(when(caixa.dataHora))}</div>
${op ? `<div>Operador: ${esc(op)}</div>` : ""}
<div class="sep"></div>
${linha("DINHEIRO NA GAVETA", money(caixa.valorAbertura), "tot")}
${caixa.observacaoAbertura ? `<div>Obs.: ${esc(caixa.observacaoAbertura)}</div>` : ""}${comparacao}`);
}

// caixa: documento do caixa já fechado (abertura + campos do fechamento, inclusive "comparativo").
export function caixaFechamentoHtml(caixa, store = {}) {
  const formas = (Array.isArray(caixa.formas) ? caixa.formas : [])
    .map((item) => linha(esc(item.forma), money(item.liquido))).join("");
  const diferenca = Number(caixa.diferenca) || 0;
  const situacao = diferenca === 0 ? "Confere" : (diferenca < 0 ? `Faltam ${money(-diferenca)}` : `Sobram ${money(diferenca)}`);
  const comp = caixa.comparativo;
  const bloco = comp ? `
<div class="sep"></div>
<div class="sub">COMPARADO COM ${esc(when(comp.dataAnterior))}</div>
${linha("Total líquido", pct(comp.totalLiquido?.variacao))}
<div class="muted">${money(comp.totalLiquido?.atual)} hoje x ${money(comp.totalLiquido?.anterior)}</div>
${linha("Nº de vendas", pct(comp.numeroVendas?.variacao))}
<div class="muted">${Number(comp.numeroVendas?.atual) || 0} hoje x ${Number(comp.numeroVendas?.anterior) || 0}</div>
${linha("Ticket médio", pct(comp.ticketMedio?.variacao))}
<div class="muted">${money(comp.ticketMedio?.atual)} hoje x ${money(comp.ticketMedio?.anterior)}</div>` : `
<div class="sep"></div>
<div class="muted">Sem dia anterior com vendas para comparar.</div>`;
  const opAbertura = nomeOperador(caixa.abertoPor);
  const opFechamento = nomeOperador(caixa.fechadoPor);
  return notaPagina("Fechamento de caixa", store || {}, `
<div class="c b">FECHAMENTO DE CAIXA</div>
<div>Caixa: #${esc(String(caixa.id || "").slice(-6).toUpperCase())}</div>
<div>Aberto: ${esc(when(caixa.dataHora))}${opAbertura ? ` (${esc(opAbertura)})` : ""}</div>
<div>Fechado: ${esc(when(caixa.dataHoraFechamento))}${opFechamento ? ` (${esc(opFechamento)})` : ""}</div>
<div class="sep"></div>
${linha("Dinheiro na abertura", money(caixa.valorAbertura))}
${linha(`Vendas (${Number(caixa.numeroVendas) || 0})`, money(caixa.totalVendas))}
${Number(caixa.numeroDevolucoes) ? linha(`Devoluções (${caixa.numeroDevolucoes})`, `- ${money(caixa.totalDevolucoes)}`) : ""}
${linha("TOTAL LÍQUIDO", money(caixa.totalLiquido), "tot")}
${Number(caixa.numeroVendasCanceladas) ? `<div class="muted">${caixa.numeroVendasCanceladas} venda(s) cancelada(s) fora dos totais</div>` : ""}
${formas ? `<div class="sep"></div><div class="sub">POR FORMA DE PAGAMENTO</div>${formas}` : ""}
<div class="sep"></div>
<div class="sub">CONFERÊNCIA DO DINHEIRO</div>
${linha("Esperado", money(caixa.esperadoDinheiro))}
${linha("Contado", money(caixa.valorContado))}
${linha("Resultado", situacao, "b")}${bloco}
${caixa.observacaoAbertura ? `<div class="muted">Obs. abertura: ${esc(caixa.observacaoAbertura)}</div>` : ""}
${caixa.observacaoFechamento ? `<div class="muted">Obs. fechamento: ${esc(caixa.observacaoFechamento)}</div>` : ""}
<div class="sign">Responsável</div>`);
}

export function printCaixaAbertura(caixa, ultimo, store = {}) { return printHtml(caixaAberturaHtml(caixa, ultimo, store)); }
export function printCaixaFechamento(caixa, store = {}) { return printHtml(caixaFechamentoHtml(caixa, store)); }


let lastSale = null;
let lastStore = {};
let syncPay = () => {};

export function showSaleDone(sale, store) {
  lastSale = sale; lastStore = store || {};
  const box = $("#sale-done");
  if (!box) return;
  const change = typeof sale.troco === "number" ? ` · Troco: <strong>${money(sale.troco)}</strong>` : "";
  $("#sale-done-text").innerHTML = `Venda registrada: <strong>${money(sale.total)}</strong>${change}`;
  box.hidden = false;
  if (autoOn()) printSale(sale, lastStore);
}

export function resetCaixaUI() {
  const cash = $("#sale-cash-received");
  if (cash) cash.value = "";
  syncPay();
}

export function initCaixaUI(getStore = () => ({})) {
  const select = $("#sale-payment-method"), cash = $("#sale-cash-received"), change = $("#sale-change");
  if (!select || !cash || !change) return;
  let total = 0;
  const update = () => {
    const got = parseFloat(String(cash.value).replace(",", "."));
    if (!Number.isFinite(got) || got <= 0) { change.textContent = ""; change.className = "sale-change"; return; }
    const diff = r2(got - total);
    change.className = "sale-change " + (diff >= 0 ? "ok" : "short");
    change.textContent = diff >= 0 ? `Troco: ${money(diff)}` : `Faltam ${money(-diff)}`;
  };
  syncPay = () => {
    document.querySelectorAll("[data-pay]").forEach((b) => {
      const selected = b.dataset.pay === select.value;
      b.classList.toggle("active", selected);
      b.setAttribute("aria-pressed", String(selected));
    });
    const isCash = select.value === "Dinheiro";
    $("#sale-cash-box").hidden = !isCash;
    if (!isCash) cash.value = "";
    update();
  };
  document.querySelectorAll("[data-pay]").forEach((b) => b.addEventListener("click", () => { select.value = b.dataset.pay; syncPay(); }));
  select.addEventListener("change", syncPay);
  cash.addEventListener("input", update);
  document.querySelectorAll("[data-cash]").forEach((b) => b.addEventListener("click", () => {
    cash.value = b.dataset.cash === "exact" ? total.toFixed(2) : b.dataset.cash;
    update();
  }));
  document.addEventListener("cart:changed", (e) => {
    total = Number(e.detail?.total) || 0;
    if ((e.detail?.units || 0) > 0 && $("#sale-done")) $("#sale-done").hidden = true;
    update();
  });
  $("#sale-print-last")?.addEventListener("click", () => { if (lastSale) printSale(lastSale, lastStore); });
  $("#sale-new")?.addEventListener("click", () => { $("#sale-done").hidden = true; $("#sale-product-search").focus(); });

  // Atalhos: F2 busca · F4 finaliza · F8 limpa a compra
  document.addEventListener("keydown", (e) => {
    const panel = $("#caja-panel");
    if (!panel || panel.hidden || $("#caja-content")?.hidden || e.altKey) return;
    if (document.querySelector(".overlay:not([hidden])")) return;
    if (e.key === "F2") { e.preventDefault(); $("#sale-product-search").focus(); $("#sale-product-search").select(); }
    else if (e.key === "F4") { e.preventDefault(); const b = $("#sale-finish-button"); if (!b.disabled) b.click(); }
    else if (e.key === "F8") { e.preventDefault(); $("#sale-clear-button").click(); }
  });

  const auto = $("#print-auto");
  if (auto) {
    auto.checked = autoOn();
    auto.addEventListener("change", () => { try { localStorage.setItem(KEY, auto.checked ? "yes" : "no"); } catch (e) { /* opcional */ } });
  }
  const autoCaixa = $("#print-caixa-auto");
  if (autoCaixa) {
    autoCaixa.checked = caixaNotaAuto();
    autoCaixa.addEventListener("change", () => { try { localStorage.setItem(KEY_CAIXA, autoCaixa.checked ? "yes" : "no"); } catch (e) { /* opcional */ } });
  }
  $("#print-test")?.addEventListener("click", () => {
    const n = new Date(), p = (x) => String(x).padStart(2, "0");
    printSale({
      id: "TESTE0", dataHora: `${n.getFullYear()}-${p(n.getMonth() + 1)}-${p(n.getDate())} ${p(n.getHours())}:${p(n.getMinutes())}`,
      itens: [{ produtoNome: "Produto de teste com nome comprido", quantidade: 2, precoUnitario: 5.5 }, { produtoNome: "Outro item", quantidade: 1, precoUnitario: 3 }],
      total: 14, formaPagamento: "Dinheiro", valorRecebido: 20, troco: 6, usuario: "teste"
    }, getStore());
  });
}
