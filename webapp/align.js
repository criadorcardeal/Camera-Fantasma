"use strict";

/* =========================================================================
   Fotos Fantasma - v2.0 - Alinhar foto de acompanhamento importada.

   Mostra a foto importada com a foto BASE como fantasma por cima. O usuario
   arrasta para posicionar e usa o zoom para deixar as duas simetricas. Ao
   confirmar, gera a foto de acompanhamento ja enquadrada igual a base.
   (loadImageEl, $, showScreen, DB, openDetail, openLabelDialog sao globais.)
   ========================================================================= */
/* =========================================================================
   Alinhamento automático (visão computacional em canvas, sem libs).
   Ideia: detecta a SILHUETA (parte do corpo) em cada foto por segmentação de
   primeiro plano (diferença do fundo das bordas + reforço de pele), pega a maior
   mancha, e calcula por MOMENTOS o centro, a orientação (eixo principal) e o
   tamanho de cada silhueta. Disso sai uma transformação de SEMELHANÇA (girar,
   escalar, transladar) que empilha o acompanhamento sobre a base; um refino por
   sobreposição de máscaras (IoU) resolve a ambiguidade de 180° e ajusta.
   ========================================================================= */

// Desenha a imagem COBRINDO (cover) um quadro W×H e devolve os pixels.
function alCoverRender(img, W, H) {
  const iw = img.naturalWidth || img.width, ih = img.naturalHeight || img.height;
  const scale = Math.max(W / iw, H / ih);
  const sw = W / scale, sh = H / scale;
  const c = document.createElement("canvas");
  c.width = W; c.height = H;
  const ctx = c.getContext("2d", { willReadFrequently: true });
  ctx.drawImage(img, (iw - sw) / 2, (ih - sh) / 2, sw, sh, 0, 0, W, H);
  return ctx.getImageData(0, 0, W, H);
}

// Detecção de PELE robusta (tons claros a castanho-escuro): combina uma regra
// RGB (estilo Kovac) com YCrCb. Como a pele é "quente" (R>G>B, com espalhamento),
// rejeita bem os fundos comuns nas fotos clínicas: cinza/azul do quarto, campo
// azul, calça preta, cano metálico. Funciona mesmo com a perna encostando na
// borda (não depende de estimar o fundo pelas bordas).
function alSkinScore(r, g, b) {
  const mx = Math.max(r, g, b), mn = Math.min(r, g, b);
  const cr = 128 + (0.5 * r - 0.418688 * g - 0.081312 * b);
  const cb = 128 + (-0.168736 * r - 0.331264 * g + 0.5 * b);
  const ycc = cr >= 135 && cr <= 182 && cb >= 80 && cb <= 135;
  const rgb = r > 55 && g > 25 && b > 10 && (mx - mn) > 12 && r > g && r >= b - 4 && (r - g) >= 7;
  return ycc && rgb;
}

// Limiar de Otsu sobre um histograma de 256 níveis.
function alOtsu(hist, total) {
  let sum = 0; for (let i = 0; i < 256; i++) sum += i * hist[i];
  let sumB = 0, wB = 0, best = 0, th = 0;
  for (let i = 0; i < 256; i++) {
    wB += hist[i]; if (!wB) continue;
    const wF = total - wB; if (!wF) break;
    sumB += i * hist[i];
    const mB = sumB / wB, mF = (sum - sumB) / wF;
    const between = wB * wF * (mB - mF) * (mB - mF);
    if (between > best) { best = between; th = i; }
  }
  return th;
}

// Maior componente conexa (4-viz) de uma máscara binária.
function alLargestComponent(mask, W, H) {
  const lbl = new Int32Array(W * H).fill(0);
  const out = new Uint8Array(W * H);
  const stack = new Int32Array(W * H);
  let bestArea = 0, bestId = 0, id = 0;
  for (let p = 0; p < W * H; p++) {
    if (!mask[p] || lbl[p]) continue;
    id++; let sp = 0, area = 0; stack[sp++] = p; lbl[p] = id;
    while (sp) {
      const q = stack[--sp]; area++;
      const x = q % W, y = (q / W) | 0;
      if (x > 0 && mask[q - 1] && !lbl[q - 1]) { lbl[q - 1] = id; stack[sp++] = q - 1; }
      if (x < W - 1 && mask[q + 1] && !lbl[q + 1]) { lbl[q + 1] = id; stack[sp++] = q + 1; }
      if (y > 0 && mask[q - W] && !lbl[q - W]) { lbl[q - W] = id; stack[sp++] = q - W; }
      if (y < H - 1 && mask[q + W] && !lbl[q + W]) { lbl[q + W] = id; stack[sp++] = q + W; }
    }
    if (area > bestArea) { bestArea = area; bestId = id; }
  }
  for (let p = 0; p < W * H; p++) out[p] = (lbl[p] === bestId) ? 1 : 0;
  return { mask: out, area: bestArea };
}

// Preenche buracos internos de uma máscara (veias, marcas de caneta, brilhos):
// tudo que é 0 mas NÃO alcança a borda da imagem vira 1.
function alFillHoles(mask, W, H) {
  const out = mask.slice();
  const outside = new Uint8Array(W * H);
  const stack = [];
  for (let x = 0; x < W; x++) {
    if (!mask[x]) stack.push(x);
    const b = (H - 1) * W + x; if (!mask[b]) stack.push(b);
  }
  for (let y = 0; y < H; y++) {
    const l = y * W; if (!mask[l]) stack.push(l);
    const r = y * W + W - 1; if (!mask[r]) stack.push(r);
  }
  while (stack.length) {
    const q = stack.pop(); if (outside[q]) continue; outside[q] = 1;
    const x = q % W, y = (q / W) | 0;
    if (x > 0 && !mask[q - 1] && !outside[q - 1]) stack.push(q - 1);
    if (x < W - 1 && !mask[q + 1] && !outside[q + 1]) stack.push(q + 1);
    if (y > 0 && !mask[q - W] && !outside[q - W]) stack.push(q - W);
    if (y < H - 1 && !mask[q + W] && !outside[q + W]) stack.push(q + W);
  }
  for (let p = 0; p < W * H; p++) if (!mask[p] && !outside[p]) out[p] = 1;
  return out;
}

// Máscara por diferença do fundo (fallback): estima o fundo pelas bordas e
// limiariza pela distância de cor (Otsu). Usada só quando a pele quase não é
// detectada (ex.: iluminação muito atípica).
function alBgDiffMask(imgd) {
  const W = imgd.width, H = imgd.height, d = imgd.data, N = W * H;
  const bw = Math.max(2, Math.round(Math.min(W, H) * 0.06));
  let br = 0, bg = 0, bb = 0, bn = 0;
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    if (x < bw || y < bw || x >= W - bw || y >= H - bw) {
      const i = (y * W + x) * 4; br += d[i]; bg += d[i + 1]; bb += d[i + 2]; bn++;
    }
  }
  br /= bn; bg /= bn; bb /= bn;
  const score = new Float32Array(N);
  let smin = 1e9, smax = -1e9;
  for (let p = 0, i = 0; p < N; p++, i += 4) {
    const dr = d[i] - br, dg = d[i + 1] - bg, db = d[i + 2] - bb;
    const s = Math.sqrt(dr * dr + dg * dg + db * db);
    score[p] = s; if (s < smin) smin = s; if (s > smax) smax = s;
  }
  const hist = new Int32Array(256);
  const norm = smax > smin ? 255 / (smax - smin) : 0;
  const q = new Uint8Array(N);
  for (let p = 0; p < N; p++) { const v = Math.round((score[p] - smin) * norm); q[p] = v; hist[v]++; }
  const th = alOtsu(hist, N);
  const mask = new Uint8Array(N);
  for (let p = 0; p < N; p++) mask[p] = q[p] > th ? 1 : 0;
  return mask;
}

// Máscara de primeiro plano (silhueta do membro): PRIMÁRIO = pele (robusto p/
// fundos variados e perna encostando na borda); FALLBACK = diferença do fundo.
// Depois pega a maior mancha conexa e preenche os buracos internos.
function alForegroundMask(imgd) {
  const W = imgd.width, H = imgd.height, d = imgd.data, N = W * H;
  const skin = new Uint8Array(N);
  let sc = 0;
  for (let p = 0, i = 0; p < N; p++, i += 4) {
    if (alSkinScore(d[i], d[i + 1], d[i + 2])) { skin[p] = 1; sc++; }
  }
  const comp = (sc > N * 0.02)
    ? alLargestComponent(skin, W, H)
    : alLargestComponent(alBgDiffMask(imgd), W, H);
  const mask = alFillHoles(comp.mask, W, H);
  let area = 0; for (let p = 0; p < N; p++) area += mask[p];
  return { mask, area };
}

// Momentos da máscara: centro, orientação (eixo principal) e raio RMS (tamanho).
function alMoments(mask, W, H) {
  let n = 0, sx = 0, sy = 0;
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    if (mask[y * W + x]) { n++; sx += x; sy += y; }
  }
  if (!n) return null;
  const cx = sx / n, cy = sy / n;
  let m20 = 0, m11 = 0, m02 = 0;
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    if (mask[y * W + x]) { const dx = x - cx, dy = y - cy; m20 += dx * dx; m11 += dx * dy; m02 += dy * dy; }
  }
  return { cx, cy, n, theta: 0.5 * Math.atan2(2 * m11, m20 - m02), S: Math.sqrt((m20 + m02) / n) };
}

// Translação (tx,ty) que leva o centro do acompanhamento ao centro da base,
// dado z e rotação (graus), com rotação/escala em torno do centro do quadro.
function alSolveT(B, F, z, rotDeg, cx, cy) {
  const r = rotDeg * Math.PI / 180, cos = Math.cos(r), sin = Math.sin(r);
  const dx = F.cx - cx, dy = F.cy - cy;
  return { tx: B.cx - cx - z * (cos * dx - sin * dy), ty: B.cy - cy - z * (sin * dx + cos * dy) };
}

// Sobreposição (IoU) da máscara do acompanhamento transformada com a da base.
function alMaskIoU(fmask, bmask, W, H, z, rotDeg, tx, ty, cx, cy) {
  const r = rotDeg * Math.PI / 180, cos = Math.cos(r), sin = Math.sin(r);
  let inter = 0, uni = 0;
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    const bIn = bmask[y * W + x];
    const qx = x - cx - tx, qy = y - cy - ty;         // inversa da transformação
    const ix = Math.round((cos * qx + sin * qy) / z + cx);
    const iy = Math.round((-sin * qx + cos * qy) / z + cy);
    const fIn = (ix >= 0 && iy >= 0 && ix < W && iy < H) ? fmask[iy * W + ix] : 0;
    if (bIn || fIn) { uni++; if (bIn && fIn) inter++; }
  }
  return uni ? inter / uni : 0;
}

// Máscara de CONTORNO (bordas): Sobel sobre a luminância borrada, limiar por
// percentil (bordas mais fortes) e dilatação de 1px. É a versão "em máscara" do
// filtro de contorno neon, usada como 2º método de alinhamento automático.
function alEdgeMask(imgd) {
  const W = imgd.width, H = imgd.height, d = imgd.data, N = W * H;
  const g = new Float32Array(N);
  for (let p = 0, i = 0; p < N; p++, i += 4) g[p] = 0.299 * d[i] + 0.587 * d[i + 1] + 0.114 * d[i + 2];
  // borra 3x3
  const b = new Float32Array(N);
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    let s = 0, n = 0;
    for (let dy = -1; dy <= 1; dy++) { const yy = y + dy; if (yy < 0 || yy >= H) continue;
      for (let dx = -1; dx <= 1; dx++) { const xx = x + dx; if (xx < 0 || xx >= W) continue; s += g[yy * W + xx]; n++; } }
    b[y * W + x] = s / n;
  }
  const mag = new Float32Array(N); let mx = 0;
  for (let y = 1; y < H - 1; y++) for (let x = 1; x < W - 1; x++) {
    const p = y * W + x;
    const gx = (b[p - W + 1] + 2 * b[p + 1] + b[p + W + 1]) - (b[p - W - 1] + 2 * b[p - 1] + b[p + W - 1]);
    const gy = (b[p + W - 1] + 2 * b[p + W] + b[p + W + 1]) - (b[p - W - 1] + 2 * b[p - W] + b[p - W + 1]);
    const m = Math.sqrt(gx * gx + gy * gy); mag[p] = m; if (m > mx) mx = m;
  }
  const hist = new Int32Array(256), norm = mx > 0 ? 255 / mx : 0, q = new Uint8Array(N);
  for (let p = 0; p < N; p++) { const v = Math.min(255, Math.round(mag[p] * norm)); q[p] = v; hist[v]++; }
  let acc = 0, th = 255; const target = N * 0.12;
  for (let v = 255; v >= 0; v--) { acc += hist[v]; if (acc >= target) { th = v; break; } }
  th = Math.max(th, 16);
  const m0 = new Uint8Array(N);
  for (let p = 0; p < N; p++) m0[p] = q[p] >= th ? 1 : 0;
  const mask = new Uint8Array(N);
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    if (!m0[y * W + x]) continue;
    for (let dy = -1; dy <= 1; dy++) { const yy = y + dy; if (yy < 0 || yy >= H) continue;
      for (let dx = -1; dx <= 1; dx++) { const xx = x + dx; if (xx < 0 || xx >= W) continue; mask[yy * W + xx] = 1; } }
  }
  let area = 0; for (let p = 0; p < N; p++) area += mask[p];
  return { mask, area };
}

// Ajusta a transformação de semelhança (zoom, giro, translação) que empilha o
// acompanhamento (fMask) sobre a base (bMask): estimativa por momentos + refino
// que sobe o "morro" da sobreposição (IoU). Devolve {z,rot,tx,ty,iou} no quadro
// W0×H0. Fatorado para servir tanto à silhueta quanto ao contorno.
function alFitTransform(bMask, fMask, W0, H0) {
  const B = alMoments(bMask, W0, H0);
  const F = alMoments(fMask, W0, H0);
  if (!B || !F) return null;
  const cx = W0 / 2, cy = H0 / 2;
  const z0 = Math.max(0.5, Math.min(4, B.S / F.S));
  let rot0 = (B.theta - F.theta) * 180 / Math.PI;
  rot0 = ((rot0 % 180) + 180) % 180; if (rot0 > 90) rot0 -= 180;
  const iouAt = (z, rot, tx, ty) => alMaskIoU(fMask, bMask, W0, H0, z, rot, tx, ty, cx, cy);
  let best = null;
  for (const zm of [0.8, 0.9, 1, 1.1, 1.22]) {
    const z = Math.max(0.4, Math.min(5, z0 * zm));
    const t = alSolveT(B, F, z, rot0, cx, cy);
    const iou = iouAt(z, rot0, t.tx, t.ty);
    if (!best || iou > best.iou) best = { z, rot: rot0, tx: t.tx, ty: t.ty, iou };
  }
  const step = { z: 0.06, rot: 5, tx: W0 * 0.04, ty: H0 * 0.04 };
  for (let pass = 0; pass < 60; pass++) {
    let improved = false;
    for (const key of ["tx", "ty", "z", "rot"]) {
      for (const dir of [1, -1]) {
        const cand = { z: best.z, rot: best.rot, tx: best.tx, ty: best.ty };
        cand[key] += dir * step[key];
        if (cand.z < 0.4 || cand.z > 5) continue;
        if (cand.rot < -90 || cand.rot > 90) continue;
        const iou = iouAt(cand.z, cand.rot, cand.tx, cand.ty);
        if (iou > best.iou + 1e-4) { best = { ...cand, iou }; improved = true; }
      }
    }
    if (!improved) {
      step.z *= 0.5; step.rot *= 0.5; step.tx *= 0.5; step.ty *= 0.5;
      if (step.rot < 0.25) break;
    }
  }
  return best;
}

// Perspectiva (em px do palco) usada pela preview CSS e pelo warp ao confirmar.
// Quanto maior, mais suave é a distorção de "tombar" a foto em 3D.
function alPerspPx() {
  const r = $("#al-stage").getBoundingClientRect();
  return Math.max(r.width || 300, r.height || 400) * 2.2;
}

// Desenha um triângulo do canvas de origem no destino (mapeamento afim +
// recorte no triângulo destino). Usado pelo warp projetivo (giro 3D).
function alTexTri(ctx, img, s0, s1, s2, d0, d1, d2) {
  const [x0, y0] = s0, [x1, y1] = s1, [x2, y2] = s2;
  const [u0, v0] = d0, [u1, v1] = d1, [u2, v2] = d2;
  const den = x0 * (y1 - y2) - x1 * (y0 - y2) + x2 * (y0 - y1);
  if (Math.abs(den) < 1e-6) return;
  const A = (u0 * (y1 - y2) - u1 * (y0 - y2) + u2 * (y0 - y1)) / den;
  const Bc = (x0 * (u1 - u2) - x1 * (u0 - u2) + x2 * (u0 - u1)) / den;
  const C = (x0 * (y1 * u2 - y2 * u1) - x1 * (y0 * u2 - y2 * u0) + x2 * (y0 * u1 - y1 * u0)) / den;
  const D = (v0 * (y1 - y2) - v1 * (y0 - y2) + v2 * (y0 - y1)) / den;
  const E = (x0 * (v1 - v2) - x1 * (v0 - v2) + x2 * (v0 - v1)) / den;
  const F = (x0 * (y1 * v2 - y2 * v1) - x1 * (y0 * v2 - y2 * v0) + x2 * (y0 * v1 - y1 * v0)) / den;
  ctx.save();
  ctx.beginPath();
  ctx.moveTo(u0, v0); ctx.lineTo(u1, v1); ctx.lineTo(u2, v2); ctx.closePath();
  ctx.clip();
  ctx.transform(A, D, Bc, E, C, F);   // (srcX,srcY) -> (destX,destY)
  ctx.drawImage(img, 0, 0);
  ctx.restore();
}

// Warp de um canvas plano (srcW×srcH) para o quad projetado, por uma grade
// de GRID×GRID células (afim por célula ≈ perspectiva com erro mínimo).
function alDrawWarp(ctx, src, srcW, srcH, project, GRID) {
  const local = (x, y) => [x - srcW / 2, y - srcH / 2];
  for (let i = 0; i < GRID; i++) {
    for (let j = 0; j < GRID; j++) {
      const ax = i / GRID * srcW, bx = (i + 1) / GRID * srcW;
      const ay = j / GRID * srcH, by = (j + 1) / GRID * srcH;
      const s00 = [ax, ay], s10 = [bx, ay], s11 = [bx, by], s01 = [ax, by];
      const d00 = project(local(ax, ay)), d10 = project(local(bx, ay));
      const d11 = project(local(bx, by)), d01 = project(local(ax, by));
      alTexTri(ctx, src, s00, s10, s11, d00, d10, d11);
      alTexTri(ctx, src, s00, s11, s01, d00, d11, d01);
    }
  }
}

const Aligner = {
  session: null,
  followUrl: null,
  z: 1, tx: 0, ty: 0, rot: 0, rotX: 0, rotY: 0,
  baseW: 1, baseH: 1,

  // isReposition=true quando é só reajuste/reposicionamento de uma foto já
  // adquirida (NÃO pede rótulo na saída — o rótulo só é pedido ao ADQUIRIR).
  async open(session, followUrl, isReposition) {
    this.session = session;
    this.followUrl = followUrl;
    this.isReposition = !!isReposition;
    this.z = 1; this.tx = 0; this.ty = 0; this.rot = 0; this.rotX = 0; this.rotY = 0;
    $("#al-zoom").value = 1;
    $("#al-rotate").value = 0;
    $("#al-rotate-x").value = 0;
    $("#al-rotate-y").value = 0;
    $("#al-opacity").value = 0.5;
    try {
      const baseImg = await loadImageEl(session.baseImage);
      this.baseW = baseImg.naturalWidth || 3;
      this.baseH = baseImg.naturalHeight || 4;
    } catch (_) { this.baseW = 3; this.baseH = 4; }
    try {
      const fimg = await loadImageEl(followUrl);
      this.followW = fimg.naturalWidth || 3;
      this.followH = fimg.naturalHeight || 4;
    } catch (_) { this.followW = 3; this.followH = 4; }
    $("#al-ghost").src = session.baseImage;
    $("#al-ghost").style.opacity = 0.5;
    $("#al-follow").src = followUrl;
    // Contornos neon (gerados sob demanda) para o fantasma da base e do acomp.
    this._baseSketch = null;
    this._followSketch = null;
    this._setupContourUI();
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

  // Card "Contorno neon": alterna base (fantasma) e acompanhamento entre a FOTO
  // e o CONTORNO neon. Vale só para a exibição; ao confirmar, o acompanhamento
  // é sempre recortado da foto real (this.followUrl).
  _setupContourUI() {
    const cbBase = $("#al-contour-base"), cbFol = $("#al-contour-follow");
    if (!cbBase || !cbFol) return;
    // Defaults: herda a preferência marcada na tela de detalhe.
    cbBase.checked = !!(this.session && this.session.baseSketchOn);
    cbFol.checked = !!(this.session && this.session.followSketchOn);
    if (cbBase.checked) this.setBaseContour(true);
    if (cbFol.checked) this.setFollowContour(true);
  },

  async setBaseContour(on) {
    const ghost = $("#al-ghost");
    if (on) {
      if (!this._baseSketch) {
        try { this._baseSketch = await makeNeonSketch(this.session.baseImage, { color: window.NEON.base }); }
        catch (_) { return; }
      }
      ghost.src = this._baseSketch;
    } else {
      ghost.src = this.session.baseImage;
    }
  },

  async setFollowContour(on) {
    const fol = $("#al-follow");
    if (on) {
      if (!this._followSketch) {
        try { this._followSketch = await makeNeonSketch(this.followUrl, { color: window.NEON.follow }); }
        catch (_) { return; }
      }
      fol.src = this._followSketch;
    } else {
      fol.src = this.followUrl;
    }
  },

  apply() {
    // Giro 3D: perspectiva + rotateX/Y/Z. Ordem casada com o warp do confirm()
    // (translate → scale → perspective → rotateX → rotateY → rotateZ).
    const P = Math.round(alPerspPx());
    const t = `translate(${this.tx}px, ${this.ty}px) scale(${this.z}) ` +
              `perspective(${P}px) rotateX(${this.rotX}deg) rotateY(${this.rotY}deg) rotateZ(${this.rot}deg)`;
    $("#al-follow").style.transform = t;
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

    const c = document.createElement("canvas");
    c.width = OUTW; c.height = OUTH;
    const ctx = c.getContext("2d");
    ctx.fillStyle = "#000";
    ctx.fillRect(0, 0, OUTW, OUTH);

    // Enquadramento COBRINDO (cover) o quadro OUTW×OUTH, num canvas plano — é o
    // "conteúdo da caixa" antes de qualquer giro (mesmo que a preview CSS pinta
    // no #al-follow). Depois esse plano é girado/tombado igual à preview.
    const flat = document.createElement("canvas");
    flat.width = OUTW; flat.height = OUTH;
    const fctx = flat.getContext("2d");
    const cover = Math.max(OUTW / Wi, OUTH / Hi);
    const iw = Wi * cover, ih = Hi * cover;
    fctx.drawImage(followImg, (OUTW - iw) / 2, (OUTH - ih) / 2, iw, ih);

    const OCX = OUTW / 2 + this.tx * f;
    const OCY = OUTH / 2 + this.ty * f;
    const rz = this.rot * Math.PI / 180;
    const rx = this.rotX * Math.PI / 180;
    const ry = this.rotY * Math.PI / 180;

    if (Math.abs(this.rotX) < 0.01 && Math.abs(this.rotY) < 0.01) {
      // Sem tombamento: caminho 2D simples (nítido) — gira/escala/translada.
      ctx.save();
      ctx.translate(OCX, OCY);
      ctx.rotate(rz);
      ctx.scale(this.z, this.z);
      ctx.drawImage(flat, -OUTW / 2, -OUTH / 2);
      ctx.restore();
    } else {
      // Giro 3D: projeta os cantos da "caixa" (rotateZ→Y→X + perspectiva),
      // escala e translada; depois faz o warp projetivo do plano.
      const P = alPerspPx() * f;   // perspectiva em px de saída
      const cz = Math.cos(rz), sz = Math.sin(rz);
      const cyv = Math.cos(ry), syv = Math.sin(ry);
      const cxv = Math.cos(rx), sxv = Math.sin(rx);
      const zz = this.z;
      const project = (p) => {
        const lx = p[0], ly = p[1];
        // rotateZ
        const X1 = lx * cz - ly * sz, Y1 = lx * sz + ly * cz;
        // rotateY (em torno de Y): usa Z1=0
        const X2 = X1 * cyv, Z2 = -X1 * syv, Y2 = Y1;
        // rotateX (em torno de X)
        const Y3 = Y2 * cxv - Z2 * sxv, Z3 = Y2 * sxv + Z2 * cxv, X3 = X2;
        // perspectiva
        let denom = P - Z3; if (denom < P * 0.1) denom = P * 0.1;
        const fac = P / denom;
        return [OCX + X3 * fac * zz, OCY + Y3 * fac * zz];
      };
      alDrawWarp(ctx, flat, OUTW, OUTH, project, 16);
    }
    const aligned = c.toDataURL("image/jpeg", 0.9);

    const s = this.session;
    // O rótulo só é pedido ao ADQUIRIR a foto. No reposicionamento/reajuste de
    // uma foto já existente, mantém o rótulo e a data atuais (sem popup).
    if (!this.isReposition) {
      const res = await openLabelDialog(s.followLabel || defaultLabel("follow"));
      if (res == null) { await openDetail(s.id); return; }
      s.followLabel = res.label;
      s.followAt = new Date().toISOString();
    }
    s.followImage = aligned;
    // Nova imagem: zera ajustes/versao anteriores do acompanhamento.
    s.followImageView = null;
    s.followAdj = null;
    s.followTarget = null;
    if (typeof clearSketch === "function") clearSketch(s, "follow");
    await DB.put(s);
    await openDetail(s.id);
  },

  async cancel() {
    await openDetail(this.session.id);
  },

  // Alinhamento automático (v7.6.2): calcula DUAS transformações — por SILHUETA
  // (primeiro plano/pele) e por CONTORNO (bordas, o mesmo do filtro neon) — e
  // escolhe a que tem MAIS CONGRUÊNCIAS, i.e. maior sobreposição dos contornos.
  async autoAlign() {
    const btn = $("#al-auto");
    const label = btn.textContent;
    btn.disabled = true; btn.textContent = "Analisando…";
    // Deixa o botão repintar antes do processamento pesado.
    await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
    try {
      const baseImg = await loadImageEl(this.session.baseImage);
      const followImg = await loadImageEl(this.followUrl);
      const aspect = (this.baseW / this.baseH) || 0.75;
      const W0 = 240, H0 = Math.max(1, Math.round(W0 / aspect));
      const bImgd = alCoverRender(baseImg, W0, H0);
      const fImgd = alCoverRender(followImg, W0, H0);
      const minArea = W0 * H0 * 0.01;
      const cx = W0 / 2, cy = H0 / 2;

      // Método A: silhueta.  Método B: contorno (bordas).
      const bSil = alForegroundMask(bImgd), fSil = alForegroundMask(fImgd);
      const bEdge = alEdgeMask(bImgd), fEdge = alEdgeMask(fImgd);

      // Congruência COMUM p/ comparar os dois: sobreposição dos CONTORNOS
      // (bordas dilatadas) sob a transformação. Quem tiver mais, vence.
      const congr = (tr) => tr ? alMaskIoU(fEdge.mask, bEdge.mask, W0, H0, tr.z, tr.rot, tr.tx, tr.ty, cx, cy) : -1;

      const cands = [];
      if (bSil.area >= minArea && fSil.area >= minArea) {
        const tr = alFitTransform(bSil.mask, fSil.mask, W0, H0);
        if (tr) cands.push({ tr, via: "silhueta", score: congr(tr) });
      }
      if (bEdge.area >= minArea && fEdge.area >= minArea) {
        const tr = alFitTransform(bEdge.mask, fEdge.mask, W0, H0);
        if (tr) cands.push({ tr, via: "contorno", score: congr(tr) });
      }
      if (!cands.length) {
        alert("Não foi possível detectar a silhueta nem o contorno nas fotos. Ajuste manualmente.");
        return;
      }
      cands.sort((a, b) => b.score - a.score);
      const win = cands[0], best = win.tr;

      // Converte do quadro W0×H0 para os pixels do palco. O giro 3D fica zerado
      // (o automático só resolve giro no plano); o médico completa em 3D se quiser.
      const rect = $("#al-stage").getBoundingClientRect();
      const fac = (rect.width || W0) / W0;
      this.z = Math.max(0.5, Math.min(4, best.z));
      this.rot = ((best.rot + 180) % 360 + 360) % 360 - 180;   // normaliza -180..180
      this.rotX = 0; this.rotY = 0;
      this.tx = best.tx * fac;
      this.ty = best.ty * fac;
      $("#al-zoom").value = this.z;
      $("#al-rotate").value = Math.round(this.rot);
      $("#al-rotate-x").value = 0;
      $("#al-rotate-y").value = 0;
      this.apply();
      if (win.score < 0.10) {
        alert("Alinhamento automático com baixa confiança — confira e ajuste se precisar.");
      }
    } catch (e) {
      alert("Não foi possível fazer o alinhamento automático. Ajuste manualmente.");
    } finally {
      btn.disabled = false; btn.textContent = label;
    }
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
  // Giro no plano (Z) e giro 3D (tombar em X e Y).
  $("#al-rotate").addEventListener("input", (e) => {
    Aligner.rot = parseFloat(e.target.value);
    Aligner.apply();
  });
  $("#al-rotate-x").addEventListener("input", (e) => {
    Aligner.rotX = parseFloat(e.target.value);
    Aligner.apply();
  });
  $("#al-rotate-y").addEventListener("input", (e) => {
    Aligner.rotY = parseFloat(e.target.value);
    Aligner.apply();
  });
  $("#al-rotate-reset").addEventListener("click", () => {
    Aligner.rot = 0; Aligner.rotX = 0; Aligner.rotY = 0;
    $("#al-rotate").value = 0; $("#al-rotate-x").value = 0; $("#al-rotate-y").value = 0;
    Aligner.apply();
  });
  $("#al-opacity").addEventListener("input", (e) => {
    $("#al-ghost").style.opacity = e.target.value;
  });
  $("#al-cancel").addEventListener("click", () => Aligner.cancel());
  $("#al-confirm").addEventListener("click", () => Aligner.confirm());
  $("#al-auto").addEventListener("click", () => Aligner.autoAlign());

  // Card "Contorno neon": base/acompanhamento como contorno neon (só exibição).
  $("#al-contour-base").addEventListener("change", (e) => Aligner.setBaseContour(e.target.checked));
  $("#al-contour-follow").addEventListener("change", (e) => Aligner.setFollowContour(e.target.checked));

  window.addEventListener("resize", () => {
    if ($("#screen-align").classList.contains("active")) Aligner.layoutStage();
  });
});
