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
  balance: null,          // saldo autoritativo do servidor (wallets)

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
      this.checkAdmin();
    } else {
      this.resetGate();                             // deslogado => volta ao passo do e-mail
      const gear = document.getElementById("cred-admin");
      if (gear) gear.hidden = true;
    }
  },

  /* A engrenagem de Administração só aparece para contas na tabela admins. */
  async checkAdmin() {
    const gear = document.getElementById("cred-admin");
    if (!gear) return;
    gear.hidden = true;
    if (!this.sb || !this.session) return;
    try {
      const { data } = await this.sb.rpc("is_admin");
      gear.hidden = !data;
    } catch (_) { gear.hidden = true; }
  },

  /* Volta o gate ao passo 1 (pedir e-mail) — usado ao deslogar/trocar perfil. */
  resetGate() {
    const s1 = document.getElementById("lg-step1");
    const s2 = document.getElementById("lg-step2");
    if (s1) s1.hidden = false;
    if (s2) s2.hidden = true;
    const code = document.getElementById("lg-code");
    if (code) code.value = "";
    const msg = document.getElementById("lg-msg");
    if (msg) msg.textContent = "";
    const send = document.getElementById("lg-send");
    if (send) send.disabled = false;
    this.pendingEmail = "";
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

  _verify(type, token) {
    return this.sb.auth.verifyOtp({ email: this.pendingEmail, token, type })
      .then(({ error }) => error || null)
      .catch((e) => e);
  },

  /* ---- Passo 2: verificar o código e criar a sessão NESTE aparelho ---- */
  async verifyCode() {
    const token = (document.getElementById("lg-code").value || "").trim();
    const msg = document.getElementById("lg-msg");
    const btn = document.getElementById("lg-verify");
    // Aceita códigos de 4 a 8 dígitos (o tamanho do OTP é configurável no Supabase).
    if (!/^\d{4,8}$/.test(token)) { msg.textContent = "Digite o código recebido por e-mail."; return; }
    if (!this.sb) { msg.textContent = "Sem internet. Conecte-se e tente de novo."; return; }
    btn.disabled = true;
    msg.textContent = "Verificando…";
    // Tenta como login de e-mail; se falhar, tenta como confirmação de cadastro
    // (usuário novo com "Confirmar e-mail" ligado recebe token do tipo 'signup').
    let error = await this._verify("email", token);
    if (error) {
      const err2 = await this._verify("signup", token);
      if (!err2) error = null;
    }
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

  // Atualiza os 3 lugares que mostram o saldo (Perfil, Adquirir, barra da home).
  _refreshBal() {
    const v = (this.balance == null) ? "—" : this.balance;
    ["prof-acc-bal", "buy-bal"].forEach((id) => { const el = document.getElementById(id); if (el) el.textContent = v; });
    if (typeof Credits !== "undefined") Credits.render();
  },

  async loadBalance() {
    try {
      const { data } = await this.sb.from("wallets").select("balance").maybeSingle();
      this.balance = (data && data.balance != null) ? data.balance : 0;
    } catch (_) { this.balance = null; }
    this._refreshBal();
    return this.balance;
  },

  // Gasta/estorna crédito no SERVIDOR (fonte de verdade). Atômico via RPC.
  async spend(n) {
    const { data, error } = await this.sb.rpc("wallet_spend", { p_n: n || 1 });
    if (error) throw error;
    this.balance = data;
    this._refreshBal();
    return data;
  },
  async refundCredit(n) {
    const { data, error } = await this.sb.rpc("wallet_refund", { p_n: n || 1 });
    if (error) throw error;
    this.balance = data;
    this._refreshBal();
    return data;
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
      msg.textContent = /invalido|ja usado|invalid|used/i.test(this._err(error))
        ? "Voucher inválido ou já usado." : "Erro: " + this._err(error);
      return;
    }
    // redeem_voucher devolve {credits, video_url} (jsonb). Compat: aceita também um
    // número puro, caso a função antiga (retornando int) ainda esteja instalada.
    const credits = (data && typeof data === "object") ? data.credits : data;
    const videoUrl = (data && typeof data === "object") ? data.video_url : null;
    msg.textContent = "✔ +" + credits + " créditos adicionados!";
    document.getElementById("buy-voucher").value = "";
    this.loadBalance();
    Reward.open(videoUrl);                           // vídeo do grupo do voucher (obrigatório)
  },

  /* ---- Admin: criar um grupo (lote) de vouchers + gerar os códigos ----
     Seguro: o RPC admin_create_batch só cria se auth.uid() estiver na tabela
     admins (a chave pública não permite ninguém "cunhar" vouchers). ---- */
  // Envia o arquivo de vídeo para o bucket público "videos" e devolve a URL pública.
  async uploadVideo(file, msg) {
    const ext = (file.name.split(".").pop() || "mp4").toLowerCase();
    const path = "ad-" + Date.now() + "." + ext;
    if (msg) msg.textContent = "Enviando vídeo…";
    const { error } = await this.sb.storage.from("videos")
      .upload(path, file, { contentType: file.type || "video/mp4", upsert: false });
    if (error) throw error;
    const { data } = this.sb.storage.from("videos").getPublicUrl(path);
    return data.publicUrl;
  },

  async createBatch() {
    const msg = document.getElementById("vb-msg");
    const credits = parseInt(document.getElementById("vb-credits").value, 10);
    const qty = parseInt(document.getElementById("vb-qty").value, 10);
    let video = document.getElementById("vb-video").value.trim();
    const note = document.getElementById("vb-note").value.trim();
    const fileInput = document.getElementById("vb-video-file");
    const file = fileInput && fileInput.files && fileInput.files[0];
    if (!(credits >= 1)) { msg.textContent = "Créditos por voucher inválido."; return; }
    if (!(qty >= 1 && qty <= 500)) { msg.textContent = "Quantidade deve ser de 1 a 500."; return; }
    if (!this.sb) { msg.textContent = "Sem internet."; return; }
    if (!this.session) { msg.textContent = "Entre na sua conta de administrador primeiro."; return; }
    // Se escolheu um arquivo, envia para o Storage e usa a URL resultante.
    if (file) {
      try { video = await this.uploadVideo(file, msg); }
      catch (e) {
        msg.textContent = "Falha ao enviar o vídeo: " + this._err(e) +
          " (confira se o bucket 'videos' existe, é público e tem a policy de upload de admin).";
        return;
      }
    }
    msg.textContent = "Gerando…";
    const { data, error } = await this.sb.rpc("admin_create_batch", {
      p_credits_each: credits, p_qty: qty, p_video_url: video, p_note: note || null,
    });
    if (error) {
      msg.textContent = /permiss|admin/i.test(this._err(error))
        ? "Sua conta não é administradora. Adicione seu usuário à tabela admins (veja o guia)."
        : "Erro: " + this._err(error);
      return;
    }
    const codes = (data && data.codes) || [];
    msg.textContent = "✔ " + codes.length + " vouchers criados.";
    const ta = document.getElementById("vb-result");
    ta.value = codes.join("\n");
    document.getElementById("vb-result-wrap").hidden = false;
    document.getElementById("vb-copy").hidden = false;
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
  url: "",

  // videoUrl vem do grupo (voucher_batch) resgatado; se vazio, usa o padrão global.
  open(videoUrl) {
    const dlg = document.getElementById("reward-dialog");
    if (!dlg) return;
    this.url = videoUrl || REWARD_VIDEO_URL || "";
    document.getElementById("reward-replay").disabled = true;
    document.getElementById("reward-exit").disabled = true;
    if (!dlg.open) dlg.showModal();
    this.play();
  },

  finish() {
    const fill = document.getElementById("rp-fill");
    if (fill) fill.style.width = "100%";
    document.getElementById("reward-replay").disabled = false;
    document.getElementById("reward-exit").disabled = false;
  },

  play() {
    const video = document.getElementById("reward-video");
    const ph = document.getElementById("reward-placeholder");
    const fill = document.getElementById("rp-fill");
    if (this.timer) { clearInterval(this.timer); this.timer = null; }
    document.getElementById("reward-replay").disabled = true;
    document.getElementById("reward-exit").disabled = true;
    if (fill) fill.style.width = "0%";

    if (this.url) {
      ph.hidden = true;
      video.hidden = false;
      video.src = this.url;
      video.currentTime = 0;
      video.ontimeupdate = () => {
        if (fill && video.duration) fill.style.width = (video.currentTime / video.duration * 100).toFixed(1) + "%";
      };
      video.onended = () => this.finish();
      video.play().catch(() => {
        // Autoplay bloqueado: mostra controle para o usuário iniciar.
        video.controls = true;
      });
    } else {
      // Marcador temporizado (sem vídeo do parceiro ainda).
      video.hidden = true;
      ph.hidden = false;
      const total = REWARD_PLACEHOLDER_SECS * 1000;
      const start = Date.now();
      this.timer = setInterval(() => {
        const p = Math.min(1, (Date.now() - start) / total);
        if (fill) fill.style.width = (p * 100).toFixed(1) + "%";
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

  // Admin — criar vouchers
  on("vb-create", () => Account.createBatch());
  on("vb-copy", () => {
    const ta = document.getElementById("vb-result");
    if (!ta) return;
    ta.select();
    if (navigator.clipboard) navigator.clipboard.writeText(ta.value).catch(() => {});
    else document.execCommand("copy");
  });

  // Termos de uso
  const openTerms = (e) => {
    if (e) e.preventDefault();
    const t = document.getElementById("terms-dialog");
    if (t && !t.open) t.showModal();
  };
  const lgTerms = document.getElementById("lg-terms-link");
  if (lgTerms) lgTerms.addEventListener("click", openTerms);
  const profTerms = document.getElementById("prof-terms-link");
  if (profTerms) profTerms.addEventListener("click", openTerms);
  on("terms-close", () => { const t = document.getElementById("terms-dialog"); if (t && t.open) t.close(); });
  on("terms-x", () => { const t = document.getElementById("terms-dialog"); if (t && t.open) t.close(); });

  // Vídeo obrigatório
  on("reward-replay", () => Reward.play());
  on("reward-exit", () => {
    const dlg = document.getElementById("reward-dialog");
    if (dlg && dlg.open) dlg.close();
    // Volta à tela ComparaCam, fechando o popup "Adquirir créditos".
    const buy = document.getElementById("buy-dialog");
    if (buy && buy.open) buy.close();
  });
  const rdlg = document.getElementById("reward-dialog");
  if (rdlg) rdlg.addEventListener("cancel", (e) => {
    // Impede fechar com Esc enquanto o botão "Sair" estiver desabilitado.
    if (document.getElementById("reward-exit").disabled) e.preventDefault();
  });
});
