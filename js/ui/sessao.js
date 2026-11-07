import { auth, signInWithEmailAndPassword, onAuthStateChanged, signOut } from "../firebase.js?v=20261104-1";
import { $, fieldValue, onEvent } from "../utils.js?v=20261104-1";

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

function showApp(isSignedIn) {
  $("#auth-loading-view").hidden = true;
  $("#login-view").hidden = isSignedIn;
  $("#app-view").hidden = !isSignedIn;
}

function showTutorialIfNeeded() {
  let dismissed = false;
  try { dismissed = localStorage.getItem("faydai-tutorial-dismissed") === "yes"; }
  catch (error) { console.warn("Não foi possível ler a preferência do tutorial:", error); }
  if (!dismissed) $("#tutorial-overlay").hidden = false;
}

function closeTutorialForNow() { $("#tutorial-overlay").hidden = true; }

export function initSessionUI({ setFeedback, explainError, showToast, initDateFields, resetProductForm, loadData, clearSessionState }) {
  document.querySelectorAll(".tab").forEach((button) => {
    button.addEventListener("click", () => switchTab(button.dataset.tab));
  });
  onEvent("#tutorial-close", "click", closeTutorialForNow);
  onEvent("#tutorial-understood", "click", closeTutorialForNow);
  onEvent("#tutorial-never", "click", () => {
    try { localStorage.setItem("faydai-tutorial-dismissed", "yes"); }
    catch (error) { console.warn("Não foi possível salvar a preferência do tutorial:", error); }
    closeTutorialForNow();
  });
  onEvent("#show-tutorial", "click", () => { $("#tutorial-overlay").hidden = false; });
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
    } finally { submit.disabled = false; }
  });
  onEvent("#logout-button", "click", async () => {
    try { await signOut(auth); }
    catch (error) { console.error("Falha ao sair:", error); showToast(explainError(error)); }
  });
  onAuthStateChanged(auth, async (user) => {
    if (!user) { clearSessionState(); showApp(false); return; }
    showApp(true);
    initDateFields(true);
    resetProductForm();
    try { await loadData(); }
    catch (error) { console.error("Falha ao carregar dados:", error); showToast(explainError(error)); }
    switchTab("dashboard");
    showTutorialIfNeeded();
  });
}

export { switchTab };
