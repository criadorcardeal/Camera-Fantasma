"use strict";

/* =========================================================================
   ComparaCam - Conta (fase paga). Login OBRIGATÓRIO por LINK MÁGICO
   (Supabase Auth). Sem sessão => o app fica atrás do #login-gate. Depois de
   logado, a conta (e-mail, saldo, resgatar voucher, trocar perfil) fica dentro
   da janela Perfil. As fotos continuam só no aparelho. Chaves PÚBLICAS (RLS).
   ========================================================================= */

const CC_SB_URL = "https://djrzihtdlzaqtdmjvdvx.supabase.co";
const CC_SB_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImRqcnppaHRkbHphcXRkbWp2ZHZ4Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODMyMTkwMjYsImV4cCI6MjA5ODc5NTAyNn0.jjCsUrQEOOI2YUELMrmCMlNe5g9PElb67JfcgQCgiY8";

const Account = {
  sb: null,
  session: null,

  init() {
    // Sem a biblioteca (1º acesso offline): mantém o gate; login exige internet.
    if (!(window.supabase && window.supabase.createClient)) return;
    this.sb = window.supabase.createClient(CC_SB_URL, CC_SB_KEY);
    this.sb.auth.onAuthStateChange((_e, session) => this.apply(session));
    this.sb.auth.getSession().then(({ data }) => this.apply(data.session)).catch(() => {});
    // Recarrega o saldo ao abrir o Perfil.
    ["cred-profile", "detail-profile"].forEach((id) => {
      const b = document.getElementById(id);
      if (b) b.addEventListener("click", () => { if (this.session) this.loadBalance(); });
    });
  },

  apply(session) {
    this.session = session || null;
    const logged = !!(session && session.user);
    const gate = document.getElementById("login-gate");
    if (gate) gate.hidden = logged;                 // logado => libera o app
    if (logged) {
      const em = document.getElementById("prof-acc-email");
      if (em) em.textContent = session.user.email;
      this.loadBalance();
    }
  },

  async sendLink() {
    const email = document.getElementById("lg-email").value.trim();
    const msg = document.getElementById("lg-msg");
    const btn = document.getElementById("lg-send");
    if (!/.+@.+\..+/.test(email)) { msg.textContent = "Digite um e-mail válido."; return; }
    if (!this.sb) { msg.textContent = "Sem internet para o primeiro acesso. Conecte-se e tente de novo."; return; }
    btn.disabled = true;
    msg.textContent = "Enviando…";
    const { error } = await this.sb.auth.signInWithOtp({
      email, options: { emailRedirectTo: location.origin + location.pathname },
    });
    if (error) { btn.disabled = false; msg.textContent = "Erro: " + error.message; return; }
    btn.textContent = "Link enviado ✓";            // permanece desabilitado
    msg.textContent = "Enviamos um link de acesso para " + email +
      ". Abra o link neste mesmo aparelho para entrar.";
  },

  async loadBalance() {
    const el = document.getElementById("prof-acc-bal");
    if (el) el.textContent = "…";
    try {
      const { data } = await this.sb.from("wallets").select("balance").maybeSingle();
      if (el) el.textContent = (data && data.balance != null) ? data.balance : 0;
    } catch (_) { if (el) el.textContent = "—"; }
  },

  async redeem() {
    const code = document.getElementById("prof-voucher").value.trim();
    const msg = document.getElementById("prof-redeem-msg");
    if (!code) { msg.textContent = "Digite o código do voucher."; return; }
    msg.textContent = "Resgatando…";
    const { data, error } = await this.sb.rpc("redeem_voucher", { p_code: code });
    if (error) {
      msg.textContent = /invalido|ja usado/i.test(error.message)
        ? "Voucher inválido ou já usado." : "Erro: " + error.message;
      return;
    }
    msg.textContent = "✔ +" + data + " créditos adicionados!";
    document.getElementById("prof-voucher").value = "";
    this.loadBalance();
  },

  async logout() {
    if (!this.sb) return;
    if (!confirm("Trocar de perfil? Você vai sair desta conta.")) return;
    await this.sb.auth.signOut();
    const pd = document.getElementById("profile-dialog");
    if (pd && pd.open) pd.close();
    // onAuthStateChange(SIGNED_OUT) -> apply() reabre o gate.
  },
};

window.addEventListener("DOMContentLoaded", () => {
  Account.init();
  const on = (id, fn) => { const el = document.getElementById(id); if (el) el.addEventListener("click", fn); };
  on("lg-send", () => Account.sendLink());
  on("prof-redeem", () => Account.redeem());
  on("prof-logout", () => Account.logout());
  const email = document.getElementById("lg-email");
  if (email) email.addEventListener("keydown", (e) => { if (e.key === "Enter") Account.sendLink(); });
});
