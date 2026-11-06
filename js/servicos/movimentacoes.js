// movimentacoes.js — transações de entradas e saídas de estoque.
// Este módulo não acessa a tela, não exibe avisos e não mantém estado da interface.
// Recebe dados simples e preserva as validações e mensagens das transações originais.
import { db, collection, doc, runTransaction, serverTimestamp } from "../firebase.js?v=20261104-1";
import { dateTimeFor, packSizeOf } from "../utils.js?v=20261104-1";

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
  pack = null
}) {
  const productRef = doc(db, "produtos", productId);

  await runTransaction(db, async (transaction) => {
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
      quantidade,
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

    transaction.set(doc(collection(db, "entradas")), entryData);
  });
}

// Registra uma saída e atualiza o saldo na mesma transação.
export async function saveExitTransaction({
  productId,
  productName,
  quantity,
  reason,
  date,
  notes = "",
  userEmail = "Usuário não identificado"
}) {
  const productRef = doc(db, "produtos", productId);

  await runTransaction(db, async (transaction) => {
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

    transaction.set(doc(collection(db, "saidas")), {
      produtoId: productId,
      produtoNome: snapshot.data().nome || productName || "",
      quantidade,
      motivo: reason,
      observacao: notes,
      data: date,
      dataHora: dateTimeFor(date),
      usuario: userEmail,
      criadoEm: serverTimestamp()
    });
  });
}
