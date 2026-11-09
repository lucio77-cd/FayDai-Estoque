// produtos.js — persistência de produtos, códigos internos, histórico de custos e configurações.
// Este módulo não acessa a interface nem exibe mensagens.
import {
  db, collection, doc, runTransaction, serverTimestamp, arrayUnion, writeBatch, query, where
} from "../firebase.js?v=20261104-1";
import { roundMoney, normalizeText } from "../utils.js?v=20261104-1";
import { CATALOG_OPTIONS_ID, STORE_SETTINGS_ID, INTERNAL_COUNTER_ID } from "../constantes.js?v=20261107-1";

async function reserveInternalCode(transaction, products) {
  const counterRef = doc(db, "produtos", INTERNAL_COUNTER_ID);
  const snap = await transaction.get(counterRef);
  const existingMax = products.reduce((max, product) => {
    const match = String(product.codigoInterno || "").match(/^FON(\d+)$/i);
    return match ? Math.max(max, Number(match[1]) || 0) : max;
  }, 0);
  const next = Math.max(Number(snap.data()?.ultimoNumero) || 0, existingMax) + 1;
  return {
    code: "FON" + String(next).padStart(3, "0"),
    commit: () => transaction.set(counterRef, { ultimoNumero: next, atualizadoEm: serverTimestamp() }, { merge: true })
  };
}

export async function saveProductTransaction({
  productId = null,
  data,
  products = [],
  brands = [],
  categories = [],
  suggestedCategories = [],
  internalCodeEnabled = false,
  today,
  userEmail = "Usuário não identificado"
}) {
  const catalogRef = doc(db, "produtos", CATALOG_OPTIONS_ID);
  const catalogUpdate = {};
  if (data.marca && !brands.some((value) => normalizeText(value) === normalizeText(data.marca))) {
    catalogUpdate.marcas = arrayUnion(data.marca);
  }
  if (data.categoria && ![...suggestedCategories, ...categories].some((value) => normalizeText(value) === normalizeText(data.categoria))) {
    catalogUpdate.categorias = arrayUnion(data.categoria);
  }
  const hasCatalogUpdate = Object.keys(catalogUpdate).length > 0;

  if (productId) {
    const productRef = doc(db, "produtos", productId);
    await runTransaction(db, async (transaction) => {
      const snapshot = await transaction.get(productRef);
      if (!snapshot.exists()) throw new Error("Este produto não existe mais. Atualize a lista.");
      const current = snapshot.data();
      const reservation = (!current.codigoInterno && internalCodeEnabled)
        ? await reserveInternalCode(transaction, products)
        : null;
      const changes = {
        nome: data.nome,
        descricao: data.descricao,
        marca: data.marca,
        categoria: data.categoria,
        ...data.packFields,
        codigoInterno: reservation ? reservation.code : (current.codigoInterno || ""),
        codigoBarras: data.barcode,
        custo: data.custo,
        percentualGanho: data.percentualGanho,
        precoVenda: data.precoVenda,
        estoqueMinimo: data.estoqueMinimo,
        atualizadoEm: serverTimestamp()
      };
      if (roundMoney(current.custo) !== data.custo) {
        changes.custoAnterior = roundMoney(current.custo);
        changes.custoAlteradoEm = today;
        transaction.set(doc(collection(db, "historico_custos")), {
          produtoId: productId,
          produtoNome: data.nome,
          custoAnterior: roundMoney(current.custo),
          custoNovo: data.custo,
          origem: "edicao_produto",
          data: today,
          usuario: userEmail,
          criadoEm: serverTimestamp()
        });
      }
      if (hasCatalogUpdate) transaction.set(catalogRef, catalogUpdate, { merge: true });
      if (reservation) reservation.commit();
      transaction.update(productRef, changes);
    });
    return { productId, created: false };
  }

  const productRef = doc(collection(db, "produtos"));
  await runTransaction(db, async (transaction) => {
    const reservation = internalCodeEnabled ? await reserveInternalCode(transaction, products) : null;
    if (hasCatalogUpdate) transaction.set(catalogRef, catalogUpdate, { merge: true });
    transaction.set(productRef, {
      nome: data.nome,
      descricao: data.descricao,
      marca: data.marca,
      categoria: data.categoria,
      ...data.packFields,
      codigoInterno: reservation ? reservation.code : "",
      codigoBarras: data.barcode,
      custo: data.custo,
      percentualGanho: data.percentualGanho,
      precoVenda: data.precoVenda,
      estoqueMinimo: data.estoqueMinimo,
      quantidade: data.quantity,
      arquivado: false,
      criadoEmData: today,
      criadoEm: serverTimestamp(),
      atualizadoEm: serverTimestamp()
    });

    const baseEntry = {
      produtoId: productRef.id,
      produtoNome: data.nome,
      custoUnitario: data.custo,
      data: today,
      tipo: "estoque_inicial",
      fornecedor: "",
      usuario: userEmail,
      criadoEm: serverTimestamp(),
      criadoEmMs: Date.now()
    };
    if (data.packSize >= 2) {
      if (data.packsClosed > 0) {
        transaction.set(doc(collection(db, "entradas")), {
          ...baseEntry,
          quantidade: data.packsClosed * data.packSize,
          fardos: data.packsClosed,
          unidadesPorFardo: data.packSize,
          custoFardo: data.custoFardo,
          observacao: "Estoque inicial no cadastro do produto (fardos fechados)"
        });
      }
      if (data.looseUnits > 0) {
        transaction.set(doc(collection(db, "entradas")), {
          ...baseEntry,
          quantidade: data.looseUnits,
          observacao: "Estoque inicial no cadastro do produto (unidades soltas)"
        });
      }
    } else if (data.quantity > 0) {
      transaction.set(doc(collection(db, "entradas")), {
        ...baseEntry,
        quantidade: data.quantity,
        observacao: "Estoque inicial no cadastro do produto"
      });
    }
    if (reservation) reservation.commit();
  });
  return { productId: productRef.id, created: true };
}

export async function deleteProductTransaction({ productId, archive }) {
  const productRef = doc(db, "produtos", productId);
  let result = { archived: Boolean(archive), deleted: false };

  await runTransaction(db, async (transaction) => {
    const productSnapshot = await transaction.get(productRef);
    if (!productSnapshot.exists()) throw new Error("Este produto não existe mais. Atualize a lista.");
    const product = productSnapshot.data();
    if (product.arquivado) throw new Error("Este produto já está arquivado. Atualize a lista.");

    if (!archive && (Number(product.quantidade) || 0) > 0) {
      throw new Error("Não é possível excluir um produto com saldo. Use Saídas ou Vistoria para zerar o estoque.");
    }

    let hasHistory = Boolean(archive);
    if (!hasHistory) {
      const [entriesSnapshot, exitsSnapshot, costHistorySnapshot, salesSnapshot, returnsSnapshot, inventoriesSnapshot] = await Promise.all([
        transaction.get(query(collection(db, "entradas"), where("produtoId", "==", productId))),
        transaction.get(query(collection(db, "saidas"), where("produtoId", "==", productId))),
        transaction.get(query(collection(db, "historico_custos"), where("produtoId", "==", productId))),
        transaction.get(collection(db, "vendas")),
        transaction.get(collection(db, "devolucoes")),
        transaction.get(collection(db, "vistorias"))
      ]);

      const containsProduct = (record) => {
        if (record.produtoId === productId) return true;
        if (Array.isArray(record.itens) && record.itens.some((item) => item.produtoId === productId)) return true;
        if (Array.isArray(record.naoContados) && record.naoContados.some((item) => item.produtoId === productId)) return true;
        if (Array.isArray(record.ignorados) && record.ignorados.some((item) => item.produtoId === productId)) return true;
        return Boolean(record.contagens && Object.prototype.hasOwnProperty.call(record.contagens, productId));
      };

      hasHistory = !entriesSnapshot.empty || !exitsSnapshot.empty || !costHistorySnapshot.empty
        || salesSnapshot.docs.some((item) => containsProduct(item.data()))
        || returnsSnapshot.docs.some((item) => containsProduct(item.data()))
        || inventoriesSnapshot.docs.some((item) => containsProduct(item.data()));
    }

    if (hasHistory) {
      transaction.update(productRef, {
        arquivado: true,
        arquivadoEm: serverTimestamp(),
        atualizadoEm: serverTimestamp()
      });
      result = { archived: true, deleted: false };
      return;
    }

    transaction.delete(productRef);
    result = { archived: false, deleted: true };
  });

  return result;
}

export async function saveStoreSettingsTransaction(settings) {
  const batch = writeBatch(db);
  batch.set(doc(db, "produtos", STORE_SETTINGS_ID), {
    ...settings,
    atualizadoEm: serverTimestamp()
  }, { merge: true });
  await batch.commit();
}
