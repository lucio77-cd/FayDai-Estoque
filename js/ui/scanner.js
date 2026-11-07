// scanner.js — integração do leitor de código de barras com as telas.
import { $, normalizeText, cleanOption } from "../utils.js?v=20261104-1";

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

function scanMatches(rawCode, products) {
  const code = normalizeText(rawCode);
  if (!code) return [];
  const active = products.filter((product) => !product.arquivado);
  const byCode = active.filter((product) => normalizeText(product.codigoBarras) === code
    || normalizeText(product.codigoInterno) === code);
  return byCode.length ? byCode : active.filter((product) => normalizeText(product.nome) === code);
}

function resolveScannedProduct(rawCode, inputSelector, feedbackSelector, dependencies) {
  const text = String(rawCode || "").trim();
  const matches = scanMatches(text, dependencies.getProducts());
  if (matches.length === 1) {
    dependencies.setFeedback(feedbackSelector, "");
    return matches[0];
  }
  if (matches.length > 1) {
    scanBeep(false);
    dependencies.setFeedback(feedbackSelector, "Mais de um produto com este código. Escolha na lista.", true);
    return null;
  }
  if (/^\d{6,}$/.test(text)) {
    scanBeep(false);
    dependencies.setFeedback(feedbackSelector, `Código ${text} não encontrado. Confira o cadastro do produto.`, true);
    const input = $(inputSelector);
    input.value = "";
    input.dispatchEvent(new Event("input", { bubbles: true }));
    return null;
  }
  dependencies.setFeedback(feedbackSelector, "Nenhum produto com exatamente este código ou nome. Toque em um item da lista.", true);
  return null;
}

function bindScanner(selector, handleCode, dependencies) {
  $(selector).addEventListener("keydown", (event) => {
    if (event.key !== "Enter" && event.key !== "Tab") return;
    const value = event.currentTarget.value.trim();
    if (event.key === "Tab" && !(value && scanMatches(value, dependencies.getProducts()).length)) return;
    event.preventDefault();
    if (value) handleCode(value);
  });
}

export function initScanner(dependencies) {
  bindScanner("#sale-product-search", (rawCode) => {
    const product = resolveScannedProduct(rawCode, "#sale-product-search", "#sale-feedback", dependencies);
    if (!product) return;
    const barcode = normalizeText(product.codigoBarras);
    const origin = barcode && barcode === normalizeText(rawCode) ? "leitor" : "busca";
    const added = dependencies.addProductToSaleCart(product, origin);
    scanBeep(added);
    if (!added) {
      $("#sale-product-search").value = "";
      dependencies.renderSaleProductResults();
      $("#sale-product-search").focus();
    }
  }, dependencies);

  bindScanner("#entry-product-search", (rawCode) => {
    const product = resolveScannedProduct(rawCode, "#entry-product-search", "#entry-feedback", dependencies);
    if (!product) return;
    scanBeep(true);
    dependencies.setSelectedEntryProductId(product.id);
    $("#entry-product-search").value = product.nome;
    dependencies.renderEntryProductResults();
    $("#entry-quantity").focus();
  }, dependencies);

  bindScanner("#exit-product-search", (rawCode) => {
    const product = resolveScannedProduct(rawCode, "#exit-product-search", "#exit-feedback", dependencies);
    if (!product) return;
    scanBeep(true);
    dependencies.setSelectedExitProductId(product.id);
    $("#exit-product-search").value = product.nome;
    dependencies.renderExitProductResults();
    $("#exit-quantity").focus();
  }, dependencies);

  bindScanner("#inventory-search", (rawCode) => {
    const product = resolveScannedProduct(rawCode, "#inventory-search", "#inventory-scan-feedback", dependencies);
    if (!product) return;
    const parsed = dependencies.parseInventoryCount(dependencies.getInventoryCount(product.id));
    const next = parsed.state === "counted" ? parsed.value + 1 : 1;
    dependencies.setInventoryCount(product.id, String(next));
    dependencies.markInventoryDirty();
    scanBeep(true);
    dependencies.setFeedback("#inventory-scan-feedback", `${product.nome}: contagem ${next} (saldo no sistema: ${Number(product.quantidade) || 0})`);
    $("#inventory-search").value = "";
    dependencies.renderInventoryList();
    dependencies.updateInventorySummary();
    $("#inventory-search").focus();
  }, dependencies);

  $("#product-barcode").addEventListener("keydown", (event) => {
    if (event.key !== "Enter") return;
    event.preventDefault();
    const input = $("#product-barcode");
    const code = cleanOption(input.value);
    input.value = code;
    if (!code) return;
    const duplicate = dependencies.getProducts().find((product) => product.id !== dependencies.getEditingProductId()
      && !product.arquivado && String(product.codigoBarras || "") === code);
    if (duplicate) {
      scanBeep(false);
      const message = `Este código de barras já está associado ao produto "${duplicate.nome}".`;
      dependencies.setFeedback("#product-feedback", message, true);
      dependencies.showToast(message);
      return;
    }
    scanBeep(true);
    dependencies.setFeedback("#product-feedback", "");
    $("#product-description").focus();
  });
}
