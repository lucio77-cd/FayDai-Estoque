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

export function replaceArray(target, values = []) {
  target.splice(0, target.length, ...values);
  return target;
}
