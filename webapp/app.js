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
        <p>Toque em "Nova foto base" para registrar a primeira foto.
        Na próxima consulta, use o Ghost Overlay para tirar a foto de
        acompanhamento no mesmo enquadramento.</p>
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
  applyLiveFilter() {
    // No iOS/Safari, aplicar filtro CSS direto no <video> ao vivo deixa a
    // imagem preta. Por isso o ajuste NAO vai no preview: ele e "impresso" na
    // foto no momento da captura. Aqui so atualizamos os rotulos dos sliders.
    const set = (id, name) => {
      const inp = $(id);
      inp.parentElement.querySelector("span").textContent =
        name + " " + parseFloat(inp.value).toFixed(2);
    };
    set("#f-brightness", "Brilho");
    set("#f-contrast", "Contraste");
    set("#f-saturate", "Saturação");
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
    // ctx.filter "imprime" o ajuste de brilho/contraste/saturacao na imagem
    // final (suportado no Safari 17+). Se nao suportado, a foto sai sem o
    // ajuste, mas o preview ja mostrava o resultado.
    try { ctx.filter = this.filterString(f); } catch (_) {}
    ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
    const dataUrl = canvas.toDataURL("image/jpeg", 0.92);

    const distance = await openDistanceDialog(this.target);
    if (distance == null) return; // usuario escolheu refazer

    if (this.mode === "base") {
      const session = {
        id: String(Date.now()),
        createdAt: new Date().toISOString(),
        baseImage: dataUrl,
        baseDistance: distance,
        filters: f,
        followImage: null,
        followDistance: null,
        followAt: null,
      };
      await DB.put(session);
      this.stop();
      await openDetail(session.id);
    } else {
      const s = this.session;
      s.followImage = dataUrl;
      s.followDistance = distance;
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
  const distance = await openDistanceDialog(session.baseDistance);
  if (distance == null) return;
  session.followImage = dataUrl;
  session.followDistance = distance;
  session.followAt = new Date().toISOString();
  // A imagem mudou: descarta ajustes/versao anteriores do acompanhamento.
  session.followImageView = null;
  session.followAdj = null;
  await DB.put(session);
  await openDetail(session.id);
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
  const distance = await openDistanceDialog(null);
  if (distance == null) return;
  const session = {
    id: String(Date.now()),
    createdAt: new Date().toISOString(),
    baseImage: dataUrl,
    baseDistance: distance,
    filters: { brightness: 1, contrast: 1, saturate: 1 },
    followImage: null,
    followDistance: null,
    followAt: null,
  };
  await DB.put(session);
  await openDetail(session.id);
}

/* ---------------- Diálogo de distância ---------------- */
function openDistanceDialog(target) {
  return new Promise((resolve) => {
    const dlg = $("#dist-dialog");
    const input = $("#dist-input");
    const tEl = $("#dist-target");
    input.value = target != null ? Math.round(target) : 50;
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
        resolve(isNaN(v) ? (target != null ? target : 50) : v);
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

  const compareHtml = s.followImage
    ? `<div class="seg" id="cmp-seg">
         <button data-mode="curtain" class="active">Cortina</button>
         <button data-mode="side">Lado a lado</button>
         <button data-mode="overlay">Sobrepor</button>
       </div>
       <div id="cmp-host"></div>`
    : `<div class="compare-stage"><img src="${baseSrc(s)}" style="object-fit:contain" /></div>`;

  const infoHtml = `
    <div class="info-block">
      <div class="row"><b>Foto base</b><span>${fmtDate(s.createdAt)} • ${Math.round(s.baseDistance)} cm</span></div>
      ${s.followImage ? `<div class="row"><b>Acompanhamento</b><span>${fmtDate(s.followAt)} • ${Math.round(s.followDistance)} cm</span></div>` : ""}
      <div class="row"><b>Captura (câmera)</b><span>Brilho ${s.filters.brightness.toFixed(2)} • Contraste ${s.filters.contrast.toFixed(2)} • Saturação ${s.filters.saturate.toFixed(2)}</span></div>
    </div>`;

  const btnHtml = s.followImage
    ? `<button class="btn primary" id="btn-adjust">🎚 Ajustar imagens</button>
       <button class="btn outline" id="btn-redo">📷 Refazer acompanhamento</button>
       <button class="btn outline" id="btn-follow-import">🖼 Importar acompanhamento</button>`
    : `<button class="btn primary" id="btn-follow">📷 Tirar foto de acompanhamento</button>
       <button class="btn outline" id="btn-follow-import">🖼 Importar acompanhamento</button>`;

  c.innerHTML = compareHtml + infoHtml + btnHtml;

  if (s.followImage) {
    renderCompare("curtain");
    $("#cmp-seg").querySelectorAll("button").forEach((b) => {
      b.addEventListener("click", () => {
        $("#cmp-seg").querySelectorAll("button").forEach((x) => x.classList.remove("active"));
        b.classList.add("active");
        renderCompare(b.dataset.mode);
      });
    });
    $("#btn-adjust").addEventListener("click", () => Editor.open(s));
    $("#btn-redo").addEventListener("click", () => Cam.open("follow", s));
  } else {
    $("#btn-follow").addEventListener("click", () => Cam.open("follow", s));
  }
  $("#btn-follow-import").addEventListener("click", () =>
    pickImage().then((file) => importFollowPhoto(s, file)));

  showScreen("screen-detail");
}

function renderCompare(mode) {
  const s = _detailSession;
  const host = $("#cmp-host");
  if (mode === "side") {
    host.innerHTML = `<div class="side-by-side">
        <img src="${baseSrc(s)}" /><img src="${followSrc(s)}" /></div>`;
    return;
  }
  if (mode === "overlay") {
    host.innerHTML = `
      <div class="compare-stage">
        <img src="${baseSrc(s)}" />
        <img src="${followSrc(s)}" id="ov-after" style="opacity:0.5" />
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
  $("#btn-new").addEventListener("click", () => Cam.open("base"));
  $("#btn-import").addEventListener("click", () => $("#import-input").click());
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
    navigator.serviceWorker.register("./sw.js").catch(() => {});
  }
});
