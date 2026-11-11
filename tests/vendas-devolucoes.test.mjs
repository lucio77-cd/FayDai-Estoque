import test from "node:test";
import assert from "node:assert/strict";

import { resetMockDb, seedDoc, readDoc, dumpCollection, setGetDocsHook, runTransaction, doc, db } from "./firebase-mock-runtime.mjs";
import { finishSaleTransaction } from "../js/servicos/vendas.js?v=20261106-4";
import { cancelSale, registerReturn } from "../js/devolucoes.js?v=20261110-2";

test.beforeEach(() => { resetMockDb(); setGetDocsHook(null); });

function seedProduct(id, extra = {}) {
  seedDoc("produtos", id, {
    nome: `Produto ${id}`, quantidade: 5, custo: 3, percentualGanho: 20, precoVenda: 5, arquivado: false, ...extra
  });
}

function sellArgs(saleId, lines, extra = {}) {
  return {
    saleId,
    cartSnapshot: lines.map(([produtoId, quantidade, precoUnitario = 5]) => ({
      produtoId, nome: `Produto ${produtoId}`, quantidade, precoUnitario, origem: "busca"
    })),
    formaPagamento: "Pix", date: "2026-11-10", userEmail: "teste@faydai.local",
    saleHour: 10, saleWeekday: 2, durationSeconds: 30, retroactive: false,
    dateTime: "2026-11-10 10:00", ...extra
  };
}

const saleOf = (id) => ({ id, ...readDoc("vendas", id) });

test("venda baixa o estoque e grava total, custo da época e contadores de devolução zerados", async () => {
  seedProduct("p1");
  const result = await finishSaleTransaction(sellArgs("venda-1", [["p1", 2]]));
  assert.equal(result.alreadySaved, false);
  assert.equal(readDoc("produtos", "p1").quantidade, 3);
  const sale = readDoc("vendas", "venda-1");
  assert.equal(sale.total, 10);
  assert.equal(sale.data, "2026-11-10");
  assert.equal(sale.itens[0].custoUnitario, 3);
  assert.equal(sale.valorDevolvido, 0);
  assert.deepEqual(sale.devolvidoPorProduto, {});
});

test("enviar a mesma venda duas vezes não baixa o estoque duas vezes", async () => {
  seedProduct("p1");
  const args = sellArgs("venda-1", [["p1", 2]]);
  const first = await finishSaleTransaction(args);
  const second = await finishSaleTransaction(args);
  assert.equal(first.alreadySaved, false);
  assert.equal(second.alreadySaved, true);
  assert.equal(readDoc("produtos", "p1").quantidade, 3);
  assert.equal(dumpCollection("vendas").length, 1);
});

test("saldo insuficiente bloqueia a venda e não altera nada", async () => {
  seedProduct("p1", { quantidade: 1 });
  await assert.rejects(() => finishSaleTransaction(sellArgs("venda-1", [["p1", 2]])), /Saldo insuficiente/);
  assert.equal(readDoc("produtos", "p1").quantidade, 1);
  assert.equal(readDoc("vendas", "venda-1"), undefined);
});

test("produto arquivado não pode ser vendido", async () => {
  seedProduct("p1", { arquivado: true });
  await assert.rejects(() => finishSaleTransaction(sellArgs("venda-1", [["p1", 1]])), /não está mais disponível/);
  assert.equal(readDoc("produtos", "p1").quantidade, 5);
});

test("venda com dois produtos é tudo ou nada: falha no segundo não baixa o primeiro", async () => {
  seedProduct("p1");
  seedProduct("p2", { quantidade: 0 });
  await assert.rejects(() => finishSaleTransaction(sellArgs("venda-1", [["p1", 1], ["p2", 1]])), /Saldo insuficiente/);
  assert.equal(readDoc("produtos", "p1").quantidade, 5);
  assert.equal(readDoc("vendas", "venda-1"), undefined);
});

test("cancelar a venda devolve todo o estoque e marca a venda como cancelada", async () => {
  seedProduct("p1");
  await finishSaleTransaction(sellArgs("venda-1", [["p1", 2]]));
  await cancelSale(saleOf("venda-1"), "cliente desistiu");
  assert.equal(readDoc("produtos", "p1").quantidade, 5);
  const sale = readDoc("vendas", "venda-1");
  assert.equal(sale.status, "cancelada");
  assert.equal(sale.canceladaPor, "teste@faydai.local");
  assert.equal(sale.motivoCancelamento, "cliente desistiu");
});

test("cancelar duas vezes não devolve o estoque duas vezes", async () => {
  seedProduct("p1");
  await finishSaleTransaction(sellArgs("venda-1", [["p1", 2]]));
  await cancelSale(saleOf("venda-1"), "teste");
  await assert.rejects(() => cancelSale(saleOf("venda-1"), "teste"), /já foi cancelada/);
  assert.equal(readDoc("produtos", "p1").quantidade, 5);
});

test("devolução parcial devolve ao estoque, atualiza contadores e grava a devolução", async () => {
  seedProduct("p1");
  await finishSaleTransaction(sellArgs("venda-1", [["p1", 2]]));
  const result = await registerReturn(saleOf("venda-1"), [{ index: 0, quantidade: 1 }], "defeito", "dev-1");
  assert.equal(result.alreadySaved, false);
  assert.equal(result.total, 5);
  assert.equal(readDoc("produtos", "p1").quantidade, 4);
  const sale = readDoc("vendas", "venda-1");
  assert.equal(sale.devolvidoPorProduto.p1, 1);
  assert.equal(sale.valorDevolvido, 5);
  assert.equal(sale.ultimaDevolucaoId, "dev-1");
  assert.equal(readDoc("devolucoes", "dev-1").vendaId, "venda-1");
  assert.equal(readDoc("devolucoes", "dev-1").totalDevolvido, 5);
});

test("enviar a mesma devolução duas vezes não devolve o estoque duas vezes", async () => {
  seedProduct("p1");
  await finishSaleTransaction(sellArgs("venda-1", [["p1", 2]]));
  await registerReturn(saleOf("venda-1"), [{ index: 0, quantidade: 1 }], "defeito", "dev-1");
  const again = await registerReturn(saleOf("venda-1"), [{ index: 0, quantidade: 1 }], "defeito", "dev-1");
  assert.equal(again.alreadySaved, true);
  assert.equal(readDoc("produtos", "p1").quantidade, 4);
  assert.equal(dumpCollection("devolucoes").length, 1);
});

test("não deixa devolver mais do que foi vendido", async () => {
  seedProduct("p1");
  await finishSaleTransaction(sellArgs("venda-1", [["p1", 2]]));
  await registerReturn(saleOf("venda-1"), [{ index: 0, quantidade: 1 }], "defeito", "dev-1");
  await assert.rejects(
    () => registerReturn(saleOf("venda-1"), [{ index: 0, quantidade: 2 }], "defeito", "dev-2"),
    /Quantidade acima do que ainda pode ser devolvido/
  );
  assert.equal(readDoc("produtos", "p1").quantidade, 4);
  assert.equal(readDoc("devolucoes", "dev-2"), undefined);
});

test("duas devoluções simultâneas da mesma unidade: só uma é aceita", async () => {
  seedProduct("p1");
  await finishSaleTransaction(sellArgs("venda-1", [["p1", 2]]));
  const stale = saleOf("venda-1");
  const results = await Promise.allSettled([
    registerReturn(stale, [{ index: 0, quantidade: 2 }], "a", "dev-a"),
    registerReturn(stale, [{ index: 0, quantidade: 2 }], "b", "dev-b")
  ]);
  assert.equal(results.filter((item) => item.status === "fulfilled").length, 1);
  assert.equal(results.filter((item) => item.status === "rejected").length, 1);
  assert.equal(readDoc("produtos", "p1").quantidade, 5);
  assert.equal(readDoc("vendas", "venda-1").valorDevolvido, 10);
});

test("venda com devolução não pode ser cancelada por inteiro", async () => {
  seedProduct("p1");
  await finishSaleTransaction(sellArgs("venda-1", [["p1", 2]]));
  const before = saleOf("venda-1");
  await registerReturn(before, [{ index: 0, quantidade: 1 }], "defeito", "dev-1");
  // Usa a venda "velha" (sem a devolução) de propósito: quem decide é o banco, dentro da transação.
  await assert.rejects(() => cancelSale(before, "teste"), /já tem devolução registrada/);
  assert.equal(readDoc("produtos", "p1").quantidade, 4);
  assert.equal(readDoc("vendas", "venda-1").status, undefined);
});

test("venda cancelada não aceita devolução", async () => {
  seedProduct("p1");
  await finishSaleTransaction(sellArgs("venda-1", [["p1", 2]]));
  await cancelSale(saleOf("venda-1"), "teste");
  await assert.rejects(
    () => registerReturn(saleOf("venda-1"), [{ index: 0, quantidade: 1 }], "x", "dev-1"),
    /foi cancelada/
  );
  assert.equal(readDoc("produtos", "p1").quantidade, 5);
});

test("devolução em produto arquivado ainda volta ao estoque; produto removido bloqueia", async () => {
  seedProduct("p1");
  await finishSaleTransaction(sellArgs("venda-1", [["p1", 2]]));
  seedDoc("produtos", "p1", { ...readDoc("produtos", "p1"), arquivado: true });
  await registerReturn(saleOf("venda-1"), [{ index: 0, quantidade: 1 }], "defeito", "dev-1");
  assert.equal(readDoc("produtos", "p1").quantidade, 4);

  seedProduct("p2");
  await finishSaleTransaction(sellArgs("venda-2", [["p2", 1]]));
  await runTransaction(db, async (transaction) => { transaction.delete(doc(db, "produtos", "p2")); });
  await assert.rejects(
    () => registerReturn(saleOf("venda-2"), [{ index: 0, quantidade: 1 }], "x", "dev-2"),
    /não existe mais/
  );
});

test("venda antiga (sem contador) respeita devoluções já gravadas na coleção", async () => {
  seedProduct("p1", { quantidade: 3 });
  seedDoc("vendas", "venda-antiga", {
    itens: [{ produtoId: "p1", produtoNome: "Produto p1", quantidade: 2, precoUnitario: 5 }],
    total: 10, formaPagamento: "Pix", data: "2026-01-05"
  });
  seedDoc("devolucoes", "dev-antiga", {
    vendaId: "venda-antiga", itens: [{ produtoId: "p1", quantidade: 1 }], totalDevolvido: 5
  });
  await assert.rejects(
    () => registerReturn(saleOf("venda-antiga"), [{ index: 0, quantidade: 2 }], "x", "dev-novo-1"),
    /Quantidade acima do que ainda pode ser devolvido/
  );
  await registerReturn(saleOf("venda-antiga"), [{ index: 0, quantidade: 1 }], "x", "dev-novo-2");
  assert.equal(readDoc("produtos", "p1").quantidade, 4);
  const sale = readDoc("vendas", "venda-antiga");
  assert.equal(sale.devolvidoPorProduto.p1, 2);
  assert.equal(sale.valorDevolvido, 10);
});

test("venda antiga com devolução gravada não pode ser cancelada por inteiro", async () => {
  seedProduct("p1", { quantidade: 3 });
  seedDoc("vendas", "venda-antiga", {
    itens: [{ produtoId: "p1", produtoNome: "Produto p1", quantidade: 2, precoUnitario: 5 }],
    total: 10, formaPagamento: "Pix", data: "2026-01-05"
  });
  seedDoc("devolucoes", "dev-antiga", {
    vendaId: "venda-antiga", itens: [{ produtoId: "p1", quantidade: 1 }], totalDevolvido: 5
  });
  await assert.rejects(() => cancelSale(saleOf("venda-antiga"), "x"), /já tem devolução registrada/);
  assert.equal(readDoc("produtos", "p1").quantidade, 3);
});
