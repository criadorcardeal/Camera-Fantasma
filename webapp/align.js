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

const Aligner = {
  session: null,
  followUrl: null,
  z: 1, tx: 0, ty: 0, rot: 0,
  baseW: 1, baseH: 1,

  // isReposition=true quando é só reajuste/reposicionamento de uma foto já
  // adquirida (NÃO pede rótulo na saída — o rótulo só é pedido ao ADQUIRIR).
  async open(session, followUrl, isReposition) {
    this.session = session;
    this.followUrl = followUrl;
    this.isReposition = !!isReposition;
    this.z = 1; this.tx = 0; this.ty = 0; this.rot = 0;
    $("#al-zoom").value = 1;
    $("#al-rotate").value = 0;
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
    // Estado dos toggles de zona (mostrar zona da base / do acompanhamento).
    this.roiShowBase = true;
    this.roiShowFollow = true;
    this._setupRoiCardUI();
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
    this.renderRois();
  },

  // Card "Zonas de interesse": aparece se alguma foto tem zona; o toggle do
  // acompanhamento só vale na reposição (a followRoi pertence à foto já salva).
  _setupRoiCardUI() {
    const s = this.session, card = $("#al-roi-card");
    if (!card) return;
    const baseHas = !!(s.roi && s.roi.points && s.roi.points.length >= 3);
    const followHas = this.isReposition && !!(s.followRoi && s.followRoi.points && s.followRoi.points.length >= 3);
    if (!baseHas && !followHas) { card.setAttribute("hidden", ""); return; }
    card.removeAttribute("hidden");
    const cbBase = $("#al-roi-base"), cbFol = $("#al-roi-follow");
    cbBase.disabled = !baseHas; cbBase.checked = baseHas && this.roiShowBase;
    cbFol.disabled = !followHas; cbFol.checked = followHas && this.roiShowFollow;
  },

  // Zonas das DUAS fotos: base fixa (verde) + acompanhamento (ciano) que se move
  // junto com a foto (mesma transformação), p/ o médico encaixar uma na outra.
  renderRois() {
    if (typeof roiRenderSvgMulti !== "function") return;
    const s = this.session;
    const baseSvg = $("#al-roi");
    const bOk = this.roiShowBase && s.roi && s.roi.points && s.roi.points.length >= 3;
    if (bOk) { baseSvg.removeAttribute("hidden"); roiRenderSvgMulti(baseSvg, [{ points: s.roi.points, color: "#2ecc71", fill: "rgba(46,204,113,0.15)" }], this.baseW, this.baseH, "cover"); }
    else { baseSvg.setAttribute("hidden", ""); }

    const folSvg = $("#al-roi-follow");
    const fOk = this.isReposition && this.roiShowFollow && s.followRoi && s.followRoi.points && s.followRoi.points.length >= 3;
    if (fOk) { folSvg.removeAttribute("hidden"); roiRenderSvgMulti(folSvg, [{ points: s.followRoi.points, color: "#22d3ee", fill: "rgba(34,211,238,0.15)" }], this.followW, this.followH, "cover"); }
    else { folSvg.setAttribute("hidden", ""); }
  },

  apply() {
    const t = `translate(${this.tx}px, ${this.ty}px) scale(${this.z}) rotate(${this.rot}deg)`;
    $("#al-follow").style.transform = t;
    const fol = $("#al-roi-follow");
    if (fol) fol.style.transform = t;   // zona do acompanhamento acompanha a foto
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
    await DB.put(s);
    await openDetail(s.id);
  },

  async cancel() {
    await openDetail(this.session.id);
  },

  // Alinhamento automático: detecta as silhuetas e empilha o acompanhamento
  // sobre a base (gira/escala/move), fazendo o que o usuário faz manualmente.
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

      // Se AS DUAS fotos têm zona de interesse marcada (e estamos reposicionando
      // a foto já salva, à qual a followRoi pertence), alinha pelas ZONAS —
      // o médico marca a mesma região nas duas e o encaixe usa exatamente ela.
      // Caso contrário, cai no método por silhueta (pele/primeiro plano).
      const s = this.session;
      const roiPts = s.roi && s.roi.points, froiPts = s.followRoi && s.followRoi.points;
      const useRoi = this.isReposition && roiPts && roiPts.length >= 3 &&
                     froiPts && froiPts.length >= 3 && typeof roiPolygonMask === "function";
      let bMask, fMask;
      if (useRoi) {
        const fW = followImg.naturalWidth || this.baseW, fH = followImg.naturalHeight || this.baseH;
        const bm = roiPolygonMask(roiPointsToBoxNorm(roiPts, this.baseW, this.baseH, W0, H0, "cover"), W0, H0);
        const fm = roiPolygonMask(roiPointsToBoxNorm(froiPts, fW, fH, W0, H0, "cover"), W0, H0);
        const sum = (m) => { let a = 0; for (let i = 0; i < m.length; i++) a += m[i]; return a; };
        bMask = { mask: bm, area: sum(bm) };
        fMask = { mask: fm, area: sum(fm) };
      } else {
        bMask = alForegroundMask(alCoverRender(baseImg, W0, H0));
        fMask = alForegroundMask(alCoverRender(followImg, W0, H0));
      }
      const minArea = W0 * H0 * 0.01;
      if (bMask.area < minArea || fMask.area < minArea) {
        alert(useRoi
          ? "As zonas de interesse são pequenas demais para alinhar. Ajuste manualmente."
          : "Não foi possível detectar a silhueta nas fotos. Ajuste manualmente.");
        return;
      }
      const B = alMoments(bMask.mask, W0, H0);
      const F = alMoments(fMask.mask, W0, H0);
      const cx = W0 / 2, cy = H0 / 2;
      const z0 = Math.max(0.5, Math.min(4, B.S / F.S));
      // Diferença de orientação dos eixos principais, normalizada p/ [-90,90].
      // Uma foto de acompanhamento nunca está de cabeça p/ baixo em relação à
      // base, então NÃO tentamos a inversão de 180° (que, num membro alongado e
      // quase simétrico, teria sobreposição parecida e viraria a perna).
      let rot0 = (B.theta - F.theta) * 180 / Math.PI;
      rot0 = ((rot0 % 180) + 180) % 180; if (rot0 > 90) rot0 -= 180;
      const iouAt = (z, rot, tx, ty) => alMaskIoU(fMask.mask, bMask.mask, W0, H0, z, rot, tx, ty, cx, cy);

      // Estimativa inicial por momentos + varredura grossa de escala (a diferença
      // de silhueta entre as fotos pode enviesar z0).
      let best = null;
      for (const zm of [0.8, 0.9, 1, 1.1, 1.22]) {
        const z = Math.max(0.4, Math.min(5, z0 * zm));
        const t = alSolveT(B, F, z, rot0, cx, cy);
        const iou = iouAt(z, rot0, t.tx, t.ty);
        if (!best || iou > best.iou) best = { z, rot: rot0, tx: t.tx, ty: t.ty, iou };
      }

      // Refino FINO: sobe o "morro" da sobreposição (IoU) ajustando as 4
      // variáveis — zoom, rotação e as duas translações — com passos que
      // encolhem até o encaixe travar. É o que aproxima de verdade os contornos.
      // A rotação fica limitada a ±90° (evita a solução invertida).
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
          if (step.rot < 0.25) break;   // passos minúsculos: convergiu
        }
      }

      // Converte do quadro W0×H0 para os pixels do palco.
      const rect = $("#al-stage").getBoundingClientRect();
      const fac = (rect.width || W0) / W0;
      this.z = Math.max(0.5, Math.min(4, best.z));
      this.rot = ((best.rot + 180) % 360 + 360) % 360 - 180;   // normaliza -180..180
      this.tx = best.tx * fac;
      this.ty = best.ty * fac;
      $("#al-zoom").value = this.z;
      $("#al-rotate").value = Math.round(this.rot);
      this.apply();
      if (best.iou < 0.12) {
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
  $("#al-rotate").addEventListener("input", (e) => {
    Aligner.rot = parseFloat(e.target.value);
    Aligner.apply();
  });
  $("#al-opacity").addEventListener("input", (e) => {
    $("#al-ghost").style.opacity = e.target.value;
  });
  $("#al-cancel").addEventListener("click", () => Aligner.cancel());
  $("#al-confirm").addEventListener("click", () => Aligner.confirm());
  $("#al-auto").addEventListener("click", () => Aligner.autoAlign());

  // Card "Zonas de interesse": mostrar zona da base / do acompanhamento.
  $("#al-roi-base").addEventListener("change", (e) => { Aligner.roiShowBase = e.target.checked; Aligner.renderRois(); });
  $("#al-roi-follow").addEventListener("change", (e) => { Aligner.roiShowFollow = e.target.checked; Aligner.renderRois(); });
  window.addEventListener("resize", () => {
    if ($("#screen-align").classList.contains("active")) Aligner.layoutStage();
  });
});
