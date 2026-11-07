import { $, money, roundMoney, formatDate, escapeHtml } from "../utils.js?v=20261104-1";
import { products, entries, exits } from "../estado.js?v=20261106-5";

const EXIT_REASON_LABELS = { perda: "Perda", devolucao: "Devolução ao fornecedor", uso_interno: "Uso interno", outro: "Outra saída" };

function renderExits() {
  const list = $("#exits-list");
  if (!exits.length) {
    list.innerHTML = '<div class="empty-state">Nenhuma saída registrada ainda.</div>';
    return;
  }
  list.innerHTML = [...exits].sort((a, b) => String(b.dataHora || "").localeCompare(String(a.dataHora || "")))
    .map((exit) => {
      const product = products.find((item) => item.id === exit.produtoId);
      return `<article class="entry-card exit-card">
        <div class="item-title-row"><div class="item-title">${escapeHtml(exit.produtoNome || product?.nome || "Produto")}</div><span class="exit-badge">−${Number(exit.quantidade) || 0} un.</span></div>
        <p><strong>${escapeHtml(EXIT_REASON_LABELS[exit.motivo] || exit.motivo || "Saída")}</strong> · ${escapeHtml(formatDate(exit.dataHora || exit.data) || "Data não informada")}</p>
        <p>Responsável: ${escapeHtml(exit.usuario || "Não identificado")}</p>
        ${exit.observacao ? `<p>${escapeHtml(exit.observacao)}</p>` : ""}
      </article>`;
    }).join("");
}

function renderEntries(showArchivedEntries = false) {
  const list = $("#entries-list");
  const visibleEntries = entries.filter((entry) => {
    const linkedProduct = products.find((product) => product.id === entry.produtoId);
    return showArchivedEntries || !linkedProduct?.arquivado;
  });
  if (!visibleEntries.length) {
    list.innerHTML = entries.length
      ? '<div class="empty-state">Nenhuma entrada ativa para mostrar. Ative “Mostrar produtos arquivados” para consultar o histórico preservado.</div>'
      : '<div class="empty-state">Nenhuma entrada registrada ainda.</div>';
    return;
  }
  list.innerHTML = [...visibleEntries]
    .sort((a, b) => String(b.data || "").localeCompare(String(a.data || "")) || (b.criadoEmMs || 0) - (a.criadoEmMs || 0))
    .map((entry) => {
      const linkedProduct = products.find((product) => product.id === entry.produtoId);
      const archived = Boolean(linkedProduct?.arquivado);
      const typeLabel = entry.tipo === "estoque_inicial" ? "Estoque inicial" : "Entrada de mercadoria";
      // Entradas em fardo (campos opcionais: entradas antigas não têm e continuam como antes).
      const packs = Number(entry.fardos) || 0;
      const packSize = Number(entry.unidadesPorFardo) || 0;
      const hasPack = packs > 0 && packSize > 0;
      const hasPackCost = typeof entry.custoFardo === "number" && Number.isFinite(entry.custoFardo);
      const purchaseTotal = hasPack && hasPackCost
        ? roundMoney(packs * entry.custoFardo)
        : roundMoney((Number(entry.quantidade) || 0) * (Number(entry.custoUnitario) || 0));
      const packLine = hasPack
        ? `<p>${packs} fardo(s) de ${packSize} un.${hasPackCost ? ` · ${money(entry.custoFardo)} por fardo` : ""}</p>`
        : "";
      return `<article class="entry-card">
      <div class="item-title-row"><div class="item-title">${escapeHtml(entry.produtoNome || linkedProduct?.nome || "Produto")}${archived ? '<span class="archived-label">Produto arquivado</span>' : ""}</div><span class="stock-badge">+${Number(entry.quantidade) || 0} un.</span></div>
      <p>${escapeHtml(typeLabel)} · ${escapeHtml(formatDate(entry.data) || "Data não informada")} · Custo unitário: ${money(entry.custoUnitario)}</p>
      ${packLine}
      ${entry.fornecedor ? `<p>Fornecedor: ${escapeHtml(entry.fornecedor)}</p>` : ""}
      ${entry.observacao ? `<p>${escapeHtml(entry.observacao)}</p>` : ""}
      <div class="item-meta"><div><span>Total informado da compra</span><strong>${money(purchaseTotal)}</strong></div><div><span>Registro</span><strong>${entry.data ? escapeHtml(entry.data.split("-").reverse().join("/")) : "—"}</strong></div></div>
    </article>`;
    }).join("");
}

export { renderEntries, renderExits };
