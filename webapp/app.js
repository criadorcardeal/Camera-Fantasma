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
// true quando aberto pela tela de início (app instalado); false no navegador.
const isStandalone = () =>
  window.matchMedia("(display-mode: standalone)").matches ||
  window.navigator.standalone === true;
const fmtDate = (iso) => {
  const d = new Date(iso);
  const p = (n) => String(n).padStart(2, "0");
  return `${p(d.getDate())}/${p(d.getMonth() + 1)}/${d.getFullYear()} ${p(d.getHours())}:${p(d.getMinutes())}`;
};
const fmtDateOnly = (iso) => {
  const d = new Date(iso);
  const p = (n) => String(n).padStart(2, "0");
  return `${p(d.getDate())}/${p(d.getMonth() + 1)}/${d.getFullYear()}`;
};

// Rótulo automático: já vem preenchido com a data de aquisição da foto, para o
// usuário poder editar ou apagar. Formato conforme o perfil (none/date/datetime).
function autoDateLabel() {
  const mode = Profile.config().footerDate;   // none | date | datetime
  if (mode === "none") return "";
  const iso = new Date().toISOString();
  return mode === "datetime" ? fmtDate(iso) : fmtDateOnly(iso);
}

// Rótulo padrão do rodapé: "Antes"/"Depois" + a data (conforme a configuração).
function defaultLabel(kind) {
  const prefix = kind === "base" ? "Antes" : "Depois";
  const d = autoDateLabel();
  return d ? (prefix + " • " + d) : prefix;
}

// Usa a versao com ajustes aplicados (se existir) ou a original.
const baseSrc = (s) => s.baseImageView || s.baseImage;
const followSrc = (s) => s.followImageView || s.followImage;

// Título do card: nome personalizado (se o usuário definiu) ou o padrão com a data.
const defaultTitle = (s) => "Comparação de " + fmtDate(s.createdAt);
const sessionTitle = (s) => (s.name && s.name.trim()) ? s.name.trim() : defaultTitle(s);

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
    // Travada = comparação concluída (fotos não podem mais ser trocadas).
    const locked = s.creditState === "confirmed";
    // Ícone: só base (➕); 2 fotos ainda destravado p/ troca (🔓); comparação feita (🔀).
    const icon = s.followImage ? (locked ? "🔀" : "🔓") : "➕";

    const wrap = document.createElement("div");
    wrap.className = "card-swipe";
    // Duplicar só faz sentido numa comparação já concluída (travada).
    wrap.innerHTML = `
      <div class="card-actions">
        <button type="button" class="ca-btn ca-dup"${locked ? "" : " disabled"}>📑<span>Duplicar</span></button>
        <button type="button" class="ca-btn ca-ren">✏️<span>Renomear</span></button>
      </div>
      <div class="card-del-bg">🗑 Excluir</div>`;
    const card = document.createElement("div");
    card.className = "card";
    card.innerHTML = `
      <img src="${baseSrc(s)}" alt="" />
      <div class="info">
        <b>${escHtml(sessionTitle(s))}</b>
        <span>${s.followImage ? "Base + acompanhamento" : "Só foto base"}</span>
      </div>
      <div>${icon}</div>`;
    wrap.appendChild(card);
    el.appendChild(wrap);
    attachSwipe(card, s, wrap);
  }
}

// Gestos no card da home:
//  • arrastar para a ESQUERDA → excluir (confirma; devolve crédito se não concluída);
//  • arrastar para a DIREITA → revela as ações "Duplicar" e "Renomear".
function attachSwipe(card, s, wrap) {
  const DEL_THRESH = 90;         // arrastar além disso p/ a esquerda = excluir
  // Extensão máxima do arraste (cada lado) = METADE da largura do card, para as
  // ações reveladas não vazarem sobre o fundo do lado oposto. As ações ocupam
  // exatamente essa metade (CSS .card-actions { width: 50% }).
  const half = () => (card.offsetWidth || 320) / 2;
  let startX = 0, dx = 0, dragging = false, moved = false, open = false;

  const setX = (x, anim) => {
    card.style.transition = anim ? "transform 0.15s" : "none";
    card.style.transform = `translateX(${x}px)`;
  };
  const close = () => { open = false; setX(0, true); };

  card.addEventListener("pointerdown", (e) => {
    if (card._editing) return;
    dragging = true; moved = false; startX = e.clientX;
    card.style.transition = "none";
    try { card.setPointerCapture(e.pointerId); } catch (_) {}
  });
  card.addEventListener("pointermove", (e) => {
    if (!dragging) return;
    const h = half();
    const raw = e.clientX - startX;
    if (Math.abs(raw) > 6) moved = true;
    let x = (open ? h : 0) + raw;
    x = Math.max(-h, Math.min(h, x));   // nunca passa de meia largura p/ nenhum lado
    setX(x, false);
    dx = x;
  });
  const end = async () => {
    if (!dragging) return;
    dragging = false;
    if (dx <= -DEL_THRESH) {
      if (confirm("Excluir esta comparação? As fotos serão apagadas do aparelho.")) {
        setX(-(card.offsetWidth || 400), true);
        if (s.creditState === "reserved") await Credits.refund();
        await DB.remove(s.id);
        await renderHome();
        return;
      }
      close();
      return;
    }
    if (dx >= half() / 2) { open = true; setX(half(), true); }
    else close();
  };
  card.addEventListener("pointerup", end);
  card.addEventListener("pointercancel", end);
  card.addEventListener("click", (e) => {
    if (moved) { e.preventDefault(); e.stopPropagation(); return; }
    if (open) { close(); return; }   // toque no card fecha as ações
    if (card._editing) return;
    openDetail(s.id);
  });

  wrap.querySelector(".ca-dup").addEventListener("click", (e) => {
    e.stopPropagation();
    if (e.currentTarget.disabled) return;   // só duplica comparação travada
    close(); duplicateComparison(s);
  });
  wrap.querySelector(".ca-ren").addEventListener("click", (e) => {
    e.stopPropagation(); close(); startRename(card, s);
  });
}

// Renomear direto no card: troca o título por um campo de edição.
// Enter/sair do campo salva; Esc cancela. Vazio volta ao título padrão (data).
function startRename(card, s) {
  if (card._editing) return;
  card._editing = true;
  const b = card.querySelector(".info b");
  const input = document.createElement("input");
  input.type = "text";
  input.className = "card-rename";
  input.value = s.name || "";
  input.placeholder = defaultTitle(s);
  input.autocomplete = "off";
  b.replaceWith(input);
  input.focus();
  input.select();

  let done = false;
  const finish = async (save) => {
    if (done) return;
    done = true;
    if (save) { s.name = input.value; await DB.put(s); }
    card._editing = false;
    await renderHome();
  };
  input.addEventListener("keydown", (e) => {
    if (e.key === "Enter") { e.preventDefault(); input.blur(); }
    else if (e.key === "Escape") { e.preventDefault(); done = true; card._editing = false; renderHome(); }
  });
  input.addEventListener("blur", () => finish(true));
  // O toque no campo não deve iniciar o swipe nem abrir a Montagem.
  ["pointerdown", "pointerup", "click"].forEach((ev) =>
    input.addEventListener(ev, (e) => e.stopPropagation()));
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
    // Tela para onde voltar se a câmera não for autorizada (ou falhar).
    this._returnScreen = (document.querySelector(".screen.active") || {}).id || "screen-home";
    this.mode = mode;
    this.session = session || null;
    this.torchOn = false;

    // Ghost overlay + filtros iniciais
    const ghost = $("#ghost");
    if (mode === "follow" && session) {
      ghost.src = session.baseImage;
      ghost.style.display = "block";
      $("#ghost-wrap").style.display = "flex";
      $("#cam-title").textContent = "Foto de acompanhamento";
      const f = session.filters || { brightness: 1, contrast: 1, saturate: 1 };
      $("#f-brightness").value = f.brightness;
      $("#f-contrast").value = f.contrast;
      $("#f-saturate").value = f.saturate;
      $("#distance-chip").textContent = "Mantenha 40–60 cm do local";
    } else {
      // Modo "base": foto nova (session null) ou refazer a base de uma
      // comparação existente (session preenchida).
      ghost.removeAttribute("src");
      ghost.style.display = "none";
      $("#ghost-wrap").style.display = "none";
      $("#cam-title").textContent = session ? "Refazer foto base" : "Foto base";
      const f = (session && session.filters) || { brightness: 1, contrast: 1, saturate: 1 };
      $("#f-brightness").value = f.brightness;
      $("#f-contrast").value = f.contrast;
      $("#f-saturate").value = f.saturate;
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
      // Sem permissão (ou câmera indisponível): avisa e volta para a tela anterior.
      this.stop();
      showScreen(this._returnScreen || "screen-home");
      alert(
        "Não foi possível acessar a câmera. Verifique a permissão da câmera " +
        "para este site nas configurações do navegador."
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

    // Prefill do rótulo com o texto padrão ("Antes"/"Depois" + data) editável.
    const seed = this.mode === "base"
      ? ((this.session && this.session.baseLabel) || defaultLabel("base"))
      : ((this.session && this.session.followLabel) || defaultLabel("follow"));
    const res = await openLabelDialog(seed, this.mode === "base" && !this.session);
    if (res == null) return; // usuario escolheu refazer
    const { label } = res;

    if (this.mode === "base" && this.session) {
      // Refazer a foto base de uma comparação já existente (não cria sessão nova).
      const s = this.session;
      s.baseImage = dataUrl;
      s.baseLabel = label;
      s.filters = f;
      delete s.baseImageView;   // descarta ajuste anterior da base
      await DB.put(s);
      this.stop();
      await openDetail(s.id);
    } else if (this.mode === "base") {
      const session = {
        id: String(Date.now()),
        createdAt: new Date().toISOString(),
        baseImage: dataUrl,
        baseLabel: label,
        followLabel: "",
        showLabels: true,
        filters: f,
        followImage: null,
        followAt: null,
        creditState: "reserved",
      };
      await DB.put(session);
      await Credits.reserve();
      this.stop();
      await openDetail(session.id);
      showFollowHint();
    } else {
      const s = this.session;
      s.followImage = dataUrl;
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

async function importBasePhoto(file, session) {
  if (!file) return;
  let dataUrl;
  try {
    dataUrl = await downscaleImage(file, 1600);
  } catch (e) {
    alert(e.message || "Não foi possível usar esta imagem.");
    return;
  }
  // Substituir a base de uma comparação já existente.
  if (session) {
    const res = await openLabelDialog(session.baseLabel || defaultLabel("base"));
    if (res == null) return;
    session.baseImage = dataUrl;
    session.baseLabel = res.label;
    delete session.baseImageView;
    await DB.put(session);
    await openDetail(session.id);
    return;
  }
  const res = await openLabelDialog(defaultLabel("base"), true);
  if (res == null) return;
  const newSession = {
    id: String(Date.now()),
    createdAt: new Date().toISOString(),
    baseImage: dataUrl,
    baseLabel: res.label,
    followLabel: "",
    showLabels: true,
    filters: { brightness: 1, contrast: 1, saturate: 1 },
    followImage: null,
    followAt: null,
    creditState: "reserved",
  };
  await DB.put(newSession);
  await Credits.reserve();
  await openDetail(newSession.id);
  showFollowHint();
}

/* ---------------- Diálogo de rótulo (rodapé da foto) ----------------
   Resolve { label } ou null (usuário escolheu refazer). */
function openLabelDialog(labelValue, requireConsent) {
  return new Promise((resolve) => {
    const dlg = $("#dist-dialog");
    const labelInp = $("#dist-label");
    const wrap = $("#dist-consent-wrap");
    const consent = $("#dist-consent");
    const ok = $("#dist-ok");
    labelInp.value = labelValue || "";
    if (requireConsent) {
      wrap.hidden = false;
      consent.checked = false;
      ok.disabled = true;
      consent.onchange = () => { ok.disabled = !consent.checked; };
    } else {
      wrap.hidden = true;
      ok.disabled = false;
      consent.onchange = null;
    }
    const onClose = () => {
      dlg.removeEventListener("close", onClose);
      resolve(dlg.returnValue === "ok" ? { label: labelInp.value.trim() } : null);
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
    : `<div class="compare-stage" id="cmp-host"><img src="${baseSrc(s)}" style="object-fit:contain" />${capHtml(s.baseLabel, "cap-center", s.showLabels)}${Profile.wmHtml(Profile.config(), true)}</div>`;

  // Depois de gerar a comparação (crédito confirmado), as fotos ficam travadas.
  const locked = s.creditState === "confirmed";

  const labelHtml = `
    <div class="label-card" id="label-card">
      <div class="label-head">
        <label class="label-toggle">
          <input type="checkbox" id="lbl-toggle" ${s.showLabels ? "checked" : ""} />
          <span>Mostrar rótulo no rodapé das fotos</span>
        </label>
        <span class="chev" id="lbl-chev">▾</span>
      </div>
      <div class="label-fields" id="lbl-fields">
        <label>Rótulo da foto base
          <input type="text" id="lbl-base" value="${escAttr(s.baseLabel || "")}" placeholder="Ex.: Perna direita" autocomplete="off" />
        </label>
        ${hasFollow ? `<label>Rótulo do acompanhamento
          <input type="text" id="lbl-follow" value="${escAttr(s.followLabel || "")}" placeholder="Ex.: Perna direita" autocomplete="off" />
        </label>` : ""}
      </div>
    </div>`;

  // Card da foto base (Refazer/Importar agem sobre a foto base).
  const baseCard = locked ? "" : `
    <div class="act-card">
      <div class="act-title">Base</div>
      <div class="btn-row">
        <button class="btn outline" id="btn-base-redo">📷 Refazer</button>
        <button class="btn outline" id="btn-base-import">🖼 Importar</button>
      </div>
    </div>`;

  const acCard = locked ? "" : `
    <div class="act-card">
      <div class="act-title">Acompanhamento</div>
      <div class="btn-row">
        <button class="btn outline" id="btn-redo">${hasFollow ? "📷 Refazer" : "📷 Tirar"}</button>
        <button class="btn outline" id="btn-follow-import">🖼 Importar</button>
      </div>
    </div>`;

  const lockNote = locked
    ? `<p class="lock-note">🔒 Comparação concluída — as fotos não podem mais ser alteradas.</p>`
    : "";

  // Ajustar e Reposicionar continuam disponíveis mesmo depois de "Comparar"
  // (o travamento só esconde os cards de TROCA de foto — base/acompanhamento).
  // O botão Comparar fica embaixo, com largura total.
  const secondRow = hasFollow ? `
    <div class="btn-row" style="margin-top:12px">
      <button class="btn outline" id="btn-adjust">🎚 Ajustar imagens</button>
      <button class="btn outline" id="btn-reposition">↔️ Reposicionar imagens</button>
    </div>
    ${locked ? "" : `<button class="btn outline" id="btn-swap" style="margin-top:8px">🔁 Trocar base ↔ acompanhamento</button>`}
    <button class="btn primary" id="btn-share">🔀 Comparar</button>` : "";

  c.innerHTML = compareHtml + labelHtml + lockNote + baseCard + acCard + secondRow;

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
  }
  enableWmEdit();
  requestAnimationFrame(sizeWmNames);

  if ($("#btn-adjust")) $("#btn-adjust").addEventListener("click", () => Editor.open(s));
  if ($("#btn-reposition")) $("#btn-reposition").addEventListener("click", () => Aligner.open(s, s.followImage, true));
  if ($("#btn-redo")) $("#btn-redo").addEventListener("click", () => Cam.open("follow", s));
  if ($("#btn-follow-import")) $("#btn-follow-import").addEventListener("click", () =>
    pickImage().then((file) => importFollowPhoto(s, file)));
  if ($("#btn-base-redo")) $("#btn-base-redo").addEventListener("click", () => Cam.open("base", s));
  if ($("#btn-base-import")) $("#btn-base-import").addEventListener("click", () =>
    pickImage().then((file) => importBasePhoto(file, s)));
  if ($("#btn-share")) $("#btn-share").addEventListener("click", () => confirmThenSave(s));
  if ($("#btn-swap")) $("#btn-swap").addEventListener("click", () => swapPhotos(s));

  // Card de rótulo: seta de expansão abre/fecha os campos de edição.
  $("#lbl-chev").addEventListener("click", () => $("#label-card").classList.toggle("open"));

  // Rótulos: liga/desliga rodapé e edição por comparação.
  $("#lbl-toggle").addEventListener("change", async (e) => {
    s.showLabels = e.target.checked;
    await DB.put(s);
    refreshCompareCaptions();
  });
  const onLabelInput = async (key, val) => { s[key] = val.trim(); await DB.put(s); refreshCompareCaptions(); };
  $("#lbl-base").addEventListener("input", (e) => onLabelInput("baseLabel", e.target.value));
  if (hasFollow) $("#lbl-follow").addEventListener("input", (e) => onLabelInput("followLabel", e.target.value));
}

// Troca base ↔ acompanhamento (só as fotos/ajustes; rótulos e datas do rodapé ficam).
async function swapPhotos(s) {
  if (!s || !s.followImage) return;
  const swap = (a, b) => { const t = s[a]; s[a] = s[b]; s[b] = t; };
  swap("baseImage", "followImage");
  swap("baseImageView", "followImageView");
  swap("baseAdj", "followAdj");
  swap("baseTarget", "followTarget");
  await DB.put(s);
  await openDetail(s.id);
}

// Duplica uma comparação já concluída (travada) para uma NOVA comparação editável.
// Copia as fotos e ajustes, cobra 1 crédito (reserva) e abre a cópia destravada,
// permitindo trocar/refazer as fotos.
function duplicateComparison(s) {
  if (!Credits.canStart()) {
    Credits.promptBuy("Você está sem créditos. Resgate um voucher para duplicar como nova comparação.");
    return;
  }
  const dlg = $("#dup-dialog");
  const ok = $("#dup-ok"), cancel = $("#dup-cancel");
  const doDup = async () => {
    cleanup();
    dlg.close();
    // Cópia profunda para não compartilhar objetos (filtros/ajustes) com o original.
    const clone = (typeof structuredClone === "function")
      ? structuredClone(s)
      : JSON.parse(JSON.stringify(s));
    clone.id = String(Date.now());
    clone.createdAt = new Date().toISOString();
    clone.name = sessionTitle(s) + " (cópia)";
    clone.creditState = "reserved";   // destravada: pode trocar fotos e recomparar
    await DB.put(clone);
    await Credits.reserve();
    await openDetail(clone.id);
  };
  const onCancel = () => { cleanup(); dlg.close(); };
  function cleanup() {
    ok.removeEventListener("click", doDup);
    cancel.removeEventListener("click", onCancel);
  }
  ok.addEventListener("click", doDup);
  cancel.addEventListener("click", onCancel);
  dlg.showModal();
}

// Clicar em "Comparar" TRAVA a comparação (as fotos não podem mais ser alteradas)
// e abre o diálogo "Gerar comparação". Confirma o crédito reservado.
async function lockAndGenerate(s) {
  if (s.creditState === "reserved") {
    s.creditState = "confirmed";
    await DB.put(s);
    await openDetail(s.id);          // re-renderiza já travado (sem cards de editar)
  }
  Share.open(_detailSession || s);
}

// Aviso antes de gerar: a comparação será concluída e as fotos travadas.
// Mostra o popup só até o usuário marcar "Não avisar mais isso" (ff_no_save_warn)
// e apenas quando a comparação ainda não foi concluída.
function confirmThenSave(s) {
  const optedOut = localStorage.getItem("ff_no_save_warn") === "1";
  if (optedOut || s.creditState === "confirmed") { lockAndGenerate(s); return; }
  const dlg = $("#save-warn-dialog");
  $("#save-warn-check").checked = false;
  const proceed = () => {
    if ($("#save-warn-check").checked) localStorage.setItem("ff_no_save_warn", "1");
    cleanup(); dlg.close(); lockAndGenerate(s);
  };
  const cancel = () => { cleanup(); dlg.close(); };
  function cleanup() {
    $("#save-warn-ok").removeEventListener("click", proceed);
    $("#save-warn-cancel").removeEventListener("click", cancel);
  }
  $("#save-warn-ok").addEventListener("click", proceed);
  $("#save-warn-cancel").addEventListener("click", cancel);
  dlg.showModal();
}

// Editor da marca d'água DIRETO sobre as fotos da Comparação: arraste o corpo
// para mover, a alça inferior-direita para redimensionar e a alça superior para
// girar — vale para a logo e para o nome. Ajusta o perfil (todas as fotos usam).
// Delegação no #cmp-host (persiste entre os modos cortina/lado a lado/sobrepor).
function enableWmEdit() {
  const host = $("#cmp-host");
  if (!host || host._wmEditOn) return;
  host._wmEditOn = true;
  let g = null;

  // Atualiza ao vivo TODAS as cópias do elemento (o modo lado a lado tem duas).
  const applyLive = (type, p) => {
    host.querySelectorAll(".wm-" + type).forEach((el) => {
      if (p.x != null) el.style.left = (p.x * 100) + "%";
      if (p.y != null) el.style.top = (p.y * 100) + "%";
      if (p.rot != null) el.style.transform = "rotate(" + p.rot + "deg)";
      if (type === "logo" && p.w != null) el.style.width = (p.w * 100) + "%";
      if (type === "name" && p.scale != null) {
        // Fonte proporcional à altura do palco (5%), igual ao perfil e à
        // exportação — assim o tamanho na montagem corresponde às mídias.
        const h = el.parentElement.clientHeight || el.parentElement.getBoundingClientRect().height;
        const t = el.querySelector(".wm-name-txt");
        if (t && h) t.style.fontSize = Math.max(9, h * 0.05 * p.scale) + "px";
      }
    });
  };

  host.addEventListener("pointerdown", (e) => {
    const el = e.target.closest(".wm-edit");
    if (!el) return;
    e.preventDefault(); e.stopPropagation();
    const type = el.dataset.wm;                    // "logo" | "name"
    const handle = e.target.closest(".wm-h");
    const mode = handle ? handle.dataset.h : "move"; // "rot" | "res" | "move"
    const srect = el.parentElement.getBoundingClientRect();
    const rect = el.getBoundingClientRect();
    const cx = rect.left + rect.width / 2, cy = rect.top + rect.height / 2;
    const c = Profile.config();
    g = {
      type, mode, sw: srect.width, sh: srect.height, cx, cy,
      px: e.clientX, py: e.clientY,
      x0: type === "logo" ? c.logoX : c.nameX,
      y0: type === "logo" ? c.logoY : c.nameY,
      rot0: type === "logo" ? (c.logoRot || 0) : (c.nameRot || 0),
      w0: c.logoW, scale0: c.nameScale,
      wFrac: rect.width / srect.width, hFrac: rect.height / srect.height,
      startDist: Math.hypot(e.clientX - cx, e.clientY - cy) || 1,
      startAng: Math.atan2(e.clientY - cy, e.clientX - cx),
      cur: {},
    };
    try { el.setPointerCapture(e.pointerId); } catch (_) {}
  });

  host.addEventListener("pointermove", (e) => {
    if (!g) return;
    if (g.mode === "move") {
      let x = g.x0 + (e.clientX - g.px) / g.sw;
      let y = g.y0 + (e.clientY - g.py) / g.sh;
      x = Math.max(-0.75 * g.wFrac, Math.min(1 - 0.25 * g.wFrac, x));
      y = Math.max(-0.75 * g.hFrac, Math.min(1 - 0.25 * g.hFrac, y));
      g.cur = g.type === "logo" ? { logoX: x, logoY: y } : { nameX: x, nameY: y };
      applyLive(g.type, { x, y });
    } else if (g.mode === "res") {
      const factor = Math.hypot(e.clientX - g.cx, e.clientY - g.cy) / g.startDist;
      if (g.type === "logo") {
        const w = Math.max(0.05, Math.min(2, g.w0 * factor));
        g.cur = { logoW: w }; applyLive("logo", { w });
      } else {
        const sc = Math.max(0.3, Math.min(5, g.scale0 * factor));
        g.cur = { nameScale: sc }; applyLive("name", { scale: sc });
      }
    } else if (g.mode === "rot") {
      const ang = Math.atan2(e.clientY - g.cy, e.clientX - g.cx);
      const rot = Math.round(g.rot0 + (ang - g.startAng) * 180 / Math.PI);
      g.cur = g.type === "logo" ? { logoRot: rot } : { nameRot: rot };
      applyLive(g.type, { rot });
    }
  });

  const end = () => {
    if (!g) return;
    if (Object.keys(g.cur).length) {
      Profile.setWm(g.cur);
      refreshCompareCaptions();   // re-render sincroniza alças e mantém a opacidade
    }
    g = null;
  };
  host.addEventListener("pointerup", end);
  host.addEventListener("pointercancel", end);
}

// Legenda (rodapé) opcional dentro do palco de comparação (com fonte do perfil).
function capHtml(text, cls, show) {
  if (!(show && text)) return "";
  const c = Profile.config();
  return `<div class="cap ${cls}" style="font-family:${c.footerFamily};font-size:calc(0.72rem * ${c.footerScale})">${escHtml(text)}</div>`;
}

// Dimensiona o nome (marca d'água) na tela proporcional à altura do palco (5%),
// igual ao perfil e à exportação — corrige o tamanho do nome na montagem.
function sizeWmNames() {
  const host = $("#cmp-host");
  if (!host) return;
  const scale = Profile.config().nameScale || 1;
  host.querySelectorAll(".wm-name").forEach((el) => {
    const stage = el.parentElement;
    const h = stage.clientHeight || stage.getBoundingClientRect().height;
    const t = el.querySelector(".wm-name-txt");
    if (t && h) t.style.fontSize = Math.max(9, h * 0.05 * scale) + "px";
  });
}

// Recolhe o modo de comparação ativo e re-renderiza (para atualizar legendas).
function refreshCompareCaptions() {
  const s = _detailSession;
  if (!s) return;
  if (!s.followImage) {
    const host = $("#cmp-host");
    if (host) host.innerHTML = `<img src="${baseSrc(s)}" style="object-fit:contain" />${capHtml(s.baseLabel, "cap-center", s.showLabels)}${Profile.wmHtml(Profile.config(), true)}`;
    requestAnimationFrame(sizeWmNames);
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
  const wm = Profile.wmHtml(Profile.config(), true);
  if (mode === "side") {
    host.innerHTML = `<div class="side-by-side">
        <div class="side-cell"><img src="${baseSrc(s)}" />${capHtml(s.baseLabel, "cap-center", show)}${wm}</div>
        <div class="side-cell"><img src="${followSrc(s)}" />${capHtml(s.followLabel, "cap-center", show)}${wm}</div>
      </div>`;
    requestAnimationFrame(sizeWmNames);
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
    // Rótulos só aparecem quando a respectiva foto tem MAIS de 50% visível.
    // No Sobrepor, a "visibilidade" do acompanhamento é a própria opacidade.
    const ovStage = host.querySelector(".compare-stage");
    const ovCapB = ovStage.querySelector(".cap-left");
    const ovCapF = ovStage.querySelector(".cap-right");
    const ovCaps = (v) => {
      if (ovCapB) ovCapB.style.visibility = v < 0.5 ? "" : "hidden";
      if (ovCapF) ovCapF.style.visibility = v > 0.5 ? "" : "hidden";
    };
    ovCaps(0.5);
    $("#ov-range").addEventListener("input", (e) => {
      $("#ov-after").style.opacity = e.target.value;
      ovCaps(parseFloat(e.target.value));
    });
    requestAnimationFrame(sizeWmNames);
    return;
  }
  // cortina (curtain): o corte é controlado por um slider ABAIXO das fotos
  // (igual ao Sobrepor). Sobre a foto fica só uma linha fina indicando o corte.
  host.innerHTML = `
    <div class="compare-stage" id="curtain">
      <img src="${baseSrc(s)}" />
      <div class="after-clip" style="position:absolute;inset:0;width:50%"><img src="${followSrc(s)}" style="width:200%;max-width:none" id="cur-after"/></div>
      <div class="curtain-line" id="cur-line" style="left:50%"></div>
      ${capB}${capF}${wm}
    </div>
    <div class="seg" style="margin-top:8px;background:transparent;padding:0">
      <input type="range" min="0" max="1" step="0.01" value="0.5" id="cur-range" style="width:100%" />
    </div>`;
  const stage = $("#curtain");
  const clip = stage.querySelector(".after-clip");
  const after = $("#cur-after");
  const line = $("#cur-line");
  const capBEl = stage.querySelector(".cap-left");
  const capFEl = stage.querySelector(".cap-right");
  const setSplit = (ratio) => {
    ratio = Math.max(0, Math.min(1, ratio));
    const w = stage.clientWidth;
    clip.style.width = (ratio * 100) + "%";
    after.style.width = w + "px";
    after.style.maxWidth = "none";
    line.style.left = (ratio * 100) + "%";
    // ratio = fração do acompanhamento à mostra; a base ocupa (1 - ratio).
    // Cada rótulo só aparece quando sua foto tem MAIS de 50% visível.
    if (capBEl) capBEl.style.visibility = ratio < 0.5 ? "" : "hidden";
    if (capFEl) capFEl.style.visibility = ratio > 0.5 ? "" : "hidden";
  };
  setSplit(0.5);
  $("#cur-range").addEventListener("input", (e) => setSplit(parseFloat(e.target.value)));
  requestAnimationFrame(sizeWmNames);
}

/* Checa crédito e inicia a sequência de nova comparação. */
function proceedNewComparison() {
  if (!Credits.canStart()) {
    Credits.promptBuy("Você está sem créditos. Resgate um voucher para fazer uma nova comparação.");
    return;
  }
  startNewComparison();
}

/* ---- Sequência de avisos antes de escolher a foto base ---- */
let _ncQueue = [];
function startNewComparison() {
  _ncQueue = [];
  if (localStorage.getItem("cc_ondevice_ack") !== "1") _ncQueue.push("ondevice-dialog");
  if (localStorage.getItem("cc_twophotos_ack") !== "1") _ncQueue.push("twophotos-dialog");
  ncNext();
}
function ncNext() {
  const id = _ncQueue.shift();
  if (!id) { $("#new-dialog").showModal(); return; }
  $("#" + id).showModal();
}

/* Aviso (uma vez) de que agora falta a foto de acompanhamento. */
function showFollowHint() {
  if (localStorage.getItem("cc_followhint_ack") === "1") return;
  const d = $("#followhint-dialog");
  if (d) d.showModal();
}

/* ---------------- Eventos globais ---------------- */
function wireEvents() {
  $("#btn-compare").addEventListener("click", () => {
    // No navegador (fora da tela de início) as comparações podem ser perdidas:
    // avisa e orienta a instalar, mas permite continuar mesmo assim.
    if (!isStandalone()) { $("#browser-block-dialog").showModal(); return; }
    proceedNewComparison();
  });
  $("#bb-close").addEventListener("click", () => $("#browser-block-dialog").close());
  $("#bb-continue").addEventListener("click", () => {
    $("#browser-block-dialog").close();
    proceedNewComparison();
  });
  // Avisos em sequência (cada um só reaparece se não marcou "não mostrar").
  $("#ondevice-ok").addEventListener("click", () => {
    if ($("#ondevice-dontshow").checked) localStorage.setItem("cc_ondevice_ack", "1");
    $("#ondevice-dialog").close();
    ncNext();
  });
  $("#twophotos-ok").addEventListener("click", () => {
    if ($("#twophotos-dontshow").checked) localStorage.setItem("cc_twophotos_ack", "1");
    $("#twophotos-dialog").close();
    ncNext();
  });
  $("#followhint-ok").addEventListener("click", () => {
    if ($("#followhint-dontshow").checked) localStorage.setItem("cc_followhint_ack", "1");
    $("#followhint-dialog").close();
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
}

/* ---------- Setas flutuantes indicando rolagem em janelas/diálogos ---------- */
const ScrollHint = {
  up: null, down: null, host: null,
  init() {
    this.up = this._make("▲"); this.down = this._make("▼");
    document.body.append(this.up, this.down);
    this.up.addEventListener("click", () => this._page(-1));
    this.down.addEventListener("click", () => this._page(1));
    document.addEventListener("scroll", () => this.update(), true); // captura rolagem interna
    window.addEventListener("resize", () => this.update());
    // Só observamos "open" (diálogos). NÃO observar "hidden": as próprias setas usam
    // hidden e observá-lo criaria um laço infinito. A troca do gate é pega pelo intervalo.
    new MutationObserver(() => this.update()).observe(document.body,
      { attributes: true, attributeFilter: ["open"], subtree: true });
    setInterval(() => this.update(), 900); // pega conteúdo carregado depois (listas etc.)
  },
  _make(sym) {
    const b = document.createElement("button");
    b.className = "scroll-hint"; b.type = "button"; b.textContent = sym;
    b.hidden = true; b.setAttribute("aria-hidden", "true"); b.tabIndex = -1;
    return b;
  },
  _scroller() {
    const dlgs = document.querySelectorAll("dialog[open]");
    if (dlgs.length) return dlgs[dlgs.length - 1];
    const gate = document.getElementById("login-gate");
    if (gate && !gate.hidden) return gate;
    // Telas do app (Início, Montagem, Ajuste de imagens…) rolam pelo .content.
    return document.querySelector(".screen.active .content") || null;
  },
  update() {
    if (this._raf) return;
    this._raf = requestAnimationFrame(() => { this._raf = null; this._render(); });
  },
  _render() {
    const s = this._scroller();
    if (!s) { this.up.hidden = true; this.down.hidden = true; return; }
    // Diálogos modais ficam na "top layer": as setas precisam ser filhas do diálogo
    // para aparecerem por cima; para o gate (não-modal) ficam no body.
    const host = (s.tagName === "DIALOG") ? s : document.body;
    if (this.host !== host) { host.append(this.up, this.down); this.host = host; }
    const canScroll = s.scrollHeight - s.clientHeight > 8;
    if (!canScroll) { this.up.hidden = true; this.down.hidden = true; return; }
    const r = s.getBoundingClientRect();
    const x = Math.round(r.left + r.width / 2);
    const atTop = s.scrollTop <= 4;
    const atBottom = s.scrollTop + s.clientHeight >= s.scrollHeight - 4;
    // Em telas (host = body) o rodapé tem o botão flutuante; sobe a seta p/ não cobrir.
    const downOff = (host === document.body) ? 90 : 36;
    this._place(this.up, x, Math.round(r.top + 8), !atTop);
    this._place(this.down, x, Math.round(r.bottom - downOff), !atBottom);
  },
  _place(el, x, y, show) { el.style.left = x + "px"; el.style.top = y + "px"; el.hidden = !show; },
  _page(dir) { const s = this._scroller(); if (s) s.scrollBy({ top: dir * s.clientHeight * 0.8, behavior: "smooth" }); },
};

/* ---------------- Início ---------------- */
window.addEventListener("DOMContentLoaded", async () => {
  wireEvents();
  ScrollHint.init();
  if (typeof Profile !== "undefined" && Profile.updateAvatar) Profile.updateAvatar();
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
