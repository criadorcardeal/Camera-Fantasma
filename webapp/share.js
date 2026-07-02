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

// Compartilha imediatamente (sem await antes) para preservar o gesto do iOS.
function shareFile(file) {
  if (navigator.canShare && navigator.canShare({ files: [file] })) {
    navigator.share({ files: [file], title: file.name }).catch(() => {});
  } else {
    const url = URL.createObjectURL(file);
    const a = document.createElement("a");
    a.href = url;
    a.download = file.name;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }
}

function drawCover(ctx, img, x, y, w, h) {
  const iw = img.naturalWidth, ih = img.naturalHeight;
  const scale = Math.max(w / iw, h / ih);
  const sw = w / scale, sh = h / scale;
  ctx.drawImage(img, (iw - sw) / 2, (ih - sh) / 2, sw, sh, x, y, w, h);
}

// Monta a imagem da comparacao (Base | Acompanhamento) com rotulos e datas.
async function generateComparisonImage(s) {
  const baseImg = await loadImageEl(baseSrc(s));
  const followImg = await loadImageEl(followSrc(s));
  const aspect = (baseImg.naturalWidth / baseImg.naturalHeight) || 0.75;
  const cellW = 760;
  const cellH = Math.round(cellW / aspect);
  const gap = 14, headerH = 70, pad = 16;
  const W = pad * 2 + cellW * 2 + gap;
  const H = pad + headerH + cellH + pad;

  const c = document.createElement("canvas");
  c.width = W; c.height = H;
  const ctx = c.getContext("2d");
  ctx.fillStyle = "#ffffff";
  ctx.fillRect(0, 0, W, H);

  const cx1 = pad + cellW / 2;
  const cx2 = pad + cellW + gap + cellW / 2;
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillStyle = "#1b5e8c";
  ctx.font = "bold 30px -apple-system, Arial, sans-serif";
  ctx.fillText("Base", cx1, pad + 24);
  ctx.fillText("Acompanhamento", cx2, pad + 24);
  ctx.fillStyle = "#5d6b73";
  ctx.font = "18px -apple-system, Arial, sans-serif";
  ctx.fillText(`${fmtDate(s.createdAt)}  •  ${Math.round(s.baseDistance)} cm`, cx1, pad + 50);
  ctx.fillText(`${fmtDate(s.followAt)}  •  ${Math.round(s.followDistance)} cm`, cx2, pad + 50);

  const y = pad + headerH;
  drawCover(ctx, baseImg, pad, y, cellW, cellH);
  drawCover(ctx, followImg, pad + cellW + gap, y, cellW, cellH);

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

  // Resolucao com base no aspecto da foto base (dimensoes pares p/ o codec).
  const aspect = (baseImg.naturalWidth / baseImg.naturalHeight) || 0.75;
  let W = 720, H = Math.round(W / aspect);
  W -= W % 2; H -= H % 2;

  const c = document.createElement("canvas");
  c.width = W; c.height = H;
  const ctx = c.getContext("2d");

  // ratio: 0 = so a base; 1 = so o acompanhamento.
  const drawFrame = (ratio) => {
    ctx.globalAlpha = 1;
    ctx.fillStyle = "#000";
    ctx.fillRect(0, 0, W, H);
    drawCover(ctx, baseImg, 0, 0, W, H);
    if (ratio <= 0) return;
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
  };

  drawFrame(0);
  const stream = c.captureStream(30);
  const rec = new MediaRecorder(stream, { mimeType: mime, videoBitsPerSecond: 4_000_000 });
  const chunks = [];
  rec.ondataavailable = (e) => { if (e.data && e.data.size) chunks.push(e.data); };

  const HOLD = 300, SWEEP = 1400, TOTAL = 2000; // 0,3s base + 1,4s transicao + 0,3s acompanhamento
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
      let r;
      if (t < HOLD) r = 0;
      else if (t > HOLD + SWEEP) r = 1;
      else {
        const u = (t - HOLD) / SWEEP;
        r = u < 0.5 ? 2 * u * u : 1 - Math.pow(-2 * u + 2, 2) / 2; // easeInOutQuad
      }
      drawFrame(r);
      if (t >= TOTAL) {
        drawFrame(1);
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
  nav(view) {
    $("#share-cats").hidden = view !== "root";
    $("#share-sub-foto").hidden = view !== "foto";
    $("#share-sub-video").hidden = view !== "video";
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
    $("#share-opt-follow").hidden = !hasFollow;
    $("#share-opt-compare").hidden = !hasFollow;
    const curtain = $("#share-opt-curtain");
    const overlay = $("#share-opt-overlay");
    [curtain, overlay].forEach((b) => { b.disabled = true; });
    curtain.textContent = "🎬 Cortina — gerando…";
    overlay.textContent = "🎬 Sobrepostos — gerando…";

    status.textContent = "Preparando…";
    dlg.showModal();
    // Prepara os arquivos ANTES de liberar as opcoes, para o compartilhamento
    // acontecer imediatamente no clique (exigencia do iOS).
    try {
      this.files.base = await dataUrlToFile(baseSrc(session), "foto-base.jpg");
      if (hasFollow) {
        this.files.follow = await dataUrlToFile(followSrc(session), "acompanhamento.jpg");
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
            j.btn.textContent = j.label + " (2s)";
          })
          .catch(() => {
            if (this.session !== session) return;
            j.btn.textContent = j.label + " — indisponível";
          });
      });
    }
  },

  handle(what) {
    const file = this.files[what];
    $("#share-dialog").close();
    if (file) shareFile(file);
    // Salvar/compartilhar COMPLETA a comparacao -> confirma o credito reservado.
    if (this.session && this.session.creditState === "reserved") {
      this.session.creditState = "confirmed";
      DB.put(this.session);
    }
  },
};

window.addEventListener("DOMContentLoaded", () => {
  $("#share-dialog").querySelectorAll("[data-what]").forEach((b) =>
    b.addEventListener("click", () => Share.handle(b.dataset.what)));
  $("#share-dialog").querySelectorAll("[data-back]").forEach((b) =>
    b.addEventListener("click", () => Share.nav("root")));
  $("#share-cat-foto").addEventListener("click", () => Share.nav("foto"));
  $("#share-cat-video").addEventListener("click", () => Share.nav("video"));
  $("#share-close").addEventListener("click", () => $("#share-dialog").close());
});
