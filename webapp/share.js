"use strict";

/* =========================================================================
   Fotos Fantasma - v3.0 - Salvar/baixar fotos e a comparacao.

   No iPhone usa o painel nativo (Web Share): "Salvar em Fotos" (galeria),
   "Salvar em Arquivos" (iCloud/Drive/OneDrive/Dropbox), AirDrop, apps. Em
   navegadores sem isso (desktop), baixa o arquivo.
   (baseSrc, followSrc, fmtDate, $, loadImageEl sao globais.)
   ========================================================================= */

async function dataUrlToFile(dataUrl, name) {
  const blob = await (await fetch(dataUrl)).blob();
  return new File([blob], name, { type: "image/jpeg" });
}

// Baixa um arquivo (fallback para navegadores sem Web Share).
function downloadFile(file) {
  const url = URL.createObjectURL(file);
  const a = document.createElement("a");
  a.href = url;
  a.download = file.name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

// Compartilha imediatamente (sem await antes) para preservar o gesto do iOS.
// Resolve true quando salvou/compartilhou; false se o usuário cancelou.
function shareFile(file) {
  if (navigator.canShare && navigator.canShare({ files: [file] })) {
    return navigator.share({ files: [file], title: file.name }).then(() => true).catch(() => false);
  }
  downloadFile(file);
  return Promise.resolve(true);
}

// Compartilha/salva VÁRIOS arquivos (ex.: as 2 fotos separadas).
function shareFiles(files) {
  if (navigator.canShare && navigator.canShare({ files })) {
    return navigator.share({ files }).then(() => true).catch(() => false);
  }
  files.forEach((f, i) => setTimeout(() => downloadFile(f), i * 400));
  return Promise.resolve(true);
}

// Pop-up de confirmação após salvar/baixar a mídia.
function showSavedPopup(what) {
  const t = $("#saved-title");
  if (t) {
    t.textContent = /^video/.test(what) ? "Vídeo salvo!"
      : (what === "separate" ? "Fotos salvas!" : "Foto salva!");
  }
  const dlg = $("#saved-dialog");
  if (!dlg) return;
  dlg.showModal();
  clearTimeout(showSavedPopup._t);
  showSavedPopup._t = setTimeout(() => { if (dlg.open) dlg.close(); }, 2400);
}

function drawCover(ctx, img, x, y, w, h) {
  const iw = img.naturalWidth, ih = img.naturalHeight;
  const scale = Math.max(w / iw, h / ih);
  const sw = w / scale, sh = h / scale;
  ctx.drawImage(img, (iw - sw) / 2, (ih - sh) / 2, sw, sh, x, y, w, h);
}

const FONT_DEFAULT = '-apple-system, Arial, sans-serif';

// Barra de rodape (rotulo) centrada na base de uma regiao [x, y-h .. y], largura w.
function drawFooterBar(ctx, text, x, y, w, h, family) {
  ctx.save();
  ctx.fillStyle = "rgba(0,0,0,0.5)";
  ctx.fillRect(x, y - h, w, h);
  ctx.fillStyle = "#ffffff";
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.font = `600 ${Math.round(h * 0.44)}px ${family || FONT_DEFAULT}`;
  ctx.fillText(text, x + w / 2, y - h / 2, w - 20);
  ctx.restore();
}

// Chip de rotulo (usado nos videos): ancorado a esquerda ou direita.
function drawChip(ctx, text, x, y, align, family, fontPx) {
  ctx.save();
  const fs = fontPx || 20;
  ctx.font = `600 ${fs}px ${family || FONT_DEFAULT}`;
  const padX = Math.round(fs * 0.5), h = Math.round(fs * 1.5);
  const tw = Math.min(ctx.measureText(text).width, 320);
  const w = tw + padX * 2;
  const bx = align === "right" ? x - w : (align === "center" ? x - w / 2 : x);
  ctx.fillStyle = "rgba(0,0,0,0.55)";
  ctx.fillRect(bx, y - h, w, h);
  ctx.fillStyle = "#ffffff";
  ctx.textAlign = "left";
  ctx.textBaseline = "middle";
  ctx.fillText(text, bx + padX, y - h / 2, tw);
  ctx.restore();
}

// Monta a imagem da comparacao (Base | Acompanhamento). Sem títulos/informações:
// só as 2 fotos e os rótulos de rodapé como chips (largura do texto, como no vídeo).
async function generateComparisonImage(s) {
  const baseImg = await loadImageEl(baseSrc(s));
  const followImg = await loadImageEl(followSrc(s));
  const prof = Profile.config();
  const logoImg = (prof.logoOn && prof.logo) ? await loadImageEl(prof.logo).catch(() => null) : null;
  const aspect = (baseImg.naturalWidth / baseImg.naturalHeight) || 0.75;
  const cellW = 760;
  const cellH = Math.round(cellW / aspect);
  const gap = 14, pad = 16;
  const W = pad * 2 + cellW * 2 + gap;
  const H = pad * 2 + cellH;   // sem cabeçalho de títulos

  const c = document.createElement("canvas");
  c.width = W; c.height = H;
  const ctx = c.getContext("2d");
  ctx.fillStyle = "#ffffff";
  ctx.fillRect(0, 0, W, H);

  const y = pad;
  drawCover(ctx, baseImg, pad, y, cellW, cellH);
  drawCover(ctx, followImg, pad + cellW + gap, y, cellW, cellH);

  // Marca d'agua (nome/logo) em cada foto, se ligada. Desenhada ANTES do rodape
  // para a logo ficar atras do rotulo (rodape sempre legivel por cima).
  Profile.drawWatermark(ctx, pad, y, cellW, cellH, prof, logoImg);
  Profile.drawWatermark(ctx, pad + cellW + gap, y, cellW, cellH, prof, logoImg);
  // Rótulo (rodapé) como chip (largura do texto), centrado na base de cada foto.
  if (s.showLabels) {
    const fs = Math.max(16, Math.round(cellH * 0.045 * prof.footerScale));
    if (s.baseLabel) drawChip(ctx, s.baseLabel, pad + cellW / 2, y + cellH - 12, "center", prof.footerFamily, fs);
    if (s.followLabel) drawChip(ctx, s.followLabel, pad + cellW + gap + cellW / 2, y + cellH - 12, "center", prof.footerFamily, fs);
  }

  return c.toDataURL("image/jpeg", 0.92);
}

// Escolhe o melhor formato de video suportado. No iOS Safari sai .mp4
// (aceito pela galeria Fotos); no Android/desktop normalmente .webm.
function pickVideoMime() {
  if (!window.MediaRecorder) return "";
  const opts = [
    "video/mp4;codecs=avc1",
    "video/mp4",
    "video/webm;codecs=vp9",
    "video/webm;codecs=vp8",
    "video/webm",
  ];
  for (const m of opts) {
    try { if (MediaRecorder.isTypeSupported(m)) return m; } catch (e) {}
  }
  return "";
}

// Gera um video (2s) da transicao da foto base para a de acompanhamento.
//   kind "curtain"  -> cortina varrendo da esquerda para a direita.
//   kind "overlay"  -> fotos sobrepostas; o acompanhamento aparece por cima
//                      com a transparencia indo de 100% a 0% (surge sobre a base).
// Usa as mesmas fontes exibidas na tela (baseSrc/followSrc, ja com ajustes).
async function generateVideo(s, kind) {
  const mime = pickVideoMime();
  if (!mime) throw new Error("Gravação de vídeo não suportada neste navegador.");

  const baseImg = await loadImageEl(baseSrc(s));
  const followImg = await loadImageEl(followSrc(s));
  const prof = Profile.config();
  const logoImg = (prof.logoOn && prof.logo) ? await loadImageEl(prof.logo).catch(() => null) : null;

  // Resolucao com base no aspecto da foto base (dimensoes pares p/ o codec).
  const aspect = (baseImg.naturalWidth / baseImg.naturalHeight) || 0.75;
  let W = 720, H = Math.round(W / aspect);
  W -= W % 2; H -= H % 2;

  const c = document.createElement("canvas");
  c.width = W; c.height = H;
  const ctx = c.getContext("2d");

  // ratio: 0 = so a base; 1 = so o acompanhamento. t = ms decorridos (p/ o rodape).
  const drawFrame = (ratio, t) => {
    ctx.globalAlpha = 1;
    ctx.fillStyle = "#000";
    ctx.fillRect(0, 0, W, H);
    drawCover(ctx, baseImg, 0, 0, W, H);
    if (ratio > 0) {
      if (kind === "overlay") {
        // Acompanhamento surge sobre a base (transparencia 100% -> 0%).
        ctx.globalAlpha = ratio;
        drawCover(ctx, followImg, 0, 0, W, H);
        ctx.globalAlpha = 1;
      } else {
        // Cortina: recorta a faixa esquerda e desenha o acompanhamento.
        const clipW = Math.round(ratio * W);
        ctx.save();
        ctx.beginPath();
        ctx.rect(0, 0, clipW, H);
        ctx.clip();
        drawCover(ctx, followImg, 0, 0, W, H);
        ctx.restore();
        if (ratio < 1) {
          ctx.fillStyle = "rgba(255,255,255,0.9)";
          ctx.fillRect(clipW - 1, 0, 3, H);
        }
      }
    }
    // Marca d'agua (nome/logo) desenhada em TODO frame (inclusive ratio 0), para
    // a logo/nome aparecerem desde o inicio. Antes do rotulo p/ a logo ficar atras.
    Profile.drawWatermark(ctx, 0, 0, W, H, prof, logoImg);
    // Rodape: base no 1o e 4o segundos; acompanhamento no 2o e 3o (vai e volta).
    if (s.showLabels) {
      const fs = Math.max(14, Math.round(H * 0.028 * prof.footerScale));
      const sec = Math.min(3, Math.floor((t || 0) / 1000));
      const showBase = (sec === 0 || sec === 3);
      const label = showBase ? s.baseLabel : s.followLabel;
      if (label) drawChip(ctx, label, W / 2, H - 12, "center", prof.footerFamily, fs);
    }
  };

  drawFrame(0, 0);
  const stream = c.captureStream(30);
  const rec = new MediaRecorder(stream, { mimeType: mime, videoBitsPerSecond: 4_000_000 });
  const chunks = [];
  rec.ondataavailable = (e) => { if (e.data && e.data.size) chunks.push(e.data); };

  // 4s no total: 2s de ida (base -> acompanhamento) e 2s de volta (os mesmos 2s
  // iniciais em sentido reverso, voltando ao acompanhamento -> base).
  const HOLD = 300, SWEEP = 1400, HALF = 2000, TOTAL = 4000;
  // Fator de transicao no instante t: primeira metade normal; segunda metade
  // espelha a primeira (reverso perfeito, formando um "vai e volta").
  const ratioAt = (t) => {
    const tf = t <= HALF ? t : (TOTAL - t);
    if (tf < HOLD) return 0;
    if (tf > HOLD + SWEEP) return 1;
    const u = (tf - HOLD) / SWEEP;
    return u < 0.5 ? 2 * u * u : 1 - Math.pow(-2 * u + 2, 2) / 2; // easeInOutQuad
  };
  const ext = mime.indexOf("mp4") !== -1 ? "mp4" : "webm";
  const fname = (kind === "overlay" ? "video-sobrepostos." : "video-cortina.") + ext;

  return new Promise((resolve, reject) => {
    rec.onstop = () => {
      try {
        const blob = new Blob(chunks, { type: rec.mimeType || mime });
        resolve(new File([blob], fname, { type: blob.type }));
      } catch (e) { reject(e); }
    };
    rec.onerror = (e) => reject(e.error || new Error("Falha na gravação."));
    rec.start();
    const t0 = performance.now();
    const tick = () => {
      const t = performance.now() - t0;
      drawFrame(ratioAt(Math.min(t, TOTAL)), Math.min(t, TOTAL));
      if (t >= TOTAL) {
        if (rec.state !== "inactive") rec.stop();
      } else {
        requestAnimationFrame(tick);
      }
    };
    requestAnimationFrame(tick);
  });
}

const Share = {
  files: {},

  // Alterna entre os niveis do menu: "root" (Foto/Video), "foto" e "video".
  // A seta Voltar (topo) aparece só nos submenus; o X fecha em qualquer nível.
  nav(view) {
    $("#share-cats").hidden = view !== "root";
    $("#share-sub-foto").hidden = view !== "foto";
    $("#share-sub-video").hidden = view !== "video";
    $("#share-back-arrow").hidden = view === "root";
  },

  async open(session) {
    this.session = session;
    this.files = {};
    const dlg = $("#share-dialog");
    const status = $("#share-status");
    const hasFollow = !!session.followImage;
    const canVideo = hasFollow && !!pickVideoMime();

    // Estado inicial: mostra as categorias; esconde as opcoes condicionais.
    this.nav("root");
    $("#share-cat-video").hidden = !canVideo;
    const curtain = $("#share-opt-curtain");
    const overlay = $("#share-opt-overlay");
    [curtain, overlay].forEach((b) => { b.disabled = true; });
    curtain.textContent = "🎬 Cortina — gerando…";
    overlay.textContent = "🎬 Sobrepostos — gerando…";

    status.textContent = "Preparando…";
    dlg.showModal();
    // Prepara os arquivos ANTES de liberar as opcoes, para o compartilhamento
    // acontecer imediatamente no clique (exigencia do iOS).
    const prof = Profile.config();
    const logoImg = (prof.logoOn && prof.logo) ? await loadImageEl(prof.logo).catch(() => null) : null;
    const wmOn = (prof.logoOn && logoImg) || (prof.nameOn && prof.name);
    const prep = async (src, footer) => {
      const wantFooter = session.showLabels && footer;
      if (!wantFooter && !wmOn) return src;
      const img = await loadImageEl(src);
      const W = img.naturalWidth, H = img.naturalHeight;
      const c = document.createElement("canvas");
      c.width = W; c.height = H;
      const ctx = c.getContext("2d");
      ctx.drawImage(img, 0, 0);
      // Marca d'agua antes do rodape: a logo fica atras do rotulo.
      Profile.drawWatermark(ctx, 0, 0, W, H, prof, logoImg);
      if (wantFooter) drawFooterBar(ctx, footer, 0, H, W, Math.max(28, Math.round(H * 0.07 * prof.footerScale)), prof.footerFamily);
      return c.toDataURL("image/jpeg", 0.92);
    };
    try {
      this.files.base = await dataUrlToFile(await prep(baseSrc(session), session.baseLabel), "foto-base.jpg");
      if (hasFollow) {
        this.files.follow = await dataUrlToFile(await prep(followSrc(session), session.followLabel), "acompanhamento.jpg");
        const cmp = await generateComparisonImage(session);
        this.files.compare = await dataUrlToFile(cmp, "comparacao.jpg");
      }
    } catch (e) {
      status.textContent = "Não foi possível preparar as imagens.";
      return;
    }
    status.textContent = "";

    // Cada video leva ~2s reais para gravar. Gera em segundo plano (em paralelo)
    // e so libera cada botao quando o arquivo ja estiver pronto — mantem o clique
    // sincrono exigido pelo iOS. Nao bloqueia o compartilhamento das fotos.
    if (canVideo) {
      const jobs = [
        { kind: "curtain", key: "video-curtain", btn: curtain, label: "🎬 Cortina" },
        { kind: "overlay", key: "video-overlay", btn: overlay, label: "🎬 Sobrepostos" },
      ];
      jobs.forEach((j) => {
        generateVideo(session, j.kind)
          .then((file) => {
            if (this.session !== session) return; // dialogo reaberto/fechado
            this.files[j.key] = file;
            j.btn.disabled = false;
            j.btn.textContent = j.label + " (4s)";
          })
          .catch(() => {
            if (this.session !== session) return;
            j.btn.textContent = j.label + " — indisponível";
          });
      });
    }
  },

  handle(what) {
    $("#share-dialog").close();
    if (what === "separate") {
      // Salva as 2 fotos (base e acompanhamento) isoladamente.
      const files = [this.files.base, this.files.follow].filter(Boolean);
      if (files.length) shareFiles(files).then((ok) => { if (ok) showSavedPopup("separate"); });
    } else {
      const file = this.files[what];
      if (file) shareFile(file).then((ok) => { if (ok) showSavedPopup(what); });
    }
    // Gerar a comparacao ja confirmou o credito; aqui e so garantia.
    if (this.session && this.session.creditState === "reserved") {
      this.session.creditState = "confirmed";
      DB.put(this.session);
    }
  },
};

window.addEventListener("DOMContentLoaded", () => {
  $("#share-dialog").querySelectorAll("[data-what]").forEach((b) =>
    b.addEventListener("click", () => Share.handle(b.dataset.what)));
  $("#share-cat-foto").addEventListener("click", () => Share.nav("foto"));
  $("#share-cat-video").addEventListener("click", () => Share.nav("video"));
  $("#share-back-arrow").addEventListener("click", () => Share.nav("root"));
  $("#share-x").addEventListener("click", () => $("#share-dialog").close());
  $("#saved-ok").addEventListener("click", () => $("#saved-dialog").close());
});
