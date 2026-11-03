// cupom.js — cupom NÃO fiscal (térmica 80 mm) + apoio da tela do Caixa.
// Não acessa o Firebase e não altera dados.
const $ = (s) => document.querySelector(s);
const KEY = "faydai-cupom-auto";
const money = (v) => new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" }).format(Number(v) || 0);
const r2 = (v) => Math.round(((Number(v) || 0) + Number.EPSILON) * 100) / 100;
const esc = (v = "") => String(v).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const when = (v) => { const m = String(v || "").match(/^(\d{4})-(\d{2})-(\d{2})(.*)$/); return m ? `${m[3]}/${m[2]}/${m[1]}${m[4]}` : String(v || ""); };
const autoOn = () => { try { return localStorage.getItem(KEY) !== "no"; } catch (e) { return true; } };

function receiptHtml(sale, store) {
  const items = Array.isArray(sale.itens) && sale.itens.length ? sale.itens
    : [{ produtoNome: sale.produtoNome || "Produto", quantidade: sale.quantidade || 0, precoUnitario: sale.precoUnitario || 0 }];
  const sub = (i) => (typeof i.subtotal === "number" ? i.subtotal : r2((Number(i.quantidade) || 0) * (Number(i.precoUnitario) || 0)));
  const total = Number(sale.total) || r2(items.reduce((s, i) => s + sub(i), 0));
  const rows = items.map((i) => `<div class="it"><div>${esc(i.produtoNome || i.nome || "Produto")}</div><div class="row"><span>${Number(i.quantidade) || 0} x ${money(i.precoUnitario)}</span><span>${money(sub(i))}</span></div></div>`).join("");
  const head = [
    store.nome && `<div class="c b big">${esc(store.nome)}</div>`,
    store.endereco && `<div class="c">${esc(store.endereco)}</div>`,
    store.telefone && `<div class="c">Tel.: ${esc(store.telefone)}</div>`,
    store.cnpj && `<div class="c">CNPJ: ${esc(store.cnpj)}</div>`
  ].filter(Boolean).join("");
  const op = String(sale.usuario || "").split("@")[0];
  const cashRows = typeof sale.valorRecebido === "number"
    ? `<div class="row"><span>Recebido</span><span>${money(sale.valorRecebido)}</span></div><div class="row"><span>Troco</span><span>${money(sale.troco)}</span></div>` : "";
  return `<!doctype html><html><head><meta charset="utf-8"><title>Cupom</title><style>
@page{size:80mm auto;margin:0}
*{box-sizing:border-box}
html,body{margin:0;background:#fff;color:#000}
body{width:72mm;margin:0 auto;padding:3mm 0 10mm;font:12.5px/1.35 "Courier New",monospace}
.c{text-align:center}.b{font-weight:700}.big{font-size:1.2em}
.sep{border-top:1px dashed #000;margin:2mm 0}
.row{display:flex;justify-content:space-between;gap:2mm}
.it{margin-bottom:1.5mm;overflow-wrap:anywhere}
.tot{font-size:1.25em;font-weight:700}
</style></head><body>
${head}
<div class="sep"></div>
<div class="c b">CUPOM NÃO FISCAL</div>
<div>Venda: #${esc(String(sale.id || "").slice(-6).toUpperCase())}</div>
<div>${esc(when(sale.dataHora || sale.data))}</div>
${op ? `<div>Operador: ${esc(op)}</div>` : ""}
<div class="sep"></div>
${rows}
<div class="sep"></div>
<div class="row tot"><span>TOTAL</span><span>${money(total)}</span></div>
<div class="row"><span>Pagamento</span><span>${esc(sale.formaPagamento || "—")}</span></div>
${cashRows}
<div class="sep"></div>
<div class="c">Obrigado pela preferência!</div>
<div class="c">Este documento não tem valor fiscal.</div>
</body></html>`;
}

function printHtml(html) {
  const frame = document.createElement("iframe");
  frame.setAttribute("aria-hidden", "true");
  frame.style.cssText = "position:fixed;right:0;bottom:0;width:0;height:0;border:0;visibility:hidden";
  document.body.appendChild(frame);
  const doc = frame.contentWindow.document;
  doc.open(); doc.write(html); doc.close();
  setTimeout(() => {
    try { frame.contentWindow.focus(); frame.contentWindow.print(); } catch (e) { console.error("Falha ao imprimir o cupom:", e); }
    setTimeout(() => frame.remove(), 60000);
  }, 300);
}

export function printSale(sale, store = {}) { printHtml(receiptHtml(sale, store || {})); }

let lastSale = null;
let lastStore = {};
let syncPay = () => {};

export function showSaleDone(sale, store) {
  lastSale = sale; lastStore = store || {};
  const box = $("#sale-done");
  if (!box) return;
  const change = typeof sale.troco === "number" ? ` · Troco: <strong>${money(sale.troco)}</strong>` : "";
  $("#sale-done-text").innerHTML = `Venda registrada: <strong>${money(sale.total)}</strong>${change}`;
  box.hidden = false;
  if (autoOn()) printSale(sale, lastStore);
}

export function resetCaixaUI() {
  const cash = $("#sale-cash-received");
  if (cash) cash.value = "";
  syncPay();
}

export function initCaixaUI(getStore = () => ({})) {
  const select = $("#sale-payment-method"), cash = $("#sale-cash-received"), change = $("#sale-change");
  if (!select || !cash || !change) return;
  let total = 0;
  const update = () => {
    const got = parseFloat(String(cash.value).replace(",", "."));
    if (!Number.isFinite(got) || got <= 0) { change.textContent = ""; change.className = "sale-change"; return; }
    const diff = r2(got - total);
    change.className = "sale-change " + (diff >= 0 ? "ok" : "short");
    change.textContent = diff >= 0 ? `Troco: ${money(diff)}` : `Faltam ${money(-diff)}`;
  };
  syncPay = () => {
    document.querySelectorAll("[data-pay]").forEach((b) => b.classList.toggle("active", b.dataset.pay === select.value));
    const isCash = select.value === "Dinheiro";
    $("#sale-cash-box").hidden = !isCash;
    if (!isCash) cash.value = "";
    update();
  };
  document.querySelectorAll("[data-pay]").forEach((b) => b.addEventListener("click", () => { select.value = b.dataset.pay; syncPay(); }));
  select.addEventListener("change", syncPay);
  cash.addEventListener("input", update);
  document.querySelectorAll("[data-cash]").forEach((b) => b.addEventListener("click", () => {
    cash.value = b.dataset.cash === "exact" ? total.toFixed(2) : b.dataset.cash;
    update();
  }));
  document.addEventListener("cart:changed", (e) => {
    total = Number(e.detail?.total) || 0;
    if ((e.detail?.units || 0) > 0 && $("#sale-done")) $("#sale-done").hidden = true;
    update();
  });
  $("#sale-print-last")?.addEventListener("click", () => { if (lastSale) printSale(lastSale, lastStore); });
  $("#sale-new")?.addEventListener("click", () => { $("#sale-done").hidden = true; $("#sale-product-search").focus(); });

  // Atalhos: F2 busca · F4 finaliza · F8 limpa a compra
  document.addEventListener("keydown", (e) => {
    const panel = $("#caja-panel");
    if (!panel || panel.hidden || $("#caja-content")?.hidden || e.altKey) return;
    if (document.querySelector(".overlay:not([hidden])")) return;
    if (e.key === "F2") { e.preventDefault(); $("#sale-product-search").focus(); $("#sale-product-search").select(); }
    else if (e.key === "F4") { e.preventDefault(); const b = $("#sale-finish-button"); if (!b.disabled) b.click(); }
    else if (e.key === "F8") { e.preventDefault(); $("#sale-clear-button").click(); }
  });

  const auto = $("#print-auto");
  if (auto) {
    auto.checked = autoOn();
    auto.addEventListener("change", () => { try { localStorage.setItem(KEY, auto.checked ? "yes" : "no"); } catch (e) { /* opcional */ } });
  }
  $("#print-test")?.addEventListener("click", () => {
    const n = new Date(), p = (x) => String(x).padStart(2, "0");
    printSale({
      id: "TESTE0", dataHora: `${n.getFullYear()}-${p(n.getMonth() + 1)}-${p(n.getDate())} ${p(n.getHours())}:${p(n.getMinutes())}`,
      itens: [{ produtoNome: "Produto de teste com nome comprido", quantidade: 2, precoUnitario: 5.5 }, { produtoNome: "Outro item", quantidade: 1, precoUnitario: 3 }],
      total: 14, formaPagamento: "Dinheiro", valorRecebido: 20, troco: 6, usuario: "teste"
    }, getStore());
  });
                            }
