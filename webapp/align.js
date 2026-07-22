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

// Dilata uma máscara binária em 1px (vizinhança 3x3).
function alDilate1(mask, W, H) {
  const out = new Uint8Array(W * H);
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    if (!mask[y * W + x]) continue;
    for (let dy = -1; dy <= 1; dy++) { const yy = y + dy; if (yy < 0 || yy >= H) continue;
      for (let dx = -1; dx <= 1; dx++) { const xx = x + dx; if (xx < 0 || xx >= W) continue; out[yy * W + xx] = 1; } }
  }
  return out;
}

// Contorno (borda) da SILHUETA: pixel de pele que faz fronteira com o FUNDO
// (ignora o corte da moldura). É o traço ESTÁVEL do membro — não muda com veias
// ou marcas novas nem com a iluminação — logo, a melhor referência de encaixe.
// Dilatado ~3px: uma faixa tolerante dá um "terreno" suave para o otimizador
// (evita o ótimo ruidoso de um traço de 1px que quase nunca se sobrepõe).
function alOutlineMask(sil, W, H, rad) {
  const out = new Uint8Array(W * H);
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    const p = y * W + x; if (!sil[p]) continue;
    if ((x > 0 && !sil[p - 1]) || (x < W - 1 && !sil[p + 1]) ||
        (y > 0 && !sil[p - W]) || (y < H - 1 && !sil[p + W])) out[p] = 1;
  }
  let m = out; const n = rad == null ? 3 : rad;
  for (let i = 0; i < n; i++) m = alDilate1(m, W, H);
  return m;
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

/* ===================== Transformação unificada (com fulcro) =====================
   project(pt) leva um ponto do QUADRO PLANO (centrado) para a tela, aplicando,
   NA MESMA ORDEM da preview CSS: gira em torno do FULCRO (Z→Y→X), perspectiva,
   zoom e translação. p = {z, txp, typ, rot, rotX, rotY, fx, fy} — txp/typ em px
   do quadro W×H; fx/fy = fulcro normalizado (0..1). Serve à preview, ao warp do
   confirm e ao alinhamento automático (via homografia). */
function alMakeProject(p, W, H, P) {
  const rz = p.rot * Math.PI / 180, rx = p.rotX * Math.PI / 180, ry = p.rotY * Math.PI / 180;
  const cz = Math.cos(rz), sz = Math.sin(rz);
  const cyv = Math.cos(ry), syv = Math.sin(ry);
  const cxv = Math.cos(rx), sxv = Math.sin(rx);
  const Fx = (p.fx - 0.5) * W, Fy = (p.fy - 0.5) * H;
  const OCX = W / 2 + p.txp, OCY = H / 2 + p.typ, z = p.z;
  return (pt) => {
    const ax = pt[0] - Fx, ay = pt[1] - Fy;
    const X1 = ax * cz - ay * sz, Y1 = ax * sz + ay * cz;
    const X2 = X1 * cyv, Z2 = -X1 * syv, Y2 = Y1;
    const Y3 = Y2 * cxv - Z2 * sxv, Z3 = Y2 * sxv + Z2 * cxv, X3 = X2;
    let den = P - Z3; if (den < P * 0.1) den = P * 0.1;
    const fac = P / den;
    return [OCX + Fx + X3 * fac * z, OCY + Fy + Y3 * fac * z];
  };
}

// Resolve A·x = b (n×n) por eliminação de Gauss com pivô. Devolve x ou null.
function alSolveLin(A, b, n) {
  for (let i = 0; i < n; i++) A[i].push(b[i]);
  for (let col = 0; col < n; col++) {
    let piv = col;
    for (let r = col + 1; r < n; r++) if (Math.abs(A[r][col]) > Math.abs(A[piv][col])) piv = r;
    if (Math.abs(A[piv][col]) < 1e-12) return null;
    const tmp = A[col]; A[col] = A[piv]; A[piv] = tmp;
    const d = A[col][col];
    for (let c = col; c <= n; c++) A[col][c] /= d;
    for (let r = 0; r < n; r++) {
      if (r === col) continue;
      const f = A[r][col]; if (!f) continue;
      for (let c = col; c <= n; c++) A[r][c] -= f * A[col][c];
    }
  }
  const x = new Array(n); for (let i = 0; i < n; i++) x[i] = A[i][n]; return x;
}

// Homografia 3×3 (row-major, [9]) que leva os 4 pontos src -> dst. null se degenerada.
function alHomography4(src, dst) {
  const A = [], b = [];
  for (let i = 0; i < 4; i++) {
    const x = src[i][0], y = src[i][1], u = dst[i][0], v = dst[i][1];
    A.push([x, y, 1, 0, 0, 0, -x * u, -y * u]); b.push(u);
    A.push([0, 0, 0, x, y, 1, -x * v, -y * v]); b.push(v);
  }
  const h = alSolveLin(A, b, 8);
  if (!h) return null;
  return [h[0], h[1], h[2], h[3], h[4], h[5], h[6], h[7], 1];
}

// Inversa de matriz 3×3 (row-major). null se singular.
function alMat3Inv(m) {
  const a = m[0], b = m[1], c = m[2], d = m[3], e = m[4], f = m[5], g = m[6], h = m[7], i = m[8];
  const A = e * i - f * h, B = -(d * i - f * g), C = d * h - e * g;
  const det = a * A + b * B + c * C;
  if (Math.abs(det) < 1e-12) return null;
  const id = 1 / det;
  return [
    A * id, (c * h - b * i) * id, (b * f - c * e) * id,
    B * id, (a * i - c * g) * id, (c * d - a * f) * id,
    C * id, (b * g - a * h) * id, (a * e - b * d) * id,
  ];
}

// Congruência (IoU) das bordas dentro da ROI: para cada pixel da ROI no quadro
// da BASE, acha o pixel correspondente do ACOMPANHAMENTO (via Hinv canvas->quadro)
// e compara as bordas dilatadas. Mais alto = contornos mais coincidentes.
function alRoiCongruence(Hinv, bEdge, fEdge, W, H, roi) {
  let inter = 0, uni = 0;
  for (let y = roi.y0; y <= roi.y1; y++) {
    for (let x = roi.x0; x <= roi.x1; x++) {
      const bIn = bEdge[y * W + x];
      const cxx = x - W / 2, cyy = y - H / 2;
      const w = Hinv[6] * cxx + Hinv[7] * cyy + Hinv[8];
      let fIn = 0;
      if (Math.abs(w) > 1e-9) {
        const ix = Math.round((Hinv[0] * cxx + Hinv[1] * cyy + Hinv[2]) / w + W / 2);
        const iy = Math.round((Hinv[3] * cxx + Hinv[4] * cyy + Hinv[5]) / w + H / 2);
        fIn = (ix >= 0 && iy >= 0 && ix < W && iy < H) ? fEdge[iy * W + ix] : 0;
      }
      if (bIn || fIn) { uni++; if (bIn && fIn) inter++; }
    }
  }
  return uni ? inter / uni : 0;
}

// Matriz inversa (canvas→quadro) da homografia gerada pelos parâmetros. null se
// degenerada. Centraliza a lógica compartilhada entre pontuar e otimizar.
function alParamsToHinv(p, W, H, P) {
  const corners = [[-W / 2, -H / 2], [W / 2, -H / 2], [W / 2, H / 2], [-W / 2, H / 2]];
  const q = Object.assign({ z: 1, txp: 0, typ: 0, rot: 0, rotX: 0, rotY: 0, fx: 0.5, fy: 0.5 }, p);
  const proj = alMakeProject(q, W, H, P);
  const dst = corners.map((c) => { const r = proj(c); return [r[0] - W / 2, r[1] - H / 2]; });
  const Hm = alHomography4(corners, dst); if (!Hm) return null;
  return alMat3Inv(Hm);
}

// Pontua um conjunto de parâmetros por uma função de congruência qualquer
// congruenceFn(Hinv) → [0..1] (usado p/ escolher a melhor semente do otimizador).
function alScoreParams(p, W, H, congruenceFn) {
  const Hi = alParamsToHinv(p, W, H, 2.2 * Math.max(W, H));
  return Hi ? congruenceFn(Hi) : -1;
}

// Alinhamento automático COMPLETO: busca em padrão (coordinate pattern search)
// sobre TODAS as ferramentas — zoom, translação, giro no plano (Z), tombamentos
// 3D (X, Y) e o FULCRO — maximizando a congruência dada por congruenceFn(Hinv).
function alAutoRegister(W, H, congruenceFn, init) {
  const P = 2.2 * Math.max(W, H);
  const scoreOf = (p) => { const Hi = alParamsToHinv(p, W, H, P); return Hi ? congruenceFn(Hi) : -1; };
  let best = Object.assign({ z: 1, txp: 0, typ: 0, rot: 0, rotX: 0, rotY: 0, fx: 0.5, fy: 0.5 }, init || {});
  best.score = scoreOf(best);
  const steps = { txp: W * 0.06, typ: H * 0.06, z: 0.08, rot: 6, rotX: 8, rotY: 8, fx: 0.06, fy: 0.06 };
  const lim = { z: [0.4, 4], rot: [-95, 95], rotX: [-60, 60], rotY: [-60, 60], fx: [0, 1], fy: [0, 1] };
  for (let pass = 0; pass < 120; pass++) {
    let improved = false;
    for (const key of ["txp", "typ", "z", "rot", "rotX", "rotY", "fx", "fy"]) {
      for (const dir of [1, -1]) {
        const cand = Object.assign({}, best);
        cand[key] += dir * steps[key];
        const L = lim[key]; if (L && (cand[key] < L[0] || cand[key] > L[1])) continue;
        const sc = scoreOf(cand);
        if (sc > best.score + 1e-4) { cand.score = sc; best = cand; improved = true; }
      }
    }
    if (!improved) { for (const k in steps) steps[k] *= 0.5; if (steps.rot < 0.35) break; }
  }
  return best;
}

const Aligner = {
  session: null,
  followUrl: null,
  z: 1, tx: 0, ty: 0, rot: 0, rotX: 0, rotY: 0, fx: 0.5, fy: 0.5,
  fulcrumMode: false, roiDrawing: false,
  baseW: 1, baseH: 1,

  // isReposition=true quando é só reajuste/reposicionamento de uma foto já
  // adquirida (NÃO pede rótulo na saída — o rótulo só é pedido ao ADQUIRIR).
  // followUrl deve ser a IMAGEM ORIGINAL do acompanhamento (não a última
  // confirmada); a transformação salva (followAlign) é reaplicada por cima.
  async open(session, followUrl, isReposition) {
    this.session = session;
    this.followUrl = followUrl;
    this.isReposition = !!isReposition;
    // Estado inicial: identidade, OU a transformação salva (reposição). A
    // translação é guardada NORMALIZADA (txn/tyn) e vira px após o layout.
    const a = (isReposition && session.followAlign) ? session.followAlign : null;
    this.z = a ? a.z : 1;
    this._txn = a && a.txn != null ? a.txn : 0;
    this._tyn = a && a.tyn != null ? a.tyn : 0;
    this.tx = 0; this.ty = 0;
    this.rot = a ? a.rot : 0; this.rotX = a ? (a.rotX || 0) : 0; this.rotY = a ? (a.rotY || 0) : 0;
    this.fx = a && a.fx != null ? a.fx : 0.5; this.fy = a && a.fy != null ? a.fy : 0.5;
    this.fulcrumMode = false; this.roiDrawing = false;
    this._setFulcrumMode(false);
    if ($("#al-roidraw")) $("#al-roidraw").hidden = true;
    if ($("#al-roi-hint")) $("#al-roi-hint").hidden = true;
    $("#al-zoom").value = this.z;
    $("#al-rotate").value = Math.round(this.rot);
    $("#al-rotate-x").value = Math.round(this.rotX);
    $("#al-rotate-y").value = Math.round(this.rotY);
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
    requestAnimationFrame(() => {
      this.layoutStage();
      // Converte a translação normalizada guardada em px do palco já dimensionado.
      const stage = $("#al-stage");
      this.tx = this._txn * stage.clientWidth;
      this.ty = this._tyn * stage.clientHeight;
      this.apply();
    });
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
    // Giro 3D em torno do FULCRO (transform-origin). Ordem casada com o warp do
    // confirm(): translate → scale → perspective → rotateX → rotateY → rotateZ.
    const P = Math.round(alPerspPx());
    const fol = $("#al-follow");
    fol.style.transformOrigin = `${this.fx * 100}% ${this.fy * 100}%`;
    fol.style.transform =
      `translate(${this.tx}px, ${this.ty}px) scale(${this.z}) ` +
      `perspective(${P}px) rotateX(${this.rotX}deg) rotateY(${this.rotY}deg) rotateZ(${this.rot}deg)`;
    this._renderFulcrum();
  },

  // Marca do fulcro (eixo de giro): posiciona o marcador no ponto (fx,fy) do palco.
  _renderFulcrum() {
    const m = $("#al-fulcrum"); if (!m) return;
    const stage = $("#al-stage");
    m.style.left = (this.fx * stage.clientWidth) + "px";
    m.style.top = (this.fy * stage.clientHeight) + "px";
    m.hidden = false;
  },

  // Liga/desliga o modo "reposicionar fulcro": no modo, tocar/arrastar no palco
  // move o eixo de giro (em vez de arrastar a foto).
  _setFulcrumMode(on) {
    this.fulcrumMode = !!on;
    const btn = $("#al-fulcrum-btn");
    if (btn) btn.classList.toggle("active", this.fulcrumMode);
    const m = $("#al-fulcrum");
    if (m) m.classList.toggle("editing", this.fulcrumMode);
    const hint = $("#al-fulcrum-hint");
    if (hint) hint.hidden = !this.fulcrumMode;
    this._refreshAdjustLock();
  },

  // Enquanto posiciona o fulcro OU desenha a zona de interesse, os outros
  // ajustes (zoom e giros) ficam DESLIGADOS para não atrapalhar (v7.6.4).
  _refreshAdjustLock() {
    const lock = this.fulcrumMode || this.roiDrawing;
    ["#al-zoom", "#al-rotate", "#al-rotate-x", "#al-rotate-y"].forEach((sel) => {
      const el = $(sel); if (el) el.disabled = lock;
    });
    const auto = $("#al-auto"); if (auto) auto.disabled = this.fulcrumMode;
    const fb = $("#al-fulcrum-btn"); if (fb) fb.disabled = this.roiDrawing;
  },

  toggleFulcrumMode() { this._setFulcrumMode(!this.fulcrumMode); },

  // Define o fulcro a partir de um ponto de tela (clientX/Y).
  setFulcrumFromClient(clientX, clientY) {
    const r = $("#al-stage").getBoundingClientRect();
    this.fx = Math.max(0, Math.min(1, (clientX - r.left) / r.width));
    this.fy = Math.max(0, Math.min(1, (clientY - r.top) / r.height));
    this.apply();
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

    const centered = Math.abs(this.fx - 0.5) < 0.001 && Math.abs(this.fy - 0.5) < 0.001;
    if (Math.abs(this.rotX) < 0.01 && Math.abs(this.rotY) < 0.01 && centered) {
      // Sem tombamento e fulcro no centro: caminho 2D simples (nítido).
      ctx.save();
      ctx.translate(OUTW / 2 + this.tx * f, OUTH / 2 + this.ty * f);
      ctx.rotate(this.rot * Math.PI / 180);
      ctx.scale(this.z, this.z);
      ctx.drawImage(flat, -OUTW / 2, -OUTH / 2);
      ctx.restore();
    } else {
      // Giro 3D e/ou fulcro deslocado: warp projetivo com a mesma projeção da
      // preview (alMakeProject), garantindo WYSIWYG.
      const P = alPerspPx() * f;
      const params = {
        z: this.z, txp: this.tx * f, typ: this.ty * f,
        rot: this.rot, rotX: this.rotX, rotY: this.rotY, fx: this.fx, fy: this.fy,
      };
      alDrawWarp(ctx, flat, OUTW, OUTH, alMakeProject(params, OUTW, OUTH, P), 18);
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
    // Preserva a IMAGEM ORIGINAL (para o "Zerar giros" voltar a ela) e guarda a
    // transformação usada, para reeditar a partir do original (sem re-assar).
    if (!s.followOriginal) s.followOriginal = this.followUrl;
    s.followAlign = {
      z: this.z, txn: this.tx / (Wc || 1), tyn: this.ty / (Hc || 1),
      rot: this.rot, rotX: this.rotX, rotY: this.rotY, fx: this.fx, fy: this.fy,
    };
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

  // ---- Zerar giros (item 3): volta à IMAGEM ORIGINAL, não à última confirmada.
  async resetGiros() {
    const ok = await confirmDialog(
      "Zerar giros",
      "Isto descarta todos os ajustes de posição (zoom, giros e fulcro) e volta à " +
      "<b>imagem original</b> do acompanhamento — <b>não</b> à última confirmada. " +
      "Para <b>cancelar os ajustes atuais</b> sem zerar, toque na seta <b>‹</b> " +
      "para voltar.<br><br>Deseja zerar?",
      "Zerar");
    if (!ok) return;
    this.z = 1; this.tx = 0; this.ty = 0; this._txn = 0; this._tyn = 0;
    this.rot = 0; this.rotX = 0; this.rotY = 0; this.fx = 0.5; this.fy = 0.5;
    this._setFulcrumMode(false);
    $("#al-zoom").value = 1;
    $("#al-rotate").value = 0; $("#al-rotate-x").value = 0; $("#al-rotate-y").value = 0;
    this.apply();
  },

  // ---- Alinhamento automático 3D (item 5): pede a zona de interesse e otimiza.
  // Passo 1: entra no modo de desenho da ROI sobre o palco.
  startAuto() {
    if (this.roiDrawing) return;
    this._setFulcrumMode(false);
    this.roiDrawing = true;
    this._roiRect = null;
    const dr = $("#al-roidraw"); if (dr) dr.hidden = false;
    const rc = $("#al-roirect"); if (rc) rc.hidden = true;
    const hint = $("#al-roi-hint"); if (hint) hint.hidden = false;
    this._refreshAdjustLock();
  },
  _cancelRoi() {
    this.roiDrawing = false;
    const dr = $("#al-roidraw"); if (dr) dr.hidden = true;
    const hint = $("#al-roi-hint"); if (hint) hint.hidden = true;
    this._refreshAdjustLock();
  },

  // Passo 2: recebe a ROI (normalizada) e roda o otimizador 3D.
  async runAuto(roiNorm) {
    const btn = $("#al-auto");
    const label = btn.textContent;
    btn.disabled = true; btn.textContent = "Analisando…";
    await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
    try {
      const baseImg = await loadImageEl(this.session.baseImage);
      const followImg = await loadImageEl(this.followUrl);
      const aspect = (this.baseW / this.baseH) || 0.75;
      const Wg = 200, Hg = Math.max(1, Math.round(Wg / aspect));
      const bImgd = alCoverRender(baseImg, Wg, Hg);
      const fImgd = alCoverRender(followImg, Wg, Hg);
      // Silhueta (membro vs fundo liso) — estável entre visitas; dela sai o
      // CONTORNO do membro (traço que não muda com veias/marcas/iluminação).
      const bSil = alForegroundMask(bImgd), fSil = alForegroundMask(fImgd);
      const bOut = alOutlineMask(bSil.mask, Wg, Hg), fOut = alOutlineMask(fSil.mask, Wg, Hg);
      const bEdge = alEdgeMask(bImgd), fEdge = alEdgeMask(fImgd);

      // ROI (px) no quadro Wg×Hg; margem mínima p/ não degenerar.
      const clampi = (v, lo, hi) => Math.max(lo, Math.min(hi, Math.round(v)));
      const roi = {
        x0: clampi(roiNorm.x0 * Wg, 0, Wg - 2), y0: clampi(roiNorm.y0 * Hg, 0, Hg - 2),
        x1: clampi(roiNorm.x1 * Wg, 1, Wg - 1), y1: clampi(roiNorm.y1 * Hg, 1, Hg - 1),
      };
      if (roi.x1 - roi.x0 < 4 || roi.y1 - roi.y0 < 4) { roi.x0 = 0; roi.y0 = 0; roi.x1 = Wg - 1; roi.y1 = Hg - 1; }

      // Congruência COMBINADA na ROI (v7.6.4, calibrada em fotos clínicas reais):
      // a SILHUETA (área do membro) domina por ser suave e robusta; o CONTORNO
      // dilatado refina a forma; as bordas cruas entram só como leve reforço.
      // Assim o encaixe não é enganado por veias/marcas novas nem pela iluminação,
      // e não "encolhe" a foto atrás de um contorno fino ruidoso.
      const iou = (Hi, b, f) => alRoiCongruence(Hi, b, f, Wg, Hg, roi);
      const congruenceFn = (Hi) =>
        0.45 * iou(Hi, bSil.mask, fSil.mask) +
        0.40 * iou(Hi, bOut, fOut) +
        0.15 * iou(Hi, bEdge.mask, fEdge.mask);

      // Sementes por MOMENTOS a partir da SILHUETA (posição/escala/orientação do
      // membro) e do seu contorno — ambas ESTÁVEIS. Não semeamos pelas bordas
      // cruas (podem começar num "vale" errado por causa de veias/marcas).
      const toParam = (tr) => tr ? { z: tr.z, txp: tr.tx, typ: tr.ty, rot: tr.rot, rotX: 0, rotY: 0, fx: 0.5, fy: 0.5 } : null;
      const seeds = [{ z: 1, txp: 0, typ: 0, rot: 0, rotX: 0, rotY: 0, fx: 0.5, fy: 0.5 }];
      const trS = alFitTransform(bSil.mask, fSil.mask, Wg, Hg); if (trS) seeds.push(toParam(trS));
      const trO = alFitTransform(bOut, fOut, Wg, Hg); if (trO) seeds.push(toParam(trO));
      let seed = seeds[0], seedScore = alScoreParams(seed, Wg, Hg, congruenceFn);
      for (const s of seeds) {
        const sc = alScoreParams(s, Wg, Hg, congruenceFn);
        if (sc > seedScore) { seed = s; seedScore = sc; }
      }

      let best = alAutoRegister(Wg, Hg, congruenceFn, seed);

      // Salvaguarda: o refino NUNCA deve piorar a sobreposição global do membro
      // em relação à melhor semente (silhueta). Se piorar (caso patológico com
      // ROI pequena), volta para a semente — encaixe mais seguro.
      const full = { x0: 0, y0: 0, x1: Wg - 1, y1: Hg - 1 };
      const silFull = (p) => { const Hi = alParamsToHinv(p, Wg, Hg, 2.2 * Math.max(Wg, Hg)); return Hi ? alRoiCongruence(Hi, bSil.mask, fSil.mask, Wg, Hg, full) : -1; };
      if (silFull(best) < silFull(seed) - 0.03) best = Object.assign({ rotX: 0, rotY: 0, fx: 0.5, fy: 0.5 }, seed);

      // Converte para o palco. tx/ty do quadro Wg → px do palco.
      const stage = $("#al-stage");
      const fx0 = (stage.clientWidth || Wg) / Wg, fy0 = (stage.clientHeight || Hg) / Hg;
      this.z = Math.max(0.5, Math.min(4, best.z));
      this.rot = ((best.rot + 180) % 360 + 360) % 360 - 180;
      this.rotX = Math.max(-60, Math.min(60, best.rotX || 0));
      this.rotY = Math.max(-60, Math.min(60, best.rotY || 0));
      this.fx = Math.max(0, Math.min(1, best.fx == null ? 0.5 : best.fx));
      this.fy = Math.max(0, Math.min(1, best.fy == null ? 0.5 : best.fy));
      this.tx = best.txp * fx0; this.ty = best.typ * fy0;
      $("#al-zoom").value = this.z;
      $("#al-rotate").value = Math.round(this.rot);
      $("#al-rotate-x").value = Math.round(this.rotX);
      $("#al-rotate-y").value = Math.round(this.rotY);
      this.apply();
      if ((best.score || 0) < 0.12) {
        alert("Alinhamento automático com baixa confiança — confira e ajuste (giros, fulcro e zoom) se precisar.");
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
    if (Aligner.roiDrawing || Aligner.fulcrumMode) return;
    gestureOn = true; gZoom = Aligner.z;
    gLast = { x: e.clientX || 0, y: e.clientY || 0 };
  }, { passive: false });
  stage.addEventListener("gesturechange", (e) => {
    e.preventDefault();
    if (Aligner.roiDrawing || Aligner.fulcrumMode) return;
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

  // Nos modos especiais (reposicionar fulcro / desenhar ROI) o arraste/pinça da
  // FOTO fica desligado — quem cuida do toque é o handler de ponteiro abaixo.
  const specialMode = () => Aligner.roiDrawing || Aligner.fulcrumMode;

  // ----- TOQUE: 1 dedo arrasta; 2 dedos pinca (so onde nao ha gesture) -----
  stage.addEventListener("touchstart", (e) => {
    if (specialMode()) return;
    if (e.touches.length === 1) {
      tLast = { x: e.touches[0].clientX, y: e.touches[0].clientY }; pinchBase = null;
    } else if (e.touches.length >= 2 && !supportsGesture) {
      pinchBase = { dist: d2(e.touches), zoom: Aligner.z, mid: m2(e.touches) }; tLast = null;
    }
  }, { passive: false });

  stage.addEventListener("touchmove", (e) => {
    if (specialMode()) return;
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
    if (e.pointerType === "touch" || specialMode()) return;
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

  // --- MODOS ESPECIAIS (fulcro / ROI): ponteiro unificado (toque + mouse) ---
  let roiStart = null, spCapture = null;
  const spPoint = (e) => {
    const r = stage.getBoundingClientRect();
    return { x: Math.max(0, Math.min(1, (e.clientX - r.left) / r.width)),
             y: Math.max(0, Math.min(1, (e.clientY - r.top) / r.height)) };
  };
  const drawRoiRect = (a, b) => {
    const rc = $("#al-roirect"); if (!rc) return;
    const x0 = Math.min(a.x, b.x), y0 = Math.min(a.y, b.y);
    const x1 = Math.max(a.x, b.x), y1 = Math.max(a.y, b.y);
    rc.hidden = false;
    rc.style.left = (x0 * 100) + "%"; rc.style.top = (y0 * 100) + "%";
    rc.style.width = ((x1 - x0) * 100) + "%"; rc.style.height = ((y1 - y0) * 100) + "%";
  };
  stage.addEventListener("pointerdown", (e) => {
    if (Aligner.fulcrumMode) {
      e.preventDefault();
      Aligner.setFulcrumFromClient(e.clientX, e.clientY);
      spCapture = e.pointerId; try { stage.setPointerCapture(e.pointerId); } catch (_) {}
    } else if (Aligner.roiDrawing) {
      e.preventDefault();
      roiStart = spPoint(e);
      spCapture = e.pointerId; try { stage.setPointerCapture(e.pointerId); } catch (_) {}
      drawRoiRect(roiStart, roiStart);
    }
  });
  stage.addEventListener("pointermove", (e) => {
    if (Aligner.fulcrumMode && spCapture === e.pointerId) {
      Aligner.setFulcrumFromClient(e.clientX, e.clientY);
    } else if (Aligner.roiDrawing && roiStart && spCapture === e.pointerId) {
      drawRoiRect(roiStart, spPoint(e));
    }
  });
  const spUp = (e) => {
    if (spCapture !== e.pointerId) return;
    try { stage.releasePointerCapture(e.pointerId); } catch (_) {}
    spCapture = null;
    if (Aligner.roiDrawing && roiStart) {
      const end = spPoint(e);
      const roi = { x0: Math.min(roiStart.x, end.x), y0: Math.min(roiStart.y, end.y),
                    x1: Math.max(roiStart.x, end.x), y1: Math.max(roiStart.y, end.y) };
      roiStart = null;
      Aligner._cancelRoi();
      Aligner.runAuto(roi);
    }
  };
  stage.addEventListener("pointerup", spUp);
  stage.addEventListener("pointercancel", spUp);

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
  // Zerar giros: volta ao ORIGINAL (com confirmação). Reposicionar fulcro: modo.
  $("#al-rotate-reset").addEventListener("click", () => Aligner.resetGiros());
  $("#al-fulcrum-btn").addEventListener("click", () => Aligner.toggleFulcrumMode());
  $("#al-opacity").addEventListener("input", (e) => {
    $("#al-ghost").style.opacity = e.target.value;
  });
  $("#al-cancel").addEventListener("click", () => Aligner.cancel());
  $("#al-confirm").addEventListener("click", () => Aligner.confirm());
  $("#al-auto").addEventListener("click", () => Aligner.startAuto());

  // Card "Contorno neon": base/acompanhamento como contorno neon (só exibição).
  $("#al-contour-base").addEventListener("change", (e) => Aligner.setBaseContour(e.target.checked));
  $("#al-contour-follow").addEventListener("change", (e) => Aligner.setFollowContour(e.target.checked));

  window.addEventListener("resize", () => {
    if ($("#screen-align").classList.contains("active")) { Aligner.layoutStage(); Aligner._renderFulcrum(); }
  });
});
