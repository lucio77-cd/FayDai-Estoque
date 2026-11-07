// devolucoes.js — cancelamento de venda e devolução de itens (movido do app.js sem alteração de lógica).
// Só fala com o Firestore: não lê a tela nem o estado do app.js. O app.js chama cancelSale e registerReturn.
// Os imports usam o MESMO ?v= do app.js para o navegador carregar cada módulo uma única vez.
import { auth, db, collection, getDocs, doc, runTransaction, serverTimestamp, query, where } from "./firebase.js?v=20261104-1";
import { roundMoney, dateToday } from "./utils.js?v=20261104-1";

// Soma unidades de volta ao estoque dentro de uma transação (todas as leituras antes das escritas).
// Produtos ARQUIVADOS continuam aceitando a devolução ao estoque: arquivar só impede novas vendas,
// não deve impedir o estorno de vendas antigas. Apenas um produto que não existe mais bloqueia.
async function restockInTransaction(transaction, lines) {
  const totals = new Map();
  lines.forEach((line) => {
    const current = totals.get(line.produtoId) || { nome: line.produtoNome || "Produto", quantidade: 0 };
    current.quantidade += line.quantidade;
    totals.set(line.produtoId, current);
  });
  const entriesList = [...totals.entries()];
  const snapshots = [];
  for (const [productId] of entriesList) {
    snapshots.push(await transaction.get(doc(db, "produtos", productId)));
  }
  snapshots.forEach((snapshot, index) => {
    const info = entriesList[index][1];
    if (!snapshot.exists()) throw new Error(`O produto "${info.nome}" não existe mais; não é possível devolver ao estoque.`);
  });
  snapshots.forEach((snapshot, index) => {
    transaction.update(snapshot.ref, {
      quantidade: (Number(snapshot.data().quantidade) || 0) + entriesList[index][1].quantidade,
      atualizadoEm: serverTimestamp()
    });
  });
}

// Contadores de devolução gravados na própria venda (vendas novas já nascem com eles).
const hasReturnCounter = (saleData) => !!saleData && typeof saleData.devolvidoPorProduto === "object"
  && saleData.devolvidoPorProduto !== null;

// Só para vendas ANTIGAS (sem contador): soma as devoluções já gravadas, fora da transação.
// Depois da primeira devolução/cancelamento a venda ganha o contador e isto deixa de ser usado.
async function loadLegacyReturns(saleId) {
  const snapshot = await getDocs(query(collection(db, "devolucoes"), where("vendaId", "==", saleId)));
  const porProduto = {};
  let valor = 0;
  snapshot.docs.forEach((item) => {
    const data = item.data();
    (data.itens || []).forEach((line) => {
      porProduto[line.produtoId] = (porProduto[line.produtoId] || 0) + (Number(line.quantidade) || 0);
    });
    valor = roundMoney(valor + (Number(data.totalDevolvido) || 0));
  });
  return { porProduto, valor };
}

// Estado de devolução lido DENTRO da transação: contador da venda ou, se for venda antiga, a base legada.
function returnedStateOf(saleData, legacy) {
  if (hasReturnCounter(saleData)) {
    return { porProduto: { ...saleData.devolvidoPorProduto }, valor: Number(saleData.valorDevolvido) || 0 };
  }
  if (!legacy) throw new Error("Os dados desta venda mudaram. Atualize a lista e tente de novo.");
  return { porProduto: { ...legacy.porProduto }, valor: legacy.valor };
}

// Cancela a venda inteira e devolve todas as unidades ao estoque.
// A checagem "já houve devolução?" é feita dentro da transação, lendo a própria venda.
// Se outro aparelho devolver ao mesmo tempo, a venda muda, a transação reexecuta e o bloqueio aparece.
export async function cancelSale(sale, reason) {
  const saleRef = doc(db, "vendas", sale.id);
  const email = auth.currentUser?.email || null;
  const legacy = hasReturnCounter(sale) ? null : await loadLegacyReturns(sale.id);
  await runTransaction(db, async (transaction) => {
    const saleSnapshot = await transaction.get(saleRef);
    if (!saleSnapshot.exists()) throw new Error("Esta venda não existe mais. Atualize a lista.");
    const saleData = saleSnapshot.data();
    if (saleData.status === "cancelada") throw new Error("Esta venda já foi cancelada.");
    const returned = returnedStateOf(saleData, legacy);
    if (returned.valor > 0 || Object.values(returned.porProduto).some((qty) => qty > 0)) {
      throw new Error("Esta venda já tem devolução registrada e não pode ser cancelada por inteiro.");
    }
    const soldItems = Array.isArray(saleData.itens) ? saleData.itens : [];
    if (!soldItems.length || !soldItems.every((item) => item.produtoId)) {
      throw new Error("Esta venda é de um formato antigo e não pode ser cancelada pelo sistema.");
    }
    await restockInTransaction(transaction, soldItems.map((item) => ({
      produtoId: item.produtoId,
      produtoNome: item.produtoNome,
      quantidade: Number(item.quantidade) || 0
    })));
    transaction.update(saleRef, {
      status: "cancelada",
      canceladaEm: serverTimestamp(),
      canceladaPor: email,
      motivoCancelamento: reason
    });
  });
}

// Registra devolução parcial: requested = [{ index, quantidade }] (índice do item na venda).
// O limite "não devolver mais do que foi vendido" é conferido dentro da transação, com o contador da venda,
// e o contador é atualizado na mesma transação (duas devoluções simultâneas não passam do limite).
export async function registerReturn(sale, requested, reason, returnId) {
  if (!returnId) throw new Error("Identificador da devolução não informado. Feche e abra a operação novamente.");
  const saleRef = doc(db, "vendas", sale.id);
  const returnRef = doc(db, "devolucoes", returnId);
  const email = auth.currentUser?.email || "Usuário não identificado";
  const date = dateToday();
  const dateTime = `${date} ${new Date().toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" })}`;
  const legacy = hasReturnCounter(sale) ? null : await loadLegacyReturns(sale.id);
  let returnedTotal = 0;
  let alreadySaved = false;
  await runTransaction(db, async (transaction) => {
    alreadySaved = false;
    const existingReturn = await transaction.get(returnRef);
    if (existingReturn.exists()) {
      alreadySaved = true;
      returnedTotal = Number(existingReturn.data().totalDevolvido) || 0;
      return;
    }
    const saleSnapshot = await transaction.get(saleRef);
    if (!saleSnapshot.exists()) throw new Error("Esta venda não existe mais. Atualize a lista.");
    const saleData = saleSnapshot.data();
    if (saleData.status === "cancelada") throw new Error("Esta venda foi cancelada e não aceita devolução.");
    const soldItems = Array.isArray(saleData.itens) ? saleData.itens : [];
    const returned = returnedStateOf(saleData, legacy);

    // Vendido por produto (se o mesmo produto aparecer em duas linhas, os limites somam).
    const soldByProduct = {};
    soldItems.forEach((item) => {
      if (item.produtoId) soldByProduct[item.produtoId] = (soldByProduct[item.produtoId] || 0) + (Number(item.quantidade) || 0);
    });
    const requestedByProduct = {};

    const returnItems = requested.map(({ index, quantidade }) => {
      const sold = soldItems[index];
      if (!sold || !sold.produtoId) throw new Error("Item da venda não encontrado. Atualize a lista.");
      requestedByProduct[sold.produtoId] = (requestedByProduct[sold.produtoId] || 0) + quantidade;
      const available = (soldByProduct[sold.produtoId] || 0) - (returned.porProduto[sold.produtoId] || 0);
      if (requestedByProduct[sold.produtoId] > available) {
        throw new Error(`Quantidade acima do que ainda pode ser devolvido de "${sold.produtoNome}". Disponível: ${Math.max(available, 0)}.`);
      }
      const precoUnitario = roundMoney(sold.precoUnitario);
      return {
        produtoId: sold.produtoId,
        produtoNome: sold.produtoNome || "",
        codigoInterno: sold.codigoInterno || "",
        quantidade,
        precoUnitario,
        custoUnitario: typeof sold.custoUnitario === "number" ? sold.custoUnitario : null,
        subtotal: roundMoney(quantidade * precoUnitario)
      };
    });
    returnedTotal = roundMoney(returnItems.reduce((sum, item) => sum + item.subtotal, 0));
    const newValor = roundMoney(returned.valor + returnedTotal);
    if (newValor > roundMoney(Number(saleData.total) || 0) + 0.005) {
      throw new Error("O valor devolvido não pode passar do total da venda.");
    }
    const newPorProduto = { ...returned.porProduto };
    returnItems.forEach((item) => {
      newPorProduto[item.produtoId] = (newPorProduto[item.produtoId] || 0) + item.quantidade;
    });

    await restockInTransaction(transaction, returnItems.map((item) => ({
      produtoId: item.produtoId, produtoNome: item.produtoNome, quantidade: item.quantidade
    })));
    transaction.set(returnRef, {
      vendaId: sale.id,
      vendaDataHora: saleData.dataHora || saleData.data || "",
      itens: returnItems,
      totalDevolvido: returnedTotal,
      motivo: reason,
      data: date,
      dataHora: dateTime,
      usuario: email,
      criadoEm: serverTimestamp()
    });
    transaction.update(saleRef, {
      devolvidoPorProduto: newPorProduto,
      valorDevolvido: newValor,
      ultimaDevolucaoId: returnRef.id,
      ultimaDevolucaoEm: serverTimestamp()
    });
  });
  return { total: returnedTotal, alreadySaved };
                         }
