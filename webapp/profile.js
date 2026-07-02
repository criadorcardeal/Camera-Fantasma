"use strict";

/* =========================================================================
   Fotos Fantasma - Perfil do usuario (nome + logo) - v3.5.3.

   Logo e Nome sao marcas d'agua INDEPENDENTES: cada um tem posicao propria no
   editor de retangulo (a logo tambem redimensiona; o nome dimensiona pela
   fonte) e liga/desliga separado. O rodape (rotulo) inclui a data de aquisicao
   da foto (somente data ou data+hora). Config no localStorage.
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
  // Estado do editor (normalizado em relacao a foto).
  _lx: 0.60, _ly: 0.06, _lw: 0.30,   // logo: canto sup-esq + largura (fracoes)
  _nx: 0.04, _ny: 0.84,              // nome: canto sup-esq (fracoes)
  _logo: "",                          // dataURL em edicao
  _aspect: 0.6,                       // altura/largura da logo

  get() {
    try { return JSON.parse(localStorage.getItem("ff_profile")) || {}; }
    catch (_) { return {}; }
  },
  set(p) { localStorage.setItem("ff_profile", JSON.stringify(p)); },

  // Config normalizada para desenho/overlay (com padroes LIGADOS).
  config() {
    const p = this.get();
    const nf = p.nameFont || "system", ff = p.footerFont || "system";
    const legacy = p.enabled != null ? !!p.enabled : true;   // compat: "enabled" antigo
    return {
      name: p.name || "",
      logo: p.logo || "",
      logoOn: p.logoOn != null ? !!p.logoOn : legacy,
      nameOn: p.nameOn != null ? !!p.nameOn : legacy,
      logoX: p.logoX != null ? p.logoX : 0.60,
      logoY: p.logoY != null ? p.logoY : 0.06,
      logoW: p.logoW != null ? p.logoW : 0.30,
      nameX: p.nameX != null ? p.nameX : 0.04,
      nameY: p.nameY != null ? p.nameY : 0.84,
      opacity: p.opacity != null ? p.opacity : 0.7,
      nameFontKey: nf, nameFamily: FONT_FAMILIES[nf] || FONT_FAMILIES.system,
      nameScale: p.nameScale != null ? p.nameScale : 1,
      footerFontKey: ff, footerFamily: FONT_FAMILIES[ff] || FONT_FAMILIES.system,
      footerScale: p.footerScale != null ? p.footerScale : 1,
      footerDate: p.footerDate || "date",   // none | date | datetime
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
    $("#prof-footer-date").value = c.footerDate;
    $("#prof-logo-on").checked = c.logoOn;
    $("#prof-name-on").checked = c.nameOn;
    const transp = Math.round((1 - c.opacity) * 100);
    $("#prof-transp").value = transp;
    $("#prof-transp-val").textContent = transp + "%";

    this._logo = c.logo;
    this._lx = c.logoX; this._ly = c.logoY; this._lw = c.logoW;
    this._nx = c.nameX; this._ny = c.nameY;
    this._scale = c.nameScale;
    this._nameFamily = c.nameFamily;
    this._refreshLogoPrev();
    this._loadDragLogo();
    this._syncNameBox();
    this._applyPreviewOpacity();
    $("#profile-dialog").showModal();
  },

  // Reflete a transparencia escolhida na previa da logo e do nome (so na imagem;
  // as bordas/alcas do editor continuam nitidas). Atualiza ao vivo com o slider.
  _applyPreviewOpacity() {
    const transp = parseInt($("#prof-transp").value, 10) || 0;
    const op = Math.max(0.05, 1 - transp / 100);
    const li = $("#prof-logo-drag"); if (li) li.style.opacity = op;
    const ns = $("#prof-name-drag"); if (ns) ns.style.opacity = op;
  },

  // Grava a posicao da logo (usada ao arrastar direto na tela de Comparacao).
  setLogoPos(x, y) {
    const p = this.get();
    p.logoX = x; p.logoY = y;
    this.set(p);
  },

  _refreshLogoPrev() {
    const img = $("#prof-logo-prev");
    if (this._logo) { img.src = this._logo; img.style.visibility = "visible"; }
    else { img.removeAttribute("src"); img.style.visibility = "hidden"; }
  },

  _loadDragLogo() {
    const dragImg = $("#prof-logo-drag");
    const box = $("#prof-logo-box");
    if (this._logo) {
      box.style.display = "block";
      dragImg.onload = () => {
        this._aspect = (dragImg.naturalHeight / dragImg.naturalWidth) || 0.6;
        this._layoutLogo();
      };
      dragImg.src = this._logo;
    } else {
      dragImg.removeAttribute("src");
      box.style.display = "none";
      this._aspect = 0.6;
    }
    requestAnimationFrame(() => this._layoutLogo());
  },

  // Sincroniza o texto/fonte/tamanho da caixa de nome no editor.
  _syncNameBox() {
    const box = $("#prof-name-box");
    const span = $("#prof-name-drag");
    const name = $("#prof-name").value.trim();
    this._scale = (parseInt($("#prof-name-size").value, 10) || 100) / 100;
    this._nameFamily = FONT_FAMILIES[$("#prof-name-font").value] || FONT_FAMILIES.system;
    if (!name) { box.style.display = "none"; return; }
    box.style.display = "block";
    span.textContent = name;
    span.style.fontFamily = this._nameFamily;
    const { sh } = this._stageDims();
    span.style.fontSize = Math.max(9, Math.round(sh * 0.05 * this._scale)) + "px";
    requestAnimationFrame(() => this._layoutName());
  },

  _stageDims() {
    const st = $("#prof-stage");
    return { sw: st.clientWidth || 168, sh: st.clientHeight || 224 };
  },

  // Mantem ao menos 25% dentro (permite ate 75% fora). Retorna [x,y] normalizado.
  _clampBox(xNorm, yNorm, bw, bh) {
    const { sw, sh } = this._stageDims();
    let lpx = xNorm * sw, tpx = yNorm * sh;
    lpx = Math.max(-0.75 * bw, Math.min(sw - 0.25 * bw, lpx));
    tpx = Math.max(-0.75 * bh, Math.min(sh - 0.25 * bh, tpx));
    return [lpx / sw, tpx / sh];
  },

  _layoutLogo() {
    const box = $("#prof-logo-box");
    if (!box || !this._logo) return;
    const { sw } = this._stageDims();
    const bw = this._lw * sw, bh = bw * this._aspect;
    [this._lx, this._ly] = this._clampBox(this._lx, this._ly, bw, bh);
    box.style.width = bw + "px";
    box.style.height = bh + "px";
    box.style.left = (this._lx * sw) + "px";
    box.style.top = (this._ly * this._stageDims().sh) + "px";
  },

  _layoutName() {
    const box = $("#prof-name-box");
    if (!box || box.style.display === "none") return;
    const { sw, sh } = this._stageDims();
    const bw = box.offsetWidth, bh = box.offsetHeight;
    [this._nx, this._ny] = this._clampBox(this._nx, this._ny, bw, bh);
    box.style.left = (this._nx * sw) + "px";
    box.style.top = (this._ny * sh) + "px";
  },

  save() {
    const nameScale = (parseInt($("#prof-name-size").value, 10) || 100) / 100;
    const footerScale = (parseInt($("#prof-footer-size").value, 10) || 100) / 100;
    const transp = parseInt($("#prof-transp").value, 10) || 0;
    this.set({
      name: $("#prof-name").value.trim(),
      logo: this._logo || "",
      logoOn: $("#prof-logo-on").checked,
      nameOn: $("#prof-name-on").checked,
      logoX: this._lx, logoY: this._ly, logoW: this._lw,
      nameX: this._nx, nameY: this._ny,
      opacity: Math.max(0.05, 1 - transp / 100),
      nameFont: $("#prof-name-font").value,
      nameScale,
      footerFont: $("#prof-footer-font").value,
      footerScale,
      footerDate: $("#prof-footer-date").value,
    });
    $("#profile-dialog").close();
    if (typeof refreshCompareCaptions === "function") refreshCompareCaptions();
  },

  // Overlay da marca d'agua no palco de comparacao (tela). c = config().
  wmHtml(c) {
    let html = "";
    if (c.logoOn && c.logo) {
      html += `<div class="wm wm-logo" style="left:${c.logoX * 100}%;top:${c.logoY * 100}%;width:${c.logoW * 100}%;opacity:${c.opacity}"><img src="${c.logo}" alt="" /></div>`;
    }
    if (c.nameOn && c.name) {
      html += `<div class="wm wm-name" style="left:${c.nameX * 100}%;top:${c.nameY * 100}%;opacity:${c.opacity}"><span style="font-family:${c.nameFamily};font-size:calc(0.95rem * ${c.nameScale})">${escHtml(c.name)}</span></div>`;
    }
    return html;
  },

  // Desenha a marca d'agua num canvas, dentro da regiao [x,y,w,h] (uma foto).
  drawWatermark(ctx, x, y, w, h, c, logoImg) {
    ctx.save();
    ctx.globalAlpha = c.opacity != null ? c.opacity : 1;
    if (c.logoOn && logoImg) {
      const lw = c.logoW * w;
      const lh = lw * (logoImg.naturalHeight / (logoImg.naturalWidth || 1));
      ctx.drawImage(logoImg, x + c.logoX * w, y + c.logoY * h, lw, lh);
    }
    if (c.nameOn && c.name) {
      const fontPx = Math.max(12, Math.round(h * 0.05 * c.nameScale));
      ctx.font = `700 ${fontPx}px ${c.nameFamily}`;
      ctx.textAlign = "left";
      ctx.textBaseline = "top";
      ctx.shadowColor = "rgba(0,0,0,0.7)";
      ctx.shadowBlur = Math.round(fontPx * 0.3);
      ctx.fillStyle = "#ffffff";
      ctx.fillText(c.name, x + c.nameX * w, y + c.nameY * h);
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
  ["#prof-name-font", "#prof-footer-font"].forEach((sel) => {
    const el = $(sel);
    Object.keys(FONT_LABELS).forEach((k) => {
      const o = document.createElement("option");
      o.value = k; o.textContent = FONT_LABELS[k]; el.appendChild(o);
    });
  });

  $("#cred-profile").addEventListener("click", () => Profile.open());
  const profBtn = $("#detail-profile");
  if (profBtn) profBtn.addEventListener("click", () => Profile.open());
  $("#prof-close").addEventListener("click", () => $("#profile-dialog").close());
  $("#prof-save").addEventListener("click", () => Profile.save());
  $("#prof-transp").addEventListener("input", (e) => {
    $("#prof-transp-val").textContent = e.target.value + "%";
    Profile._applyPreviewOpacity();
  });
  $("#prof-name-size").addEventListener("input", (e) => {
    $("#prof-name-size-val").textContent = e.target.value + "%";
    Profile._syncNameBox();
  });
  $("#prof-footer-size").addEventListener("input", (e) => {
    $("#prof-footer-size-val").textContent = e.target.value + "%";
  });
  $("#prof-name").addEventListener("input", () => Profile._syncNameBox());
  $("#prof-name-font").addEventListener("change", () => Profile._syncNameBox());
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

  // ---- Editor: arrastar logo (com alca de resize) e arrastar nome ----
  const logoBox = $("#prof-logo-box");
  const resize = $("#prof-resize");
  const nameBox = $("#prof-name-box");
  let mode = null, start = null;

  const onDown = (e, m) => {
    e.preventDefault();
    mode = m;
    const { sw, sh } = Profile._stageDims();
    start = { px: e.clientX, py: e.clientY, lx: Profile._lx, ly: Profile._ly,
      lw: Profile._lw, nx: Profile._nx, ny: Profile._ny, sw, sh };
    const tgt = m === "resize" ? resize : (m === "name" ? nameBox : logoBox);
    try { tgt.setPointerCapture(e.pointerId); } catch (_) {}
  };
  logoBox.addEventListener("pointerdown", (e) => { if (e.target === resize) return; onDown(e, "logo"); });
  resize.addEventListener("pointerdown", (e) => { e.stopPropagation(); onDown(e, "resize"); });
  nameBox.addEventListener("pointerdown", (e) => onDown(e, "name"));

  window.addEventListener("pointermove", (e) => {
    if (!mode || !start) return;
    if (mode === "logo") {
      Profile._lx = start.lx + (e.clientX - start.px) / start.sw;
      Profile._ly = start.ly + (e.clientY - start.py) / start.sh;
      Profile._layoutLogo();
    } else if (mode === "resize") {
      const dw = (e.clientX - start.px) / start.sw;
      Profile._lw = Math.max(0.05, Math.min(1.5, start.lw + dw));
      Profile._layoutLogo();
    } else if (mode === "name") {
      Profile._nx = start.nx + (e.clientX - start.px) / start.sw;
      Profile._ny = start.ny + (e.clientY - start.py) / start.sh;
      Profile._layoutName();
    }
  });
  const endDrag = () => { mode = null; start = null; };
  window.addEventListener("pointerup", endDrag);
  window.addEventListener("pointercancel", endDrag);
});
