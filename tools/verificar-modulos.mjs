// Verificação rápida dos módulos (sem dependências). Uso, na raiz do projeto:
//   node tools/verificar-modulos.mjs
//
// Confere:
//  1. imports relativos apontam para arquivos que existem;
//  2. o mesmo módulo nunca é importado com versões ?v= diferentes (o navegador criaria duas
//     instâncias separadas, cada uma com seu próprio estado);
//  3. não há ciclos de importação;
//  4. o index.html referencia o app.js com ?v=.
// Sai com código 1 se achar qualquer problema.
import fs from "node:fs";
import path from "node:path";

const raiz = process.cwd();
const arquivos = ["app.js", "cupom.js"];
(function varrer(dir) {
  for (const item of fs.readdirSync(path.join(raiz, dir), { withFileTypes: true })) {
    const rel = path.join(dir, item.name);
    if (item.isDirectory()) varrer(rel);
    else if (item.name.endsWith(".js")) arquivos.push(rel);
  }
})("js");

const padrao = /(?:import|export)\s[^;]*?from\s*["'](\.[^"']+)["']|import\s*["'](\.[^"']+)["']/gs;
const grafo = new Map();
const versoes = new Map();
const problemas = [];

for (const arquivo of arquivos) {
  const codigo = fs.readFileSync(path.join(raiz, arquivo), "utf8");
  const deps = new Set();
  for (const m of codigo.matchAll(padrao)) {
    const [caminho, versao = ""] = (m[1] || m[2]).split("?");
    const alvo = path.normalize(path.join(path.dirname(arquivo), caminho));
    if (!fs.existsSync(path.join(raiz, alvo))) problemas.push(`${arquivo}: importa ${alvo}, que não existe`);
    deps.add(alvo);
    if (!versoes.has(alvo)) versoes.set(alvo, new Map());
    const porVersao = versoes.get(alvo);
    porVersao.set(versao || "(sem versão)", [...(porVersao.get(versao || "(sem versão)") || []), arquivo]);
  }
  grafo.set(arquivo, [...deps]);
}

for (const [modulo, porVersao] of versoes) {
  if (porVersao.size > 1) {
    const detalhe = [...porVersao].map(([v, quem]) => `?${v} em ${quem.join(", ")}`).join(" | ");
    problemas.push(`${modulo} importado com versões diferentes: ${detalhe}`);
  }
}

const visitados = new Set();
const pilha = [];
function buscarCiclo(no) {
  if (pilha.includes(no)) return problemas.push(`ciclo de importação: ${[...pilha.slice(pilha.indexOf(no)), no].join(" -> ")}`);
  if (visitados.has(no)) return;
  visitados.add(no);
  pilha.push(no);
  for (const dep of grafo.get(no) || []) buscarCiclo(dep);
  pilha.pop();
}
arquivos.forEach(buscarCiclo);

const html = fs.readFileSync(path.join(raiz, "index.html"), "utf8");
if (!/src="\.\/app\.js\?v=[^"]+"/.test(html)) problemas.push("index.html: o script do app.js está sem ?v=");

if (problemas.length) {
  console.error(`Encontrado(s) ${problemas.length} problema(s):\n- ${problemas.join("\n- ")}`);
  process.exit(1);
}
console.log(`OK: ${arquivos.length} arquivos, sem versões divergentes, sem ciclos, sem imports quebrados.`);
