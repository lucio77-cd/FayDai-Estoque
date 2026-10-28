import { initializeApp } from "https://www.gstatic.com/firebasejs/10.12.5/firebase-app.js";
import {
  getAuth, signInWithEmailAndPassword, onAuthStateChanged, signOut
} from "https://www.gstatic.com/firebasejs/10.12.5/firebase-auth.js";
import {
  getFirestore, collection, getDocs, doc, writeBatch, addDoc,
  runTransaction, serverTimestamp, deleteDoc, updateDoc, arrayUnion,
  query, where, orderBy, limit
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
// Preço sugerido = custo cadastrado × (1 + percentual de ganho / 100).
const calcSuggestedPrice = (product) => roundMoney((Number(product.custo) || 0) * (1 + (Number(product.percentualGanho) || 0) / 100));
// Preço de venda cadastrado no produto; se não existir, usa o sugerido.
const getRegisteredSalePrice = (product) => {
  const registered = Number(product.precoVenda);
  return product.precoVenda !== null && product.precoVenda !== undefined && product.precoVenda !== "" && Number.isFinite(registered)
    ? roundMoney(registered)
    : calcSuggestedPrice(product);
};
const toDateString = (date) => `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
const dateToday = () => toDateString(new Date());
// Converte "2026-10-21" ou "2026-10-21 14:30" para "21/10/2026" ou "21/10/2026 14:30".
const formatDate = (value) => {
  const match = String(value || "").match(/^(\d{4})-(\d{2})-(\d{2})(.*)$/);
  return match ? `${match[3]}/${match[2]}/${match[1]}${match[4]}` : (value || "");
};
// Converte um Timestamp do Firestore em texto local (ou vazio).
const formatTimestamp = (value) => (value?.toDate
  ? value.toDate().toLocaleString("pt-BR", { dateStyle: "short", timeStyle: "short" })
  : "");
const escapeHtml = (value = "") => String(value).replace(/[&<>"']/g, (char) => ({
  "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;"
}[char]));

const CATALOG_OPTIONS_ID = "catalogo_opcoes_faydai";
const STORE_SETTINGS_ID = "configuracoes_faydai";
const INTERNAL_COUNTER_ID = "contador_codigo_interno_faydai";
// Limite de produtos ajustados por vistoria (limite de escritas de uma transação do Firestore).
const MAX_INVENTORY_ADJUSTMENTS = 400;
const EXIT_REASON_LABELS = { perda: "Perda", devolucao: "Devolução ao fornecedor", uso_interno: "Uso interno", outro: "Outra saída" };
let storeSettings = { nome: "", responsavel: "", telefone: "", endereco: "", cnpj: "", codigoInternoAtivo: false, codigoBarrasAtivo: false, caixaAtivo: false, saidasAtivo: true };
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
let products = [];
let entries = [];
let exits = [];
let sales = [];
let selectedExitProductId = "";
let selectedEntryProductId = "";
let selectedSaleProductId = "";
let saleCart = [];
// Instante em que o primeiro item entrou no carrinho (para registrar a duração do atendimento).
let saleCartStartedAt = null;
// Idempotência da venda: ID gerado no cliente e reaproveitado enquanto o carrinho não mudar.
let saleAttempt = null; // { id, fingerprint }
let saleInFlight = false;
let brands = [];
let categories = [];
let showArchivedEntries = false;
let toastTimeout;

// Vistoria física
let inventoryHistory = [];
let activeVistoria = null;
let vistoriaDraft = {};
let vistoriaDraftOwner = null;
let vistoriaDirty = false;
let inventoryAvailable = true;
let inventoryLoadErrorShown = false;

// Cancelamentos e devoluções de venda
let saleReturns = [];
let saleReturnsAvailable = true;
let returnsLoadErrorShown = false;
let saleAction = null; // { mode: "cancel" | "return", saleId }

// Painel: série diária usada pelo gráfico de vendas por dia
let dailySeries = [];

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

// ---------- Auxiliares de produtos, vendas e devoluções ----------

// Estoque mínimo definido pelo usuário (null = sem aviso para o produto).
const minStockOf = (product) => (Number.isInteger(product.estoqueMinimo) && product.estoqueMinimo >= 0 ? product.estoqueMinimo : null);
const isLowStock = (product) => {
  const minimum = minStockOf(product);
  return minimum !== null && (Number(product.quantidade) || 0) <= minimum;
};

// ---------- Fardo e volume (itens de conveniência) ----------

const escapeRegExp = (text) => String(text).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

// Volume em ml para texto curto: 350 -> "350 ml"; 2000 -> "2 L"; 1500 -> "1,5 L".
function volumeLabel(volumeMl) {
  const ml = Number(volumeMl);
  if (!Number.isFinite(ml) || ml <= 0) return "";
  if (ml >= 1000) {
    const liters = Math.round(ml) / 1000;
    return `${liters.toLocaleString("pt-BR")} L`;
  }
  return `${String(Math.round(ml * 100) / 100).replace(".", ",")} ml`;
}

// Nome gravado no produto = nome-base + volume (sem repetir o volume se ele já foi digitado no nome).
function composeProductName(baseName, volumeMl) {
  const base = cleanOption(baseName);
  const label = volumeLabel(volumeMl);
  if (!label) return base;
  const compact = (text) => normalizeText(text).replace(/\s+/g, "");
  const pattern = new RegExp(`(^|[^0-9])${escapeRegExp(compact(label))}`);
  return pattern.test(compact(base)) ? base : `${base} ${label}`;
}

// Nome digitado pelo usuário (sem o volume). Produtos antigos não têm nomeBase: usa o nome inteiro.
const baseNameOf = (product) => product.nomeBase || product.nome || "";
// Unidades por fardo (0 = o produto não vem em fardo).
const packSizeOf = (product) => (Number.isInteger(product.unidadesPorFardo) && product.unidadesPorFardo >= 2 ? product.unidadesPorFardo : 0);
// Custo de cada unidade a partir do custo do fardo (em centavos, como todo custo do sistema).
const unitCostFromPack = (packCost, packSize) => (packSize >= 2 ? roundMoney((Number(packCost) || 0) / packSize) : 0);

const saleItemsOf = (sale) => (Array.isArray(sale.itens) && sale.itens.length
  ? sale.itens
  : [{ produtoNome: sale.produtoNome || "Produto", quantidade: sale.quantidade || 0, precoUnitario: sale.precoUnitario || 0 }]);

const saleTotalOf = (sale) => Number(sale.total) || roundMoney(saleItemsOf(sale).reduce((sum, item) => (
  sum + roundMoney((Number(item.quantidade) || 0) * (Number(item.precoUnitario) || 0))
), 0));

const returnTotalOf = (saleReturn) => {
  const items = Array.isArray(saleReturn.itens) ? saleReturn.itens : [];
  return Number(saleReturn.totalDevolvido) || roundMoney(items.reduce((sum, item) => (
    sum + roundMoney((Number(item.quantidade) || 0) * (Number(item.precoUnitario) || 0))
  ), 0));
};

const saleDateOf = (sale) => sale.data || String(sale.dataHora || "").slice(0, 10);
const returnDateOf = (saleReturn) => saleReturn.data || String(saleReturn.dataHora || "").slice(0, 10);
// Datas no formato AAAA-MM-DD; sem data inicial significa "todo o período".
const inPeriod = (dateText, start, today) => !start || (dateText >= start && dateText <= today);
const yesNo = (value) => (value === true ? "Sim" : (value === false ? "Não" : ""));

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

function switchTab(tabName) {
  document.querySelectorAll(".tab").forEach((button) => {
    button.classList.toggle("active", button.dataset.tab === tabName);
  });
  document.querySelectorAll(".tab-panel").forEach((panel) => {
    panel.hidden = panel.id !== `${tabName}-panel`;
  });
  // No computador, já deixa o cursor no campo onde o leitor de código de barras digita.
  const scanFields = {
    caja: "#sale-product-search",
    entries: "#entry-product-search",
    exits: "#exit-product-search",
    inventory: "#inventory-search"
  };
  if (scanFields[tabName] && window.matchMedia("(pointer: fine)").matches) {
    const field = $(scanFields[tabName]);
    if (field && !field.closest("[hidden]")) field.focus();
  }
}

function showTutorialIfNeeded() {
  let dismissed = false;
  try {
    dismissed = localStorage.getItem("faydai-tutorial-dismissed") === "yes";
  } catch (error) {
    console.warn("Não foi possível ler a preferência do tutorial:", error);
  }
  if (!dismissed) $("#tutorial-overlay").hidden = false;
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

// Reserva o próximo código interno DENTRO da transação que salva o produto.
// A leitura do contador acontece junto com as demais leituras; a gravação do novo
// valor só é feita por reservation.commit(), na mesma transação que grava o produto.
// Assim o número só é consumido se o produto for realmente salvo (sem lacunas na sequência).
async function reserveInternalCode(transaction) {
  const counterRef = doc(db, "produtos", INTERNAL_COUNTER_ID);
  const snap = await transaction.get(counterRef);
  const existingMax = products.reduce((max, product) => {
    const match = String(product.codigoInterno || "").match(/^FON(\d+)$/i);
    return match ? Math.max(max, Number(match[1]) || 0) : max;
  }, 0);
  const next = Math.max(Number(snap.data()?.ultimoNumero) || 0, existingMax) + 1;
  return {
    code: "FON" + String(next).padStart(3, "0"),
    commit: () => transaction.set(counterRef, { ultimoNumero: next, atualizadoEm: serverTimestamp() }, { merge: true })
  };
}

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
        const suggested = calcSuggestedPrice(product);
        const minimum = minStockOf(product);
        const low = isLowStock(product);
        const pack = packSizeOf(product);
        const unitGain = roundMoney(getRegisteredSalePrice(product) - roundMoney(product.custo));
        const packCell = pack
          ? `<div><span>Fardo</span><strong>${pack} un.${Number(product.custoFardo) > 0 ? ` · ${money(product.custoFardo)}` : ""}</strong></div>`
          : "";
        const previousCostCell = product.custoAnterior !== undefined && product.custoAnterior !== null && product.custoAlteradoEm
          ? `<div><span>Custo anterior (alterado em ${escapeHtml(formatDate(product.custoAlteradoEm))})</span><strong>${money(product.custoAnterior)}</strong></div>`
          : "";
        return `<article class="product-card">
          <div class="item-title-row">
            <div class="item-title">${escapeHtml(product.nome)}</div>
            <span class="stock-badge${low ? " low" : ""}">${Number(product.quantidade) || 0} un.${low ? " · baixo" : ""}</span>
          </div>
          ${product.marca || product.categoria ? `<p class="item-description">${[product.marca, product.categoria].filter(Boolean).map(escapeHtml).join(" · ")}</p>` : ""}
          ${product.descricao ? `<p class="item-description">${escapeHtml(product.descricao)}</p>` : ""}
          ${product.codigoInterno || (storeSettings.codigoBarrasAtivo && product.codigoBarras) ? `<p class="item-description">${product.codigoInterno ? `Código interno: ${escapeHtml(product.codigoInterno)}` : ""}${product.codigoInterno && storeSettings.codigoBarrasAtivo && product.codigoBarras ? " · " : ""}${storeSettings.codigoBarrasAtivo && product.codigoBarras ? `Código de barras: ${escapeHtml(product.codigoBarras)}` : ""}</p>` : ""}
          <div class="item-meta">
            <div><span>${pack ? "Custo por unidade" : "Custo cadastrado"}</span><strong>${money(product.custo)}</strong></div>
            <div><span>Preço de venda cadastrado</span><strong>${money(getRegisteredSalePrice(product))}</strong></div>
            <div><span>Preço sugerido</span><strong>${money(suggested)}</strong></div>
            <div><span>Ganho sobre custo</span><strong>${(Number(product.percentualGanho) || 0).toLocaleString("pt-BR")}%</strong></div>
            <div><span>Ganho por unidade</span><strong>${money(unitGain)}</strong></div>
            ${packCell}
            ${minimum !== null ? `<div><span>Estoque mínimo</span><strong>${minimum} un.</strong></div>` : ""}
            <div><span>Cadastro</span><strong>${product.criadoEmData ? new Date(product.criadoEmData + "T12:00:00").toLocaleDateString("pt-BR") : "—"}</strong></div>
            ${previousCostCell}
          </div>
          <div class="product-actions">
            <button class="button secondary" type="button" data-edit-product="${escapeHtml(product.id)}">Editar</button>
            <button class="button danger-outline" type="button" data-delete-product="${escapeHtml(product.id)}">Excluir produto</button>
          </div>
        </article>`;
      }).join("");
  }

  renderEntryProductResults();
}


// ---------- Leitor de código de barras ----------
// O leitor "digita" o código e termina com Enter (alguns terminam com Tab).
// Funciona no Caixa, em Entradas, em Saídas, na Vistoria e no cadastro de produto.

// Som curto de confirmação (agudo) ou de erro (grave), gerado pelo navegador, sem arquivo de áudio.
let scanAudioContext = null;
function scanBeep(ok = true) {
  try {
    scanAudioContext = scanAudioContext || new (window.AudioContext || window.webkitAudioContext)();
    if (scanAudioContext.state === "suspended") scanAudioContext.resume();
    const oscillator = scanAudioContext.createOscillator();
    const gain = scanAudioContext.createGain();
    oscillator.type = "square";
    oscillator.frequency.value = ok ? 1500 : 300;
    gain.gain.value = 0.04;
    oscillator.connect(gain);
    gain.connect(scanAudioContext.destination);
    oscillator.start();
    oscillator.stop(scanAudioContext.currentTime + (ok ? 0.08 : 0.3));
  } catch (error) {
    // O som é opcional: se o navegador bloquear, a leitura continua funcionando.
  }
  if (!ok && navigator.vibrate) navigator.vibrate(200);
}

// Produtos ativos cujo código de barras ou código interno é exatamente o código lido.
// Se não houver, aceita o nome idêntico (como o Caixa já fazia).
function scanMatches(rawCode) {
  const code = normalizeText(rawCode);
  if (!code) return [];
  const active = products.filter((product) => !product.arquivado);
  const byCode = active.filter((product) => normalizeText(product.codigoBarras) === code
    || normalizeText(product.codigoInterno) === code);
  return byCode.length ? byCode : active.filter((product) => normalizeText(product.nome) === code);
}

// Resolve o código lido: devolve o produto, ou null avisando o usuário (com som de erro quando é um código).
function resolveScannedProduct(rawCode, inputSelector, feedbackSelector) {
  const text = String(rawCode || "").trim();
  const matches = scanMatches(text);
  if (matches.length === 1) {
    setFeedback(feedbackSelector, "");
    return matches[0];
  }
  if (matches.length > 1) {
    scanBeep(false);
    setFeedback(feedbackSelector, "Mais de um produto com este código. Escolha na lista.", true);
    return null;
  }
  if (/^\d{6,}$/.test(text)) {
    scanBeep(false);
    setFeedback(feedbackSelector, `Código ${text} não encontrado. Confira o cadastro do produto.`, true);
    // Limpa o campo para a próxima leitura não ser somada a este código.
    const input = $(inputSelector);
    input.value = "";
    input.dispatchEvent(new Event("input", { bubbles: true }));
    return null;
  }
  setFeedback(feedbackSelector, "Nenhum produto com exatamente este código ou nome. Toque em um item da lista.", true);
  return null;
}

// Liga um campo de busca ao leitor. Enter nunca envia o formulário; Tab só vale quando o código existe.
function bindScanner(selector, handleCode) {
  $(selector).addEventListener("keydown", (event) => {
    if (event.key !== "Enter" && event.key !== "Tab") return;
    const value = event.currentTarget.value.trim();
    if (event.key === "Tab" && !(value && scanMatches(value).length)) return;
    event.preventDefault();
    if (value) handleCode(value);
  });
}

// Caixa: cada leitura adiciona 1 unidade ao carrinho.
bindScanner("#sale-product-search", (rawCode) => {
  const product = resolveScannedProduct(rawCode, "#sale-product-search", "#sale-feedback");
  if (!product) return;
  // Origem do item (dado para análise): "leitor" quando o código lido é o código de barras do produto.
  const barcode = normalizeText(product.codigoBarras);
  const origin = barcode && barcode === normalizeText(rawCode) ? "leitor" : "busca";
  const added = addProductToSaleCart(product, origin);
  scanBeep(added);
  if (!added) {
    $("#sale-product-search").value = "";
    renderSaleProductResults();
    $("#sale-product-search").focus();
  }
});

// Saídas: a leitura seleciona o produto e vai para a quantidade.
bindScanner("#exit-product-search", (rawCode) => {
  const product = resolveScannedProduct(rawCode, "#exit-product-search", "#exit-feedback");
  if (!product) return;
  scanBeep(true);
  selectedExitProductId = product.id;
  $("#exit-product-search").value = product.nome;
  renderExitProductResults();
  $("#exit-quantity").focus();
});

// Vistoria: cada leitura soma 1 à contagem do produto.
bindScanner("#inventory-search", (rawCode) => {
  const product = resolveScannedProduct(rawCode, "#inventory-search", "#inventory-scan-feedback");
  if (!product) return;
  const parsed = parseCountValue(vistoriaDraft[product.id]);
  const next = parsed.state === "counted" ? parsed.value + 1 : 1;
  vistoriaDraft[product.id] = String(next);
  vistoriaDirty = true;
  scanBeep(true);
  setFeedback("#inventory-scan-feedback", `${product.nome}: contagem ${next} (saldo no sistema: ${Number(product.quantidade) || 0})`);
  $("#inventory-search").value = "";
  renderInventoryList();
  updateInventorySummary();
  $("#inventory-search").focus();
});

// Cadastro de produto: o Enter do leitor não envia o formulário; confere se o código já existe.
$("#product-barcode").addEventListener("keydown", (event) => {
  if (event.key !== "Enter") return;
  event.preventDefault();
  const input = $("#product-barcode");
  const code = cleanOption(input.value);
  input.value = code;
  if (!code) return;
  const duplicate = products.find((product) => product.id !== editingProductId && !product.arquivado
    && String(product.codigoBarras || "") === code);
  if (duplicate) {
    scanBeep(false);
    const message = `Este código de barras já está associado ao produto "${duplicate.nome}".`;
    setFeedback("#product-feedback", message, true);
    showToast(message);
    return;
  }
  scanBeep(true);
  setFeedback("#product-feedback", "");
  $("#product-description").focus();
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
// Entradas: a leitura seleciona o produto e vai para a quantidade.
bindScanner("#entry-product-search", (rawCode) => {
  const product = resolveScannedProduct(rawCode, "#entry-product-search", "#entry-feedback");
  if (!product) return;
  scanBeep(true);
  selectedEntryProductId = product.id;
  $("#entry-product-search").value = product.nome;
  renderEntryProductResults();
  $("#entry-quantity").focus();
});
// ---------- Caixa: carrinho com preço editável e alertas ----------

// Preço do item (0 quando o campo está vazio ou inválido), subtotal e total em centavos exatos.
const cartItemPrice = (item) => (Number.isFinite(item.precoUnitario) ? item.precoUnitario : 0);
const cartItemSubtotal = (item) => roundMoney(item.quantidade * cartItemPrice(item));
const cartTotal = () => roundMoney(saleCart.reduce((sum, item) => sum + cartItemSubtotal(item), 0));
const cartHasInvalidPrice = () => saleCart.some((item) => !(item.precoUnitario > 0));

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

function renderSales() {
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
        ${actions}
      </article>`;
    }).join("");
}

// Soma unidades de volta ao estoque dentro de uma transação (todas as leituras antes das escritas).
// Produtos ARQUIVADOS continuam aceitando a devolução ao estoque: arquivar só impede novas vendas,
// não deve impedir o estorno de vendas antigas. Apenas um produto que não existe mais bloqueia.
async function restockInTransaction(transaction, lines) {
  const totals = new Map();
  lines.forEach((line) => {
    const current = totals.get(line.produtoId) || { nome: line.produtoNome || "Produto", quantidade: 0 };
    current.quantidade += line.quantidade;
    totals.set(line.produtoId, current);
  });
  const entriesList = [...totals.entries()];
  const snapshots = [];
  for (const [productId] of entriesList) {
    snapshots.push(await transaction.get(doc(db, "produtos", productId)));
  }
  snapshots.forEach((snapshot, index) => {
    const info = entriesList[index][1];
    if (!snapshot.exists()) throw new Error(`O produto "${info.nome}" não existe mais; não é possível devolver ao estoque.`);
  });
  snapshots.forEach((snapshot, index) => {
    transaction.update(snapshot.ref, {
      quantidade: (Number(snapshot.data().quantidade) || 0) + entriesList[index][1].quantidade,
      atualizadoEm: serverTimestamp()
    });
  });
}

// Contadores de devolução gravados na própria venda (vendas novas já nascem com eles).
const hasReturnCounter = (saleData) => !!saleData && typeof saleData.devolvidoPorProduto === "object"
  && saleData.devolvidoPorProduto !== null;

// Só para vendas ANTIGAS (sem contador): soma as devoluções já gravadas, fora da transação.
// Depois da primeira devolução/cancelamento a venda ganha o contador e isto deixa de ser usado.
async function loadLegacyReturns(saleId) {
  const snapshot = await getDocs(query(collection(db, "devolucoes"), where("vendaId", "==", saleId)));
  const porProduto = {};
  let valor = 0;
  snapshot.docs.forEach((item) => {
    const data = item.data();
    (data.itens || []).forEach((line) => {
      porProduto[line.produtoId] = (porProduto[line.produtoId] || 0) + (Number(line.quantidade) || 0);
    });
    valor = roundMoney(valor + (Number(data.totalDevolvido) || 0));
  });
  return { porProduto, valor };
}

// Estado de devolução lido DENTRO da transação: contador da venda ou, se for venda antiga, a base legada.
function returnedStateOf(saleData, legacy) {
  if (hasReturnCounter(saleData)) {
    return { porProduto: { ...saleData.devolvidoPorProduto }, valor: Number(saleData.valorDevolvido) || 0 };
  }
  if (!legacy) throw new Error("Os dados desta venda mudaram. Atualize a lista e tente de novo.");
  return { porProduto: { ...legacy.porProduto }, valor: legacy.valor };
}

// Cancela a venda inteira e devolve todas as unidades ao estoque.
// A checagem "já houve devolução?" é feita dentro da transação, lendo a própria venda.
// Se outro aparelho devolver ao mesmo tempo, a venda muda, a transação reexecuta e o bloqueio aparece.
async function cancelSale(sale, reason) {
  const saleRef = doc(db, "vendas", sale.id);
  const email = auth.currentUser?.email || null;
  const legacy = hasReturnCounter(sale) ? null : await loadLegacyReturns(sale.id);
  await runTransaction(db, async (transaction) => {
    const saleSnapshot = await transaction.get(saleRef);
    if (!saleSnapshot.exists()) throw new Error("Esta venda não existe mais. Atualize a lista.");
    const saleData = saleSnapshot.data();
    if (saleData.status === "cancelada") throw new Error("Esta venda já foi cancelada.");
    const returned = returnedStateOf(saleData, legacy);
    if (returned.valor > 0 || Object.values(returned.porProduto).some((qty) => qty > 0)) {
      throw new Error("Esta venda já tem devolução registrada e não pode ser cancelada por inteiro.");
    }
    const soldItems = Array.isArray(saleData.itens) ? saleData.itens : [];
    if (!soldItems.length || !soldItems.every((item) => item.produtoId)) {
      throw new Error("Esta venda é de um formato antigo e não pode ser cancelada pelo sistema.");
    }
    await restockInTransaction(transaction, soldItems.map((item) => ({
      produtoId: item.produtoId,
      produtoNome: item.produtoNome,
      quantidade: Number(item.quantidade) || 0
    })));
    transaction.update(saleRef, {
      status: "cancelada",
      canceladaEm: serverTimestamp(),
      canceladaPor: email,
      motivoCancelamento: reason
    });
  });
}

// Registra devolução parcial: requested = [{ index, quantidade }] (índice do item na venda).
// O limite "não devolver mais do que foi vendido" é conferido dentro da transação, com o contador da venda,
// e o contador é atualizado na mesma transação (duas devoluções simultâneas não passam do limite).
async function registerReturn(sale, requested, reason) {
  const saleRef = doc(db, "vendas", sale.id);
  const returnRef = doc(collection(db, "devolucoes"));
  const email = auth.currentUser?.email || "Usuário não identificado";
  const date = dateToday();
  const dateTime = `${date} ${new Date().toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" })}`;
  const legacy = hasReturnCounter(sale) ? null : await loadLegacyReturns(sale.id);
  let returnedTotal = 0;
  await runTransaction(db, async (transaction) => {
    const saleSnapshot = await transaction.get(saleRef);
    if (!saleSnapshot.exists()) throw new Error("Esta venda não existe mais. Atualize a lista.");
    const saleData = saleSnapshot.data();
    if (saleData.status === "cancelada") throw new Error("Esta venda foi cancelada e não aceita devolução.");
    const soldItems = Array.isArray(saleData.itens) ? saleData.itens : [];
    const returned = returnedStateOf(saleData, legacy);

    // Vendido por produto (se o mesmo produto aparecer em duas linhas, os limites somam).
    const soldByProduct = {};
    soldItems.forEach((item) => {
      if (item.produtoId) soldByProduct[item.produtoId] = (soldByProduct[item.produtoId] || 0) + (Number(item.quantidade) || 0);
    });
    const requestedByProduct = {};

    const returnItems = requested.map(({ index, quantidade }) => {
      const sold = soldItems[index];
      if (!sold || !sold.produtoId) throw new Error("Item da venda não encontrado. Atualize a lista.");
      requestedByProduct[sold.produtoId] = (requestedByProduct[sold.produtoId] || 0) + quantidade;
      const available = (soldByProduct[sold.produtoId] || 0) - (returned.porProduto[sold.produtoId] || 0);
      if (requestedByProduct[sold.produtoId] > available) {
        throw new Error(`Quantidade acima do que ainda pode ser devolvido de "${sold.produtoNome}". Disponível: ${Math.max(available, 0)}.`);
      }
      const precoUnitario = roundMoney(sold.precoUnitario);
      return {
        produtoId: sold.produtoId,
        produtoNome: sold.produtoNome || "",
        codigoInterno: sold.codigoInterno || "",
        quantidade,
        precoUnitario,
        custoUnitario: typeof sold.custoUnitario === "number" ? sold.custoUnitario : null,
        subtotal: roundMoney(quantidade * precoUnitario)
      };
    });
    returnedTotal = roundMoney(returnItems.reduce((sum, item) => sum + item.subtotal, 0));
    const newValor = roundMoney(returned.valor + returnedTotal);
    if (newValor > roundMoney(Number(saleData.total) || 0) + 0.005) {
      throw new Error("O valor devolvido não pode passar do total da venda.");
    }
    const newPorProduto = { ...returned.porProduto };
    returnItems.forEach((item) => {
      newPorProduto[item.produtoId] = (newPorProduto[item.produtoId] || 0) + item.quantidade;
    });

    await restockInTransaction(transaction, returnItems.map((item) => ({
      produtoId: item.produtoId, produtoNome: item.produtoNome, quantidade: item.quantidade
    })));
    transaction.set(returnRef, {
      vendaId: sale.id,
      vendaDataHora: saleData.dataHora || saleData.data || "",
      itens: returnItems,
      totalDevolvido: returnedTotal,
      motivo: reason,
      data: date,
      dataHora: dateTime,
      usuario: email,
      criadoEm: serverTimestamp()
    });
    transaction.update(saleRef, {
      devolvidoPorProduto: newPorProduto,
      valorDevolvido: newValor,
      ultimaDevolucaoId: returnRef.id,
      ultimaDevolucaoEm: serverTimestamp()
    });
  });
  return returnedTotal;
}

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

function renderExits() {
  const list = $("#exits-list");
  if (!exits.length) {
    list.innerHTML = '<div class="empty-state">Nenhuma saída registrada ainda.</div>';
    return;
  }
  list.innerHTML = [...exits].sort((a, b) => String(b.dataHora || "").localeCompare(String(a.dataHora || "")))
    .map((exit) => {
      const product = products.find((item) => item.id === exit.produtoId);
      return `<article class="entry-card exit-card">
        <div class="item-title-row"><div class="item-title">${escapeHtml(exit.produtoNome || product?.nome || "Produto")}</div><span class="exit-badge">−${Number(exit.quantidade) || 0} un.</span></div>
        <p><strong>${escapeHtml(EXIT_REASON_LABELS[exit.motivo] || exit.motivo || "Saída")}</strong> · ${escapeHtml(formatDate(exit.dataHora || exit.data) || "Data não informada")}</p>
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
      // Entradas em fardo (campos opcionais: entradas antigas não têm e continuam como antes).
      const packs = Number(entry.fardos) || 0;
      const packSize = Number(entry.unidadesPorFardo) || 0;
      const hasPack = packs > 0 && packSize > 0;
      const hasPackCost = typeof entry.custoFardo === "number" && Number.isFinite(entry.custoFardo);
      const purchaseTotal = hasPack && hasPackCost
        ? roundMoney(packs * entry.custoFardo)
        : roundMoney((Number(entry.quantidade) || 0) * (Number(entry.custoUnitario) || 0));
      const packLine = hasPack
        ? `<p>${packs} fardo(s) de ${packSize} un.${hasPackCost ? ` · ${money(entry.custoFardo)} por fardo` : ""}</p>`
        : "";
      return `<article class="entry-card">
      <div class="item-title-row"><div class="item-title">${escapeHtml(entry.produtoNome || linkedProduct?.nome || "Produto")}${archived ? '<span class="archived-label">Produto arquivado</span>' : ""}</div><span class="stock-badge">+${Number(entry.quantidade) || 0} un.</span></div>
      <p>${escapeHtml(typeLabel)} · ${escapeHtml(formatDate(entry.data) || "Data não informada")} · Custo unitário: ${money(entry.custoUnitario)}</p>
      ${packLine}
      ${entry.fornecedor ? `<p>Fornecedor: ${escapeHtml(entry.fornecedor)}</p>` : ""}
      ${entry.observacao ? `<p>${escapeHtml(entry.observacao)}</p>` : ""}
      <div class="item-meta"><div><span>Total informado da compra</span><strong>${money(purchaseTotal)}</strong></div><div><span>Registro</span><strong>${entry.data ? escapeHtml(entry.data.split("-").reverse().join("/")) : "—"}</strong></div></div>
    </article>`;
    }).join("");
}

// ---------- Vistoria física ----------

// Campo vazio = não contado (saldo mantido). "0" = contado, sem nenhuma unidade.
function parseCountValue(raw) {
  const text = String(raw ?? "").trim();
  if (text === "") return { state: "empty" };
  const value = Number(text);
  if (!Number.isInteger(value) || value < 0) return { state: "invalid" };
  return { state: "counted", value };
}

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

function describeCount(product, raw) {
  const parsed = parseCountValue(raw);
  const balance = Number(product.quantidade) || 0;
  if (parsed.state === "empty") return { text: "Não contado", cls: "pending", counted: false };
  if (parsed.state === "invalid") return { text: "Valor inválido", cls: "invalid", counted: false };
  const diff = parsed.value - balance;
  if (diff === 0) return { text: "Sem diferença", cls: "ok", counted: true };
  return { text: `${diff > 0 ? "+" : ""}${diff} un.`, cls: diff > 0 ? "plus" : "minus", counted: true };
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
    await addDoc(collection(db, "vistorias"), {
      status: "em_andamento",
      contagens: {},
      data: dateToday(),
      criadoEm: serverTimestamp(),
      criadoPor: email,
      atualizadoEm: serverTimestamp(),
      atualizadoPor: email
    });
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
    await updateDoc(doc(db, "vistorias", activeVistoria.id), {
      contagens: counts,
      atualizadoEm: serverTimestamp(),
      atualizadoPor: auth.currentUser?.email || null
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
    await deleteDoc(doc(db, "vistorias", activeVistoria.id));
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
    // Recarrega os saldos: a diferença é calculada com o saldo do momento da conclusão.
    await loadData();
    if (!activeVistoria) throw new Error("A vistoria não está mais em andamento. Atualize a página.");
    const vistoriaId = activeVistoria.id;

    const counted = [];
    const uncounted = [];
    products.filter((product) => !product.arquivado).forEach((product) => {
      const parsed = parseCountValue(vistoriaDraft[product.id]);
      const balance = Number(product.quantidade) || 0;
      if (parsed.state === "counted") {
        counted.push({ id: product.id, nome: product.nome || "", valor: parsed.value, saldo: balance });
      } else {
        uncounted.push({ produtoId: product.id, produtoNome: product.nome || "", codigoInterno: product.codigoInterno || "", saldo: balance });
      }
    });
    if (!counted.length) throw new Error("Informe a contagem de pelo menos um produto antes de concluir.");
    const withDiff = counted.filter((item) => item.valor !== item.saldo).length;
    if (withDiff > MAX_INVENTORY_ADJUSTMENTS) {
      throw new Error(`Há ${withDiff} produtos com diferença. O limite é ${MAX_INVENTORY_ADJUSTMENTS} por vistoria: deixe alguns produtos em branco (não contados) e conclua; depois faça outra vistoria com o restante.`);
    }

    const confirmed = window.confirm(
      `Concluir a vistoria?\n\n• ${counted.length} produto(s) contado(s)\n• ${withDiff} com diferença: o saldo será ajustado para a quantidade contada\n• ${uncounted.length} NÃO contado(s): mantêm o saldo atual\n\nA conclusão não pode ser desfeita.`
    );
    if (!confirmed) {
      setFeedback("#inventory-feedback", "");
      return;
    }

    setFeedback("#inventory-feedback", "Concluindo vistoria…");
    const vistoriaRef = doc(db, "vistorias", vistoriaId);
    const email = auth.currentUser?.email || "Usuário não identificado";
    const date = dateToday();
    const dateTime = `${date} ${new Date().toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" })}`;
    let result = null;
    await runTransaction(db, async (transaction) => {
      const vistoriaSnapshot = await transaction.get(vistoriaRef);
      if (!vistoriaSnapshot.exists() || vistoriaSnapshot.data().status !== "em_andamento") {
        throw new Error("Esta vistoria já foi concluída ou foi descartada.");
      }
      const snapshots = await Promise.all(counted.map((item) => transaction.get(doc(db, "produtos", item.id))));
      const itens = [];
      const ignorados = [];
      snapshots.forEach((snapshot, index) => {
        const item = counted[index];
        if (!snapshot.exists() || snapshot.data().arquivado) {
          ignorados.push({
            produtoId: item.id, produtoNome: item.nome, contado: item.valor,
            motivo: !snapshot.exists() ? "Produto não existe mais" : "Produto arquivado"
          });
          return;
        }
        const product = snapshot.data();
        const saldoAnterior = Number(product.quantidade) || 0;
        itens.push({
          produtoId: item.id,
          produtoNome: product.nome || item.nome,
          codigoInterno: product.codigoInterno || "",
          saldoAnterior,
          contado: item.valor,
          diferenca: item.valor - saldoAnterior
        });
      });
      const ajustados = itens.filter((item) => item.diferenca !== 0);
      if (ajustados.length > MAX_INVENTORY_ADJUSTMENTS) {
        throw new Error(`Há ${ajustados.length} produtos com diferença. O limite é ${MAX_INVENTORY_ADJUSTMENTS} por vistoria: deixe alguns produtos em branco e conclua em partes.`);
      }
      ajustados.forEach((item) => {
        transaction.update(doc(db, "produtos", item.produtoId), {
          quantidade: item.contado,
          atualizadoEm: serverTimestamp()
        });
      });
      transaction.update(vistoriaRef, {
        status: "concluida",
        contagens: Object.fromEntries(counted.map((item) => [item.id, item.valor])),
        itens,
        naoContados: uncounted,
        ignorados,
        totalContados: itens.length,
        totalNaoContados: uncounted.length,
        totalComDiferenca: ajustados.length,
        data: date,
        dataHora: dateTime,
        concluidaEm: serverTimestamp(),
        concluidaPor: email,
        atualizadoEm: serverTimestamp(),
        atualizadoPor: email
      });
      result = { contados: itens.length, ajustados: ajustados.length, ignorados: ignorados.length };
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
   // ---------- Auxiliares gerais (leitura de campos e eventos) ----------

const fieldValue = (selector) => {
  const element = document.querySelector(selector);
  return element ? String(element.value ?? "") : "";
};
const onEvent = (selector, eventName, handler) => {
  const element = document.querySelector(selector);
  if (element) element.addEventListener(eventName, handler);
  else console.warn(`Elemento não encontrado: ${selector}`);
};
const parseDecimal = (value) => {
  const text = String(value ?? "").trim().replace(",", ".");
  if (text === "") return NaN;
  return Number(text);
};
const dateTimeFor = (date) => `${date || dateToday()} ${new Date().toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" })}`;
const nowDateTime = () => dateTimeFor(dateToday());
const currentEmail = () => auth.currentUser?.email || "Usuário não identificado";
const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

// Preenche os campos de data (entrada, venda, saída) com a data de hoje quando estiverem vazios.
function initDateFields(force = false) {
  ["#entry-date", "#sale-date", "#exit-date"].forEach((selector) => {
    const input = document.querySelector(selector);
    if (input && (force || !input.value)) input.value = dateToday();
  });
}

// ---------- Exportação CSV ----------

// Texto que o Excel deve tratar como texto puro (ex.: código de barras só com dígitos).
const excelText = (value) => {
  const text = String(value ?? "");
  return text ? { raw: `="${text.replace(/"/g, '""')}"` } : "";
};

function csvCell(value) {
  if (value && typeof value === "object" && "raw" in value) return value.raw;
  let text = value === null || value === undefined ? "" : String(value);
  // Impede que a planilha trate o texto como fórmula.
  if (/^[=+\-@]/.test(text) && !/^-?\d+([.,]\d+)?$/.test(text)) text = `'${text}`;
  return /[";\n\r]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}
const csvNumber = (value) => (Number.isFinite(Number(value)) ? Number(value).toFixed(2).replace(".", ",") : "");

// Devolve false (e não baixa nada) quando não há linhas.
function downloadCsv(filename, header, rows) {
  if (!rows.length) return false;
  const lines = [header, ...rows].map((row) => row.map(csvCell).join(";"));
  const blob = new Blob(["\uFEFF" + lines.join("\r\n")], { type: "text/csv;charset=utf-8;" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = `${filename}-${dateToday()}.csv`;
  document.body.appendChild(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
  return true;
}

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

document.querySelectorAll("[data-export]").forEach((button) => {
  button.addEventListener("click", () => runExport([button.dataset.export]));
});
onEvent("#export-all", "click", () => runExport(Object.keys(EXPORTERS)));

// ---------- Carregamento de dados do Firestore ----------

function renderAll() {
  renderCatalogOptions();
  renderStoreSettings();
  renderProducts();
  renderEntries();
  renderExits();
  renderExitProductResults();
  renderSaleProductResults();
  renderSaleCart();
  renderSales();
  syncInventoryDraft();
  renderInventory();
  renderDashboard();
}

async function loadData() {
  const [productsSnap, entriesSnap, exitsSnap, salesSnap] = await Promise.all([
    getDocs(collection(db, "produtos")),
    getDocs(collection(db, "entradas")),
    getDocs(collection(db, "saidas")),
    getDocs(collection(db, "vendas"))
  ]);

  const specialIds = new Set([CATALOG_OPTIONS_ID, STORE_SETTINGS_ID, INTERNAL_COUNTER_ID]);
  let catalogData = {};
  products = [];
  productsSnap.docs.forEach((item) => {
    if (item.id === CATALOG_OPTIONS_ID) catalogData = item.data();
    else if (item.id === STORE_SETTINGS_ID) {
      storeSettings = { ...storeSettings, ...item.data() };
    } else if (!specialIds.has(item.id)) {
      products.push({ id: item.id, ...item.data() });
    }
  });
  entries = entriesSnap.docs.map((item) => ({ id: item.id, ...item.data() }));
  exits = exitsSnap.docs.map((item) => ({ id: item.id, ...item.data() }));
  sales = salesSnap.docs.map((item) => ({ id: item.id, ...item.data() }));

  brands = uniqueOptions([...(catalogData.marcas || []), ...products.map((product) => product.marca)]);
  categories = uniqueOptions([...(catalogData.categorias || []), ...products.map((product) => product.categoria)]);

  try {
    const returnsSnap = await getDocs(collection(db, "devolucoes"));
    saleReturns = returnsSnap.docs.map((item) => ({ id: item.id, ...item.data() }));
    saleReturnsAvailable = true;
  } catch (error) {
    console.error("Falha ao carregar devoluções:", error);
    saleReturns = [];
    saleReturnsAvailable = false;
    if (!returnsLoadErrorShown) {
      returnsLoadErrorShown = true;
      showToast("Devoluções indisponíveis: publique as regras do Firestore.");
    }
  }

  try {
    const inventorySnap = await getDocs(collection(db, "vistorias"));
    const all = inventorySnap.docs.map((item) => {
      const data = item.data();
      return { id: item.id, ...data, atualizadoEmMs: data.atualizadoEm?.toMillis ? data.atualizadoEm.toMillis() : 0 };
    });
    activeVistoria = all.find((item) => item.status === "em_andamento") || null;
    inventoryHistory = all.filter((item) => item.status === "concluida")
      .sort((a, b) => String(b.dataHora || "").localeCompare(String(a.dataHora || "")))
      .slice(0, 30);
    inventoryAvailable = true;
  } catch (error) {
    console.error("Falha ao carregar vistorias:", error);
    activeVistoria = null;
    inventoryHistory = [];
    inventoryAvailable = false;
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

// ---------- Produtos: formulário ----------

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
  renderCatalogOptions();
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
    // Marca e categoria novas entram no catálogo na mesma transação que grava o produto.
    const catalogRef = doc(db, "produtos", CATALOG_OPTIONS_ID);
    const catalogUpdate = {};
    if (marca && !brands.some((value) => normalizeText(value) === normalizeText(marca))) catalogUpdate.marcas = arrayUnion(marca);
    if (categoria && !categories.some((value) => normalizeText(value) === normalizeText(categoria))) catalogUpdate.categorias = arrayUnion(categoria);
    const hasCatalogUpdate = Object.keys(catalogUpdate).length > 0;

    if (editing) {
      const productRef = doc(db, "produtos", editing.id);
      await runTransaction(db, async (transaction) => {
        // Leituras primeiro: produto atual (dados frescos) e, se faltar código, o contador.
        const snapshot = await transaction.get(productRef);
        if (!snapshot.exists()) throw new Error("Este produto não existe mais. Atualize a lista.");
        const current = snapshot.data();
        const reservation = (!current.codigoInterno && storeSettings.codigoInternoAtivo)
          ? await reserveInternalCode(transaction)
          : null;

        const changes = {
          nome, descricao, marca, categoria,
          ...packFields,
          codigoInterno: reservation ? reservation.code : (current.codigoInterno || ""),
          codigoBarras: barcode,
          custo, percentualGanho, precoVenda, estoqueMinimo,
          atualizadoEm: serverTimestamp()
        };
        if (roundMoney(current.custo) !== custo) {
          changes.custoAnterior = roundMoney(current.custo);
          changes.custoAlteradoEm = dateToday();
          // Registro imutável do histórico de custos.
          transaction.set(doc(collection(db, "historico_custos")), {
            produtoId: editing.id,
            produtoNome: nome,
            custoAnterior: roundMoney(current.custo),
            custoNovo: custo,
            origem: "edicao_produto",
            data: dateToday(),
            usuario: currentEmail(),
            criadoEm: serverTimestamp()
          });
        }
        if (hasCatalogUpdate) transaction.set(catalogRef, catalogUpdate, { merge: true });
        if (reservation) reservation.commit();
        transaction.update(productRef, changes);
      });
    } else {
      const productRef = doc(collection(db, "produtos"));
      await runTransaction(db, async (transaction) => {
        // O contador é lido e gravado na mesma transação do produto:
        // se o salvamento falhar, o número não é consumido.
        const reservation = storeSettings.codigoInternoAtivo ? await reserveInternalCode(transaction) : null;

        if (hasCatalogUpdate) transaction.set(catalogRef, catalogUpdate, { merge: true });
        transaction.set(productRef, {
          nome, descricao, marca, categoria,
          ...packFields,
          codigoInterno: reservation ? reservation.code : "",
          codigoBarras: barcode,
          custo, percentualGanho, precoVenda, estoqueMinimo,
          quantidade: quantity,
          arquivado: false,
          criadoEmData: dateToday(),
          criadoEm: serverTimestamp(),
          atualizadoEm: serverTimestamp()
        });
        const baseEntry = {
          produtoId: productRef.id,
          produtoNome: nome,
          custoUnitario: custo,
          data: dateToday(),
          tipo: "estoque_inicial",
          fornecedor: "",
          usuario: currentEmail(),
          criadoEm: serverTimestamp(),
          criadoEmMs: Date.now()
        };
        if (packSize >= 2) {
          // Fardos fechados e unidades soltas viram lançamentos separados de estoque inicial.
          if (packsClosed > 0) {
            transaction.set(doc(collection(db, "entradas")), {
              ...baseEntry,
              quantidade: packsClosed * packSize,
              fardos: packsClosed,
              unidadesPorFardo: packSize,
              custoFardo,
              observacao: "Estoque inicial no cadastro do produto (fardos fechados)"
            });
          }
          if (looseUnits > 0) {
            transaction.set(doc(collection(db, "entradas")), {
              ...baseEntry,
              quantidade: looseUnits,
              observacao: "Estoque inicial no cadastro do produto (unidades soltas)"
            });
          }
        } else if (quantity > 0) {
          transaction.set(doc(collection(db, "entradas")), {
            ...baseEntry,
            quantidade: quantity,
            observacao: "Estoque inicial no cadastro do produto"
          });
        }
        if (reservation) reservation.commit();
      });
    }
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
    if (hasHistory) {
      await updateDoc(doc(db, "produtos", productId), {
        arquivado: true,
        arquivadoEm: serverTimestamp(),
        atualizadoEm: serverTimestamp()
      });
    } else {
      await deleteDoc(doc(db, "produtos", productId));
    }
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

// ---------- Entradas ----------

onEvent("#show-archived-entries", "change", (event) => {
  showArchivedEntries = event.target.checked;
  renderEntries();
});

async function saveEntry(event) {
  event.preventDefault();
  const submit = $("#entry-form button[type=submit]");
  const product = selectedEntryProduct();
  if (!product) return setFeedback("#entry-feedback", "Selecione um produto da lista.", true);
  // Com fardo: quantidade = fardos e custo = custo do fardo; o saldo e o custo unitário são calculados.
  const amounts = readEntryAmounts();
  const data = fieldValue("#entry-date") || dateToday();
  if (!amounts.quantityOk) {
    return setFeedback("#entry-feedback", amounts.mode === "pack"
      ? "A quantidade de fardos deve ser um número inteiro maior que zero."
      : "A quantidade deve ser um número inteiro maior que zero.", true);
  }
  if (!amounts.costOk) {
    return setFeedback("#entry-feedback", amounts.mode === "pack" ? "Informe um custo do fardo válido." : "Informe um custo unitário válido.", true);
  }
  const quantidade = amounts.units;
  const custoUnitario = amounts.unitCost;

  submit.disabled = true;
  setFeedback("#entry-feedback", "Registrando…");
  try {
    const productRef = doc(db, "produtos", product.id);
    await runTransaction(db, async (transaction) => {
      const snapshot = await transaction.get(productRef);
      if (!snapshot.exists() || snapshot.data().arquivado) throw new Error("Este produto não está mais disponível.");
      if (amounts.mode === "pack" && packSizeOf(snapshot.data()) !== amounts.size) {
        throw new Error("O tamanho do fardo deste produto mudou. Selecione o produto novamente.");
      }
      transaction.update(productRef, {
        quantidade: (Number(snapshot.data().quantidade) || 0) + quantidade,
        atualizadoEm: serverTimestamp()
      });
      const entryData = {
        produtoId: product.id,
        produtoNome: snapshot.data().nome || product.nome || "",
        quantidade,
        custoUnitario,
        data,
        tipo: "entrada",
        fornecedor: cleanOption(fieldValue("#entry-supplier")),
        observacao: fieldValue("#entry-notes").trim(),
        usuario: currentEmail(),
        criadoEm: serverTimestamp(),
        criadoEmMs: Date.now()
      };
      if (amounts.mode === "pack") {
        entryData.fardos = amounts.packs;
        entryData.unidadesPorFardo = amounts.size;
        entryData.custoFardo = amounts.packCost;
      }
      transaction.set(doc(collection(db, "entradas")), entryData);
    });
    $("#entry-form").reset();
    selectedEntryProductId = "";
    initDateFields(true);
    await loadData();
    setFeedback("#entry-feedback", "Entrada registrada.");
    showToast("Entrada registrada.");
  } catch (error) {
    console.error("Falha ao registrar entrada:", error);
    setFeedback("#entry-feedback", explainError(error), true);
  } finally {
    submit.disabled = false;
  }
}

onEvent("#entry-form", "submit", saveEntry);

// ---------- Caixa: busca, carrinho e finalização ----------

onEvent("#sale-product-search", "input", renderSaleProductResults);

onEvent("#sale-product-results", "click", (event) => {
  const button = event.target.closest("[data-select-sale-product]");
  if (!button) return;
  const product = products.find((item) => item.id === button.dataset.selectSaleProduct && !item.arquivado);
  if (product) addProductToSaleCart(product, "busca");
});

onEvent("#sale-cart-list", "click", (event) => {
  const plus = event.target.closest("[data-cart-plus]");
  const minus = event.target.closest("[data-cart-minus]");
  const remove = event.target.closest("[data-cart-remove]");
  if (plus) {
    const item = saleCart[Number(plus.dataset.cartPlus)];
    const product = item && products.find((entry) => entry.id === item.produtoId);
    if (!item || !product) return;
    if (item.quantidade + 1 > (Number(product.quantidade) || 0)) {
      return setFeedback("#sale-feedback", `Saldo insuficiente. Disponível: ${Number(product.quantidade) || 0} unidade(s).`, true);
    }
    item.quantidade += 1;
  } else if (minus) {
    const item = saleCart[Number(minus.dataset.cartMinus)];
    if (!item) return;
    item.quantidade -= 1;
    if (item.quantidade < 1) saleCart.splice(Number(minus.dataset.cartMinus), 1);
  } else if (remove) {
    saleCart.splice(Number(remove.dataset.cartRemove), 1);
  } else {
    return;
  }
  setFeedback("#sale-feedback", "");
  renderSaleCart();
});

// Digitar o preço atualiza só a linha (sem redesenhar, para não perder o foco).
onEvent("#sale-cart-list", "input", (event) => {
  const input = event.target.closest("[data-cart-price]");
  if (!input) return;
  const index = Number(input.dataset.cartPrice);
  const item = saleCart[index];
  if (!item) return;
  const parsed = parseDecimal(input.value);
  item.precoUnitario = Number.isFinite(parsed) ? roundMoney(parsed) : NaN;
  updateCartRow(index);
  updateCartSummary();
});

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

  saleInFlight = true;
  const button = $("#sale-finish-button");
  button.disabled = true;
  setFeedback("#sale-feedback", "Registrando venda…");
  try {
    let alreadySaved = false;
    await runTransaction(db, async (transaction) => {
      alreadySaved = false;
      // Leituras primeiro: a própria venda (idempotência) e depois os produtos.
      const existingSale = await transaction.get(saleRef);
      if (existingSale.exists()) {
        alreadySaved = true;
        return;
      }
      const snapshots = [];
      for (const item of cartSnapshot) snapshots.push(await transaction.get(doc(db, "produtos", item.produtoId)));
      const itens = [];
      snapshots.forEach((snapshot, index) => {
        const item = cartSnapshot[index];
        if (!snapshot.exists() || snapshot.data().arquivado) throw new Error(`O produto "${item.nome}" não está mais disponível.`);
        const product = { id: snapshot.id, ...snapshot.data() };
        const balance = Number(product.quantidade) || 0;
        if (item.quantidade > balance) throw new Error(`Saldo insuficiente de "${product.nome}". Disponível: ${balance}.`);
        const custoUnitario = roundMoney(product.custo);
        const precoCadastrado = getRegisteredSalePrice(product);
        const precoSugerido = calcSuggestedPrice(product);
        itens.push({
          produtoId: product.id,
          produtoNome: product.nome || item.nome,
          codigoInterno: product.codigoInterno || "",
          quantidade: item.quantidade,
          precoUnitario: item.precoUnitario,
          precoCadastrado,
          precoSugerido,
          custoUnitario,
          subtotal: roundMoney(item.quantidade * item.precoUnitario),
          precoAlterado: item.precoUnitario !== precoCadastrado,
          abaixoDoSugerido: item.precoUnitario < precoSugerido,
          abaixoDoCusto: item.precoUnitario < custoUnitario,
          // Dados novos para análise (previsão e combos):
          saldoAntes: balance,
          categoria: product.categoria || "",
          marca: product.marca || "",
          volumeMl: typeof product.volumeMl === "number" ? product.volumeMl : null,
          origem: item.origem || "busca"
        });
        transaction.update(snapshot.ref, { quantidade: balance - item.quantidade, atualizadoEm: serverTimestamp() });
      });
      transaction.set(saleRef, {
        itens,
        total: roundMoney(itens.reduce((sum, item) => sum + item.subtotal, 0)),
        formaPagamento,
        data: date,
        dataHora: dateTimeFor(date),
        usuario: currentEmail(),
        devolvidoPorProduto: {},
        valorDevolvido: 0,
        hora: saleHour,
        diaSemana: saleWeekday,
        duracaoSegundos: durationSeconds,
        numeroItens: itens.length,
        totalUnidades: itens.reduce((sum, item) => sum + item.quantidade, 0),
        lancamentoRetroativo: retroactive,
        criadoEm: serverTimestamp()
      });
    });
    saleAttempt = null;
    saleCart = [];
    saleCartStartedAt = null;
    $("#sale-payment-method").value = "";
    initDateFields(true);
    renderSaleCart();
    await loadData();
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

onEvent("#sale-form", "submit", finishSale);

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
    await addDoc(collection(db, "procura_perdida"), {
      descricao: text,
      data: dateToday(),
      dataHora: nowDateTime(),
      hora: now.getHours(),
      diaSemana: now.getDay(),
      usuario: currentEmail(),
      criadoEm: serverTimestamp()
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

// ---------- Histórico de vendas: cancelar e devolver ----------

onEvent("#sales-list", "click", (event) => {
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

async function saveExit(event) {
  event.preventDefault();
  if (storeSettings.saidasAtivo === false) return setFeedback("#exit-feedback", "O módulo Saídas está desativado.", true);
  const submit = $("#exit-form button[type=submit]");
  const product = products.find((item) => item.id === selectedExitProductId && !item.arquivado);
  if (!product) return setFeedback("#exit-feedback", "Selecione um produto da lista.", true);
  const quantidade = Number(fieldValue("#exit-quantity"));
  const motivo = fieldValue("#exit-reason");
  const data = fieldValue("#exit-date") || dateToday();
  if (!Number.isInteger(quantidade) || quantidade < 1) return setFeedback("#exit-feedback", "A quantidade deve ser um número inteiro maior que zero.", true);
  if (!motivo) return setFeedback("#exit-feedback", "Selecione o motivo da saída.", true);

  submit.disabled = true;
  setFeedback("#exit-feedback", "Registrando…");
  try {
    const productRef = doc(db, "produtos", product.id);
    await runTransaction(db, async (transaction) => {
      const snapshot = await transaction.get(productRef);
      if (!snapshot.exists() || snapshot.data().arquivado) throw new Error("Este produto não está mais disponível.");
      const balance = Number(snapshot.data().quantidade) || 0;
      if (quantidade > balance) throw new Error(`Saldo insuficiente. Disponível: ${balance} unidade(s).`);
      transaction.update(productRef, { quantidade: balance - quantidade, atualizadoEm: serverTimestamp() });
      transaction.set(doc(collection(db, "saidas")), {
        produtoId: product.id,
        produtoNome: snapshot.data().nome || product.nome || "",
        quantidade,
        motivo,
        observacao: fieldValue("#exit-notes").trim(),
        data,
        dataHora: dateTimeFor(data),
        usuario: currentEmail(),
        criadoEm: serverTimestamp()
      });
    });
    $("#exit-form").reset();
    selectedExitProductId = "";
    initDateFields(true);
    await loadData();
    setFeedback("#exit-feedback", "Saída registrada.");
    showToast("Saída registrada.");
  } catch (error) {
    console.error("Falha ao registrar saída:", error);
    setFeedback("#exit-feedback", explainError(error), true);
  } finally {
    submit.disabled = false;
  }
}

onEvent("#exit-form", "submit", saveExit);

// ---------- Vistoria: botões e campos ----------

onEvent("#inventory-start", "click", startInventory);
onEvent("#inventory-save", "click", saveInventory);
onEvent("#inventory-finish", "click", finishInventory);
onEvent("#inventory-discard", "click", discardInventory);
onEvent("#inventory-search", "input", renderInventoryList);
onEvent("#inventory-only-uncounted", "change", renderInventoryList);

onEvent("#inventory-list", "input", (event) => {
  const input = event.target.closest("[data-count-input]");
  if (!input) return;
  const productId = input.dataset.countInput;
  vistoriaDraft[productId] = input.value;
  vistoriaDirty = true;
  updateInventoryRow(productId);
  updateInventorySummary();
});

// ---------- Configurações ----------

onEvent("#store-settings-form", "submit", async (event) => {
  event.preventDefault();
  const submit = $("#store-settings-form button[type=submit]");
  const settings = {
    nome: cleanOption(fieldValue("#store-name")),
    responsavel: cleanOption(fieldValue("#store-manager")),
    telefone: cleanOption(fieldValue("#store-phone")),
    endereco: fieldValue("#store-address").trim(),
    cnpj: cleanOption(fieldValue("#store-cnpj")),
    codigoInternoAtivo: $("#setting-internal-code").checked,
    codigoBarrasAtivo: $("#setting-barcode").checked,
    caixaAtivo: $("#setting-caja-active").checked,
    saidasAtivo: $("#setting-exits-active").checked
  };
  submit.disabled = true;
  setFeedback("#settings-feedback", "Salvando…");
  try {
    const batch = writeBatch(db);
    batch.set(doc(db, "produtos", STORE_SETTINGS_ID), { ...settings, atualizadoEm: serverTimestamp() }, { merge: true });
    await batch.commit();
    storeSettings = { ...storeSettings, ...settings };
    renderStoreSettings();
    renderProducts();
    setFeedback("#settings-feedback", "Configurações salvas.");
    showToast("Configurações salvas.");
  } catch (error) {
    console.error("Falha ao salvar configurações:", error);
    setFeedback("#settings-feedback", explainError(error), true);
  } finally {
    submit.disabled = false;
  }
});

// ---------- Painel: período, gráfico e atalhos ----------

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

// ---------- Abas e tutorial ----------

document.querySelectorAll(".tab").forEach((button) => {
  button.addEventListener("click", () => switchTab(button.dataset.tab));
});

onEvent("#tutorial-close", "click", closeTutorialForNow);
onEvent("#tutorial-understood", "click", closeTutorialForNow);
onEvent("#tutorial-never", "click", () => {
  try {
    localStorage.setItem("faydai-tutorial-dismissed", "yes");
  } catch (error) {
    console.warn("Não foi possível salvar a preferência do tutorial:", error);
  }
  closeTutorialForNow();
});
onEvent("#show-tutorial", "click", () => { $("#tutorial-overlay").hidden = false; });

// ---------- Login, saída e sessão ----------

onEvent("#login-form", "submit", async (event) => {
  event.preventDefault();
  const submit = $("#login-form button[type=submit]");
  submit.disabled = true;
  setFeedback("#login-error", "");
  try {
    await signInWithEmailAndPassword(auth, fieldValue("#login-email").trim(), fieldValue("#login-password"));
    $("#login-password").value = "";
  } catch (error) {
    console.error("Falha no login:", error);
    setFeedback("#login-error", explainError(error), true);
  } finally {
    submit.disabled = false;
  }
});

onEvent("#logout-button", "click", async () => {
  try {
    await signOut(auth);
  } catch (error) {
    console.error("Falha ao sair:", error);
    showToast(explainError(error));
  }
});

function clearSessionState() {
  products = []; entries = []; exits = []; sales = []; saleReturns = [];
  saleCart = [];
  saleCartStartedAt = null;
  saleAttempt = null;
  saleInFlight = false;
  activeVistoria = null; inventoryHistory = [];
  vistoriaDraft = {}; vistoriaDraftOwner = null; vistoriaDirty = false;
  selectedEntryProductId = ""; selectedExitProductId = "";
}

onAuthStateChanged(auth, async (user) => {
  if (!user) {
    clearSessionState();
    showApp(false);
    return;
  }
  showApp(true);
  initDateFields(true);
  resetProductForm();
  try {
    await loadData();
  } catch (error) {
    console.error("Falha ao carregar dados:", error);
    showToast(explainError(error));
  }
  switchTab("dashboard");
  showTutorialIfNeeded();
});
