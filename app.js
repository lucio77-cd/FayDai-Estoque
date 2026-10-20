import { initializeApp } from "https://www.gstatic.com/firebasejs/10.12.5/firebase-app.js";
import {
  getAuth, signInWithEmailAndPassword, onAuthStateChanged, signOut
} from "https://www.gstatic.com/firebasejs/10.12.5/firebase-auth.js";
import {
  getFirestore, collection, getDocs, doc, writeBatch, addDoc,
  runTransaction, serverTimestamp, deleteDoc, updateDoc
} from "https://www.gstatic.com/firebasejs/10.12.5/firebase-firestore.js";

// Configuração do aplicativo web FayDai-Estoque.
const firebaseConfig = {
  apiKey: "AIzaSyDQw-x8-GUxkS41pAiOYwJjawgnMvxyuYk",
  authDomain: "faydai-estoque.firebaseapp.com",
  projectId: "faydai-estoque",
  storageBucket: "faydai-estoque.firebasestorage.app",
  messagingSenderId: "703117192541",
  appId: "1:703117192541:web:3eeeba198d137eee440cb4",
  measurementId: "G-W6ET4LEQHM"
};

const app = initializeApp(firebaseConfig);
const auth = getAuth(app);
const db = getFirestore(app);

const $ = (selector) => document.querySelector(selector);
const money = (value) => new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" }).format(Number(value) || 0);
const dateToday = () => {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`;
};
const escapeHtml = (value = "") => String(value).replace(/[&<>"']/g, (char) => ({
  "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;"
}[char]));

let products = [];
let entries = [];
let toastTimeout;

function showToast(message) {
  const toast = $("#toast");
  toast.textContent = message;
  toast.classList.add("show");
  clearTimeout(toastTimeout);
  toastTimeout = setTimeout(() => toast.classList.remove("show"), 2800);
}

function setFeedback(selector, message, isError = false) {
  const element = $(selector);
  element.textContent = message;
  element.classList.toggle("error", isError);
}

function explainError(error) {
  const code = error?.code || "";
  const messages = {
    "auth/invalid-credential": "E-mail ou senha incorretos.",
    "auth/invalid-email": "Confira o formato do e-mail.",
    "auth/user-disabled": "Esta conta está desativada no Firebase.",
    "auth/too-many-requests": "Muitas tentativas. Aguarde um pouco e tente novamente.",
    "auth/network-request-failed": "Falha de conexão. Confira sua internet.",
    "permission-denied": "O Firestore negou o acesso. Confira as regras e se o e-mail da conta está verificado.",
    "unavailable": "O Firebase está temporariamente indisponível. Tente novamente."
  };
  return messages[code] || (code.includes("permission-denied")
    ? "Acesso negado pelo Firestore. Confira as regras publicadas e a verificação do e-mail."
    : error?.message || "Ocorreu um erro inesperado.");
}

function showApp(isSignedIn) {
  $("#login-view").hidden = isSignedIn;
  $("#app-view").hidden = !isSignedIn;
}

function switchTab(tabName) {
  document.querySelectorAll(".tab").forEach((button) => {
    button.classList.toggle("active", button.dataset.tab === tabName);
  });
  document.querySelectorAll(".tab-panel").forEach((panel) => {
    panel.hidden = panel.id !== `${tabName}-panel`;
  });
}

function showTutorialIfNeeded() {
  if (localStorage.getItem("faydai-tutorial-dismissed") !== "yes") {
    $("#tutorial-overlay").hidden = false;
  }
}

function closeTutorialForNow() {
  $("#tutorial-overlay").hidden = true;
}

function renderProducts() {
  const activeProducts = products.filter((product) => !product.arquivado);
  $("#product-count").textContent = `${activeProducts.length} ${activeProducts.length === 1 ? "item" : "itens"}`;
  const list = $("#products-list");
  if (!activeProducts.length) {
    list.innerHTML = '<div class="empty-state">Nenhum produto ativo cadastrado.<br>Use o formulário acima para adicionar o primeiro.</div>';
  } else {
    list.innerHTML = [...activeProducts]
      .sort((a, b) => a.nome.localeCompare(b.nome, "pt-BR"))
      .map((product) => {
        const suggested = (Number(product.custo) || 0) * (1 + (Number(product.percentualGanho) || 0) / 100);
        return `<article class="product-card">
          <div class="item-title-row">
            <div class="item-title">${escapeHtml(product.nome)}</div>
            <span class="stock-badge">${Number(product.quantidade) || 0} un.</span>
          </div>
          ${product.descricao ? `<p class="item-description">${escapeHtml(product.descricao)}</p>` : ""}
          <div class="item-meta">
            <div><span>Custo cadastrado</span><strong>${money(product.custo)}</strong></div>
            <div><span>Preço sugerido</span><strong>${money(suggested)}</strong></div>
            <div><span>Ganho sobre custo</span><strong>${(Number(product.percentualGanho) || 0).toLocaleString("pt-BR")}%</strong></div>
            <div><span>Cadastro</span><strong>${product.criadoEmData ? new Date(product.criadoEmData + "T12:00:00").toLocaleDateString("pt-BR") : "—"}</strong></div>
          </div>
          <div class="product-actions">
            <button class="button danger-outline" type="button" data-delete-product="${escapeHtml(product.id)}">Excluir produto</button>
          </div>
        </article>`;
      }).join("");
  }

  const select = $("#entry-product");
  const previousValue = select.value;
  select.innerHTML = '<option value="">Selecione um produto</option>' + [...activeProducts]
    .sort((a, b) => a.nome.localeCompare(b.nome, "pt-BR"))
    .map((product) => `<option value="${escapeHtml(product.id)}">${escapeHtml(product.nome)} — saldo: ${Number(product.quantidade) || 0}</option>`)
    .join("");
  if (activeProducts.some((product) => product.id === previousValue)) select.value = previousValue;
}

function renderEntries() {
  const list = $("#entries-list");
  if (!entries.length) {
    list.innerHTML = '<div class="empty-state">Nenhuma entrada registrada ainda.</div>';
    return;
  }
  list.innerHTML = [...entries]
    .sort((a, b) => String(b.data || "").localeCompare(String(a.data || "")) || (b.criadoEmMs || 0) - (a.criadoEmMs || 0))
    .map((entry) => `<article class="entry-card">
      <div class="item-title-row"><div class="item-title">${escapeHtml(entry.produtoNome || "Produto")}</div><span class="stock-badge">+${Number(entry.quantidade) || 0} un.</span></div>
      <p>${escapeHtml(entry.data || "Data não informada")} · Custo unitário: ${money(entry.custoUnitario)}</p>
      ${entry.fornecedor ? `<p>Fornecedor: ${escapeHtml(entry.fornecedor)}</p>` : ""}
      ${entry.observacao ? `<p>${escapeHtml(entry.observacao)}</p>` : ""}
      <div class="item-meta"><div><span>Total informado da compra</span><strong>${money((Number(entry.quantidade) || 0) * (Number(entry.custoUnitario) || 0))}</strong></div><div><span>Registro</span><strong>${entry.data ? escapeHtml(entry.data.split("-").reverse().join("/")) : "—"}</strong></div></div>
    </article>`).join("");
}

async function loadData() {
  const user = auth.currentUser;
  if (!user) return;
  try {
    const [productSnapshot, entrySnapshot] = await Promise.all([
      getDocs(collection(db, "produtos")),
      getDocs(collection(db, "entradas"))
    ]);
    products = productSnapshot.docs.map((item) => ({ id: item.id, ...item.data() }));
    entries = entrySnapshot.docs.map((item) => {
      const data = item.data();
      return { id: item.id, ...data, criadoEmMs: data.criadoEm?.toMillis?.() || 0 };
    });
    renderProducts();
    renderEntries();
  } catch (error) {
    console.error("Falha ao carregar dados do Firestore:", error);
    showToast(explainError(error));
    if (error?.code?.includes("permission-denied")) {
      showToast("Acesso negado. Confira as regras do Firestore e se a conta autenticada tem permissão.");
    }
  }
}

$("#login-form").addEventListener("submit", async (event) => {
  event.preventDefault();
  const button = event.currentTarget.querySelector('button[type="submit"]');
  button.disabled = true;
  button.textContent = "Entrando…";
  setFeedback("#login-error", "");
  try {
    const email = $("#login-email").value.trim();
    const password = $("#login-password").value;
    await signInWithEmailAndPassword(auth, email, password);
  } catch (error) {
    setFeedback("#login-error", explainError(error), true);
  } finally {
    button.disabled = false;
    button.textContent = "Entrar";
  }
});

$("#logout-button").addEventListener("click", async () => {
  try {
    closeTutorialForNow();
    await signOut(auth);
    $("#login-password").value = "";
  } catch (error) {
    showToast(explainError(error));
  }
});

onAuthStateChanged(auth, async (user) => {
  showApp(Boolean(user));
  if (user) {
    await loadData();
    showTutorialIfNeeded();
  } else {
    $("#tutorial-overlay").hidden = true;
  }
});

document.querySelectorAll(".tab").forEach((button) => {
  button.addEventListener("click", () => switchTab(button.dataset.tab));
});

const updateSuggestedPrice = () => {
  const cost = Number($("#product-cost").value) || 0;
  const gain = Number($("#product-gain").value) || 0;
  $("#suggested-price").textContent = money(cost * (1 + gain / 100));
};
$("#product-cost").addEventListener("input", updateSuggestedPrice);
$("#product-gain").addEventListener("input", updateSuggestedPrice);

$("#product-form").addEventListener("submit", async (event) => {
  event.preventDefault();
  const form = event.currentTarget;
  const button = event.currentTarget.querySelector('button[type="submit"]');
  button.disabled = true;
  setFeedback("#product-feedback", "Salvando…");
  const nome = $("#product-name").value.trim();
  const descricao = $("#product-description").value.trim();
  const custo = Number($("#product-cost").value);
  const percentualGanho = Number($("#product-gain").value);
  const quantidade = Number($("#product-quantity").value);
  if (!nome || !Number.isFinite(custo) || custo < 0 || !Number.isFinite(percentualGanho) || percentualGanho < 0 || !Number.isInteger(quantidade) || quantidade < 0) {
    setFeedback("#product-feedback", "Confira os campos e informe quantidades inteiras não negativas.", true);
    button.disabled = false;
    return;
  }

  const normalizeName = (value) => String(value || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .trim()
    .replace(/\s+/g, " ")
    .toLocaleLowerCase("pt-BR");
  const duplicate = products.find((product) =>
    !product.arquivado && normalizeName(product.nome) === normalizeName(nome)
  );
  if (duplicate) {
    setFeedback("#product-feedback", `Já existe um produto ativo chamado "${duplicate.nome}". Confira a lista antes de salvar outro.`, true);
    button.disabled = false;
    return;
  }

  try {
    const batch = writeBatch(db);
    const productRef = doc(collection(db, "produtos"));
    const user = auth.currentUser;
    batch.set(productRef, {
      nome, descricao, custo, percentualGanho, quantidade,
      criadoEm: serverTimestamp(),
      criadoEmData: dateToday(),
      criadoPor: user?.email || null,
      atualizadoEm: serverTimestamp()
    });
    if (quantidade > 0) {
      const entryRef = doc(collection(db, "entradas"));
      batch.set(entryRef, {
        produtoId: productRef.id,
        produtoNome: nome,
        quantidade,
        custoUnitario: custo,
        data: dateToday(),
        fornecedor: "",
        observacao: "Estoque inicial no cadastro do produto",
        tipo: "estoque_inicial",
        criadoEm: serverTimestamp(),
        criadoPor: user?.email || null
      });
    }
    await batch.commit();
    form.reset();
    $("#product-gain").value = "20";
    $("#product-quantity").value = "0";
    updateSuggestedPrice();
    setFeedback("#product-feedback", "Produto salvo com sucesso.");
    await loadData();
    showToast("Produto cadastrado.");
  } catch (error) {
    console.error("Falha ao salvar produto:", error);
    setFeedback("#product-feedback", explainError(error), true);
  } finally {
    button.disabled = false;
  }
});

$("#entry-date").value = dateToday();
$("#entry-form").addEventListener("submit", async (event) => {
  event.preventDefault();
  const form = event.currentTarget;
  const button = event.currentTarget.querySelector('button[type="submit"]');
  button.disabled = true;
  setFeedback("#entry-feedback", "Registrando entrada…");
  const productId = $("#entry-product").value;
  const quantity = Number($("#entry-quantity").value);
  const unitCost = Number($("#entry-cost").value);
  const date = $("#entry-date").value;
  const supplier = $("#entry-supplier").value.trim();
  const notes = $("#entry-notes").value.trim();
  if (!productId || !Number.isInteger(quantity) || quantity < 1 || !Number.isFinite(unitCost) || unitCost < 0 || !date) {
    setFeedback("#entry-feedback", "Confira o produto, a quantidade, o custo e a data.", true);
    button.disabled = false;
    return;
  }
  try {
    const productRef = doc(db, "produtos", productId);
    await runTransaction(db, async (transaction) => {
      const productSnapshot = await transaction.get(productRef);
      if (!productSnapshot.exists()) throw new Error("Este produto não existe mais. Atualize a lista e tente novamente.");
      const product = productSnapshot.data();
      const entryRef = doc(collection(db, "entradas"));
      transaction.update(productRef, {
        quantidade: (Number(product.quantidade) || 0) + quantity,
        atualizadoEm: serverTimestamp()
      });
      transaction.set(entryRef, {
        produtoId: productId,
        produtoNome: product.nome,
        quantidade,
        custoUnitario: unitCost,
        data: date,
        fornecedor: supplier,
        observacao: notes,
        tipo: "entrada",
        criadoEm: serverTimestamp(),
        criadoPor: auth.currentUser?.email || null
      });
    });
    form.reset();
    $("#entry-date").value = dateToday();
    setFeedback("#entry-feedback", "Entrada registrada e estoque atualizado.");
    await loadData();
    showToast("Entrada registrada.");
  } catch (error) {
    console.error("Falha ao registrar entrada:", error);
    setFeedback("#entry-feedback", explainError(error), true);
  } finally {
    button.disabled = false;
  }
});

$("#products-list").addEventListener("click", async (event) => {
  const button = event.target.closest("[data-delete-product]");
  if (!button) return;

  const productId = button.dataset.deleteProduct;
  const product = products.find((item) => item.id === productId);
  if (!product || product.arquivado) return;

  const confirmed = window.confirm(
    `Deseja excluir o produto "${product.nome}"?\\n\\nSe houver estoque ou histórico de entradas, ele será arquivado para preservar os registros. Caso contrário, será excluído permanentemente.`
  );
  if (!confirmed) return;

  button.disabled = true;
  button.textContent = "Processando…";
  try {
    const hasHistory = entries.some((entry) => entry.produtoId === productId);
    const hasStock = (Number(product.quantidade) || 0) > 0;

    if (hasHistory || hasStock) {
      await updateDoc(doc(db, "produtos", productId), {
        arquivado: true,
        arquivadoEm: serverTimestamp(),
        arquivadoPor: auth.currentUser?.email || null,
        atualizadoEm: serverTimestamp()
      });
      showToast("Produto arquivado. O histórico foi preservado.");
    } else {
      await deleteDoc(doc(db, "produtos", productId));
      showToast("Produto excluído.");
    }
    await loadData();
  } catch (error) {
    console.error("Falha ao excluir/arquivar produto:", error);
    showToast(explainError(error));
    button.disabled = false;
    button.textContent = "Excluir produto";
  }
});

$("#refresh-products").addEventListener("click", loadData);
$("#refresh-entries").addEventListener("click", loadData);
$("#show-tutorial").addEventListener("click", () => { $("#tutorial-overlay").hidden = false; });
$("#tutorial-close").addEventListener("click", closeTutorialForNow);
$("#tutorial-understood").addEventListener("click", closeTutorialForNow);
$("#tutorial-never").addEventListener("click", () => {
  localStorage.setItem("faydai-tutorial-dismissed", "yes");
  closeTutorialForNow();
  showToast("O tutorial não será exibido automaticamente.");
});
$("#tutorial-overlay").addEventListener("click", (event) => {
  if (event.target === $("#tutorial-overlay")) closeTutorialForNow();
});
