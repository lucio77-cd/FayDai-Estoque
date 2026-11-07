import { onEvent, parseDecimal, roundMoney } from "../utils.js?v=20261104-1";
import { products, saleCart, replaceArray } from "../estado.js?v=20261106-5";

export function initCaixaTelaUI({ renderSaleProductResults, addProductToSaleCart, setFeedback, renderSaleCart, updateCartRow, updateCartSummary, finishSale }) {
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

onEvent("#sale-form", "submit", finishSale);

onEvent("#sale-clear-button", "click", () => {
  if (!saleCart.length) return;
  if (!window.confirm("Limpar todos os itens da compra?")) return;
  replaceArray(saleCart);
  setFeedback("#sale-feedback", "");
  renderSaleCart();
});

}
