// busca-movimentacoes.js — busca de produto nas telas de Entradas e Saídas (lista de resultados,
// seleção do produto e resumo de fardo/custo da entrada).
// Só lê o estado compartilhado (estado.js) e atualiza a tela; não acessa o Firestore.
import { $, money, roundMoney, escapeHtml, normalizeText, packSizeOf, unitCostFromPack, fieldValue, parseDecimal, onEvent } from "../utils.js?v=20261104-1";
import { products, estadoUi } from "../estado.js?v=20261108-1";

// ---------- Entradas: busca de produto (nome, código ou leitor) ----------

export function selectedEntryProduct() {
  return products.find((product) => product.id === estadoUi.selectedEntryProductId && !product.arquivado) || null;
}

export function readEntryAmounts() {
  const product = selectedEntryProduct();
  const size = product ? packSizeOf(product) : 0;
  const mode = size && $("#entry-unit-mode").value === "pack" ? "pack" : "unit";
  const quantity = Number(fieldValue("#entry-quantity"));
  const costInput = parseDecimal(fieldValue("#entry-cost"));
  const quantityOk = Number.isInteger(quantity) && quantity >= 1;
  const costOk = Number.isFinite(costInput) && costInput >= 0;
  if (mode === "pack") {
    const packCost = costOk ? roundMoney(costInput) : null;
    return { mode, size, quantityOk, costOk, packs: quantityOk ? quantity : null, packCost,
      units: quantityOk ? quantity * size : null,
      unitCost: costOk ? unitCostFromPack(packCost, size) : null };
  }
  return { mode, size, quantityOk, costOk, packs: null, packCost: null,
    units: quantityOk ? quantity : null, unitCost: costOk ? roundMoney(costInput) : null };
}

function updateEntryPackUI() {
  const product = selectedEntryProduct();
  const size = product ? packSizeOf(product) : 0;
  const mode = size && $("#entry-unit-mode").value === "pack" ? "pack" : "unit";
  $("#entry-pack-box").hidden = !size;
  $("#entry-quantity-label").textContent = size
    ? (mode === "pack" ? "Quantidade de fardos recebidos *" : "Unidades avulsas recebidas *")
    : "Quantidade recebida *";
  $("#entry-cost-label").textContent = mode === "pack"
    ? "Custo do fardo nesta compra (R$) *"
    : "Custo unitário desta compra (R$) *";
  const amounts = readEntryAmounts();
  const summary = $("#entry-pack-summary");
  if (mode === "pack") {
    summary.textContent = amounts.units !== null
      ? `${amounts.packs} fardo(s) de ${size} un. = ${amounts.units} unidades${amounts.unitCost !== null ? ` · custo de cada unidade: ${money(amounts.unitCost)}` : ""}`
      : `Este produto vem em fardo de ${size} unidades. Informe quantos fardos chegaram e o custo do fardo.`;
    summary.hidden = false;
  } else { summary.textContent = ""; summary.hidden = true; }
  const compare = $("#entry-cost-compare");
  if (product && amounts.unitCost !== null && Math.abs(amounts.unitCost - roundMoney(product.custo)) >= 0.005) {
    compare.textContent = `Custo por unidade nesta compra: ${money(amounts.unitCost)}. Custo cadastrado: ${money(roundMoney(product.custo))}. O cadastro não muda sozinho; se quiser atualizar, use Editar em Produtos.`;
    compare.hidden = false;
  } else { compare.textContent = ""; compare.hidden = true; }
}

export function renderEntryProductResults() {
  const query = normalizeText($("#entry-product-search").value);
  const results = $("#entry-product-results");
  const selectedBox = $("#entry-selected-product");
  const selected = products.find((product) => product.id === estadoUi.selectedEntryProductId && !product.arquivado);
  if (!selected) estadoUi.selectedEntryProductId = "";
  updateEntryPackUI();
  if (selected) {
    const size = packSizeOf(selected);
    selectedBox.innerHTML = `<strong>${escapeHtml(selected.nome)}</strong><span>Saldo atual: ${Number(selected.quantidade) || 0} un.${size ? ` · fardo de ${size} un.` : ""}</span>`;
    selectedBox.hidden = false; results.innerHTML = ""; return;
  }
  selectedBox.hidden = true;
  if (!query) { results.innerHTML = '<div class="small muted">Digite o nome ou o código, ou leia o código de barras.</div>'; return; }
  const matches = products.filter((product) => !product.arquivado && [
    product.nome, product.codigoInterno, product.codigoBarras, product.marca, product.categoria
  ].some((value) => normalizeText(value).includes(query))).slice(0, 8);
  if (!matches.length) { results.innerHTML = '<div class="empty-state">Nenhum produto encontrado.</div>'; return; }
  results.innerHTML = matches.map((product) => `
    <button class="search-result" type="button" data-select-entry-product="${escapeHtml(product.id)}">
      <span><strong>${escapeHtml(product.nome)}</strong><small>${escapeHtml(product.codigoInterno || product.codigoBarras || "Sem código")}</small></span>
      <span class="search-result-stock">${Number(product.quantidade) || 0} un.</span>
    </button>`).join("");
}

export function renderExitProductResults() {
  const query = normalizeText($("#exit-product-search").value);
  const results = $("#exit-product-results");
  const selected = products.find((product) => product.id === estadoUi.selectedExitProductId && !product.arquivado);
  if (selected) {
    $("#exit-selected-product").innerHTML = `<strong>${escapeHtml(selected.nome)}</strong><span>Saldo disponível: ${Number(selected.quantidade) || 0} un.</span>`;
    $("#exit-selected-product").hidden = false;
  } else $("#exit-selected-product").hidden = true;
  if (!query) { results.innerHTML = '<div class="small muted">Digite o nome ou código do produto para pesquisar.</div>'; return; }
  const matches = products.filter((product) => !product.arquivado && [
    product.nome, product.codigoInterno, product.codigoBarras, product.marca, product.categoria
  ].some((value) => normalizeText(value).includes(query))).slice(0, 8);
  if (!matches.length) { results.innerHTML = '<div class="empty-state">Nenhum produto encontrado.</div>'; return; }
  results.innerHTML = matches.map((product) => `
    <button class="search-result" type="button" data-select-exit-product="${escapeHtml(product.id)}">
      <span><strong>${escapeHtml(product.nome)}</strong><small>${escapeHtml(product.codigoInterno || product.codigoBarras || "Sem código")}</small></span>
      <span class="search-result-stock">${Number(product.quantidade) || 0} un.</span>
    </button>`).join("");
}

export function initMovementSearchUI() {
  $("#entry-product-search").addEventListener("input", () => {
    estadoUi.selectedEntryProductId = ""; renderEntryProductResults();
  });
  $("#entry-quantity").addEventListener("input", updateEntryPackUI);
  $("#entry-cost").addEventListener("input", updateEntryPackUI);
  $("#entry-unit-mode").addEventListener("change", updateEntryPackUI);
  $("#entry-product-results").addEventListener("click", (event) => {
    const button = event.target.closest("[data-select-entry-product]");
    if (!button) return;
    const product = products.find((item) => item.id === button.dataset.selectEntryProduct && !item.arquivado);
    if (!product) return;
    estadoUi.selectedEntryProductId = product.id;
    $("#entry-product-search").value = product.nome;
    renderEntryProductResults(); $("#entry-quantity").focus();
  });
  onEvent("#exit-product-search", "input", () => {
    estadoUi.selectedExitProductId = ""; renderExitProductResults();
  });
  onEvent("#exit-product-results", "click", (event) => {
    const button = event.target.closest("[data-select-exit-product]");
    if (!button) return;
    const product = products.find((item) => item.id === button.dataset.selectExitProduct && !item.arquivado);
    if (!product) return;
    estadoUi.selectedExitProductId = product.id;
    $("#exit-product-search").value = product.nome;
    renderExitProductResults(); $("#exit-quantity").focus();
  });
}
