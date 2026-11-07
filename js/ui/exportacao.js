import { $, money, roundMoney, formatDate, formatTimestamp, minStockOf, isLowStock, getRegisteredSalePrice, calcSuggestedPrice, packSizeOf, baseNameOf, saleItemsOf, saleTotalOf, saleDateOf, returnDateOf, returnTotalOf, inPeriod, yesNo, fieldValue, onEvent, dateToday, wait } from "../utils.js?v=20261104-1";
import { products, entries, exits, sales, saleReturns } from "../estado.js?v=20261106-5";
import { excelText, csvNumber, downloadCsv } from "../export.js?v=20261104-1";

const EXIT_REASON_LABELS = { perda: "Perda", devolucao: "Devolução ao fornecedor", uso_interno: "Uso interno", outro: "Outra saída" };
function getSalePeriodStart(period) {
  const now = new Date();
  if (period === "today") return `${now.getFullYear()}-${String(now.getMonth()+1).padStart(2,"0")}-${String(now.getDate()).padStart(2,"0")}`;
  if (period === "week") { const start = new Date(now); start.setDate(start.getDate()-6); return `${start.getFullYear()}-${String(start.getMonth()+1).padStart(2,"0")}-${String(start.getDate()).padStart(2,"0")}`; }
  if (period === "month") return `${now.getFullYear()}-${String(now.getMonth()+1).padStart(2,"0")}-01`;
  return null;
}
function returnedByProduct(saleId) {
  const map = {};
  saleReturns.filter((entry) => entry.vendaId === saleId).forEach((entry) => (entry.itens || []).forEach((item) => { map[item.produtoId] = (map[item.produtoId] || 0) + (Number(item.quantidade) || 0); }));
  return map;
}

export function initExportacaoUI({ setFeedback, showToast, explainError, loadData }) {
  const EXIT_REASON_LABELS = { perda: "Perda", devolucao: "Devolução ao fornecedor", uso_interno: "Uso interno", outro: "Outra saída" };
// As colunas novas ficam sempre no FINAL, para não deslocar as colunas das planilhas que você já usa.
function exportProductsCsv() {
  const rows = [...products]
    .sort((a, b) => String(a.nome || "").localeCompare(String(b.nome || ""), "pt-BR"))
    .map((product) => [
      product.nome, product.marca, product.categoria, product.codigoInterno, excelText(product.codigoBarras),
      Number(product.quantidade) || 0, csvNumber(product.custo), csvNumber(getRegisteredSalePrice(product)),
      csvNumber(calcSuggestedPrice(product)), minStockOf(product) ?? "", isLowStock(product) ? "Sim" : "Não",
      csvNumber(roundMoney((Number(product.quantidade) || 0) * roundMoney(product.custo))),
      product.arquivado ? "Arquivado" : "Ativo",
      product.volumeMl ?? "", packSizeOf(product) || "",
      typeof product.custoFardo === "number" ? csvNumber(product.custoFardo) : "",
      baseNameOf(product)
    ]);
  return downloadCsv("produtos",
    ["Produto", "Marca", "Categoria", "Código interno", "Código de barras", "Quantidade", "Custo", "Preço de venda", "Preço sugerido", "Estoque mínimo", "Abaixo do mínimo", "Valor em estoque", "Situação", "Volume (ml)", "Unidades por fardo", "Custo do fardo", "Nome sem volume"],
    rows);
}

function exportEntriesCsv() {
  const rows = [...entries]
    .sort((a, b) => String(b.data || "").localeCompare(String(a.data || "")))
    .map((entry) => [
      formatDate(entry.data), entry.produtoNome, entry.tipo === "estoque_inicial" ? "Estoque inicial" : "Entrada",
      Number(entry.quantidade) || 0, csvNumber(entry.custoUnitario),
      csvNumber((Number(entry.quantidade) || 0) * (Number(entry.custoUnitario) || 0)), entry.fornecedor, entry.observacao,
      entry.fardos ?? "", entry.unidadesPorFardo ?? "",
      typeof entry.custoFardo === "number" ? csvNumber(entry.custoFardo) : ""
    ]);
  return downloadCsv("entradas", ["Data", "Produto", "Tipo", "Quantidade", "Custo unitário", "Total", "Fornecedor", "Observação", "Fardos", "Unidades por fardo", "Custo do fardo"], rows);
}

function exportExitsCsv() {
  const rows = [...exits]
    .sort((a, b) => String(b.dataHora || "").localeCompare(String(a.dataHora || "")))
    .map((exit) => [
      formatDate(exit.dataHora || exit.data), exit.produtoNome, EXIT_REASON_LABELS[exit.motivo] || exit.motivo,
      Number(exit.quantidade) || 0, exit.usuario, exit.observacao
    ]);
  return downloadCsv("saidas", ["Data", "Produto", "Motivo", "Quantidade", "Responsável", "Observação"], rows);
}

// Uma linha por item vendido; o total da venda se repete em cada linha.
function exportSalesCsv() {
  const start = getSalePeriodStart(fieldValue("#export-period") || "all");
  const today = dateToday();
  const rows = [];
  [...sales]
    .filter((sale) => inPeriod(saleDateOf(sale), start, today))
    .sort((a, b) => String(b.dataHora || "").localeCompare(String(a.dataHora || "")))
    .forEach((sale) => {
      const returned = returnedByProduct(sale.id);
      const cancelled = sale.status === "cancelada";
      saleItemsOf(sale).forEach((item) => {
        rows.push([
          formatDate(sale.dataHora || sale.data), cancelled ? "Cancelada" : "Concluída",
          item.produtoNome || item.nome, Number(item.quantidade) || 0, csvNumber(item.precoUnitario),
          typeof item.custoUnitario === "number" ? csvNumber(item.custoUnitario) : "",
          csvNumber(item.subtotal ?? (Number(item.quantidade) || 0) * (Number(item.precoUnitario) || 0)),
          csvNumber(saleTotalOf(sale)), sale.formaPagamento, returned[item.produtoId] || 0,
          sale.usuario, yesNo(item.abaixoDoCusto),
          cancelled ? formatTimestamp(sale.canceladaEm) : "", cancelled ? sale.motivoCancelamento : "",
          // Dados novos de cada venda (vazios nas vendas antigas).
          sale.hora ?? "", sale.diaSemana ?? "", item.saldoAntes ?? "", item.categoria || "",
          item.volumeMl ?? "", item.origem || "", sale.duracaoSegundos ?? "", yesNo(sale.lancamentoRetroativo)
        ]);
      });
    });
  return downloadCsv("vendas",
    ["Data", "Situação", "Produto", "Quantidade", "Preço unitário", "Custo unitário", "Subtotal", "Total da venda", "Pagamento", "Quantidade devolvida (produto)", "Responsável", "Abaixo do custo", "Cancelada em", "Motivo do cancelamento", "Hora da venda", "Dia da semana (0=domingo)", "Saldo antes do item", "Categoria", "Volume (ml)", "Origem do item", "Duração do atendimento (s)", "Lançamento retroativo"],
    rows);
}

function exportReturnsCsv() {
  const start = getSalePeriodStart(fieldValue("#export-period") || "all");
  const today = dateToday();
  const rows = [];
  [...saleReturns]
    .filter((saleReturn) => inPeriod(returnDateOf(saleReturn), start, today))
    .sort((a, b) => String(b.dataHora || "").localeCompare(String(a.dataHora || "")))
    .forEach((saleReturn) => {
      (saleReturn.itens || []).forEach((item) => {
        rows.push([
          formatDate(saleReturn.dataHora || saleReturn.data), item.produtoNome, Number(item.quantidade) || 0,
          csvNumber(item.precoUnitario), csvNumber(item.subtotal), saleReturn.motivo, saleReturn.usuario
        ]);
      });
    });
  return downloadCsv("devolucoes", ["Data", "Produto", "Quantidade", "Preço unitário", "Valor devolvido", "Motivo", "Responsável"], rows);
}

const EXPORTERS = {
  produtos: { label: "Produtos", run: exportProductsCsv },
  vendas: { label: "Vendas", run: exportSalesCsv },
  devolucoes: { label: "Devoluções", run: exportReturnsCsv },
  entradas: { label: "Entradas", run: exportEntriesCsv },
  saidas: { label: "Saídas", run: exportExitsCsv }
};

async function runExport(keys) {
  const feedback = "#export-feedback";
  setFeedback(feedback, "Atualizando dados…");
  try {
    await loadData();
    const done = [];
    const empty = [];
    for (const key of keys) {
      const exporter = EXPORTERS[key];
      if (!exporter) continue;
      if (exporter.run()) done.push(exporter.label);
      else empty.push(exporter.label);
      if (keys.length > 1) await wait(500); // dá tempo ao navegador entre downloads
    }
    const parts = [];
    if (done.length) parts.push(`Gerado: ${done.join(", ")}.`);
    if (empty.length) parts.push(`Sem registros (não baixado): ${empty.join(", ")}.`);
    setFeedback(feedback, parts.join(" "), false);
    if (done.length) showToast("Arquivo CSV gerado.");
  } catch (error) {
    console.error("Falha na exportação:", error);
    setFeedback(feedback, explainError(error), true);
  }
}



  const EXPORTERS = {
    produtos: { label: "Produtos", run: exportProductsCsv },
    vendas: { label: "Vendas", run: exportSalesCsv },
    devolucoes: { label: "Devoluções", run: exportReturnsCsv },
    entradas: { label: "Entradas", run: exportEntriesCsv },
    saidas: { label: "Saídas", run: exportExitsCsv }
  };
  document.querySelectorAll("[data-export]").forEach((button) => button.addEventListener("click", () => runExport([button.dataset.export])));
  onEvent("#export-all", "click", () => runExport(Object.keys(EXPORTERS)));
}
