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

/* -------------------------------------------------------------------------
   Refino inteligente do contorno ("IA"): segmentacao local por modelos de
   cor (histogramas), maior componente conexa e preenchimento de buracos.
   Recebe o Image element da base e o traco bruto (pontos img-normalizados).
   Devolve { points, ok }.
   ------------------------------------------------------------------------- */
function roiSmartContour(imgEl, rawPts) {
  const iw = imgEl.naturalWidth || imgEl.width;
  const ih = imgEl.naturalHeight || imgEl.height;
  const fallback = { points: roiNormalizeLoop(rawPts, iw, ih), ok: false };
  if (!iw || !ih || !rawPts || rawPts.length < 3) return fallback;

  const scale = Math.min(1, 340 / Math.max(iw, ih));
  const W = Math.max(8, Math.round(iw * scale));
  const H = Math.max(8, Math.round(ih * scale));

  const c = document.createElement("canvas");
  c.width = W; c.height = H;
  const ctx = c.getContext("2d", { willReadFrequently: true });
  ctx.drawImage(imgEl, 0, 0, W, H);
  const data = ctx.getImageData(0, 0, W, H).data;

  const poly = roiPolygonMask(rawPts, W, H);
  const polyArea = roiMaskArea(poly);
  if (polyArea < 30) return fallback;

  let band = Math.max(3, Math.round(Math.min(W, H) * 0.05));
  let fgSeed = roiErode(poly, W, H, band);
  // Se o laco for fino, o erode zera as sementes: reduz a banda ate ter FG.
  while (roiMaskArea(fgSeed) < 20 && band > 1) { band--; fgSeed = roiErode(poly, W, H, band); }
  if (roiMaskArea(fgSeed) < 12) return fallback;
  const outside = roiDilate(poly, W, H, band);      // dentro+borda externa
  const bgSeed = new Uint8Array(W * H);
  for (let p = 0; p < W * H; p++) bgSeed[p] = outside[p] ? 0 : 1;

  // Histogramas de cor (4 bits/canal -> 4096 bins), com suavizacao (Laplace).
  const BINS = 4096;
  const fgH = new Float32Array(BINS).fill(1);
  const bgH = new Float32Array(BINS).fill(1);
  let fgN = BINS, bgN = BINS;
  const qidx = (i) => ((data[i] >> 4) << 8) | ((data[i + 1] >> 4) << 4) | (data[i + 2] >> 4);
  for (let p = 0, i = 0; p < W * H; p++, i += 4) {
    if (fgSeed[p]) { fgH[qidx(i)]++; fgN++; }
    else if (bgSeed[p]) { bgH[qidx(i)]++; bgN++; }
  }

  // Classifica os pixels DENTRO da regiao dilatada; fora = fundo.
  const seg = new Uint8Array(W * H);
  for (let p = 0, i = 0; p < W * H; p++, i += 4) {
    if (fgSeed[p]) { seg[p] = 1; continue; }
    if (!outside[p]) continue;
    const q = qidx(i);
    const pf = fgH[q] / fgN, pb = bgH[q] / bgN;
    if (pf >= pb) seg[p] = 1;
  }

  const comp = alLargestComponent(seg, W, H);        // reusa align.js
  const filled = alFillHoles(comp.mask, W, H);       // reusa align.js
  const area = roiMaskArea(filled);
  // Se a segmentacao "estourou" ou sumiu, usa o traco bruto.
  if (area < polyArea * 0.12 || area > polyArea * 3.5) return fallback;

  const raw = roiTraceContour(filled, W, H);
  if (raw.length < 6) return fallback;
  const diag = Math.hypot(W, H);
  let simp = roiSimplify(raw, diag * 0.006);
  // Limita a quantidade de pontos aumentando o eps se preciso.
  let eps = diag * 0.006;
  while (simp.length > 60 && eps < diag * 0.05) { eps *= 1.4; simp = roiSimplify(raw, eps); }
  if (simp.length < 3) return fallback;

  const points = simp.map(([x, y]) => [
    Math.min(1, Math.max(0, x / W)),
    Math.min(1, Math.max(0, y / H)),
  ]);
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
  baseImg: null,
  imgW: 3, imgH: 4,
  rawPts: null,       // traco bruto (img-normalizado)
  smartPts: null,     // contorno refinado pela IA
  useSmart: true,     // qual mostrar/salvar
  drawing: false,
  _path: null,        // path em px do desenho atual

  async open(session) {
    this.session = session;
    this.rawPts = null; this.smartPts = null; this.useSmart = true;
    this.drawing = false;
    try {
      this.baseImg = await loadImageEl(session.baseImage);
      this.imgW = this.baseImg.naturalWidth || 3;
      this.imgH = this.baseImg.naturalHeight || 4;
    } catch (_) { this.baseImg = null; this.imgW = 3; this.imgH = 4; }
    $("#roi-img").src = session.baseImage;
    // Se ja existe ROI, mostra como ponto de partida (contorno atual).
    if (session.roi && session.roi.points && session.roi.points.length >= 3) {
      this.smartPts = session.roi.points.slice();
      this.rawPts = session.roi.points.slice();
    }
    showScreen("screen-roi");
    requestAnimationFrame(() => { this.layout(); this.redraw(); this.updateUI(); });
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
    const n = this._evToNorm(e);
    const last = this._path[this._path.length - 1];
    // Evita pontos redundantes (economiza processamento).
    if (!last || Math.hypot(n.nx - last[0], n.ny - last[1]) > 0.004) {
      this._path.push([n.nx, n.ny]);
      this.redraw();
    }
  },
  endDraw() {
    if (!this.drawing) return;
    this.drawing = false;
    if (!this._path || this._path.length < 6) { this._path = null; this.redraw(); return; }
    this.rawPts = this._path.slice();
    this._path = null;
    // Refino inteligente (visao computacional).
    if (this.baseImg) {
      try {
        const res = roiSmartContour(this.baseImg, this.rawPts);
        this.smartPts = res.points;
        this.useSmart = true;
      } catch (_) {
        this.smartPts = roiNormalizeLoop(this.rawPts, this.imgW, this.imgH);
        this.useSmart = false;
      }
    } else {
      this.smartPts = roiNormalizeLoop(this.rawPts, this.imgW, this.imgH);
    }
    this.redraw();
    this.updateUI();
  },

  currentPts() {
    if (this.useSmart && this.smartPts) return this.smartPts;
    if (this.rawPts) return roiNormalizeLoop(this.rawPts, this.imgW, this.imgH);
    return this.smartPts;
  },

  redraw() {
    const cv = $("#roi-canvas");
    if (!cv) return;
    const ctx = cv.getContext("2d");
    ctx.clearRect(0, 0, this._boxW, this._boxH);
    const toBox = (nx, ny) => roiImgNormToBox(nx, ny, this.imgW, this.imgH, this._boxW, this._boxH, "contain");

    // Traco ao vivo (amarelo) enquanto desenha.
    if (this.drawing && this._path && this._path.length > 1) {
      ctx.beginPath();
      this._path.forEach(([nx, ny], i) => {
        const p = toBox(nx, ny);
        i ? ctx.lineTo(p.x, p.y) : ctx.moveTo(p.x, p.y);
      });
      ctx.strokeStyle = "#ffd21e";
      ctx.lineWidth = 3; ctx.lineJoin = "round"; ctx.lineCap = "round";
      ctx.stroke();
      return;
    }

    // Contorno definitivo (verde), com preenchimento leve.
    const pts = this.currentPts();
    if (pts && pts.length >= 3) {
      ctx.beginPath();
      pts.forEach(([nx, ny], i) => {
        const p = toBox(nx, ny);
        i ? ctx.lineTo(p.x, p.y) : ctx.moveTo(p.x, p.y);
      });
      ctx.closePath();
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
    const t = $("#roi-toggle");
    t.hidden = !(this.smartPts && this.rawPts);
    t.textContent = this.useSmart ? "Usar meu traço" : "Usar contorno da IA";
    $("#roi-remove").hidden = !(this.session && this.session.roi);
    $("#roi-hint").textContent = has
      ? "Contorno em verde. Toque ✓ para salvar."
      : "Contorne a região de interesse com o dedo. A IA vai refinar o traçado.";
  },

  toggleSource() {
    this.useSmart = !this.useSmart;
    this.redraw();
    this.updateUI();
  },
  redoDraw() {
    this.rawPts = null; this.smartPts = null; this._path = null; this.drawing = false;
    this.redraw();
    this.updateUI();
  },

  async remove() {
    const s = this.session;
    if (s) { delete s.roi; await DB.put(s); }
    await openDetail(s.id);
  },
  async save() {
    const s = this.session;
    const pts = this.currentPts();
    if (pts && pts.length >= 3) s.roi = { points: pts };
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
  const up = (e) => { if (Roi.drawing) { e.preventDefault(); Roi.endDraw(); } };

  // Ponteiro (mouse + touch unificados). touch-action:none no CSS evita scroll.
  cv.addEventListener("pointerdown", (e) => { try { cv.setPointerCapture(e.pointerId); } catch (_) {} down(e); });
  cv.addEventListener("pointermove", move);
  cv.addEventListener("pointerup", up);
  cv.addEventListener("pointercancel", up);

  $("#roi-cancel").addEventListener("click", () => Roi.cancel());
  $("#roi-save").addEventListener("click", () => Roi.save());
  $("#roi-redo").addEventListener("click", () => Roi.redoDraw());
  $("#roi-toggle").addEventListener("click", () => Roi.toggleSource());
  $("#roi-remove").addEventListener("click", () => Roi.remove());

  window.addEventListener("resize", () => {
    if ($("#screen-roi").classList.contains("active")) { Roi.layout(); Roi.redraw(); }
  });
});
