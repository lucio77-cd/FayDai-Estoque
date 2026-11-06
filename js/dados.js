// dados.js — leitura do Firestore e normalização dos registros para o estado do aplicativo.
// Não acessa a interface e não exibe avisos.
import { db, collection, getDocs } from "./firebase.js?v=20261104-1";

const CATALOG_OPTIONS_ID = "catalogo_opcoes_faydai";
const STORE_SETTINGS_ID = "configuracoes_faydai";
const INTERNAL_COUNTER_ID = "contador_codigo_interno_faydai";

export async function loadAppData() {
  const [productsSnap, entriesSnap, exitsSnap, salesSnap] = await Promise.all([
    getDocs(collection(db, "produtos")),
    getDocs(collection(db, "entradas")),
    getDocs(collection(db, "saidas")),
    getDocs(collection(db, "vendas"))
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
    const returnsSnap = await getDocs(collection(db, "devolucoes"));
    saleReturns = returnsSnap.docs.map((item) => ({ id: item.id, ...item.data() }));
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
    storeSettingsData
  };
}
