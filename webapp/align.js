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
  z: 1, tx: 0, ty: 0, rot: 0,
  baseW: 1, baseH: 1,

  async open(session, followUrl) {
    this.session = session;
    this.followUrl = followUrl;
    this.z = 1; this.tx = 0; this.ty = 0; this.rot = 0;
    $("#al-zoom").value = 1;
    $("#al-rotate").value = 0;
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
      `translate(${this.tx}px, ${this.ty}px) scale(${this.z}) rotate(${this.rot}deg)`;
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

    const c = document.createElement("canvas");
    c.width = OUTW; c.height = OUTH;
    const ctx = c.getContext("2d");
    ctx.fillStyle = "#000";
    ctx.fillRect(0, 0, OUTW, OUTH);
    // Aplica a rotação em torno do centro da imagem (igual ao preview CSS).
    const cxp = OUTW / 2 + this.tx * f;
    const cyp = OUTH / 2 + this.ty * f;
    ctx.save();
    ctx.translate(cxp, cyp);
    ctx.rotate(this.rot * Math.PI / 180);
    ctx.drawImage(followImg, -dw / 2, -dh / 2, dw, dh);
    ctx.restore();
    const aligned = c.toDataURL("image/jpeg", 0.9);

    const res = await openDistanceDialog(this.session.baseDistance, this.session.followLabel || autoDateLabel());
    if (res == null) { await openDetail(this.session.id); return; }

    const s = this.session;
    s.followImage = aligned;
    s.followDistance = res.distance;
    s.followLabel = res.label;
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
  const setZoom = (z) => {
    Aligner.z = Math.max(0.5, Math.min(4, z));
    $("#al-zoom").value = Aligner.z;
  };

  // No Safari (iPhone) a pinca e um GESTO NATIVO: eventos de toque nao a
  // capturam de forma confiavel. O caminho certo e usar os gesture events
  // (gesturestart/gesturechange com e.scale). No Android nao existem gesture
  // events, entao a pinca cai no calculo por 2 toques.
  const supportsGesture = typeof window.GestureEvent !== "undefined";
  const d2 = (t) => Math.hypot(t[0].clientX - t[1].clientX, t[0].clientY - t[1].clientY) || 1;
  const m2 = (t) => ({ x: (t[0].clientX + t[1].clientX) / 2, y: (t[0].clientY + t[1].clientY) / 2 });
  let tLast = null, pinchBase = null, gestureOn = false;

  // ----- GESTURE EVENTS (Safari/iOS): pinca -----
  let gZoom = 1, gLast = { x: 0, y: 0 };
  stage.addEventListener("gesturestart", (e) => {
    e.preventDefault();
    gestureOn = true; gZoom = Aligner.z;
    gLast = { x: e.clientX || 0, y: e.clientY || 0 };
  }, { passive: false });
  stage.addEventListener("gesturechange", (e) => {
    e.preventDefault();
    setZoom(gZoom * e.scale);
    if (e.clientX != null) {
      Aligner.tx += e.clientX - gLast.x;
      Aligner.ty += e.clientY - gLast.y;
      gLast = { x: e.clientX, y: e.clientY };
    }
    Aligner.apply();
  }, { passive: false });
  const gEnd = (e) => { if (e.preventDefault) e.preventDefault(); gestureOn = false; };
  stage.addEventListener("gestureend", gEnd, { passive: false });
  // Evita o zoom da PAGINA enquanto a tela de alinhamento esta ativa.
  document.addEventListener("gesturestart", (e) => {
    if ($("#screen-align").classList.contains("active") && e.preventDefault) e.preventDefault();
  }, { passive: false });

  // ----- TOQUE: 1 dedo arrasta; 2 dedos pinca (so onde nao ha gesture) -----
  stage.addEventListener("touchstart", (e) => {
    if (e.touches.length === 1) {
      tLast = { x: e.touches[0].clientX, y: e.touches[0].clientY }; pinchBase = null;
    } else if (e.touches.length >= 2 && !supportsGesture) {
      pinchBase = { dist: d2(e.touches), zoom: Aligner.z, mid: m2(e.touches) }; tLast = null;
    }
  }, { passive: false });

  stage.addEventListener("touchmove", (e) => {
    if (gestureOn) return;                              // pinca cuidada pelo gesto
    if (supportsGesture && e.touches.length >= 2) return; // deixa o gesto agir
    e.preventDefault();
    const t = e.touches;
    if (t.length >= 2 && pinchBase) {
      const d = d2(t), m = m2(t);
      setZoom(pinchBase.zoom * (d / pinchBase.dist));
      Aligner.tx += m.x - pinchBase.mid.x;
      Aligner.ty += m.y - pinchBase.mid.y;
      pinchBase.mid = m;
      Aligner.apply();
    } else if (t.length === 1 && tLast) {
      Aligner.tx += t[0].clientX - tLast.x;
      Aligner.ty += t[0].clientY - tLast.y;
      tLast = { x: t[0].clientX, y: t[0].clientY };
      Aligner.apply();
    }
  }, { passive: false });

  const tEnd = (e) => {
    if (e.touches.length === 1) {
      tLast = { x: e.touches[0].clientX, y: e.touches[0].clientY }; pinchBase = null;
    } else if (e.touches.length >= 2 && !supportsGesture) {
      pinchBase = { dist: d2(e.touches), zoom: Aligner.z, mid: m2(e.touches) };
    } else if (e.touches.length === 0) {
      tLast = null; pinchBase = null;
    }
  };
  stage.addEventListener("touchend", tEnd);
  stage.addEventListener("touchcancel", tEnd);

  // --- MOUSE (desktop): arrastar p/ posicionar (ignora toque, ja tratado) ---
  let mouseDrag = false, mLast = { x: 0, y: 0 };
  stage.addEventListener("pointerdown", (e) => {
    if (e.pointerType === "touch") return;
    mouseDrag = true; mLast = { x: e.clientX, y: e.clientY };
    try { stage.setPointerCapture(e.pointerId); } catch (_) {}
  });
  stage.addEventListener("pointermove", (e) => {
    if (e.pointerType === "touch" || !mouseDrag) return;
    Aligner.tx += e.clientX - mLast.x;
    Aligner.ty += e.clientY - mLast.y;
    mLast = { x: e.clientX, y: e.clientY };
    Aligner.apply();
  });
  const mUp = (e) => { if (e.pointerType !== "touch") mouseDrag = false; };
  stage.addEventListener("pointerup", mUp);
  stage.addEventListener("pointercancel", mUp);

  $("#al-zoom").addEventListener("input", (e) => {
    Aligner.z = parseFloat(e.target.value);
    Aligner.apply();
  });
  $("#al-rotate").addEventListener("input", (e) => {
    Aligner.rot = parseFloat(e.target.value);
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
