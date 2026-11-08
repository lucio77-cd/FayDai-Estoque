// formularios-movimentacoes.js — validação e submissão de Entradas e Saídas.
import { $, dateToday, fieldValue, cleanOption, onEvent } from "../utils.js?v=20261104-1";

export function initMovementFormsUI(dependencies) {
  const {
    storeSettings, saveEntryTransaction, saveExitTransaction,
    selectedEntryProduct, readEntryAmounts, getSelectedExitProduct,
    setSelectedEntryProductId, setSelectedExitProductId,
    currentEmail, initDateFields, loadData, setFeedback, showToast, explainError
  } = dependencies;

  let entrySaving = false;
  let exitSaving = false;

  async function saveEntry(event) {
  event.preventDefault();
  if (entrySaving) return;
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

  entrySaving = true;
  submit.disabled = true;
  setFeedback("#entry-feedback", "Registrando…");
  let saved = false;
  try {
    await saveEntryTransaction({
      productId: product.id,
      productName: product.nome || "",
      quantity: quantidade,
      unitCost: custoUnitario,
      date: data,
      supplier: cleanOption(fieldValue("#entry-supplier")),
      notes: fieldValue("#entry-notes").trim(),
      userEmail: currentEmail(),
      pack: amounts.mode === "pack" ? {
        packs: amounts.packs,
        size: amounts.size,
        packCost: amounts.packCost
      } : null
    });
    saved = true;
    $("#entry-form").reset();
    setSelectedEntryProductId("");
    initDateFields(true);
    setFeedback("#entry-feedback", "Entrada registrada.");
    showToast("Entrada registrada.");
    try {
      await loadData();
    } catch (refreshError) {
      console.error("Entrada salva, mas falhou a atualização da tela:", refreshError);
      setFeedback("#entry-feedback", "Entrada registrada. Não registre novamente. Atualize a página para atualizar os saldos.", true);
    }
  } catch (error) {
    console.error(saved ? "Entrada salva, mas houve falha ao atualizar a tela:" : "Falha ao registrar entrada:", error);
    setFeedback("#entry-feedback", saved
      ? "Entrada registrada. Não registre novamente. Atualize a página."
      : explainError(error), true);
  } finally {
    entrySaving = false;
    submit.disabled = false;
  }
}
  onEvent("#entry-form", "submit", saveEntry);

  async function saveExit(event) {
  event.preventDefault();
  if (exitSaving) return;
  if (storeSettings.saidasAtivo === false) return setFeedback("#exit-feedback", "O módulo Saídas está desativado.", true);
  const submit = $("#exit-form button[type=submit]");
  const product = getSelectedExitProduct();
  if (!product) return setFeedback("#exit-feedback", "Selecione um produto da lista.", true);
  const quantidade = Number(fieldValue("#exit-quantity"));
  const motivo = fieldValue("#exit-reason");
  const data = fieldValue("#exit-date") || dateToday();
  if (!Number.isInteger(quantidade) || quantidade < 1) return setFeedback("#exit-feedback", "A quantidade deve ser um número inteiro maior que zero.", true);
  if (!motivo) return setFeedback("#exit-feedback", "Selecione o motivo da saída.", true);

  exitSaving = true;
  submit.disabled = true;
  setFeedback("#exit-feedback", "Registrando…");
  let saved = false;
  try {
    await saveExitTransaction({
      productId: product.id,
      productName: product.nome || "",
      quantity: quantidade,
      reason: motivo,
      date: data,
      notes: fieldValue("#exit-notes").trim(),
      userEmail: currentEmail()
    });
    saved = true;
    $("#exit-form").reset();
    setSelectedExitProductId("");
    initDateFields(true);
    setFeedback("#exit-feedback", "Saída registrada.");
    showToast("Saída registrada.");
    try {
      await loadData();
    } catch (refreshError) {
      console.error("Saída salva, mas falhou a atualização da tela:", refreshError);
      setFeedback("#exit-feedback", "Saída registrada. Não registre novamente. Atualize a página para atualizar os saldos.", true);
    }
  } catch (error) {
    console.error(saved ? "Saída salva, mas houve falha ao atualizar a tela:" : "Falha ao registrar saída:", error);
    setFeedback("#exit-feedback", saved
      ? "Saída registrada. Não registre novamente. Atualize a página."
      : explainError(error), true);
  } finally {
    exitSaving = false;
    submit.disabled = false;
  }
}
  onEvent("#exit-form", "submit", saveExit);
}
