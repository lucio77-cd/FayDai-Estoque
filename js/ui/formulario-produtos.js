// formulario-produtos.js — estado, eventos e validações do formulário de produtos.
import {
  $, money, roundMoney, calcSuggestedPrice, getRegisteredSalePrice, dateToday,
  normalizeText, cleanOption, minStockOf, composeProductName, baseNameOf,
  packSizeOf, unitCostFromPack, saleItemsOf, fieldValue, onEvent, parseDecimal
} from "../utils.js?v=20261104-1";
import { NEW_BRAND_VALUE, NEW_CATEGORY_VALUE } from "./catalogo-produtos.js?v=20261106-19";

export function initProductFormUI(dependencies) {
  const {
    products, entries, exits, sales, saleReturns, brands, categories, storeSettings,
    saveProductTransaction, deleteProductTransaction, renderCatalogOptions,
    setFeedback, showToast, explainError, loadData, currentEmail
  } = dependencies;

  let editingProductId = null;
  let salePriceManuallyEdited = false;
  const SUGGESTED_CATEGORIES = [
  "Celulares",
  "Capas e películas",
  "Carregadores e cabos",
  "Áudio",
  "Peças e componentes",
  "Refrigerantes",
  "Sucos e chás",
  "Águas",
  "Energéticos",
  "Salgados e lanches",
  "Doces e chocolates",
  "Higiene",
  "Mercearia",
  "Outros"
];

  function resetProductForm() {
  editingProductId = null;
  $("#product-form").reset();
  $("#product-form h3").textContent = "Novo produto";
  $("#product-form button[type=submit]").textContent = "Salvar produto";
  $("#product-quantity").disabled = false;
  $("#product-internal-code").value = "";
  $("#product-internal-code").placeholder = storeSettings.codigoInternoAtivo ? "Gerado ao salvar" : "Desativado nas configurações";
  $("#product-barcode").disabled = !storeSettings.codigoBarrasAtivo;
  $("#product-brand-new").hidden = true;
  $("#product-category-new").hidden = true;
  $("#product-gain").value = "20";
  $("#product-quantity").value = "0";
  $("#product-min-stock").value = "";
  $("#product-volume").value = "";
  $("#product-volume-unit").value = "ml";
  $("#product-pack-size").value = "";
  $("#product-pack-cost").value = "";
  $("#product-initial-packs").value = "0";
  $("#product-initial-loose").value = "0";
  salePriceManuallyEdited = false;
  // Atualiza fardo, preço sugerido, ganho por unidade e a pré-visualização do nome (função da parte 3).
  refreshProductFormUI();
}

  function updateSuggestedPrice() {
  const cost = parseDecimal(fieldValue("#product-cost"));
  const gain = parseDecimal(fieldValue("#product-gain"));
  const suggested = calcSuggestedPrice({ custo: Number.isFinite(cost) ? cost : 0, percentualGanho: Number.isFinite(gain) ? gain : 0 });
  const label = document.querySelector("#suggested-price");
  if (label) label.textContent = money(suggested);
  const saleInput = document.querySelector("#product-sale-price");
  if (saleInput && !salePriceManuallyEdited) saleInput.value = suggested > 0 ? suggested.toFixed(2) : "";
}

// Unidades por fardo digitadas (0 quando vazio ou inválido).
function packSizeFromForm() {
  const value = Number(fieldValue("#product-pack-size").trim());
  return Number.isInteger(value) && value >= 2 ? value : 0;
}

// Volume digitado, convertido para ml (null quando vazio ou inválido).
function volumeMlFromForm() {
  const raw = parseDecimal(fieldValue("#product-volume"));
  if (!Number.isFinite(raw) || raw <= 0) return null;
  const factor = fieldValue("#product-volume-unit") === "l" ? 1000 : 1;
  return Math.round(raw * factor * 100) / 100;
}

// Atualiza o que depende de fardo, volume e preço: custo calculado, estoque inicial, nome final e ganho por unidade.
function refreshProductFormUI() {
  const size = packSizeFromForm();
  const editing = Boolean(editingProductId);

  // Custo: com fardo, o custo de cada unidade é calculado a partir do custo do fardo.
  const costInput = $("#product-cost");
  $("#product-pack-cost-wrap").hidden = !size;
  if (size) {
    const packCost = parseDecimal(fieldValue("#product-pack-cost"));
    costInput.readOnly = true;
    costInput.value = Number.isFinite(packCost) && packCost > 0 ? unitCostFromPack(packCost, size).toFixed(2) : "";
    $("#product-cost-label").textContent = "Custo por unidade (calculado) (R$) *";
  } else {
    costInput.readOnly = false;
    $("#product-cost-label").textContent = "Custo cadastrado (R$) *";
  }

  // Estoque inicial: com fardo, vira fardos fechados + unidades soltas (total calculado em unidades).
  const quantityInput = $("#product-quantity");
  const stockBox = $("#product-pack-stock");
  if (editing) {
    stockBox.hidden = true;
    quantityInput.readOnly = false;
    $("#product-quantity-label").textContent = "Saldo atual (para alterar, use Entradas, Saídas ou Vistoria)";
  } else if (size) {
    stockBox.hidden = false;
    const packs = Math.max(0, Math.floor(Number(fieldValue("#product-initial-packs")) || 0));
    const loose = Math.max(0, Math.floor(Number(fieldValue("#product-initial-loose")) || 0));
    quantityInput.readOnly = true;
    quantityInput.value = String(packs * size + loose);
    $("#product-quantity-label").textContent = "Total inicial em unidades (calculado) *";
  } else {
    stockBox.hidden = true;
    quantityInput.readOnly = false;
    $("#product-quantity-label").textContent = "Quantidade inicial *";
  }

  // Nome final = nome + volume.
  const base = cleanOption(fieldValue("#product-name"));
  $("#product-name-preview").textContent = base
    ? `Nome que será salvo: ${composeProductName(base, volumeMlFromForm())}`
    : "O volume entra no nome do produto. Ex.: Coca-Cola 350 ml.";

  // Preço sugerido e ganho por unidade.
  updateSuggestedPrice();
  const cost = parseDecimal(fieldValue("#product-cost"));
  const price = parseDecimal(fieldValue("#product-sale-price"));
  const gainLine = $("#product-unit-gain");
  if (Number.isFinite(cost) && cost > 0 && Number.isFinite(price) && price > 0) {
    const unitCost = roundMoney(cost);
    const gain = roundMoney(price - unitCost);
    const onCost = unitCost > 0 ? (gain / unitCost) * 100 : 0;
    const onPrice = (gain / price) * 100;
    const pct = (value) => (Math.round(value * 10) / 10).toLocaleString("pt-BR");
    gainLine.textContent = `Ganho por unidade: ${money(gain)} (${pct(onCost)}% sobre o custo · ${pct(onPrice)}% do preço de venda)`
      + (size ? ` · Por fardo fechado: ${money(roundMoney(gain * size))}` : "");
  } else {
    gainLine.textContent = "";
  }
}

["#product-name", "#product-volume", "#product-volume-unit", "#product-pack-size", "#product-pack-cost",
  "#product-initial-packs", "#product-initial-loose", "#product-cost", "#product-gain"].forEach((selector) => {
  onEvent(selector, "input", refreshProductFormUI);
});
onEvent("#product-volume-unit", "change", refreshProductFormUI);
onEvent("#product-sale-price", "input", () => {
  salePriceManuallyEdited = true;
  refreshProductFormUI();
});

// Botão "Cancelar edição" criado pelo JS (não existe no HTML).
function setCancelEditVisible(visible) {
  let button = document.querySelector("#product-cancel-edit");
  if (!button) {
    const submit = document.querySelector("#product-form button[type=submit]");
    if (!submit) return;
    button = document.createElement("button");
    button.id = "product-cancel-edit";
    button.type = "button";
    button.className = "button quiet";
    button.textContent = "Cancelar edição";
    button.addEventListener("click", () => {
      resetProductForm();
      setFeedback("#product-feedback", "");
      setCancelEditVisible(false);
    });
    submit.insertAdjacentElement("afterend", button);
  }
  button.hidden = !visible;
  }
  function startEditProduct(productId) {
  const product = products.find((item) => item.id === productId);
  if (!product) return;
  resetProductForm();
  editingProductId = product.id;
  const set = (selector, value) => {
    const element = document.querySelector(selector);
    if (element) element.value = value ?? "";
  };
  // Produtos antigos não têm nomeBase/volume/fardo: aparecem com o nome inteiro e sem fardo.
  set("#product-name", baseNameOf(product));
  const volume = Number(product.volumeMl);
  if (Number.isFinite(volume) && volume > 0) {
    if (volume >= 1000) {
      set("#product-volume", String(volume / 1000));
      set("#product-volume-unit", "l");
    } else {
      set("#product-volume", String(volume));
      set("#product-volume-unit", "ml");
    }
  }
  const size = packSizeOf(product);
  set("#product-pack-size", size || "");
  if (size) {
    set("#product-pack-cost", (typeof product.custoFardo === "number"
      ? roundMoney(product.custoFardo)
      : roundMoney(roundMoney(product.custo) * size)).toFixed(2));
  }
  set("#product-description", product.descricao);
  set("#product-cost", Number.isFinite(Number(product.custo)) ? roundMoney(product.custo).toFixed(2) : "");
  set("#product-gain", product.percentualGanho ?? 0);
  set("#product-quantity", Number(product.quantidade) || 0);
  set("#product-min-stock", minStockOf(product) ?? "");
  set("#product-internal-code", product.codigoInterno || "");
  set("#product-barcode", product.codigoBarras || "");
  renderCatalogOptions(brands, categories);
  set("#product-brand", product.marca || "");
  set("#product-category", product.categoria || "");
  set("#product-sale-price", getRegisteredSalePrice(product).toFixed(2));
  salePriceManuallyEdited = true;
  $("#product-quantity").disabled = true;
  $("#product-barcode").disabled = false;
  $("#product-form h3").textContent = "Editar produto";
  $("#product-form button[type=submit]").textContent = "Salvar alterações";
  refreshProductFormUI();
  setCancelEditVisible(true);
  setFeedback("#product-feedback", "Para mudar o saldo use Entradas, Saídas ou a Vistoria.");
  $("#product-form").scrollIntoView({ behavior: "smooth", block: "start" });
}

async function saveProduct(event) {
  event.preventDefault();
  const submit = $("#product-form button[type=submit]");
  const editing = editingProductId ? products.find((item) => item.id === editingProductId) : null;

  // Nome digitado (sem volume) e nome final gravado no produto (nome + volume).
  const nomeBase = cleanOption(fieldValue("#product-name"));
  const volumeRaw = fieldValue("#product-volume").trim();
  const volumeMl = volumeMlFromForm();
  const nome = composeProductName(nomeBase, volumeMl);
  const descricao = fieldValue("#product-description").trim();

  // Fardo: com fardo, o custo digitado é o do fardo e o custo de cada unidade é calculado.
  const packRaw = fieldValue("#product-pack-size").trim();
  const packSize = packRaw === "" ? 0 : Number(packRaw);
  let custoDigitado;
  let custo;
  let custoFardo = null;
  if (packSize >= 2) {
    const packCostTyped = parseDecimal(fieldValue("#product-pack-cost"));
    custoFardo = Number.isFinite(packCostTyped) && packCostTyped > 0 ? roundMoney(packCostTyped) : null;
    custo = custoFardo === null ? 0 : unitCostFromPack(custoFardo, packSize);
    custoDigitado = custoFardo === null ? NaN : custo;
  } else {
    // O custo digitado é validado ANTES de arredondar: roundMoney(NaN) viraria 0 e esconderia o campo vazio.
    custoDigitado = parseDecimal(fieldValue("#product-cost"));
    custo = roundMoney(custoDigitado);
  }
  const percentualGanho = parseDecimal(fieldValue("#product-gain"));

  // Quantidade inicial: com fardo = fardos fechados × unidades por fardo + unidades soltas.
  let quantity;
  let packsClosed = 0;
  let looseUnits = 0;
  if (editing) {
    quantity = Number(editing.quantidade) || 0;
  } else if (packSize >= 2) {
    packsClosed = Number(fieldValue("#product-initial-packs") || 0);
    looseUnits = Number(fieldValue("#product-initial-loose") || 0);
    quantity = packsClosed * packSize + looseUnits;
  } else {
    quantity = Number(fieldValue("#product-quantity") || 0);
  }
  const minRaw = fieldValue("#product-min-stock").trim();
  const estoqueMinimo = minRaw === "" ? null : Number(minRaw);
  const barcode = cleanOption(fieldValue("#product-barcode"));

  let marca = fieldValue("#product-brand");
  if (marca === NEW_BRAND_VALUE) marca = cleanOption(fieldValue("#product-brand-new"));
  let categoria = fieldValue("#product-category");
  if (categoria === NEW_CATEGORY_VALUE) categoria = cleanOption(fieldValue("#product-category-new"));
  marca = cleanOption(marca);
  categoria = cleanOption(categoria);
  marca = brands.find((value) => normalizeText(value) === normalizeText(marca)) || marca;
  categoria = [...SUGGESTED_CATEGORIES, ...categories].find((value) => normalizeText(value) === normalizeText(categoria)) || categoria;

  const salePriceRaw = parseDecimal(fieldValue("#product-sale-price"));
  const precoVenda = Number.isFinite(salePriceRaw) && salePriceRaw > 0
    ? roundMoney(salePriceRaw)
    : calcSuggestedPrice({ custo, percentualGanho });

  if (!nomeBase) return setFeedback("#product-feedback", "Informe o nome do produto.", true);
  if (volumeRaw !== "" && volumeMl === null) return setFeedback("#product-feedback", "Informe um volume maior que zero ou deixe o campo vazio.", true);
  if (packRaw !== "" && (!Number.isInteger(packSize) || packSize < 2)) {
    return setFeedback("#product-feedback", "As unidades por fardo devem ser um número inteiro de 2 ou mais (ou deixe vazio se o produto não vem em fardo).", true);
  }
  if (packSize >= 2 && custoFardo === null) return setFeedback("#product-feedback", "Informe o custo do fardo, maior que zero.", true);
  if (!Number.isFinite(custoDigitado) || custo <= 0) return setFeedback("#product-feedback", "Informe um custo válido, maior que zero.", true);
  if (!Number.isFinite(percentualGanho) || percentualGanho < 0) return setFeedback("#product-feedback", "Informe um percentual de ganho válido.", true);
  if (!editing && packSize >= 2 && (!Number.isInteger(packsClosed) || packsClosed < 0 || !Number.isInteger(looseUnits) || looseUnits < 0)) {
    return setFeedback("#product-feedback", "Fardos fechados e unidades soltas devem ser números inteiros, 0 ou maiores.", true);
  }
  if (!Number.isInteger(quantity) || quantity < 0) return setFeedback("#product-feedback", "A quantidade deve ser um número inteiro, 0 ou maior.", true);
  if (estoqueMinimo !== null && (!Number.isInteger(estoqueMinimo) || estoqueMinimo < 0)) {
    return setFeedback("#product-feedback", "O estoque mínimo deve ser um número inteiro, 0 ou maior.", true);
  }
  const sameName = products.find((product) => product.id !== editingProductId && !product.arquivado
    && normalizeText(product.nome) === normalizeText(nome));
  if (sameName) return setFeedback("#product-feedback", `Já existe um produto ativo chamado "${sameName.nome}".`, true);
  if (barcode) {
    const duplicate = products.find((product) => product.id !== editingProductId && !product.arquivado
      && String(product.codigoBarras || "") === barcode);
    if (duplicate) return setFeedback("#product-feedback", `Este código de barras já está associado ao produto "${duplicate.nome}".`, true);
  }

  // Campos novos (todos opcionais; produtos antigos continuam sem eles).
  const packFields = {
    nomeBase,
    volumeMl: volumeMl === null ? null : volumeMl,
    unidadesPorFardo: packSize >= 2 ? packSize : null,
    custoFardo: packSize >= 2 ? custoFardo : null
  };

  submit.disabled = true;
  setFeedback("#product-feedback", "Salvando…");
  try {
    await saveProductTransaction({
      productId: editing ? editing.id : null,
      data: {
        nome,
        descricao,
        marca,
        categoria,
        packFields,
        barcode,
        custo,
        percentualGanho,
        precoVenda,
        estoqueMinimo,
        quantity,
        packSize,
        packsClosed,
        looseUnits,
        custoFardo
      },
      products,
      brands,
      categories,
      suggestedCategories: SUGGESTED_CATEGORIES,
      internalCodeEnabled: storeSettings.codigoInternoAtivo,
      today: dateToday(),
      userEmail: currentEmail()
    });
    const wasEditing = Boolean(editing);
    resetProductForm();
    setCancelEditVisible(false);
    await loadData();
    setFeedback("#product-feedback", wasEditing ? "Produto atualizado." : "Produto salvo.");
    showToast(wasEditing ? "Produto atualizado." : "Produto salvo.");
  } catch (error) {
    console.error("Falha ao salvar produto:", error);
    setFeedback("#product-feedback", explainError(error), true);
  } finally {
    submit.disabled = false;
  }
}

onEvent("#product-form", "submit", saveProduct);

// ---------- Produtos: editar, excluir ou arquivar ----------

async function deleteProduct(productId) {
  const product = products.find((item) => item.id === productId);
  if (!product) return;
  if ((Number(product.quantidade) || 0) > 0) {
    showToast("Só é possível excluir produto com saldo zero. Use Saídas ou Vistoria para zerar o saldo.");
    return;
  }
  const hasHistory = entries.some((item) => item.produtoId === productId)
    || exits.some((item) => item.produtoId === productId)
    || sales.some((sale) => saleItemsOf(sale).some((item) => item.produtoId === productId))
    || saleReturns.some((item) => (item.itens || []).some((line) => line.produtoId === productId));
  const message = hasHistory
    ? `O produto "${product.nome}" tem histórico de movimentações.\n\nEle será ARQUIVADO (sai das listas e do Painel, mas o histórico é preservado). Continuar?`
    : `Excluir o produto "${product.nome}"?\n\nEsta ação não pode ser desfeita.`;
  if (!window.confirm(message)) return;
  try {
    await deleteProductTransaction({ productId, archive: hasHistory });
    if (editingProductId === productId) {
      resetProductForm();
      setCancelEditVisible(false);
    }
    await loadData();
    showToast(hasHistory ? "Produto arquivado." : "Produto excluído.");
  } catch (error) {
    console.error("Falha ao excluir produto:", error);
    showToast(explainError(error));
  }
}

onEvent("#products-list", "click", (event) => {
  const edit = event.target.closest("[data-edit-product]");
  if (edit) return startEditProduct(edit.dataset.editProduct);
  const remove = event.target.closest("[data-delete-product]");
  if (remove) deleteProduct(remove.dataset.deleteProduct);
});

  return {
    resetProductForm,
    isEditingProduct: () => Boolean(editingProductId),
    getProductEditingId: () => editingProductId
  };
}
