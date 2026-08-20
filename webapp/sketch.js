"use strict";

/* =========================================================================
   ComparaCam - v7.6.1 - Filtro "Contorno neon".

   Transforma uma foto num ESBOÇO/CONTORNO chapado (preto e branco, sem
   sombras) e recolore: o "preto" (as linhas do contorno) vira verde neon
   (ou outra cor neon) e o "branco" (o resto) vira TRANSPARENTE. O resultado
   é um PNG com fundo transparente, ideal para usar como imagem FANTASMA na
   câmera de acompanhamento e na janela de posicionamento (alinhamento).

   Pipeline: tons de cinza -> borra leve (tira ruído) -> Sobel (gradiente) ->
   limiar por percentil (chapa em 2 tons) -> engrossa 1px -> pinta de neon.

   Exposto em window.makeNeonSketch(src, opts) e window.NEON (cores padrão).
   (loadImageEl é global, definido em app.js.)
   ========================================================================= */

// Cores neon padrão. Base = verde neon (pedido do médico); acompanhamento =
// ciano neon, p/ os dois contornos ficarem distinguíveis quando sobrepostos
// (mesma linguagem de cor das zonas de interesse: base verde / acomp. ciano).
window.NEON = {
  base:   { r: 25,  g: 255, b: 106 },   // #19FF6A verde neon
  follow: { r: 34,  g: 211, b: 238 },   // #22D3EE ciano neon
};

// Borra 3x3 (média) — reduz o ruído da foto antes da detecção de borda,
// evitando que textura de pele vire "chuvisco" de contorno.
function _skBlur3(g, W, H) {
  const out = new Float32Array(W * H);
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      let s = 0, n = 0;
      for (let dy = -1; dy <= 1; dy++) {
        const yy = y + dy; if (yy < 0 || yy >= H) continue;
        for (let dx = -1; dx <= 1; dx++) {
          const xx = x + dx; if (xx < 0 || xx >= W) continue;
          s += g[yy * W + xx]; n++;
        }
      }
      out[y * W + x] = s / n;
    }
  }
  return out;
}

// Engrossa (dilata) a máscara binária em 1px (vizinhança 3x3), p/ as linhas
// ficarem visíveis por cima do vídeo ao vivo.
function _skDilate(mask, W, H) {
  const out = new Uint8Array(W * H);
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      if (!mask[y * W + x]) continue;
      for (let dy = -1; dy <= 1; dy++) {
        const yy = y + dy; if (yy < 0 || yy >= H) continue;
        for (let dx = -1; dx <= 1; dx++) {
          const xx = x + dx; if (xx < 0 || xx >= W) continue;
          out[yy * W + xx] = 1;
        }
      }
    }
  }
  return out;
}

// Gera o contorno neon (PNG transparente) a partir de uma imagem (URL/dataURL).
//   opts.color       -> {r,g,b} da linha neon (padrão verde).
//   opts.edgeFrac    -> fração aproximada de pixels que viram linha (padrão 0.09).
//   opts.maxSide     -> maior lado do canvas de trabalho (padrão 1280).
//   opts.excludeMask -> PNG (dataURL) das áreas "Remover distrações": onde o alfa
//                       é opaco, o pixel é descartado do contorno (v8.1). A máscara
//                       é normalizada sobre a MESMA imagem, então é esticada ao W×H.
window.makeNeonSketch = async function (src, opts) {
  opts = opts || {};
  const color = opts.color || window.NEON.base;
  const edgeFrac = opts.edgeFrac != null ? opts.edgeFrac : 0.09;
  const maxSide = opts.maxSide || 1280;

  const img = await loadImageEl(src);
  const iw = img.naturalWidth || img.width;
  const ih = img.naturalHeight || img.height;
  const scale = Math.min(1, maxSide / Math.max(iw, ih));
  const W = Math.max(1, Math.round(iw * scale));
  const H = Math.max(1, Math.round(ih * scale));

  const c = document.createElement("canvas");
  c.width = W; c.height = H;
  const ctx = c.getContext("2d", { willReadFrequently: true });
  ctx.drawImage(img, 0, 0, W, H);
  const src0 = ctx.getImageData(0, 0, W, H).data;
  const N = W * H;

  // Tons de cinza (luminância) + borra leve.
  const gray = new Float32Array(N);
  for (let p = 0, i = 0; p < N; p++, i += 4) {
    gray[p] = 0.299 * src0[i] + 0.587 * src0[i + 1] + 0.114 * src0[i + 2];
  }
  const g = _skBlur3(gray, W, H);

  // Sobel: magnitude do gradiente = força da borda.
  const mag = new Float32Array(N);
  let maxMag = 0;
  for (let y = 1; y < H - 1; y++) {
    for (let x = 1; x < W - 1; x++) {
      const p = y * W + x;
      const gx = (g[p - W + 1] + 2 * g[p + 1] + g[p + W + 1]) -
                 (g[p - W - 1] + 2 * g[p - 1] + g[p + W - 1]);
      const gy = (g[p + W - 1] + 2 * g[p + W] + g[p + W + 1]) -
                 (g[p - W - 1] + 2 * g[p - W] + g[p - W + 1]);
      const m = Math.sqrt(gx * gx + gy * gy);
      mag[p] = m; if (m > maxMag) maxMag = m;
    }
  }

  // Limiar por PERCENTIL: mantém só as bordas mais fortes (as ~edgeFrac).
  // "Chapa" em 2 tons (sem sombras/cinza). Um piso absoluto evita virar tudo
  // linha numa foto quase lisa (fundo uniforme).
  const hist = new Int32Array(256);
  const norm = maxMag > 0 ? 255 / maxMag : 0;
  const q = new Uint8Array(N);
  for (let p = 0; p < N; p++) {
    const v = Math.min(255, Math.round(mag[p] * norm));
    q[p] = v; hist[v]++;
  }
  const target = N * edgeFrac;
  let acc = 0, th = 255;
  for (let v = 255; v >= 0; v--) { acc += hist[v]; if (acc >= target) { th = v; break; } }
  th = Math.max(th, 18);   // piso absoluto (0..255) sobre o gradiente normalizado

  let mask = new Uint8Array(N);
  for (let p = 0; p < N; p++) mask[p] = q[p] >= th ? 1 : 0;
  mask = _skDilate(mask, W, H);

  // v8.1: descarta as áreas marcadas em "Remover distrações" — assim o contorno
  // não desenha veias/marcas/objetos que o médico quis tirar de foco.
  if (opts.excludeMask) {
    try {
      const mimg = await loadImageEl(opts.excludeMask);
      const mc = document.createElement("canvas");
      mc.width = W; mc.height = H;
      const mx = mc.getContext("2d", { willReadFrequently: true });
      mx.drawImage(mimg, 0, 0, W, H);
      const md = mx.getImageData(0, 0, W, H).data;
      for (let p = 0, i = 0; p < N; p++, i += 4) if (md[i + 3] > 40) mask[p] = 0;
    } catch (_) { /* sem máscara: contorno normal */ }
  }

  // Pinta: linha -> cor neon opaca; resto -> transparente.
  const out = ctx.createImageData(W, H);
  const od = out.data;
  for (let p = 0, i = 0; p < N; p++, i += 4) {
    if (mask[p]) {
      od[i] = color.r; od[i + 1] = color.g; od[i + 2] = color.b; od[i + 3] = 255;
    } else {
      od[i + 3] = 0;
    }
  }
  ctx.putImageData(out, 0, 0);
  return c.toDataURL("image/png");
};

/* -------------------------------------------------------------------------
   v8.6.1 - Filtro "Preto e branco" para a foto fantasma.

   Alternativa ao contorno neon: em vez de reduzir a foto a linhas, mantém a
   foto INTEIRA em tons de cinza com contraste realçado. Tirando a cor, o que
   sobra é forma/relevo — o que ajuda a encaixar o membro sem a cor da pele e
   da iluminação "puxando o olho". Diferente do contorno, o resultado é OPACO
   (a transparência quem controla é o cursor "Fantasma" da câmera).

     opts.mask    -> PNG das áreas "Remover distrações": recebem um véu claro,
                     para não competirem com o que interessa.
     opts.maxSide -> maior lado do canvas de trabalho (padrão 1280).
     opts.contrast-> ganho de contraste em torno do cinza médio (padrão 1.25).
   ------------------------------------------------------------------------- */
window.makeBwGhost = async function (src, opts) {
  opts = opts || {};
  const maxSide = opts.maxSide || 1280;
  const k = opts.contrast != null ? opts.contrast : 1.25;

  const img = await loadImageEl(src);
  const iw = img.naturalWidth || img.width;
  const ih = img.naturalHeight || img.height;
  const scale = Math.min(1, maxSide / Math.max(iw, ih));
  const W = Math.max(1, Math.round(iw * scale));
  const H = Math.max(1, Math.round(ih * scale));

  const c = document.createElement("canvas");
  c.width = W; c.height = H;
  const ctx = c.getContext("2d", { willReadFrequently: true });
  ctx.drawImage(img, 0, 0, W, H);

  const im = ctx.getImageData(0, 0, W, H);
  const d = im.data;
  for (let i = 0; i < d.length; i += 4) {
    let v = 0.299 * d[i] + 0.587 * d[i + 1] + 0.114 * d[i + 2];
    v = (v - 127.5) * k + 127.5;                 // contraste (mesma conta do CSS)
    v = v < 0 ? 0 : v > 255 ? 255 : v;
    d[i] = d[i + 1] = d[i + 2] = v;
    d[i + 3] = 255;
  }
  ctx.putImageData(im, 0, 0);

  // Véu claro nas áreas de "Remover distrações" (o contorno neon simplesmente
  // as descarta; aqui, como a foto continua inteira, elas são apagadas).
  if (opts.mask) {
    try {
      const mimg = await loadImageEl(opts.mask);
      const mc = document.createElement("canvas");
      mc.width = W; mc.height = H;
      const mx = mc.getContext("2d");
      const feather = Math.max(1, Math.round(Math.max(W, H) / 90));
      mx.filter = "blur(" + feather + "px)";
      mx.drawImage(mimg, 0, 0, W, H);
      mx.filter = "none";
      mx.globalCompositeOperation = "source-in";
      mx.fillStyle = "rgba(255,255,255,0.62)";
      mx.fillRect(0, 0, W, H);
      ctx.drawImage(mc, 0, 0, W, H);
    } catch (_) { /* sem máscara: preto e branco normal */ }
  }

  return c.toDataURL("image/jpeg", 0.9);
};
