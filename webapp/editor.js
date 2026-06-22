"use strict";

/* =========================================================================
   Fotos Fantasma - v2.0 - Janela de ajuste das caracteristicas das imagens.

   Caracteristicas: Exposicao, Contraste, Altas-luzes, Sombras, Saturacao,
   Temperatura, Tonalidade, Nitidez. Ajuste manual por imagem + "Ajuste
   Automatico Completo" (leva as duas ao valor medio) + trava das duas juntas.

   Processamento em canvas (puro JS). O preview roda numa versao reduzida para
   ser fluido; ao salvar, reaplica na resolucao guardada (nao-destrutivo: o
   original e os valores ficam salvos para reedicao).
   ========================================================================= */

const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));

/* ---------- Carrega imagem reduzida como ImageData ---------- */
function loadImageEl(src) {
  return new Promise((res, rej) => {
    const im = new Image();
    im.onload = () => res(im);
    im.onerror = () => rej(new Error("Falha ao carregar imagem"));
    im.src = src;
  });
}
async function loadPreviewData(src, maxSize) {
  const im = await loadImageEl(src);
  let w = im.naturalWidth || im.width;
  let h = im.naturalHeight || im.height;
  const scale = Math.min(1, maxSize / Math.max(w, h));
  w = Math.max(1, Math.round(w * scale));
  h = Math.max(1, Math.round(h * scale));
  const c = document.createElement("canvas");
  c.width = w;
  c.height = h;
  const ctx = c.getContext("2d", { willReadFrequently: true });
  ctx.drawImage(im, 0, 0, w, h);
  return ctx.getImageData(0, 0, w, h);
}

/* ---------- Aplica os ajustes e devolve novo ImageData ---------- */
function applyAdjustments(src, a) {
  const w = src.width, h = src.height, s = src.data;
  const out = new Uint8ClampedArray(s.length);

  const expO = a.exposure;            // somado direto aos canais
  const cf = 1 + a.contrast / 100;    // 0..2
  const sat = 1 + a.saturation / 100; // 0..2
  const tempV = a.temperature * 0.5;  // +R / -B
  const tintV = a.tint * 0.5;         // +G / -(R,B)
  const hi = a.highlights / 100;
  const sh = a.shadows / 100;

  for (let i = 0; i < s.length; i += 4) {
    let r = s[i], g = s[i + 1], b = s[i + 2];

    // Exposicao
    r += expO; g += expO; b += expO;
    // Temperatura / Tonalidade
    r += tempV - tintV * 0.5;
    g += tintV;
    b += -tempV - tintV * 0.5;

    // Sombras / Altas-luzes (com base na luminancia atual)
    const lum = 0.299 * r + 0.587 * g + 0.114 * b;
    if (sh !== 0) {
      const wgt = Math.max(0, (128 - lum) / 128);
      const add = sh * 60 * wgt;
      r += add; g += add; b += add;
    }
    if (hi !== 0) {
      const wgt = Math.max(0, (lum - 128) / 127);
      const add = hi * 60 * wgt;
      r += add; g += add; b += add;
    }

    // Contraste
    r = (r - 128) * cf + 128;
    g = (g - 128) * cf + 128;
    b = (b - 128) * cf + 128;

    // Saturacao
    const l2 = 0.299 * r + 0.587 * g + 0.114 * b;
    r = l2 + (r - l2) * sat;
    g = l2 + (g - l2) * sat;
    b = l2 + (b - l2) * sat;

    out[i] = r; out[i + 1] = g; out[i + 2] = b; out[i + 3] = s[i + 3];
  }

  let result = new ImageData(out, w, h);
  if (a.sharpness && a.sharpness !== 0) {
    result = applySharpen(result, a.sharpness / 100);
  }
  return result;
}

/* ---------- Nitidez (unsharp 3x3); amount>0 aguça, <0 desfoca ---------- */
function applySharpen(img, amount) {
  const w = img.width, h = img.height, s = img.data;
  const out = new Uint8ClampedArray(s.length);
  const idx = (x, y) => ((y * w + x) << 2);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const o = idx(x, y);
      for (let c = 0; c < 3; c++) {
        let sum = 0, n = 0;
        for (let dy = -1; dy <= 1; dy++) {
          for (let dx = -1; dx <= 1; dx++) {
            const xx = x + dx, yy = y + dy;
            if (xx < 0 || yy < 0 || xx >= w || yy >= h) continue;
            sum += s[idx(xx, yy) + c]; n++;
          }
        }
        const blur = sum / n;
        const v = s[o + c];
        out[o + c] = amount >= 0
          ? v + amount * (v - blur)
          : (1 + amount) * v + (-amount) * blur;
      }
      out[o + 3] = s[o + 3];
    }
  }
  return new ImageData(out, w, h);
}

/* ---------- Mede as caracteristicas "iniciais" de uma imagem ---------- */
function measure(img) {
  const s = img.data;
  let n = 0, sumL = 0, sumR = 0, sumG = 0, sumB = 0, sumSat = 0;
  let brightSum = 0, brightN = 0, darkSum = 0, darkN = 0;
  for (let i = 0; i < s.length; i += 4) {
    const r = s[i], g = s[i + 1], b = s[i + 2];
    const l = 0.299 * r + 0.587 * g + 0.114 * b;
    sumL += l; sumR += r; sumG += g; sumB += b;
    sumSat += Math.max(r, g, b) - Math.min(r, g, b);
    if (l >= 170) { brightSum += l; brightN++; }
    if (l <= 85) { darkSum += l; darkN++; }
    n++;
  }
  const meanL = sumL / n;
  let varSum = 0;
  for (let i = 0; i < s.length; i += 4) {
    const l = 0.299 * s[i] + 0.587 * s[i + 1] + 0.114 * s[i + 2];
    varSum += (l - meanL) * (l - meanL);
  }
  return {
    lum: meanL,
    contrast: Math.sqrt(varSum / n),
    saturation: sumSat / n,
    temperature: (sumR - sumB) / n,
    tint: (sumG - (sumR + sumB) / 2) / n,
    highlights: brightN ? brightSum / brightN : meanL,
    shadows: darkN ? darkSum / darkN : meanL,
    sharpness: estimateSharpness(img),
  };
}

function estimateSharpness(img) {
  const w = img.width, h = img.height, s = img.data;
  const lumAt = (x, y) => {
    const o = (y * w + x) << 2;
    return 0.299 * s[o] + 0.587 * s[o + 1] + 0.114 * s[o + 2];
  };
  let sum = 0, sumSq = 0, n = 0;
  for (let y = 1; y < h - 1; y++) {
    for (let x = 1; x < w - 1; x++) {
      const lap = 4 * lumAt(x, y) - lumAt(x - 1, y) - lumAt(x + 1, y) -
        lumAt(x, y - 1) - lumAt(x, y + 1);
      sum += lap; sumSq += lap * lap; n++;
    }
  }
  if (!n) return 0;
  const mean = sum / n;
  return Math.sqrt(Math.max(0, sumSq / n - mean * mean));
}

/* ---------- Solucionador do Ajuste Automatico ----------
   Para uma imagem, encontra os valores de cada caracteristica que fazem a
   SAIDA medir exatamente os alvos. Como as caracteristicas interferem entre
   si, busca cada uma por bisseccao reavaliando o resultado real do pipeline,
   repetindo em algumas passadas ate convergir. Resolvendo as duas imagens
   para os MESMOS alvos, elas terminam com as caracteristicas iguais.

   Cada metrica e monotonica crescente em relacao ao seu slider, o que permite
   a busca binaria. */
const METRIC_OF = {
  exposure: "lum",
  contrast: "contrast",
  saturation: "saturation",
  temperature: "temperature",
  tint: "tint",
  shadows: "shadows",
  highlights: "highlights",
  sharpness: "sharpness",
};

function solveAdjustments(img, target) {
  const adj = {
    exposure: 0, contrast: 0, highlights: 0, shadows: 0,
    saturation: 0, temperature: 0, tint: 0, sharpness: 0,
  };
  const solveOne = (key) => {
    const mk = METRIC_OF[key];
    let lo = -100, hi = 100;
    for (let it = 0; it < 12; it++) {
      const mid = (lo + hi) / 2;
      adj[key] = mid;
      const val = measure(applyAdjustments(img, adj))[mk];
      if (val < target[mk]) lo = mid; else hi = mid;
    }
    adj[key] = Math.round((lo + hi) / 2);
  };
  // Varias passadas de "coordinate descent" para acomodar as interferencias
  // entre as caracteristicas ate convergir aos alvos.
  const order = ["exposure", "contrast", "saturation", "temperature", "tint", "shadows", "highlights"];
  for (let pass = 0; pass < 4; pass++) {
    for (const key of order) solveOne(key);
  }
  // Nitidez por ultimo (mais pesada) e uma vez.
  solveOne("sharpness");
  return adj;
}

/* ---------- Renderiza versao ajustada em dataURL (resolucao cheia) ---------- */
async function bakeView(src, adj) {
  const data = await loadPreviewData(src, 1600);
  const out = applyAdjustments(data, adj);
  const c = document.createElement("canvas");
  c.width = out.width; c.height = out.height;
  c.getContext("2d").putImageData(out, 0, 0);
  return c.toDataURL("image/jpeg", 0.9);
}

/* ============================ Editor (UI) ============================ */
const Editor = {
  CHARS: [
    { key: "exposure", name: "Exposição" },
    { key: "contrast", name: "Contraste" },
    { key: "highlights", name: "Altas-luzes" },
    { key: "shadows", name: "Sombras" },
    { key: "saturation", name: "Saturação" },
    { key: "temperature", name: "Temperatura" },
    { key: "tint", name: "Tonalidade" },
    { key: "sharpness", name: "Nitidez" },
  ],
  session: null,
  locked: false,
  which: "base",
  adj: { base: null, follow: null },
  prev: { base: null, follow: null },
  raf: null,
  pending: null,

  defaults() {
    return {
      exposure: 0, contrast: 0, highlights: 0, shadows: 0,
      saturation: 0, temperature: 0, tint: 0, sharpness: 0,
    };
  },
  isNeutral(a) {
    return this.CHARS.every((c) => (a[c.key] || 0) === 0);
  },

  async open(session) {
    this.session = session;
    this.adj.base = Object.assign(this.defaults(), session.baseAdj || {});
    this.adj.follow = Object.assign(this.defaults(), session.followAdj || {});
    this.locked = false;
    this.which = "base";
    $("#ed-lock-toggle").checked = false;
    $("#ed-which-row").style.display = "";
    $("#ed-which").querySelectorAll("button").forEach((b) =>
      b.classList.toggle("active", b.dataset.img === "base"));

    showScreen("screen-editor");
    try {
      this.prev.base = await loadPreviewData(session.baseImage, 480);
      this.prev.follow = await loadPreviewData(session.followImage, 480);
    } catch (e) {
      alert("Não foi possível abrir as imagens para ajuste.");
      await openDetail(session.id);
      return;
    }
    this.buildSliders();
    this.renderBoth();
  },

  buildSliders() {
    const host = $("#ed-sliders");
    host.innerHTML = "";
    this.CHARS.forEach((ch) => {
      const row = document.createElement("div");
      row.className = "ed-slider";
      row.innerHTML =
        `<span class="ed-name">${ch.name}</span>` +
        `<input type="range" min="-100" max="100" step="1" data-key="${ch.key}" />` +
        `<span class="ed-val"></span>`;
      const input = row.querySelector("input");
      input.addEventListener("input", () =>
        this.onSlider(ch.key, parseInt(input.value, 10)));
      host.appendChild(row);
    });
    this.refreshSliderValues();
  },

  displaySource() {
    return this.locked ? "base" : this.which;
  },

  refreshSliderValues() {
    const a = this.adj[this.displaySource()];
    $("#ed-sliders").querySelectorAll(".ed-slider").forEach((row) => {
      const input = row.querySelector("input");
      const key = input.dataset.key;
      input.value = a[key];
      row.querySelector(".ed-val").textContent = (a[key] > 0 ? "+" : "") + a[key];
    });
  },

  onSlider(key, val) {
    if (this.locked) {
      this.adj.base[key] = val;
      this.adj.follow[key] = val;
      this.scheduleRender("both");
    } else {
      this.adj[this.which][key] = val;
      this.scheduleRender(this.which);
    }
    const row = [...$("#ed-sliders").querySelectorAll(".ed-slider")]
      .find((r) => r.querySelector("input").dataset.key === key);
    if (row) row.querySelector(".ed-val").textContent = (val > 0 ? "+" : "") + val;
  },

  scheduleRender(target) {
    this.pending = this.pending || new Set();
    if (target === "both") { this.pending.add("base"); this.pending.add("follow"); }
    else this.pending.add(target);
    if (this.raf) return;
    this.raf = requestAnimationFrame(() => {
      this.raf = null;
      const set = this.pending; this.pending = null;
      set.forEach((k) => this.renderImage(k));
    });
  },

  renderImage(key) {
    const src = this.prev[key];
    if (!src) return;
    const out = applyAdjustments(src, this.adj[key]);
    const c = $("#ed-canvas-" + key);
    c.width = out.width; c.height = out.height;
    c.getContext("2d").putImageData(out, 0, 0);
  },
  renderBoth() { this.renderImage("base"); this.renderImage("follow"); },

  setWhich(which) {
    this.which = which;
    $("#ed-which").querySelectorAll("button").forEach((b) =>
      b.classList.toggle("active", b.dataset.img === which));
    this.refreshSliderValues();
  },

  setLocked(on) {
    this.locked = on;
    $("#ed-which-row").style.display = on ? "none" : "";
    this.refreshSliderValues();
  },

  async auto() {
    const btn = $("#ed-auto");
    const label = btn.textContent;
    btn.disabled = true;
    btn.textContent = "Processando…";
    // Deixa o botao repintar antes do calculo pesado.
    await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
    try {
      // Resolve numa resolucao baixa (metricas sao estatisticas estaveis e fica
      // rapido). Os valores valem para qualquer resolucao na exibicao.
      const rb = await loadPreviewData(this.session.baseImage, 130);
      const rf = await loadPreviewData(this.session.followImage, 130);
      const mb = measure(rb);
      const mf = measure(rf);
      const keys = ["lum", "contrast", "saturation", "temperature", "tint", "highlights", "shadows", "sharpness"];
      const target = {};
      keys.forEach((k) => (target[k] = (mb[k] + mf[k]) / 2));
      this.adj.base = solveAdjustments(rb, target);
      this.adj.follow = solveAdjustments(rf, target);
      this.refreshSliderValues();
      this.renderBoth();
    } finally {
      btn.disabled = false;
      btn.textContent = label;
    }
  },

  resetActive() {
    if (this.locked) {
      this.adj.base = this.defaults();
      this.adj.follow = this.defaults();
      this.scheduleRender("both");
    } else {
      this.adj[this.which] = this.defaults();
      this.scheduleRender(this.which);
    }
    this.refreshSliderValues();
  },

  async save() {
    const s = this.session;
    s.baseAdj = this.adj.base;
    s.followAdj = this.adj.follow;
    s.baseImageView = this.isNeutral(this.adj.base) ? null : await bakeView(s.baseImage, this.adj.base);
    s.followImageView = this.isNeutral(this.adj.follow) ? null : await bakeView(s.followImage, this.adj.follow);
    await DB.put(s);
    await openDetail(s.id);
  },

  async cancel() {
    await openDetail(this.session.id);
  },
};

/* ---------- Liga os controles do editor ---------- */
window.addEventListener("DOMContentLoaded", () => {
  $("#ed-cancel").addEventListener("click", () => Editor.cancel());
  $("#ed-save").addEventListener("click", () => Editor.save());
  $("#ed-auto").addEventListener("click", () => Editor.auto());
  $("#ed-reset").addEventListener("click", () => Editor.resetActive());
  $("#ed-lock-toggle").addEventListener("change", (e) => Editor.setLocked(e.target.checked));
  $("#ed-which").querySelectorAll("button").forEach((b) =>
    b.addEventListener("click", () => Editor.setWhich(b.dataset.img)));
});
