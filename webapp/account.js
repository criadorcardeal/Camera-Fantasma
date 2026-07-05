"use strict";

/* =========================================================================
   ComparaCam - Conta (fase paga, Stage 1).
   Login por LINK MÁGICO (Supabase Auth) + saldo de créditos no SERVIDOR +
   resgate de VOUCHER. As fotos continuam só no aparelho — aqui só trafega
   conta/saldo/voucher. Chaves PÚBLICAS (protegidas por RLS) — ok no frontend.
   ========================================================================= */

const CC_SB_URL = "https://djrzihtdlzaqtdmjvdvx.supabase.co";
const CC_SB_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImRqcnppaHRkbHphcXRkbWp2ZHZ4Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODMyMTkwMjYsImV4cCI6MjA5ODc5NTAyNn0.jjCsUrQEOOI2YUELMrmCMlNe5g9PElb67JfcgQCgiY8";

const Account = {
  sb: null,

  init() {
    if (!(window.supabase && window.supabase.createClient)) return; // lib não carregou (offline)
    this.sb = window.supabase.createClient(CC_SB_URL, CC_SB_KEY);
    this.sb.auth.onAuthStateChange((_e, session) => this.render(session));
    this.sb.auth.getSession().then(({ data }) => this.render(data.session)).catch(() => {});
  },

  render(session) {
    const logged = !!(session && session.user);
    const btn = document.getElementById("cc-account");
    if (btn) {
      btn.textContent = logged ? session.user.email.split("@")[0] : "Entrar";
      btn.classList.toggle("logged", logged);
    }
    const out = document.getElementById("acc-out");
    const inn = document.getElementById("acc-in");
    if (out && inn) {
      out.hidden = logged;
      inn.hidden = !logged;
      if (logged) {
        document.getElementById("acc-user").textContent = session.user.email;
        this.loadBalance();
      }
    }
  },

  async open() {
    if (!this.sb) { alert("Sem conexão para entrar na conta. Tente com internet."); return; }
    const { data } = await this.sb.auth.getSession();
    this.render(data.session);
    document.getElementById("acc-msg").textContent = "";
    document.getElementById("acc-redeem-msg").textContent = "";
    document.getElementById("account-dialog").showModal();
  },

  async sendLink() {
    const email = document.getElementById("acc-email").value.trim();
    const msg = document.getElementById("acc-msg");
    if (!email) { msg.textContent = "Digite seu e-mail."; return; }
    msg.textContent = "Enviando…";
    const { error } = await this.sb.auth.signInWithOtp({
      email, options: { emailRedirectTo: location.origin + location.pathname },
    });
    msg.textContent = error
      ? "Erro: " + error.message
      : "Enviamos um link de acesso para " + email + ". Abra o link neste mesmo aparelho.";
  },

  async loadBalance() {
    const el = document.getElementById("acc-bal");
    if (el) el.textContent = "…";
    try {
      const { data } = await this.sb.from("wallets").select("balance").maybeSingle();
      if (el) el.textContent = (data && data.balance != null) ? data.balance : 0;
    } catch (_) { if (el) el.textContent = "—"; }
  },

  async redeem() {
    const code = document.getElementById("acc-voucher").value.trim();
    const msg = document.getElementById("acc-redeem-msg");
    if (!code) { msg.textContent = "Digite o código do voucher."; return; }
    msg.textContent = "Resgatando…";
    const { data, error } = await this.sb.rpc("redeem_voucher", { p_code: code });
    if (error) {
      msg.textContent = /invalido|ja usado/i.test(error.message)
        ? "Voucher inválido ou já usado." : "Erro: " + error.message;
      return;
    }
    msg.textContent = "✔ +" + data + " créditos adicionados!";
    document.getElementById("acc-voucher").value = "";
    this.loadBalance();
  },

  async logout() {
    if (this.sb) await this.sb.auth.signOut();
    document.getElementById("account-dialog").close();
  },
};

window.addEventListener("DOMContentLoaded", () => {
  Account.init();
  const on = (id, fn) => { const el = document.getElementById(id); if (el) el.addEventListener("click", fn); };
  on("cc-account", () => Account.open());
  on("acc-x", () => document.getElementById("account-dialog").close());
  on("acc-send", () => Account.sendLink());
  on("acc-redeem", () => Account.redeem());
  on("acc-logout", () => Account.logout());
});
