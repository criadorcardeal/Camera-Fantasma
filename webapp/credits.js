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
  getPrice() { const v = parseFloat(localStorage.getItem("ff_price")); return isNaN(v) ? 50 : v; },
  setPrice(v) { localStorage.setItem("ff_price", String(v)); },
  getPin() { return localStorage.getItem("ff_adminpin") || "1234"; },
  setPin(v) { localStorage.setItem("ff_adminpin", String(v)); },
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
    document.getElementById("buy-price").textContent =
      "Pacote de " + this.PACK + " créditos — " + this.fmtPrice(this.getPrice());
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

  // Administracao (mudar preco / PIN). Acesso pelo botao de engrenagem + PIN.
  const adminDlg = document.getElementById("admin-dialog");
  document.getElementById("cred-admin").addEventListener("click", () => {
    const pin = prompt("PIN do administrador:");
    if (pin === null) return;
    if (pin !== Credits.getPin()) { alert("PIN incorreto."); return; }
    document.getElementById("admin-price").value = Credits.getPrice().toFixed(2);
    document.getElementById("admin-pin").value = "";
    adminDlg.showModal();
  });
  document.getElementById("admin-close").addEventListener("click", () => adminDlg.close());
  document.getElementById("admin-save").addEventListener("click", () => {
    const p = parseFloat(String(document.getElementById("admin-price").value).replace(",", "."));
    if (!isNaN(p) && p >= 0) Credits.setPrice(p);
    const newpin = document.getElementById("admin-pin").value.trim();
    if (newpin) Credits.setPin(newpin);
    adminDlg.close();
    alert("Configurações salvas.");
  });
});
