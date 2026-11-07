import { $, cleanOption, fieldValue, onEvent } from "../utils.js?v=20261104-1";
import { storeSettings } from "../estado.js?v=20261106-5";
import { saveStoreSettingsTransaction } from "../servicos/produtos.js?v=20261106-3";

function renderModuleAvailability() {
  const cajaActive = Boolean(storeSettings.caixaAtivo);
  const exitsActive = storeSettings.saidasAtivo !== false;
  $("#caja-disabled-notice").hidden = cajaActive;
  $("#caja-content").hidden = !cajaActive;
  $("#exits-disabled-notice").hidden = exitsActive;
  $("#exit-content").hidden = !exitsActive;
}

export function renderStoreSettings(isEditingProduct = false) {
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
  $("#product-barcode").disabled = !storeSettings.codigoBarrasAtivo && !isEditingProduct;
}


export function initConfiguracoesUI({ setFeedback, showToast, explainError, renderProducts, renderEntryProductResults, isEditingProduct }) {
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
    await saveStoreSettingsTransaction(settings);
    Object.assign(storeSettings, settings);
    renderStoreSettings(isEditingProduct());
    renderProducts(renderEntryProductResults);
    setFeedback("#settings-feedback", "Configurações salvas.");
    showToast("Configurações salvas.");
  } catch (error) {
    console.error("Falha ao salvar configurações:", error);
    setFeedback("#settings-feedback", explainError(error), true);
  } finally {
    submit.disabled = false;
  }
});
}
