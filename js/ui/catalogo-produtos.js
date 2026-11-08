import { $, escapeHtml, uniqueOptions } from "../utils.js?v=20261104-1";

export const NEW_BRAND_VALUE = "__nova_marca__";
export const NEW_CATEGORY_VALUE = "__nova_categoria__";

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

export function renderCatalogOptions(brands, categories) {
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

export function initProductCatalogUI() {
  $("#product-brand").addEventListener("change", () => toggleNewCatalogInput("brand"));
  $("#product-category").addEventListener("change", () => toggleNewCatalogInput("category"));
}
