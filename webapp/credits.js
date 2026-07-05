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

  // Preço UNITÁRIO (por crédito). Chave nova p/ não herdar o antigo preço de pacote.
  getUnitPrice() { const v = parseFloat(localStorage.getItem("ff_unit_price")); return isNaN(v) ? 5 : v; },
  setUnitPrice(v) { localStorage.setItem("ff_unit_price", String(v)); },
  fmtPrice(v) { return "R$ " + Number(v).toFixed(2).replace(".", ","); },

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

  promptBuy(message) {
    const msg = document.getElementById("buy-msg");
    msg.textContent = message || "";
    msg.hidden = !message;
    const unit = this.getUnitPrice();
    document.getElementById("buy-price").textContent =
      "Crédito: " + this.fmtPrice(unit) + " · Pacote de " + this.PACK + ": " + this.fmtPrice(unit * this.PACK);
    document.getElementById("buy-dialog").showModal();
  },
};

window.addEventListener("DOMContentLoaded", () => {
  Credits.render();

  const buyDlg = document.getElementById("buy-dialog");
  document.getElementById("cred-buy").addEventListener("click", () => Credits.promptBuy());
  document.getElementById("buy-close").addEventListener("click", () => buyDlg.close());
  document.getElementById("buy-confirm").addEventListener("click", () => {
    alert("A compra avulsa (Mercado Pago) entra em breve.\n" +
      "Por enquanto, adicione créditos resgatando um voucher acima.");
  });

  // Administracao. A engrenagem so aparece para admins (account.js checa is_admin()),
  // e a criacao de vouchers e validada no servidor -> nao precisa mais de PIN local.
  const adminDlg = document.getElementById("admin-dialog");
  document.getElementById("cred-admin").addEventListener("click", () => {
    document.getElementById("admin-price").value = Credits.getUnitPrice().toFixed(2);
    adminDlg.showModal();
    if (typeof Account !== "undefined" && Account.listBatches) Account.listBatches();
  });
  document.getElementById("admin-close").addEventListener("click", () => adminDlg.close());
  document.getElementById("admin-save").addEventListener("click", () => {
    const p = parseFloat(String(document.getElementById("admin-price").value).replace(",", "."));
    if (!isNaN(p) && p >= 0) { Credits.setUnitPrice(p); alert("Preço salvo."); }
  });
});
