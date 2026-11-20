// caixa.js — abertura e fechamento de caixa (sessão de caixa).
// Não acessa a interface, não exibe avisos e não mantém estado visual.
//
// Modelo: coleção "caixas". Cada documento é uma sessão: nasce com status "aberto" (dinheiro da gaveta na
// abertura) e é fechado uma única vez (dinheiro contado, esperado e diferença). O documento de controle
// "controle_caixa_aberto" garante que só exista um caixa aberto por vez (mesmo padrão da vistoria).
// As vendas feitas com o caixa aberto guardam o campo caixaId; as devoluções entram no caixa pelo horário.
import { db, collection, doc, getDoc, getDocs, runTransaction, serverTimestamp, query, where } from "../firebase.js?v=20261109-7";
import { roundMoney, saleTotalOf, returnTotalOf } from "../utils.js?v=20261104-1";

// O Firestore reserva IDs no formato __nome__, por isso o documento de controle não usa esse formato.
export const CAIXA_CONTROLE_ID = "controle_caixa_aberto";
export const FORMA_DINHEIRO = "Dinheiro";
export const VALOR_MAXIMO_CAIXA = 1000000;

const MENSAGEM_JA_ABERTO = "Já existe um caixa aberto. Atualize a tela ou feche o caixa atual antes de abrir outro.";

function erroCaixa(mensagem, codigo) {
  const error = new Error(mensagem);
  error.code = codigo;
  return error;
}

const valorValido = (valor) => Number.isFinite(valor) && valor >= 0 && valor <= VALOR_MAXIMO_CAIXA;

// Gera o ID de um caixa (ou de uma tentativa de fechamento) no cliente, para a operação ser idempotente.
export function newCaixaId() {
  return doc(collection(db, "caixas")).id;
}

// ---------- Cálculo do fechamento (função pura) ----------

const abertoEmMs = (caixa) => (caixa?.abertoEm?.toMillis ? caixa.abertoEm.toMillis() : null);

// Uma devolução entra no caixa aberto se foi registrada depois da abertura (a devolução não guarda caixaId).
export function returnInCaixa(caixa, saleReturn) {
  const abertura = abertoEmMs(caixa);
  const criada = saleReturn?.criadoEm?.toMillis ? saleReturn.criadoEm.toMillis() : null;
  if (abertura !== null && criada !== null) return criada >= abertura;
  return String(saleReturn?.dataHora || "") >= String(caixa?.dataHora || "");
}

// vendas: lista de vendas que inclua as do caixa (e, de preferência, as vendas originais das devoluções).
// devolucoes: devoluções candidatas (a função escolhe as que pertencem ao caixa).
// Dinheiro esperado = dinheiro da abertura + vendas em dinheiro − devoluções de vendas pagas em dinheiro.
export function summarizeCaixa({ caixa, vendas = [], devolucoes = [] }) {
  const porForma = new Map();
  const linha = (forma) => {
    const nome = String(forma || "").trim() || "Não informado";
    if (!porForma.has(nome)) porForma.set(nome, { forma: nome, vendas: 0, devolucoes: 0, liquido: 0 });
    return porForma.get(nome);
  };
  const formaDaVenda = new Map(vendas.map((sale) => [sale.id, sale.formaPagamento]));

  let numeroVendas = 0;
  let numeroVendasCanceladas = 0;
  let totalVendas = 0;
  vendas.filter((sale) => sale.caixaId === caixa.id).forEach((sale) => {
    if (sale.status === "cancelada") { numeroVendasCanceladas += 1; return; }
    const total = saleTotalOf(sale);
    const item = linha(sale.formaPagamento);
    item.vendas = roundMoney(item.vendas + total);
    totalVendas = roundMoney(totalVendas + total);
    numeroVendas += 1;
  });

  let numeroDevolucoes = 0;
  let totalDevolucoes = 0;
  devolucoes.filter((saleReturn) => returnInCaixa(caixa, saleReturn)).forEach((saleReturn) => {
    const total = returnTotalOf(saleReturn);
    const forma = formaDaVenda.get(saleReturn.vendaId) ?? saleReturn.formaPagamentoVenda;
    const item = linha(forma);
    item.devolucoes = roundMoney(item.devolucoes + total);
    totalDevolucoes = roundMoney(totalDevolucoes + total);
    numeroDevolucoes += 1;
  });

  const formas = [...porForma.values()]
    .map((item) => ({ ...item, liquido: roundMoney(item.vendas - item.devolucoes) }))
    .sort((a, b) => b.liquido - a.liquido || a.forma.localeCompare(b.forma, "pt-BR"));
  const dinheiro = porForma.get(FORMA_DINHEIRO) || { vendas: 0, devolucoes: 0 };
  const valorAbertura = roundMoney(caixa.valorAbertura);

  return {
    valorAbertura,
    numeroVendas,
    numeroVendasCanceladas,
    numeroDevolucoes,
    totalVendas,
    totalDevolucoes,
    totalLiquido: roundMoney(totalVendas - totalDevolucoes),
    formas,
    vendasDinheiro: roundMoney(dinheiro.vendas),
    devolucoesDinheiro: roundMoney(dinheiro.devolucoes),
    esperadoDinheiro: roundMoney(valorAbertura + dinheiro.vendas - dinheiro.devolucoes)
  };
}

// ---------- Leitura ----------

// Caixa aberto (se houver) e os caixas dos últimos dias (a partir de "desde", AAAA-MM-DD).
export async function loadCaixas({ desde }) {
  let aberto = null;
  const controle = await getDoc(doc(db, "caixas", CAIXA_CONTROLE_ID));
  if (controle.exists() && controle.data().caixaId) {
    const atual = await getDoc(doc(db, "caixas", controle.data().caixaId));
    if (atual.exists() && atual.data().status === "aberto") aberto = { id: atual.id, ...atual.data() };
  }
  const snapshot = await getDocs(query(collection(db, "caixas"), where("data", ">=", desde)));
  const caixas = snapshot.docs
    .filter((item) => item.id !== CAIXA_CONTROLE_ID)
    .map((item) => ({ id: item.id, ...item.data() }));
  return { aberto, caixas };
}

// Lê direto do banco as vendas e devoluções necessárias ao fechamento (nada de memória da tela).
// Usa as mesmas consultas por "data" que o aplicativo já faz. A venda original de uma devolução que não
// veio na consulta é buscada por ID, porque a forma de pagamento dela decide de onde sai o dinheiro.
export async function loadMovimentosCaixa(caixa) {
  const [vendasSnap, devolucoesSnap] = await Promise.all([
    getDocs(query(collection(db, "vendas"), where("data", ">=", caixa.data))),
    getDocs(query(collection(db, "devolucoes"), where("data", ">=", caixa.data)))
  ]);
  const vendas = vendasSnap.docs.map((item) => ({ id: item.id, ...item.data() }));
  const devolucoes = devolucoesSnap.docs.map((item) => ({ id: item.id, ...item.data() }));

  const conhecidas = new Set(vendas.map((sale) => sale.id));
  const faltando = [...new Set(devolucoes
    .filter((saleReturn) => returnInCaixa(caixa, saleReturn))
    .map((saleReturn) => saleReturn.vendaId)
    .filter((id) => id && !conhecidas.has(id)))];
  // Sem tratar erro de propósito: se a venda original não puder ser lida, o fechamento não pode ser calculado.
  const encontradas = await Promise.all(faltando.map((id) => getDoc(doc(db, "vendas", id))));
  encontradas.forEach((snapshot) => {
    if (snapshot.exists()) vendas.push({ id: snapshot.id, ...snapshot.data() });
  });
  return { vendas, devolucoes };
}

// ---------- Gravação ----------

export async function openCaixa({ caixaId, valorAbertura, observacao = "", date, dateTime, userEmail = null }) {
  if (!caixaId) throw new Error("Identificador do caixa não informado. Atualize a tela e tente de novo.");
  if (!valorValido(valorAbertura)) throw new Error("Informe o dinheiro da gaveta (zero ou mais).");
  const caixaRef = doc(db, "caixas", caixaId);
  const controleRef = doc(db, "caixas", CAIXA_CONTROLE_ID);
  let alreadySaved = false;

  await runTransaction(db, async (transaction) => {
    alreadySaved = false;
    // Reenvio da mesma abertura (ex.: a resposta da rede se perdeu): nada é gravado de novo.
    const existente = await transaction.get(caixaRef);
    if (existente.exists()) {
      alreadySaved = true;
      return;
    }
    // O documento de controle serializa duas aberturas ao mesmo tempo (em dois aparelhos, por exemplo).
    const controle = await transaction.get(controleRef);
    if (controle.exists() && controle.data().caixaId) {
      const anterior = await transaction.get(doc(db, "caixas", controle.data().caixaId));
      if (anterior.exists() && anterior.data().status === "aberto") throw erroCaixa(MENSAGEM_JA_ABERTO, "caixa-ja-aberto");
    }
    transaction.set(caixaRef, {
      status: "aberto",
      valorAbertura: roundMoney(valorAbertura),
      observacaoAbertura: observacao,
      data: date,
      dataHora: dateTime,
      abertoPor: userEmail,
      abertoEm: serverTimestamp()
    });
    transaction.set(controleRef, {
      caixaId,
      atualizadoEm: serverTimestamp(),
      atualizadoPor: userEmail
    });
  });
  return { alreadySaved };
}

// resumo: resultado de summarizeCaixa calculado com dados lidos do banco logo antes do fechamento.
// fechamentoId: gerado ao calcular o resumo e reaproveitado em reenvios, para o fechamento ser idempotente.
export async function closeCaixa({ caixaId, fechamentoId, valorContado, observacao = "", resumo, date, dateTime, userEmail = null }) {
  if (!caixaId || !fechamentoId) throw new Error("Identificador do fechamento não informado. Feche a janela e tente de novo.");
  if (!valorValido(valorContado)) throw new Error("Informe o dinheiro contado na gaveta (zero ou mais).");
  if (!resumo || !Number.isFinite(resumo.esperadoDinheiro)) throw new Error("O resumo do fechamento não foi calculado. Tente de novo.");
  const caixaRef = doc(db, "caixas", caixaId);
  const controleRef = doc(db, "caixas", CAIXA_CONTROLE_ID);
  const contado = roundMoney(valorContado);
  const diferenca = roundMoney(contado - resumo.esperadoDinheiro);
  let alreadySaved = false;

  await runTransaction(db, async (transaction) => {
    alreadySaved = false;
    const caixaSnapshot = await transaction.get(caixaRef);
    if (!caixaSnapshot.exists()) throw new Error("Este caixa não existe mais. Atualize a tela.");
    const atual = caixaSnapshot.data();
    if (atual.status === "fechado") {
      if (atual.fechamentoId === fechamentoId) { alreadySaved = true; return; }
      throw erroCaixa("Este caixa já foi fechado. Atualize a tela.", "caixa-ja-fechado");
    }
    const controle = await transaction.get(controleRef);

    transaction.update(caixaRef, {
      status: "fechado",
      fechamentoId,
      fechadoPor: userEmail,
      fechadoEm: serverTimestamp(),
      dataFechamento: date,
      dataHoraFechamento: dateTime,
      valorContado: contado,
      esperadoDinheiro: roundMoney(resumo.esperadoDinheiro),
      diferenca,
      totalVendas: roundMoney(resumo.totalVendas),
      totalDevolucoes: roundMoney(resumo.totalDevolucoes),
      totalLiquido: roundMoney(resumo.totalLiquido),
      numeroVendas: resumo.numeroVendas,
      numeroVendasCanceladas: resumo.numeroVendasCanceladas,
      numeroDevolucoes: resumo.numeroDevolucoes,
      formas: resumo.formas.map((item) => ({
        forma: item.forma,
        vendas: roundMoney(item.vendas),
        devolucoes: roundMoney(item.devolucoes),
        liquido: roundMoney(item.liquido)
      })),
      observacaoFechamento: observacao
    });
    if (controle.exists() && controle.data().caixaId === caixaId) {
      transaction.set(controleRef, {
        caixaId: null,
        atualizadoEm: serverTimestamp(),
        atualizadoPor: userEmail
      });
    }
  });
  return { alreadySaved, diferenca };
}
