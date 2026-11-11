import { $, money, roundMoney, calcSuggestedPrice, getRegisteredSalePrice, formatDate, escapeHtml, minStockOf, isLowStock, packSizeOf } from "../utils.js?v=20261104-1";
import { products, storeSettings } from "../estado.js?v=20261108-1";


function applyProductFilters() {
  const list = $("#products-list"), search = $("#product-list-search");
  const category = $("#product-category-filter"), stock = $("#product-stock-filter");
  if (!list || !search || !category || !stock) return;
  const cards = [...list.querySelectorAll(".product-card")];
  const previous = category.value;
  const names = [...new Set(cards.map((card) => card.dataset.productCategory).filter(Boolean))].sort((a,b) => a.localeCompare(b,"pt-BR"));
  category.innerHTML = '<option value="">Todas as categorias</option>' + names.map((name) => `<option value="${escapeHtml(name)}">${escapeHtml(name)}</option>`).join("");
  category.value = names.includes(previous) ? previous : "";
  const term = search.value.trim().toLocaleLowerCase("pt-BR");
  let visible = 0;
  cards.forEach((card) => {
    const haystack = [card.dataset.productName,card.dataset.productBrand,card.dataset.productCategory,card.dataset.productCode,card.textContent].join(" ").toLocaleLowerCase("pt-BR");
    const match = (!term || haystack.includes(term)) && (!category.value || card.dataset.productCategory === category.value)
      && (stock.value !== "low" || card.dataset.productLow === "yes")
      && (stock.value !== "zero" || Number(card.dataset.productStock) <= 0);
    card.hidden = !match;
    if (match) visible += 1;
  });
  $("#product-results-count").textContent = visible === cards.length ? `${cards.length} ${cards.length === 1 ? "produto" : "produtos"} no catálogo` : `Mostrando ${visible} de ${cards.length} produtos`;
  let empty = list.querySelector(".filter-empty-state");
  if (cards.length && !visible) {
    if (!empty) { empty = document.createElement("div"); empty.className = "empty-state filter-empty-state"; empty.textContent = "Nenhum produto corresponde a estes filtros. Experimente outro termo ou escolha Todos."; list.append(empty); }
    empty.hidden = false;
  } else if (empty) empty.hidden = true;
}

let filtersBound = false;

export function renderProducts(renderEntryProductResults) {
  const activeProducts = products.filter((product) => !product.arquivado);
  $("#product-count").textContent = `${activeProducts.length} ${activeProducts.length === 1 ? "item" : "itens"}`;
  const list = $("#products-list");
  if (!activeProducts.length) {
    list.innerHTML = '<div class="empty-state">Nenhum produto ativo cadastrado.<br>Use o formulário acima para adicionar o primeiro.</div>';
  } else {
    list.innerHTML = [...activeProducts]
      .sort((a, b) => String(a.nome || "").localeCompare(String(b.nome || ""), "pt-BR"))
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
        return `<article class="product-card" data-product-name="${escapeHtml(product.nome)}" data-product-brand="${escapeHtml(product.marca || "")}" data-product-category="${escapeHtml(product.categoria || "")}" data-product-code="${escapeHtml(product.codigoInterno || "")}" data-product-stock="${Number(product.quantidade) || 0}" data-product-low="${low ? "yes" : "no"}">
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

  if (!filtersBound) {
    $("#product-list-search").addEventListener("input", applyProductFilters);
    $("#product-category-filter").addEventListener("change", applyProductFilters);
    $("#product-stock-filter").addEventListener("change", applyProductFilters);
    filtersBound = true;
  }
  applyProductFilters();
  renderEntryProductResults();
}
