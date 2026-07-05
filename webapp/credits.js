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

  getBalance() { return parseInt(localStorage.getItem("ff_credits") || "0", 10) || 0; },
  setBalance(n) {
    localStorage.setItem("ff_credits", String(Math.max(0, Math.round(n))));
    this.render();
  },
  // Preço UNITÁRIO (por crédito). Chave nova p/ não herdar o antigo preço de pacote.
  getUnitPrice() { const v = parseFloat(localStorage.getItem("ff_unit_price")); return isNaN(v) ? 5 : v; },
  setUnitPrice(v) { localStorage.setItem("ff_unit_price", String(v)); },
  fmtPrice(v) { return "R$ " + Number(v).toFixed(2).replace(".", ","); },

  canStart() { return this.getBalance() >= 1; },
  reserve() { this.setBalance(this.getBalance() - 1); },
  refund() { this.setBalance(this.getBalance() + 1); },
  buyPack() { this.setBalance(this.getBalance() + this.PACK); },

  render() {
    const el = document.getElementById("cred-balance");
    if (!el) return;
    const n = this.getBalance();
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
    Credits.buyPack();
    buyDlg.close();
    alert("Protótipo: " + Credits.PACK + " créditos adicionados (sem cobrança real).\n" +
      "O pagamento via Mercado Pago entra na próxima fase.");
  });

  // Administracao. A engrenagem so aparece para admins (account.js checa is_admin()),
  // e a criacao de vouchers e validada no servidor -> nao precisa mais de PIN local.
  const adminDlg = document.getElementById("admin-dialog");
  document.getElementById("cred-admin").addEventListener("click", () => {
    document.getElementById("admin-price").value = Credits.getUnitPrice().toFixed(2);
    adminDlg.showModal();
  });
  document.getElementById("admin-close").addEventListener("click", () => adminDlg.close());
  document.getElementById("admin-save").addEventListener("click", () => {
    const p = parseFloat(String(document.getElementById("admin-price").value).replace(",", "."));
    if (!isNaN(p) && p >= 0) { Credits.setUnitPrice(p); alert("Preço salvo."); }
  });
});
