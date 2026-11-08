// export.js — geração de arquivo CSV (movida do app.js sem alteração de lógica).
// Os exportadores de cada tela (produtos, vendas...) continuam no app.js porque leem o estado.
import { dateToday } from "./utils.js?v=20261104-1";

// Texto que o Excel deve tratar como texto puro (ex.: código de barras só com dígitos).
export const excelText = (value) => {
  const text = String(value ?? "");
  return text ? { raw: `="${text.replace(/"/g, '""')}"` } : "";
};

export function csvCell(value) {
  if (value && typeof value === "object" && "raw" in value) return value.raw;
  let text = value === null || value === undefined ? "" : String(value);
  // Impede que a planilha trate o texto como fórmula.
  if (/^[=+\-@]/.test(text) && !/^-?\d+([.,]\d+)?$/.test(text)) text = `'${text}`;
  return /[";\n\r]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}
export const csvNumber = (value) => (Number.isFinite(Number(value)) ? Number(value).toFixed(2).replace(".", ",") : "");

// Devolve false (e não baixa nada) quando não há linhas.
export function downloadCsv(filename, header, rows) {
  if (!rows.length) return false;
  const lines = [header, ...rows].map((row) => row.map(csvCell).join(";"));
  const blob = new Blob(["\uFEFF" + lines.join("\r\n")], { type: "text/csv;charset=utf-8;" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = `${filename}-${dateToday()}.csv`;
  document.body.appendChild(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
  return true;
}
