"use strict";

/* =========================================================================
   ComparaCam - Conta (fase paga). Login OBRIGATÓRIO por CÓDIGO OTP de 6
   dígitos (Supabase Auth). O usuário digita o código DENTRO do app, então a
   sessão é gravada no container correto — resolve a dissociação do iOS, onde
   o PWA na tela de início tem armazenamento separado do Safari (o link mágico
   abria no Safari e a sessão não aparecia no app instalado).
   Conta/saldo ficam no Perfil; resgatar voucher fica em "Adquirir créditos";
   após resgate, roda um vídeo obrigatório do patrocinador. As fotos continuam
   só no aparelho. Chaves PÚBLICAS (protegidas por RLS).
   ========================================================================= */

const CC_SB_URL = "https://djrzihtdlzaqtdmjvdvx.supabase.co";
const CC_SB_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImRqcnppaHRkbHphcXRkbWp2ZHZ4Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODMyMTkwMjYsImV4cCI6MjA5ODc5NTAyNn0.jjCsUrQEOOI2YUELMrmCMlNe5g9PElb67JfcgQCgiY8";

/* URL do vídeo do patrocinador (5–30s). Vazio => usa um marcador temporizado
   de 8s. Plugue o mp4 do parceiro aqui quando disponível. */
const REWARD_VIDEO_URL = "";
const REWARD_PLACEHOLDER_SECS = 8;

const Account = {
  sb: null,
  session: null,
  pendingEmail: "",

  init() {
    // Sem a biblioteca (1º acesso offline): mantém o gate; login exige internet.
    if (!(window.supabase && window.supabase.createClient)) return;
    this.sb = window.supabase.createClient(CC_SB_URL, CC_SB_KEY);
    this.sb.auth.onAuthStateChange((_e, session) => this.apply(session));
    this.sb.auth.getSession().then(({ data }) => this.apply(data.session)).catch(() => {});
    // Recarrega o saldo ao abrir o Perfil / o diálogo Adquirir.
    ["cred-profile", "detail-profile", "cred-buy"].forEach((id) => {
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

  /* Extrai uma mensagem legível de qualquer forma de erro (objeto de erro do
     JS aparece vazio "{}" ao ser exibido direto; Error tem props não-enumeráveis). */
  _err(e) {
    if (!e) return "erro desconhecido";
    if (typeof e === "string") return e;
    const parts = [];
    if (e.message) parts.push(e.message);
    else if (e.error_description) parts.push(e.error_description);
    else if (e.msg) parts.push(e.msg);
    if (e.status) parts.push("(HTTP " + e.status + ")");
    if (!parts.length) { try { parts.push(JSON.stringify(e)); } catch (_) {} }
    return parts.join(" ") || "falha ao contatar o servidor";
  },

  /* ---- Passo 1: enviar o código de 6 dígitos ---- */
  async sendCode() {
    const email = document.getElementById("lg-email").value.trim();
    const msg = document.getElementById("lg-msg");
    const btn = document.getElementById("lg-send");
    if (!/.+@.+\..+/.test(email)) { msg.textContent = "Digite um e-mail válido."; return; }
    if (!this.sb) { msg.textContent = "Sem internet para o primeiro acesso. Conecte-se e tente de novo."; return; }
    btn.disabled = true;
    msg.textContent = "Enviando código…";
    try {
      const { error } = await this.sb.auth.signInWithOtp({
        email, options: { shouldCreateUser: true },
      });
      if (error) {
        console.error("signInWithOtp:", error);
        btn.disabled = false;
        msg.textContent = /sending|smtp|email/i.test(this._err(error))
          ? "Não foi possível enviar o e-mail. Verifique a configuração de SMTP no Supabase (detalhe: " + this._err(error) + ")."
          : "Erro ao enviar: " + this._err(error);
        return;
      }
    } catch (e) {
      console.error("signInWithOtp threw:", e);
      btn.disabled = false;
      msg.textContent = "Erro ao enviar: " + this._err(e);
      return;
    }
    this.pendingEmail = email;
    btn.disabled = false;
    msg.textContent = "";
    document.getElementById("lg-step1").hidden = true;
    document.getElementById("lg-step2").hidden = false;
    const shown = document.getElementById("lg-email-shown");
    if (shown) shown.textContent = email;
    const code = document.getElementById("lg-code");
    if (code) { code.value = ""; code.focus(); }
  },

  /* ---- Passo 2: verificar o código e criar a sessão NESTE aparelho ---- */
  async verifyCode() {
    const token = (document.getElementById("lg-code").value || "").trim();
    const msg = document.getElementById("lg-msg");
    const btn = document.getElementById("lg-verify");
    if (!/^\d{6}$/.test(token)) { msg.textContent = "Digite o código de 6 dígitos."; return; }
    if (!this.sb) { msg.textContent = "Sem internet. Conecte-se e tente de novo."; return; }
    btn.disabled = true;
    msg.textContent = "Verificando…";
    let error;
    try {
      ({ error } = await this.sb.auth.verifyOtp({
        email: this.pendingEmail, token, type: "email",
      }));
    } catch (e) { error = e; }
    if (error) {
      console.error("verifyOtp:", error);
      btn.disabled = false;
      msg.textContent = /expired|invalid|token/i.test(this._err(error))
        ? "Código inválido ou expirado. Tente novamente ou reenvie." : "Erro: " + this._err(error);
      return;
    }
    btn.disabled = false;
    msg.textContent = "";
    // onAuthStateChange(SIGNED_IN) -> apply() esconde o gate.
  },

  /* ---- Voltar ao passo 1 (trocar e-mail / reenviar) ---- */
  back() {
    document.getElementById("lg-step2").hidden = true;
    document.getElementById("lg-step1").hidden = false;
    const msg = document.getElementById("lg-msg");
    if (msg) msg.textContent = "";
    const em = document.getElementById("lg-email");
    if (em) em.focus();
  },

  async loadBalance() {
    const els = [document.getElementById("prof-acc-bal"), document.getElementById("buy-bal")].filter(Boolean);
    els.forEach((el) => { el.textContent = "…"; });
    try {
      const { data } = await this.sb.from("wallets").select("balance").maybeSingle();
      const v = (data && data.balance != null) ? data.balance : 0;
      els.forEach((el) => { el.textContent = v; });
    } catch (_) { els.forEach((el) => { el.textContent = "—"; }); }
  },

  /* ---- Resgatar voucher (dentro de "Adquirir créditos") ---- */
  async redeem() {
    const code = document.getElementById("buy-voucher").value.trim();
    const msg = document.getElementById("buy-redeem-msg");
    if (!code) { msg.textContent = "Digite o código do voucher."; return; }
    if (!this.sb) { msg.textContent = "Sem internet. Conecte-se e tente de novo."; return; }
    msg.textContent = "Resgatando…";
    const { data, error } = await this.sb.rpc("redeem_voucher", { p_code: code });
    if (error) {
      msg.textContent = /invalido|ja usado|invalid|used/i.test(error.message)
        ? "Voucher inválido ou já usado." : "Erro: " + error.message;
      return;
    }
    msg.textContent = "✔ +" + data + " créditos adicionados!";
    document.getElementById("buy-voucher").value = "";
    this.loadBalance();
    Reward.open();                                   // vídeo obrigatório após o resgate
  },

  /* ---- "Sair": desabilita o app neste aparelho (exige novo login) ---- */
  async exit() {
    if (!this.sb) return;
    if (!confirm("Sair do aplicativo? Ele será desabilitado neste aparelho até um novo login.")) return;
    await this.sb.auth.signOut();
    const pd = document.getElementById("profile-dialog");
    if (pd && pd.open) pd.close();
    // onAuthStateChange(SIGNED_OUT) -> apply() reabre o gate.
  },

  /* ---- "Trocar perfil": sair para entrar com outra conta ---- */
  async logout() {
    if (!this.sb) return;
    if (!confirm("Trocar de perfil? Você vai sair desta conta.")) return;
    await this.sb.auth.signOut();
    const pd = document.getElementById("profile-dialog");
    if (pd && pd.open) pd.close();
  },
};

/* ========================= Vídeo obrigatório ========================= */
const Reward = {
  timer: null,

  open() {
    const dlg = document.getElementById("reward-dialog");
    if (!dlg) return;
    const replay = document.getElementById("reward-replay");
    const exit = document.getElementById("reward-exit");
    replay.disabled = true;
    exit.disabled = true;
    if (!dlg.open) dlg.showModal();
    this.play();
  },

  finish() {
    document.getElementById("reward-replay").disabled = false;
    document.getElementById("reward-exit").disabled = false;
  },

  play() {
    const video = document.getElementById("reward-video");
    const ph = document.getElementById("reward-placeholder");
    if (this.timer) { clearInterval(this.timer); this.timer = null; }
    document.getElementById("reward-replay").disabled = true;
    document.getElementById("reward-exit").disabled = true;

    if (REWARD_VIDEO_URL) {
      ph.hidden = true;
      video.hidden = false;
      video.src = REWARD_VIDEO_URL;
      video.currentTime = 0;
      video.onended = () => this.finish();
      video.play().catch(() => {
        // Autoplay bloqueado: mostra controle para o usuário iniciar.
        video.controls = true;
      });
    } else {
      // Marcador temporizado (sem vídeo do parceiro ainda).
      video.hidden = true;
      ph.hidden = false;
      const fill = document.getElementById("rp-fill");
      const total = REWARD_PLACEHOLDER_SECS * 1000;
      const start = Date.now();
      fill.style.width = "0%";
      this.timer = setInterval(() => {
        const p = Math.min(1, (Date.now() - start) / total);
        fill.style.width = (p * 100).toFixed(1) + "%";
        if (p >= 1) { clearInterval(this.timer); this.timer = null; this.finish(); }
      }, 100);
    }
  },
};

window.addEventListener("DOMContentLoaded", () => {
  Account.init();
  const on = (id, fn) => { const el = document.getElementById(id); if (el) el.addEventListener("click", fn); };

  // Login OTP
  on("lg-send", () => Account.sendCode());
  on("lg-verify", () => Account.verifyCode());
  on("lg-back", () => Account.back());
  const email = document.getElementById("lg-email");
  if (email) email.addEventListener("keydown", (e) => { if (e.key === "Enter") Account.sendCode(); });
  const code = document.getElementById("lg-code");
  if (code) code.addEventListener("keydown", (e) => { if (e.key === "Enter") Account.verifyCode(); });

  // Adquirir créditos / voucher
  on("buy-redeem", () => Account.redeem());

  // Perfil
  on("prof-exit", () => Account.exit());
  on("prof-logout", () => Account.logout());

  // Vídeo obrigatório
  on("reward-replay", () => Reward.play());
  on("reward-exit", () => {
    const dlg = document.getElementById("reward-dialog");
    if (dlg && dlg.open) dlg.close();
  });
  const rdlg = document.getElementById("reward-dialog");
  if (rdlg) rdlg.addEventListener("cancel", (e) => {
    // Impede fechar com Esc enquanto o botão "Sair" estiver desabilitado.
    if (document.getElementById("reward-exit").disabled) e.preventDefault();
  });
});
