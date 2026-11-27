// resultados.js — página resultados.html: o desenvolvedor lê as respostas da pesquisa de opinião.
// Só LÊ a coleção "feedback". Quem pode ler é decidido pelas regras do Firestore (veja docs/feedback.md):
// uma conta que não seja a de administrador entra, mas o banco recusa a leitura e a página avisa.
import { auth, signInWithEmailAndPassword, onAuthStateChanged, signOut } from "./firebase.js?v=20261127-1";
import { carregarFeedback, resumirRespostas } from "./feedback.js?v=20261127-1";
import { $, escapeHtml, formatDate, onEvent } from "./utils.js?v=20261104-1";
import { downloadCsv } from "./export.js?v=20261104-1";

let respostas = [];

const numeroBR = (valor) => String(valor).replace(".", ",");

function mostrar(tela) {
  $("#res-loading").hidden = tela !== "loading";
  $("#res-login").hidden = tela !== "login";
  $("#res-app").hidden = tela !== "app";
}

function status(mensagem, erro = false) {
  const elemento = $("#res-status");
  elemento.textContent = mensagem;
  elemento.classList.toggle("error", erro);
}

function desenharTotais(resumo) {
  const notas = respostas.filter((resposta) => Number.isInteger(resposta.nota));
  const media = notas.length ? Math.round((notas.reduce((soma, resposta) => soma + resposta.nota, 0) / notas.length) * 10) / 10 : null;
  const ultima = respostas.map((resposta) => resposta.data || "").sort().pop() || "";
  const cartao = (rotulo, valor, sub) => `<article class="stat-card"><span class="stat-label">${escapeHtml(rotulo)}</span><strong class="stat-value">${escapeHtml(valor)}</strong><small class="stat-sub">${escapeHtml(sub)}</small></article>`;
  $("#res-totais").innerHTML = [
    cartao("Respostas", String(respostas.length), `${resumo.length} pergunta(s) diferentes`),
    cartao("Nota média geral", media === null ? "—" : numeroBR(media), "de 1 a 5, só perguntas de nota"),
    cartao("Última resposta", ultima ? formatDate(ultima) : "—", "data do envio")
  ].join("");
}

function desenharPergunta(item) {
  const barras = item.tipo === "nota" ? [5, 4, 3, 2, 1].map((nota) => {
    const quantidade = item.distribuicao[nota];
    const largura = item.comNota ? Math.round((quantidade / item.comNota) * 100) : 0;
    return `<div class="res-barra"><span class="res-nota">${nota}</span><span class="res-trilho"><span class="res-preenchido" style="width:${largura}%"></span></span><span class="res-qtd">${quantidade}</span></div>`;
  }).join("") : "";
  const media = item.media === null ? "" : ` · média <strong>${escapeHtml(numeroBR(item.media))}</strong> de 5`;
  const comentarios = item.comentarios.map((comentario) => {
    const nota = comentario.nota ? `nota ${comentario.nota} · ` : "";
    return `<li><span class="small muted">${escapeHtml(formatDate(comentario.data))} · ${escapeHtml(nota)}</span><br>${escapeHtml(comentario.texto)}</li>`;
  }).join("");
  return `<article class="panel res-pergunta">
    <h3>${escapeHtml(item.pergunta)}</h3>
    <p class="small muted">${item.total} resposta(s)${media}</p>
    ${barras}
    ${comentarios ? `<ul class="res-comentarios">${comentarios}</ul>` : ""}
  </article>`;
}

function desenhar() {
  const resumo = resumirRespostas(respostas);
  $("#res-vazio").hidden = respostas.length > 0;
  desenharTotais(resumo);
  $("#res-perguntas").innerHTML = resumo.map(desenharPergunta).join("");
}

async function carregar() {
  status("Carregando…");
  try {
    respostas = await carregarFeedback();
    desenhar();
    status(respostas.length ? `Mostrando as ${respostas.length} respostas mais recentes.` : "");
  } catch (erro) {
    console.error("Falha ao ler a pesquisa:", erro);
    respostas = [];
    desenhar();
    $("#res-vazio").hidden = true;
    status(String(erro?.code || "").includes("permission-denied")
      ? "Esta conta não tem permissão para ler as respostas. Entre com a conta de administrador (veja docs/feedback.md)."
      : (erro?.message || "Não foi possível carregar as respostas."), true);
  }
}

function baixarCsv() {
  const linhas = respostas.map((resposta) => [
    formatDate(resposta.data), resposta.dataHora, resposta.usuario, resposta.diasDeUso ?? "",
    resposta.perguntaId, resposta.pergunta, resposta.nota ?? "", resposta.comentario
  ]);
  if (!downloadCsv("pesquisa-de-opiniao", ["Data", "Data e hora", "Usuário", "Dias de uso", "Código da pergunta", "Pergunta", "Nota", "Comentário"], linhas)) {
    status("Não há respostas para baixar.", true);
  }
}

onEvent("#res-login-form", "submit", async (evento) => {
  evento.preventDefault();
  const botao = $("#res-login-form button[type=submit]");
  botao.disabled = true;
  $("#res-login-erro").textContent = "";
  try {
    await signInWithEmailAndPassword(auth, $("#res-email").value.trim(), $("#res-senha").value);
    $("#res-senha").value = "";
  } catch (erro) {
    console.error("Falha no login:", erro);
    $("#res-login-erro").textContent = "E-mail ou senha incorretos, ou sem conexão.";
  } finally { botao.disabled = false; }
});
onEvent("#res-sair", "click", () => signOut(auth).catch((erro) => console.error("Falha ao sair:", erro)));
onEvent("#res-atualizar", "click", carregar);
onEvent("#res-csv", "click", baixarCsv);

onAuthStateChanged(auth, (usuario) => {
  if (!usuario) { respostas = []; mostrar("login"); return; }
  mostrar("app");
  carregar();
});
