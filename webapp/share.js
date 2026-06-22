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

const Share = {
  files: {},

  async open(session) {
    this.files = {};
    const dlg = $("#share-dialog");
    const status = $("#share-status");
    ["#share-opt-base", "#share-opt-follow", "#share-opt-compare"].forEach((s) => {
      $(s).hidden = true;
    });
    status.textContent = "Preparando…";
    dlg.showModal();
    // Prepara os arquivos ANTES de liberar as opcoes, para o compartilhamento
    // acontecer imediatamente no clique (exigencia do iOS).
    try {
      this.files.base = await dataUrlToFile(baseSrc(session), "foto-base.jpg");
      if (session.followImage) {
        this.files.follow = await dataUrlToFile(followSrc(session), "acompanhamento.jpg");
        const cmp = await generateComparisonImage(session);
        this.files.compare = await dataUrlToFile(cmp, "comparacao.jpg");
      }
    } catch (e) {
      status.textContent = "Não foi possível preparar as imagens.";
      return;
    }
    $("#share-opt-base").hidden = false;
    $("#share-opt-follow").hidden = !session.followImage;
    $("#share-opt-compare").hidden = !session.followImage;
    status.textContent = "";
  },

  handle(what) {
    const file = this.files[what];
    $("#share-dialog").close();
    if (file) shareFile(file);
  },
};

window.addEventListener("DOMContentLoaded", () => {
  $("#share-dialog").querySelectorAll("[data-what]").forEach((b) =>
    b.addEventListener("click", () => Share.handle(b.dataset.what)));
  $("#share-close").addEventListener("click", () => $("#share-dialog").close());
});
