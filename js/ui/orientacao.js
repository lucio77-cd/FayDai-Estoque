// orientacao.js — guia passo a passo (uma vez por versão), busca na Ajuda, "há quantos dias você usa"
// e o cartão da pesquisa de opinião. Não altera dados da loja; só grava respostas em "feedback".
import { $, onEvent, dateToday, nowDateTime, normalizeText } from "../utils.js?v=20261104-1";
import { GUIA_VERSAO, diasDeUso, mensagemDiasDeUso } from "../uso.js?v=20261127-1";
import {
  lerEstado, gravarEstado, escolherPergunta, marcarExibida, marcarAdiada, marcarRespondida,
  montarFeedback, enviarFeedback
} from "../feedback.js?v=20261127-1";

// ---------- Armazenamento local (nunca derruba a tela se o navegador bloquear) ----------
const memoria = new Map();
const armazenamento = {
  getItem(chave) {
    try { return localStorage.getItem(chave); } catch (error) { return memoria.has(chave) ? memoria.get(chave) : null; }
  },
  setItem(chave, valor) {
    memoria.set(chave, String(valor));
    try { localStorage.setItem(chave, valor); } catch (error) { /* só vale nesta visita */ }
  }
};
const CHAVE_GUIA = "faydai-guia-versao";

// ---------- Guia passo a passo ----------
// Para mostrar o guia de novo a todos, altere os passos e troque GUIA_VERSAO em js/uso.js.
export const PASSOS_DO_GUIA = [
  {
    titulo: "Bem-vindo ao FayDai",
    texto: "Em poucos passos você vê como controlar produtos, vendas e caixa. Este guia aparece só uma vez.",
    itens: ["Para ver de novo, abra a aba Ajuda e toque em “Rever o passo a passo”.", "Qualquer dúvida depois: a aba Ajuda tem a resposta passo a passo, com busca."]
  },
  {
    titulo: "Cadastre produtos e registre entradas",
    texto: "É a base de tudo: sem produtos cadastrados, o estoque e as vendas não funcionam.",
    itens: ["Em Produtos, toque em “+ Novo produto” e informe nome, custo, ganho e quantidade.", "Quando chegar mercadoria, use a aba Entradas para somar ao estoque."],
    aba: "products", botao: "Abrir Produtos"
  },
  {
    titulo: "Abra o caixa e venda",
    texto: "Com o caixa aberto, cada venda baixa o estoque sozinha.",
    itens: ["Na primeira vez, ative “Módulo Caixa” em Configurações.", "Na aba Caixa, informe o dinheiro que tem na gaveta e toque em “Abrir caixa”.", "Leia o código de barras ou digite o nome, escolha o pagamento e toque em “Finalizar venda”."],
    aba: "caja", botao: "Abrir Caixa"
  },
  {
    titulo: "Feche o caixa no fim do dia",
    texto: "O fechamento confere o dinheiro e imprime uma nota com o resumo do dia.",
    itens: ["Toque em “Fechar caixa”, conte a gaveta e digite o valor.", "A nota mostra totais, formas de pagamento, se o dinheiro confere e a comparação em % com o dia anterior.", "Perdeu a nota? Use “Reimprimir fechamento” na lista de fechamentos."],
    aba: "caja", botao: "Ir para o Caixa"
  },
  {
    titulo: "Acompanhe o Painel e guarde uma cópia",
    texto: "O Painel resume vendas, estoque baixo e os produtos que mais saem.",
    itens: ["Em Configurações → Exportar dados, baixe uma planilha de tempos em tempos: é a sua cópia de segurança."],
    aba: "settings", botao: "Abrir Configurações"
  },
  {
    titulo: "Dúvidas? A Ajuda responde",
    texto: "Na aba Ajuda há passo a passo para as tarefas do dia a dia, com busca por palavra.",
    itens: ["De vez em quando o sistema faz uma pergunta rápida sobre o que você acha dele. Responder leva poucos segundos e ajuda a melhorar o que você mais usa. Pode escolher “Agora não”."],
    aba: "help", botao: "Abrir Ajuda"
  }
];

let passoAtual = 0;
let irParaAba = () => {};

function guiaJaVisto() { return armazenamento.getItem(CHAVE_GUIA) === GUIA_VERSAO; }
function marcarGuiaVisto() { armazenamento.setItem(CHAVE_GUIA, GUIA_VERSAO); }

function limpar(elemento) { while (elemento.firstChild) elemento.removeChild(elemento.firstChild); }

function desenharPasso() {
  const passo = PASSOS_DO_GUIA[passoAtual];
  const ultimo = passoAtual === PASSOS_DO_GUIA.length - 1;
  $("#guia-progresso").textContent = `PASSO ${passoAtual + 1} DE ${PASSOS_DO_GUIA.length}`;
  $("#guia-titulo").textContent = passo.titulo;
  $("#guia-texto").textContent = passo.texto;
  const lista = $("#guia-lista");
  limpar(lista);
  passo.itens.forEach((texto) => {
    const item = document.createElement("li");
    item.textContent = texto;
    lista.appendChild(item);
  });
  const abrir = $("#guia-abrir-aba");
  abrir.hidden = !passo.aba;
  abrir.textContent = passo.botao || "";
  $("#guia-voltar").hidden = passoAtual === 0;
  $("#guia-proximo").textContent = ultimo ? "Concluir" : "Próximo";
  $("#guia-pular").hidden = ultimo;
  const pontos = $("#guia-pontos");
  limpar(pontos);
  PASSOS_DO_GUIA.forEach((_, indice) => {
    const ponto = document.createElement("span");
    if (indice === passoAtual) ponto.className = "ativo";
    pontos.appendChild(ponto);
  });
}

export function abrirGuia(passo = 0) {
  passoAtual = Math.min(Math.max(0, passo), PASSOS_DO_GUIA.length - 1);
  desenharPasso();
  $("#guia-overlay").hidden = false;
  $("#guia-proximo").focus();
}

export function fecharGuia() {
  $("#guia-overlay").hidden = true;
}

// ---------- Mensagem de dias de uso ----------
function mostrarDiasDeUso(user) {
  const elemento = $("#welcome-days");
  if (!elemento) return null;
  const dias = diasDeUso(user?.metadata?.creationTime);
  elemento.textContent = mensagemDiasDeUso(dias);
  elemento.hidden = !elemento.textContent;
  return dias;
}

// ---------- Busca na Ajuda ----------
function filtrarAjuda() {
  const termo = normalizeText($("#faq-busca").value);
  const itens = [...document.querySelectorAll("#faq-lista .faq-item")];
  const combinam = itens.filter((item) => !termo || normalizeText(item.textContent).includes(termo));
  itens.forEach((item) => {
    item.hidden = !combinam.includes(item);
    // Com uma busca que deixa poucos resultados, já mostra as respostas abertas.
    item.open = Boolean(termo) && combinam.length <= 3 && combinam.includes(item);
  });
  $("#faq-vazio").hidden = combinam.length > 0;
}

// ---------- Cartão da pesquisa de opinião ----------
let perguntaAtual = null;
let notaEscolhida = null;
let usuarioAtual = null;
let diasAtuais = null;

function textoDoStatus(mensagem, erro = false) {
  const status = $("#feedback-status");
  status.textContent = mensagem;
  status.classList.toggle("error", erro);
}

function esconderCartao() {
  $("#feedback-card").hidden = true;
  perguntaAtual = null;
  notaEscolhida = null;
}

function desenharCartao() {
  const pergunta = perguntaAtual;
  notaEscolhida = null;
  $("#feedback-question").textContent = pergunta.texto;
  textoDoStatus("");
  const escala = $("#feedback-scale");
  const rotulos = $("#feedback-scale-labels");
  const formulario = $("#feedback-form");
  limpar(escala);
  const ehNota = pergunta.tipo === "nota";
  escala.hidden = !ehNota;
  rotulos.hidden = !ehNota;
  formulario.hidden = ehNota; // nas perguntas de nota, o comentário só aparece depois de escolher
  $("#feedback-comment").value = "";
  $("#feedback-comment").required = !ehNota;
  $("#feedback-comment-label").textContent = ehNota ? "Quer explicar? (opcional)" : "Sua resposta";
  $("#feedback-comment").placeholder = ehNota ? "Escreva só se quiser" : "Escreva com suas palavras";
  $("#feedback-send").disabled = false;
  if (ehNota) {
    $("#feedback-label-min").textContent = pergunta.extremos[0];
    $("#feedback-label-max").textContent = pergunta.extremos[1];
    for (let valor = 1; valor <= 5; valor += 1) {
      const botao = document.createElement("button");
      botao.type = "button";
      botao.className = "feedback-nota";
      botao.dataset.nota = String(valor);
      botao.textContent = String(valor);
      botao.setAttribute("aria-pressed", "false");
      botao.setAttribute("aria-label", `Nota ${valor} de 5`);
      escala.appendChild(botao);
    }
  }
  $("#feedback-card").hidden = false;
}

function mostrarPesquisaSePreciso(dias) {
  if (!Number.isInteger(dias)) return;
  const estado = lerEstado(armazenamento);
  const pergunta = escolherPergunta({ estado, diasDeUso: dias });
  if (!pergunta) return;
  // Marca já na exibição: se a pessoa ignorar o cartão, ele só volta depois do intervalo.
  gravarEstado(armazenamento, marcarExibida(estado));
  perguntaAtual = pergunta;
  desenharCartao();
}

async function enviarResposta(evento) {
  evento.preventDefault();
  if (!perguntaAtual) return;
  const botao = $("#feedback-send");
  let dados;
  try {
    dados = montarFeedback({
      pergunta: perguntaAtual,
      nota: notaEscolhida,
      comentario: $("#feedback-comment").value,
      usuario: usuarioAtual?.email || null,
      versao: GUIA_VERSAO,
      diasDeUso: diasAtuais,
      data: dateToday(),
      dataHora: nowDateTime()
    });
  } catch (erro) {
    textoDoStatus(erro.message, true);
    return;
  }
  botao.disabled = true;
  textoDoStatus("Enviando…");
  try {
    await enviarFeedback(dados);
    gravarEstado(armazenamento, marcarRespondida(lerEstado(armazenamento), perguntaAtual.id));
    textoDoStatus("Obrigado! Sua resposta ajuda a melhorar o sistema.");
    $("#feedback-scale").hidden = true;
    $("#feedback-scale-labels").hidden = true;
    $("#feedback-form").hidden = true;
    $("#feedback-later").hidden = true;
    setTimeout(() => { esconderCartao(); $("#feedback-later").hidden = false; }, 3000);
  } catch (erro) {
    console.error("Falha ao enviar a resposta da pesquisa:", erro);
    textoDoStatus("Não foi possível enviar agora. Tente de novo mais tarde.", true);
    botao.disabled = false;
  }
}

// ---------- Inicialização ----------
export function initOrientacaoUI({ irParaAba: irPara }) {
  irParaAba = irPara;

  // Guia
  onEvent("#guia-proximo", "click", () => {
    if (passoAtual >= PASSOS_DO_GUIA.length - 1) fecharGuia();
    else { passoAtual += 1; desenharPasso(); }
  });
  onEvent("#guia-voltar", "click", () => { if (passoAtual > 0) { passoAtual -= 1; desenharPasso(); } });
  onEvent("#guia-pular", "click", fecharGuia);
  onEvent("#guia-close", "click", fecharGuia);
  onEvent("#guia-abrir-aba", "click", () => {
    const aba = PASSOS_DO_GUIA[passoAtual].aba;
    fecharGuia();
    if (aba) irParaAba(aba);
  });
  onEvent("#show-guia", "click", () => abrirGuia(0));
  document.addEventListener("keydown", (evento) => {
    if (evento.key === "Escape" && !$("#guia-overlay").hidden) fecharGuia();
  });

  // Busca na Ajuda
  onEvent("#faq-busca", "input", filtrarAjuda);

  // Pesquisa de opinião
  onEvent("#feedback-scale", "click", (evento) => {
    const botao = evento.target.closest(".feedback-nota");
    if (!botao) return;
    notaEscolhida = Number(botao.dataset.nota);
    document.querySelectorAll("#feedback-scale .feedback-nota").forEach((item) => {
      item.setAttribute("aria-pressed", String(item === botao));
    });
    $("#feedback-form").hidden = false;
    textoDoStatus("");
  });
  onEvent("#feedback-form", "submit", enviarResposta);
  onEvent("#feedback-later", "click", () => {
    gravarEstado(armazenamento, marcarAdiada(lerEstado(armazenamento)));
    esconderCartao();
  });
}

// Chamada depois do login e do carregamento dos dados.
export function mostrarOrientacao(user) {
  usuarioAtual = user || null;
  diasAtuais = mostrarDiasDeUso(user);
  // O guia (uma vez por versão) tem prioridade; a pergunta de opinião nunca aparece junto com ele.
  if (!guiaJaVisto()) {
    marcarGuiaVisto();
    abrirGuia(0);
    return;
  }
  mostrarPesquisaSePreciso(diasAtuais);
}
