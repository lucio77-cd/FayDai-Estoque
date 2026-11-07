import { $, money, roundMoney, toDateString, dateToday, formatDate, escapeHtml, normalizeText, cleanOption, minStockOf, isLowStock, saleItemsOf, saleTotalOf, returnTotalOf, saleDateOf, returnDateOf, inPeriod, onEvent } from "../utils.js?v=20261104-1";
import { products, sales, saleReturns } from "../estado.js?v=20261106-5";

let dailySeries = [];

// ---------- Painel inicial (dashboard) ----------

// Data inicial do período de vendas (formato AAAA-MM-DD) ou null para "todo o período".
function getSalePeriodStart(period) {
  const now = new Date();
  if (period === "today") return toDateString(now);
  if (period === "week") {
    const start = new Date(now);
    start.setDate(start.getDate() - 6);
    return toDateString(start);
  }
  if (period === "month") return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-01`;
  return null;
}

// Produtos ativos com saldo igual ou abaixo do estoque mínimo definido pelo usuário.
function renderLowStock(activeProducts) {
  const container = $("#dash-low-stock");
  const withMinimum = activeProducts.filter((product) => minStockOf(product) !== null);
  if (!withMinimum.length) {
    container.innerHTML = '<div class="empty-state">Nenhum produto tem estoque mínimo definido.<br>Defina em Produtos → Editar para receber avisos aqui.</div>';
    return;
  }
  const low = withMinimum.filter(isLowStock).sort((a, b) => (
    ((Number(a.quantidade) || 0) - minStockOf(a)) - ((Number(b.quantidade) || 0) - minStockOf(b))
    || String(a.nome || "").localeCompare(String(b.nome || ""), "pt-BR")
  ));
  if (!low.length) {
    container.innerHTML = '<div class="dash-ok">Nenhum produto abaixo do estoque mínimo.</div>';
    return;
  }
  const shown = low.slice(0, 8);
  container.innerHTML = `<div class="low-list">${shown.map((product) => {
    const balance = Number(product.quantidade) || 0;
    return `<div class="low-row">
      <div class="low-main"><strong>${escapeHtml(product.nome)}</strong><small>Mínimo definido: ${minStockOf(product)} un.</small></div>
      <span class="low-badge${balance <= 0 ? " zero" : ""}">${balance <= 0 ? "Sem estoque" : `${balance} un.`}</span>
    </div>`;
  }).join("")}</div>${low.length > shown.length ? `<p class="low-more">+ ${low.length - shown.length} produto(s) abaixo do mínimo. Veja a lista completa em Produtos.</p>` : ""}`;
}

// Faturamento líquido por forma de pagamento (devoluções descontadas da forma usada na venda).
function renderPaymentBreakdown(countedSales, periodReturns) {
  const container = $("#dash-payments");
  const totals = new Map();
  const add = (name, value) => {
    const key = cleanOption(name) || "Não informado";
    totals.set(key, roundMoney((totals.get(key) || 0) + value));
  };
  countedSales.forEach((sale) => add(sale.formaPagamento, saleTotalOf(sale)));
  periodReturns.forEach((saleReturn) => {
    const sale = sales.find((item) => item.id === saleReturn.vendaId);
    add(sale?.formaPagamento, -returnTotalOf(saleReturn));
  });
  const rows = [...totals.entries()].filter(([, value]) => value !== 0).sort((a, b) => b[1] - a[1]);
  if (!rows.length) {
    container.innerHTML = '<div class="empty-state">Nenhuma venda no período.</div>';
    return;
  }
  const positiveSum = rows.reduce((sum, [, value]) => sum + Math.max(value, 0), 0);
  container.innerHTML = `<div class="bar-list">${rows.map(([name, value]) => {
    const share = positiveSum > 0 && value > 0 ? (value / positiveSum) * 100 : 0;
    return `<div class="bar-row">
      <div class="bar-head"><span>${escapeHtml(name)}${share ? ` · ${Math.round(share)}%` : ""}</span><strong>${money(value)}</strong></div>
      <div class="bar-track"><div class="bar-fill" style="width:${share.toFixed(1)}%"></div></div>
    </div>`;
  }).join("")}</div>`;
}

// Top 5 produtos por unidades líquidas (vendidas menos devolvidas) no período.
function renderTopProducts(countedSales, periodReturns) {
  const container = $("#dash-top-products");
  const map = new Map();
  const rowFor = (key, name) => {
    if (!map.has(key)) map.set(key, { name, units: 0, revenue: 0 });
    return map.get(key);
  };
  const subtotalOf = (item, quantity) => (typeof item.subtotal === "number"
    ? item.subtotal
    : roundMoney(quantity * (Number(item.precoUnitario) || 0)));
  countedSales.forEach((sale) => {
    saleItemsOf(sale).forEach((item) => {
      const name = item.produtoNome || item.nome || "Produto";
      const row = rowFor(item.produtoId || `nome:${normalizeText(name)}`, name);
      const quantity = Number(item.quantidade) || 0;
      row.units += quantity;
      row.revenue = roundMoney(row.revenue + subtotalOf(item, quantity));
    });
  });
  periodReturns.forEach((saleReturn) => {
    (Array.isArray(saleReturn.itens) ? saleReturn.itens : []).forEach((item) => {
      const name = item.produtoNome || "Produto";
      const row = rowFor(item.produtoId || `nome:${normalizeText(name)}`, name);
      const quantity = Number(item.quantidade) || 0;
      row.units -= quantity;
      row.revenue = roundMoney(row.revenue - subtotalOf(item, quantity));
    });
  });
  const ranking = [...map.values()].filter((row) => row.units > 0)
    .sort((a, b) => b.units - a.units || b.revenue - a.revenue)
    .slice(0, 5);
  if (!ranking.length) {
    container.innerHTML = '<div class="empty-state">Nenhuma venda no período.</div>';
    return;
  }
  container.innerHTML = `<ol class="rank-list">${ranking.map((row, index) => `
    <li class="rank-row">
      <span class="rank-pos">${index + 1}</span>
      <div class="rank-main"><strong>${escapeHtml(row.name)}</strong><small>${money(row.revenue)} no período</small></div>
      <span class="rank-units">${row.units} un.</span>
    </li>`).join("")}</ol>`;
}

// Gráfico de vendas líquidas por dia (últimos 7 ou 30 dias).
function renderDailyChart() {
  const chart = $("#dash-daily-chart");
  const detail = $("#dash-daily-detail");
  const days = Number($("#dashboard-daily-range").value) === 30 ? 30 : 7;
  const now = new Date();
  const dates = [];
  for (let offset = days - 1; offset >= 0; offset -= 1) {
    dates.push(toDateString(new Date(now.getFullYear(), now.getMonth(), now.getDate() - offset)));
  }
  const totals = new Map(dates.map((date) => [date, 0]));
  sales.filter((sale) => sale.status !== "cancelada").forEach((sale) => {
    const date = saleDateOf(sale);
    if (totals.has(date)) totals.set(date, roundMoney(totals.get(date) + saleTotalOf(sale)));
  });
  saleReturns.forEach((saleReturn) => {
    const date = returnDateOf(saleReturn);
    if (totals.has(date)) totals.set(date, roundMoney(totals.get(date) - returnTotalOf(saleReturn)));
  });
  dailySeries = dates.map((date) => ({ date, value: totals.get(date) }));
  if (dailySeries.every((item) => item.value === 0)) {
    chart.innerHTML = `<div class="empty-state">Nenhuma venda nos últimos ${days} dias.</div>`;
    detail.textContent = "";
    return;
  }
  const max = Math.max(...dailySeries.map((item) => item.value), 0);
  const total = roundMoney(dailySeries.reduce((sum, item) => sum + item.value, 0));
  const best = dailySeries.reduce((top, item) => (item.value > top.value ? item : top), dailySeries[0]);
  const bars = dailySeries.map((item, index) => {
    const height = max > 0 && item.value > 0 ? Math.max((item.value / max) * 100, 3) : 0;
    return `<button type="button" class="chart-bar-wrap" data-chart-index="${index}" aria-label="${escapeHtml(formatDate(item.date))}: ${escapeHtml(money(item.value))}"><span class="chart-bar" style="height:${height.toFixed(1)}%"></span></button>`;
  }).join("");
  const labels = dailySeries.map((item, index) => {
    const label = days === 7
      ? `${item.date.slice(8)}/${item.date.slice(5, 7)}`
      : (index % 5 === 0 || index === days - 1 ? item.date.slice(8) : "");
    return `<span>${label}</span>`;
  }).join("");
  chart.innerHTML = `<div class="chart-plot">${bars}</div><div class="chart-axis">${labels}</div>`;
  detail.textContent = `Total: ${money(total)} · Média por dia: ${money(roundMoney(total / days))} · Melhor dia: ${formatDate(best.date).slice(0, 5)} (${money(best.value)}). Toque em uma barra para ver o valor do dia.`;
}

// Todos os indicadores são calculados a partir dos registros reais carregados do Firestore.
// Vendas canceladas ficam fora do cálculo; devoluções são descontadas no período em que foram registradas.
function renderDashboard() {
  const activeProducts = products.filter((product) => !product.arquivado);
  const isEmpty = !activeProducts.length && !sales.length;
  $("#dashboard-empty").hidden = !isEmpty;
  $("#dashboard-stats").hidden = isEmpty;
  if (isEmpty) return;

  // Estoque atual (valor estimado pelo custo cadastrado vigente).
  const units = activeProducts.reduce((sum, product) => sum + (Number(product.quantidade) || 0), 0);
  const stockValue = roundMoney(activeProducts.reduce((sum, product) => (
    sum + roundMoney((Number(product.quantidade) || 0) * roundMoney(product.custo))
  ), 0));
  const zeroStock = activeProducts.filter((product) => (Number(product.quantidade) || 0) <= 0).length;
  $("#dash-products-count").textContent = String(activeProducts.length);
  $("#dash-units-count").textContent = `${units} ${units === 1 ? "unidade" : "unidades"} em estoque`;
  $("#dash-stock-value").textContent = money(stockValue);
  $("#dash-zero-stock").textContent = zeroStock === 0
    ? "Nenhum produto sem estoque."
    : `${zeroStock} ${zeroStock === 1 ? "produto está sem estoque." : "produtos estão sem estoque."}`;
  renderLowStock(activeProducts);

  // Vendas do período escolhido.
  const start = getSalePeriodStart($("#dashboard-period").value);
  const today = dateToday();
  const periodSales = sales.filter((sale) => inPeriod(saleDateOf(sale), start, today));
  const countedSales = periodSales.filter((sale) => sale.status !== "cancelada");
  const canceledCount = periodSales.length - countedSales.length;
  const periodReturns = saleReturns.filter((saleReturn) => inPeriod(returnDateOf(saleReturn), start, today));

  let revenue = 0;
  let grossDifference = 0;
  let salesWithoutCost = 0;
  let soldUnits = 0;
  countedSales.forEach((sale) => {
    const items = Array.isArray(sale.itens) ? sale.itens : [];
    revenue += saleTotalOf(sale);
    soldUnits += saleItemsOf(sale).reduce((sum, item) => sum + (Number(item.quantidade) || 0), 0);

    // Diferença bruta: só itens com o custo da época gravado na venda.
    let missingCost = !items.length;
    items.forEach((item) => {
      if (typeof item.custoUnitario === "number") {
        grossDifference += roundMoney((Number(item.quantidade) || 0) * ((Number(item.precoUnitario) || 0) - item.custoUnitario));
      } else {
        missingCost = true;
      }
    });
    if (missingCost) salesWithoutCost += 1;
  });

  // Devoluções registradas no período: reduzem faturamento, unidades e diferença bruta.
  let returnsTotal = 0;
  let returnsGross = 0;
  let returnedUnits = 0;
  periodReturns.forEach((saleReturn) => {
    returnsTotal += returnTotalOf(saleReturn);
    (Array.isArray(saleReturn.itens) ? saleReturn.itens : []).forEach((item) => {
      returnedUnits += Number(item.quantidade) || 0;
      if (typeof item.custoUnitario === "number") {
        returnsGross += roundMoney((Number(item.quantidade) || 0) * ((Number(item.precoUnitario) || 0) - item.custoUnitario));
      }
    });
  });

  const netRevenue = roundMoney(revenue - returnsTotal);
  $("#dash-revenue").textContent = money(netRevenue);
  const countParts = [`${countedSales.length} ${countedSales.length === 1 ? "venda registrada" : "vendas registradas"}`];
  if (canceledCount) countParts.push(`${canceledCount} ${canceledCount === 1 ? "cancelada (fora do cálculo)" : "canceladas (fora do cálculo)"}`);
  if (periodReturns.length) countParts.push(`devoluções: −${money(roundMoney(returnsTotal))}`);
  $("#dash-sales-count").textContent = countParts.join(" · ");
  $("#dash-gross").textContent = money(roundMoney(grossDifference - returnsGross));
  $("#dash-avg-ticket").textContent = countedSales.length ? money(roundMoney(netRevenue / countedSales.length)) : "—";
  $("#dash-units-sold").textContent = String(soldUnits - returnedUnits);
  $("#dash-units-sold-sub").textContent = returnedUnits
    ? `${soldUnits} vendidas − ${returnedUnits} devolvidas`
    : "Unidades vendidas no período";
  const note = $("#dash-gross-note");
  note.hidden = salesWithoutCost === 0;
  note.textContent = salesWithoutCost === 0
    ? ""
    : (salesWithoutCost === 1
      ? "1 venda sem custo registrado (feita antes desse registro existir) não entrou no cálculo da diferença bruta."
      : `${salesWithoutCost} vendas sem custo registrado (feitas antes desse registro existir) não entraram no cálculo da diferença bruta.`);

  renderPaymentBreakdown(countedSales, periodReturns);
  renderTopProducts(countedSales, periodReturns);
  renderDailyChart();
}

export function initPainelUI({ switchTab }) {
  onEvent("#dashboard-period", "change", renderDashboard);
  onEvent("#dashboard-daily-range", "change", renderDailyChart);
  onEvent("#dash-daily-chart", "click", (event) => {
    const bar = event.target.closest("[data-chart-index]");
    if (!bar) return;
    const item = dailySeries[Number(bar.dataset.chartIndex)];
    if (!item) return;
    document.querySelectorAll("#dash-daily-chart .chart-bar-wrap").forEach((element) => {
      element.classList.toggle("is-selected", element === bar);
    });
    $("#dash-daily-detail").textContent = `${formatDate(item.date)}: ${money(item.value)}`;
  });
  document.querySelectorAll("[data-shortcut]").forEach((button) => {
    button.addEventListener("click", () => switchTab(button.dataset.shortcut));
  });
}

export { renderDashboard };
