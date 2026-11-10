import test from "node:test";
import assert from "node:assert/strict";

import { resetMockDb, seedDoc, setGetDocsHook } from "./firebase-mock-runtime.mjs";
import { loadAppData, historyCutoff, JANELA_HISTORICO_DIAS } from "../js/dados.js?v=20261110-2";

// Hoje fixo (10/11/2026): a janela de 90 dias começa em 12/08/2026.
const HOJE = new Date(2026, 10, 10, 12, 0, 0);
const IDS = (lista) => lista.map((item) => item.id).sort();

test.beforeEach(() => { resetMockDb(); setGetDocsHook(null); });

function semear() {
  seedDoc("produtos", "p1", { nome: "Capa", quantidade: 3 });
  seedDoc("produtos", "catalogo_opcoes_faydai", { marcas: ["X"] });
  seedDoc("produtos", "configuracoes_faydai", { nome: "FayDai" });
  seedDoc("produtos", "contador_codigo_interno_faydai", { ultimoNumero: 5 });

  seedDoc("vendas", "v-recente", { data: "2026-11-01", formaPagamento: "Dinheiro", total: 10 });
  seedDoc("vendas", "v-limite", { data: "2026-08-12", formaPagamento: "Pix", total: 20 });
  seedDoc("vendas", "v-vespera", { data: "2026-08-11", formaPagamento: "Pix", total: 30 });
  seedDoc("vendas", "v-antiga", { data: "2026-05-01", formaPagamento: "Cartão de débito", total: 40 });
  seedDoc("vendas", "v-sem-data", { formaPagamento: "Pix", total: 50 });

  seedDoc("entradas", "e-recente", { data: "2026-11-05", quantidade: 1 });
  seedDoc("entradas", "e-antiga", { data: "2026-01-10", quantidade: 1 });
  seedDoc("saidas", "s-recente", { data: "2026-10-20", quantidade: 1 });
  seedDoc("saidas", "s-antiga", { data: "2026-02-02", quantidade: 1 });

  seedDoc("devolucoes", "d-venda-recente", { data: "2026-11-02", vendaId: "v-recente", totalDevolvido: 5 });
  seedDoc("devolucoes", "d-venda-antiga", { data: "2026-11-09", vendaId: "v-antiga", totalDevolvido: 8 });
  seedDoc("devolucoes", "d-antiga", { data: "2026-03-03", vendaId: "v-antiga", totalDevolvido: 8 });

  seedDoc("vistorias", "vis-1", { status: "concluida", dataHora: "2026-01-05 10:00" });
}

test("a janela começa 90 dias antes de hoje (horário local)", () => {
  assert.equal(JANELA_HISTORICO_DIAS, 90);
  assert.equal(historyCutoff(90, HOJE), "2026-08-12");
  assert.equal(historyCutoff(0, HOJE), "2026-11-10");
});

test("carga normal traz só vendas, entradas, saídas e devoluções da janela", async () => {
  semear();
  const data = await loadAppData({ now: HOJE });

  assert.deepEqual(IDS(data.sales), ["v-limite", "v-recente"]);
  assert.deepEqual(IDS(data.entries), ["e-recente"]);
  assert.deepEqual(IDS(data.exits), ["s-recente"]);
  assert.deepEqual(IDS(data.saleReturns), ["d-venda-antiga", "d-venda-recente"]);
  assert.equal(data.historicoCompleto, false);
  assert.equal(data.historicoDesde, "2026-08-12");
});

test("produtos e vistorias vêm completos e os documentos especiais não viram produto", async () => {
  semear();
  const data = await loadAppData({ now: HOJE });

  assert.deepEqual(IDS(data.products), ["p1"]);
  assert.deepEqual(data.catalogData, { marcas: ["X"] });
  assert.equal(data.storeSettingsData.nome, "FayDai");
  assert.equal(data.inventoryHistory.length, 1);
});

test("carga completa traz todo o histórico, inclusive registros sem o campo data", async () => {
  semear();
  const data = await loadAppData({ completo: true, now: HOJE });

  assert.deepEqual(IDS(data.sales), ["v-antiga", "v-limite", "v-recente", "v-sem-data", "v-vespera"]);
  assert.deepEqual(IDS(data.entries), ["e-antiga", "e-recente"]);
  assert.deepEqual(IDS(data.exits), ["s-antiga", "s-recente"]);
  assert.equal(data.saleReturns.length, 3);
  assert.equal(data.historicoCompleto, true);
  assert.equal(data.historicoDesde, null);
});

test("devolução recente de venda antiga recebe a forma de pagamento da venda original", async () => {
  semear();
  const data = await loadAppData({ now: HOJE });

  const deVendaAntiga = data.saleReturns.find((item) => item.id === "d-venda-antiga");
  const deVendaRecente = data.saleReturns.find((item) => item.id === "d-venda-recente");
  assert.equal(deVendaAntiga.formaPagamentoVenda, "Cartão de débito");
  assert.equal(deVendaRecente.formaPagamentoVenda, undefined);
});

test("venda original que não existe mais não derruba a carga", async () => {
  seedDoc("devolucoes", "d-orfa", { data: "2026-11-09", vendaId: "v-apagada", totalDevolvido: 3 });
  const data = await loadAppData({ now: HOJE });

  assert.equal(data.saleReturnsAvailable, true);
  assert.equal(data.saleReturns.length, 1);
  assert.equal(data.saleReturns[0].formaPagamentoVenda, undefined);
});
