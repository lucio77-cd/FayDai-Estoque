// Testes dos dias de uso e da pesquisa de opinião contínua (regras para não cansar, validação, gravação, resumo).
import test from "node:test";
import assert from "node:assert/strict";
import { diasDeUso, mensagemDiasDeUso, GUIA_VERSAO } from "../js/uso.js?v=20261127-1";
import {
  PERGUNTAS, perguntaPorId, estadoInicial, lerEstado, gravarEstado, escolherPergunta, marcarExibida, marcarAdiada,
  marcarRespondida, montarFeedback, enviarFeedback, carregarFeedback, resumirRespostas,
  DIAS_MINIMOS_DE_USO, INTERVALO_APOS_RESPOSTA_DIAS, INTERVALO_SEM_RESPOSTA_DIAS, COLECAO_FEEDBACK
} from "../js/feedback.js?v=20261127-1";
import { resetMockDb, dumpCollection } from "./firebase-mock-runtime.mjs";

const DIA = 24 * 60 * 60 * 1000;
const sempre = () => 0; // sorteio que sempre libera e escolhe a primeira candidata

function armazenamentoFalso() {
  const dados = new Map();
  return { getItem: (k) => (dados.has(k) ? dados.get(k) : null), setItem: (k, v) => dados.set(k, String(v)) };
}

// ---------- dias de uso ----------
test("diasDeUso conta dias do calendário local, não blocos de 24 h", () => {
  const agora = new Date(2026, 10, 27, 0, 5); // 27/11 00:05
  assert.equal(diasDeUso(new Date(2026, 10, 26, 23, 50), agora), 1);
  assert.equal(diasDeUso(new Date(2026, 10, 27, 0, 1), agora), 0);
  assert.equal(diasDeUso(new Date(2026, 9, 28, 12, 0), agora), 30);
});

test("diasDeUso aceita texto de data do Firebase e rejeita valores inválidos", () => {
  const agora = new Date(2026, 10, 27, 12, 0);
  assert.equal(diasDeUso("Tue, 17 Nov 2026 15:00:00 GMT", agora), 10);
  assert.equal(diasDeUso(undefined, agora), null);
  assert.equal(diasDeUso("", agora), null);
  assert.equal(diasDeUso("não é data", agora), null);
});

test("diasDeUso nunca fica negativo (relógio adiantado)", () => {
  assert.equal(diasDeUso(new Date(2026, 11, 5), new Date(2026, 10, 27)), 0);
});

test("mensagemDiasDeUso trata 0, 1 e muitos dias e agradece a partir de 30", () => {
  assert.equal(mensagemDiasDeUso(0), "Hoje é o seu primeiro dia com o FayDai.");
  assert.equal(mensagemDiasDeUso(1), "Você usa o FayDai há 1 dia.");
  assert.equal(mensagemDiasDeUso(12), "Você usa o FayDai há 12 dias.");
  assert.match(mensagemDiasDeUso(34), /há 34 dias\. Obrigado/);
  assert.equal(mensagemDiasDeUso(null), "");
  assert.equal(mensagemDiasDeUso(-2), "");
  assert.match(GUIA_VERSAO, /^\d{4}-\d{2}-\d{2}$/);
});

// ---------- escolha da pergunta ----------
test("não pergunta nada nos primeiros dias de uso", () => {
  assert.equal(escolherPergunta({ estado: estadoInicial(), agora: 1000 * DIA, diasDeUso: DIAS_MINIMOS_DE_USO - 1, aleatorio: sempre }), null);
  assert.ok(escolherPergunta({ estado: estadoInicial(), agora: 1000 * DIA, diasDeUso: DIAS_MINIMOS_DE_USO, aleatorio: sempre }));
});

test("o sorteio decide se aparece: só abaixo da chance configurada", () => {
  const base = { estado: estadoInicial(), agora: 1000 * DIA, diasDeUso: 40 };
  assert.ok(escolherPergunta({ ...base, aleatorio: () => 0.49 }));
  assert.equal(escolherPergunta({ ...base, aleatorio: () => 0.5 }), null);
  assert.equal(escolherPergunta({ ...base, aleatorio: () => 0.99 }), null);
});

test("depois de responder, descansa por uma semana", () => {
  const agora = 1000 * DIA;
  const estado = marcarRespondida(estadoInicial(), "ajuda-geral", agora);
  const tentar = (quando) => escolherPergunta({ estado, agora: quando, diasDeUso: 60, aleatorio: sempre });
  assert.equal(tentar(agora + 1 * DIA), null);
  assert.equal(tentar(agora + INTERVALO_APOS_RESPOSTA_DIAS * DIA - 1), null);
  assert.ok(tentar(agora + INTERVALO_APOS_RESPOSTA_DIAS * DIA));
});

test("pergunta exibida e ignorada só volta depois de 3 dias", () => {
  const agora = 1000 * DIA;
  const estado = marcarExibida(estadoInicial(), agora);
  const tentar = (quando) => escolherPergunta({ estado, agora: quando, diasDeUso: 60, aleatorio: sempre });
  assert.equal(tentar(agora + 2 * DIA), null);
  assert.ok(tentar(agora + INTERVALO_SEM_RESPOSTA_DIAS * DIA));
});

test("'Agora não' adia pelo mesmo intervalo", () => {
  const agora = 1000 * DIA;
  const estado = marcarAdiada(estadoInicial(), agora);
  assert.equal(estado.adiadoAte, agora + INTERVALO_SEM_RESPOSTA_DIAS * DIA);
  assert.equal(escolherPergunta({ estado, agora: agora + DIA, diasDeUso: 60, aleatorio: sempre }), null);
});

test("não repete pergunta já respondida até acabar o ciclo, e recomeça depois", () => {
  let estado = estadoInicial();
  const vistas = [];
  let agora = 1000 * DIA;
  for (let i = 0; i < PERGUNTAS.length; i += 1) {
    const pergunta = escolherPergunta({ estado, agora, diasDeUso: 90, aleatorio: sempre });
    assert.ok(pergunta, `rodada ${i}`);
    assert.ok(!vistas.includes(pergunta.id), `repetiu ${pergunta.id} antes de acabar o ciclo`);
    vistas.push(pergunta.id);
    estado = marcarRespondida(estado, pergunta.id, agora);
    agora += INTERVALO_APOS_RESPOSTA_DIAS * DIA;
  }
  assert.equal(new Set(vistas).size, PERGUNTAS.length);
  // Ciclo completo: volta a perguntar, mas não a mesma que acabou de ser respondida.
  const proxima = escolherPergunta({ estado, agora, diasDeUso: 90, aleatorio: sempre });
  assert.ok(proxima);
  assert.notEqual(proxima.id, vistas[vistas.length - 1]);
});

test("as perguntas têm id único, texto e, nas de nota, rótulos nos extremos", () => {
  const ids = PERGUNTAS.map((pergunta) => pergunta.id);
  assert.equal(new Set(ids).size, ids.length);
  PERGUNTAS.forEach((pergunta) => {
    assert.ok(pergunta.texto.trim().endsWith("?"), pergunta.id);
    assert.ok(["nota", "texto"].includes(pergunta.tipo), pergunta.id);
    if (pergunta.tipo === "nota") assert.equal(pergunta.extremos?.length, 2, pergunta.id);
  });
  assert.equal(perguntaPorId("inexistente"), null);
});

// ---------- estado local ----------
test("o estado local sobrevive à gravação e ignora lixo ou armazenamento quebrado", () => {
  const storage = armazenamentoFalso();
  assert.deepEqual(lerEstado(storage), estadoInicial());
  const estado = marcarRespondida(estadoInicial(), "velocidade", 5 * DIA);
  gravarEstado(storage, estado);
  assert.deepEqual(lerEstado(storage), estado);
  storage.setItem("faydai-feedback-estado", "{quebrado");
  assert.deepEqual(lerEstado(storage), estadoInicial());
  const quebrado = { getItem() { throw new Error("bloqueado"); }, setItem() { throw new Error("bloqueado"); } };
  assert.deepEqual(lerEstado(quebrado), estadoInicial());
  assert.doesNotThrow(() => gravarEstado(quebrado, estado));
});

// ---------- montagem e gravação ----------
const base = { usuario: "loja@exemplo.com", versao: GUIA_VERSAO, diasDeUso: 31, data: "2026-11-27", dataHora: "2026-11-27 14:00" };

test("montarFeedback valida nota de 1 a 5 e limpa o comentário", () => {
  const pergunta = perguntaPorId("facil-vender");
  const ok = montarFeedback({ ...base, pergunta, nota: "4", comentario: "  gostei   muito  " });
  assert.equal(ok.nota, 4);
  assert.equal(ok.comentario, "gostei muito");
  assert.equal(ok.perguntaId, "facil-vender");
  for (const nota of [0, 6, 2.5, null, "abc"]) {
    assert.throws(() => montarFeedback({ ...base, pergunta, nota }), /nota de 1 a 5/, String(nota));
  }
});

test("pergunta de texto exige resposta e limita o tamanho", () => {
  const pergunta = perguntaPorId("falta-algo");
  assert.throws(() => montarFeedback({ ...base, pergunta, comentario: "   " }), /Escreva sua resposta/);
  const longo = montarFeedback({ ...base, pergunta, comentario: "a".repeat(900) });
  assert.equal(longo.comentario.length, 500);
  assert.equal(longo.nota, null);
});

test("montarFeedback rejeita pergunta desconhecida e nunca produz undefined", () => {
  assert.throws(() => montarFeedback({ ...base, pergunta: { id: "x", tipo: "nota", texto: "?" }, nota: 3 }), /Pergunta inválida/);
  const semDias = montarFeedback({ ...base, diasDeUso: null, pergunta: perguntaPorId("indicaria"), nota: 5 });
  assert.equal(semDias.diasDeUso, null);
  assert.ok(Object.values(semDias).every((valor) => valor !== undefined));
});

test("enviarFeedback grava na coleção feedback com carimbo do servidor", async () => {
  resetMockDb();
  const dados = montarFeedback({ ...base, pergunta: perguntaPorId("ajuda-geral"), nota: 5, comentario: "ótimo" });
  await enviarFeedback(dados);
  const gravados = dumpCollection(COLECAO_FEEDBACK);
  assert.equal(gravados.length, 1);
  assert.equal(gravados[0].data.nota, 5);
  assert.equal(gravados[0].data.usuario, "loja@exemplo.com");
  assert.ok(gravados[0].data.criadoEm.__serverTimestamp);
});

// ---------- leitura e resumo ----------
test("resumirRespostas calcula média, distribuição e comentários por pergunta", async () => {
  resetMockDb();
  const respostas = [
    ["ajuda-geral", 5, "muito bom"], ["ajuda-geral", 4, ""], ["ajuda-geral", 3, "poderia ser mais rápido"],
    ["facil-vender", 2, "confuso no começo"], ["falta-algo", null, "relatório por vendedor"]
  ];
  for (const [id, nota, comentario] of respostas) {
    const pergunta = perguntaPorId(id);
    await enviarFeedback(montarFeedback({ ...base, pergunta, nota, comentario }));
  }
  const resumo = resumirRespostas(await carregarFeedback());
  const geral = resumo.find((item) => item.perguntaId === "ajuda-geral");
  assert.equal(geral.total, 3);
  assert.equal(geral.media, 4);
  assert.deepEqual(geral.distribuicao, { 1: 0, 2: 0, 3: 1, 4: 1, 5: 1 });
  assert.equal(geral.comentarios.length, 2);
  const texto = resumo.find((item) => item.perguntaId === "falta-algo");
  assert.equal(texto.media, null);
  assert.equal(texto.comentarios[0].texto, "relatório por vendedor");
  assert.equal(resumo[0].perguntaId, "ajuda-geral"); // a mais respondida vem primeiro
  assert.deepEqual(resumirRespostas([]), []);
});
