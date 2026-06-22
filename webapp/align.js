"use strict";

/* =========================================================================
   Fotos Fantasma - v2.0 - Alinhar foto de acompanhamento importada.

   Mostra a foto importada com a foto BASE como fantasma por cima. O usuario
   arrasta para posicionar e usa o zoom para deixar as duas simetricas. Ao
   confirmar, gera a foto de acompanhamento ja enquadrada igual a base.
   (loadImageEl, $, showScreen, DB, openDetail, openDistanceDialog sao globais.)
   ========================================================================= */
const Aligner = {
  session: null,
  followUrl: null,
  z: 1, tx: 0, ty: 0,
  baseW: 1, baseH: 1,

  async open(session, followUrl) {
    this.session = session;
    this.followUrl = followUrl;
    this.z = 1; this.tx = 0; this.ty = 0;
    $("#al-zoom").value = 1;
    $("#al-opacity").value = 0.5;
    try {
      const baseImg = await loadImageEl(session.baseImage);
      this.baseW = baseImg.naturalWidth || 3;
      this.baseH = baseImg.naturalHeight || 4;
    } catch (_) { this.baseW = 3; this.baseH = 4; }
    $("#al-ghost").src = session.baseImage;
    $("#al-ghost").style.opacity = 0.5;
    $("#al-follow").src = followUrl;
    showScreen("screen-align");
    requestAnimationFrame(() => this.layoutStage());
    this.apply();
  },

  layoutStage() {
    const stage = $("#al-stage");
    const maxW = stage.parentElement.clientWidth;
    const maxH = window.innerHeight * 0.6;
    const aspect = this.baseW / this.baseH;
    let w = maxW, h = w / aspect;
    if (h > maxH) { h = maxH; w = h * aspect; }
    stage.style.width = Math.round(w) + "px";
    stage.style.height = Math.round(h) + "px";
  },

  apply() {
    $("#al-follow").style.transform =
      `translate(${this.tx}px, ${this.ty}px) scale(${this.z})`;
  },

  async confirm() {
    const stage = $("#al-stage");
    const rect = stage.getBoundingClientRect();
    const Wc = rect.width, Hc = rect.height;
    const OUTW = Math.min(this.baseW, 1400);
    const OUTH = Math.round(OUTW * this.baseH / this.baseW);
    const f = OUTW / Wc;

    const followImg = await loadImageEl(this.followUrl);
    const Wi = followImg.naturalWidth, Hi = followImg.naturalHeight;
    const coverScale = Math.max(Wc / Wi, Hc / Hi);
    const dw = Wi * coverScale * this.z * f;
    const dh = Hi * coverScale * this.z * f;
    const dx = OUTW / 2 + this.tx * f - dw / 2;
    const dy = OUTH / 2 + this.ty * f - dh / 2;

    const c = document.createElement("canvas");
    c.width = OUTW; c.height = OUTH;
    const ctx = c.getContext("2d");
    ctx.fillStyle = "#000";
    ctx.fillRect(0, 0, OUTW, OUTH);
    ctx.drawImage(followImg, dx, dy, dw, dh);
    const aligned = c.toDataURL("image/jpeg", 0.9);

    const distance = await openDistanceDialog(this.session.baseDistance);
    if (distance == null) { await openDetail(this.session.id); return; }

    const s = this.session;
    s.followImage = aligned;
    s.followDistance = distance;
    s.followAt = new Date().toISOString();
    // Nova imagem: zera ajustes/versao anteriores do acompanhamento.
    s.followImageView = null;
    s.followAdj = null;
    s.followTarget = null;
    await DB.put(s);
    await openDetail(s.id);
  },

  async cancel() {
    await openDetail(this.session.id);
  },
};

/* ---------- Controles do alinhamento ---------- */
window.addEventListener("DOMContentLoaded", () => {
  const stage = $("#al-stage");
  // Suporta 1 dedo (arrastar p/ posicionar) e 2 dedos (pinca p/ zoom + mover).
  const pointers = new Map();
  let last = { x: 0, y: 0 };
  let pinch = { dist: 1, zoom: 1, midX: 0, midY: 0 };
  const pts = () => [...pointers.values()];
  const distOf = (a, b) => Math.hypot(a.x - b.x, a.y - b.y) || 1;

  stage.addEventListener("pointerdown", (e) => {
    try { stage.setPointerCapture(e.pointerId); } catch (_) {}
    pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (pointers.size === 1) {
      last = { x: e.clientX, y: e.clientY };
    } else if (pointers.size === 2) {
      const [a, b] = pts();
      pinch = { dist: distOf(a, b), zoom: Aligner.z, midX: (a.x + b.x) / 2, midY: (a.y + b.y) / 2 };
    }
  });

  stage.addEventListener("pointermove", (e) => {
    if (!pointers.has(e.pointerId)) return;
    pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (pointers.size >= 2) {
      const [a, b] = pts();
      const d = distOf(a, b);
      const midX = (a.x + b.x) / 2, midY = (a.y + b.y) / 2;
      Aligner.z = Math.max(0.5, Math.min(4, pinch.zoom * (d / pinch.dist)));
      Aligner.tx += midX - pinch.midX;
      Aligner.ty += midY - pinch.midY;
      pinch.midX = midX; pinch.midY = midY;
      $("#al-zoom").value = Aligner.z;
      Aligner.apply();
    } else {
      Aligner.tx += e.clientX - last.x;
      Aligner.ty += e.clientY - last.y;
      last = { x: e.clientX, y: e.clientY };
      Aligner.apply();
    }
  });

  const onUp = (e) => {
    pointers.delete(e.pointerId);
    if (pointers.size === 1) {
      const [a] = pts();
      last = { x: a.x, y: a.y };   // continua arrastando com o dedo restante
    }
  };
  stage.addEventListener("pointerup", onUp);
  stage.addEventListener("pointercancel", onUp);

  $("#al-zoom").addEventListener("input", (e) => {
    Aligner.z = parseFloat(e.target.value);
    Aligner.apply();
  });
  $("#al-opacity").addEventListener("input", (e) => {
    $("#al-ghost").style.opacity = e.target.value;
  });
  $("#al-cancel").addEventListener("click", () => Aligner.cancel());
  $("#al-confirm").addEventListener("click", () => Aligner.confirm());
  window.addEventListener("resize", () => {
    if ($("#screen-align").classList.contains("active")) Aligner.layoutStage();
  });
});
