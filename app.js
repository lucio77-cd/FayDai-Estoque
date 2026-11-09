import { auth, db, collection, doc } from "./js/firebase.js?v=20261104-1";
import { $, money, roundMoney, calcSuggestedPrice, getRegisteredSalePrice, dateToday, formatDate, escapeHtml, normalizeText, cleanOption, uniqueOptions, saleItemsOf, saleTotalOf, fieldValue, onEvent, parseDecimal, dateTimeFor, nowDateTime } from "./js/utils.js?v=20261104-1";
import { cancelSale, registerReturn } from "./js/devolucoes.js?v=20261107-1";
import { printSale, initCaixaUI, showSaleDone, resetCaixaUI } from "./cupom.js?v=20261102-1";
import { saveEntryTransaction, saveExitTransaction } from "./js/servicos/movimentacoes.js?v=20261109-1";
import { initMovementFormsUI } from "./js/ui/formularios-movimentacoes.js?v=20261109-1";
import { parseCountValue, describeCount, startInventory as startInventoryService, saveInventory as saveInventoryService, discardInventory as discardInventoryService, finishInventory as finishInventoryService, MAX_INVENTORY_ADJUSTMENTS } from "./js/servicos/vistoria.js?v=20261109-1";
import { cartItemSubtotal as saleCartItemSubtotal, cartTotal as saleCartTotal, cartHasInvalidPrice as saleCartHasInvalidPrice, finishSaleTransaction, registerLostDemand } from "./js/servicos/vendas.js?v=20261106-4";

import { storeSettings, products, entries, exits, sales, saleCart, brands, categories, inventoryHistory, saleReturns, replaceArray, estadoUi } from "./js/estado.js?v=20261108-1";
import { loadAppData } from "./js/dados.js?v=20261107-1";
import { initScanner } from "./js/ui/scanner.js?v=20261106-7";
import { initPainelUI, renderDashboard } from "./js/ui/painel.js?v=20261106-7";
import { renderProducts } from "./js/ui/produtos.js?v=20261106-8";
import { initProductCatalogUI, renderCatalogOptions } from "./js/ui/catalogo-produtos.js?v=20261106-19";
import { saveProductTransaction, deleteProductTransaction } from "./js/servicos/produtos.js?v=20261109-1";
import { initProductFormUI } from "./js/ui/formulario-produtos.js?v=20261109-1";
import { initSessionUI, switchTab } from "./js/ui/sessao.js?v=20261106-9";
import { renderSales, returnableRows } from "./js/ui/historico-vendas.js?v=20261106-20";
import { renderEntries, renderExits } from "./js/ui/movimentacoes.js?v=20261106-18";
import { initExportacaoUI } from "./js/ui/exportacao.js?v=20261106-13";
import { initConfiguracoesUI, renderStoreSettings } from "./js/ui/configuracoes.js?v=20261107-1";
import { initVistoriaUI } from "./js/ui/vistoria.js?v=20261106-14";
import { initCaixaTelaUI } from "./js/ui/caixa.js?v=20261107-1";
import { initMovementSearchUI, selectedEntryProduct, readEntryAmounts, renderEntryProductResults, renderExitProductResults } from "./js/ui/busca-movimentacoes.js?v=20261108-2";




// Instante em que o primeiro item entrou no carrinho (para registrar a duração do atendimento).
// Idempotência da venda: ID gerado no cliente e reaproveitado enquanto o carrinho não mudar.



// Vistoria física


// Cancelamentos e devoluções de venda


// Painel: série diária usada pelo gráfico de vendas por dia


function showToast(message) {
  const toast = $("#toast");
  toast.textContent = message;
  toast.classList.add("show");
  clearTimeout(estadoUi.toastTimeout);
  estadoUi.toastTimeout = setTimeout(() => toast.classList.remove("show"), 2800);
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
  setSelectedExitProductId: (value) => { estadoUi.selectedExitProductId = value; },
  setSelectedEntryProductId: (value) => { estadoUi.selectedEntryProductId = value; },
  renderEntryProductResults,
  getInventoryCount: (productId) => estadoUi.vistoriaDraft[productId],
  setInventoryCount: (productId, value) => { estadoUi.vistoriaDraft[productId] = value; },
  markInventoryDirty: () => { estadoUi.vistoriaDirty = true; },
  parseInventoryCount: parseCountValue,
  addProductToSaleCart,
  renderSaleProductResults,
  renderExitProductResults,
  renderInventoryList,
  updateInventorySummary,
  setFeedback,
  showToast
});

initCaixaTelaUI({
  renderSaleProductResults, addProductToSaleCart, setFeedback, renderSaleCart, updateCartRow, updateCartSummary, finishSale,
  isSaleInFlight: () => estadoUi.saleInFlight,
  onCartCleared: () => { estadoUi.saleAttempt = null; estadoUi.saleCartStartedAt = null; }
});
initVistoriaUI({
  startInventory, saveInventory, finishInventory, discardInventory, renderInventoryList,
  updateCount: (productId, value) => {
    estadoUi.vistoriaDraft[productId] = value;
    estadoUi.vistoriaDirty = true;
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
    estadoUi.saleCartStartedAt = null; estadoUi.saleAttempt = null; estadoUi.saleInFlight = false;
    estadoUi.activeVistoria = null; replaceArray(inventoryHistory);
    estadoUi.vistoriaDraft = {}; estadoUi.vistoriaDraftOwner = null; estadoUi.vistoriaDirty = false;
    estadoUi.selectedEntryProductId = ""; estadoUi.selectedExitProductId = "";
  }
});

initMovementFormsUI({
  storeSettings, saveEntryTransaction, saveExitTransaction,
  selectedEntryProduct, readEntryAmounts,
  getSelectedExitProduct: () => products.find((item) => item.id === estadoUi.selectedExitProductId && !item.arquivado),
  setSelectedEntryProductId: (value) => { estadoUi.selectedEntryProductId = value; },
  setSelectedExitProductId: (value) => { estadoUi.selectedExitProductId = value; },
  currentEmail, initDateFields, loadData, setFeedback, showToast, explainError
});

initMovementSearchUI();

// ---------- Caixa: carrinho com preço editável e alertas ----------

// Preço do item (0 quando o campo está vazio ou inválido), subtotal e total em centavos exatos.
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
  if (!saleCart.length) estadoUi.saleCartStartedAt = null;
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
  if (estadoUi.saleInFlight) return false;
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
    if (!saleCart.length) estadoUi.saleCartStartedAt = Date.now();
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
  estadoUi.saleAction = { mode, saleId, returnId: mode === "return" ? doc(collection(db, "devolucoes")).id : null };
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
  estadoUi.saleAction = null;
  $("#sale-action-overlay").hidden = true;
}

function updateReturnTotal() {
  if (!estadoUi.saleAction || estadoUi.saleAction.mode !== "return") return;
  const sale = sales.find((item) => item.id === estadoUi.saleAction.saleId);
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

// ---------- Vistoria física ----------

// Campo vazio = não contado (saldo mantido). "0" = contado, sem nenhuma unidade.
// Mantém o rascunho digitado: só recarrega das contagens salvas quando a vistoria mudou
// ou quando não há alterações pendentes.
function syncInventoryDraft() {
  const id = estadoUi.activeVistoria?.id || null;
  if (id !== estadoUi.vistoriaDraftOwner) {
    estadoUi.vistoriaDraftOwner = id;
    estadoUi.vistoriaDirty = false;
    estadoUi.vistoriaDraft = {};
    Object.entries(estadoUi.activeVistoria?.contagens || {}).forEach(([productId, value]) => {
      estadoUi.vistoriaDraft[productId] = String(value);
    });
  } else if (!estadoUi.vistoriaDirty) {
    estadoUi.vistoriaDraft = {};
    Object.entries(estadoUi.activeVistoria?.contagens || {}).forEach(([productId, value]) => {
      estadoUi.vistoriaDraft[productId] = String(value);
    });
  }
}

function inventoryCounts() {
  const activeProducts = products.filter((product) => !product.arquivado);
  let counted = 0;
  let withDiff = 0;
  activeProducts.forEach((product) => {
    const parsed = parseCountValue(estadoUi.vistoriaDraft[product.id]);
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
  $("#inventory-dirty").hidden = !estadoUi.vistoriaDirty;
}

function updateInventoryRow(productId) {
  const product = products.find((item) => item.id === productId);
  const row = document.querySelector(`[data-count-row="${CSS.escape(productId)}"]`);
  if (!product || !row) return;
  const info = describeCount(product, estadoUi.vistoriaDraft[productId]);
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
    if (onlyUncounted && parseCountValue(estadoUi.vistoriaDraft[product.id]).state === "counted") return false;
    return true;
  });
  if (!visible.length) {
    list.innerHTML = '<div class="empty-state">Nenhum produto para mostrar com esse filtro.</div>';
    return;
  }
  list.innerHTML = visible.map((product) => {
    const raw = estadoUi.vistoriaDraft[product.id] ?? "";
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
  const hasActive = Boolean(estadoUi.activeVistoria);
  $("#inventory-idle").hidden = hasActive;
  $("#inventory-active").hidden = !hasActive;
  $("#inventory-start").disabled = !estadoUi.inventoryAvailable;
  if (hasActive) {
    const savedAt = estadoUi.activeVistoria.atualizadoEmMs
      ? new Date(estadoUi.activeVistoria.atualizadoEmMs).toLocaleString("pt-BR", { dateStyle: "short", timeStyle: "short" })
      : "";
    $("#inventory-meta").textContent = `Iniciada em ${formatDate(estadoUi.activeVistoria.data)} por ${estadoUi.activeVistoria.criadoPor || "usuário não identificado"}.${savedAt ? ` Último salvamento: ${savedAt}.` : ""}`;
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
  Object.entries(estadoUi.vistoriaDraft).forEach(([productId, raw]) => {
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
    if (estadoUi.activeVistoria) {
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
    button.disabled = !estadoUi.inventoryAvailable;
  }
}

async function saveInventory() {
  if (!estadoUi.activeVistoria) return;
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
      inventoryId: estadoUi.activeVistoria.id,
      counts,
      userEmail: auth.currentUser?.email || null
    });
    estadoUi.vistoriaDirty = false;
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
  if (!estadoUi.activeVistoria) return;
  const confirmed = window.confirm("Descartar a vistoria em andamento?\n\nTodas as contagens (salvas ou não) serão perdidas. Nenhum saldo será alterado.");
  if (!confirmed) return;
  const button = $("#inventory-discard");
  button.disabled = true;
  try {
    await discardInventoryService({ inventoryId: estadoUi.activeVistoria.id });
    estadoUi.vistoriaDirty = false;
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
  if (!estadoUi.activeVistoria) return;
  const button = $("#inventory-finish");
  button.disabled = true;
  setFeedback("#inventory-feedback", "Conferindo os saldos atuais…");
  try {
    if (Object.values(estadoUi.vistoriaDraft).some((raw) => parseCountValue(raw).state === "invalid")) {
      throw new Error("Há valores inválidos na contagem. Use números inteiros, 0 ou maiores.");
    }
    // Recarrega os saldos antes da confirmação; o serviço relê os saldos definitivos na transação.
    await loadData();
    if (!estadoUi.activeVistoria) throw new Error("A vistoria não está mais em andamento. Atualize a página.");

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
      inventoryId: estadoUi.activeVistoria.id,
      counts,
      activeProducts,
      date,
      dateTime,
      userEmail: email
    });

    estadoUi.vistoriaDirty = false;
    const message = `Vistoria concluída: ${result.contados} produto(s) contado(s), ${result.ajustados} com saldo ajustado${result.ignorados ? `, ${result.ignorados} ignorado(s) (arquivado ou removido)` : ""}.`;
    setFeedback("#inventory-feedback", message);
    showToast("Vistoria concluída.");
    // A vistoria já está gravada: falha ao recarregar a tela não pode parecer falha ao concluir.
    try {
      await loadData();
    } catch (refreshError) {
      console.error("Vistoria concluída, mas falhou a atualização da tela:", refreshError);
      setFeedback("#inventory-feedback", `${message} Atualize a página para ver os saldos novos.`, true);
    }
  } catch (error) {
    console.error("Falha ao concluir vistoria:", error);
    setFeedback("#inventory-feedback", explainError(error), true);
  } finally {
    button.disabled = false;
  }
}

function currentEmail() { return auth.currentUser?.email || "Usuário não identificado"; }

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
  renderEntries(estadoUi.showArchivedEntries);
  renderExits();
  renderExitProductResults();
  renderSaleProductResults();
  renderSaleCart();
  renderSales(estadoUi.saleReturnsAvailable);
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
  estadoUi.saleReturnsAvailable = data.saleReturnsAvailable;
  estadoUi.activeVistoria = data.activeVistoria;
  estadoUi.inventoryAvailable = data.inventoryAvailable;

  if (data.returnsError) {
    console.error("Falha ao carregar devoluções:", data.returnsError);
    if (!estadoUi.returnsLoadErrorShown) {
      estadoUi.returnsLoadErrorShown = true;
      showToast("Devoluções indisponíveis: publique as regras do Firestore.");
    }
  }
  if (data.inventoryError) {
    console.error("Falha ao carregar vistorias:", data.inventoryError);
    if (!estadoUi.inventoryLoadErrorShown) {
      estadoUi.inventoryLoadErrorShown = true;
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
  estadoUi.showArchivedEntries = event.target.checked;
  renderEntries(estadoUi.showArchivedEntries);
});



// ---------- Caixa: busca, carrinho e finalização ----------

async function finishSale(event) {
  event.preventDefault();
  // Trava de clique duplo: enquanto uma gravação está em andamento, novos envios são ignorados.
  if (estadoUi.saleInFlight) return;
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
  const durationSeconds = estadoUi.saleCartStartedAt ? Math.max(0, Math.round((Date.now() - estadoUi.saleCartStartedAt) / 1000)) : null;
  const retroactive = date !== dateToday();

  // Idempotência: o ID da venda é gerado no cliente ANTES da transação e só muda quando o conteúdo
  // da venda muda. Se a resposta da rede se perder e o usuário tentar de novo, o mesmo ID é reutilizado
  // e a transação detecta que a venda já foi gravada, em vez de criar outra.
  const fingerprint = JSON.stringify({
    formaPagamento,
    date,
    itens: cartSnapshot.map((item) => [item.produtoId, item.quantidade, item.precoUnitario])
  });
  if (!estadoUi.saleAttempt || estadoUi.saleAttempt.fingerprint !== fingerprint) {
    estadoUi.saleAttempt = { id: doc(collection(db, "vendas")).id, fingerprint };
  }

  // Dinheiro: valor recebido e troco (opcionais).
  const cashRaw = parseDecimal(fieldValue("#sale-cash-received"));
  const valorRecebido = formaPagamento === "Dinheiro" && Number.isFinite(cashRaw) && cashRaw > 0 ? roundMoney(cashRaw) : null;
  if (valorRecebido !== null && valorRecebido < cartTotal()) {
    return setFeedback("#sale-feedback", "O valor recebido é menor que o total da compra.", true);
  }
  const troco = valorRecebido !== null ? roundMoney(valorRecebido - cartTotal()) : null;

  estadoUi.saleInFlight = true;
  setSaleBusy(true);
  const button = $("#sale-finish-button");
  button.disabled = true;
  setFeedback("#sale-feedback", "Registrando venda…");
  try {
    const { alreadySaved } = await finishSaleTransaction({
      saleId: estadoUi.saleAttempt.id,
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
      id: estadoUi.saleAttempt.id, itens: savedItems,
      total: roundMoney(savedItems.reduce((sum, item) => sum + item.subtotal, 0)),
      formaPagamento, data: date, dataHora: dateTimeFor(date), usuario: currentEmail(),
      ...(valorRecebido !== null ? { valorRecebido, troco } : {})
    };
    estadoUi.saleAttempt = null;
    replaceArray(saleCart);
    estadoUi.saleCartStartedAt = null;
    // A venda já está gravada: um erro só de interface (cupom, formulário) não pode parecer falha de registro.
    try {
      $("#sale-payment-method").value = "";
      resetCaixaUI();
      initDateFields(true);
      renderSaleCart();
      showSaleDone(savedSale, storeSettings);
      const message = alreadySaved
        ? "Esta venda já estava registrada (o envio anterior foi confirmado). Nada foi duplicado."
        : "Venda registrada.";
      setFeedback("#sale-feedback", message);
      showToast(alreadySaved ? "Venda já registrada." : "Venda registrada.");
    } catch (uiError) {
      console.error("Venda salva, mas falhou a atualização da interface:", uiError);
      setFeedback("#sale-feedback", "Venda registrada. Não finalize novamente. Atualize a página para ver o cupom e os saldos.", true);
    }
    try {
      await loadData();
    } catch (refreshError) {
      console.error("Venda salva, mas falhou a atualização da tela:", refreshError);
      setFeedback("#sale-feedback", "Venda registrada. Não finalize novamente. Atualize a página para atualizar os saldos.", true);
    }
  } catch (error) {
    console.error("Falha ao registrar venda:", error);
    setFeedback("#sale-feedback", explainError(error), true);
  } finally {
    estadoUi.saleInFlight = false;
    renderSaleCart();
    setSaleBusy(false);
    updateCartSummary();
  }
}

function setSaleBusy(busy) {
  const selectors = [
    "#sale-product-search", "#sale-clear-button", "#sale-payment-method", "#sale-cash-received",
    "#sale-date", "#sale-finish-button", "[data-pay]", "[data-cash]",
    "[data-cart-price]", "[data-cart-plus]", "[data-cart-minus]", "[data-cart-remove]"
  ];
  selectors.forEach((selector) => {
    document.querySelectorAll(selector).forEach((element) => { element.disabled = busy; });
  });
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
  if (!estadoUi.saleAction) return;
  const sale = sales.find((item) => item.id === estadoUi.saleAction.saleId);
  if (!sale) return setFeedback("#sale-action-feedback", "Venda não encontrada. Atualize a lista.", true);
  const reason = fieldValue("#sale-action-reason").trim();
  if (!reason) return setFeedback("#sale-action-feedback", "Informe o motivo.", true);

  const button = $("#sale-action-confirm");
  button.disabled = true;
  setFeedback("#sale-action-feedback", "Salvando…");
  try {
    if (estadoUi.saleAction.mode === "cancel") {
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
      const result = await registerReturn(sale, requested, reason, estadoUi.saleAction.returnId);
      showToast(result.alreadySaved
        ? "Esta devolução já estava registrada. Nenhum estoque foi alterado novamente."
        : `Devolução registrada: ${money(result.total)}.`);
    }
    closeSaleAction();
    try {
      await loadData();
    } catch (refreshError) {
      console.error("Operação da venda salva, mas falhou a atualização da tela:", refreshError);
      showToast("Operação registrada. Atualize a página; não repita a operação.");
    }
  } catch (error) {
    console.error("Falha na operação da venda:", error);
    setFeedback("#sale-action-feedback", explainError(error), true);
  } finally {
    button.disabled = false;
  }
});

