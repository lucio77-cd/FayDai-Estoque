// rascunho-carrinho.js — regras puras do rascunho do carrinho do Caixa.
// Não acessa a tela, o Firebase nem o localStorage: recebe e devolve dados simples, para poder ser testado.
// Quem lê e grava no navegador é o app.js.

export const VERSAO_RASCUNHO = 1;
// Rascunho sem nenhuma alteração por mais tempo que isso é descartado ao abrir o sistema.
export const VALIDADE_RASCUNHO_MS = 24 * 60 * 60 * 1000;

// O que fazer com o rascunho salvo quando o carrinho muda:
//  - carrinho com itens: salvar;
//  - carrinho vazio ANTES da restauração: ignorar (a primeira renderização da tela acontece com o
//    carrinho vazio e não pode apagar o rascunho que ainda vai ser recuperado);
//  - carrinho vazio DEPOIS da restauração: apagar (o atendente removeu o último item).
export function acaoRascunho({ carrinhoVazio, jaRestaurado }) {
  if (!carrinhoVazio) return "salvar";
  return jaRestaurado ? "apagar" : "ignorar";
}

export function montarRascunho({ itens, startedAt, saleAttempt, saleDate, paymentMethod, cashReceived, agora = Date.now() }) {
  return {
    version: VERSAO_RASCUNHO,
    savedAt: agora,
    startedAt,
    items: itens.map((item) => ({
      produtoId: item.produtoId,
      nome: item.nome,
      codigoInterno: item.codigoInterno || "",
      codigoBarras: item.codigoBarras || "",
      quantidade: item.quantidade,
      precoCadastrado: item.precoCadastrado,
      precoUnitario: Number.isFinite(item.precoUnitario) ? item.precoUnitario : null,
      origem: item.origem || "busca"
    })),
    saleAttempt,
    saleDate,
    paymentMethod,
    cashReceived
  };
}

function itemValido(item) {
  return Boolean(item) &&
    typeof item.produtoId === "string" && item.produtoId !== "" &&
    typeof item.nome === "string" &&
    Number.isInteger(item.quantidade) && item.quantidade > 0 &&
    Number.isFinite(item.precoCadastrado) &&
    (item.precoUnitario === null || Number.isFinite(item.precoUnitario));
}

// Interpreta o texto salvo no navegador e confere cada item com os produtos de agora.
// Devolve sempre { estado, ... }:
//  "vazio"     — não havia rascunho;
//  "invalido"  — texto ilegível ou em formato desconhecido;
//  "expirado"  — sem alteração há mais de VALIDADE_RASCUNHO_MS;
//  "sem-itens" — nenhum item do rascunho pode mais ser vendido (produto removido, arquivado ou sem saldo);
//  "ok"        — itens prontos para voltar ao carrinho, com a lista do que foi removido ou reduzido.
// precoAtual(produto) é opcional: se informado, o preço cadastrado de cada item é atualizado para o de hoje.
// O preço cobrado (precoUnitario) digitado pelo atendente nunca é alterado.
export function lerRascunho(bruto, { produtos = [], agora = Date.now(), precoAtual = null } = {}) {
  if (bruto === null || bruto === undefined || bruto === "") return { estado: "vazio" };

  let rascunho;
  try { rascunho = JSON.parse(bruto); }
  catch { return { estado: "invalido" }; }

  if (!rascunho || rascunho.version !== VERSAO_RASCUNHO || !Array.isArray(rascunho.items) ||
      !rascunho.items.length || !rascunho.items.every(itemValido) || !Number.isFinite(rascunho.savedAt)) {
    return { estado: "invalido" };
  }
  if (agora - rascunho.savedAt > VALIDADE_RASCUNHO_MS) return { estado: "expirado" };

  const itens = [];
  const removidos = [];
  const reduzidos = [];
  for (const item of rascunho.items) {
    const produto = produtos.find((entry) => entry.id === item.produtoId && !entry.arquivado);
    const saldo = produto ? (Number(produto.quantidade) || 0) : 0;
    if (!produto || saldo < 1) {
      removidos.push(item.nome);
      continue;
    }
    let quantidade = item.quantidade;
    if (quantidade > saldo) {
      quantidade = saldo;
      reduzidos.push(item.nome);
    }
    const preco = typeof precoAtual === "function" ? precoAtual(produto) : NaN;
    itens.push({
      produtoId: item.produtoId,
      nome: item.nome,
      codigoInterno: item.codigoInterno || "",
      codigoBarras: item.codigoBarras || "",
      quantidade,
      precoCadastrado: Number.isFinite(preco) ? preco : item.precoCadastrado,
      precoUnitario: item.precoUnitario === null ? NaN : item.precoUnitario,
      origem: item.origem || "busca"
    });
  }
  if (!itens.length) return { estado: "sem-itens", removidos };

  const tentativaValida = rascunho.saleAttempt &&
    typeof rascunho.saleAttempt.id === "string" &&
    typeof rascunho.saleAttempt.fingerprint === "string";

  return {
    estado: "ok",
    itens,
    removidos,
    reduzidos,
    startedAt: Number.isFinite(rascunho.startedAt) ? rascunho.startedAt : agora,
    saleAttempt: tentativaValida ? rascunho.saleAttempt : null,
    saleDate: typeof rascunho.saleDate === "string" && /^\d{4}-\d{2}-\d{2}$/.test(rascunho.saleDate) ? rascunho.saleDate : "",
    paymentMethod: typeof rascunho.paymentMethod === "string" ? rascunho.paymentMethod : "",
    cashReceived: typeof rascunho.cashReceived === "string" ? rascunho.cashReceived : ""
  };
}
