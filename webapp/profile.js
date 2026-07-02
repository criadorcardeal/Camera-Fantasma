"use strict";

/* =========================================================================
   Fotos Fantasma - Perfil do usuario (nome + logo) - v3.5.2.

   O nome e a logo podem ser "impressos" nas fotos (marca d'agua). A LOGO tem
   posicao e tamanho livres (editor de retangulo, ate 75% fora da foto); o NOME
   fica ancorado abaixo da logo, com fonte (tipo/tamanho) propria. O rodape
   (rotulo) tem sua propria fonte. Config no localStorage.
   (Globais: $, escHtml, loadImageEl, refreshCompareCaptions.)
   ========================================================================= */

// Nomes com aspas SIMPLES para poder entrar em style="..." inline (aspas duplas).
const FONT_FAMILIES = {
  system: "-apple-system, system-ui, 'Segoe UI', Roboto, sans-serif",
  serif: "Georgia, 'Times New Roman', serif",
  helv: "'Helvetica Neue', Helvetica, Arial, sans-serif",
  hand: "'Snell Roundhand', 'Brush Script MT', cursive",
  mono: "Menlo, 'Courier New', monospace",
};
const FONT_LABELS = { system: "Sistema", serif: "Serifa", helv: "Helvética", hand: "Manuscrita", mono: "Mono" };

const Profile = {
  // Estado do editor (normalizado em relacao a foto): posicao (canto sup-esq
  // da logo) e largura da logo como fracao da largura da foto.
  _lx: 0.66, _ly: 0.72, _lw: 0.28,
  _logo: "",          // dataURL em edicao
  _aspect: 0.6,       // altura/largura da logo

  get() {
    try { return JSON.parse(localStorage.getItem("ff_profile")) || {}; }
    catch (_) { return {}; }
  },
  set(p) { localStorage.setItem("ff_profile", JSON.stringify(p)); },

  // Config normalizada para desenho/overlay (com padroes LIGADOS).
  config() {
    const p = this.get();
    const nf = p.nameFont || "system", ff = p.footerFont || "system";
    return {
      name: p.name || "",
      logo: p.logo || "",
      enabled: p.enabled != null ? !!p.enabled : true,
      logoX: p.logoX != null ? p.logoX : 0.66,
      logoY: p.logoY != null ? p.logoY : 0.72,
      logoW: p.logoW != null ? p.logoW : 0.28,
      opacity: p.opacity != null ? p.opacity : 0.7,
      nameFontKey: nf, nameFamily: FONT_FAMILIES[nf] || FONT_FAMILIES.system,
      nameScale: p.nameScale != null ? p.nameScale : 1,
      footerFontKey: ff, footerFamily: FONT_FAMILIES[ff] || FONT_FAMILIES.system,
      footerScale: p.footerScale != null ? p.footerScale : 1,
    };
  },

  open() {
    const c = this.config();
    $("#prof-name").value = c.name;
    $("#prof-name-font").value = c.nameFontKey;
    $("#prof-name-size").value = Math.round(c.nameScale * 100);
    $("#prof-name-size-val").textContent = Math.round(c.nameScale * 100) + "%";
    $("#prof-footer-font").value = c.footerFontKey;
    $("#prof-footer-size").value = Math.round(c.footerScale * 100);
    $("#prof-footer-size-val").textContent = Math.round(c.footerScale * 100) + "%";
    $("#prof-enabled").checked = c.enabled;
    const transp = Math.round((1 - c.opacity) * 100);
    $("#prof-transp").value = transp;
    $("#prof-transp-val").textContent = transp + "%";

    this._logo = c.logo;
    this._lx = c.logoX; this._ly = c.logoY; this._lw = c.logoW;
    this._refreshLogoPrev();
    this._loadDragLogo();          // seta a logo do editor e faz o layout
    $("#profile-dialog").showModal();
  },

  _refreshLogoPrev() {
    const img = $("#prof-logo-prev");
    if (this._logo) { img.src = this._logo; img.style.visibility = "visible"; }
    else { img.removeAttribute("src"); img.style.visibility = "hidden"; }
  },

  // Carrega a logo no editor, calcula o aspecto e posiciona o retangulo.
  _loadDragLogo() {
    const dragImg = $("#prof-logo-drag");
    if (this._logo) {
      dragImg.style.display = "block";
      dragImg.onload = () => {
        this._aspect = (dragImg.naturalHeight / dragImg.naturalWidth) || 0.6;
        this._layoutBox();
      };
      dragImg.src = this._logo;
    } else {
      dragImg.removeAttribute("src");
      dragImg.style.display = "none";
      this._aspect = 0.6;
    }
    requestAnimationFrame(() => this._layoutBox());
  },

  _stageDims() {
    const st = $("#prof-stage");
    return { sw: st.clientWidth || 168, sh: st.clientHeight || 224 };
  },

  // Mantem ao menos 25% da logo dentro da foto (permite ate 75% fora).
  _clamp() {
    const { sw, sh } = this._stageDims();
    const bw = this._lw * sw, bh = bw * this._aspect;
    let lpx = this._lx * sw, tpx = this._ly * sh;
    lpx = Math.max(-0.75 * bw, Math.min(sw - 0.25 * bw, lpx));
    tpx = Math.max(-0.75 * bh, Math.min(sh - 0.25 * bh, tpx));
    this._lx = lpx / sw; this._ly = tpx / sh;
  },

  _layoutBox() {
    const box = $("#prof-logo-box");
    if (!box) return;
    const { sw, sh } = this._stageDims();
    const bw = this._lw * sw, bh = bw * this._aspect;
    box.style.width = bw + "px";
    box.style.height = bh + "px";
    box.style.left = (this._lx * sw) + "px";
    box.style.top = (this._ly * sh) + "px";
  },

  save() {
    const nameScale = (parseInt($("#prof-name-size").value, 10) || 100) / 100;
    const footerScale = (parseInt($("#prof-footer-size").value, 10) || 100) / 100;
    const transp = parseInt($("#prof-transp").value, 10) || 0;
    this.set({
      name: $("#prof-name").value.trim(),
      logo: this._logo || "",
      enabled: $("#prof-enabled").checked,
      logoX: this._lx, logoY: this._ly, logoW: this._lw,
      opacity: Math.max(0.05, 1 - transp / 100),
      nameFont: $("#prof-name-font").value,
      nameScale,
      footerFont: $("#prof-footer-font").value,
      footerScale,
    });
    $("#profile-dialog").close();
    if (typeof refreshCompareCaptions === "function") refreshCompareCaptions();
  },

  // Overlay da marca d'agua no palco de comparacao (tela). c = config().
  wmHtml(c) {
    if (!c.enabled || (!c.name && !c.logo)) return "";
    const logo = c.logo ? `<img src="${c.logo}" alt="" />` : "";
    const name = c.name
      ? `<span style="font-family:${c.nameFamily};font-size:calc(0.95rem * ${c.nameScale})">${escHtml(c.name)}</span>`
      : "";
    // Sem logo, ainda ancora o nome pela posicao/largura escolhidas.
    return `<div class="wm" style="left:${c.logoX * 100}%;top:${c.logoY * 100}%;width:${c.logoW * 100}%;opacity:${c.opacity}">${logo}${name}</div>`;
  },

  // Desenha a marca d'agua num canvas, dentro da regiao [x,y,w,h] (uma foto).
  drawWatermark(ctx, x, y, w, h, c, logoImg) {
    if (!c || !c.enabled) return;
    if (!c.name && !logoImg) return;
    ctx.save();
    ctx.globalAlpha = c.opacity != null ? c.opacity : 1;
    let cx, bottom;
    if (logoImg) {
      const lw = c.logoW * w;
      const lh = lw * (logoImg.naturalHeight / (logoImg.naturalWidth || 1));
      const lx = x + c.logoX * w, ly = y + c.logoY * h;
      ctx.drawImage(logoImg, lx, ly, lw, lh);
      cx = lx + lw / 2; bottom = ly + lh;
    } else {
      cx = x + (c.logoX + c.logoW / 2) * w;
      bottom = y + c.logoY * h;
    }
    if (c.name) {
      const fontPx = Math.max(12, Math.round(h * 0.05 * c.nameScale));
      ctx.font = `700 ${fontPx}px ${c.nameFamily}`;
      ctx.textAlign = "center";
      ctx.textBaseline = "top";
      ctx.shadowColor = "rgba(0,0,0,0.7)";
      ctx.shadowBlur = Math.round(fontPx * 0.3);
      ctx.fillStyle = "#ffffff";
      ctx.fillText(c.name, cx, bottom + Math.round(h * 0.008));
    }
    ctx.restore();
  },
};

// Reduz a logo preservando transparencia (saida PNG).
function downscaleLogo(file, maxSize) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const img = new Image();
      img.onload = () => {
        let w = img.naturalWidth || img.width, h = img.naturalHeight || img.height;
        const scale = Math.min(1, maxSize / Math.max(w, h));
        w = Math.round(w * scale); h = Math.round(h * scale);
        const c = document.createElement("canvas");
        c.width = w; c.height = h;
        c.getContext("2d").drawImage(img, 0, 0, w, h);
        resolve(c.toDataURL("image/png"));
      };
      img.onerror = () => reject(new Error("Não foi possível ler a imagem."));
      img.src = reader.result;
    };
    reader.onerror = () => reject(new Error("Falha ao abrir o arquivo."));
    reader.readAsDataURL(file);
  });
}

window.addEventListener("DOMContentLoaded", () => {
  // Popula os seletores de fonte.
  ["#prof-name-font", "#prof-footer-font"].forEach((sel) => {
    const el = $(sel);
    Object.keys(FONT_LABELS).forEach((k) => {
      const o = document.createElement("option");
      o.value = k; o.textContent = FONT_LABELS[k]; el.appendChild(o);
    });
  });

  $("#cred-profile").addEventListener("click", () => Profile.open());
  $("#prof-close").addEventListener("click", () => $("#profile-dialog").close());
  $("#prof-save").addEventListener("click", () => Profile.save());
  $("#prof-transp").addEventListener("input", (e) => {
    $("#prof-transp-val").textContent = e.target.value + "%";
  });
  $("#prof-name-size").addEventListener("input", (e) => {
    $("#prof-name-size-val").textContent = e.target.value + "%";
  });
  $("#prof-footer-size").addEventListener("input", (e) => {
    $("#prof-footer-size-val").textContent = e.target.value + "%";
  });
  $("#prof-logo-remove").addEventListener("click", () => {
    Profile._logo = ""; Profile._refreshLogoPrev(); Profile._loadDragLogo();
  });
  $("#prof-logo-pick").addEventListener("click", () => {
    const inp = document.createElement("input");
    inp.type = "file"; inp.accept = "image/*";
    inp.onchange = async () => {
      const f = inp.files && inp.files[0];
      if (!f) return;
      try {
        Profile._logo = await downscaleLogo(f, 400);
        Profile._refreshLogoPrev();
        Profile._loadDragLogo();
      } catch (e) { alert(e.message || "Não foi possível usar esta imagem."); }
    };
    inp.click();
  });

  // ---- Editor: arrastar a logo e redimensionar pela alca ----
  const box = $("#prof-logo-box");
  const resize = $("#prof-resize");
  let mode = null, start = null;
  const stageDims = () => Profile._stageDims();

  const onDown = (e, m) => {
    e.preventDefault();
    mode = m;
    const { sw, sh } = stageDims();
    start = { px: e.clientX, py: e.clientY, lx: Profile._lx, ly: Profile._ly, lw: Profile._lw, sw, sh };
    try { (m === "resize" ? resize : box).setPointerCapture(e.pointerId); } catch (_) {}
  };
  box.addEventListener("pointerdown", (e) => { if (e.target === resize) return; onDown(e, "move"); });
  resize.addEventListener("pointerdown", (e) => { e.stopPropagation(); onDown(e, "resize"); });

  window.addEventListener("pointermove", (e) => {
    if (!mode || !start) return;
    if (mode === "move") {
      Profile._lx = start.lx + (e.clientX - start.px) / start.sw;
      Profile._ly = start.ly + (e.clientY - start.py) / start.sh;
    } else {
      const dw = (e.clientX - start.px) / start.sw;
      Profile._lw = Math.max(0.05, Math.min(1.5, start.lw + dw));
    }
    Profile._clamp();
    Profile._layoutBox();
  });
  const endDrag = () => { mode = null; start = null; };
  window.addEventListener("pointerup", endDrag);
  window.addEventListener("pointercancel", endDrag);
});
