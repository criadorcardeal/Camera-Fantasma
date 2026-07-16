"use strict";

/* =========================================================================
   ComparaCam - v7.5 - Zona de Interesse (ROI).

   O usuario contorna livremente uma regiao clinica na foto BASE (ferida,
   variz, etc.). O app REFINA esse traco com visao computacional (segmentacao
   local tipo GrabCut leve) e guarda um contorno em VERDE. Esse contorno e
   reusado:
     - ao vivo na camera de acompanhamento (piscando verde/amarelo);
     - na janela de alinhamento (alvo fixo sobre o fantasma).

   Coordenadas do contorno: pontos NORMALIZADOS no espaco da IMAGEM base
   (0..1), independentes do tamanho da tela. Convertidos para pixels do
   elemento de exibicao respeitando object-fit (cover/contain).

   Globais reusadas: $, showScreen, DB, openDetail, loadImageEl (app/editor)
   e alLargestComponent, alFillHoles (align.js).
   ========================================================================= */

/* -------------------------------------------------------------------------
   Helpers de coordenadas (GLOBAIS - usados por camera e alinhamento tambem).
   ------------------------------------------------------------------------- */

// Fator de escala da imagem (imgW x imgH) dentro de uma caixa (boxW x boxH)
// para object-fit "cover" (Math.max) ou "contain" (Math.min).
function roiFitScale(imgW, imgH, boxW, boxH, fit) {
  return fit === "cover"
    ? Math.max(boxW / imgW, boxH / imgH)
    : Math.min(boxW / imgW, boxH / imgH);
}

// Ponto normalizado da imagem (nx,ny em 0..1) -> pixels da caixa.
function roiImgNormToBox(nx, ny, imgW, imgH, boxW, boxH, fit) {
  const s = roiFitScale(imgW, imgH, boxW, boxH, fit);
  const dispW = imgW * s, dispH = imgH * s;
  const offX = (boxW - dispW) / 2, offY = (boxH - dispH) / 2;
  return { x: offX + nx * dispW, y: offY + ny * dispH };
}

// Pixels da caixa -> ponto normalizado da imagem (0..1). Inverso do de cima.
function roiBoxToImgNorm(x, y, imgW, imgH, boxW, boxH, fit) {
  const s = roiFitScale(imgW, imgH, boxW, boxH, fit);
  const dispW = imgW * s, dispH = imgH * s;
  const offX = (boxW - dispW) / 2, offY = (boxH - dispH) / 2;
  return { nx: (x - offX) / dispW, ny: (y - offY) / dispH };
}

// Converte pontos img-normalizados p/ caixa-normalizados (0..1 da caixa),
// respeitando o object-fit. Util p/ rasterizar a mascara no enquadramento
// da tela (camera/alinhamento).
function roiPointsToBoxNorm(points, imgW, imgH, boxW, boxH, fit) {
  return points.map(([nx, ny]) => {
    const p = roiImgNormToBox(nx, ny, imgW, imgH, boxW, boxH, fit);
    return [p.x / boxW, p.y / boxH];
  });
}

// Rasteriza um poligono (pontos em 0..1) para uma mascara Uint8Array W*H.
function roiPolygonMask(points, W, H) {
  const mask = new Uint8Array(W * H);
  if (!points || points.length < 3) return mask;
  const xs = points.map((p) => p[0] * W), ys = points.map((p) => p[1] * H);
  let ymin = H, ymax = 0;
  for (const y of ys) { if (y < ymin) ymin = y; if (y > ymax) ymax = y; }
  ymin = Math.max(0, Math.floor(ymin)); ymax = Math.min(H - 1, Math.ceil(ymax));
  const n = points.length;
  const nodeX = [];
  for (let y = ymin; y <= ymax; y++) {
    nodeX.length = 0;
    const yc = y + 0.5;
    let j = n - 1;
    for (let i = 0; i < n; i++) {
      const yi = ys[i], yj = ys[j];
      if ((yi < yc && yj >= yc) || (yj < yc && yi >= yc)) {
        nodeX.push(xs[i] + (yc - yi) / (yj - yi) * (xs[j] - xs[i]));
      }
      j = i;
    }
    nodeX.sort((a, b) => a - b);
    for (let k = 0; k + 1 < nodeX.length; k += 2) {
      let xa = Math.round(nodeX[k]), xb = Math.round(nodeX[k + 1]);
      if (xa < 0) xa = 0; if (xb > W) xb = W;
      for (let x = xa; x < xb; x++) mask[y * W + x] = 1;
    }
  }
  return mask;
}

// Atualiza a GEOMETRIA do contorno num <svg> overlay (que cobre um elemento):
// ajusta o viewBox ao tamanho atual do svg e mapeia os pontos pelo object-fit.
// A VISIBILIDADE (atributo hidden) fica por conta de quem chama. Devolve true
// se desenhou (ROI valida e caixa com tamanho).
function roiRenderSvg(svg, points, imgW, imgH, fit) {
  if (!svg) return false;
  const W = svg.clientWidth, H = svg.clientHeight;
  if (!W || !H || !points || points.length < 3) return false;
  svg.setAttribute("viewBox", `0 0 ${W} ${H}`);
  svg.setAttribute("preserveAspectRatio", "none");
  const pts = points.map(([nx, ny]) => {
    const p = roiImgNormToBox(nx, ny, imgW, imgH, W, H, fit);
    return `${p.x.toFixed(1)},${p.y.toFixed(1)}`;
  }).join(" ");
  let poly = svg.querySelector("polygon.roi-shape");
  if (!poly) {
    poly = document.createElementNS("http://www.w3.org/2000/svg", "polygon");
    poly.setAttribute("class", "roi-shape");
    svg.appendChild(poly);
  }
  poly.setAttribute("points", pts);
  return true;
}

// Desenha uma imagem/video COBRINDO (cover) um quadro W x H, no ctx dado.
function drawImageCover(ctx, img, W, H) {
  const iw = img.naturalWidth || img.videoWidth || img.width;
  const ih = img.naturalHeight || img.videoHeight || img.height;
  if (!iw || !ih) return;
  const scale = Math.max(W / iw, H / ih);
  const sw = W / scale, sh = H / scale;
  ctx.drawImage(img, (iw - sw) / 2, (ih - sh) / 2, sw, sh, 0, 0, W, H);
}

// Assinatura de BORDAS dentro da mascara: magnitude do gradiente por pixel
// mascarado, em ordem raster, normalizada (media zero, norma 1). Como base e
// frame ao vivo usam a MESMA mascara, os vetores ficam alinhados p/ o NCC.
function roiEdgeSignature(data, W, H, mask) {
  const gray = new Float32Array(W * H);
  for (let p = 0, i = 0; p < W * H; p++, i += 4) {
    gray[p] = 0.299 * data[i] + 0.587 * data[i + 1] + 0.114 * data[i + 2];
  }
  const idx = [];
  for (let p = 0; p < W * H; p++) if (mask[p]) idx.push(p);
  const vals = new Float32Array(idx.length);
  for (let k = 0; k < idx.length; k++) {
    const p = idx[k], x = p % W, y = (p / W) | 0;
    const xm = x > 0 ? p - 1 : p, xp = x < W - 1 ? p + 1 : p;
    const ym = y > 0 ? p - W : p, yp = y < H - 1 ? p + W : p;
    vals[k] = Math.hypot(gray[xp] - gray[xm], gray[yp] - gray[ym]);
  }
  let mean = 0; for (let k = 0; k < vals.length; k++) mean += vals[k];
  mean /= (vals.length || 1);
  let ss = 0; for (let k = 0; k < vals.length; k++) { vals[k] -= mean; ss += vals[k] * vals[k]; }
  const norm = Math.sqrt(ss) || 1;
  for (let k = 0; k < vals.length; k++) vals[k] /= norm;
  return vals;
}

// Correlacao cruzada normalizada de duas assinaturas (ambas norma 1) -> [-1,1].
function roiNCC(a, b) {
  if (!a || !b || a.length !== b.length || !a.length) return 0;
  let s = 0; for (let k = 0; k < a.length; k++) s += a[k] * b[k];
  return s;
}

// Desenha VÁRIAS formas num overlay SVG (traço + contorno de IA, base/acomp.).
// shapes = [{points, color, dashed, fill}] em coords normalizadas da imagem.
function roiRenderSvgMulti(svg, shapes, imgW, imgH, fit) {
  if (!svg) return false;
  const W = svg.clientWidth, H = svg.clientHeight;
  while (svg.firstChild) svg.removeChild(svg.firstChild);
  if (!W || !H) return false;
  svg.setAttribute("viewBox", `0 0 ${W} ${H}`);
  svg.setAttribute("preserveAspectRatio", "none");
  let drew = false;
  for (const sh of (shapes || [])) {
    if (!sh || !sh.points || sh.points.length < 3) continue;
    const pts = sh.points.map(([nx, ny]) => {
      const p = roiImgNormToBox(nx, ny, imgW, imgH, W, H, fit);
      return `${p.x.toFixed(1)},${p.y.toFixed(1)}`;
    }).join(" ");
    const poly = document.createElementNS("http://www.w3.org/2000/svg", "polygon");
    poly.setAttribute("points", pts);
    poly.setAttribute("fill", sh.fill || "none");
    poly.setAttribute("stroke", sh.color || "#2ecc71");
    poly.setAttribute("stroke-width", "3");
    poly.setAttribute("stroke-linejoin", "round");
    if (sh.dashed) poly.setAttribute("stroke-dasharray", "6 5");
    poly.style.filter = "drop-shadow(0 0 2px rgba(0,0,0,0.65))";
    svg.appendChild(poly);
    drew = true;
  }
  return drew;
}

/* -------------------------------------------------------------------------
   Morfologia e contorno (locais deste modulo).
   ------------------------------------------------------------------------- */

function roiErode(mask, W, H, iters) {
  let m = mask;
  for (let it = 0; it < iters; it++) {
    const o = new Uint8Array(W * H);
    for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
      const p = y * W + x;
      if (!m[p]) continue;
      if (x > 0 && !m[p - 1]) continue;
      if (x < W - 1 && !m[p + 1]) continue;
      if (y > 0 && !m[p - W]) continue;
      if (y < H - 1 && !m[p + W]) continue;
      o[p] = 1;
    }
    m = o;
  }
  return m;
}

function roiDilate(mask, W, H, iters) {
  let m = mask;
  for (let it = 0; it < iters; it++) {
    const o = new Uint8Array(W * H);
    for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
      const p = y * W + x;
      if (m[p]) { o[p] = 1; continue; }
      if (x > 0 && m[p - 1]) { o[p] = 1; continue; }
      if (x < W - 1 && m[p + 1]) { o[p] = 1; continue; }
      if (y > 0 && m[p - W]) { o[p] = 1; continue; }
      if (y < H - 1 && m[p + W]) { o[p] = 1; continue; }
    }
    m = o;
  }
  return m;
}

// Seguidor de contorno (varredura radial): devolve os pixels da borda externa
// da maior mancha, em ordem. O resultado e simplificado depois.
function roiTraceContour(mask, W, H) {
  const inside = (x, y) => x >= 0 && y >= 0 && x < W && y < H && mask[y * W + x];
  let sx = -1, sy = -1;
  for (let y = 0; y < H && sy < 0; y++) for (let x = 0; x < W; x++) {
    if (mask[y * W + x]) { sx = x; sy = y; break; }
  }
  if (sx < 0) return [];
  // 8 direcoes no sentido horario, comecando no Leste.
  const dirs = [[1, 0], [1, 1], [0, 1], [-1, 1], [-1, 0], [-1, -1], [0, -1], [1, -1]];
  const contour = [];
  let px = sx, py = sy, dir = 6;
  const maxSteps = W * H * 4;
  for (let step = 0; step < maxSteps; step++) {
    contour.push([px, py]);
    let found = false;
    for (let k = 0; k < 8; k++) {
      const d = (dir + k) % 8;
      const nx = px + dirs[d][0], ny = py + dirs[d][1];
      if (inside(nx, ny)) {
        px = nx; py = ny;
        dir = (d + 6) % 8;   // vira p/ continuar colado na borda
        found = true;
        break;
      }
    }
    if (!found) break;                                   // pixel isolado
    if (px === sx && py === sy && contour.length > 2) break;  // fechou o laco
  }
  return contour;
}

// Douglas-Peucker: simplifica a polilinha mantendo o formato (eps em px).
function roiSimplify(pts, eps) {
  if (pts.length < 3) return pts.slice();
  const keep = new Uint8Array(pts.length);
  keep[0] = 1; keep[pts.length - 1] = 1;
  const stack = [[0, pts.length - 1]];
  while (stack.length) {
    const seg = stack.pop(), a = seg[0], b = seg[1];
    const ax = pts[a][0], ay = pts[a][1], bx = pts[b][0], by = pts[b][1];
    const dx = bx - ax, dy = by - ay, len = Math.hypot(dx, dy) || 1;
    let maxD = 0, idx = -1;
    for (let i = a + 1; i < b; i++) {
      const d = Math.abs((pts[i][0] - ax) * dy - (pts[i][1] - ay) * dx) / len;
      if (d > maxD) { maxD = d; idx = i; }
    }
    if (maxD > eps && idx > 0) { keep[idx] = 1; stack.push([a, idx]); stack.push([idx, b]); }
  }
  const out = [];
  for (let i = 0; i < pts.length; i++) if (keep[i]) out.push(pts[i]);
  return out;
}

function roiMaskArea(mask) {
  let a = 0; for (let i = 0; i < mask.length; i++) a += mask[i]; return a;
}

const roiClamp01 = (v) => Math.min(1, Math.max(0, v));

// Suaviza um poligono FECHADO por corte de cantos (Chaikin) — arredonda cantos.
function roiSmoothPolygon(pts, iters) {
  let out = pts;
  for (let k = 0; k < iters; k++) {
    const n = out.length; if (n < 4) break;
    const next = [];
    for (let i = 0; i < n; i++) {
      const a = out[i], b = out[(i + 1) % n];
      next.push([a[0] * 0.75 + b[0] * 0.25, a[1] * 0.75 + b[1] * 0.25]);
      next.push([a[0] * 0.25 + b[0] * 0.75, a[1] * 0.25 + b[1] * 0.75]);
    }
    out = next;
  }
  return out;
}

// Media movel sobre poligono FECHADO (mantem a quantidade de pontos): tira o
// tremor do traco/snap sem inflar o numero de vertices.
function roiSmoothMA(pts, iters) {
  let out = pts;
  for (let k = 0; k < iters; k++) {
    const n = out.length; if (n < 3) break;
    const nx = [];
    for (let i = 0; i < n; i++) {
      const a = out[(i - 1 + n) % n], b = out[i], c = out[(i + 1) % n];
      nx.push([(a[0] + 2 * b[0] + c[0]) / 4, (a[1] + 2 * b[1] + c[1]) / 4]);
    }
    out = nx;
  }
  return out;
}

// Reamostra um poligono FECHADO por comprimento de arco (passo em px).
function roiResampleClosed(pts, step) {
  const n = pts.length;
  if (n < 2) return pts.slice();
  const out = [pts[0].slice()];
  let prev = pts[0], acc = 0;
  for (let i = 1; i <= n; i++) {
    let cur = pts[i % n];
    let seg = Math.hypot(cur[0] - prev[0], cur[1] - prev[1]);
    while (acc + seg >= step && seg > 1e-6) {
      const t = (step - acc) / seg;
      const np = [prev[0] + (cur[0] - prev[0]) * t, prev[1] + (cur[1] - prev[1]) * t];
      out.push(np);
      prev = np; seg = Math.hypot(cur[0] - prev[0], cur[1] - prev[1]); acc = 0;
    }
    acc += seg; prev = cur;
  }
  return out;
}

// Traço do usuario apenas SUAVIZADO e fiel (nao muda o tamanho). Usado como
// fallback e como base quando a borda nao e clara. rawPts = img-normalizado.
function roiSmoothNorm(rawPts) {
  const px = rawPts.map(([nx, ny]) => [roiClamp01(nx) * 1000, roiClamp01(ny) * 1000]);
  const sm = roiSmoothMA(px, 2);
  const diag = Math.hypot(1000, 1000);
  let simp = roiSmoothPolygon(roiSimplify(sm, diag * 0.006), 1);
  if (simp.length < 3) simp = sm;
  return simp.map(([x, y]) => [roiClamp01(x / 1000), roiClamp01(y / 1000)]);
}

// Fecho morfologico (dilata->erode): tapa reentrancias/vãos finos.
function roiMaskClose(mask, W, H, r) { return roiErode(roiDilate(mask, W, H, r), W, H, r); }
// Abertura (erode->dilata): remove protuberancias/ruido fino.
function roiMaskOpen(mask, W, H, r) { return roiDilate(roiErode(mask, W, H, r), W, H, r); }

// Borrão 3x3 repetido (alarga as "bacias" das bordas p/ o contorno ser atraído
// de alguns pixels de distância).
function roiBoxBlur(arr, W, H, iters) {
  let a = arr;
  for (let k = 0; k < iters; k++) {
    const o = new Float32Array(W * H);
    for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
      let s = 0, cnt = 0;
      for (let dy = -1; dy <= 1; dy++) { const yy = y + dy; if (yy < 0 || yy >= H) continue;
        for (let dx = -1; dx <= 1; dx++) { const xx = x + dx; if (xx < 0 || xx >= W) continue; s += a[yy * W + xx]; cnt++; } }
      o[y * W + x] = s / cnt;
    }
    a = o;
  }
  return a;
}

/* -------------------------------------------------------------------------
   Refino inteligente do contorno ("IA") — v7.5.6: encontra o contorno da parte
   do corpo DENTRO da area marcada por uma "CINTA QUE ENCOLHE" (active contour
   deflacionario). Cor sozinha falha quando o fundo (piso bege, maca clara) tem
   cor parecida com a pele; a pista confiavel e a BORDA. O laço do usuario
   ENCOLHE para dentro (pressao) e TRAVA nas bordas fortes (perna x fundo), com
   suavidade — achando o perfil real do membro sem depender de cor. So encolhe
   (nunca cresce p/ dentro do fundo). Devolve { points, ok }.
   ------------------------------------------------------------------------- */
function roiSmartContour(imgEl, rawPts) {
  const iw = imgEl.naturalWidth || imgEl.width;
  const ih = imgEl.naturalHeight || imgEl.height;
  const fallback = { points: roiSmoothNorm(rawPts), ok: false };
  if (!iw || !ih || !rawPts || rawPts.length < 3) return fallback;

  const scale = Math.min(1, 360 / Math.max(iw, ih));
  const W = Math.max(8, Math.round(iw * scale));
  const H = Math.max(8, Math.round(ih * scale));
  const c = document.createElement("canvas");
  c.width = W; c.height = H;
  const ctx = c.getContext("2d", { willReadFrequently: true });
  ctx.drawImage(imgEl, 0, 0, W, H);
  const data = ctx.getImageData(0, 0, W, H).data;

  // BORRA a imagem (canais RGB) ANTES de achar a borda — suprime a TEXTURA/ruído
  // (pelos, azulejos, grão da pele) e preserva a borda COERENTE da perna. Sem
  // isso, o ruído por pixel afoga o contorno do membro (como no Canny). O
  // gradiente é em COR, p/ pegar a borda mesmo quando a luma é parecida (pele x
  // piso bege) mas a croma difere.
  const NN = W * H;
  const R = new Float32Array(NN), G = new Float32Array(NN), B = new Float32Array(NN);
  for (let p = 0; p < NN; p++) { R[p] = data[p * 4]; G[p] = data[p * 4 + 1]; B[p] = data[p * 4 + 2]; }
  const Rb = roiBoxBlur(R, W, H, 3), Gb = roiBoxBlur(G, W, H, 3), Bb = roiBoxBlur(B, W, H, 3);
  const grad = new Float32Array(NN);
  let gs = 0, gs2 = 0;
  for (let y = 1; y < H - 1; y++) for (let x = 1; x < W - 1; x++) {
    const p = y * W + x;
    const gx = Math.hypot(Rb[p + 1] - Rb[p - 1], Gb[p + 1] - Gb[p - 1], Bb[p + 1] - Bb[p - 1]);
    const gy = Math.hypot(Rb[p + W] - Rb[p - W], Gb[p + W] - Gb[p - W], Bb[p + W] - Bb[p - W]);
    const g = Math.hypot(gx, gy);
    grad[p] = g; gs += g; gs2 += g * g;
  }
  const gn = Math.max(1, (W - 2) * (H - 2));
  const gmean = gs / gn, gstd = Math.sqrt(Math.max(0, gs2 / gn - gmean * gmean));
  const gScale = gmean + 2.5 * gstd || 1;
  let gnorm = new Float32Array(W * H);
  for (let p = 0; p < W * H; p++) gnorm[p] = Math.min(1, grad[p] / gScale);
  gnorm = roiBoxBlur(gnorm, W, H, 1);   // leve, p/ alargar a bacia da borda
  const gAt = (x, y) => { x = Math.round(x); y = Math.round(y); return (x < 0 || y < 0 || x >= W || y >= H) ? 0 : gnorm[y * W + x]; };

  // Traço em px + centróide + área.
  const px = rawPts.map(([nx, ny]) => [nx * W, ny * H]);
  let cx = 0, cy = 0; for (const q of px) { cx += q[0]; cy += q[1]; } cx /= px.length; cy /= px.length;
  let areaPx = 0; for (let i = 0; i < px.length; i++) { const a = px[i], b = px[(i + 1) % px.length]; areaPx += a[0] * b[1] - b[0] * a[1]; }
  areaPx = Math.abs(areaPx) / 2;
  if (areaPx < 60) return fallback;
  const eqR = Math.sqrt(areaPx / Math.PI);
  const polyAreaN = areaPx;

  let P = roiResampleClosed(px, Math.max(2, (2 * Math.PI * eqR) / 130));
  let n = P.length;
  if (n < 8) return fallback;

  // Cinta que encolhe: cada ponto procura, na NORMAL, entre encolher (pressão) e
  // travar na borda; a suavidade impede serrilhado e trechos sem borda seguem os
  // vizinhos. gamma=atração p/ borda (ao QUADRADO — só bordas FORTES/coerentes do
  // corpo prendem; textura fraca é ignorada), alpha=suavidade, beta=pressão.
  const gamma = 1.2, alpha = 0.30, beta = 0.24;
  const area = (Q) => { let A = 0; for (let i = 0; i < Q.length; i++) { const a = Q[i], b = Q[(i + 1) % Q.length]; A += a[0] * b[1] - b[0] * a[1]; } return Math.abs(A) / 2; };
  for (let iter = 0; iter < 110; iter++) {
    const cen = { x: 0, y: 0 }; for (const q of P) { cen.x += q[0]; cen.y += q[1]; } cen.x /= P.length; cen.y /= P.length;
    for (let i = 0; i < n; i++) {
      const p = P[i], a = P[(i - 1 + n) % n], b = P[(i + 1) % n];
      let tx = b[0] - a[0], ty = b[1] - a[1]; const tl = Math.hypot(tx, ty) || 1; tx /= tl; ty /= tl;
      let nox = ty, noy = -tx;                                   // normal p/ fora
      if ((p[0] - cen.x) * nox + (p[1] - cen.y) * noy < 0) { nox = -nox; noy = -noy; }
      const midx = (a[0] + b[0]) / 2, midy = (a[1] + b[1]) / 2;
      let best = p, bestE = Infinity;
      for (let d = -2; d <= 2; d++) {                            // move só na normal
        const qx = p[0] + nox * d, qy = p[1] + noy * d;
        const ge = gAt(qx, qy);
        const smooth = (Math.hypot(qx - midx, qy - midy)) / eqR;
        const E = -gamma * ge * ge + alpha * smooth + beta * (d / 2); // d<0 = encolher
        if (E < bestE) { bestE = E; best = [qx, qy]; }
      }
      P[i] = best;
    }
    if (iter % 6 === 5) P = roiSmoothMA(P, 1);
  }

  const a2 = area(P);
  // Colapsou, ou quase não encolheu (não achou a perna / laço já justo): usa o traço.
  if (a2 < polyAreaN * 0.12 || a2 > polyAreaN * 0.97) return fallback;

  const diag = Math.hypot(W, H);
  let simp = roiSmoothPolygon(roiSimplify(roiSmoothMA(P, 2), diag * 0.008), 1);
  if (simp.length < 3) return fallback;
  const points = simp.map(([x, y]) => [roiClamp01(x / W), roiClamp01(y / H)]);
  return { points, ok: true };
}

// Normaliza/limita um laco bruto (fallback quando a IA nao ajuda).
function roiNormalizeLoop(rawPts, iw, ih) {
  const clamped = rawPts.map(([nx, ny]) => [
    Math.min(1, Math.max(0, nx)), Math.min(1, Math.max(0, ny)),
  ]);
  const diag = Math.hypot(iw || 1000, ih || 1000);
  const pxPts = clamped.map(([nx, ny]) => [nx * (iw || 1000), ny * (ih || 1000)]);
  const simp = roiSimplify(pxPts, diag * 0.005);
  return simp.map(([x, y]) => [x / (iw || 1000), y / (ih || 1000)]);
}

/* =========================================================================
   Editor da tela de Zona de Interesse (#screen-roi).
   ========================================================================= */
const Roi = {
  session: null,
  which: "base",      // "base" | "follow"
  field: "roi",       // "roi" | "followRoi"
  baseImg: null,      // Image element da foto sendo marcada
  imgW: 3, imgH: 4,
  rawPts: null,       // traco bruto do usuario (img-normalizado)
  smartPts: null,     // contorno refinado pela IA
  showRaw: false,     // mostrar/usar o traco bruto
  showSmart: true,    // mostrar/usar o contorno da IA
  drawing: false,
  _path: null,        // path em px do desenho atual

  async open(session, which) {
    this.session = session;
    this.which = which === "follow" ? "follow" : "base";
    this.field = this.which === "follow" ? "followRoi" : "roi";
    const imgSrc = this.which === "follow" ? session.followImage : session.baseImage;
    this.rawPts = null; this.smartPts = null;
    this.showRaw = false; this.showSmart = true;
    this.drawing = false;
    try {
      this.baseImg = await loadImageEl(imgSrc);
      this.imgW = this.baseImg.naturalWidth || 3;
      this.imgH = this.baseImg.naturalHeight || 4;
    } catch (_) { this.baseImg = null; this.imgW = 3; this.imgH = 4; }
    $("#roi-img").src = imgSrc;
    $("#screen-roi").querySelector("h1").textContent =
      this.which === "follow" ? "Zona — Acompanhamento" : "Zona — Base";
    // Se ja existe ROI nesta foto, carrega o traço e o contorno da IA salvos
    // (guardados separados desde v7.5.4) para mostrar os dois toggles.
    const cur = session[this.field];
    if (cur && cur.points && cur.points.length >= 3) {
      this.smartPts = (cur.ai && cur.ai.length >= 3) ? cur.ai.slice() : cur.points.slice();
      // Zonas antigas (só .points) usam o próprio contorno como "meu traço", p/ o
      // card de toggles aparecer sempre que já houver zona definida.
      this.rawPts = (cur.raw && cur.raw.length >= 3) ? cur.raw.slice() : cur.points.slice();
      this.showSmart = cur.showAi != null ? !!cur.showAi : true;
      this.showRaw = cur.showRaw != null ? !!cur.showRaw : false;
    }
    showScreen("screen-roi");
    requestAnimationFrame(() => { this.layout(); this.redraw(); this.updateUI(); });
    this._showHelp();
  },

  // Popup de instruções ao abrir a tela (respeita "Não mostrar novamente").
  _showHelp() {
    if (localStorage.getItem("cc_roi_help_ack") === "1") return;
    const dlg = $("#roi-help-dialog");
    if (!dlg) return;
    try { dlg.showModal ? dlg.showModal() : dlg.setAttribute("open", ""); } catch (_) {}
  },

  // Dimensiona o canvas de desenho ao tamanho exibido da imagem (contain).
  layout() {
    const wrap = $("#roi-stage");
    const cv = $("#roi-canvas");
    const W = wrap.clientWidth, H = wrap.clientHeight;
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    cv.width = Math.round(W * dpr);
    cv.height = Math.round(H * dpr);
    cv.style.width = W + "px";
    cv.style.height = H + "px";
    const ctx = cv.getContext("2d");
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    this._boxW = W; this._boxH = H;
  },

  // Converte evento de ponteiro -> ponto img-normalizado (fit contain).
  _evToNorm(e) {
    const cv = $("#roi-canvas");
    const r = cv.getBoundingClientRect();
    const x = (e.clientX != null ? e.clientX : e.touches[0].clientX) - r.left;
    const y = (e.clientY != null ? e.clientY : e.touches[0].clientY) - r.top;
    return roiBoxToImgNorm(x, y, this.imgW, this.imgH, this._boxW, this._boxH, "contain");
  },

  startDraw(e) {
    this.drawing = true;
    this._path = [];
    const n = this._evToNorm(e);
    this._path.push([n.nx, n.ny]);
    this.smartPts = null;   // recomeca
    this.redraw();
  },
  moveDraw(e) {
    if (!this.drawing) return;
    // Captura os eventos INTERMEDIÁRIOS (coalesced) — em desenho rápido o iOS
    // junta vários movimentos num só evento; sem isso o traço "corta os cantos"
    // e fica menor do que o dedo desenhou.
    let evs = [e];
    try { const co = e.getCoalescedEvents && e.getCoalescedEvents(); if (co && co.length) evs = co; } catch (_) {}
    let changed = false;
    for (const ev of evs) {
      const n = this._evToNorm(ev);
      const last = this._path[this._path.length - 1];
      if (!last || Math.hypot(n.nx - last[0], n.ny - last[1]) > 0.0025) {
        this._path.push([n.nx, n.ny]); changed = true;
      }
    }
    if (changed) this.redraw();
  },
  endDraw(e) {
    if (!this.drawing) return;
    this.drawing = false;
    // Inclui o ponto exato onde o dedo levantou (evita o traço fechar "menor").
    if (e && this._path) {
      const n = this._evToNorm(e);
      const last = this._path[this._path.length - 1];
      if (!last || Math.hypot(n.nx - last[0], n.ny - last[1]) > 0.001) this._path.push([n.nx, n.ny]);
    }
    if (!this._path || this._path.length < 6) { this._path = null; this.redraw(); return; }
    this.rawPts = this._path.slice();
    this._path = null;
    // Refino inteligente (visao computacional).
    if (this.baseImg) {
      try {
        const res = roiSmartContour(this.baseImg, this.rawPts);
        this.smartPts = res.points;
      } catch (_) {
        this.smartPts = roiNormalizeLoop(this.rawPts, this.imgW, this.imgH);
      }
    } else {
      this.smartPts = roiNormalizeLoop(this.rawPts, this.imgW, this.imgH);
    }
    // Ao desenhar de novo, mostra o contorno da IA por padrao.
    this.showSmart = true; this.showRaw = false;
    this.redraw();
    this.updateUI();
  },

  // Contorno que sera SALVO: a IA quando visivel; senao o meu traco.
  currentPts() {
    if (this.showSmart && this.smartPts) return this.smartPts;
    if (this.showRaw && this.rawPts) return roiNormalizeLoop(this.rawPts, this.imgW, this.imgH);
    return this.smartPts || (this.rawPts ? roiNormalizeLoop(this.rawPts, this.imgW, this.imgH) : null);
  },

  _strokePath(ctx, pts, toBox, close) {
    ctx.beginPath();
    pts.forEach(([nx, ny], i) => {
      const p = toBox(nx, ny);
      i ? ctx.lineTo(p.x, p.y) : ctx.moveTo(p.x, p.y);
    });
    if (close) ctx.closePath();
  },

  redraw() {
    const cv = $("#roi-canvas");
    if (!cv) return;
    const ctx = cv.getContext("2d");
    ctx.clearRect(0, 0, this._boxW, this._boxH);
    const toBox = (nx, ny) => roiImgNormToBox(nx, ny, this.imgW, this.imgH, this._boxW, this._boxH, "contain");

    // Traco ao vivo (amarelo) enquanto desenha.
    if (this.drawing && this._path && this._path.length > 1) {
      this._strokePath(ctx, this._path, toBox, false);
      ctx.strokeStyle = "#ffd21e";
      ctx.lineWidth = 3; ctx.lineJoin = "round"; ctx.lineCap = "round";
      ctx.stroke();
      return;
    }

    // Meu traço (amarelo tracejado) quando ligado.
    if (this.showRaw && this.rawPts && this.rawPts.length >= 3) {
      this._strokePath(ctx, this.rawPts, toBox, true);
      ctx.setLineDash([6, 5]);
      ctx.strokeStyle = "#ffd21e";
      ctx.lineWidth = 2.5; ctx.lineJoin = "round";
      ctx.stroke();
      ctx.setLineDash([]);
    }
    // Contorno da IA (verde com preenchimento leve) quando ligado.
    if (this.showSmart && this.smartPts && this.smartPts.length >= 3) {
      this._strokePath(ctx, this.smartPts, toBox, true);
      ctx.fillStyle = "rgba(46,204,113,0.18)";
      ctx.fill();
      ctx.strokeStyle = "#2ecc71";
      ctx.lineWidth = 3; ctx.lineJoin = "round";
      ctx.stroke();
    }
  },

  updateUI() {
    const has = !!(this.smartPts || this.rawPts);
    $("#roi-redo").hidden = !has;
    // Toggles só aparecem quando há AS DUAS opções (após desenhar nesta sessão).
    const bothExist = !!(this.smartPts && this.rawPts);
    $("#roi-toggles").hidden = !bothExist;
    $("#roi-show-raw").checked = this.showRaw;
    $("#roi-show-ai").checked = this.showSmart;
    $("#roi-remove").hidden = !(this.session && this.session[this.field]);
    $("#roi-hint").textContent = has
      ? "Ajuste o que mostrar e toque Confirmar."
      : "Contorne a região de interesse com o dedo. A IA vai refinar o traçado.";
  },

  setShow(rawOn, aiOn) {
    if (rawOn != null) this.showRaw = rawOn;
    if (aiOn != null) this.showSmart = aiOn;
    this.redraw();
    this.updateUI();
  },
  redoDraw() {
    this.rawPts = null; this.smartPts = null; this._path = null; this.drawing = false;
    this.showRaw = false; this.showSmart = true;
    this.redraw();
    this.updateUI();
  },

  // Remove a zona salva e LIMPA o traço, mas PERMANECE na tela (o usuário fica
  // livre p/ desenhar de novo; sai só pelo ‹ ou Confirmar).
  async remove() {
    const s = this.session;
    if (s) { delete s[this.field]; await DB.put(s); }
    this.redoDraw();
  },
  async save() {
    const s = this.session;
    const pts = this.currentPts();
    if (pts && pts.length >= 3) {
      s[this.field] = {
        points: pts,
        raw: this.rawPts ? roiNormalizeLoop(this.rawPts, this.imgW, this.imgH) : null,
        ai: this.smartPts || null,
        showRaw: this.showRaw,
        showAi: this.showSmart,
      };
    }
    await DB.put(s);
    await openDetail(s.id);
  },
  async cancel() {
    await openDetail(this.session.id);
  },
};

/* ---------- Controles da tela de ROI ---------- */
window.addEventListener("DOMContentLoaded", () => {
  const cv = $("#roi-canvas");
  if (!cv) return;

  const down = (e) => { e.preventDefault(); Roi.startDraw(e); };
  const move = (e) => { if (Roi.drawing) { e.preventDefault(); Roi.moveDraw(e); } };
  const up = (e) => { if (Roi.drawing) { e.preventDefault(); Roi.endDraw(e); } };

  // Ponteiro (mouse + touch unificados). touch-action:none no CSS evita scroll.
  cv.addEventListener("pointerdown", (e) => { try { cv.setPointerCapture(e.pointerId); } catch (_) {} down(e); });
  cv.addEventListener("pointermove", move);
  cv.addEventListener("pointerup", up);
  cv.addEventListener("pointercancel", up);

  $("#roi-cancel").addEventListener("click", () => Roi.cancel());
  $("#roi-save").addEventListener("click", () => Roi.save());
  $("#roi-redo").addEventListener("click", () => Roi.redoDraw());
  $("#roi-remove").addEventListener("click", () => Roi.remove());
  $("#roi-show-raw").addEventListener("change", (e) => Roi.setShow(e.target.checked, null));
  $("#roi-show-ai").addEventListener("change", (e) => Roi.setShow(null, e.target.checked));

  // Popup de instruções: fechar (e "não mostrar novamente").
  const helpClose = () => {
    if ($("#roi-help-nomore") && $("#roi-help-nomore").checked) localStorage.setItem("cc_roi_help_ack", "1");
    try { $("#roi-help-dialog").close(); } catch (_) { $("#roi-help-dialog").removeAttribute("open"); }
  };
  if ($("#roi-help-ok")) $("#roi-help-ok").addEventListener("click", helpClose);

  window.addEventListener("resize", () => {
    if ($("#screen-roi").classList.contains("active")) { Roi.layout(); Roi.redraw(); }
  });
});
