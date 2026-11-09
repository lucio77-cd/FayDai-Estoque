import test from "node:test";
import assert from "node:assert/strict";

import {
  resetMockDb, seedDoc, readDoc, dumpCollection
} from "./firebase-mock-runtime.mjs";

import {
  parseCountValue, describeCount, startInventory, saveInventory,
  discardInventory, finishInventory
} from "../js/servicos/vistoria.js?v=20261109-1";

import {
  saveProductTransaction, deleteProductTransaction
} from "../js/servicos/produtos.js?v=20261109-2";

import {
  saveEntryTransaction, saveExitTransaction
} from "../js/servicos/movimentacoes.js?v=20261109-2";

test.beforeEach(() => resetMockDb());

test("contagem distingue vazio, inválido, zero e quantidade inteira", () => {
  assert.deepEqual(parseCountValue(""), { state: "empty" });
  assert.deepEqual(parseCountValue("-1"), { state: "invalid" });
  assert.deepEqual(parseCountValue("1.5"), { state: "invalid" });
  assert.deepEqual(parseCountValue("0"), { state: "counted", value: 0 });
  assert.deepEqual(describeCount({ quantidade: 4 }, "6"), {
    text: "+2 un.", cls: "plus", counted: true
  });
});

test("início bloqueia uma segunda vistoria ativa", async () => {
  const first = await startInventory({ date: "2026-11-09", userEmail: "teste@faydai.local" });
  await assert.rejects(
    () => startInventory({ date: "2026-11-09", userEmail: "teste@faydai.local" }),
    /Já existe uma vistoria em andamento/
  );
  const active = dumpCollection("vistorias").filter((item) => item.data.status === "em_andamento");
  assert.equal(active.length, 1);
  assert.equal(active[0].id, first.id);
});

test("início bloqueia vistoria antiga ativa sem documento de controle", async () => {
  seedDoc("vistorias", "legada-ativa", { status: "em_andamento", contagens: {} });
  await assert.rejects(
    () => startInventory({ date: "2026-11-09" }),
    /Já existe uma vistoria em andamento/
  );
  assert.equal(dumpCollection("vistorias").filter((item) => item.data.status === "em_andamento").length, 1);
});

test("descarte preserva o documento e impede salvamento posterior", async () => {
  const inventory = await startInventory({ date: "2026-11-09" });
  await discardInventory({ inventoryId: inventory.id, userEmail: "operador@faydai.local" });
  assert.equal(readDoc("vistorias", inventory.id).status, "descartada");
  assert.equal(readDoc("vistorias", inventory.id).descartadaPor, "operador@faydai.local");
  await assert.rejects(
    () => saveInventory({ inventoryId: inventory.id, counts: { produto1: 2 } }),
    /já foi concluída ou foi descartada/
  );
});

test("conclusão ajusta saldo e impede alteração posterior", async () => {
  seedDoc("produtos", "produto-1", { nome: "Produto 1", quantidade: 2, arquivado: false });
  const inventory = await startInventory({ date: "2026-11-09" });
  const result = await finishInventory({
    inventoryId: inventory.id,
    counts: { "produto-1": 5 },
    activeProducts: [{ id: "produto-1", nome: "Produto 1", quantidade: 2 }],
    date: "2026-11-09",
    dateTime: "2026-11-09 10:00",
    userEmail: "operador@faydai.local"
  });
  assert.equal(result.ajustados, 1);
  assert.equal(readDoc("produtos", "produto-1").quantidade, 5);
  assert.equal(readDoc("vistorias", inventory.id).status, "concluida");
  await assert.rejects(
    () => saveInventory({ inventoryId: inventory.id, counts: { "produto-1": 9 } }),
    /já foi concluída ou foi descartada/
  );
});

test("cadastro de produto é idempotente e não repete estoque inicial", async () => {
  const data = {
    nome: "Produto A", descricao: "", marca: "", categoria: "",
    packFields: { nomeBase: "Produto A", volumeMl: null, unidadesPorFardo: null, custoFardo: null },
    barcode: "", custo: 5, percentualGanho: 20, precoVenda: 6,
    estoqueMinimo: null, quantity: 3, packSize: 0, packsClosed: 0,
    looseUnits: 0, custoFardo: null
  };
  const args = {
    creationId: "cadastro-idempotente-001",
    data, products: [], brands: [], categories: [], suggestedCategories: [],
    internalCodeEnabled: false, today: "2026-11-09", userEmail: "teste@faydai.local"
  };
  const first = await saveProductTransaction(args);
  const second = await saveProductTransaction(args);
  assert.equal(first.alreadySaved, false);
  assert.equal(second.alreadySaved, true);
  assert.equal(dumpCollection("produtos").filter((item) => item.id === first.productId).length, 1);
  assert.equal(dumpCollection("entradas").filter((item) => item.data.produtoId === first.productId).length, 1);
});

test("mesmo identificador de cadastro com dados diferentes é bloqueado", async () => {
  const base = {
    nome: "Produto A", descricao: "", marca: "", categoria: "",
    packFields: {}, barcode: "", custo: 5, percentualGanho: 20, precoVenda: 6,
    estoqueMinimo: null, quantity: 0, packSize: 0, packsClosed: 0,
    looseUnits: 0, custoFardo: null
  };
  const args = {
    creationId: "cadastro-idempotente-002", data: base, products: [],
    brands: [], categories: [], suggestedCategories: [], internalCodeEnabled: false,
    today: "2026-11-09"
  };
  await saveProductTransaction(args);
  await assert.rejects(
    () => saveProductTransaction({ ...args, data: { ...base, nome: "Produto B" } }),
    /identificador de cadastro já foi utilizado com outros dados/
  );
});

test("produto com histórico de venda é arquivado, nunca apagado", async () => {
  seedDoc("produtos", "produto-com-venda", { nome: "Produto com venda", quantidade: 0, arquivado: false });
  seedDoc("vendas", "venda-1", { itens: [{ produtoId: "produto-com-venda", quantidade: 1 }] });
  const result = await deleteProductTransaction({ productId: "produto-com-venda", archive: false });
  assert.deepEqual(result, { archived: true, deleted: false });
  assert.equal(readDoc("produtos", "produto-com-venda").arquivado, true);
  assert.ok(readDoc("vendas", "venda-1"));
});

test("produto sem saldo e sem histórico pode ser excluído", async () => {
  seedDoc("produtos", "produto-sem-historico", { nome: "Produto sem histórico", quantidade: 0, arquivado: false });
  const result = await deleteProductTransaction({ productId: "produto-sem-historico", archive: false });
  assert.deepEqual(result, { archived: false, deleted: true });
  assert.equal(readDoc("produtos", "produto-sem-historico"), undefined);
});

test("produto com saldo positivo não pode ser excluído", async () => {
  seedDoc("produtos", "produto-com-saldo", { nome: "Produto com saldo", quantidade: 2, arquivado: false });
  await assert.rejects(
    () => deleteProductTransaction({ productId: "produto-com-saldo", archive: false }),
    /produto com saldo/
  );
  assert.ok(readDoc("produtos", "produto-com-saldo"));
});

test("entrada com custo zero é válida e não duplica saldo", async () => {
  seedDoc("produtos", "produto-entrada", { nome: "Produto", quantidade: 1, arquivado: false });
  const args = {
    entryId: "entrada-001", productId: "produto-entrada", productName: "Produto",
    quantity: 2, unitCost: 0, date: "2026-11-09"
  };
  const first = await saveEntryTransaction(args);
  const second = await saveEntryTransaction(args);
  assert.equal(first.alreadySaved, false);
  assert.equal(second.alreadySaved, true);
  assert.equal(readDoc("produtos", "produto-entrada").quantidade, 3);
});

test("saída idempotente não desconta estoque duas vezes", async () => {
  seedDoc("produtos", "produto-saida", { nome: "Produto", quantidade: 5, arquivado: false });
  const args = {
    exitId: "saida-001", productId: "produto-saida", productName: "Produto",
    quantity: 2, reason: "perda", date: "2026-11-09"
  };
  const first = await saveExitTransaction(args);
  const second = await saveExitTransaction(args);
  assert.equal(first.alreadySaved, false);
  assert.equal(second.alreadySaved, true);
  assert.equal(readDoc("produtos", "produto-saida").quantidade, 3);
});
