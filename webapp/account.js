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
    // Deep link de voucher: QR/URL "?voucher=CODE" -> preenche após o login.
    try { this.pendingVoucher = new URLSearchParams(location.search).get("voucher") || ""; } catch (_) {}
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
      this.applyPendingVoucher();
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

  /* Veio de um QR/link "?voucher=CODE": abre "Adquirir" com o código preenchido. */
  applyPendingVoucher() {
    if (!this.pendingVoucher) return;
    const code = this.pendingVoucher; this.pendingVoucher = "";
    const inp = document.getElementById("buy-voucher");
    if (inp) inp.value = code;
    if (typeof Credits !== "undefined") Credits.promptBuy();
    else { const d = document.getElementById("buy-dialog"); if (d && !d.open) d.showModal(); }
    const msg = document.getElementById("buy-redeem-msg");
    if (msg) msg.textContent = "Voucher recebido — toque em Resgatar.";
    try { history.replaceState(null, "", location.origin + location.pathname); } catch (_) {}
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
    const expires = parseInt(document.getElementById("vb-expires").value, 10);
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
      p_expires_days: (expires >= 1 ? expires : null),
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
    this.listBatches();                              // atualiza a lista de grupos
  },

  _esc(s) {
    return String(s == null ? "" : s).replace(/[&<>"]/g,
      (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
  },

  /* ---- Admin: listar grupos criados com contagens ---- */
  async listBatches() {
    const box = document.getElementById("vb-list");
    if (!box) return;
    if (!this.sb || !this.session) { box.innerHTML = ""; return; }
    box.innerHTML = "<p class='vb-empty'>Carregando…</p>";
    const { data, error } = await this.sb.rpc("admin_list_batches");
    if (error) { box.innerHTML = "<p class='vb-empty'>" + this._esc(this._err(error)) + "</p>"; return; }
    const arr = data || [];
    if (!arr.length) { box.innerHTML = "<p class='vb-empty'>Nenhum grupo criado ainda.</p>"; return; }
    box.innerHTML = arr.map((b) => {
      const exp = b.expires_at ? "vence " + new Date(b.expires_at).toLocaleDateString("pt-BR") : "sem validade";
      const vid = b.video_url ? "com vídeo" : "sem vídeo";
      const dis = b.disabled ? " · Desativados: " + b.disabled : "";
      return "<div class='vb-card'>" +
        "<div class='vb-card-top'><b>" + this._esc(b.note || "Sem nome") + "</b>" +
        "<span>" + b.credits_each + " créd/voucher</span></div>" +
        "<div class='vb-card-row'>Resgatados: <b>" + b.redeemed + "/" + b.total + "</b> · Restantes: <b>" + b.active + "</b>" + dis + "</div>" +
        "<div class='vb-card-row vb-muted'>" + exp + " · " + vid + "</div>" +
        "<div class='vb-card-btns'>" +
        "<button type='button' data-act='codes' data-batch='" + b.id + "'>Ver códigos</button>" +
        "<button type='button' data-act='qr' data-batch='" + b.id + "'>QR codes</button>" +
        "<button type='button' data-act='report' data-batch='" + b.id + "'>Relatório</button>" +
        "<button type='button' data-act='disable' data-batch='" + b.id + "'>Desativar</button>" +
        "<button type='button' data-act='delete' data-batch='" + b.id + "' data-active='" + b.active + "'>Excluir</button>" +
        "</div></div>";
    }).join("");
  },

  async viewCodes(batch) {
    const msg = document.getElementById("vb-msg");
    const { data, error } = await this.sb.rpc("admin_batch_codes", { p_batch: batch });
    if (error) { msg.textContent = "Erro: " + this._err(error); return; }
    const lines = (data || []).map((v) =>
      v.code + (v.status === "redeemed" ? "  (resgatado)" : v.status === "disabled" ? "  (desativado)" : ""));
    const ta = document.getElementById("vb-result");
    ta.value = lines.join("\n");
    document.getElementById("vb-result-wrap").hidden = false;
    document.getElementById("vb-copy").hidden = false;
    msg.textContent = lines.length + " código(s).";
  },

  // Relatório de resgates em popup, com tabela e download CSV.
  _statusPt(s) { return s === "redeemed" ? "resgatado" : s === "disabled" ? "desativado" : "disponível"; },

  async showReport(batch) {
    const dlg = document.getElementById("report-dialog");
    const box = document.getElementById("report-table");
    const sum = document.getElementById("report-summary");
    if (!dlg) return;
    sum.textContent = "Carregando…";
    box.innerHTML = "";
    if (!dlg.open) dlg.showModal();
    const { data, error } = await this.sb.rpc("admin_batch_report", { p_batch: batch });
    if (error) { sum.textContent = this._err(error); return; }
    const rows = data || [];
    this._reportRows = rows;
    const fmt = (iso) => iso ? new Date(iso).toLocaleString("pt-BR") : "";
    box.innerHTML = "<table><thead><tr><th>Código</th><th>E-mail</th><th>Resgatado em</th><th>Status</th></tr></thead><tbody>" +
      rows.map((r) => "<tr><td>" + this._esc(r.code) + "</td><td>" + this._esc(r.email || "") +
        "</td><td>" + fmt(r.redeemed_at) + "</td><td>" + this._statusPt(r.status) + "</td></tr>").join("") +
      "</tbody></table>";
    const redeemed = rows.filter((r) => r.status === "redeemed").length;
    sum.textContent = redeemed + " de " + rows.length + " resgatados";
  },

  reportCsv() {
    const rows = this._reportRows || [];
    const q = (s) => '"' + String(s == null ? "" : s).replace(/"/g, '""') + '"';
    const fmt = (iso) => iso ? new Date(iso).toLocaleString("pt-BR") : "";
    const lines = ["codigo,email,resgatado_em,status"];
    rows.forEach((r) => lines.push([q(r.code), q(r.email || ""), q(fmt(r.redeemed_at)), q(this._statusPt(r.status))].join(",")));
    // BOM para o Excel abrir com acentos corretos.
    const blob = new Blob(["﻿" + lines.join("\r\n")], { type: "text/csv;charset=utf-8" });
    const file = new File([blob], "relatorio-vouchers.csv", { type: "text/csv" });
    this._shareOrDownload(file);
  },

  _fmtValidade(iso) {
    return iso ? "Válido até " + new Date(iso).toLocaleDateString("pt-BR") : "Sem validade";
  },

  // Gera QR codes (código puro) dos vouchers AINDA NÃO resgatados de um grupo.
  async showQR(batch) {
    const dlg = document.getElementById("qr-dialog");
    const grid = document.getElementById("qr-grid");
    if (!dlg || !grid) return;
    this._qrBatch = batch;                            // p/ o botão de download
    document.getElementById("qr-dlmsg").textContent = "";
    grid.innerHTML = "<p class='qr-loading'>Carregando…</p>";
    if (!dlg.open) dlg.showModal();
    const { data, error } = await this.sb.rpc("admin_batch_codes", { p_batch: batch });
    if (error) { grid.innerHTML = "<p class='qr-loading'>" + this._esc(this._err(error)) + "</p>"; return; }
    if (typeof qrcode === "undefined") {
      grid.innerHTML = "<p class='qr-loading'>A biblioteca de QR não carregou (precisa de internet).</p>"; return;
    }
    const codes = (data || []).filter((v) => v.status === "active");
    if (!codes.length) { grid.innerHTML = "<p class='qr-loading'>Nenhum voucher disponível neste grupo.</p>"; return; }
    // Codifica o CÓDIGO PURO (não uma URL): a câmera do celular não abre navegador;
    // a leitura é feita dentro do app (Adquirir → Ler QR code).
    grid.innerHTML = codes.map((v) => {
      const qr = qrcode(0, "M"); qr.addData(v.code); qr.make();
      return "<div class='qr-cell'>" + qr.createImgTag(4, 8) +
        "<div class='qr-code'>" + this._esc(v.code) + "</div>" +
        "<div class='qr-valid'>" + this._esc(this._fmtValidade(v.expires_at)) + "</div></div>";
    }).join("");
  },

  // Desenha um PNG (QR + código + validade) para cada voucher.
  async _qrPngBlob(code, validade) {
    const qr = qrcode(0, "M"); qr.addData(code); qr.make();
    const img = new Image();
    await new Promise((res, rej) => { img.onload = res; img.onerror = rej; img.src = qr.createDataURL(6, 4); });
    const q = img.width, pad = 20, textH = 52;
    const canvas = document.createElement("canvas");
    canvas.width = q + pad * 2; canvas.height = q + pad + textH;
    const ctx = canvas.getContext("2d");
    ctx.fillStyle = "#fff"; ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.drawImage(img, pad, pad);
    ctx.textAlign = "center"; ctx.fillStyle = "#000";
    ctx.font = "bold 16px monospace"; ctx.fillText(code, canvas.width / 2, q + pad + 20);
    ctx.font = "13px sans-serif"; ctx.fillStyle = "#555"; ctx.fillText(validade, canvas.width / 2, q + pad + 40);
    return new Promise((res) => canvas.toBlob(res, "image/png"));
  },

  // Baixa um .zip com um PNG por voucher AINDA NÃO resgatado do grupo.
  async downloadQRZip() {
    const batch = this._qrBatch;
    const msg = document.getElementById("qr-dlmsg");
    if (!batch) return;
    if (typeof JSZip === "undefined") { msg.textContent = "Compactador não carregou (precisa de internet)."; return; }
    msg.textContent = "Gerando PNGs…";
    const { data, error } = await this.sb.rpc("admin_batch_codes", { p_batch: batch });
    if (error) { msg.textContent = "Erro: " + this._err(error); return; }
    const codes = (data || []).filter((v) => v.status === "active");
    if (!codes.length) { msg.textContent = "Nenhum voucher disponível para baixar."; return; }
    const zip = new JSZip();
    for (const v of codes) {
      const blob = await this._qrPngBlob(v.code, this._fmtValidade(v.expires_at));
      zip.file(v.code + ".png", blob);
    }
    const zipBlob = await zip.generateAsync({ type: "blob" });
    const file = new File([zipBlob], "vouchers-qr.zip", { type: "application/zip" });
    this._shareOrDownload(file);
    msg.textContent = codes.length + " PNG(s) gerado(s).";
  },

  // iOS: Web Share (Salvar em Arquivos); desktop: download.
  _shareOrDownload(file) {
    if (navigator.canShare && navigator.canShare({ files: [file] })) {
      navigator.share({ files: [file] }).catch(() => {});
    } else {
      const url = URL.createObjectURL(file);
      const a = document.createElement("a");
      a.href = url; a.download = file.name;
      document.body.appendChild(a); a.click(); a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 1500);
    }
  },

  // QR de instalação (Android/iPhone) para cartões de convite. Ambos apontam p/ o app.
  showInstallQR() {
    const dlg = document.getElementById("install-qr-dialog");
    if (!dlg) return;
    if (!dlg.open) dlg.showModal();
    const url = location.origin + location.pathname;
    const link = document.getElementById("installqr-link");
    if (link) link.textContent = url;
    const render = (id) => {
      const box = document.getElementById(id);
      if (!box) return;
      if (typeof qrcode === "undefined") { box.textContent = "Precisa de internet."; return; }
      const qr = qrcode(0, "M"); qr.addData(url); qr.make();
      box.innerHTML = qr.createImgTag(5, 8);
    };
    render("installqr-ios");
    render("installqr-android");
  },

  async disableBatch(batch) {
    if (!confirm("Desativar todos os vouchers ainda não resgatados deste grupo? Eles deixarão de funcionar.")) return;
    const msg = document.getElementById("vb-msg");
    const { data, error } = await this.sb.rpc("admin_disable_batch", { p_batch: batch });
    if (error) { msg.textContent = "Erro: " + this._err(error); return; }
    msg.textContent = data + " voucher(s) desativado(s).";
    this.listBatches();
  },

  // Exclui o grupo da lista. Só pergunta se ainda houver vouchers a resgatar.
  async deleteBatch(batch, active) {
    if (active > 0 && !confirm("Ainda há " + active + " voucher(s) sem resgatar neste grupo. Excluir mesmo assim? Esta ação não pode ser desfeita.")) return;
    const msg = document.getElementById("vb-msg");
    const { error } = await this.sb.rpc("admin_delete_batch", { p_batch: batch });
    if (error) { msg.textContent = "Erro: " + this._err(error); return; }
    msg.textContent = "Grupo excluído.";
    this.listBatches();
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

/* ============= Leitor de QR do voucher (câmera, dentro do app) ============= */
const QRScan = {
  stream: null, raf: null, onResult: null,

  async open(onResult) {
    this.onResult = onResult;
    const dlg = document.getElementById("qrscan-dialog");
    const video = document.getElementById("qrscan-video");
    const msg = document.getElementById("qrscan-msg");
    if (!dlg) return;
    msg.textContent = "";
    if (!dlg.open) dlg.showModal();
    if (typeof jsQR === "undefined") { msg.textContent = "Leitor de QR não carregou (precisa de internet)."; return; }
    if (!(navigator.mediaDevices && navigator.mediaDevices.getUserMedia)) {
      msg.textContent = "Este aparelho não permite abrir a câmera aqui."; return;
    }
    try {
      this.stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: "environment" } });
      video.srcObject = this.stream;
      await video.play();
      this._loop();
    } catch (e) {
      msg.textContent = "Não foi possível abrir a câmera. Digite o código manualmente. (" + (e.message || e) + ")";
    }
  },

  _loop() {
    const video = document.getElementById("qrscan-video");
    const canvas = document.createElement("canvas");
    const ctx = canvas.getContext("2d", { willReadFrequently: true });
    const tick = () => {
      if (!this.stream) return;
      if (video.readyState >= 2 && typeof jsQR !== "undefined") {
        canvas.width = video.videoWidth; canvas.height = video.videoHeight;
        if (canvas.width && canvas.height) {
          ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
          const img = ctx.getImageData(0, 0, canvas.width, canvas.height);
          const found = jsQR(img.data, img.width, img.height);
          if (found && found.data) { this._done(found.data); return; }
        }
      }
      this.raf = requestAnimationFrame(tick);
    };
    this.raf = requestAnimationFrame(tick);
  },

  _done(text) {
    let code = String(text || "").trim();
    const m = /[?&]voucher=([^&\s]+)/i.exec(code);   // aceita também um link antigo
    if (m) code = decodeURIComponent(m[1]);
    this.close();
    if (this.onResult) this.onResult(code);
  },

  close() {
    if (this.raf) { cancelAnimationFrame(this.raf); this.raf = null; }
    if (this.stream) { this.stream.getTracks().forEach((t) => t.stop()); this.stream = null; }
    const video = document.getElementById("qrscan-video");
    if (video) video.srcObject = null;
    const dlg = document.getElementById("qrscan-dialog");
    if (dlg && dlg.open) dlg.close();
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
  on("buy-scan", () => QRScan.open((code) => {
    const inp = document.getElementById("buy-voucher");
    if (inp) inp.value = code;
    const msg = document.getElementById("buy-redeem-msg");
    if (msg) msg.textContent = "Código lido — toque em Resgatar.";
  }));
  on("qrscan-cancel", () => QRScan.close());
  const qsd = document.getElementById("qrscan-dialog");
  if (qsd) qsd.addEventListener("cancel", () => QRScan.close());

  // Perfil
  on("prof-exit", () => Account.exit());
  on("prof-logout", () => Account.logout());

  // Admin — criar / gerir vouchers
  on("vb-create", () => Account.createBatch());
  on("vb-list-refresh", () => Account.listBatches());
  on("vb-copy", () => {
    const ta = document.getElementById("vb-result");
    if (!ta) return;
    ta.select();
    if (navigator.clipboard) navigator.clipboard.writeText(ta.value).catch(() => {});
    else document.execCommand("copy");
  });
  const vbList = document.getElementById("vb-list");
  if (vbList) vbList.addEventListener("click", (e) => {
    const btn = e.target.closest("button[data-act]");
    if (!btn) return;
    const batch = btn.getAttribute("data-batch");
    const act = btn.getAttribute("data-act");
    if (act === "codes") Account.viewCodes(batch);
    else if (act === "qr") Account.showQR(batch);
    else if (act === "report") Account.showReport(batch);
    else if (act === "disable") Account.disableBatch(batch);
    else if (act === "delete") Account.deleteBatch(batch, parseInt(btn.getAttribute("data-active"), 10) || 0);
  });
  on("admin-install-qr", () => Account.showInstallQR());
  on("installqr-close", () => { const d = document.getElementById("install-qr-dialog"); if (d && d.open) d.close(); });
  on("installqr-x", () => { const d = document.getElementById("install-qr-dialog"); if (d && d.open) d.close(); });
  on("qr-close", () => { const d = document.getElementById("qr-dialog"); if (d && d.open) d.close(); });
  on("qr-x", () => { const d = document.getElementById("qr-dialog"); if (d && d.open) d.close(); });
  on("qr-download", () => Account.downloadQRZip());
  on("report-csv", () => Account.reportCsv());
  on("report-close", () => { const d = document.getElementById("report-dialog"); if (d && d.open) d.close(); });
  on("report-x", () => { const d = document.getElementById("report-dialog"); if (d && d.open) d.close(); });

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

  // Política de Privacidade (LGPD)
  const openPrivacy = (e) => {
    if (e) e.preventDefault();
    const p = document.getElementById("privacy-dialog");
    if (p && !p.open) p.showModal();
  };
  ["lg-privacy-link", "prof-privacy-link"].forEach((id) => {
    const el = document.getElementById(id);
    if (el) el.addEventListener("click", openPrivacy);
  });
  on("privacy-close", () => { const p = document.getElementById("privacy-dialog"); if (p && p.open) p.close(); });
  on("privacy-x", () => { const p = document.getElementById("privacy-dialog"); if (p && p.open) p.close(); });

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
