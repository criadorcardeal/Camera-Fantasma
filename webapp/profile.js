"use strict";

/* =========================================================================
   Fotos Fantasma - v3.5.1 - Perfil do usuario (nome + logo).

   O nome e a logo podem ser "impressos" nas fotos (marca d'agua) em uma
   posicao fixa e com nivel de transparencia escolhidos. Config no localStorage.
   (Globais usados: $, escHtml, loadImageEl, refreshCompareCaptions.)
   ========================================================================= */
const Profile = {
  _sel: "br",     // posicao selecionada no dialogo
  _logo: "",      // dataURL da logo em edicao

  get() {
    try { return JSON.parse(localStorage.getItem("ff_profile")) || {}; }
    catch (_) { return {}; }
  },
  set(p) { localStorage.setItem("ff_profile", JSON.stringify(p)); },

  // Config normalizada para desenho/overlay.
  config() {
    const p = this.get();
    return {
      name: p.name || "",
      logo: p.logo || "",
      enabled: !!p.enabled,
      position: p.position || "br",
      opacity: p.opacity != null ? p.opacity : 0.7,
    };
  },

  open() {
    const p = this.get();
    $("#prof-name").value = p.name || "";
    this._logo = p.logo || "";
    this._refreshLogoPrev();
    $("#prof-enabled").checked = !!p.enabled;
    this._sel = p.position || "br";
    this._refreshPos();
    const transp = Math.round((1 - (p.opacity != null ? p.opacity : 0.7)) * 100);
    $("#prof-transp").value = transp;
    $("#prof-transp-val").textContent = transp + "%";
    $("#profile-dialog").showModal();
  },

  _refreshLogoPrev() {
    const img = $("#prof-logo-prev");
    if (this._logo) { img.src = this._logo; img.style.visibility = "visible"; }
    else { img.removeAttribute("src"); img.style.visibility = "hidden"; }
  },
  _refreshPos() {
    $("#prof-pos-grid").querySelectorAll("button").forEach((b) =>
      b.classList.toggle("sel", b.dataset.pos === this._sel));
  },

  save() {
    const transp = parseInt($("#prof-transp").value, 10) || 0;
    this.set({
      name: $("#prof-name").value.trim(),
      logo: this._logo || "",
      enabled: $("#prof-enabled").checked,
      position: this._sel,
      opacity: Math.max(0.05, 1 - transp / 100),
    });
    $("#profile-dialog").close();
    if (typeof refreshCompareCaptions === "function") refreshCompareCaptions();
  },

  // Marca d'agua para o palco de comparacao (tela). prof = config().
  wmHtml(prof) {
    if (!prof.enabled || (!prof.name && !prof.logo)) return "";
    const logo = prof.logo ? `<img src="${prof.logo}" alt="" />` : "";
    const name = prof.name ? `<span>${escHtml(prof.name)}</span>` : "";
    return `<div class="wm wm-${prof.position}" style="opacity:${prof.opacity}">${logo}${name}</div>`;
  },

  // Desenha a marca d'agua num canvas, dentro da regiao [x,y,w,h].
  drawWatermark(ctx, x, y, w, h, prof, logoImg) {
    if (!prof || !prof.enabled) return;
    if (!prof.name && !logoImg) return;
    const pad = Math.max(8, Math.round(h * 0.025));
    const logoH = logoImg ? Math.max(24, Math.round(h * 0.10)) : 0;
    const logoW = logoImg ? Math.round(logoH * (logoImg.naturalWidth / (logoImg.naturalHeight || 1))) : 0;
    const fontPx = Math.max(14, Math.round(h * 0.045));
    ctx.save();
    ctx.globalAlpha = prof.opacity != null ? prof.opacity : 1;
    ctx.font = `700 ${fontPx}px -apple-system, Arial, sans-serif`;
    const gap = (prof.name && logoImg) ? Math.round(pad * 0.6) : 0;
    const textW = prof.name ? Math.ceil(ctx.measureText(prof.name).width) : 0;
    const blockW = logoW + gap + textW;
    const blockH = Math.max(logoH, prof.name ? fontPx : 0);
    const col = prof.position[1]; // l | c | r
    const row = prof.position[0]; // t | m | b
    const bx = col === "l" ? x + pad : col === "r" ? x + w - pad - blockW : x + (w - blockW) / 2;
    const by = row === "t" ? y + pad : row === "b" ? y + h - pad - blockH : y + (h - blockH) / 2;
    if (logoImg) ctx.drawImage(logoImg, bx, by + (blockH - logoH) / 2, logoW, logoH);
    if (prof.name) {
      ctx.textAlign = "left";
      ctx.textBaseline = "middle";
      ctx.shadowColor = "rgba(0,0,0,0.7)";
      ctx.shadowBlur = Math.round(fontPx * 0.25);
      ctx.fillStyle = "#ffffff";
      ctx.fillText(prof.name, bx + logoW + gap, by + blockH / 2);
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
  $("#cred-profile").addEventListener("click", () => Profile.open());
  $("#prof-close").addEventListener("click", () => $("#profile-dialog").close());
  $("#prof-save").addEventListener("click", () => Profile.save());
  $("#prof-pos-grid").querySelectorAll("button").forEach((b) =>
    b.addEventListener("click", () => { Profile._sel = b.dataset.pos; Profile._refreshPos(); }));
  $("#prof-transp").addEventListener("input", (e) => {
    $("#prof-transp-val").textContent = e.target.value + "%";
  });
  $("#prof-logo-remove").addEventListener("click", () => { Profile._logo = ""; Profile._refreshLogoPrev(); });
  $("#prof-logo-pick").addEventListener("click", () => {
    const inp = document.createElement("input");
    inp.type = "file"; inp.accept = "image/*";
    inp.onchange = async () => {
      const f = inp.files && inp.files[0];
      if (!f) return;
      try { Profile._logo = await downscaleLogo(f, 400); Profile._refreshLogoPrev(); }
      catch (e) { alert(e.message || "Não foi possível usar esta imagem."); }
    };
    inp.click();
  });
});
