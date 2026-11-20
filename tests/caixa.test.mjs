import test from "node:test";
import assert from "node:assert/strict";

import { resetMockDb, seedDoc, readDoc, dumpCollection } from "./firebase-mock-runtime.mjs";
import {
  CAIXA_CONTROLE_ID, openCaixa, closeCaixa, loadCaixas, loadMovimentosCaixa, summarizeCaixa, returnInCaixa
} from "../js/servicos/caixa.js?v=20261120-1";
import { finishSaleTransaction } from "../js/servicos/vendas.js?v=20261120-1";
import { registerReturn } from "../js/devolucoes.js?v=20261110-2";

test.beforeEach(() => resetMockDb());

const abrir = (extra = {}) => openCaixa({
  caixaId: "caixa-1", valorAbertura: 100, observacao: "troco", date: "2026-11-20", dateTime: "2026-11-20 08:00",
  userEmail: "teste@faydai.local", ...extra
});

function seedProduct(id, extra = {}) {
  seedDoc("produtos", id, { nome: `Produto ${id}`, quantidade: 10, custo: 3, percentualGanho: 20, precoVenda: 5, arquivado: false, ...extra });
}

const vender = (saleId, forma, extra = {}) => finishSaleTransaction({
  saleId,
  cartSnapshot: [{ produtoId: "p1", nome: "Produto p1", quantidade: 2, precoUnitario: 5, origem: "busca" }],
  formaPagamento: forma, date: "2026-11-20", userEmail: "teste@faydai.local", saleHour: 9, saleWeekday: 5,
  durationSeconds: 20, retroactive: false, dateTime: "2026-11-20 09:00", ...extra
});

test("abrir o caixa grava a sessão aberta e o documento de controle", async () => {
  const result = await abrir();
  assert.equal(result.alreadySaved, false);
  const caixa = readDoc("caixas", "caixa-1");
  assert.equal(caixa.status, "aberto");
  assert.equal(caixa.valorAbertura, 100);
  assert.equal(caixa.data, "2026-11-20");
  assert.equal(caixa.abertoPor, "teste@faydai.local");
  assert.equal(readDoc("caixas", CAIXA_CONTROLE_ID).caixaId, "caixa-1");
});

test("reenviar a mesma abertura não cria outro caixa", async () => {
  await abrir();
  const again = await abrir();
  assert.equal(again.alreadySaved, true);
  assert.equal(dumpCollection("caixas").filter((item) => item.id !== CAIXA_CONTROLE_ID).length, 1);
});

test("não deixa abrir um segundo caixa enquanto outro está aberto", async () => {
  await abrir();
  await assert.rejects(() => abrir({ caixaId: "caixa-2" }), /Já existe um caixa aberto/);
  assert.equal(readDoc("caixas", "caixa-2"), undefined);
  assert.equal(readDoc("caixas", CAIXA_CONTROLE_ID).caixaId, "caixa-1");
});

test("rejeita dinheiro de abertura negativo ou inválido", async () => {
  await assert.rejects(() => abrir({ valorAbertura: -1 }), /dinheiro da gaveta/);
  await assert.rejects(() => abrir({ valorAbertura: NaN }), /dinheiro da gaveta/);
  assert.equal(readDoc("caixas", "caixa-1"), undefined);
});

test("venda com caixa aberto guarda o caixaId; sem caixaId segue como antes", async () => {
  seedProduct("p1");
  await abrir();
  await vender("venda-1", "Pix", { caixaId: "caixa-1" });
  await vender("venda-2", "Pix");
  assert.equal(readDoc("vendas", "venda-1").caixaId, "caixa-1");
  assert.equal("caixaId" in readDoc("vendas", "venda-2"), false);
  assert.equal(readDoc("produtos", "p1").quantidade, 6);
});

test("venda num caixa fechado é recusada e não baixa o estoque", async () => {
  seedProduct("p1");
  seedDoc("caixas", "caixa-1", { status: "fechado", data: "2026-11-20" });
  await assert.rejects(() => vender("venda-1", "Pix", { caixaId: "caixa-1" }), /caixa foi fechado/);
  assert.equal(readDoc("vendas", "venda-1"), undefined);
  assert.equal(readDoc("produtos", "p1").quantidade, 10);
  await assert.rejects(() => vender("venda-2", "Pix", { caixaId: "inexistente" }), /caixa foi fechado/);
});

test("fechamento soma por forma de pagamento, ignora cancelada e desconta devolução em dinheiro", () => {
  const caixa = { id: "c1", valorAbertura: 100, dataHora: "2026-11-20 08:00" };
  const vendas = [
    { id: "v1", caixaId: "c1", formaPagamento: "Dinheiro", total: 50 },
    { id: "v2", caixaId: "c1", formaPagamento: "Pix", total: 30 },
    { id: "v3", caixaId: "c1", formaPagamento: "Dinheiro", total: 999, status: "cancelada" },
    { id: "v4", caixaId: "outro", formaPagamento: "Dinheiro", total: 700 },
    { id: "v5", formaPagamento: "Dinheiro", total: 500 }
  ];
  const devolucoes = [
    { id: "d1", vendaId: "v1", totalDevolvido: 10, dataHora: "2026-11-20 10:00" },
    { id: "d2", vendaId: "v2", totalDevolvido: 5, dataHora: "2026-11-20 11:00" },
    { id: "d3", vendaId: "v1", totalDevolvido: 40, dataHora: "2026-11-19 17:00" }
  ];
  const resumo = summarizeCaixa({ caixa, vendas, devolucoes });
  assert.equal(resumo.numeroVendas, 2);
  assert.equal(resumo.numeroVendasCanceladas, 1);
  assert.equal(resumo.totalVendas, 80);
  assert.equal(resumo.totalDevolucoes, 15);
  assert.equal(resumo.totalLiquido, 65);
  assert.equal(resumo.vendasDinheiro, 50);
  assert.equal(resumo.devolucoesDinheiro, 10);
  assert.equal(resumo.esperadoDinheiro, 140);
  assert.deepEqual(resumo.formas.map((item) => [item.forma, item.liquido]), [["Dinheiro", 40], ["Pix", 25]]);
});

test("devolução anterior à abertura não entra no caixa", () => {
  const caixa = { id: "c1", dataHora: "2026-11-20 08:00" };
  assert.equal(returnInCaixa(caixa, { dataHora: "2026-11-20 07:59" }), false);
  assert.equal(returnInCaixa(caixa, { dataHora: "2026-11-20 08:00" }), true);
});

test("loadMovimentosCaixa e registerReturn: devolução de venda antiga em dinheiro sai do dinheiro do caixa", async () => {
  seedProduct("p1");
  await vender("venda-antiga", "Dinheiro", { date: "2026-11-10", dateTime: "2026-11-10 10:00" });
  // registerReturn grava a data e a hora reais do relógio; por isso o caixa deste teste abre numa data antiga.
  await abrir({ date: "2000-01-01", dateTime: "2000-01-01 08:00" });
  await vender("venda-hoje", "Dinheiro", { caixaId: "caixa-1" });
  await registerReturn({ id: "venda-antiga", ...readDoc("vendas", "venda-antiga") }, [{ index: 0, quantidade: 1 }], "defeito", "dev-1");

  const caixa = { id: "caixa-1", ...readDoc("caixas", "caixa-1") };
  const movimentos = await loadMovimentosCaixa(caixa);
  const resumo = summarizeCaixa({ caixa, ...movimentos });
  assert.equal(resumo.numeroVendas, 1);
  assert.equal(resumo.totalVendas, 10);
  assert.equal(resumo.numeroDevolucoes, 1);
  assert.equal(resumo.totalDevolucoes, 5);
  assert.equal(resumo.esperadoDinheiro, 105);
});

test("fechar o caixa grava totais e diferença, libera o controle e permite abrir outro", async () => {
  await abrir();
  const resumo = { esperadoDinheiro: 150, totalVendas: 60, totalDevolucoes: 10, totalLiquido: 50, numeroVendas: 3, numeroVendasCanceladas: 1, numeroDevolucoes: 1, formas: [{ forma: "Dinheiro", vendas: 50, devolucoes: 0, liquido: 50 }] };
  const result = await closeCaixa({
    caixaId: "caixa-1", fechamentoId: "fech-1", valorContado: 145.5, observacao: "faltou troco", resumo,
    date: "2026-11-20", dateTime: "2026-11-20 18:00", userEmail: "teste@faydai.local"
  });
  assert.equal(result.alreadySaved, false);
  assert.equal(result.diferenca, -4.5);
  const caixa = readDoc("caixas", "caixa-1");
  assert.equal(caixa.status, "fechado");
  assert.equal(caixa.valorContado, 145.5);
  assert.equal(caixa.esperadoDinheiro, 150);
  assert.equal(caixa.diferenca, -4.5);
  assert.equal(caixa.totalLiquido, 50);
  assert.equal(caixa.fechadoPor, "teste@faydai.local");
  assert.equal(caixa.valorAbertura, 100);
  assert.equal(readDoc("caixas", CAIXA_CONTROLE_ID).caixaId, null);

  await abrir({ caixaId: "caixa-2", dateTime: "2026-11-21 08:00", date: "2026-11-21" });
  assert.equal(readDoc("caixas", "caixa-2").status, "aberto");
});

test("fechar duas vezes: o mesmo fechamento é idempotente e outro é recusado", async () => {
  await abrir();
  const resumo = { esperadoDinheiro: 100, totalVendas: 0, totalDevolucoes: 0, totalLiquido: 0, numeroVendas: 0, numeroVendasCanceladas: 0, numeroDevolucoes: 0, formas: [] };
  const args = { caixaId: "caixa-1", fechamentoId: "fech-1", valorContado: 100, resumo, date: "2026-11-20", dateTime: "2026-11-20 18:00" };
  await closeCaixa(args);
  const again = await closeCaixa(args);
  assert.equal(again.alreadySaved, true);
  await assert.rejects(() => closeCaixa({ ...args, fechamentoId: "fech-2" }), /já foi fechado/);
});

test("fechamento rejeita dinheiro contado inválido e caixa inexistente", async () => {
  await abrir();
  const resumo = { esperadoDinheiro: 100, totalVendas: 0, totalDevolucoes: 0, totalLiquido: 0, numeroVendas: 0, numeroVendasCanceladas: 0, numeroDevolucoes: 0, formas: [] };
  const base = { caixaId: "caixa-1", fechamentoId: "f", resumo, date: "2026-11-20", dateTime: "2026-11-20 18:00" };
  await assert.rejects(() => closeCaixa({ ...base, valorContado: -5 }), /dinheiro contado/);
  await assert.rejects(() => closeCaixa({ ...base, caixaId: "nao-existe", valorContado: 10 }), /não existe mais/);
  assert.equal(readDoc("caixas", "caixa-1").status, "aberto");
});

test("loadCaixas devolve o caixa aberto e os caixas recentes, sem o documento de controle", async () => {
  seedDoc("caixas", "antigo", { status: "fechado", data: "2026-01-01" });
  seedDoc("caixas", "recente", { status: "fechado", data: "2026-11-19" });
  await abrir();
  const data = await loadCaixas({ desde: "2026-11-01" });
  assert.equal(data.aberto.id, "caixa-1");
  assert.deepEqual(data.caixas.map((item) => item.id).sort(), ["caixa-1", "recente"]);
});

test("loadCaixas sem caixa aberto devolve aberto nulo", async () => {
  const data = await loadCaixas({ desde: "2026-11-01" });
  assert.equal(data.aberto, null);
  assert.deepEqual(data.caixas, []);
});
