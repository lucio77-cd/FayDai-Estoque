// feedback.js — pesquisa contínua de opinião (uma pergunta por vez, sem cansar) e leitura dos resultados.
// A escolha da pergunta e o resumo são funções puras. Só enviarFeedback e carregarFeedback usam o Firebase.
import { db, collection, addDoc, getDocs, query, orderBy, limit, serverTimestamp } from "./firebase.js?v=20261127-1";

export const COLECAO_FEEDBACK = "feedback";
export const CHAVE_ESTADO = "faydai-feedback-estado";
export const MAX_COMENTARIO = 500;

// ---------- Regras para não cansar ----------
export const DIAS_MINIMOS_DE_USO = 3;        // não pergunta nada antes de a pessoa conhecer o sistema
export const INTERVALO_APOS_RESPOSTA_DIAS = 7; // depois de responder, descansa uma semana
export const INTERVALO_SEM_RESPOSTA_DIAS = 3;  // viu e fechou (ou ignorou): volta só depois de 3 dias
export const CHANCE_DE_APARECER = 0.5;         // mesmo liberado, só aparece em metade das aberturas

const MS_POR_DIA = 24 * 60 * 60 * 1000;

// Perguntas. "nota": escala de 1 a 5 + comentário opcional. "texto": resposta livre.
// Para incluir uma pergunta nova, basta acrescentar um item com "id" único (nunca reaproveite um id antigo).
export const PERGUNTAS = [
  { id: "ajuda-geral", tipo: "nota", texto: "No dia a dia, o quanto o FayDai ajuda você a controlar a loja?", extremos: ["Quase nada", "Ajuda muito"] },
  { id: "facil-vender", tipo: "nota", texto: "Vender no Caixa é fácil?", extremos: ["Difícil", "Muito fácil"] },
  { id: "facil-estoque", tipo: "nota", texto: "Cadastrar produtos e registrar entradas é fácil?", extremos: ["Difícil", "Muito fácil"] },
  { id: "confianca-numeros", tipo: "nota", texto: "Você confia nos números do Painel e do fechamento do caixa?", extremos: ["Não confio", "Confio totalmente"] },
  { id: "velocidade", tipo: "nota", texto: "O sistema responde rápido quando você usa?", extremos: ["Lento", "Rápido"] },
  { id: "indicaria", tipo: "nota", texto: "O quanto você indicaria o FayDai para outro lojista?", extremos: ["Não indicaria", "Indicaria com certeza"] },
  { id: "falta-algo", tipo: "texto", texto: "O que mais faz falta no sistema hoje?" },
  { id: "maior-dificuldade", tipo: "texto", texto: "O que foi mais difícil ou confuso de usar?" },
  { id: "mais-gosta", tipo: "texto", texto: "O que você mais usa e mais gosta no sistema?" }
];

export const perguntaPorId = (id) => PERGUNTAS.find((pergunta) => pergunta.id === id) || null;

// ---------- Estado local (por navegador) ----------
// { ultimaExibicao, ultimaResposta, adiadoAte (ms), respondidas: [ids do ciclo atual] }
export function estadoInicial() {
  return { ultimaExibicao: 0, ultimaResposta: 0, adiadoAte: 0, respondidas: [] };
}

export function lerEstado(storage) {
  try {
    const bruto = JSON.parse(storage.getItem(CHAVE_ESTADO) || "null");
    if (!bruto || typeof bruto !== "object") return estadoInicial();
    const numero = (valor) => (Number.isFinite(Number(valor)) ? Number(valor) : 0);
    return {
      ultimaExibicao: numero(bruto.ultimaExibicao),
      ultimaResposta: numero(bruto.ultimaResposta),
      adiadoAte: numero(bruto.adiadoAte),
      respondidas: Array.isArray(bruto.respondidas) ? bruto.respondidas.filter((id) => typeof id === "string") : []
    };
  } catch (error) {
    return estadoInicial();
  }
}

export function gravarEstado(storage, estado) {
  try { storage.setItem(CHAVE_ESTADO, JSON.stringify(estado)); }
  catch (error) { console.warn("Não foi possível salvar o andamento da pesquisa:", error); }
}

// ---------- Escolha da pergunta ----------
// Devolve a pergunta a mostrar agora ou null. "aleatorio" é injetável (testes); padrão Math.random.
export function escolherPergunta({ estado, agora = Date.now(), diasDeUso = 0, aleatorio = Math.random, perguntas = PERGUNTAS }) {
  if (!Number.isFinite(diasDeUso) || diasDeUso < DIAS_MINIMOS_DE_USO) return null;
  if (agora < estado.adiadoAte) return null;
  if (estado.ultimaResposta && agora - estado.ultimaResposta < INTERVALO_APOS_RESPOSTA_DIAS * MS_POR_DIA) return null;
  if (estado.ultimaExibicao && agora - estado.ultimaExibicao < INTERVALO_SEM_RESPOSTA_DIAS * MS_POR_DIA) return null;
  if (aleatorio() >= CHANCE_DE_APARECER) return null;

  // Não repete uma pergunta já respondida até acabar o ciclo; quando todas foram respondidas, recomeça.
  let candidatas = perguntas.filter((pergunta) => !estado.respondidas.includes(pergunta.id));
  if (!candidatas.length) candidatas = perguntas.filter((pergunta) => pergunta.id !== estado.respondidas[estado.respondidas.length - 1]);
  if (!candidatas.length) candidatas = perguntas;
  return candidatas[Math.min(candidatas.length - 1, Math.floor(aleatorio() * candidatas.length))] || null;
}

// Registra que o cartão apareceu: se a pessoa ignorar, ele só volta depois do intervalo.
export function marcarExibida(estado, agora = Date.now()) {
  return { ...estado, ultimaExibicao: agora };
}

export function marcarAdiada(estado, agora = Date.now()) {
  return { ...estado, ultimaExibicao: agora, adiadoAte: agora + INTERVALO_SEM_RESPOSTA_DIAS * MS_POR_DIA };
}

export function marcarRespondida(estado, perguntaId, agora = Date.now()) {
  const respondidas = [...new Set([...estado.respondidas, perguntaId])];
  // Ciclo completo: zera a lista, mas guarda a última para ela não vir duas vezes seguidas.
  const cicloCompleto = PERGUNTAS.every((pergunta) => respondidas.includes(pergunta.id));
  return { ...estado, ultimaExibicao: agora, ultimaResposta: agora, adiadoAte: 0, respondidas: cicloCompleto ? [perguntaId] : respondidas };
}

// ---------- Resposta ----------
// Valida e monta o documento. Lança Error com mensagem clara para o usuário.
export function montarFeedback({ pergunta, nota = null, comentario = "", usuario, versao = "", diasDeUso = null, data, dataHora }) {
  if (!pergunta || !perguntaPorId(pergunta.id)) throw new Error("Pergunta inválida.");
  const texto = String(comentario || "").trim().replace(/\s+/g, " ").slice(0, MAX_COMENTARIO);
  let notaFinal = null;
  if (pergunta.tipo === "nota") {
    notaFinal = Number(nota);
    if (!Number.isInteger(notaFinal) || notaFinal < 1 || notaFinal > 5) throw new Error("Escolha uma nota de 1 a 5.");
  } else if (!texto) {
    throw new Error("Escreva sua resposta antes de enviar.");
  }
  return {
    perguntaId: pergunta.id,
    pergunta: pergunta.texto,
    tipo: pergunta.tipo,
    nota: notaFinal,
    comentario: texto,
    usuario: usuario || null,
    versaoGuia: versao || "",
    diasDeUso: Number.isInteger(diasDeUso) ? diasDeUso : null,
    data,
    dataHora
  };
}

export async function enviarFeedback(dados) {
  return addDoc(collection(db, COLECAO_FEEDBACK), { ...dados, criadoEm: serverTimestamp() });
}

// ---------- Leitura e resumo (usados pela página resultados.html) ----------
export async function carregarFeedback(maximo = 500) {
  const snapshot = await getDocs(query(collection(db, COLECAO_FEEDBACK), orderBy("criadoEm", "desc"), limit(maximo)));
  return snapshot.docs.map((item) => ({ id: item.id, ...item.data() }));
}

// Agrupa as respostas por pergunta: média e distribuição (notas) e lista de comentários, do mais novo ao mais antigo.
export function resumirRespostas(respostas = []) {
  const grupos = new Map();
  respostas.forEach((resposta) => {
    const id = resposta.perguntaId || "desconhecida";
    if (!grupos.has(id)) {
      grupos.set(id, {
        perguntaId: id,
        pergunta: resposta.pergunta || perguntaPorId(id)?.texto || id,
        tipo: resposta.tipo || (Number.isInteger(resposta.nota) ? "nota" : "texto"),
        total: 0,
        soma: 0,
        distribuicao: { 1: 0, 2: 0, 3: 0, 4: 0, 5: 0 },
        comentarios: []
      });
    }
    const grupo = grupos.get(id);
    grupo.total += 1;
    if (Number.isInteger(resposta.nota) && resposta.nota >= 1 && resposta.nota <= 5) {
      grupo.soma += resposta.nota;
      grupo.distribuicao[resposta.nota] += 1;
    }
    if (resposta.comentario) grupo.comentarios.push({ data: resposta.data || "", texto: resposta.comentario, nota: Number.isInteger(resposta.nota) ? resposta.nota : null });
  });
  return [...grupos.values()].map((grupo) => {
    const comNota = Object.values(grupo.distribuicao).reduce((a, b) => a + b, 0);
    return { ...grupo, media: comNota ? Math.round((grupo.soma / comNota) * 10) / 10 : null, comNota };
  }).sort((a, b) => b.total - a.total || a.pergunta.localeCompare(b.pergunta, "pt-BR"));
}
