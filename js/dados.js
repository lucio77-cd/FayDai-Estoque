// dados.js — leitura do Firestore e normalização dos registros para o estado do aplicativo.
// Não acessa a interface e não exibe avisos.
import { db, collection, getDocs, getDoc, doc, query, where } from "./firebase.js?v=20261109-7";
import { CATALOG_OPTIONS_ID, STORE_SETTINGS_ID, INTERNAL_COUNTER_ID } from "./constantes.js?v=20261107-1";
import { toDateString } from "./utils.js?v=20261104-1";

// Janela do histórico carregado na tela: vendas, entradas, saídas e devoluções dos últimos N dias.
// Produtos e vistorias sempre vêm completos (o saldo está no próprio produto, não no histórico).
// O histórico inteiro continua no banco e sai por completo na exportação CSV (loadAppData({ completo: true })).
export const JANELA_HISTORICO_DIAS = 90;

// Primeiro dia (AAAA-MM-DD, horário local) incluído na janela.
export function historyCutoff(days = JANELA_HISTORICO_DIAS, now = new Date()) {
  return toDateString(new Date(now.getFullYear(), now.getMonth(), now.getDate() - days));
}

// Uma devolução recente pode ser de uma venda antiga (fora da janela). O Painel precisa da forma de
// pagamento da venda original para descontar a devolução do lugar certo, então ela é buscada à parte
// e guardada na própria devolução em memória (campo formaPagamentoVenda, nunca gravado no banco).
async function attachPaymentOfOlderSales(returns, sales) {
  const loaded = new Set(sales.map((sale) => sale.id));
  const missing = [...new Set(returns.map((item) => item.vendaId).filter((id) => id && !loaded.has(id)))].slice(0, 50);
  if (!missing.length) return;
  const found = await Promise.all(missing.map(async (saleId) => {
    try {
      const snapshot = await getDoc(doc(db, "vendas", saleId));
      return snapshot.exists() ? [saleId, snapshot.data().formaPagamento || ""] : null;
    } catch (error) {
      console.error("Não foi possível ler a venda original de uma devolução:", error);
      return null;
    }
  }));
  const payments = new Map(found.filter(Boolean));
  returns.forEach((item) => {
    if (payments.has(item.vendaId)) item.formaPagamentoVenda = payments.get(item.vendaId);
  });
}

export async function loadAppData({ completo = false, now = new Date() } = {}) {
  const cutoff = completo ? null : historyCutoff(JANELA_HISTORICO_DIAS, now);

  // Proteção: se o banco recusar a consulta com janela (por exemplo, regras que só liberam leitura da
  // coleção inteira), lê a coleção inteira em vez de deixar a tela da loja sem dados.
  let janelaComFalha = false;
  const readHistory = async (name) => {
    if (!cutoff) return getDocs(collection(db, name));
    try {
      return await getDocs(query(collection(db, name), where("data", ">=", cutoff)));
    } catch (error) {
      console.warn(`A consulta com janela de ${JANELA_HISTORICO_DIAS} dias falhou em "${name}"; lendo a coleção inteira.`, error);
      janelaComFalha = true;
      return getDocs(collection(db, name));
    }
  };

  const [productsSnap, entriesSnap, exitsSnap, salesSnap] = await Promise.all([
    getDocs(collection(db, "produtos")),
    readHistory("entradas"),
    readHistory("saidas"),
    readHistory("vendas")
  ]);

  const specialIds = new Set([CATALOG_OPTIONS_ID, STORE_SETTINGS_ID, INTERNAL_COUNTER_ID]);
  let catalogData = {};
  let storeSettingsData = {};
  const products = [];
  productsSnap.docs.forEach((item) => {
    if (item.id === CATALOG_OPTIONS_ID) catalogData = item.data();
    else if (item.id === STORE_SETTINGS_ID) storeSettingsData = item.data();
    else if (!specialIds.has(item.id)) products.push({ id: item.id, ...item.data() });
  });

  const entries = entriesSnap.docs.map((item) => ({ id: item.id, ...item.data() }));
  const exits = exitsSnap.docs.map((item) => ({ id: item.id, ...item.data() }));
  const sales = salesSnap.docs.map((item) => ({ id: item.id, ...item.data() }));

  let saleReturns = [];
  let saleReturnsAvailable = true;
  let returnsError = null;
  try {
    const returnsSnap = await readHistory("devolucoes");
    saleReturns = returnsSnap.docs.map((item) => ({ id: item.id, ...item.data() }));
    if (cutoff) await attachPaymentOfOlderSales(saleReturns, sales);
  } catch (error) {
    saleReturnsAvailable = false;
    returnsError = error;
  }

  let activeVistoria = null;
  let inventoryHistory = [];
  let inventoryAvailable = true;
  let inventoryError = null;
  try {
    const inventorySnap = await getDocs(collection(db, "vistorias"));
    const all = inventorySnap.docs.map((item) => {
      const data = item.data();
      return {
        id: item.id,
        ...data,
        atualizadoEmMs: data.atualizadoEm?.toMillis ? data.atualizadoEm.toMillis() : 0
      };
    });
    activeVistoria = all.find((item) => item.status === "em_andamento") || null;
    inventoryHistory = all.filter((item) => item.status === "concluida")
      .sort((a, b) => String(b.dataHora || "").localeCompare(String(a.dataHora || "")))
      .slice(0, 30);
  } catch (error) {
    inventoryAvailable = false;
    inventoryError = error;
  }

  return {
    products,
    entries,
    exits,
    sales,
    saleReturns,
    saleReturnsAvailable,
    returnsError,
    activeVistoria,
    inventoryHistory,
    inventoryAvailable,
    inventoryError,
    catalogData,
    storeSettingsData,
    historicoCompleto: !cutoff,
    historicoDesde: cutoff,
    janelaComFalha
  };
}
