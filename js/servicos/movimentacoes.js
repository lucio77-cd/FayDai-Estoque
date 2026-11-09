// movimentacoes.js — transações de entradas e saídas de estoque.
// Este módulo não acessa a tela, não exibe avisos e não mantém estado da interface.
// Recebe dados simples e preserva as validações e mensagens das transações originais.
import { db, collection, doc, runTransaction, serverTimestamp } from "../firebase.js?v=20261109-7";
import { dateTimeFor, packSizeOf } from "../utils.js?v=20261104-1";

// Identificadores gerados no cliente: repetir o envio da MESMA tentativa reaproveita o ID e não duplica o saldo.
export const newEntryId = () => doc(collection(db, "entradas")).id;
export const newExitId = () => doc(collection(db, "saidas")).id;

// Mantém o ID da tentativa enquanto o conteúdo do formulário for o mesmo (reenvio após falha de rede).
// Se o usuário alterar qualquer dado, é outra operação e recebe um ID novo, para que a alteração não seja
// descartada como "já registrada".
export function attemptFor(current, fingerprint, makeId) {
  if (current && current.fingerprint === fingerprint) return current;
  return { id: makeId(), fingerprint };
}

// Registra uma entrada e atualiza o saldo na mesma transação.
export async function saveEntryTransaction({
  productId,
  productName,
  quantity,
  unitCost,
  date,
  supplier = "",
  notes = "",
  userEmail = null,
  pack = null,
  entryId
}) {
  if (!entryId) throw new Error("Identificador da entrada não informado. Tente novamente.");
  if (!Number.isInteger(quantity) || quantity < 1) throw new Error("A quantidade da entrada deve ser um número inteiro maior que zero.");
  if (!Number.isFinite(unitCost) || unitCost < 0) throw new Error("O custo da entrada deve ser zero ou maior.");
  const productRef = doc(db, "produtos", productId);
  const entryRef = doc(db, "entradas", entryId);
  let alreadySaved = false;

  await runTransaction(db, async (transaction) => {
    alreadySaved = false;
    const existingEntry = await transaction.get(entryRef);
    if (existingEntry.exists()) { alreadySaved = true; return; }
    const snapshot = await transaction.get(productRef);
    if (!snapshot.exists() || snapshot.data().arquivado) {
      throw new Error("Este produto não está mais disponível.");
    }
    if (pack && packSizeOf(snapshot.data()) !== pack.size) {
      throw new Error("O tamanho do fardo deste produto mudou. Selecione o produto novamente.");
    }

    transaction.update(productRef, {
      quantidade: (Number(snapshot.data().quantidade) || 0) + quantity,
      atualizadoEm: serverTimestamp()
    });

    const entryData = {
      produtoId: productId,
      produtoNome: snapshot.data().nome || productName || "",
      quantidade: quantity,
      custoUnitario: unitCost,
      data: date,
      tipo: "entrada",
      fornecedor: supplier,
      observacao: notes,
      usuario: userEmail,
      criadoEm: serverTimestamp(),
      criadoEmMs: Date.now()
    };

    if (pack) {
      entryData.fardos = pack.packs;
      entryData.unidadesPorFardo = pack.size;
      entryData.custoFardo = pack.packCost;
    }

    transaction.set(entryRef, entryData);
  });
  return { alreadySaved };
}

// Registra uma saída e atualiza o saldo na mesma transação.
export async function saveExitTransaction({
  productId,
  productName,
  quantity,
  reason,
  date,
  notes = "",
  userEmail = "Usuário não identificado",
  exitId
}) {
  if (!exitId) throw new Error("Identificador da saída não informado. Tente novamente.");
  if (!Number.isInteger(quantity) || quantity < 1) throw new Error("A quantidade da saída deve ser um número inteiro maior que zero.");
  const productRef = doc(db, "produtos", productId);
  const exitRef = doc(db, "saidas", exitId);
  let alreadySaved = false;

  await runTransaction(db, async (transaction) => {
    alreadySaved = false;
    const existingExit = await transaction.get(exitRef);
    if (existingExit.exists()) { alreadySaved = true; return; }
    const snapshot = await transaction.get(productRef);
    if (!snapshot.exists() || snapshot.data().arquivado) {
      throw new Error("Este produto não está mais disponível.");
    }

    const balance = Number(snapshot.data().quantidade) || 0;
    if (quantity > balance) {
      throw new Error(`Saldo insuficiente. Disponível: ${balance} unidade(s).`);
    }

    transaction.update(productRef, {
      quantidade: balance - quantity,
      atualizadoEm: serverTimestamp()
    });

    transaction.set(exitRef, {
      produtoId: productId,
      produtoNome: snapshot.data().nome || productName || "",
      quantidade: quantity,
      motivo: reason,
      observacao: notes,
      data: date,
      dataHora: dateTimeFor(date),
      usuario: userEmail,
      criadoEm: serverTimestamp()
    });
  });
  return { alreadySaved };
}
