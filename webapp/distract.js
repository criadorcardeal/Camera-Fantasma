"use strict";

/* =========================================================================
   ComparaCam - v8.1 - "Remover distrações".

   O médico pinta (pincel largo) sobre partes da foto que quer TIRAR DE FOCO
   (marcas de caneta, veias novas, objetos, mãos, régua…). Essas áreas:
     • ficam DESFOCADAS na imagem exibida (borradas + leve véu, dessaturadas);
     • são DESCARTADAS ao gerar o contorno neon (sketch.js, opts.excludeMask);
     • são IGNORADAS pelo alinhamento automático (align.js) — reduz o erro.

   A máscara é guardada em s.baseMask / s.followMask (PNG, branco opaco = área a
   tirar de foco), NORMALIZADA sobre a imagem exibida (baseSrc/followSrc), que é
   a mesma geometria da foto adquirida (baseImage / followImage aligned). A
   imagem desfocada é assada uma vez em s.baseDefocus / s.followDefocus.
   ========================================================================= */

// Assa uma versão DESFOCADA de `srcUrl`, borrando (e velando de leve) só onde a
// `maskUrl` está pintada. Devolve um JPEG (dataURL). A máscara é esticada à
// resolução da foto (as duas compartilham a mesma proporção).
async function applyDefocus(srcUrl, maskUrl) {
  const img = await loadImageEl(srcUrl);
  const W = img.naturalWidth || img.width;
  const H = img.naturalHeight || img.height;

  const out = document.createElement("canvas");
  out.width = W; out.height = H;
  const octx = out.getContext("2d");
  octx.drawImage(img, 0, 0, W, H);

  // Camada borrada: reduz num canvas pequeno e reamplia (borrão forte e barato),
  // ainda com um blur/saturação/brilho de CSS por cima e um véu claro translúcido
  // — o conjunto "apaga o foco" sem esconder totalmente o que está por baixo.
  const blur = document.createElement("canvas");
  blur.width = W; blur.height = H;
  const bctx = blur.getContext("2d", { willReadFrequently: true });
  const shrink = Math.max(1, Math.round(Math.max(W, H) / 42));
  const sw = Math.max(1, Math.round(W / shrink));
  const sh = Math.max(1, Math.round(H / shrink));
  const small = document.createElement("canvas");
  small.width = sw; small.height = sh;
  small.getContext("2d").drawImage(img, 0, 0, sw, sh);
  bctx.imageSmoothingEnabled = true;
  bctx.filter = "blur(2px) saturate(0.45) brightness(1.05)";
  bctx.drawImage(small, 0, 0, W, H);
  bctx.filter = "none";
  // Véu claro por cima do borrão (dá o aspecto "fora de foco / apagado").
  bctx.fillStyle = "rgba(255,255,255,0.32)";
  bctx.fillRect(0, 0, W, H);

  // Recorta o borrão pela máscara (com borda suavizada = transição macia).
  const mimg = await loadImageEl(maskUrl);
  const mc = document.createElement("canvas");
  mc.width = W; mc.height = H;
  const mctx = mc.getContext("2d");
  const feather = Math.max(1, Math.round(Math.max(W, H) / 90));
  mctx.filter = "blur(" + feather + "px)";
  mctx.drawImage(mimg, 0, 0, W, H);
  mctx.filter = "none";
  bctx.globalCompositeOperation = "destination-in";
  bctx.drawImage(mc, 0, 0, W, H);
  bctx.globalCompositeOperation = "source-over";

  octx.drawImage(blur, 0, 0, W, H);
  return out.toDataURL("image/jpeg", 0.9);
}

// Recalcula (ou limpa) a imagem desfocada de um lado a partir da máscara atual.
// Usa a foto SEM desfoque (view||image) como base — NÃO o baseSrc (que já
// devolveria o desfoque). Chamado ao confirmar distrações e após colorações.
async function rebakeDefocus(s, kind) {
  const K = kind === "base"
    ? { mask: "baseMask", view: "baseImageView", img: "baseImage", def: "baseDefocus" }
    : { mask: "followMask", view: "followImageView", img: "followImage", def: "followDefocus" };
  if (!s[K.mask]) { delete s[K.def]; return; }
  const srcRaw = s[K.view] || s[K.img];
  try { s[K.def] = await applyDefocus(srcRaw, s[K.mask]); }
  catch (_) { delete s[K.def]; }
}

// Descarta a máscara de distrações e o desfoque assado de um lado (ou "all").
function clearDistract(s, kind) {
  if (!s) return;
  if (kind === "base" || kind === "all") { delete s.baseMask; delete s.baseDefocus; }
  if (kind === "follow" || kind === "all") { delete s.followMask; delete s.followDefocus; }
}

window.applyDefocus = applyDefocus;
window.rebakeDefocus = rebakeDefocus;
window.clearDistract = clearDistract;

/* ---------------- Tela "Remover distrações" ---------------- */
const Distract = {
  session: null,
  kind: "base",
  mask: null,        // canvas offscreen (branco opaco = área a tirar de foco)
  brush: 48,         // raio do pincel em px de tela
  drawing: false,
  _last: null,

  // Abre a tela para o lado `kind` ("base"|"follow"). Mostra a foto exibida e a
  // máscara já existente (se houver), para o médico continuar/ajustar.
  async open(session, kind) {
    this.session = session;
    this.kind = kind;
    this._last = null;
    const srcUrl = kind === "base" ? baseSrcRaw(session) : followSrcRaw(session);
    let img;
    try { img = await loadImageEl(srcUrl); }
    catch (_) { alert("Não foi possível abrir esta foto."); return; }
    const iw = img.naturalWidth || img.width || 3;
    const ih = img.naturalHeight || img.height || 4;
    this._img = img;

    // Máscara offscreen na resolução da foto (teto de 1024 px no maior lado).
    const cap = Math.min(1, 1024 / Math.max(iw, ih));
    const MW = Math.max(1, Math.round(iw * cap));
    const MH = Math.max(1, Math.round(ih * cap));
    const mask = document.createElement("canvas");
    mask.width = MW; mask.height = MH;
    const mctx = mask.getContext("2d", { willReadFrequently: true });
    const existing = kind === "base" ? session.baseMask : session.followMask;
    this._openMaskUrl = existing || null;   // estado salvo, p/ o "Cancelar" reverter
    if (existing) {
      try { const em = await loadImageEl(existing); mctx.drawImage(em, 0, 0, MW, MH); } catch (_) {}
    }
    this.mask = mask;

    const brushInp = $("#ds-brush");
    if (brushInp) this.brush = parseInt(brushInp.value, 10) || 48;

    showScreen("screen-distract");
    requestAnimationFrame(() => { this._layout(); this._render(); });
  },

  // Dimensiona o palco na área FIXA (.photo-fixed), no aspecto da foto e com o
  // mesmo teto das demais telas (fitStageEl) — sem rolagem (v8.2).
  _layout() {
    const stage = $("#ds-stage");
    fitStageEl(stage, (this._img.naturalWidth || 3) / (this._img.naturalHeight || 4));
    const w = stage.clientWidth, h = stage.clientHeight;
    const photo = $("#ds-photo"), over = $("#ds-mask");
    for (const cv of [photo, over]) { cv.width = w; cv.height = h; }
    photo.getContext("2d").drawImage(this._img, 0, 0, w, h);
  },

  // Redesenha a sobreposição vermelha translúcida a partir da máscara.
  _render() {
    const over = $("#ds-mask");
    const ctx = over.getContext("2d");
    ctx.clearRect(0, 0, over.width, over.height);
    ctx.save();
    ctx.drawImage(this.mask, 0, 0, over.width, over.height);
    ctx.globalCompositeOperation = "source-in";
    ctx.fillStyle = "rgba(255,54,54,0.45)";
    ctx.fillRect(0, 0, over.width, over.height);
    ctx.restore();
  },

  // Converte um ponto de tela para coordenadas da máscara offscreen.
  _toMask(clientX, clientY) {
    const r = $("#ds-stage").getBoundingClientRect();
    return {
      x: (clientX - r.left) / (r.width || 1) * this.mask.width,
      y: (clientY - r.top) / (r.height || 1) * this.mask.height,
      s: this.mask.width / (r.width || 1),   // escala tela→máscara
    };
  },

  _paint(clientX, clientY) {
    const p = this._toMask(clientX, clientY);
    const rad = Math.max(1, this.brush * p.s);
    const mctx = this.mask.getContext("2d");
    mctx.fillStyle = "#fff";
    mctx.strokeStyle = "#fff";
    mctx.lineJoin = mctx.lineCap = "round";
    mctx.lineWidth = rad * 2;
    if (this._last) {
      mctx.beginPath();
      mctx.moveTo(this._last.x, this._last.y);
      mctx.lineTo(p.x, p.y);
      mctx.stroke();
    }
    mctx.beginPath();
    mctx.arc(p.x, p.y, rad, 0, Math.PI * 2);
    mctx.fill();
    this._last = { x: p.x, y: p.y };
    this._render();
  },

  // "Zerar ajustes": apaga TODA a marcação (só persiste ao Confirmar).
  clear() {
    const mctx = this.mask.getContext("2d");
    mctx.clearRect(0, 0, this.mask.width, this.mask.height);
    this._last = null;
    this._render();
  },

  // "Cancelar" (v8.2): descarta as alterações NÃO salvas e CONTINUA na tela,
  // voltando à marcação como estava ao abrir (não volta para a Montagem).
  async revert() {
    const mctx = this.mask.getContext("2d");
    mctx.clearRect(0, 0, this.mask.width, this.mask.height);
    if (this._openMaskUrl) {
      try { const em = await loadImageEl(this._openMaskUrl); mctx.drawImage(em, 0, 0, this.mask.width, this.mask.height); } catch (_) {}
    }
    this._last = null;
    this._render();
  },

  // Sai da tela (seta ‹ de voltar) sem salvar.
  async cancel() {
    await openDetail(this.session.id);
  },

  // A máscara tem alguma marcação? (alfa opaco em qualquer pixel)
  _hasStrokes() {
    const d = this.mask.getContext("2d").getImageData(0, 0, this.mask.width, this.mask.height).data;
    for (let i = 3; i < d.length; i += 4) if (d[i] > 40) return true;
    return false;
  },

  async confirm() {
    const s = this.session, kind = this.kind;
    const btn = $("#ds-confirm");
    const label = btn.textContent;
    btn.disabled = true; btn.textContent = "Aplicando…";
    try {
      const maskKey = kind === "base" ? "baseMask" : "followMask";
      if (this._hasStrokes()) {
        s[maskKey] = this.mask.toDataURL("image/png");
      } else {
        clearDistract(s, kind);           // sem marcação = remove distrações do lado
      }
      await rebakeDefocus(s, kind);        // (re)assa ou limpa o desfoque exibido
      if (typeof clearSketch === "function") clearSketch(s, kind);   // contorno regenera sem as áreas
      await DB.put(s);
    } finally {
      btn.disabled = false; btn.textContent = label;
    }
    await openDetail(s.id);
  },
};
window.Distract = Distract;

/* ---------------- Controles da tela (pincel + botões) ---------------- */
window.addEventListener("DOMContentLoaded", () => {
  const stage = $("#ds-stage");
  if (!stage) return;

  const down = (e) => {
    Distract.drawing = true;
    Distract._last = null;
    try { stage.setPointerCapture(e.pointerId); } catch (_) {}
    Distract._paint(e.clientX, e.clientY);
    e.preventDefault();
  };
  const move = (e) => { if (Distract.drawing) { Distract._paint(e.clientX, e.clientY); e.preventDefault(); } };
  const up = () => { Distract.drawing = false; Distract._last = null; };
  stage.addEventListener("pointerdown", down, { passive: false });
  stage.addEventListener("pointermove", move, { passive: false });
  stage.addEventListener("pointerup", up);
  stage.addEventListener("pointercancel", up);

  const brush = $("#ds-brush");
  if (brush) brush.addEventListener("input", () => { Distract.brush = parseInt(brush.value, 10) || 48; });

  $("#ds-cancel").addEventListener("click", () => Distract.cancel());          // ‹ voltar (sai da tela)
  const c2 = $("#ds-cancel2"); if (c2) c2.addEventListener("click", () => Distract.revert());  // Cancelar: reverte e fica (v8.2)
  $("#ds-clear").addEventListener("click", () => Distract.clear());
  $("#ds-confirm").addEventListener("click", () => Distract.confirm());
});
