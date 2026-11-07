import { onEvent } from "../utils.js?v=20261104-1";

export function initVistoriaUI({ startInventory, saveInventory, finishInventory, discardInventory, renderInventoryList, updateCount }) {
  onEvent("#inventory-start", "click", startInventory);
  onEvent("#inventory-save", "click", saveInventory);
  onEvent("#inventory-finish", "click", finishInventory);
  onEvent("#inventory-discard", "click", discardInventory);
  onEvent("#inventory-search", "input", renderInventoryList);
  onEvent("#inventory-only-uncounted", "change", renderInventoryList);
  onEvent("#inventory-list", "input", (event) => {
    const input = event.target.closest("[data-count-input]");
    if (!input) return;
    updateCount(input.dataset.countInput, input.value);
  });
}
