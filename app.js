import { initializeApp } from "https://www.gstatic.com/firebasejs/10.12.5/firebase-app.js";
import {
  getAuth, signInWithEmailAndPassword, onAuthStateChanged, signOut
} from "https://www.gstatic.com/firebasejs/10.12.5/firebase-auth.js";
import {
  getFirestore, collection, getDocs, doc, writeBatch, addDoc,
  runTransaction, serverTimestamp, deleteDoc, updateDoc, arrayUnion
} from "https://www.gstatic.com/firebasejs/10.12.5/firebase-firestore.js";

// Configuração do aplicativo web FayDai-Estoque.
const firebaseConfig = {
  apiKey: "AIzaSyDQw-x8-GUxkS41pAiOYwJjawgnMvxyuYk",
  authDomain: "faydai-estoque.firebaseapp.com",
  projectId: "faydai-estoque",
  storageBucket: "faydai-estoque.firebasestorage.app",
  messagingSenderId: "703117192541",
  appId: "1:703117192541:web:3eeeba198d137eee440cb4",
  measurementId: "G-W6ET4LEQHM"
};

const app = initializeApp(firebaseConfig);
const auth = getAuth(app);
const db = getFirestore(app);

const $ = (selector) => document.querySelector(selector);
const money = (value) => new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" }).format(Number(value) || 0);
// Arredonda valores em reais para 2 casas (centavos), evitando erros de ponto flutuante.
const roundMoney = (value) => Math.round(((Number(value) || 0) + Number.EPSILON) * 100) / 100;
const dateToday = () => {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`;
};
// Converte "2026-10-21" ou "2026-10-21 14:30" para "21/10/2026" ou "21/10/2026 14:30".
const formatDate = (value) => {
  const match = String(value || "").match(/^(\d{4})-(\d{2})-(\d{2})(.*)$/);
  return match ? `${match[3]}/${match[2]}/${match[1]}${match[4]}` : (value || "");
};
const escapeHtml = (value = "") => String(value).replace(/[&<>"']/g, (char) => ({
  "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;"
}[char]));

const CATALOG_OPTIONS_ID = "catalogo_opcoes_faydai";
const STORE_SETTINGS_ID = "configuracoes_faydai";
const INTERNAL_COUNTER_ID = "contador_codigo_interno_faydai";
let storeSettings = { nome: "", responsavel: "", telefone: "", endereco: "", cnpj: "", codigoInternoAtivo: false, codigoBarrasAtivo: false, caixaAtivo: false, saidasAtivo: true };
let editingProductId = null;
let salePriceManuallyEdited = false;
const SUGGESTED_CATEGORIES = [
  "Celulares",
  "Capas e películas",
  "Carregadores e cabos",
  "Áudio",
  "Peças e componentes",
  "Outros"
];
let products = [];
let entries = [];
let exits = [];
let sales = [];
let selectedExitProductId = "";
let selectedSaleProductId = "";
let saleCart = [];
let brands = [];
let categories = [];
let showArchivedEntries = false;
let toastTimeout;

const normalizeText = (value = "") => String(value || "")
  .normalize("NFD")
  .replace(/[\u0300-\u036f]/g, "")
  .trim()
  .replace(/\s+/g, " ")
  .toLocaleLowerCase("pt-BR");

const cleanOption = (value = "") => String(value || "").trim().replace(/\s+/g, " ");

function uniqueOptions(values = []) {
  const seen = new Set();
  return values
    .map(cleanOption)
    .filter((value) => {
      const key = normalizeText(value);
      if (!key || seen.has(key)) return false;
      seen.add(key);
      return true;
    })
    .sort((a, b) => a.localeCompare(b, "pt-BR"));
}

const NEW_BRAND_VALUE = "__nova_marca__";
const NEW_CATEGORY_VALUE = "__nova_categoria__";

function renderCatalogOptions() {
  const brandSelect = $("#product-brand");
  const categorySelect = $("#product-category");
  brandSelect.innerHTML = '<option value="">Sem marca</option>' +
    uniqueOptions(brands).map((value) => `<option value="${escapeHtml(value)}">${escapeHtml(value)}</option>`).join("") +
    `<option value="${NEW_BRAND_VALUE}">+ Cadastrar nova marca</option>`;
  categorySelect.innerHTML = '<option value="">Sem categoria</option>' +
    uniqueOptions([...SUGGESTED_CATEGORIES, ...categories]).map((value) => `<option value="${escapeHtml(value)}">${escapeHtml(value)}</option>`).join("") +
    `<option value="${NEW_CATEGORY_VALUE}">+ Cadastrar nova categoria</option>`;
}

function toggleNewCatalogInput(type) {
  const isBrand = type === "brand";
  const select = $(isBrand ? "#product-brand" : "#product-category");
  const input = $(isBrand ? "#product-brand-new" : "#product-category-new");
  const newValue = isBrand ? NEW_BRAND_VALUE : NEW_CATEGORY_VALUE;
  input.hidden = select.value !== newValue;
  if (input.hidden) input.value = "";
  else input.focus();
}

$("#product-brand").addEventListener("change", () => toggleNewCatalogInput("brand"));
$("#product-category").addEventListener("change", () => toggleNewCatalogInput("category"));

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
    "permission-denied": "O Firestore negou o acesso. Confira as regras e se o e-mail da conta está verificado.",
    "unavailable": "O Firebase está temporariamente indisponível. Tente novamente."
  };
  return messages[code] || (code.includes("permission-denied")
    ? "Acesso negado pelo Firestore. Confira as regras publicadas e a verificação do e-mail."
    : error?.message || "Ocorreu um erro inesperado.");
}

function showApp(isSignedIn) {
  // Só revela login ou sistema depois que o Firebase confirmar a sessão.
  $("#auth-loading-view").hidden = true;
  $("#login-view").hidden = isSignedIn;
  $("#app-view").hidden = !isSignedIn;
}

function switchTab(tabName) {
  document.querySelectorAll(".tab").forEach((button) => {
    button.classList.toggle("active", button.dataset.tab === tabName);
  });
  document.querySelectorAll(".tab-panel").forEach((panel) => {
    panel.hidden = panel.id !== `${tabName}-panel`;
  });
}

function showTutorialIfNeeded() {
  if (localStorage.getItem("faydai-tutorial-dismissed") !== "yes") {
    $("#tutorial-overlay").hidden = false;
  }
}

function closeTutorialForNow() {
  $("#tutorial-overlay").hidden = true;
}

function renderStoreSettings() {
  $("#store-name").value = storeSettings.nome || "";
  $("#store-manager").value = storeSettings.responsavel || "";
  $("#store-phone").value = storeSettings.telefone || "";
  $("#store-address").value = storeSettings.endereco || "";
  $("#store-cnpj").value = storeSettings.cnpj || "";
  $("#setting-internal-code").checked = Boolean(storeSettings.codigoInternoAtivo);
  $("#setting-barcode").checked = Boolean(storeSettings.codigoBarrasAtivo);
  $("#setting-caja-active").checked = Boolean(storeSettings.caixaAtivo);
  $("#setting-exits-active").checked = storeSettings.saidasAtivo !== false;
  renderModuleAvailability();
  $("#product-internal-code").placeholder = storeSettings.codigoInternoAtivo ? "Gerado ao salvar" : "Desativado nas configurações";
  $("#product-barcode").disabled = !storeSettings.codigoBarrasAtivo && !editingProductId;
}

function renderModuleAvailability() {
  const cajaActive = Boolean(storeSettings.caixaAtivo);
  const exitsActive = storeSettings.saidasAtivo !== false;
  $("#caja-disabled-notice").hidden = cajaActive;
  $("#caja-content").hidden = !cajaActive;
  $("#exits-disabled-notice").hidden = exitsActive;
  $("#exit-content").hidden = !exitsActive;
}

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
  salePriceManuallyEdited = false;
  updateSuggestedPrice();
}

async function generateInternalCode() {
  const counterRef = doc(db, "produtos", INTERNAL_COUNTER_ID);
  return runTransaction(db, async (transaction) => {
    const snap = await transaction.get(counterRef);
    const existingMax = products.reduce((max, product) => {
      const match = String(product.codigoInterno || "").match(/^FON(\d+)$/i);
      return match ? Math.max(max, Number(match[1]) || 0) : max;
    }, 0);
    const next = Math.max(Number(snap.data()?.ultimoNumero) || 0, existingMax) + 1;
    transaction.set(counterRef, { ultimoNumero: next, atualizadoEm: serverTimestamp() }, { merge: true });
    return "FON" + String(next).padStart(3, "0");
  });
}

function renderProducts() {
  const activeProducts = products.filter((product) => !product.arquivado);
  $("#product-count").textContent = `${activeProducts.length} ${activeProducts.length === 1 ? "item" : "itens"}`;
  const list = $("#products-list");
  if (!activeProducts.length) {
    list.innerHTML = '<div class="empty-state">Nenhum produto ativo cadastrado.<br>Use o formulário acima para adicionar o primeiro.</div>';
  } else {
    list.innerHTML = [...activeProducts]
      .sort((a, b) => a.nome.localeCompare(b.nome, "pt-BR"))
      .map((product) => {
        const suggested = roundMoney((Number(product.custo) || 0) * (1 + (Number(product.percentualGanho) || 0) / 100));
        return `<article class="product-card">
          <div class="item-title-row">
            <div class="item-title">${escapeHtml(product.nome)}</div>
            <span class="stock-badge">${Number(product.quantidade) || 0} un.</span>
          </div>
          ${product.marca || product.categoria ? `<p class="item-description">${[product.marca, product.categoria].filter(Boolean).map(escapeHtml).join(" · ")}</p>` : ""}
          ${product.descricao ? `<p class="item-description">${escapeHtml(product.descricao)}</p>` : ""}
          ${product.codigoInterno || (storeSettings.codigoBarrasAtivo && product.codigoBarras) ? `<p class="item-description">${product.codigoInterno ? `Código interno: ${escapeHtml(product.codigoInterno)}` : ""}${product.codigoInterno && storeSettings.codigoBarrasAtivo && product.codigoBarras ? " · " : ""}${storeSettings.codigoBarrasAtivo && product.codigoBarras ? `Código de barras: ${escapeHtml(product.codigoBarras)}` : ""}</p>` : ""}
          <div class="item-meta">
            <div><span>Custo cadastrado</span><strong>${money(product.custo)}</strong></div>
            <div><span>Preço de venda cadastrado</span><strong>${money(product.precoVenda ?? suggested)}</strong></div>
            <div><span>Preço sugerido</span><strong>${money(suggested)}</strong></div>
            <div><span>Ganho sobre custo</span><strong>${(Number(product.percentualGanho) || 0).toLocaleString("pt-BR")}%</strong></div>
            <div><span>Cadastro</span><strong>${product.criadoEmData ? new Date(product.criadoEmData + "T12:00:00").toLocaleDateString("pt-BR") : "—"}</strong></div>
          </div>
          <div class="product-actions">
            <button class="button secondary" type="button" data-edit-product="${escapeHtml(product.id)}">Editar</button>
            <button class="button danger-outline" type="button" data-delete-product="${escapeHtml(product.id)}">Excluir produto</button>
          </div>
        </article>`;
      }).join("");
  }

  const select = $("#entry-product");
  const previousValue = select.value;
  select.innerHTML = '<option value="">Selecione um produto</option>' + [...activeProducts]
    .sort((a, b) => a.nome.localeCompare(b.nome, "pt-BR"))
    .map((product) => `<option value="${escapeHtml(product.id)}">${escapeHtml(product.nome)} — saldo: ${Number(product.quantidade) || 0}</option>`)
    .join("");
  if (activeProducts.some((product) => product.id === previousValue)) select.value = previousValue;
}


function getSuggestedSalePrice(product) {
  const suggested = roundMoney((Number(product.custo) || 0) * (1 + (Number(product.percentualGanho) || 0) / 100));
  return Number.isFinite(Number(product.precoVenda)) && product.precoVenda !== null && product.precoVenda !== ""
    ? roundMoney(product.precoVenda)
    : suggested;
}

// Subtotal de um item do carrinho e total geral, sempre em centavos exatos.
const cartItemSubtotal = (item) => roundMoney(item.quantidade * item.precoUnitario);
const cartTotal = () => roundMoney(saleCart.reduce((sum, item) => sum + cartItemSubtotal(item), 0));

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
    const price = getSuggestedSalePrice(product);
    return `
      <button class="search-result sale-search-result" type="button" data-select-sale-product="${escapeHtml(product.id)}">
        <span><strong>${escapeHtml(product.nome)}</strong><small>${escapeHtml(product.codigoInterno || product.codigoBarras || "Sem código")} · ${Number(product.quantidade) || 0} em estoque</small></span>
        <span class="sale-result-price">${money(price)}<small>por unidade</small></span>
      </button>`;
  }).join("");
}

function renderSaleCart() {
  const list = $("#sale-cart-list");
  if (!saleCart.length) {
    list.innerHTML = '<div class="empty-state">A compra está vazia. Pesquise e selecione os produtos acima.</div>';
  } else {
    list.innerHTML = saleCart.map((item, index) => `
      <article class="cart-item">
        <div class="cart-item-main">
          <strong>${escapeHtml(item.nome)}</strong>
          <small>${money(item.precoUnitario)} por unidade</small>
        </div>
        <div class="cart-item-bottom">
          <div class="cart-quantity">
            <button type="button" class="quantity-button" data-cart-minus="${index}" aria-label="Diminuir quantidade">−</button>
            <span>${item.quantidade}</span>
            <button type="button" class="quantity-button" data-cart-plus="${index}" aria-label="Aumentar quantidade">+</button>
          </div>
          <strong class="cart-subtotal">${money(cartItemSubtotal(item))}</strong>
          <button type="button" class="remove-cart-item" data-cart-remove="${index}" aria-label="Remover ${escapeHtml(item.nome)}">Remover</button>
        </div>
      </article>`).join("");
  }
  const units = saleCart.reduce((sum, item) => sum + item.quantidade, 0);
  $("#sale-cart-total").textContent = money(cartTotal());
  $("#sale-cart-count").textContent = `${units} ${units === 1 ? "item" : "itens"}`;
  $("#sale-finish-button").disabled = saleCart.length === 0;
}

function addProductToSaleCart(product) {
  if ((Number(product.quantidade) || 0) < 1) {
    setFeedback("#sale-feedback", "Este produto está sem saldo disponível.", true);
    return;
  }
  const existing = saleCart.find((item) => item.produtoId === product.id);
  if (existing) {
    if (existing.quantidade + 1 > (Number(product.quantidade) || 0)) {
      setFeedback("#sale-feedback", `Saldo insuficiente. Disponível: ${Number(product.quantidade) || 0} unidade(s).`, true);
      return;
    }
    existing.quantidade += 1;
  } else {
    saleCart.push({
      produtoId: product.id,
      nome: product.nome || "",
      codigoInterno: product.codigoInterno || "",
      codigoBarras: product.codigoBarras || "",
      quantidade: 1,
      precoUnitario: getSuggestedSalePrice(product)
    });
  }
  $("#sale-product-search").value = "";
  setFeedback("#sale-feedback", "");
  renderSaleProductResults();
  renderSaleCart();
  $("#sale-product-search").focus();
}

function renderSales() {
  const list = $("#sales-list");
  if (!sales.length) {
    list.innerHTML = '<div class="empty-state">Nenhuma venda registrada ainda.</div>';
    return;
  }
  list.innerHTML = [...sales].sort((a, b) => String(b.dataHora || "").localeCompare(String(a.dataHora || "")))
    .map((sale) => {
      const items = Array.isArray(sale.itens) && sale.itens.length
        ? sale.itens
        : [{ produtoNome: sale.produtoNome || "Produto", quantidade: sale.quantidade || 0, precoUnitario: sale.precoUnitario || 0 }];
      const itemLines = items.map((item) => `<li>${escapeHtml(item.produtoNome || item.nome || "Produto")} — ${Number(item.quantidade) || 0} × ${money(item.precoUnitario)}</li>`).join("");
      const total = Number(sale.total) || roundMoney(items.reduce((sum, item) => sum + roundMoney((Number(item.quantidade) || 0) * (Number(item.precoUnitario) || 0)), 0));
      return `<article class="entry-card">
        <div class="item-title-row"><div class="item-title">Venda</div><span class="stock-badge">${money(total)}</span></div>
        <ul class="sale-history-items">${itemLines}</ul>
        <p>${escapeHtml(formatDate(sale.dataHora || sale.data) || "Data não informada")} · Pagamento: ${escapeHtml(sale.formaPagamento || "Não informado")}</p>
        <p>Responsável: ${escapeHtml(sale.usuario || "Não identificado")}</p>
      </article>`;
    }).join("");
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

function renderExits() {
  const list = $("#exits-list");
  if (!exits.length) {
    list.innerHTML = '<div class="empty-state">Nenhuma saída registrada ainda.</div>';
    return;
  }
  const labels = { perda: "Perda", devolucao: "Devolução ao fornecedor", uso_interno: "Uso interno", outro: "Outra saída" };
  list.innerHTML = [...exits].sort((a, b) => String(b.dataHora || "").localeCompare(String(a.dataHora || "")))
    .map((exit) => {
      const product = products.find((item) => item.id === exit.produtoId);
      return `<article class="entry-card exit-card">
        <div class="item-title-row"><div class="item-title">${escapeHtml(exit.produtoNome || product?.nome || "Produto")}</div><span class="exit-badge">−${Number(exit.quantidade) || 0} un.</span></div>
        <p><strong>${escapeHtml(labels[exit.motivo] || exit.motivo || "Saída")}</strong> · ${escapeHtml(formatDate(exit.dataHora || exit.data) || "Data não informada")}</p>
        <p>Responsável: ${escapeHtml(exit.usuario || "Não identificado")}</p>
        ${exit.observacao ? `<p>${escapeHtml(exit.observacao)}</p>` : ""}
      </article>`;
    }).join("");
}

function renderEntries() {
  const list = $("#entries-list");
  const visibleEntries = entries.filter((entry) => {
    const linkedProduct = products.find((product) => product.id === entry.produtoId);
    return showArchivedEntries || !linkedProduct?.arquivado;
  });
  if (!visibleEntries.length) {
    list.innerHTML = entries.length
      ? '<div class="empty-state">Nenhuma entrada ativa para mostrar. Ative “Mostrar produtos arquivados” para consultar o histórico preservado.</div>'
      : '<div class="empty-state">Nenhuma entrada registrada ainda.</div>';
    return;
  }
  list.innerHTML = [...visibleEntries]
    .sort((a, b) => String(b.data || "").localeCompare(String(a.data || "")) || (b.criadoEmMs || 0) - (a.criadoEmMs || 0))
    .map((entry) => {
      const linkedProduct = products.find((product) => product.id === entry.produtoId);
      const archived = Boolean(linkedProduct?.arquivado);
      const typeLabel = entry.tipo === "estoque_inicial" ? "Estoque inicial" : "Entrada de mercadoria";
      return `<article class="entry-card">
      <div class="item-title-row"><div class="item-title">${escapeHtml(entry.produtoNome || linkedProduct?.nome || "Produto")}${archived ? '<span class="archived-label">Produto arquivado</span>' : ""}</div><span class="stock-badge">+${Number(entry.quantidade) || 0} un.</span></div>
      <p>${escapeHtml(typeLabel)} · ${escapeHtml(formatDate(entry.data) || "Data não informada")} · Custo unitário: ${money(entry.custoUnitario)}</p>
      ${entry.fornecedor ? `<p>Fornecedor: ${escapeHtml(entry.fornecedor)}</p>` : ""}
      ${entry.observacao ? `<p>${escapeHtml(entry.observacao)}</p>` : ""}
      <div class="item-meta"><div><span>Total informado da compra</span><strong>${money(roundMoney((Number(entry.quantidade) || 0) * (Number(entry.custoUnitario) || 0)))}</strong></div><div><span>Registro</span><strong>${entry.data ? escapeHtml(entry.data.split("-").reverse().join("/")) : "—"}</strong></div></div>
    </article>`;
    }).join("");
}

async function loadData() {
  const user = auth.currentUser;
  if (!user) return;
  try {
    const [productSnapshot, entrySnapshot] = await Promise.all([
      getDocs(collection(db, "produtos")),
      getDocs(collection(db, "entradas"))
    ]);
    let exitSnapshot = null;
    let saleSnapshot = null;
    try {
      saleSnapshot = await getDocs(collection(db, "vendas"));
    } catch (saleLoadError) {
      console.error("Falha ao carregar histórico de vendas:", saleLoadError);
      if (saleLoadError?.code?.includes("permission-denied")) setFeedback("#sale-feedback", "O Firestore ainda não permite ler a coleção de vendas.", true);
    }
    try {
      exitSnapshot = await getDocs(collection(db, "saidas"));
    } catch (exitLoadError) {
      console.error("Falha ao carregar histórico de saídas:", exitLoadError);
      if (exitLoadError?.code?.includes("permission-denied")) {
        setFeedback("#exit-feedback", "O histórico de saídas ainda não tem permissão de leitura nas regras do Firestore.", true);
      }
    }
    const catalogOptionsDoc = productSnapshot.docs.find((item) => item.id === CATALOG_OPTIONS_ID);
    const settingsDoc = productSnapshot.docs.find((item) => item.id === STORE_SETTINGS_ID);
    storeSettings = { ...storeSettings, ...(settingsDoc?.data() || {}) };
    const catalogOptions = catalogOptionsDoc?.data() || {};
    brands = uniqueOptions(catalogOptions.marcas || []);
    categories = uniqueOptions(catalogOptions.categorias || []);
    products = productSnapshot.docs
      .filter((item) => ![CATALOG_OPTIONS_ID, STORE_SETTINGS_ID, INTERNAL_COUNTER_ID].includes(item.id))
      .map((item) => ({ id: item.id, ...item.data() }));
    entries = entrySnapshot.docs.map((item) => {
      const data = item.data();
      return { id: item.id, ...data, criadoEmMs: data.criadoEm?.toMillis?.() || 0 };
    });
    exits = exitSnapshot ? exitSnapshot.docs.map((item) => ({ id: item.id, ...item.data() })) : [];
    sales = saleSnapshot ? saleSnapshot.docs.map((item) => ({ id: item.id, ...item.data() })) : [];
    renderCatalogOptions();
    renderStoreSettings();
    renderProducts();
    renderEntries();
    renderExitProductResults();
    renderExits();
    renderSaleProductResults();
    renderSales();
  } catch (error) {
    console.error("Falha ao carregar dados do Firestore:", error);
    showToast(explainError(error));
    if (error?.code?.includes("permission-denied")) {
      showToast("Acesso negado. Confira as regras do Firestore e se a conta autenticada tem permissão.");
    }
  }
}

$("#login-form").addEventListener("submit", async (event) => {
  event.preventDefault();
  const button = event.currentTarget.querySelector('button[type="submit"]');
  button.disabled = true;
  button.textContent = "Entrando…";
  setFeedback("#login-error", "");
  try {
    const email = $("#login-email").value.trim();
    const password = $("#login-password").value;
    await signInWithEmailAndPassword(auth, email, password);
  } catch (error) {
    setFeedback("#login-error", explainError(error), true);
  } finally {
    button.disabled = false;
    button.textContent = "Entrar";
  }
});

$("#logout-button").addEventListener("click", async () => {
  try {
    closeTutorialForNow();
    await signOut(auth);
    $("#login-password").value = "";
  } catch (error) {
    showToast(explainError(error));
  }
});

onAuthStateChanged(auth,
