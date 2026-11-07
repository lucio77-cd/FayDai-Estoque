// utils.js — funções puras e auxiliares de DOM, movidas do app.js SEM nenhuma alteração de lógica.
// Não guardam estado e não acessam o Firebase.

export const $ = (selector) => document.querySelector(selector);
export const money = (value) => new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" }).format(Number(value) || 0);
// Arredonda valores em reais para 2 casas (centavos), evitando erros de ponto flutuante.
export const roundMoney = (value) => Math.round(((Number(value) || 0) + Number.EPSILON) * 100) / 100;
// Preço sugerido = custo cadastrado × (1 + percentual de ganho / 100).
export const calcSuggestedPrice = (product) => roundMoney((Number(product.custo) || 0) * (1 + (Number(product.percentualGanho) || 0) / 100));
// Preço de venda cadastrado no produto; se não existir, usa o sugerido.
export const getRegisteredSalePrice = (product) => {
  const registered = Number(product.precoVenda);
  return product.precoVenda !== null && product.precoVenda !== undefined && product.precoVenda !== "" && Number.isFinite(registered)
    ? roundMoney(registered)
    : calcSuggestedPrice(product);
};
export const toDateString = (date) => `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
export const dateToday = () => toDateString(new Date());
// Converte "2026-10-21" ou "2026-10-21 14:30" para "21/10/2026" ou "21/10/2026 14:30".
export const formatDate = (value) => {
  const match = String(value || "").match(/^(\d{4})-(\d{2})-(\d{2})(.*)$/);
  return match ? `${match[3]}/${match[2]}/${match[1]}${match[4]}` : (value || "");
};
// Converte um Timestamp do Firestore em texto local (ou vazio).
export const formatTimestamp = (value) => (value?.toDate
  ? value.toDate().toLocaleString("pt-BR", { dateStyle: "short", timeStyle: "short" })
  : "");
export const escapeHtml = (value = "") => String(value).replace(/[&<>"']/g, (char) => ({
  "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;"
}[char]));

export const normalizeText = (value = "") => String(value || "")
  .normalize("NFD")
  .replace(/[\u0300-\u036f]/g, "")
  .trim()
  .replace(/\s+/g, " ")
  .toLocaleLowerCase("pt-BR");

export const cleanOption = (value = "") => String(value || "").trim().replace(/\s+/g, " ");

export function uniqueOptions(values = []) {
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
export const minStockOf = (product) => (Number.isInteger(product.estoqueMinimo) && product.estoqueMinimo >= 0 ? product.estoqueMinimo : null);
export const isLowStock = (product) => {
  const minimum = minStockOf(product);
  return minimum !== null && (Number(product.quantidade) || 0) <= minimum;
};

// ---------- Fardo e volume (itens de conveniência) ----------

export const escapeRegExp = (text) => String(text).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

// Volume em ml para texto curto: 350 -> "350 ml"; 2000 -> "2 L"; 1500 -> "1,5 L".
export function volumeLabel(volumeMl) {
  const ml = Number(volumeMl);
  if (!Number.isFinite(ml) || ml <= 0) return "";
  if (ml >= 1000) {
    const liters = Math.round(ml) / 1000;
    return `${liters.toLocaleString("pt-BR")} L`;
  }
  return `${String(Math.round(ml * 100) / 100).replace(".", ",")} ml`;
}

// Nome gravado no produto = nome-base + volume (sem repetir o volume se ele já foi digitado no nome).
export function composeProductName(baseName, volumeMl) {
  const base = cleanOption(baseName);
  const label = volumeLabel(volumeMl);
  if (!label) return base;
  const compact = (text) => normalizeText(text).replace(/\s+/g, "");
  const pattern = new RegExp(`(^|[^0-9])${escapeRegExp(compact(label))}`);
  return pattern.test(compact(base)) ? base : `${base} ${label}`;
}

// Nome digitado pelo usuário (sem o volume). Produtos antigos não têm nomeBase: usa o nome inteiro.
export const baseNameOf = (product) => product.nomeBase || product.nome || "";
// Unidades por fardo (0 = o produto não vem em fardo).
export const packSizeOf = (product) => (Number.isInteger(product.unidadesPorFardo) && product.unidadesPorFardo >= 2 ? product.unidadesPorFardo : 0);
// Custo de cada unidade a partir do custo do fardo (em centavos, como todo custo do sistema).
export const unitCostFromPack = (packCost, packSize) => (packSize >= 2 ? roundMoney((Number(packCost) || 0) / packSize) : 0);

export const saleItemsOf = (sale) => (Array.isArray(sale.itens) && sale.itens.length
  ? sale.itens
  : [{ produtoNome: sale.produtoNome || "Produto", quantidade: sale.quantidade || 0, precoUnitario: sale.precoUnitario || 0 }]);

export const saleTotalOf = (sale) => Number(sale.total) || roundMoney(saleItemsOf(sale).reduce((sum, item) => (
  sum + roundMoney((Number(item.quantidade) || 0) * (Number(item.precoUnitario) || 0))
), 0));

export const returnTotalOf = (saleReturn) => {
  const items = Array.isArray(saleReturn.itens) ? saleReturn.itens : [];
  return Number(saleReturn.totalDevolvido) || roundMoney(items.reduce((sum, item) => (
    sum + roundMoney((Number(item.quantidade) || 0) * (Number(item.precoUnitario) || 0))
  ), 0));
};

export const saleDateOf = (sale) => sale.data || String(sale.dataHora || "").slice(0, 10);
export const returnDateOf = (saleReturn) => saleReturn.data || String(saleReturn.dataHora || "").slice(0, 10);
// Datas no formato AAAA-MM-DD; sem data inicial significa "todo o período".
export const inPeriod = (dateText, start, today) => !start || (dateText >= start && dateText <= today);
export const yesNo = (value) => (value === true ? "Sim" : (value === false ? "Não" : ""));

// ---------- Auxiliares gerais (leitura de campos e eventos) ----------

export const fieldValue = (selector) => {
  const element = document.querySelector(selector);
  return element ? String(element.value ?? "") : "";
};
export const onEvent = (selector, eventName, handler) => {
  const element = document.querySelector(selector);
  if (element) element.addEventListener(eventName, handler);
  else console.warn(`Elemento não encontrado: ${selector}`);
};
export const parseDecimal = (value) => {
  const text = String(value ?? "").trim().replace(",", ".");
  if (text === "") return NaN;
  return Number(text);
};
export const dateTimeFor = (date) => `${date || dateToday()} ${new Date().toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" })}`;
export const nowDateTime = () => dateTimeFor(dateToday());
export const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
