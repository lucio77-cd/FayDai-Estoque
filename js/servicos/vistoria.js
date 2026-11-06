// vistoria.js — regras de contagem e operações de persistência da vistoria.
// Não acessa a interface, não exibe avisos e não mantém estado global do aplicativo.
import { db, collection, doc, addDoc, updateDoc, deleteDoc, runTransaction, serverTimestamp } from "../firebase.js?v=20261104-1";

export const MAX_INVENTORY_ADJUSTMENTS = 400;

export function parseCountValue(raw) {
  const text = String(raw ?? "").trim();
  if (text === "") return { state: "empty" };
  const value = Number(text);
  if (!Number.isInteger(value) || value < 0) return { state: "invalid" };
  return { state: "counted", value };
}

export function describeCount(product, raw) {
  const parsed = parseCountValue(raw);
  const balance = Number(product.quantidade) || 0;
  if (parsed.state === "empty") return { text: "Não contado", cls: "pending", counted: false };
  if (parsed.state === "invalid") return { text: "Valor inválido", cls: "invalid", counted: false };
  const diff = parsed.value - balance;
  if (diff === 0) return { text: "Sem diferença", cls: "ok", counted: true };
  return { text: `${diff > 0 ? "+" : ""}${diff} un.`, cls: diff > 0 ? "plus" : "minus", counted: true };
}

export async function startInventory({ date, userEmail = null }) {
  return addDoc(collection(db, "vistorias"), {
    status: "em_andamento",
    contagens: {},
    data: date,
    criadoEm: serverTimestamp(),
    criadoPor: userEmail,
    atualizadoEm: serverTimestamp(),
    atualizadoPor: userEmail
  });
}

export async function saveInventory({ inventoryId, counts, userEmail = null }) {
  await updateDoc(doc(db, "vistorias", inventoryId), {
    contagens: counts,
    atualizadoEm: serverTimestamp(),
    atualizadoPor: userEmail
  });
}

export async function discardInventory({ inventoryId }) {
  await deleteDoc(doc(db, "vistorias", inventoryId));
}

// activeProducts deve conter os produtos ativos carregados imediatamente antes da confirmação.
// O saldo definitivo é sempre relido dentro da transação antes de qualquer ajuste.
export async function finishInventory({
  inventoryId,
  counts,
  activeProducts,
  date,
  dateTime,
  userEmail = "Usuário não identificado"
}) {
  const counted = [];
  const uncounted = [];
  activeProducts.forEach((product) => {
    if (Object.prototype.hasOwnProperty.call(counts, product.id)) {
      counted.push({
        id: product.id,
        nome: product.nome || "",
        valor: counts[product.id],
        saldo: Number(product.quantidade) || 0
      });
    } else {
      uncounted.push({
        produtoId: product.id,
        produtoNome: product.nome || "",
        codigoInterno: product.codigoInterno || "",
        saldo: Number(product.quantidade) || 0
      });
    }
  });

  if (!counted.length) throw new Error("Informe a contagem de pelo menos um produto antes de concluir.");
  const withDiff = counted.filter((item) => item.valor !== item.saldo).length;
  if (withDiff > MAX_INVENTORY_ADJUSTMENTS) {
    throw new Error(`Há ${withDiff} produtos com diferença. O limite é ${MAX_INVENTORY_ADJUSTMENTS} por vistoria: deixe alguns produtos em branco (não contados) e conclua; depois faça outra vistoria com o restante.`);
  }

  const vistoriaRef = doc(db, "vistorias", inventoryId);
  let result = null;
  await runTransaction(db, async (transaction) => {
    const vistoriaSnapshot = await transaction.get(vistoriaRef);
    if (!vistoriaSnapshot.exists() || vistoriaSnapshot.data().status !== "em_andamento") {
      throw new Error("Esta vistoria já foi concluída ou foi descartada.");
    }

    const snapshots = await Promise.all(counted.map((item) => transaction.get(doc(db, "produtos", item.id))));
    const itens = [];
    const ignorados = [];
    snapshots.forEach((snapshot, index) => {
      const item = counted[index];
      if (!snapshot.exists() || snapshot.data().arquivado) {
        ignorados.push({
          produtoId: item.id,
          produtoNome: item.nome,
          contado: item.valor,
          motivo: !snapshot.exists() ? "Produto não existe mais" : "Produto arquivado"
        });
        return;
      }
      const product = snapshot.data();
      const saldoAnterior = Number(product.quantidade) || 0;
      itens.push({
        produtoId: item.id,
        produtoNome: product.nome || item.nome,
        codigoInterno: product.codigoInterno || "",
        saldoAnterior,
        contado: item.valor,
        diferenca: item.valor - saldoAnterior
      });
    });

    const ajustados = itens.filter((item) => item.diferenca !== 0);
    if (ajustados.length > MAX_INVENTORY_ADJUSTMENTS) {
      throw new Error(`Há ${ajustados.length} produtos com diferença. O limite é ${MAX_INVENTORY_ADJUSTMENTS} por vistoria: deixe alguns produtos em branco e conclua em partes.`);
    }

    ajustados.forEach((item) => {
      transaction.update(doc(db, "produtos", item.produtoId), {
        quantidade: item.contado,
        atualizadoEm: serverTimestamp()
      });
    });

    transaction.update(vistoriaRef, {
      status: "concluida",
      contagens: Object.fromEntries(counted.map((item) => [item.id, item.valor])),
      itens,
      naoContados: uncounted,
      ignorados,
      totalContados: itens.length,
      totalNaoContados: uncounted.length,
      totalComDiferenca: ajustados.length,
      data: date,
      dataHora: dateTime,
      concluidaEm: serverTimestamp(),
      concluidaPor: userEmail,
      atualizadoEm: serverTimestamp(),
      atualizadoPor: userEmail
    });
    result = { contados: itens.length, ajustados: ajustados.length, ignorados: ignorados.length };
  });
  return result;
}
