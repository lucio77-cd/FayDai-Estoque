import { auth, signInWithEmailAndPassword, onAuthStateChanged, signOut } from "../firebase.js?v=20261109-7";
import { $, fieldValue, onEvent } from "../utils.js?v=20261104-1";
import { historyCutoff } from "../dados.js?v=20261110-3";

function switchTab(tabName) {
  document.querySelectorAll(".tab").forEach((button) => {
    const selected = button.dataset.tab === tabName;
    button.classList.toggle("active", selected);
    button.setAttribute("aria-selected", String(selected));
  });
  const welcome = $("#welcome");
  if (welcome) welcome.hidden = tabName !== "dashboard";
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

// A tela só carrega os últimos 90 dias. Uma venda, entrada ou saída com data mais antiga seria gravada,
// mas sumiria da tela. O "min" dos campos de data impede esse lançamento por engano.
function applyDateLimits() {
  const earliest = historyCutoff();
  ["#sale-date", "#entry-date", "#exit-date"].forEach((selector) => {
    const input = document.querySelector(selector);
    if (input) input.min = earliest;
  });
}

function showApp(isSignedIn) {
  $("#auth-loading-view").hidden = true;
  $("#login-view").hidden = isSignedIn;
  $("#app-view").hidden = !isSignedIn;
}

export function initSessionUI({ setFeedback, explainError, showToast, initDateFields, resetProductForm, loadData, clearSessionState }) {
  document.querySelectorAll(".tab").forEach((button) => {
    button.addEventListener("click", () => switchTab(button.dataset.tab));
  });
  // Se a tela ficar aberta de um dia para o outro, o limite acompanha a data.
  document.addEventListener("visibilitychange", () => { if (!document.hidden) applyDateLimits(); });
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
    applyDateLimits();
    resetProductForm();
    try { await loadData(); }
    catch (error) {
      console.error("Falha ao carregar dados:", error);
      showToast(explainError(error));
      // Conta sem autorização no Firestore: sai da conta para não deixar o app aberto e vazio.
      if (String(error?.code || "").includes("permission-denied")) {
        try { await signOut(auth); }
        catch (signOutError) { console.error("Falha ao sair após acesso negado:", signOutError); }
        return;
      }
    }
    switchTab("dashboard");
    showTutorialIfNeeded();
  });
}

export { switchTab };
