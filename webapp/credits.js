"use strict";

/* =========================================================================
   Fotos Fantasma - v3.3 - Creditos (PROTOTIPO do fluxo pago).

   Regras:
   - Sem versao gratuita: criar uma comparacao exige credito.
   - Ao ABRIR (criar) uma comparacao, RESERVA 1 credito.
   - A comparacao e COMPLETADA quando o usuario salva/compartilha -> confirma.
   - Se abandonar (excluir antes de completar) -> devolve o credito.
   - Pacotes de 10 creditos. O administrador pode mudar o preco.

   ATENCAO: prototipo client-side. O saldo fica no aparelho (localStorage) e a
   "compra" apenas adiciona creditos, SEM cobranca real. Pagamento (Mercado
   Pago) e saldo no servidor entram na proxima fase (precisam de backend).
   ========================================================================= */
const Credits = {
  PACK: 10,

  // Preço UNITÁRIO (por crédito) + moeda.
  CURRENCIES: { BRL: { sym: "R$", loc: "pt-BR" }, USD: { sym: "US$", loc: "en-US" }, EUR: { sym: "€", loc: "de-DE" }, GBP: { sym: "£", loc: "en-GB" } },
  getUnitPrice() { const v = parseFloat(localStorage.getItem("ff_unit_price")); return isNaN(v) ? 5 : v; },
  setUnitPrice(v) { localStorage.setItem("ff_unit_price", String(v)); },
  getCurrency() { return localStorage.getItem("ff_currency") || "BRL"; },
  setCurrency(c) { localStorage.setItem("ff_currency", c); },
  fmtPrice(v) {
    const c = this.CURRENCIES[this.getCurrency()] || this.CURRENCIES.BRL;
    return c.sym + " " + Number(v).toLocaleString(c.loc, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  },

  // Saldo AUTORITATIVO no servidor (Account.balance). Sem contador local.
  balance() { return (typeof Account !== "undefined" && typeof Account.balance === "number") ? Account.balance : null; },
  canStart() { const b = this.balance(); return b != null && b >= 1; },
  async reserve() { if (typeof Account !== "undefined") { try { await Account.spend(1); } catch (e) { console.error("reserve:", e); } } },
  async refund() { if (typeof Account !== "undefined") { try { await Account.refundCredit(1); } catch (e) { console.error("refund:", e); } } },

  render() {
    const el = document.getElementById("cred-balance");
    if (!el) return;
    const n = this.balance();
    if (n == null) { el.textContent = "🪙 … créditos"; el.classList.remove("cred-zero"); return; }
    el.textContent = "🪙 " + n + " crédito" + (n === 1 ? "" : "s");
    el.classList.toggle("cred-zero", n === 0);
  },

  // Só resgate de voucher por enquanto (compra avulsa entra com o Mercado Pago).
  promptBuy(message) {
    const msg = document.getElementById("buy-msg");
    if (msg) { msg.textContent = message || ""; msg.hidden = !message; }
    document.getElementById("buy-dialog").showModal();
  },
};

// Há alterações não salvas na Administração? (preço/moeda ou grupo iniciado)
function adminDirty() {
  const cur = parseFloat(String(document.getElementById("admin-price").value).replace(",", "."));
  const priceChanged = !isNaN(cur) && Math.abs(cur - Credits.getUnitPrice()) > 0.0001;
  const currChanged = document.getElementById("admin-currency").value !== Credits.getCurrency();
  const val = (id) => (document.getElementById(id).value || "").trim();
  const fileEl = document.getElementById("vb-video-file");
  const fileSel = !!(fileEl && fileEl.files && fileEl.files.length);
  const groupStarted = !!(val("vb-name") || val("vb-note") || val("vb-video") || val("vb-expires") || fileSel);
  return { priceDirty: priceChanged || currChanged, groupStarted };
}

window.addEventListener("DOMContentLoaded", () => {
  Credits.render();

  const buyDlg = document.getElementById("buy-dialog");
  document.getElementById("cred-buy").addEventListener("click", () => Credits.promptBuy());
  document.getElementById("buy-close").addEventListener("click", () => buyDlg.close());

  // Administracao. A engrenagem so aparece para admins (account.js checa is_admin()),
  // e a criacao de vouchers e validada no servidor -> nao precisa de PIN local.
  const adminDlg = document.getElementById("admin-dialog");
  document.getElementById("cred-admin").addEventListener("click", () => {
    document.getElementById("admin-price").value = Credits.getUnitPrice().toFixed(2);
    document.getElementById("admin-currency").value = Credits.getCurrency();
    adminDlg.showModal();
    if (typeof Account !== "undefined" && Account.listBatches) Account.listBatches();
  });
  document.getElementById("admin-save").addEventListener("click", () => {
    const p = parseFloat(String(document.getElementById("admin-price").value).replace(",", "."));
    if (!isNaN(p) && p >= 0) Credits.setUnitPrice(p);
    Credits.setCurrency(document.getElementById("admin-currency").value);
    document.getElementById("admin-price").value = Credits.getUnitPrice().toFixed(2);
    alert("Preço salvo.");
  });

  // Fechar com confirmação se houver preço/moeda não salvo ou grupo não gerado.
  function tryCloseAdmin() {
    const d = adminDirty();
    const parts = [];
    if (d.priceDirty) parts.push("o preço/moeda foi alterado e não foi salvo");
    if (d.groupStarted) parts.push("um grupo de vouchers foi iniciado e não foi gerado");
    if (parts.length && !confirm("Atenção: " + parts.join(" e ") + ". Fechar mesmo assim?")) return;
    adminDlg.close();
  }
  document.getElementById("admin-x").addEventListener("click", tryCloseAdmin);
  adminDlg.addEventListener("cancel", (e) => { e.preventDefault(); tryCloseAdmin(); });
});
