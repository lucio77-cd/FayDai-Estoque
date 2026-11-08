// vendas.js — regras de cálculo do carrinho e operações de persistência de vendas.
// Não acessa a interface, não exibe avisos e não mantém estado visual.
import {
  db, collection, doc, runTransaction, serverTimestamp, addDoc
} from "../firebase.js?v=20261104-1";
import {
  roundMoney, getRegisteredSalePrice, calcSuggestedPrice
} from "../utils.js?v=20261104-1";

export const cartItemPrice = (item) => (Number.isFinite(item.precoUnitario) ? item.precoUnitario : 0);
export const cartItemSubtotal = (item) => roundMoney(item.quantidade * cartItemPrice(item));
export const cartTotal = (items) => roundMoney(items.reduce((sum, item) => sum + cartItemSubtotal(item), 0));
export const cartHasInvalidPrice = (items) => items.some((item) => !(item.precoUnitario > 0));

export async function finishSaleTransaction({
  saleId,
  cartSnapshot,
  formaPagamento,
  date,
  userEmail,
  saleHour,
  saleWeekday,
  durationSeconds,
  retroactive,
  valorRecebido = null,
  troco = null,
  dateTime
}) {
  const saleRef = doc(db, "vendas", saleId);
  let alreadySaved = false;

  await runTransaction(db, async (transaction) => {
    alreadySaved = false;
    const existingSale = await transaction.get(saleRef);
    if (existingSale.exists()) {
      alreadySaved = true;
      return;
    }

    const snapshots = [];
    for (const item of cartSnapshot) {
      snapshots.push(await transaction.get(doc(db, "produtos", item.produtoId)));
    }

    const itens = [];
    snapshots.forEach((snapshot, index) => {
      const item = cartSnapshot[index];
      if (!snapshot.exists() || snapshot.data().arquivado) {
        throw new Error(`O produto "${item.nome}" não está mais disponível.`);
      }
      const product = { id: snapshot.id, ...snapshot.data() };
      const balance = Number(product.quantidade) || 0;
      if (item.quantidade > balance) {
        throw new Error(`Saldo insuficiente de "${product.nome}". Disponível: ${balance}.`);
      }
      const custoUnitario = roundMoney(product.custo);
      const precoCadastrado = getRegisteredSalePrice(product);
      const precoSugerido = calcSuggestedPrice(product);
      itens.push({
        produtoId: product.id,
        produtoNome: product.nome || item.nome,
        codigoInterno: product.codigoInterno || "",
        quantidade: item.quantidade,
        precoUnitario: item.precoUnitario,
        precoCadastrado,
        precoSugerido,
        custoUnitario,
        subtotal: roundMoney(item.quantidade * item.precoUnitario),
        precoAlterado: item.precoUnitario !== precoCadastrado,
        abaixoDoSugerido: item.precoUnitario < precoSugerido,
        abaixoDoCusto: item.precoUnitario < custoUnitario,
        saldoAntes: balance,
        categoria: product.categoria || "",
        marca: product.marca || "",
        volumeMl: typeof product.volumeMl === "number" ? product.volumeMl : null,
        origem: item.origem || "busca"
      });
      transaction.update(snapshot.ref, {
        quantidade: balance - item.quantidade,
        atualizadoEm: serverTimestamp()
      });
    });

    transaction.set(saleRef, {
      itens,
      total: roundMoney(itens.reduce((sum, item) => sum + item.subtotal, 0)),
      formaPagamento,
      data: date,
      dataHora: dateTime,
      usuario: userEmail,
      devolvidoPorProduto: {},
      valorDevolvido: 0,
      hora: saleHour,
      diaSemana: saleWeekday,
      duracaoSegundos: durationSeconds,
      numeroItens: itens.length,
      totalUnidades: itens.reduce((sum, item) => sum + item.quantidade, 0),
      lancamentoRetroativo: retroactive,
      ...(valorRecebido !== null ? { valorRecebido, troco } : {}),
      criadoEm: serverTimestamp()
    });
  });

  return { alreadySaved };
}

export async function registerLostDemand({
  description,
  date,
  dateTime,
  hour,
  weekday,
  userEmail
}) {
  return addDoc(collection(db, "procura_perdida"), {
    descricao: description,
    data: date,
    dataHora: dateTime,
    hora: hour,
    diaSemana: weekday,
    usuario: userEmail,
    criadoEm: serverTimestamp()
  });
}
