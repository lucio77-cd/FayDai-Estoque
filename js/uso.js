// uso.js — versão do guia de novidades e "há quantos dias você usa o sistema".
// Funções puras: não acessam o Firebase nem a tela.

// Troque este valor sempre que uma atualização trouxer algo que o cliente precisa conhecer (e o guia em
// js/ui/orientacao.js tiver passos novos). O guia passo a passo abre UMA vez por navegador para cada valor.
export const GUIA_VERSAO = "2026-11-27";

const MS_POR_DIA = 24 * 60 * 60 * 1000;

// Dias corridos entre o dia em que a conta foi criada e hoje, pelo calendário local (não por 24 h exatas).
// "criadoEm" aceita Date, texto de data (Firebase: metadata.creationTime) ou milissegundos. Inválido: null.
export function diasDeUso(criadoEm, agora = new Date()) {
  if (criadoEm === null || criadoEm === undefined || criadoEm === "") return null;
  const inicio = criadoEm instanceof Date ? criadoEm : new Date(criadoEm);
  if (Number.isNaN(inicio.getTime()) || Number.isNaN(agora.getTime())) return null;
  const dia = (data) => Date.UTC(data.getFullYear(), data.getMonth(), data.getDate());
  return Math.max(0, Math.round((dia(agora) - dia(inicio)) / MS_POR_DIA));
}

export function mensagemDiasDeUso(dias) {
  if (!Number.isInteger(dias) || dias < 0) return "";
  if (dias === 0) return "Hoje é o seu primeiro dia com o FayDai.";
  if (dias === 1) return "Você usa o FayDai há 1 dia.";
  const base = `Você usa o FayDai há ${dias} dias.`;
  return dias >= 30 ? `${base} Obrigado por ajudar a melhorar o sistema.` : base;
}
