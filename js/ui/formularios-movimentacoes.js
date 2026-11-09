// formularios-movimentacoes.js — validação e submissão de Entradas e Saídas.
import { $, dateToday, fieldValue, cleanOption, onEvent } from "../utils.js?v=20261104-1";

export function initMovementFormsUI(dependencies) {
  const {
    storeSettings, saveEntryTransaction, saveExitTransaction, newEntryId, newExitId, attemptFor,
    selectedEntryProduct, readEntryAmounts, getSelectedExitProduct,
    setSelectedEntryProductId, setSelectedExitProductId,
    currentEmail, initDateFields, loadData, setFeedback, showToast, explainError
  } = dependencies;

  let entrySaving = false;
  let exitSaving = false;
  let entryAttempt = null;
  let exitAttempt = null;

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
    const supplier = cleanOption(fieldValue("#entry-supplier"));
    const notes = fieldValue("#entry-notes").trim();
    const pack = amounts.mode === "pack" ? {
      packs: amounts.packs,
      size: amounts.size,
      packCost: amounts.packCost
    } : null;
    // O ID da tentativa só é reaproveitado se o conteúdo for idêntico ao da tentativa anterior.
    entryAttempt = attemptFor(entryAttempt, JSON.stringify([product.id, quantidade, custoUnitario, data, supplier, notes, pack]), newEntryId);
    const result = await saveEntryTransaction({
      entryId: entryAttempt.id,
      productId: product.id,
      productName: product.nome || "",
      quantity: quantidade,
      unitCost: custoUnitario,
      date: data,
      supplier,
      notes,
      userEmail: currentEmail(),
      pack
    });
    saved = true;
    entryAttempt = null;
    $("#entry-form").reset();
    setSelectedEntryProductId("");
    initDateFields(true);
    setFeedback("#entry-feedback", result?.alreadySaved ? "Esta entrada já havia sido registrada. O saldo não foi alterado novamente." : "Entrada registrada.");
    showToast(result?.alreadySaved ? "Entrada já registrada." : "Entrada registrada.");
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
    const notes = fieldValue("#exit-notes").trim();
    exitAttempt = attemptFor(exitAttempt, JSON.stringify([product.id, quantidade, motivo, data, notes]), newExitId);
    const result = await saveExitTransaction({
      exitId: exitAttempt.id,
      productId: product.id,
      productName: product.nome || "",
      quantity: quantidade,
      reason: motivo,
      date: data,
      notes,
      userEmail: currentEmail()
    });
    saved = true;
    exitAttempt = null;
    $("#exit-form").reset();
    setSelectedExitProductId("");
    initDateFields(true);
    setFeedback("#exit-feedback", result?.alreadySaved ? "Esta saída já havia sido registrada. O saldo não foi alterado novamente." : "Saída registrada.");
    showToast(result?.alreadySaved ? "Saída já registrada." : "Saída registrada.");
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
