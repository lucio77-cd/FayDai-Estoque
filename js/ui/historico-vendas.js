import { $, money, formatDate, formatTimestamp, escapeHtml, saleItemsOf, saleTotalOf, onEvent } from "../utils.js?v=20261104-1";
import { sales, saleReturns } from "../estado.js?v=20261106-5";

// Só vendas no formato atual (com produtoId em todos os itens) aceitam cancelamento e devolução.
const isActionableSale = (sale) => Array.isArray(sale.itens) && sale.itens.length > 0
  && sale.itens.every((item) => item.produtoId);
// Quantidade já devolvida de cada produto de uma venda.
function returnedByProduct(saleId) {
  const map = {};
  saleReturns.filter((saleReturn) => saleReturn.vendaId === saleId).forEach((saleReturn) => {
    (saleReturn.itens || []).forEach((item) => {
      map[item.produtoId] = (map[item.produtoId] || 0) + (Number(item.quantidade) || 0);
    });
  });
  return map;
}

// Linhas da venda com vendido, já devolvido e ainda devolvível.
function returnableRows(sale) {
  const returned = returnedByProduct(sale.id);
  return saleItemsOf(sale).map((item, index) => {
    const sold = Number(item.quantidade) || 0;
    const done = returned[item.produtoId] || 0;
    return { index, item, sold, returned: done, available: Math.max(sold - done, 0) };
  });
}

function renderSales(saleReturnsAvailable) {
  const list = $("#sales-list");
  if (!sales.length) {
    list.innerHTML = '<div class="empty-state">Nenhuma venda registrada ainda.</div>';
    return;
  }
  list.innerHTML = [...sales].sort((a, b) => String(b.dataHora || "").localeCompare(String(a.dataHora || "")))
    .map((sale) => {
      const items = saleItemsOf(sale);
      const cancelled = sale.status === "cancelada";
      const itemLines = items.map((item) => {
        const flag = item.abaixoDoCusto
          ? ' <span class="sale-flag danger">abaixo do custo</span>'
          : (item.abaixoDoSugerido ? ' <span class="sale-flag warning">abaixo do sugerido</span>' : "");
        return `<li>${escapeHtml(item.produtoNome || item.nome || "Produto")} — ${Number(item.quantidade) || 0} × ${money(item.precoUnitario)}${flag}</li>`;
      }).join("");
      const total = saleTotalOf(sale);

      const actionable = isActionableSale(sale);
      const saleReturnList = saleReturns
        .filter((saleReturn) => saleReturn.vendaId === sale.id)
        .sort((a, b) => String(a.dataHora || "").localeCompare(String(b.dataHora || "")));
      const rows = actionable ? returnableRows(sale) : [];
      const hasReturnable = rows.some((row) => row.available > 0);

      let statusLabel = "";
      if (cancelled) statusLabel = '<span class="sale-status cancelled">Cancelada</span>';
      else if (saleReturnList.length) {
        statusLabel = hasReturnable
          ? '<span class="sale-status partial">Devolução parcial</span>'
          : '<span class="sale-status cancelled">Totalmente devolvida</span>';
      }

      const cancelInfo = cancelled
        ? `<p>Cancelada${formatTimestamp(sale.canceladaEm) ? ` em ${escapeHtml(formatTimestamp(sale.canceladaEm))}` : ""} por ${escapeHtml(sale.canceladaPor || "Não identificado")}. Motivo: ${escapeHtml(sale.motivoCancelamento || "não informado")}</p>`
        : "";

      const returnsBlock = saleReturnList.length
        ? `<h4 class="sale-returns-title">Devoluções</h4><ul class="sale-history-items">${saleReturnList.map((saleReturn) => `<li>${escapeHtml(formatDate(saleReturn.dataHora || saleReturn.data))} — ${(saleReturn.itens || []).map((item) => `${Number(item.quantidade) || 0} × ${escapeHtml(item.produtoNome || "Produto")}`).join(", ")} — ${money(saleReturn.totalDevolvido)}${saleReturn.motivo ? ` (${escapeHtml(saleReturn.motivo)})` : ""}</li>`).join("")}</ul>`
        : "";

      let actions = "";
      if (!cancelled && actionable) {
        if (!saleReturnsAvailable) {
          actions = '<p class="small muted">Cancelamento e devolução indisponíveis até as regras do Firestore serem publicadas.</p>';
        } else {
          const buttons = [];
          if (hasReturnable) buttons.push(`<button class="button secondary" type="button" data-sale-return="${escapeHtml(sale.id)}">Devolver itens</button>`);
          if (!saleReturnList.length) buttons.push(`<button class="button danger-outline" type="button" data-sale-cancel="${escapeHtml(sale.id)}">Cancelar venda</button>`);
          if (buttons.length) actions = `<div class="sale-actions">${buttons.join("")}</div>`;
        }
      }

      return `<article class="entry-card${cancelled ? " is-cancelled" : ""}">
        <div class="item-title-row"><div class="item-title">Venda${statusLabel}</div><span class="stock-badge">${money(total)}</span></div>
        <ul class="sale-history-items">${itemLines}</ul>
        <p>${escapeHtml(formatDate(sale.dataHora || sale.data) || "Data não informada")} · Pagamento: ${escapeHtml(sale.formaPagamento || "Não informado")}</p>
        <p>Responsável: ${escapeHtml(sale.usuario || "Não identificado")}</p>
        ${cancelInfo}
        ${returnsBlock}
        ${actions}${cancelled ? "" : `<p class="sale-print-row"><button class="button quiet" type="button" data-sale-print="${escapeHtml(sale.id)}">Reimprimir cupom</button></p>`}
      </article>`;
    }).join("");
}

export { renderSales, returnableRows };
