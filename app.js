import { auth, db, collection, doc } from "./js/firebase.js?v=20261104-1";
import { money, roundMoney, calcSuggestedPrice, getRegisteredSalePrice, dateToday, formatDate, escapeHtml, normalizeText, cleanOption, uniqueOptions, packSizeOf, unitCostFromPack, saleItemsOf, saleTotalOf, fieldValue, onEvent, parseDecimal, dateTimeFor, nowDateTime } from "./js/utils.js?v=20261104-1";
import { cancelSale, registerReturn } from "./js/devolucoes.js?v=20261105-1";
import { printSale, initCaixaUI, showSaleDone, resetCaixaUI } from "./cupom.js?v=20261102-1";
import { saveEntryTransaction, saveExitTransaction } from "./js/servicos/movimentacoes.js?v=20261106-1";
import { initMovementFormsUI } from "./js/ui/formularios-movimentacoes.js?v=20261106-22";
import { parseCountValue, describeCount, startInventory as startInventoryService, saveInventory as saveInventoryService, discardInventory as discardInventoryService, finishInventory as finishInventoryService, MAX_INVENTORY_ADJUSTMENTS } from "./js/servicos/vistoria.js?v=20261106-2";
import { cartItemPrice as saleCartItemPrice, cartItemSubtotal as saleCartItemSubtotal, cartTotal as saleCartTotal, cartHasInvalidPrice as saleCartHasInvalidPrice, finishSaleTransaction, registerLostDemand } from "./js/servicos/vendas.js?v=20261106-4";

import { storeSettings, products, entries, exits, sales, saleCart, brands, categories, inventoryHistory, saleReturns, replaceArray } from "./js/estado.js?v=20261106-5";
import { loadAppData } from "./js/dados.js?v=20261106-5";
import { initScanner } from "./js/ui/scanner.js?v=20261106-7";
import { initPainelUI, renderDashboard } from "./js/ui/painel.js?v=20261106-7";
import { renderProducts } from "./js/ui/produtos.js?v=20261106-8";
import { initProductCatalogUI, renderCatalogOptions } from "./js/ui/catalogo-produtos.js?v=20261106-19";
import { saveProductTransaction, deleteProductTransaction } from "./js/servicos/produtos.js?v=20261106-3";
import { initProductFormUI } from "./js/ui/formulario-produtos.js?v=20261106-20";
import { initSessionUI, switchTab } from "./js/ui/sessao.js?v=20261106-9";
import { renderSales, returnableRows } from "./js/ui/historico-vendas.js?v=20261106-19";
import { renderEntries, renderExits } from "./js/ui/movimentacoes.js?v=20261106-17";
import { initExportacaoUI } from "./js/ui/exportacao.js?v=20261106-12";
import { initConfiguracoesUI, renderStoreSettings } from "./js/ui/configuracoes.js?v=20261106-15";
import { initVistoriaUI } from "./js/ui/vistoria.js?v=20261106-14";
import { initCaixaTelaUI } from "./js/ui/caixa.js?v=20261106-18";



const CATALOG_OPTIONS_ID = "catalogo_opcoes_faydai";
const STORE_SETTINGS_ID = "configuracoes_faydai";
const INTERNAL_COUNTER_ID = "contador_codigo_interno_faydai";



let selectedExitProductId = "";
let selectedEntryProductId = "";
let selectedSaleProductId = "";

// Instante em que o primeiro item entrou no carrinho (para registrar a duração do atendimento).
let saleCartStartedAt = null;
// Idempotência da venda: ID gerado no cliente e reaproveitado enquanto o carrinho não mudar.
let saleAttempt = null; // { id, fingerprint }
let saleInFlight = false;


let showArchivedEntries = false;
let toastTimeout;

// Vistoria física

let activeVistoria = null;
let vistoriaDraft = {};
let vistoriaDraftOwner = null;
let vistoriaDirty = false;
let inventoryAvailable = true;
let inventoryLoadErrorShown = false;

// Cancelamentos e devoluções de venda

let saleReturnsAvailable = true;
let returnsLoadErrorShown = false;
let saleAction = null; // { mode: "cancel" | "return", saleId }

// Painel: série diária usada pelo gráfico de vendas por dia


const NEW_BRAND_VALUE = "__nova_marca__";
const NEW_CATEGORY_VALUE = "__nova_categoria__";

function showToast(message) {
  const toast = $("#toast");
  toast.textContent = message;
  toast.classList.add("show");
  clearTimeout(toastTimeout);
  toastTimeout = setTimeout(() => toast.classList.remove("show"), 2800);
}

function setFeedback(selector, message, isError = false) {
  const element = $(selector);
  element.textContent = message;
  element.classList.toggle("error", isError);
}

function explainError(error) {
  const code = error?.code || "";
  const messages = {
    "auth/invalid-credential": "E-mail ou senha incorretos.",
    "auth/invalid-email": "Confira o formato do e-mail.",
    "auth/user-disabled": "Esta conta está desativada no Firebase.",
    "auth/too-many-requests": "Muitas tentativas. Aguarde um pouco e tente novamente.",
    "auth/network-request-failed": "Falha de conexão. Confira sua internet.",
    "permission-denied": "O Firestore negou o acesso. Confira as regras publicadas e se o e-mail da conta está na lista autorizada.",
    "unavailable": "O Firebase está temporariamente indisponível. Tente novamente."
  };
  return messages[code] || (code.includes("permission-denied")
    ? "Acesso negado pelo Firestore. Confira as regras publicadas e se o e-mail da conta está na lista autorizada."
    : error?.message || "Ocorreu um erro inesperado.");
}

function showApp(isSignedIn) {
  // Só revela login ou sistema depois que o Firebase confirmar a sessão.
  $("#auth-loading-view").hidden = true;
  $("#login-view").hidden = isSignedIn;
  $("#app-view").hidden = !isSignedIn;
}


// Reserva o próximo código interno DENTRO da transação que salva o produto.
// A leitura do contador acontece junto com as demais leituras; a gravação do novo
// valor só é feita por reservation.commit(), na mesma transação que grava o produto.
// Assim o número só é consumido se o produto for realmente salvo (sem lacunas na sequência).

// ---------- Leitor de código de barras ----------
// O leitor "digita" o código e termina com Enter (alguns terminam com Tab).
// Funciona no Caixa, em Entradas, em Saídas, na Vistoria e no cadastro de produto.

// Som curto de confirmação (agudo) ou de erro (grave), gerado pelo navegador, sem arquivo de áudio.
initScanner({
  getProducts: () => products,
  getEditingProductId: () => getProductEditingId(),
  setSelectedExitProductId: (value) => { selectedExitProductId = value; },
  setSelectedEntryProductId: (value) => { selectedEntryProductId = value; },
  renderEntryProductResults,
  getInventoryCount: (productId) => vistoriaDraft[productId],
  setInventoryCount: (productId, value) => { vistoriaDraft[productId] = value; },
  markInventoryDirty: () => { vistoriaDirty = true; },
  parseInventoryCount: parseCountValue,
  addProductToSaleCart,
  renderSaleProductResults,
  renderExitProductResults,
  renderInventoryList,
  updateInventorySummary,
  setFeedback,
  showToast
});

initCaixaTelaUI({ renderSaleProductResults, addProductToSaleCart, setFeedback, renderSaleCart, updateCartRow, updateCartSummary, finishSale });
initVistoriaUI({
  startInventory, saveInventory, finishInventory, discardInventory, renderInventoryList,
  updateCount: (productId, value) => {
    vistoriaDraft[productId] = value;
    vistoriaDirty = true;
    updateInventoryRow(productId);
    updateInventorySummary();
  }
});
initExportacaoUI({ setFeedback, showToast, explainError, loadData });

initPainelUI({ switchTab });
initProductCatalogUI();
const { resetProductForm, isEditingProduct, getProductEditingId } = initProductFormUI({
  products, entries, exits, sales, saleReturns, brands, categories, storeSettings,
  saveProductTransaction, deleteProductTransaction, renderCatalogOptions,
  setFeedback, showToast, explainError, loadData, currentEmail: () => currentEmail()
});
initConfiguracoesUI({ setFeedback, showToast, explainError, renderProducts, renderEntryProductResults, isEditingProduct });
initSessionUI({
  setFeedback, explainError, showToast, initDateFields, resetProductForm, loadData,
  clearSessionState: () => {
    replaceArray(products); replaceArray(entries); replaceArray(exits); replaceArray(sales); replaceArray(saleReturns);
    replaceArray(saleCart);
    saleCartStartedAt = null; saleAttempt = null; saleInFlight = false;
    activeVistoria = null; replaceArray(inventoryHistory);
    vistoriaDraft = {}; vistoriaDraftOwner = null; vistoriaDirty = false;
    selectedEntryProductId = ""; selectedExitProductId = "";
  }
});

initMovementFormsUI({
  storeSettings, saveEntryTransaction, saveExitTransaction,
  selectedEntryProduct, readEntryAmounts,
  getSelectedExitProduct: () => products.find((item) => item.id === selectedExitProductId && !item.arquivado),
  setSelectedEntryProductId: (value) => { selectedEntryProductId = value; },
  setSelectedExitProductId: (value) => { selectedExitProductId = value; },
  currentEmail, initDateFields, loadData, setFeedback, showToast, explainError
});

// ---------- Entradas: busca de produto (nome, código ou leitor) ----------

function selectedEntryProduct() {
  return products.find((product) => product.id === selectedEntryProductId && !product.arquivado) || null;
}

// Lê os campos da entrada. Em fardo: "quantidade" = fardos e "custo" = custo do fardo; sem fardo: unidades e custo unitário.
// Devolve também o total em unidades e o custo de cada unidade (null quando o campo ainda não está válido).
function readEntryAmounts() {
  const product = selectedEntryProduct();
  const size = product ? packSizeOf(product) : 0;
  const mode = size && $("#entry-unit-mode").value === "pack" ? "pack" : "unit";
  const quantity = Number(fieldValue("#entry-quantity"));
  const costInput = parseDecimal(fieldValue("#entry-cost"));
  const quantityOk = Number.isInteger(quantity) && quantity >= 1;
  const costOk = Number.isFinite(costInput) && costInput >= 0;
  if (mode === "pack") {
    const packCost = costOk ? roundMoney(costInput) : null;
    return {
      mode, size, quantityOk, costOk,
      packs: quantityOk ? quantity : null,
      packCost,
      units: quantityOk ? quantity * size : null,
      unitCost: costOk ? unitCostFromPack(packCost, size) : null
    };
  }
  return {
    mode, size, quantityOk, costOk,
    packs: null,
    packCost: null,
    units: quantityOk ? quantity : null,
    unitCost: costOk ? roundMoney(costInput) : null
  };
}

// Ajusta rótulos e avisos da entrada conforme o produto escolhido (fardo ou não) e compara o custo com o cadastrado.
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
  } else {
    summary.textContent = "";
    summary.hidden = true;
  }

  const compare = $("#entry-cost-compare");
  if (product && amounts.unitCost !== null && Math.abs(amounts.unitCost - roundMoney(product.custo)) >= 0.005) {
    compare.textContent = `Custo por unidade nesta compra: ${money(amounts.unitCost)}. Custo cadastrado: ${money(roundMoney(product.custo))}. O cadastro não muda sozinho; se quiser atualizar, use Editar em Produtos.`;
    compare.hidden = false;
  } else {
    compare.textContent = "";
    compare.hidden = true;
  }
}

function renderEntryProductResults() {
  const query = normalizeText($("#entry-product-search").value);
  const results = $("#entry-product-results");
  const selectedBox = $("#entry-selected-product");
  const selected = products.find((product) => product.id === selectedEntryProductId && !product.arquivado);
  if (!selected) selectedEntryProductId = "";
  updateEntryPackUI();
  if (selected) {
    const size = packSizeOf(selected);
    selectedBox.innerHTML = `<strong>${escapeHtml(selected.nome)}</strong><span>Saldo atual: ${Number(selected.quantidade) || 0} un.${size ? ` · fardo de ${size} un.` : ""}</span>`;
    selectedBox.hidden = false;
    results.innerHTML = "";
    return;
  }
  selectedBox.hidden = true;
  if (!query) {
    results.innerHTML = '<div class="small muted">Digite o nome ou o código, ou leia o código de barras.</div>';
    return;
  }
  const matches = products.filter((product) => !product.arquivado && [
    product.nome, product.codigoInterno, product.codigoBarras, product.marca, product.categoria
  ].some((value) => normalizeText(value).includes(query))).slice(0, 8);
  if (!matches.length) {
    results.innerHTML = '<div class="empty-state">Nenhum produto encontrado.</div>';
    return;
  }
  results.innerHTML = matches.map((product) => `
    <button class="search-result" type="button" data-select-entry-product="${escapeHtml(product.id)}">
      <span><strong>${escapeHtml(product.nome)}</strong><small>${escapeHtml(product.codigoInterno || product.codigoBarras || "Sem código")}</small></span>
      <span class="search-result-stock">${Number(product.quantidade) || 0} un.</span>
    </button>`).join("");
}

$("#entry-product-search").addEventListener("input", () => {
  selectedEntryProductId = "";
  renderEntryProductResults();
});
$("#entry-quantity").addEventListener("input", updateEntryPackUI);
$("#entry-cost").addEventListener("input", updateEntryPackUI);
$("#entry-unit-mode").addEventListener("change", updateEntryPackUI);
$("#entry-product-results").addEventListener("click", (event) => {
  const button = event.target.closest("[data-select-entry-product]");
  if (!button) return;
  const product = products.find((item) => item.id === button.dataset.selectEntryProduct && !item.arquivado);
  if (!product) return;
  selectedEntryProductId = product.id;
  $("#entry-product-search").value = product.nome;
  renderEntryProductResults();
  $("#entry-quantity").focus();
});
// ---------- Caixa: carrinho com preço editável e alertas ----------

// Preço do item (0 quando o campo está vazio ou inválido), subtotal e total em centavos exatos.
const cartItemPrice = saleCartItemPrice;
const cartItemSubtotal = saleCartItemSubtotal;
const cartTotal = () => saleCartTotal(saleCart);
const cartHasInvalidPrice = () => saleCartHasInvalidPrice(saleCart);

// Alertas de preço: não bloqueiam a venda (exceto preço vazio/zero, que é erro de digitação).
function getPriceAlert(item) {
  const price = item.precoUnitario;
  if (!Number.isFinite(price) || price <= 0) {
    return { level: "invalid", message: "Informe um preço maior que zero." };
  }
  const product = products.find((entry) => entry.id === item.produtoId);
  if (!product) return null;
  if (price < roundMoney(product.custo)) {
    return { level: "danger", message: "Atenção: preço abaixo do custo cadastrado." };
  }
  const suggested = calcSuggestedPrice(product);
  if (price < suggested) {
    return { level: "warning", message: `Preço abaixo do sugerido (${money(suggested)}).` };
  }
  return null;
}

function renderSaleProductResults() {
  const query = normalizeText($("#sale-product-search").value);
  const results = $("#sale-product-results");
  if (!query) {
    results.innerHTML = '<div class="small muted">Digite o nome ou código para localizar um produto.</div>';
    return;
  }
  const matches = products.filter((product) => !product.arquivado && [
    product.nome, product.codigoInterno, product.codigoBarras, product.marca, product.categoria
  ].some((value) => normalizeText(value).includes(query))).slice(0, 8);
  if (!matches.length) {
    results.innerHTML = '<div class="empty-state">Nenhum produto encontrado.</div>';
    return;
  }
  results.innerHTML = matches.map((product) => {
    const price = getRegisteredSalePrice(product);
    return `
      <button class="search-result sale-search-result" type="button" data-select-sale-product="${escapeHtml(product.id)}">
        <span><strong>${escapeHtml(product.nome)}</strong><small>${escapeHtml(product.codigoInterno || product.codigoBarras || "Sem código")} · ${Number(product.quantidade) || 0} em estoque</small></span>
        <span class="sale-result-price">${money(price)}<small>por unidade</small></span>
      </button>`;
  }).join("");
}

function updateCartSummary() {
  const units = saleCart.reduce((sum, item) => sum + item.quantidade, 0);
  $("#sale-cart-total").textContent = money(cartTotal());
  $("#sale-cart-count").textContent = `${units} ${units === 1 ? "item" : "itens"}`;
  $("#sale-finish-button").disabled = saleCart.length === 0 || cartHasInvalidPrice();
  document.dispatchEvent(new CustomEvent("cart:changed", { detail: { total: cartTotal(), units } }));
}

// Atualiza só o subtotal e o alerta de uma linha (sem redesenhar, para não perder o foco do campo de preço).
function updateCartRow(index) {
  const item = saleCart[index];
  const row = document.querySelector(`[data-cart-row="${index}"]`);
  if (!item || !row) return;
  row.querySelector(".cart-subtotal").textContent = money(cartItemSubtotal(item));
  const alertElement = row.querySelector(".cart-price-alert");
  const alert = getPriceAlert(item);
  alertElement.hidden = !alert;
  alertElement.className = "cart-price-alert" + (alert ? ` ${alert.level}` : "");
  alertElement.textContent = alert ? alert.message : "";
}

function renderSaleCart() {
  const list = $("#sale-cart-list");
  // Carrinho vazio = atendimento zerado (a duração só conta a partir do primeiro item).
  if (!saleCart.length) saleCartStartedAt = null;
  if (!saleCart.length) {
    list.innerHTML = '<div class="empty-state">A compra está vazia. Pesquise e selecione os produtos acima.</div>';
  } else {
    list.innerHTML = saleCart.map((item, index) => {
      const alert = getPriceAlert(item);
      const priceValue = Number.isFinite(item.precoUnitario) ? item.precoUnitario.toFixed(2) : "";
      return `
      <article class="cart-item" data-cart-row="${index}">
        <div class="cart-item-main">
          <strong>${escapeHtml(item.nome)}</strong>
          <small>Preço cadastrado: ${money(item.precoCadastrado)}</small>
        </div>
        <div class="cart-price-row">
          <label for="cart-price-${index}">Preço cobrado (R$)</label>
          <input id="cart-price-${index}" class="cart-price-input" type="number" min="0.01" step="any" inputmode="decimal" value="${priceValue}" data-cart-price="${index}" required>
        </div>
        <p class="cart-price-alert${alert ? ` ${alert.level}` : ""}"${alert ? "" : " hidden"}>${alert ? escapeHtml(alert.message) : ""}</p>
        <div class="cart-item-bottom">
          <div class="cart-quantity">
            <button type="button" class="quantity-button" data-cart-minus="${index}" aria-label="Diminuir quantidade">−</button>
            <span>${item.quantidade}</span>
            <button type="button" class="quantity-button" data-cart-plus="${index}" aria-label="Aumentar quantidade">+</button>
          </div>
          <strong class="cart-subtotal">${money(cartItemSubtotal(item))}</strong>
          <button type="button" class="remove-cart-item" data-cart-remove="${index}" aria-label="Remover ${escapeHtml(item.nome)}">Remover</button>
        </div>
      </article>`;
    }).join("");
  }
  updateCartSummary();
}

// origin: "leitor" (código de barras lido) ou "busca" (nome digitado / item tocado na lista).
function addProductToSaleCart(product, origin = "busca") {
  if ((Number(product.quantidade) || 0) < 1) {
    setFeedback("#sale-feedback", "Este produto está sem saldo disponível.", true);
    return false;
  }
  const existing = saleCart.find((item) => item.produtoId === product.id);
  if (existing) {
    if (existing.quantidade + 1 > (Number(product.quantidade) || 0)) {
      setFeedback("#sale-feedback", `Saldo insuficiente. Disponível: ${Number(product.quantidade) || 0} unidade(s).`, true);
      return false;
    }
    existing.quantidade += 1;
  } else {
    if (!saleCart.length) saleCartStartedAt = Date.now();
    const registeredPrice = getRegisteredSalePrice(product);
    saleCart.push({
      produtoId: product.id,
      nome: product.nome || "",
      codigoInterno: product.codigoInterno || "",
      codigoBarras: product.codigoBarras || "",
      quantidade: 1,
      precoCadastrado: registeredPrice,
      precoUnitario: registeredPrice,
      origem: origin
    });
  }
  $("#sale-product-search").value = "";
  setFeedback("#sale-feedback", "");
  renderSaleProductResults();
  renderSaleCart();
  $("#sale-product-search").focus();
  return true;
}
// ---------- Histórico de vendas, cancelamentos e devoluções ----------

function openSaleAction(mode, saleId) {
  const sale = sales.find((item) => item.id === saleId);
  if (!sale) return;
  saleAction = { mode, saleId };
  $("#sale-action-reason").value = "";
  setFeedback("#sale-action-feedback", "");
  const box = $("#sale-action-items");
  const totalBox = $("#sale-action-total");
  const dateText = formatDate(sale.dataHora || sale.data) || "data não informada";
  if (mode === "cancel") {
    $("#sale-action-eyebrow").textContent = "CANCELAMENTO";
    $("#sale-action-title").textContent = "Cancelar venda";
    $("#sale-action-summary").textContent = `Venda de ${dateText} · Total ${money(saleTotalOf(sale))}. Todas as unidades voltam ao estoque e a venda sai dos indicadores. Isso não pode ser desfeito.`;
    box.innerHTML = saleItemsOf(sale).map((item) => `
      <div class="return-row"><div class="return-row-main">
        <strong>${escapeHtml(item.produtoNome || "Produto")}</strong>
        <small>${Number(item.quantidade) || 0} × ${money(item.precoUnitario)} voltam ao estoque</small>
      </div></div>`).join("");
    totalBox.hidden = true;
    $("#sale-action-confirm").textContent = "Cancelar venda";
  } else {
    $("#sale-action-eyebrow").textContent = "DEVOLUÇÃO";
    $("#sale-action-title").textContent = "Devolver itens";
    $("#sale-action-summary").textContent = `Venda de ${dateText} · Total ${money(saleTotalOf(sale))}. Informe quantas unidades de cada item voltam ao estoque.`;
    box.innerHTML = returnableRows(sale).filter((row) => row.available > 0).map((row) => `
      <div class="return-row">
        <div class="return-row-main">
          <strong>${escapeHtml(row.item.produtoNome || "Produto")}</strong>
          <small>${row.sold} vendido(s) a ${money(row.item.precoUnitario)}${row.returned ? ` · já devolvido: ${row.returned}` : ""} · pode devolver até ${row.available}</small>
        </div>
        <input class="return-qty-input" type="number" min="0" max="${row.available}" step="1" inputmode="numeric" placeholder="0" data-return-index="${row.index}" data-return-max="${row.available}" aria-label="Quantidade a devolver de ${escapeHtml(row.item.produtoNome || "produto")}, máximo ${row.available}">
      </div>`).join("");
    totalBox.hidden = false;
    totalBox.textContent = `Total a devolver: ${money(0)}`;
    $("#sale-action-confirm").textContent = "Registrar devolução";
  }
  $("#sale-action-overlay").hidden = false;
}

function closeSaleAction() {
  saleAction = null;
  $("#sale-action-overlay").hidden = true;
}

function updateReturnTotal() {
  if (!saleAction || saleAction.mode !== "return") return;
  const sale = sales.find((item) => item.id === saleAction.saleId);
  if (!sale) return;
  const items = saleItemsOf(sale);
  let total = 0;
  document.querySelectorAll("#sale-action-items [data-return-index]").forEach((input) => {
    const quantity = Number(input.value);
    const item = items[Number(input.dataset.returnIndex)];
    if (item && Number.isInteger(quantity) && quantity > 0) {
      total += roundMoney(quantity * (Number(item.precoUnitario) || 0));
    }
  });
  $("#sale-action-total").textContent = `Total a devolver: ${money(roundMoney(total))}`;
}

function renderExitProductResults() {
  const query = normalizeText($("#exit-product-search").value);
  const results = $("#exit-product-results");
  const selected = products.find((product) => product.id === selectedExitProductId && !product.arquivado);
  if (selected) {
    $("#exit-selected-product").innerHTML = `<strong>${escapeHtml(selected.nome)}</strong><span>Saldo disponível: ${Number(selected.quantidade) || 0} un.</span>`;
    $("#exit-selected-product").hidden = false;
  } else $("#exit-selected-product").hidden = true;
  if (!query) {
    results.innerHTML = '<div class="small muted">Digite o nome ou código do produto para pesquisar.</div>';
    return;
  }
  const matches = products.filter((product) => !product.arquivado && [
    product.nome, product.codigoInterno, product.codigoBarras, product.marca, product.categoria
  ].some((value) => normalizeText(value).includes(query))).slice(0, 8);
  if (!matches.length) {
    results.innerHTML = '<div class="empty-state">Nenhum produto encontrado.</div>';
    return;
  }
  results.innerHTML = matches.map((product) => `
    <button class="search-result" type="button" data-select-exit-product="${escapeHtml(product.id)}">
      <span><strong>${escapeHtml(product.nome)}</strong><small>${escapeHtml(product.codigoInterno || product.codigoBarras || "Sem código")}</small></span>
      <span class="search-result-stock">${Number(product.quantidade) || 0} un.</span>
    </button>`).join("");
}

// ---------- Vistoria física ----------

// Campo vazio = não contado (saldo mantido). "0" = contado, sem nenhuma unidade.
// Mantém o rascunho digitado: só recarrega das contagens salvas quando a vistoria mudou
// ou quando não há alterações pendentes.
function syncInventoryDraft() {
  const id = activeVistoria?.id || null;
  if (id !== vistoriaDraftOwner) {
    vistoriaDraftOwner = id;
    vistoriaDirty = false;
    vistoriaDraft = {};
    Object.entries(activeVistoria?.contagens || {}).forEach(([productId, value]) => {
      vistoriaDraft[productId] = String(value);
    });
  } else if (!vistoriaDirty) {
    vistoriaDraft = {};
    Object.entries(activeVistoria?.contagens || {}).forEach(([productId, value]) => {
      vistoriaDraft[productId] = String(value);
    });
  }
}

function inventoryCounts() {
  const activeProducts = products.filter((product) => !product.arquivado);
  let counted = 0;
  let withDiff = 0;
  activeProducts.forEach((product) => {
    const parsed = parseCountValue(vistoriaDraft[product.id]);
    if (parsed.state === "counted") {
      counted += 1;
      if (parsed.value !== (Number(product.quantidade) || 0)) withDiff += 1;
    }
  });
  return { total: activeProducts.length, counted, uncounted: activeProducts.length - counted, withDiff };
}

function updateInventorySummary() {
  const counts = inventoryCounts();
  $("#inventory-summary").innerHTML = `Contados: <strong>${counts.counted}</strong> de ${counts.total} · Não contados: <strong>${counts.uncounted}</strong> · Com diferença: <strong>${counts.withDiff}</strong>`;
  $("#inventory-dirty").hidden = !vistoriaDirty;
}

function updateInventoryRow(productId) {
  const product = products.find((item) => item.id === productId);
  const row = document.querySelector(`[data-count-row="${CSS.escape(productId)}"]`);
  if (!product || !row) return;
  const info = describeCount(product, vistoriaDraft[productId]);
  const diffElement = row.querySelector(".count-diff");
  diffElement.textContent = info.text;
  diffElement.className = `count-diff ${info.cls}`;
  row.classList.toggle("is-counted", info.counted);
}

function renderInventoryList() {
  const list = $("#inventory-list");
  const queryText = normalizeText($("#inventory-search").value);
  const onlyUncounted = $("#inventory-only-uncounted").checked;
  const activeProducts = products.filter((product) => !product.arquivado)
    .sort((a, b) => a.nome.localeCompare(b.nome, "pt-BR"));
  if (!activeProducts.length) {
    list.innerHTML = '<div class="empty-state">Nenhum produto ativo para contar.</div>';
    return;
  }
  const visible = activeProducts.filter((product) => {
    if (queryText && ![product.nome, product.codigoInterno, product.codigoBarras, product.marca, product.categoria]
      .some((value) => normalizeText(value).includes(queryText))) return false;
    if (onlyUncounted && parseCountValue(vistoriaDraft[product.id]).state === "counted") return false;
    return true;
  });
  if (!visible.length) {
    list.innerHTML = '<div class="empty-state">Nenhum produto para mostrar com esse filtro.</div>';
    return;
  }
  list.innerHTML = visible.map((product) => {
    const raw = vistoriaDraft[product.id] ?? "";
    const info = describeCount(product, raw);
    return `<article class="count-row${info.counted ? " is-counted" : ""}" data-count-row="${escapeHtml(product.id)}">
      <div class="count-main">
        <strong>${escapeHtml(product.nome)}</strong>
        <small>${escapeHtml(product.codigoInterno || product.codigoBarras || "Sem código")} · Saldo no sistema: ${Number(product.quantidade) || 0}</small>
      </div>
      <div class="count-input-wrap">
        <input class="count-input" type="number" min="0" step="1" inputmode="numeric" placeholder="—" value="${escapeHtml(raw)}" data-count-input="${escapeHtml(product.id)}" aria-label="Quantidade contada de ${escapeHtml(product.nome)}">
        <span class="count-diff ${info.cls}">${escapeHtml(info.text)}</span>
      </div>
    </article>`;
  }).join("");
}

function renderInventoryHistory() {
  const list = $("#inventory-history");
  if (!inventoryHistory.length) {
    list.innerHTML = '<div class="empty-state">Nenhuma vistoria concluída ainda.</div>';
    return;
  }
  list.innerHTML = inventoryHistory.map((vistoria) => {
    const items = Array.isArray(vistoria.itens) ? vistoria.itens : [];
    const adjusted = items.filter((item) => item.diferenca !== 0);
    const notCounted = Array.isArray(vistoria.naoContados) ? vistoria.naoContados : [];
    const ignored = Array.isArray(vistoria.ignorados) ? vistoria.ignorados : [];
    const adjustedLines = adjusted.length
      ? `<ul>${adjusted.map((item) => `<li>${escapeHtml(item.produtoNome || "Produto")} — saldo ${Number(item.saldoAnterior) || 0} → ${Number(item.contado) || 0} (${item.diferenca > 0 ? "+" : ""}${item.diferenca})</li>`).join("")}</ul>`
      : "<p>Nenhum ajuste de saldo.</p>";
    const notCountedLines = notCounted.length
      ? `<ul>${notCounted.map((item) => `<li>${escapeHtml(item.produtoNome || "Produto")} — saldo mantido: ${Number(item.saldo) || 0}</li>`).join("")}</ul>`
      : "<p>Todos os produtos foram contados.</p>";
    const ignoredBlock = ignored.length
      ? `<h4>Ignorados</h4><ul>${ignored.map((item) => `<li>${escapeHtml(item.produtoNome || "Produto")} — ${escapeHtml(item.motivo || "")}</li>`).join("")}</ul>`
      : "";
    return `<article class="entry-card">
      <div class="item-title-row"><div class="item-title">Vistoria de ${escapeHtml(formatDate(vistoria.dataHora || vistoria.data) || "data não informada")}</div><span class="stock-badge">${items.length} contado(s)</span></div>
      <p>Responsável: ${escapeHtml(vistoria.concluidaPor || "Não identificado")} · ${adjusted.length} ajustado(s) · ${notCounted.length} não contado(s)</p>
      <details class="inventory-details">
        <summary>Ver detalhes</summary>
        <h4>Ajustes de saldo</h4>
        ${adjustedLines}
        <h4>Não contados (saldo mantido)</h4>
        ${notCountedLines}
        ${ignoredBlock}
      </details>
    </article>`;
  }).join("");
}

function renderInventory() {
  const hasActive = Boolean(activeVistoria);
  $("#inventory-idle").hidden = hasActive;
  $("#inventory-active").hidden = !hasActive;
  $("#inventory-start").disabled = !inventoryAvailable;
  if (hasActive) {
    const savedAt = activeVistoria.atualizadoEmMs
      ? new Date(activeVistoria.atualizadoEmMs).toLocaleString("pt-BR", { dateStyle: "short", timeStyle: "short" })
      : "";
    $("#inventory-meta").textContent = `Iniciada em ${formatDate(activeVistoria.data)} por ${activeVistoria.criadoPor || "usuário não identificado"}.${savedAt ? ` Último salvamento: ${savedAt}.` : ""}`;
    renderInventoryList();
    updateInventorySummary();
  }
  renderInventoryHistory();
}

// Contagens válidas dos produtos ativos (ignora chaves de produtos que não existem mais).
function buildInventoryCounts() {
  const activeIds = new Set(products.filter((product) => !product.arquivado).map((product) => product.id));
  const counts = {};
  let hasInvalid = false;
  Object.entries(vistoriaDraft).forEach(([productId, raw]) => {
    if (!activeIds.has(productId)) return;
    const parsed = parseCountValue(raw);
    if (parsed.state === "invalid") hasInvalid = true;
    else if (parsed.state === "counted") counts[productId] = parsed.value;
  });
  return { counts, hasInvalid };
}

async function startInventory() {
  const button = $("#inventory-start");
  button.disabled = true;
  setFeedback("#inventory-feedback", "Iniciando vistoria…");
  try {
    await loadData();
    if (activeVistoria) {
      setFeedback("#inventory-feedback", "Já existe uma vistoria em andamento.", true);
      return;
    }
    const email = auth.currentUser?.email || null;
    await startInventoryService({ date: dateToday(), userEmail: email });
    await loadData();
    setFeedback("#inventory-feedback", "Vistoria iniciada. Preencha as quantidades contadas.");
  } catch (error) {
    console.error("Falha ao iniciar vistoria:", error);
    setFeedback("#inventory-feedback", explainError(error), true);
  } finally {
    button.disabled = !inventoryAvailable;
  }
}

async function saveInventory() {
  if (!activeVistoria) return;
  const button = $("#inventory-save");
  const { counts, hasInvalid } = buildInventoryCounts();
  if (hasInvalid) {
    setFeedback("#inventory-feedback", "Há valores inválidos na contagem. Use números inteiros, 0 ou maiores.", true);
    return;
  }
  button.disabled = true;
  setFeedback("#inventory-feedback", "Salvando andamento…");
  try {
    await saveInventoryService({
      inventoryId: activeVistoria.id,
      counts,
      userEmail: auth.currentUser?.email || null
    });
    vistoriaDirty = false;
    await loadData();
    setFeedback("#inventory-feedback", `Andamento salvo (${Object.keys(counts).length} produto(s) contado(s)).`);
    showToast("Andamento da vistoria salvo.");
  } catch (error) {
    console.error("Falha ao salvar vistoria:", error);
    setFeedback("#inventory-feedback", explainError(error), true);
  } finally {
    button.disabled = false;
  }
}

async function discardInventory() {
  if (!activeVistoria) return;
  const confirmed = window.confirm("Descartar a vistoria em andamento?\n\nTodas as contagens (salvas ou não) serão perdidas. Nenhum saldo será alterado.");
  if (!confirmed) return;
  const button = $("#inventory-discard");
  button.disabled = true;
  try {
    await discardInventoryService({ inventoryId: activeVistoria.id });
    vistoriaDirty = false;
    await loadData();
    setFeedback("#inventory-feedback", "Vistoria descartada. Nenhum saldo foi alterado.");
  } catch (error) {
    console.error("Falha ao descartar vistoria:", error);
    setFeedback("#inventory-feedback", explainError(error), true);
  } finally {
    button.disabled = false;
  }
}

async function finishInventory() {
  if (!activeVistoria) return;
  const button = $("#inventory-finish");
  button.disabled = true;
  setFeedback("#inventory-feedback", "Conferindo os saldos atuais…");
  try {
    if (Object.values(vistoriaDraft).some((raw) => parseCountValue(raw).state === "invalid")) {
      throw new Error("Há valores inválidos na contagem. Use números inteiros, 0 ou maiores.");
    }
    // Recarrega os saldos antes da confirmação; o serviço relê os saldos definitivos na transação.
    await loadData();
    if (!activeVistoria) throw new Error("A vistoria não está mais em andamento. Atualize a página.");

    const { counts } = buildInventoryCounts();
    const activeProducts = products.filter((product) => !product.arquivado);
    const counted = activeProducts.filter((product) => Object.prototype.hasOwnProperty.call(counts, product.id));
    const uncountedCount = activeProducts.length - counted.length;
    if (!counted.length) throw new Error("Informe a contagem de pelo menos um produto antes de concluir.");
    const withDiff = counted.filter((product) => counts[product.id] !== (Number(product.quantidade) || 0)).length;
    if (withDiff > MAX_INVENTORY_ADJUSTMENTS) {
      throw new Error(`Há ${withDiff} produtos com diferença. O limite é ${MAX_INVENTORY_ADJUSTMENTS} por vistoria: deixe alguns produtos em branco (não contados) e conclua; depois faça outra vistoria com o restante.`);
    }

    const confirmed = window.confirm(
      `Concluir a vistoria?\n\n• ${counted.length} produto(s) contado(s)\n• ${withDiff} com diferença: o saldo será ajustado para a quantidade contada\n• ${uncountedCount} NÃO contado(s): mantêm o saldo atual\n\nA conclusão não pode ser desfeita.`
    );
    if (!confirmed) {
      setFeedback("#inventory-feedback", "");
      return;
    }

    setFeedback("#inventory-feedback", "Concluindo vistoria…");
    const email = auth.currentUser?.email || "Usuário não identificado";
    const date = dateToday();
    const dateTime = `${date} ${new Date().toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" })}`;
    const result = await finishInventoryService({
      inventoryId: activeVistoria.id,
      counts,
      activeProducts,
      date,
      dateTime,
      userEmail: email
    });

    vistoriaDirty = false;
    await loadData();
    const message = `Vistoria concluída: ${result.contados} produto(s) contado(s), ${result.ajustados} com saldo ajustado${result.ignorados ? `, ${result.ignorados} ignorado(s) (arquivado ou removido)` : ""}.`;
    setFeedback("#inventory-feedback", message);
    showToast("Vistoria concluída.");
  } catch (error) {
    console.error("Falha ao concluir vistoria:", error);
    setFeedback("#inventory-feedback", explainError(error), true);
  } finally {
    button.disabled = false;
  }
}

const currentEmail = () => auth.currentUser?.email || "Usuário não identificado";

// Preenche os campos de data (entrada, venda, saída) com a data de hoje quando estiverem vazios.
function initDateFields(force = false) {
  ["#entry-date", "#sale-date", "#exit-date"].forEach((selector) => {
    const input = document.querySelector(selector);
    if (input && (force || !input.value)) input.value = dateToday();
  });
}

// ---------- Carregamento de dados do Firestore ----------

function renderAll() {
  renderCatalogOptions(brands, categories);
  renderStoreSettings(isEditingProduct());
  renderProducts(renderEntryProductResults);
  renderEntries(showArchivedEntries);
  renderExits();
  renderExitProductResults();
  renderSaleProductResults();
  renderSaleCart();
  renderSales(saleReturnsAvailable);
  syncInventoryDraft();
  renderInventory();
  renderDashboard();
}

async function loadData() {
  const data = await loadAppData();
  replaceArray(products, data.products);
  replaceArray(entries, data.entries);
  replaceArray(exits, data.exits);
  replaceArray(sales, data.sales);
  replaceArray(saleReturns, data.saleReturns);
  replaceArray(inventoryHistory, data.inventoryHistory);
  Object.assign(storeSettings, data.storeSettingsData || {});
  replaceArray(brands, uniqueOptions([...(data.catalogData.marcas || []), ...products.map((product) => product.marca)]));
  replaceArray(categories, uniqueOptions([...(data.catalogData.categorias || []), ...products.map((product) => product.categoria)]));
  saleReturnsAvailable = data.saleReturnsAvailable;
  activeVistoria = data.activeVistoria;
  inventoryAvailable = data.inventoryAvailable;

  if (data.returnsError) {
    console.error("Falha ao carregar devoluções:", data.returnsError);
    if (!returnsLoadErrorShown) {
      returnsLoadErrorShown = true;
      showToast("Devoluções indisponíveis: publique as regras do Firestore.");
    }
  }
  if (data.inventoryError) {
    console.error("Falha ao carregar vistorias:", data.inventoryError);
    if (!inventoryLoadErrorShown) {
      inventoryLoadErrorShown = true;
      showToast("Vistoria indisponível: publique as regras do Firestore.");
    }
  }
  renderAll();
}

// Botões "Atualizar" de cada aba.
["#refresh-products", "#refresh-entries", "#refresh-sales", "#refresh-exits", "#refresh-inventory"].forEach((selector) => {
  onEvent(selector, "click", async () => {
    try {
      await loadData();
      showToast("Dados atualizados.");
    } catch (error) {
      console.error("Falha ao atualizar:", error);
      showToast(explainError(error));
    }
  });
});

onEvent("#show-archived-entries", "change", (event) => {
  showArchivedEntries = event.target.checked;
  renderEntries();
});



// ---------- Caixa: busca, carrinho e finalização ----------

async function finishSale(event) {
  event.preventDefault();
  // Trava de clique duplo: enquanto uma gravação está em andamento, novos envios são ignorados.
  if (saleInFlight) return;
  if (!storeSettings.caixaAtivo) return setFeedback("#sale-feedback", "O módulo Caixa está desativado.", true);
  if (!saleCart.length) return setFeedback("#sale-feedback", "Adicione pelo menos um produto.", true);
  if (cartHasInvalidPrice()) return setFeedback("#sale-feedback", "Há item com preço vazio ou zero.", true);
  const formaPagamento = fieldValue("#sale-payment-method");
  if (!formaPagamento) return setFeedback("#sale-feedback", "Selecione a forma de pagamento.", true);
  const date = fieldValue("#sale-date") || dateToday();

  const belowCost = saleCart.filter((item) => {
    const product = products.find((entry) => entry.id === item.produtoId);
    return product && item.precoUnitario < roundMoney(product.custo);
  });
  if (belowCost.length && !window.confirm(
    `Atenção: ${belowCost.length} item(ns) com preço ABAIXO do custo:\n\n${belowCost.map((item) => `• ${item.nome}`).join("\n")}\n\nFinalizar mesmo assim?`
  )) return;

  const cartSnapshot = saleCart.map((item) => ({ ...item }));

  // Dados de contexto da venda (sem identificar o cliente): hora, dia da semana, duração do atendimento.
  const clock = new Date();
  const saleHour = clock.getHours();
  const saleWeekday = new Date(`${date}T12:00:00`).getDay();
  const durationSeconds = saleCartStartedAt ? Math.max(0, Math.round((Date.now() - saleCartStartedAt) / 1000)) : null;
  const retroactive = date !== dateToday();

  // Idempotência: o ID da venda é gerado no cliente ANTES da transação e só muda quando o conteúdo
  // da venda muda. Se a resposta da rede se perder e o usuário tentar de novo, o mesmo ID é reutilizado
  // e a transação detecta que a venda já foi gravada, em vez de criar outra.
  const fingerprint = JSON.stringify({
    formaPagamento,
    date,
    itens: cartSnapshot.map((item) => [item.produtoId, item.quantidade, item.precoUnitario])
  });
  if (!saleAttempt || saleAttempt.fingerprint !== fingerprint) {
    saleAttempt = { id: doc(collection(db, "vendas")).id, fingerprint };
  }
  const saleRef = doc(db, "vendas", saleAttempt.id);

  // Dinheiro: valor recebido e troco (opcionais).
  const cashRaw = parseDecimal(fieldValue("#sale-cash-received"));
  const valorRecebido = formaPagamento === "Dinheiro" && Number.isFinite(cashRaw) && cashRaw > 0 ? roundMoney(cashRaw) : null;
  if (valorRecebido !== null && valorRecebido < cartTotal()) {
    return setFeedback("#sale-feedback", "O valor recebido é menor que o total da compra.", true);
  }
  const troco = valorRecebido !== null ? roundMoney(valorRecebido - cartTotal()) : null;

  saleInFlight = true;
  const button = $("#sale-finish-button");
  button.disabled = true;
  setFeedback("#sale-feedback", "Registrando venda…");
  try {
    const { alreadySaved } = await finishSaleTransaction({
      saleId: saleAttempt.id,
      cartSnapshot,
      formaPagamento,
      date,
      userEmail: currentEmail(),
      saleHour,
      saleWeekday,
      durationSeconds,
      retroactive,
      valorRecebido,
      troco,
      dateTime: dateTimeFor(date)
    });
    const savedItems = cartSnapshot.map((item) => ({
      produtoNome: item.nome, quantidade: item.quantidade, precoUnitario: item.precoUnitario,
      subtotal: roundMoney(item.quantidade * item.precoUnitario)
    }));
    const savedSale = {
      id: saleAttempt.id, itens: savedItems,
      total: roundMoney(savedItems.reduce((sum, item) => sum + item.subtotal, 0)),
      formaPagamento, data: date, dataHora: dateTimeFor(date), usuario: currentEmail(),
      ...(valorRecebido !== null ? { valorRecebido, troco } : {})
    };
    saleAttempt = null;
    replaceArray(saleCart);
    saleCartStartedAt = null;
    $("#sale-payment-method").value = "";
    resetCaixaUI();
    initDateFields(true);
    renderSaleCart();
    await loadData();
    if (!alreadySaved) showSaleDone(savedSale, storeSettings);
    const message = alreadySaved
      ? "Esta venda já estava registrada (o envio anterior foi confirmado). Nada foi duplicado."
      : "Venda registrada.";
    setFeedback("#sale-feedback", message);
    showToast(alreadySaved ? "Venda já registrada." : "Venda registrada.");
  } catch (error) {
    console.error("Falha ao registrar venda:", error);
    setFeedback("#sale-feedback", explainError(error), true);
  } finally {
    saleInFlight = false;
    updateCartSummary();
  }
}

initCaixaUI(() => storeSettings);

// ---------- Caixa: "Cliente pediu e não tinha" ----------
// Guarda só o texto do pedido e o momento (sem nenhum dado do cliente).

onEvent("#lost-demand-button", "click", async () => {
  const text = cleanOption(fieldValue("#lost-demand-text"));
  if (!text) return setFeedback("#lost-demand-feedback", "Digite o que o cliente pediu.", true);
  const button = $("#lost-demand-button");
  button.disabled = true;
  setFeedback("#lost-demand-feedback", "Registrando…");
  try {
    const now = new Date();
    await registerLostDemand({
      description: text,
      date: dateToday(),
      dateTime: nowDateTime(),
      hour: now.getHours(),
      weekday: now.getDay(),
      userEmail: currentEmail()
    });
    $("#lost-demand-text").value = "";
    setFeedback("#lost-demand-feedback", "Procura registrada.");
    showToast("Procura registrada.");
  } catch (error) {
    console.error("Falha ao registrar procura sem estoque:", error);
    const denied = String(error?.code || "").includes("permission-denied");
    setFeedback("#lost-demand-feedback", denied
      ? "Não foi possível registrar: publique a regra da coleção procura_perdida no Firestore."
      : explainError(error), true);
  } finally {
    button.disabled = false;
  }
});

// ---------- Histórico de vendas: cancelar, devolver e reimprimir ----------

onEvent("#sales-list", "click", (event) => {
  const printButton = event.target.closest("[data-sale-print]");
  if (printButton) {
    const toPrint = sales.find((item) => item.id === printButton.dataset.salePrint);
    if (toPrint) printSale(toPrint, storeSettings);
    return;
  }
  const returnButton = event.target.closest("[data-sale-return]");
  if (returnButton) return openSaleAction("return", returnButton.dataset.saleReturn);
  const cancelButton = event.target.closest("[data-sale-cancel]");
  if (cancelButton) openSaleAction("cancel", cancelButton.dataset.saleCancel);
});

onEvent("#sale-action-close", "click", closeSaleAction);
onEvent("#sale-action-items", "input", updateReturnTotal);

onEvent("#sale-action-form", "submit", async (event) => {
  event.preventDefault();
  if (!saleAction) return;
  const sale = sales.find((item) => item.id === saleAction.saleId);
  if (!sale) return setFeedback("#sale-action-feedback", "Venda não encontrada. Atualize a lista.", true);
  const reason = fieldValue("#sale-action-reason").trim();
  if (!reason) return setFeedback("#sale-action-feedback", "Informe o motivo.", true);

  const button = $("#sale-action-confirm");
  button.disabled = true;
  setFeedback("#sale-action-feedback", "Salvando…");
  try {
    if (saleAction.mode === "cancel") {
      await cancelSale(sale, reason);
      showToast("Venda cancelada.");
    } else {
      const requested = [];
      let invalid = false;
      document.querySelectorAll("#sale-action-items [data-return-index]").forEach((input) => {
        if (String(input.value).trim() === "") return;
        const quantity = Number(input.value);
        if (!Number.isInteger(quantity) || quantity < 0 || quantity > Number(input.dataset.returnMax)) invalid = true;
        else if (quantity > 0) requested.push({ index: Number(input.dataset.returnIndex), quantidade: quantity });
      });
      if (invalid) throw new Error("Quantidade inválida. Use números inteiros até o máximo permitido.");
      if (!requested.length) throw new Error("Informe a quantidade de pelo menos um item.");
      const total = await registerReturn(sale, requested, reason);
      showToast(`Devolução registrada: ${money(total)}.`);
    }
    closeSaleAction();
    await loadData();
  } catch (error) {
    console.error("Falha na operação da venda:", error);
    setFeedback("#sale-action-feedback", explainError(error), true);
  } finally {
    button.disabled = false;
  }
});

// ---------- Saídas ----------

onEvent("#exit-product-search", "input", () => {
  selectedExitProductId = "";
  renderExitProductResults();
});

onEvent("#exit-product-results", "click", (event) => {
  const button = event.target.closest("[data-select-exit-product]");
  if (!button) return;
  const product = products.find((item) => item.id === button.dataset.selectExitProduct && !item.arquivado);
  if (!product) return;
  selectedExitProductId = product.id;
  $("#exit-product-search").value = product.nome;
  renderExitProductResults();
  $("#exit-quantity").focus();
});


