// estado.js — estado mutável compartilhado entre as telas do aplicativo.
// As referências dos arrays e do objeto de configurações permanecem estáveis.
export const storeSettings = {
  nome: "",
  responsavel: "",
  telefone: "",
  endereco: "",
  cnpj: "",
  codigoInternoAtivo: false,
  codigoBarrasAtivo: false,
  caixaAtivo: false,
  saidasAtivo: true
};

export const products = [];
export const entries = [];
export const exits = [];
export const sales = [];
export const saleCart = [];
export const brands = [];
export const categories = [];
export const inventoryHistory = [];
export const saleReturns = [];
// Caixas (sessões de abertura e fechamento) dos últimos dias; o caixa aberto fica em estadoUi.caixaAberto.
export const caixas = [];

export function replaceArray(target, values = []) {
  target.splice(0, target.length, ...values);
  return target;
}

// Estado de interface que antes ficava em variáveis soltas no app.js.
// É um objeto único: os módulos leem e gravam os campos (estadoUi.campo) sem trocar a referência.
export const estadoUi = {
  // Seleções nos formulários de entrada e saída
  selectedEntryProductId: "",
  selectedExitProductId: "",
  // Caixa: início do atendimento e idempotência da venda (ID gerado no cliente, reaproveitado
  // enquanto o carrinho não mudar).
  saleCartStartedAt: null,
  saleAttempt: null, // { id, fingerprint }
  saleInFlight: false,
  // Filtro de produtos arquivados nas entradas
  showArchivedEntries: false,
  toastTimeout: undefined,
  // Vistoria física
  activeVistoria: null,
  vistoriaDraft: {},
  vistoriaDraftOwner: null,
  vistoriaDirty: false,
  inventoryAvailable: true,
  inventoryLoadErrorShown: false,
  // Cancelamentos e devoluções de venda
  saleReturnsAvailable: true,
  returnsLoadErrorShown: false,
  saleAction: null, // { mode: "cancel" | "return", saleId, returnId }
  // Abertura e fechamento de caixa. caixaAberto = documento do caixa aberto (ou null). Se o banco ainda não
  // liberou a coleção "caixas" (regras), caixasAvailable fica false e as vendas seguem sem exigir caixa aberto.
  caixaAberto: null,
  caixasAvailable: true,
  caixaLoadErrorShown: false
};
