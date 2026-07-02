"use strict";

/* =========================================================================
   Fotos Fantasma - versao web (PWA) - versao gratuita
   Funciona no Safari (iPhone) e Chrome. Tudo fica no proprio aparelho.
   ========================================================================= */

/* ---------------- Armazenamento local (IndexedDB) ---------------- */
const DB = {
  _db: null,
  open() {
    return new Promise((resolve, reject) => {
      if (this._db) return resolve(this._db);
      const req = indexedDB.open("fotos_fantasma", 1);
      req.onupgradeneeded = () => {
        req.result.createObjectStore("sessions", { keyPath: "id" });
      };
      req.onsuccess = () => { this._db = req.result; resolve(this._db); };
      req.onerror = () => reject(req.error);
    });
  },
  async _tx(mode) {
    const db = await this.open();
    return db.transaction("sessions", mode).objectStore("sessions");
  },
  async getAll() {
    const store = await this._tx("readonly");
    return new Promise((resolve, reject) => {
      const req = store.getAll();
      req.onsuccess = () => {
        const list = req.result || [];
        list.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
        resolve(list);
      };
      req.onerror = () => reject(req.error);
    });
  },
  async get(id) {
    const store = await this._tx("readonly");
    return new Promise((resolve, reject) => {
      const req = store.get(id);
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
  },
  async put(session) {
    const store = await this._tx("readwrite");
    return new Promise((resolve, reject) => {
      const req = store.put(session);
      req.onsuccess = () => resolve();
      req.onerror = () => reject(req.error);
    });
  },
  async remove(id) {
    const store = await this._tx("readwrite");
    return new Promise((resolve, reject) => {
      const req = store.delete(id);
      req.onsuccess = () => resolve();
      req.onerror = () => reject(req.error);
    });
  },
};

/* ---------------- Utilidades ---------------- */
const $ = (sel) => document.querySelector(sel);
const fmtDate = (iso) => {
  const d = new Date(iso);
  const p = (n) => String(n).padStart(2, "0");
  return `${p(d.getDate())}/${p(d.getMonth() + 1)}/${d.getFullYear()} ${p(d.getHours())}:${p(d.getMinutes())}`;
};

// Usa a versao com ajustes aplicados (se existir) ou a original.
const baseSrc = (s) => s.baseImageView || s.baseImage;
const followSrc = (s) => s.followImageView || s.followImage;

// Aplica brilho/contraste/saturacao (mesma semantica do CSS filter) direto nos
// pixels de um canvas. Usado na CAPTURA porque em alguns iPhones o ctx.filter
// nao surte efeito — assim o ajuste sempre fica "impresso" na foto.
function bakeCameraFilter(ctx, w, h, f) {
  const b = f.brightness, c = f.contrast, sat = f.saturate;
  if (Math.abs(b - 1) < 0.005 && Math.abs(c - 1) < 0.005 && Math.abs(sat - 1) < 0.005) return;
  const img = ctx.getImageData(0, 0, w, h);
  const d = img.data;
  for (let i = 0; i < d.length; i += 4) {
    let r = d[i], g = d[i + 1], bl = d[i + 2];
    // brilho
    r *= b; g *= b; bl *= b;
    // contraste (ponto medio 127.5, como o CSS)
    r = (r - 127.5) * c + 127.5;
    g = (g - 127.5) * c + 127.5;
    bl = (bl - 127.5) * c + 127.5;
    // saturacao (luminancia Rec.709, como o CSS)
    const l = 0.2126 * r + 0.7152 * g + 0.0722 * bl;
    r = l + (r - l) * sat;
    g = l + (g - l) * sat;
    bl = l + (bl - l) * sat;
    d[i] = r < 0 ? 0 : r > 255 ? 255 : r;
    d[i + 1] = g < 0 ? 0 : g > 255 ? 255 : g;
    d[i + 2] = bl < 0 ? 0 : bl > 255 ? 255 : bl;
  }
  ctx.putImageData(img, 0, 0);
}

const escHtml = (v) => String(v == null ? "" : v)
  .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
const escAttr = (v) => escHtml(v).replace(/"/g, "&quot;");

function showScreen(id) {
  document.querySelectorAll(".screen").forEach((s) => s.classList.remove("active"));
  $("#" + id).classList.add("active");
}

/* ---------------- Tela inicial ---------------- */
async function renderHome() {
  const list = await DB.getAll();
  const el = $("#home-list");
  if (list.length === 0) {
    el.innerHTML = `
      <div class="empty">
        <div class="big">📷</div>
        <h2>Nenhuma comparação ainda</h2>
        <p>Toque em "Nova comparação" para registrar a primeira foto
        (tirar ou importar). Na próxima consulta, use o Ghost Overlay para
        tirar a foto de acompanhamento no mesmo enquadramento.</p>
      </div>`;
    return;
  }
  el.innerHTML = "";
  for (const s of list) {
    const card = document.createElement("div");
    card.className = "card";
    card.innerHTML = `
      <img src="${baseSrc(s)}" alt="" />
      <div class="info">
        <b>Comparação de ${fmtDate(s.createdAt)}</b>
        <span>${s.followImage ? "Base + acompanhamento" : "Só foto base"} • ${Math.round(s.baseDistance)} cm</span>
      </div>
      <div>${s.followImage ? "🔀" : "➕"}</div>`;
    card.addEventListener("click", () => openDetail(s.id));
    el.appendChild(card);
  }
}

/* ---------------- Câmera ---------------- */
const Cam = {
  stream: null,
  track: null,
  mode: "base",      // "base" | "follow"
  session: null,     // sessao em edicao (modo follow)
  target: null,      // distancia-alvo
  torchOn: false,

  filters() {
    return {
      brightness: parseFloat($("#f-brightness").value),
      contrast: parseFloat($("#f-contrast").value),
      saturate: parseFloat($("#f-saturate").value),
    };
  },
  filterString(f) {
    return `brightness(${f.brightness}) contrast(${f.contrast}) saturate(${f.saturate})`;
  },
  isNeutral(f) {
    return Math.abs(f.brightness - 1) < 0.005 &&
           Math.abs(f.contrast - 1) < 0.005 &&
           Math.abs(f.saturate - 1) < 0.005;
  },

  applyLiveFilter() {
    // Atualiza os rotulos dos sliders.
    const set = (id, name) => {
      const inp = $(id);
      inp.parentElement.querySelector("span").textContent =
        name + " " + parseFloat(inp.value).toFixed(2);
    };
    set("#f-brightness", "Brilho");
    set("#f-contrast", "Contraste");
    set("#f-saturate", "Saturação");

    // Pre-visualizacao ao vivo: aplicar filtro CSS direto no <video> deixa a
    // imagem preta no iOS. A solucao e ESPELHAR o video num canvas e aplicar o
    // filtro CSS no canvas (elemento), o que funciona no Safari. Enquanto o
    // ajuste esta neutro, mostramos o video puro (mais fluido).
    const f = this.filters();
    const fx = $("#cam-fx");
    if (this.isNeutral(f)) {
      this.stopPreview();
      fx.hidden = true;
    } else {
      fx.style.filter = this.filterString(f);
      fx.hidden = false;
      this.startPreview();
    }
  },

  startPreview() {
    if (this._previewRAF) return;
    const video = $("#video");
    const fx = $("#cam-fx");
    const ctx = fx.getContext("2d");
    let last = 0;
    const loop = (t) => {
      this._previewRAF = requestAnimationFrame(loop);
      if (fx.hidden || !video.videoWidth) return;
      if (t - last < 40) return;           // ~24 fps
      last = t;
      // Canvas em baixa resolucao (lado maior ~480) so p/ espelhar o video.
      const scale = Math.min(1, 480 / Math.max(video.videoWidth, video.videoHeight));
      const w = Math.round(video.videoWidth * scale);
      const h = Math.round(video.videoHeight * scale);
      if (fx.width !== w || fx.height !== h) { fx.width = w; fx.height = h; }
      ctx.drawImage(video, 0, 0, w, h);     // sem filtro no contexto: o filtro
                                            // vai no CSS do elemento canvas.
    };
    this._previewRAF = requestAnimationFrame(loop);
  },

  stopPreview() {
    if (this._previewRAF) {
      cancelAnimationFrame(this._previewRAF);
      this._previewRAF = null;
    }
  },

  async open(mode, session) {
    this.mode = mode;
    this.session = session || null;
    this.torchOn = false;

    // Ghost overlay + filtros iniciais
    const ghost = $("#ghost");
    if (mode === "follow" && session) {
      ghost.src = session.baseImage;
      ghost.style.display = "block";
      $("#ghost-wrap").style.display = "flex";
      this.target = session.baseDistance;
      $("#cam-title").textContent = "Foto de acompanhamento";
      const f = session.filters || { brightness: 1, contrast: 1, saturate: 1 };
      $("#f-brightness").value = f.brightness;
      $("#f-contrast").value = f.contrast;
      $("#f-saturate").value = f.saturate;
      $("#distance-chip").textContent =
        `Distância-alvo: ${Math.round(this.target)} cm (mantenha 40–60 cm)`;
    } else {
      ghost.removeAttribute("src");
      ghost.style.display = "none";
      $("#ghost-wrap").style.display = "none";
      this.target = null;
      $("#cam-title").textContent = "Foto base";
      $("#f-brightness").value = 1;
      $("#f-contrast").value = 1;
      $("#f-saturate").value = 1;
      $("#distance-chip").textContent = "Mantenha 40–60 cm do local";
    }
    $("#ghost").style.opacity = $("#ghost-opacity").value;
    this.applyLiveFilter();
    $("#cam-error").hidden = true;

    showScreen("screen-camera");
    await this.start();
  },

  async start() {
    const video = $("#video");
    // Propriedades exigidas pelo iOS para tocar o video da camera inline.
    video.muted = true;
    video.setAttribute("playsinline", "");
    video.setAttribute("autoplay", "");
    $("#cam-start").hidden = true;
    try {
      this.stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: { ideal: "environment" } },
        audio: false,
      });
      video.srcObject = this.stream;
      this.track = this.stream.getVideoTracks()[0];
      this.setupTorchButton();

      // Tenta tocar (no iOS o play() pode "rejeitar" mesmo indo tocar, entao
      // ignoramos o erro aqui e verificamos de verdade logo depois).
      const tryPlay = () => {
        const pr = video.play();
        if (pr && pr.catch) pr.catch(() => {});
      };
      video.onloadedmetadata = tryPlay;
      tryPlay();
      // So mostra o botao manual se, apos 1s, o video realmente nao tocou.
      setTimeout(() => {
        if (video.paused || !video.videoWidth) {
          this.showStartButton();
        } else {
          $("#cam-start").hidden = true;
        }
      }, 1000);
    } catch (e) {
      this.showError(
        "Não foi possível acessar a câmera. Verifique a permissão da câmera " +
        "para este site nas configurações do navegador.\n\n(" + e.message + ")"
      );
    }
  },

  showStartButton() {
    $("#cam-start").hidden = false;
  },

  setupTorchButton() {
    const btn = $("#cam-torch");
    let supported = false;
    try {
      const caps = this.track.getCapabilities ? this.track.getCapabilities() : {};
      supported = !!caps.torch;
    } catch (_) { supported = false; }
    if (supported) {
      btn.classList.remove("disabled");
      btn.title = "Lanterna";
    } else {
      // iOS Safari nao permite controlar a lanterna pela pagina.
      btn.classList.add("disabled");
      btn.title = "Lanterna não disponível neste navegador (use luz natural/branca)";
    }
    this._torchSupported = supported;
  },

  async toggleTorch() {
    if (!this._torchSupported) {
      this.flash("Lanterna indisponível no Safari/iPhone. Use luz natural ou branca do ambiente.");
      return;
    }
    this.torchOn = !this.torchOn;
    try {
      await this.track.applyConstraints({ advanced: [{ torch: this.torchOn }] });
      $("#cam-torch").classList.toggle("on", this.torchOn);
    } catch (_) {}
  },

  stop() {
    this.stopPreview();
    $("#cam-fx").hidden = true;
    if (this.stream) {
      this.stream.getTracks().forEach((t) => t.stop());
      this.stream = null;
      this.track = null;
    }
    $("#video").srcObject = null;
  },

  showError(msg) {
    const el = $("#cam-error");
    el.textContent = msg;
    el.hidden = false;
  },

  flash(msg) {
    const el = $("#distance-chip");
    const old = el.textContent;
    el.textContent = msg;
    setTimeout(() => { el.textContent = old; }, 2600);
  },

  async shoot() {
    const video = $("#video");
    if (!video.videoWidth) {
      this.flash("Câmera ainda carregando… aguarde 1 segundo e toque de novo.");
      try { await video.play(); } catch (_) {}
      return;
    }
    const canvas = $("#canvas");
    canvas.width = video.videoWidth;
    canvas.height = video.videoHeight;
    const ctx = canvas.getContext("2d");
    const f = this.filters();
    ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
    // "Imprime" brilho/contraste/saturacao nos pixels (confiavel em todo iPhone).
    bakeCameraFilter(ctx, canvas.width, canvas.height, f);
    const dataUrl = canvas.toDataURL("image/jpeg", 0.92);

    const seed = this.mode === "base"
      ? (this.session && this.session.baseLabel) || ""
      : (this.session && this.session.followLabel) || "";
    const res = await openDistanceDialog(this.target, seed);
    if (res == null) return; // usuario escolheu refazer
    const { distance, label } = res;

    if (this.mode === "base") {
      const session = {
        id: String(Date.now()),
        createdAt: new Date().toISOString(),
        baseImage: dataUrl,
        baseDistance: distance,
        baseLabel: label,
        followLabel: "",
        showLabels: true,
        filters: f,
        followImage: null,
        followDistance: null,
        followAt: null,
        creditState: "reserved",
      };
      await DB.put(session);
      Credits.reserve();
      this.stop();
      await openDetail(session.id);
    } else {
      const s = this.session;
      s.followImage = dataUrl;
      s.followDistance = distance;
      s.followLabel = label;
      s.followAt = new Date().toISOString();
      await DB.put(s);
      this.stop();
      await openDetail(s.id);
    }
  },
};

/* ---------------- Importar foto (galeria / nuvem via Arquivos) ---------------- */

// Reduz a imagem para no maximo `maxSize` px no maior lado e devolve um JPEG
// em dataURL. Evita guardar fotos enormes (12MP) no aparelho.
function downscaleImage(file, maxSize) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const img = new Image();
      img.onload = () => {
        let w = img.naturalWidth || img.width;
        let h = img.naturalHeight || img.height;
        const scale = Math.min(1, maxSize / Math.max(w, h));
        w = Math.round(w * scale);
        h = Math.round(h * scale);
        const c = document.createElement("canvas");
        c.width = w;
        c.height = h;
        c.getContext("2d").drawImage(img, 0, 0, w, h);
        resolve(c.toDataURL("image/jpeg", 0.9));
      };
      img.onerror = () => reject(new Error("Não foi possível ler a imagem."));
      img.src = reader.result;
    };
    reader.onerror = () => reject(new Error("Falha ao abrir o arquivo."));
    reader.readAsDataURL(file);
  });
}

// Abre o seletor de arquivos (galeria/nuvem via app Arquivos no iOS) e
// devolve o arquivo escolhido. Criado sob demanda dentro do gesto do usuario.
function pickImage() {
  return new Promise((resolve) => {
    const inp = document.createElement("input");
    inp.type = "file";
    inp.accept = "image/*";
    inp.onchange = () => resolve(inp.files && inp.files[0]);
    inp.click();
  });
}

async function importFollowPhoto(session, file) {
  if (!file) return;
  let dataUrl;
  try {
    dataUrl = await downscaleImage(file, 1600);
  } catch (e) {
    alert(e.message || "Não foi possível usar esta imagem.");
    return;
  }
  // Abre a janela de alinhamento (posicionar/zoom sobre a base fantasma).
  // Ela cuida da distancia e do salvamento ao confirmar.
  Aligner.open(session, dataUrl);
}

async function importBasePhoto(file) {
  if (!file) return;
  let dataUrl;
  try {
    dataUrl = await downscaleImage(file, 1600);
  } catch (e) {
    alert(e.message || "Não foi possível usar esta imagem.");
    return;
  }
  const res = await openDistanceDialog(null, "");
  if (res == null) return;
  const session = {
    id: String(Date.now()),
    createdAt: new Date().toISOString(),
    baseImage: dataUrl,
    baseDistance: res.distance,
    baseLabel: res.label,
    followLabel: "",
    showLabels: true,
    filters: { brightness: 1, contrast: 1, saturate: 1 },
    followImage: null,
    followDistance: null,
    followAt: null,
    creditState: "reserved",
  };
  await DB.put(session);
  Credits.reserve();
  await openDetail(session.id);
}

/* ---------------- Diálogo de distância + rótulo ----------------
   Resolve { distance, label } ou null (usuário escolheu refazer). */
function openDistanceDialog(target, labelValue) {
  return new Promise((resolve) => {
    const dlg = $("#dist-dialog");
    const input = $("#dist-input");
    const labelInp = $("#dist-label");
    const tEl = $("#dist-target");
    input.value = target != null ? Math.round(target) : 50;
    labelInp.value = labelValue || "";
    if (target != null) {
      tEl.hidden = false;
      tEl.textContent = `Meta para igualar a foto base: ${Math.round(target)} cm`;
    } else {
      tEl.hidden = true;
    }
    const onClose = () => {
      dlg.removeEventListener("close", onClose);
      if (dlg.returnValue === "ok") {
        const v = parseFloat(String(input.value).replace(",", "."));
        resolve({
          distance: isNaN(v) ? (target != null ? target : 50) : v,
          label: labelInp.value.trim(),
        });
      } else {
        resolve(null);
      }
    };
    dlg.addEventListener("close", onClose);
    dlg.showModal();
  });
}

/* ---------------- Tela de detalhe / comparação ---------------- */
let _detailSession = null;

async function openDetail(id) {
  const s = await DB.get(id);
  if (!s) { showScreen("screen-home"); await renderHome(); return; }
  _detailSession = s;
  const c = $("#detail-content");

  const hasFollow = !!s.followImage;

  const compareHtml = hasFollow
    ? `<div class="seg" id="cmp-seg">
         <button data-mode="curtain" class="active">Cortina</button>
         <button data-mode="side">Lado a lado</button>
         <button data-mode="overlay">Sobrepor</button>
       </div>
       <div id="cmp-host"></div>`
    : `<div class="compare-stage" id="cmp-host"><img src="${baseSrc(s)}" style="object-fit:contain" />${capHtml(s.baseLabel, "cap-center", s.showLabels)}${Profile.wmHtml(Profile.config())}</div>`;

  const statusTxt = s.creditState === "confirmed"
    ? "Concluída ✓ (crédito usado)"
    : s.creditState === "reserved"
      ? "Em aberto — salve para concluir"
      : "—";

  const infoHtml = `
    <div class="info-block" id="info-block">
      <div class="info-head" id="info-head">
        <b>Status:</b><span class="status-txt">${statusTxt}</span>
        <span class="chev">▾</span>
      </div>
      <div class="info-rows">
        <div class="row"><b>Foto base</b><span>${fmtDate(s.createdAt)} • ${Math.round(s.baseDistance)} cm</span></div>
        ${hasFollow ? `<div class="row"><b>Acompanhamento</b><span>${fmtDate(s.followAt)} • ${Math.round(s.followDistance)} cm</span></div>` : ""}
        <div class="row"><b>Captura (câmera)</b><span>Brilho ${s.filters.brightness.toFixed(2)} • Contraste ${s.filters.contrast.toFixed(2)} • Saturação ${s.filters.saturate.toFixed(2)}</span></div>
      </div>
    </div>`;

  const labelHtml = `
    <div class="label-card">
      <label class="label-toggle">
        <input type="checkbox" id="lbl-toggle" ${s.showLabels ? "checked" : ""} />
        <span>Mostrar rótulo no rodapé das fotos</span>
      </label>
      <div class="label-fields ${s.showLabels ? "" : "hidden-soft"}" id="lbl-fields">
        <label>Rótulo da foto base
          <input type="text" id="lbl-base" value="${escAttr(s.baseLabel || "")}" placeholder="Ex.: Perna direita" autocomplete="off" />
        </label>
        ${hasFollow ? `<label>Rótulo do acompanhamento
          <input type="text" id="lbl-follow" value="${escAttr(s.followLabel || "")}" placeholder="Ex.: Perna direita" autocomplete="off" />
        </label>` : ""}
      </div>
    </div>`;

  const acCard = `
    <div class="act-card">
      <div class="act-title">Acompanhamento</div>
      <div class="btn-row">
        <button class="btn outline" id="btn-redo">${hasFollow ? "📷 Refazer" : "📷 Tirar"}</button>
        <button class="btn outline" id="btn-follow-import">🖼 Importar</button>
      </div>
    </div>`;

  const secondRow = `
    <div class="btn-row" style="margin-top:12px">
      ${hasFollow ? `<button class="btn primary" id="btn-adjust">🎚 Ajustar imagens</button>` : ""}
      <button class="btn primary" id="btn-share">📤 Salvar</button>
    </div>`;

  c.innerHTML = compareHtml + infoHtml + labelHtml + acCard + secondRow;

  // Ativa a tela ANTES de montar a comparação, para o palco já ter largura
  // (a cortina depende de clientWidth para dimensionar a foto de acompanhamento).
  showScreen("screen-detail");

  if (hasFollow) {
    renderCompare("curtain");
    $("#cmp-seg").querySelectorAll("button").forEach((b) => {
      b.addEventListener("click", () => {
        $("#cmp-seg").querySelectorAll("button").forEach((x) => x.classList.remove("active"));
        b.classList.add("active");
        renderCompare(b.dataset.mode);
      });
    });
    $("#btn-adjust").addEventListener("click", () => Editor.open(s));
  }
  $("#btn-redo").addEventListener("click", () => Cam.open("follow", s));
  $("#btn-follow-import").addEventListener("click", () =>
    pickImage().then((file) => importFollowPhoto(s, file)));
  $("#btn-share").addEventListener("click", () => Share.open(s));

  // Card de dados recolhível (recolhido mostra só o Status).
  $("#info-head").addEventListener("click", () => $("#info-block").classList.toggle("open"));

  // Rótulos: liga/desliga rodapé e edição por comparação.
  $("#lbl-toggle").addEventListener("change", async (e) => {
    s.showLabels = e.target.checked;
    $("#lbl-fields").classList.toggle("hidden-soft", !s.showLabels);
    await DB.put(s);
    refreshCompareCaptions();
  });
  const onLabelInput = async (key, val) => { s[key] = val.trim(); await DB.put(s); refreshCompareCaptions(); };
  $("#lbl-base").addEventListener("input", (e) => onLabelInput("baseLabel", e.target.value));
  if (hasFollow) $("#lbl-follow").addEventListener("input", (e) => onLabelInput("followLabel", e.target.value));
}

// Legenda (rodapé) opcional dentro do palco de comparação (com fonte do perfil).
function capHtml(text, cls, show) {
  if (!(show && text)) return "";
  const c = Profile.config();
  return `<div class="cap ${cls}" style="font-family:${c.footerFamily};font-size:calc(0.72rem * ${c.footerScale})">${escHtml(text)}</div>`;
}

// Recolhe o modo de comparação ativo e re-renderiza (para atualizar legendas).
function refreshCompareCaptions() {
  const s = _detailSession;
  if (!s) return;
  if (!s.followImage) {
    const host = $("#cmp-host");
    if (host) host.innerHTML = `<img src="${baseSrc(s)}" style="object-fit:contain" />${capHtml(s.baseLabel, "cap-center", s.showLabels)}${Profile.wmHtml(Profile.config())}`;
    return;
  }
  const active = $("#cmp-seg") && $("#cmp-seg").querySelector("button.active");
  renderCompare(active ? active.dataset.mode : "curtain");
}

function renderCompare(mode) {
  const s = _detailSession;
  const host = $("#cmp-host");
  const show = s.showLabels;
  const capB = capHtml(s.baseLabel, "cap-left", show);
  const capF = capHtml(s.followLabel, "cap-right", show);
  const wm = Profile.wmHtml(Profile.config());
  if (mode === "side") {
    host.innerHTML = `<div class="side-by-side">
        <div class="side-cell"><img src="${baseSrc(s)}" />${capHtml(s.baseLabel, "cap-center", show)}${wm}</div>
        <div class="side-cell"><img src="${followSrc(s)}" />${capHtml(s.followLabel, "cap-center", show)}${wm}</div>
      </div>`;
    return;
  }
  if (mode === "overlay") {
    host.innerHTML = `
      <div class="compare-stage">
        <img src="${baseSrc(s)}" />
        <img src="${followSrc(s)}" id="ov-after" style="opacity:0.5" />
        ${capB}${capF}${wm}
      </div>
      <div class="seg" style="margin-top:8px;background:transparent;padding:0">
        <input type="range" min="0" max="1" step="0.01" value="0.5" id="ov-range" style="width:100%" />
      </div>`;
    $("#ov-range").addEventListener("input", (e) => {
      $("#ov-after").style.opacity = e.target.value;
    });
    return;
  }
  // cortina (curtain)
  host.innerHTML = `
    <div class="compare-stage" id="curtain">
      <img src="${baseSrc(s)}" />
      <div class="after-clip" style="position:absolute;inset:0;width:50%"><img src="${followSrc(s)}" style="width:200%;max-width:none" id="cur-after"/></div>
      <div class="compare-handle" id="cur-handle" style="left:50%"></div>
      ${capB}${capF}${wm}
    </div>`;
  const stage = $("#curtain");
  const clip = stage.querySelector(".after-clip");
  const after = $("#cur-after");
  const handle = $("#cur-handle");
  const setSplit = (ratio) => {
    ratio = Math.max(0, Math.min(1, ratio));
    const w = stage.clientWidth;
    clip.style.width = (ratio * 100) + "%";
    after.style.width = w + "px";
    after.style.maxWidth = "none";
    handle.style.left = (ratio * 100) + "%";
  };
  setSplit(0.5);
  let dragging = false;
  const pos = (e) => {
    const rect = stage.getBoundingClientRect();
    const x = (e.touches ? e.touches[0].clientX : e.clientX) - rect.left;
    setSplit(x / rect.width);
  };
  stage.addEventListener("pointerdown", (e) => { dragging = true; pos(e); });
  stage.addEventListener("pointermove", (e) => { if (dragging) pos(e); });
  window.addEventListener("pointerup", () => { dragging = false; });
}

/* ---------------- Eventos globais ---------------- */
function wireEvents() {
  $("#btn-compare").addEventListener("click", () => {
    if (!Credits.canStart()) {
      Credits.promptBuy("Você está sem créditos. Compre para fazer uma nova comparação.");
      return;
    }
    $("#new-dialog").showModal();
  });
  $("#new-camera").addEventListener("click", () => { $("#new-dialog").close(); Cam.open("base"); });
  $("#new-import").addEventListener("click", () => { $("#new-dialog").close(); $("#import-input").click(); });
  $("#new-close").addEventListener("click", () => $("#new-dialog").close());
  $("#import-input").addEventListener("change", async (e) => {
    const file = e.target.files && e.target.files[0];
    e.target.value = ""; // permite reimportar o mesmo arquivo depois
    await importBasePhoto(file);
  });
  $("#cam-close").addEventListener("click", async () => {
    Cam.stop();
    showScreen("screen-home");
    await renderHome();
  });
  $("#cam-shoot").addEventListener("click", () => Cam.shoot());
  $("#cam-torch").addEventListener("click", () => Cam.toggleTorch());
  $("#cam-start").querySelector("button").addEventListener("click", async () => {
    $("#cam-start").hidden = true;
    try { await $("#video").play(); } catch (_) {}
  });
  $("#ghost-opacity").addEventListener("input", (e) => {
    $("#ghost").style.opacity = e.target.value;
  });
  ["#f-brightness", "#f-contrast", "#f-saturate"].forEach((sel) => {
    $(sel).addEventListener("input", () => Cam.applyLiveFilter());
  });

  $("#detail-back").addEventListener("click", async () => {
    showScreen("screen-home");
    await renderHome();
  });
  $("#detail-delete").addEventListener("click", async () => {
    if (!_detailSession) return;
    if (confirm("Excluir esta comparação? As fotos serão apagadas do aparelho.")) {
      // Devolve o crédito se a comparação não foi concluída (abandonada).
      if (_detailSession.creditState === "reserved") Credits.refund();
      await DB.remove(_detailSession.id);
      _detailSession = null;
      showScreen("screen-home");
      await renderHome();
    }
  });
}

/* ---------------- Início ---------------- */
window.addEventListener("DOMContentLoaded", async () => {
  wireEvents();
  await renderHome();
  if ("serviceWorker" in navigator) {
    // Recarrega SOMENTE quando o novo Service Worker efetivamente ASSUME a pagina
    // (evento controllerchange). O sw.js faz skipWaiting()+clients.claim(), entao
    // ao instalar uma versao nova ele assume na hora e dispara este evento -> ai
    // recarregamos e a pagina passa a ser servida pelo worker novo (nao pelo
    // antigo). Corrige o iOS "standalone", onde recarregar no estado 'installed'
    // (worker antigo ainda no controle) mantinha a versao velha.
    // Nao recarrega na primeira instalacao: se nao havia controller ao carregar,
    // o controllerchange e apenas o claim inicial.
    const hadController = !!navigator.serviceWorker.controller;
    let refreshing = false;
    navigator.serviceWorker.addEventListener("controllerchange", () => {
      if (refreshing || !hadController) return;
      refreshing = true;
      window.location.reload();
    });
    // updateViaCache:none -> o navegador sempre busca o sw.js fresco.
    navigator.serviceWorker.register("./sw.js", { updateViaCache: "none" })
      .then((reg) => {
        reg.update().catch(() => {});
        // Verifica atualizacao toda vez que o app volta para o primeiro plano.
        document.addEventListener("visibilitychange", () => {
          if (document.visibilityState === "visible") reg.update().catch(() => {});
        });
      })
      .catch(() => {});
  }
});
