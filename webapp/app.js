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

// Rótulo padrão do rodapé: a data + "Antes"/"Depois" (v7.6.2: data primeiro).
function defaultLabel(kind) {
  const prefix = kind === "base" ? "Antes" : "Depois";
  const d = autoDateLabel();
  return d ? (d + " • " + prefix) : prefix;
}

// Foto exibida SEM o desfoque de "Remover distrações" (v8.1): versão com
// colorações (view) ou a original. É a base sobre a qual a máscara é pintada e
// o desfoque é assado.
const baseSrcRaw = (s) => s.baseImageView || s.baseImage;
const followSrcRaw = (s) => s.followImageView || s.followImage;

// Usa a versao exibida: desfoque de distrações (se houver) > colorações > original.
const baseSrc = (s) => s.baseDefocus || baseSrcRaw(s);
const followSrc = (s) => s.followDefocus || followSrcRaw(s);

// Fonte da MONTAGEM (comparação exibida na tela de detalhe): quando o "Contorno
// neon" está ligado no card da Base/Acompanhamento, TROCA a foto exibida pelo
// contorno (em vez de abrir uma prévia à parte). A miniatura da home e as
// exportações continuam usando a foto real (baseSrc/followSrc).
const baseMontageSrc0 = (s) => ghostSrc(s, "base") || baseSrc(s);
const followMontageSrc0 = (s) => ghostSrc(s, "follow") || followSrc(s);

/* v8.5: ENQUADRAMENTO de grupo (s.groupFrame) — zoom/giro/deslocamento aplicados
   às DUAS fotos juntas, gravado na composição. Redesenha a imagem (que já está no
   aspecto da base) com a transformação e mantém o resto transparente (o fundo do
   palco é preto). Preserva alfa (contornos) usando PNG. */
async function applyGroupFrame(src, s) {
  const gf = s && s.groupFrame;
  if (!src || !gf) return src;
  const id = Math.abs(gf.z - 1) < 0.001 && Math.abs(gf.rot || 0) < 0.01 &&
             Math.abs(gf.txn || 0) < 0.001 && Math.abs(gf.tyn || 0) < 0.001;
  if (id) return src;
  let img;
  try { img = await loadImageEl(src); } catch (_) { return src; }
  const W = img.naturalWidth || 1, H = img.naturalHeight || 1;
  const c = document.createElement("canvas");
  c.width = W; c.height = H;
  const ctx = c.getContext("2d");
  ctx.translate(W / 2 + (gf.txn || 0) * W, H / 2 + (gf.tyn || 0) * H);
  ctx.scale(gf.z, gf.z);
  ctx.rotate((gf.rot || 0) * Math.PI / 180);
  ctx.drawImage(img, -W / 2, -H / 2, W, H);
  return c.toDataURL("image/png");
}
window.applyGroupFrame = applyGroupFrame;

// Cache das fontes da montagem JÁ enquadradas (evita reprocessar a cada tecla ao
// editar rótulos). Chave = fontes cruas + o enquadramento de grupo.
let _mf = { baseSrc: null, followSrc: null, gfk: null, base: null, follow: null };
async function ensureMontageFrame(s) {
  const bs = baseMontageSrc0(s), fs = followMontageSrc0(s);
  const gfk = JSON.stringify(s.groupFrame || null);
  if (_mf.baseSrc === bs && _mf.followSrc === fs && _mf.gfk === gfk) return;
  _mf = { baseSrc: bs, followSrc: fs, gfk,
          base: await applyGroupFrame(bs, s), follow: await applyGroupFrame(fs, s) };
}
// Getters usados pela montagem: devolvem a versão enquadrada quando o cache está
// quente para a fonte atual; senão a fonte crua (o await acontece antes de render).
const baseMontageSrc = (s) =>
  (s.groupFrame && _mf.base && _mf.baseSrc === baseMontageSrc0(s) && _mf.gfk === JSON.stringify(s.groupFrame || null))
    ? _mf.base : baseMontageSrc0(s);
const followMontageSrc = (s) =>
  (s.groupFrame && _mf.follow && _mf.followSrc === followMontageSrc0(s) && _mf.gfk === JSON.stringify(s.groupFrame || null))
    ? _mf.follow : followMontageSrc0(s);

/* ---------------- Filtro da imagem fantasma ----------------
   A foto pode ser exibida como fantasma (câmera de acompanhamento, janela de
   posicionamento e montagem) de 3 formas:
     "off"  -> a própria foto;
     "neon" -> contorno neon (sketch.js, v7.6.1);
     "bw"   -> preto e branco com contraste realçado (v8.6.1).
   Cada versão é gerada uma vez e guardada na composição; quando a foto muda,
   as duas são descartadas (clearSketch) para serem regeradas sob demanda. */
const SKETCH_META = {
  base:   { img: "baseImage",   sk: "baseSketch",   bw: "baseBw",   on: "baseSketchOn",   mode: "baseGhost",   mask: "baseMask",   color: () => window.NEON.base },
  follow: { img: "followImage", sk: "followSketch", bw: "followBw", on: "followSketchOn", mode: "followGhost", mask: "followMask", color: () => window.NEON.follow },
};
const GHOST_MODES = ["off", "neon", "bw"];

// Modo atual de um lado. Composições antigas só têm o booleano *SketchOn (que
// era só "contorno ligado/desligado"), então ele é a reserva.
function ghostMode(s, kind) {
  if (!s) return "off";
  const m = SKETCH_META[kind];
  const v = s[m.mode];
  if (GHOST_MODES.includes(v)) return v;
  return s[m.on] ? "neon" : "off";
}

// Versão JÁ gerada do modo atual (null = usar a própria foto).
function ghostSrc(s, kind) {
  if (!s) return null;
  const m = SKETCH_META[kind];
  const mode = ghostMode(s, kind);
  if (mode === "neon") return s[m.sk] || null;
  if (mode === "bw") return s[m.bw] || null;
  return null;
}

// Garante que a versão do modo pedido existe e a devolve (dataURL).
// v8.1: as áreas marcadas em "Remover distrações" são excluídas do contorno
// (e, no preto e branco, apagadas por um véu claro).
async function ensureGhost(s, kind, mode) {
  const m = SKETCH_META[kind];
  mode = mode || ghostMode(s, kind);
  if (!s || !s[m.img] || mode === "off") return null;
  const key = mode === "bw" ? m.bw : m.sk;
  if (!s[key]) {
    s[key] = mode === "bw"
      ? await makeBwGhost(s[m.img], { mask: s[m.mask] })
      : await makeNeonSketch(s[m.img], { color: m.color(), excludeMask: s[m.mask] });
    await DB.put(s);
  }
  return s[key];
}

// Troca o modo de um lado, gerando a imagem se ainda não existir.
async function setGhostMode(s, kind, mode) {
  const m = SKETCH_META[kind];
  if (!GHOST_MODES.includes(mode)) mode = "off";
  if (mode !== "off") await ensureGhost(s, kind, mode);
  s[m.mode] = mode;
  s[m.on] = mode === "neon";   // compatibilidade com versões anteriores
  await DB.put(s);
}

// Regera o que faltar do modo ativo (v8.6.1). Chamado pelas telas que exibem a
// montagem: sem isto, qualquer coisa que descarta a versão guardada (pintar
// distrações, por exemplo) fazia o filtro "sumir" em silêncio, com o botão
// continuando ligado.
async function syncGhosts(s) {
  if (!s) return;
  for (const kind of ["base", "follow"]) {
    if (ghostMode(s, kind) !== "off" && !ghostSrc(s, kind)) {
      try { await ensureGhost(s, kind); } catch (_) {}
    }
  }
}

// Descarta as versões guardadas (chamado quando a foto correspondente muda).
function clearSketch(s, kind) {
  if (!s) return;
  if (kind === "base" || kind === "all") { delete s.baseSketch; delete s.baseBw; }
  if (kind === "follow" || kind === "all") { delete s.followSketch; delete s.followBw; }
}

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
  refreshScrollCues();
}

/* v8.3: seta de rolagem. Mostra um indicador "⌄" no rodapé de uma área rolável
   quando ainda há conteúdo abaixo; some ao chegar ao fim. Tocar rola p/ baixo. */
function ensureScrollCue(scrollEl) {
  const parent = scrollEl.parentElement;
  if (!parent) return;
  let cue = parent.querySelector(":scope > .scroll-cue");
  if (!cue) {
    cue = document.createElement("div");
    cue.className = "scroll-cue";
    cue.setAttribute("aria-hidden", "true");
    cue.textContent = "⌄";
    parent.appendChild(cue);
    const upd = () => {
      const more = scrollEl.scrollHeight - scrollEl.clientHeight - scrollEl.scrollTop > 8;
      cue.classList.toggle("show", more);
    };
    scrollEl._cueUpd = upd;
    scrollEl.addEventListener("scroll", upd, { passive: true });
    cue.addEventListener("click", () => scrollEl.scrollBy({ top: scrollEl.clientHeight * 0.7, behavior: "smooth" }));
  }
  if (scrollEl._cueUpd) scrollEl._cueUpd();
}
// Atualiza as setas de todas as áreas roláveis da tela ativa (após render/resize).
function refreshScrollCues() {
  document.querySelectorAll(".screen.active .scroll-area").forEach(ensureScrollCue);
}
window.addEventListener("resize", refreshScrollCues);

// v8.2: dimensiona um palco de foto DENTRO da área fixa (.photo-fixed), no
// aspecto da imagem e com teto de altura — assim todas as telas mostram a foto
// no mesmo formato fixo da Montagem (sem rolagem). Centraliza com margem auto.
function fitStageEl(stage, aspect) {
  const box = stage.parentElement;   // .photo-fixed
  const boxW = (box && box.clientWidth) || document.documentElement.clientWidth || 320;
  const availW = Math.max(1, boxW - 24);          // padding lateral do .photo-fixed
  const capH = Math.round((window.innerHeight || 640) * 0.56);
  if (!aspect || !isFinite(aspect) || aspect <= 0) aspect = 0.75;
  let w = availW, h = w / aspect;
  if (h > capH) { h = capH; w = h * aspect; }
  if (w > availW) { w = availW; h = w / aspect; }
  stage.style.width = Math.round(w) + "px";
  stage.style.height = Math.round(h) + "px";
  stage.style.marginLeft = "auto";
  stage.style.marginRight = "auto";
}
window.fitStageEl = fitStageEl;

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
    // Ícone: só base (➕); 2 fotos ainda destravado p/ troca (✔️); comparação feita (🔀).
    const icon = s.followImage ? (locked ? "🔀" : "✔️") : "➕";

    const wrap = document.createElement("div");
    wrap.className = "card-swipe";
    // Duplicar só faz sentido numa comparação já concluída (travada): quando não,
    // fica com aparência de desabilitado (.ca-off) e avisa ao ser tocado.
    wrap.innerHTML = `
      <div class="card-actions">
        <button type="button" class="ca-btn ca-dup${locked ? "" : " ca-off"}"><span class="ca-ic">📑</span><span class="ca-tx">Duplicar</span></button>
        <button type="button" class="ca-btn ca-ren"><span class="ca-ic">✏️</span><span class="ca-tx">Renomear</span></button>
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
    close();
    if (s.creditState !== "confirmed") {   // só duplica comparação concluída/travada
      alert("A duplicação só está disponível em comparações concluídas.");
      return;
    }
    duplicateComparison(s);
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
  zoom: 1,           // fator de zoom atual (nativo ou digital)
  _zoomNative: false,// true quando a camera suporta zoom por hardware
  _zoomCaps: null,   // {min,max,step} do zoom nativo, quando houver

  // v8.6.2: folga entre o fantasma e as bordas da tela (4% = 2% de cada lado no
  // eixo apertado). Único ponto a mexer para deixar o fantasma maior ou menor.
  GHOST_MARGIN: 0.04,

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

  // Fantasma: FOTO base, CONTORNO neon (verde) ou PRETO E BRANCO (v8.6.1).
  // Guarda a preferência na sessão para valer também no posicionamento.
  async _setGhostMode(mode) {
    const s = this.session;
    const btn = $("#cam-contour");
    const ghost = $("#ghost");
    if (!s || this.mode !== "follow") { if (btn) btn.hidden = true; return; }
    if (!GHOST_MODES.includes(mode)) mode = "off";
    if (btn) {
      btn.hidden = false;
      btn.classList.remove("mode-off", "mode-neon", "mode-bw");
      btn.classList.add("mode-" + mode);
    }
    this._ghostMode = mode;
    if (mode === "off") {
      ghost.src = s.baseImage;
    } else {
      let g = null;
      try { g = await ensureGhost(s, "base", mode); } catch (_) {}
      // Só troca se a câmera ainda está no modo follow desta sessão e o usuário
      // não avançou o switch de novo enquanto a imagem era gerada.
      if (g && this.session === s && this.mode === "follow" && this._ghostMode === mode) ghost.src = g;
    }
    try { await setGhostMode(s, "base", mode); } catch (_) {}
  },

  // Toque no switch avança Foto → Contorno → P&B → Foto.
  cycleGhostMode() {
    const i = GHOST_MODES.indexOf(this._ghostMode || "off");
    this._setGhostMode(GHOST_MODES[(i + 1) % GHOST_MODES.length]);
  },

  async open(mode, session) {
    // Tela para onde voltar se a câmera não for autorizada (ou falhar).
    this._returnScreen = (document.querySelector(".screen.active") || {}).id || "screen-home";
    this.mode = mode;
    this.session = session || null;
    this.torchOn = false;
    // Zoom sempre começa em 1x (o range é reajustado quando a câmera inicia).
    this.zoom = 1;
    $("#cam-zoom").value = 1;
    this.applyZoomTransform();

    // Ghost overlay + filtros iniciais
    const ghost = $("#ghost");
    if (mode === "follow" && session) {
      ghost.src = session.baseImage;
      ghost.style.display = "block";
      $("#ghost-wrap").style.display = "flex";
      // Filtro do fantasma (foto / contorno neon / preto e branco): herda o que
      // estiver marcado na base. O switch no topo alterna entre os 3.
      this._setGhostMode(ghostMode(session, "base"));
      $("#cam-title").textContent = "Foto de acompanhamento";
      const f = session.filters || { brightness: 1, contrast: 1, saturate: 1 };
      $("#f-brightness").value = f.brightness;
      $("#f-contrast").value = f.contrast;
      $("#f-saturate").value = f.saturate;
    } else {
      // Modo "base": foto nova (session null) ou refazer a base de uma
      // comparação existente (session preenchida).
      ghost.removeAttribute("src");
      ghost.style.display = "none";
      $("#ghost-wrap").style.display = "none";
      if ($("#cam-contour")) $("#cam-contour").hidden = true;   // sem fantasma no modo base
      $("#cam-title").textContent = session ? "Refazer foto base" : "Foto base";
      const f = (session && session.filters) || { brightness: 1, contrast: 1, saturate: 1 };
      $("#f-brightness").value = f.brightness;
      $("#f-contrast").value = f.contrast;
      $("#f-saturate").value = f.saturate;
    }
    $("#ghost").style.opacity = $("#ghost-opacity").value;
    this.applyLiveFilter();
    $("#cam-error").hidden = true;

    showScreen("screen-camera");
    // v8.6.2: o fantasma já pode ser encaixado aqui — o tamanho dele depende só
    // da tela, não mais do frame do vídeo (que ainda nem chegou).
    this.layoutGhost();
    maybeShowBgTip();
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
      this.setupZoom();

      // Tenta tocar (no iOS o play() pode "rejeitar" mesmo indo tocar, entao
      // ignoramos o erro aqui e verificamos de verdade logo depois).
      const tryPlay = () => {
        const pr = video.play();
        if (pr && pr.catch) pr.catch(() => {});
      };
      // Reencaixa o fantasma quando o vídeo entra (a área visível pode ter
      // mudado de tamanho enquanto a câmera abria).
      video.onloadedmetadata = () => { tryPlay(); this.layoutGhost(); };
      tryPlay();
      // So mostra o botao manual se, apos 1s, o video realmente nao tocou.
      setTimeout(() => {
        if (video.paused || !video.videoWidth) {
          this.showStartButton();
        } else {
          $("#cam-start").hidden = true;
          this.layoutGhost();
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

  /* ---------- Zoom (nativo por hardware ou digital por recorte) ---------- */
  setupZoom() {
    const slider = $("#cam-zoom");
    let caps = null;
    try { caps = this.track && this.track.getCapabilities ? this.track.getCapabilities() : null; } catch (_) {}
    if (caps && typeof caps.zoom === "object" && caps.zoom && caps.zoom.max > caps.zoom.min) {
      // Zoom nativo: usa o range real da câmera.
      this._zoomNative = true;
      this._zoomCaps = caps.zoom;
      slider.min = caps.zoom.min;
      slider.max = caps.zoom.max;
      slider.step = caps.zoom.step || (caps.zoom.max - caps.zoom.min) / 100 || 0.1;
      const cur = (this.track.getSettings && this.track.getSettings().zoom) || caps.zoom.min;
      this.zoom = cur;
      slider.value = cur;
    } else {
      // Zoom digital (iOS Safari): recorte central de 1x a 4x.
      this._zoomNative = false;
      this._zoomCaps = null;
      slider.min = 1; slider.max = 4; slider.step = 0.01;
      this.zoom = 1; slider.value = 1;
    }
    // v8.6.1: na foto de ACOMPANHAMENTO, retoma o zoom usado na foto base. O
    // zoom fica "impresso" na foto base (recorte no digital, hardware no
    // nativo), então o fantasma já vem ampliado; se a câmera reabrisse em 1x,
    // o fantasma parecia estar com zoom em relação ao vídeo ao vivo. Só vale se
    // o tipo de zoom for o mesmo (nativo↔nativo), pois a escala é diferente.
    const s = this.session;
    if (this.mode === "follow" && s && s.camZoom != null &&
        !!s.camZoomNative === !!this._zoomNative) {
      this.setZoom(s.camZoom);
      return;   // setZoom já aplica a transformação
    }
    this.applyZoomTransform();
  },

  async setZoom(z) {
    const slider = $("#cam-zoom");
    const min = parseFloat(slider.min), max = parseFloat(slider.max);
    z = Math.min(max, Math.max(min, z));
    this.zoom = z;
    slider.value = z;
    if (this._zoomNative && this.track) {
      try { await this.track.applyConstraints({ advanced: [{ zoom: z }] }); } catch (_) {}
    } else {
      this.applyZoomTransform();
    }
  },

  // No zoom digital, aplica a ampliação por CSS no vídeo e no canvas de filtro
  // (o preview reflete o zoom). No zoom nativo o frame já vem ampliado.
  applyZoomTransform() {
    const scale = this._zoomNative ? 1 : (this.zoom || 1);
    const t = `scale(${scale})`;
    $("#video").style.transform = t;
    $("#cam-fx").style.transform = t;
    this.layoutGhost();
  },

  /* v8.6.2: o FANTASMA cabe INTEIRO na tela, com uma folga de GHOST_MARGIN em
     volta — a foto base aparece completa, sem bordas cortadas.

     Na v8.6.1 o fantasma era encaixado sobre o retângulo do frame da câmera
     (recorte "cover"), que no Android quase sempre é MAIOR que a tela: quando a
     foto base tinha a mesma proporção do vídeo — o caso comum — o fantasma saía
     do mesmo jeito que o vídeo e as bordas ficavam fora da tela.

     Agora o fantasma é apenas ajustado (contain) dentro da área visível reduzida
     por GHOST_MARGIN, sem seguir o zoom: ele vira a referência FIXA de silhueta,
     e é o enquadramento ao vivo (distância/zoom) que o médico ajusta até a foto
     ao vivo casar com ela. A escala fina continua sendo corrigida depois, na
     tela Posicionamentos. */
  layoutGhost() {
    const v = $("#video"), g = $("#ghost");
    if (!v || !g || g.style.display === "none") return;
    const host = v.parentElement;
    const box = host && host.getBoundingClientRect();
    if (!box || !box.width || !box.height) return;
    const k = 1 - Cam.GHOST_MARGIN;
    const fw = box.width * k, fh = box.height * k;
    g.style.width = fw + "px";
    g.style.height = fh + "px";
    g.style.left = ((box.width - fw) / 2) + "px";
    g.style.top = ((box.height - fh) / 2) + "px";
    g.style.right = "auto";
    g.style.bottom = "auto";
    g.style.objectFit = "contain";
  },

  /* v8.7.1: retângulo do frame do vídeo (em px do frame) que está VISÍVEL na
     tela. O elemento <video> cobre a caixa W×H com object-fit:cover (escala
     s = max(W/vw, H/vh), centrado) e, no zoom digital, ainda recebe
     scale(dz) por CSS em torno do centro. Logo a parte visível mede
     W/(s·dz) × H/(s·dz), centrada no frame. Sem caixa conhecida (W ou H = 0)
     cai no comportamento antigo: frame inteiro recortado só pelo zoom. */
  visibleCrop(vw, vh, W, H, dz) {
    dz = dz > 1.001 ? dz : 1;
    let w, h;
    if (W > 0 && H > 0) {
      const s = Math.max(W / vw, H / vh);
      w = W / (s * dz);
      h = H / (s * dz);
    } else {
      w = vw / dz;
      h = vh / dz;
    }
    w = Math.min(vw, Math.round(w));
    h = Math.min(vh, Math.round(h));
    return { x: Math.round((vw - w) / 2), y: Math.round((vh - h) / 2), w, h };
  },

  // Devolve o fantasma ao posicionamento do CSS (usado ao fechar a câmera).
  resetGhostLayout() {
    const g = $("#ghost");
    if (!g) return;
    ["width", "height", "left", "top", "right", "bottom", "objectFit"]
      .forEach((p) => { g.style[p] = ""; });
  },

  stop() {
    this.stopPreview();
    $("#cam-fx").hidden = true;
    // Zera transformações de zoom para não vazar p/ a próxima abertura.
    $("#video").style.transform = "";
    $("#cam-fx").style.transform = "";
    this.resetGhostLayout();
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
    const ctx = canvas.getContext("2d");
    const f = this.filters();
    // v8.7.1: a foto salva é EXATAMENTE o que aparece na tela. O vídeo é
    // exibido em "cover" (recorte centrado pela proporção da tela) e, no zoom
    // digital, ampliado por CSS; antes a captura gravava o frame INTEIRO do
    // sensor (só recortando pelo zoom), e no Android a foto saía bem mais
    // ampla que a prévia. Agora recorta o frame pelo retângulo visível.
    const dz = this._zoomNative ? 1 : (this.zoom || 1);
    const W = video.clientWidth || (video.parentElement && video.parentElement.clientWidth) || 0;
    const H = video.clientHeight || (video.parentElement && video.parentElement.clientHeight) || 0;
    const c = Cam.visibleCrop(video.videoWidth, video.videoHeight, W, H, dz);
    canvas.width = c.w;
    canvas.height = c.h;
    ctx.drawImage(video, c.x, c.y, c.w, c.h, 0, 0, canvas.width, canvas.height);
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
      s.baseImageView = null;   // descarta ajuste anterior da base
      s.baseAdj = null;
      s.baseTarget = null;
      // v8.6.1: guarda o zoom da base p/ a câmera de acompanhamento reabrir nele.
      s.camZoom = this.zoom;
      s.camZoomNative = !!this._zoomNative;
      clearSketch(s, "base");   // contorno neon será regerado da nova foto
      clearDistract(s, "base"); // nova foto: máscara/desfoque de distrações não valem mais
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
        // v8.6.1: zoom usado nesta foto — a câmera de acompanhamento reabre nele.
        camZoom: this.zoom,
        camZoomNative: !!this._zoomNative,
      };
      await DB.put(session);
      await Credits.reserve();
      this.stop();
      await openDetail(session.id);
      showFollowHint();
    } else {
      const s = this.session;
      s.followImage = dataUrl;
      s.followOriginal = dataUrl;   // captura = imagem original (sem alinhamento)
      s.followAlign = null;
      s.followLabel = label;
      s.followAt = new Date().toISOString();
      // Nova foto: descarta o ajuste de cor anterior (senão followImageView/Adj
      // ficavam apontando p/ a foto ANTIGA e a Montagem continuava mostrando ela).
      s.followImageView = null;
      s.followAdj = null;
      s.followTarget = null;
      clearSketch(s, "follow");
      clearDistract(s, "follow");   // nova foto: máscara/desfoque de distrações não valem mais
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
    session.baseImageView = null;
    session.baseAdj = null;
    session.baseTarget = null;
    clearSketch(session, "base");
    clearDistract(session, "base");   // nova base: distrações não valem mais
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
// Dica de fundo ao abrir a câmera (some quando o usuário marca "não mostrar mais").
function maybeShowBgTip() {
  if (localStorage.getItem("ff_no_bg_tip") === "1") return;
  const dlg = $("#bg-tip-dialog");
  if (!dlg) return;
  $("#bg-tip-nomore").checked = false;
  try { dlg.showModal(); } catch (_) {}
}

// Diálogo de confirmação genérico. Resolve true (Continuar) ou false (Cancelar).
function confirmDialog(title, message, okText) {
  return new Promise((resolve) => {
    const dlg = $("#confirm-dialog");
    $("#confirm-title").textContent = title || "Confirmar";
    $("#confirm-msg").innerHTML = message || "";
    $("#confirm-ok").textContent = okText || "Continuar";
    const onClose = () => {
      dlg.removeEventListener("close", onClose);
      resolve(dlg.returnValue === "ok");
    };
    dlg.addEventListener("close", onClose);
    dlg.showModal();
  });
}

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
// Lembra quais cards de rolagem estão abertos, para reabrir a Montagem no mesmo
// estado depois de entrar num botão do card (ex.: Ajustes Finos → Colorações).
let _detailOpenCards = {};
// Lado (base/acomp.) selecionado no toggle da seção "Fotos" (v8.5).
let _detailSide = "base";

async function openDetail(id) {
  const s = await DB.get(id);
  if (!s) { showScreen("screen-home"); await renderHome(); return; }
  // Ao trocar de comparação, esquece o estado dos cards e o lado da anterior.
  if (!_detailSession || _detailSession.id !== id) { _detailOpenCards = {}; _detailSide = "base"; }
  _detailSession = s;
  const c = $("#detail-content");

  const hasBase = !!s.baseImage;
  const hasFollow = !!s.followImage;
  // A comparação (cortina/lado a lado/sobrepor) só existe com as DUAS fotos.
  const bothPhotos = hasBase && hasFollow;
  // Depois de gerar a comparação (crédito confirmado), as fotos ficam travadas.
  const locked = s.creditState === "confirmed";
  // Lado selecionado na seção "Fotos" (toggle Base/Acompanhamento, v8.5).
  const side = _detailSide === "follow" ? "follow" : "base";
  // v8.6.1: regera o contorno/preto e branco que tenha sido descartado (a foto
  // mudou), senão o filtro sumia da montagem com o botão continuando ligado.
  await syncGhosts(s);
  // v8.5: prepara as fontes já enquadradas (grupo) antes de montar o HTML.
  await ensureMontageFrame(s);

  // Aba de comparação lembrada da última vez nesta comparação (Cortina por padrão).
  const MODES = ["curtain", "side", "overlay"];
  const mode0 = MODES.includes(s.compareMode) ? s.compareMode : "curtain";
  const segBtn = (m, label) => `<button data-mode="${m}"${m === mode0 ? ' class="active"' : ""}>${label}</button>`;

  // v8.2: a foto (#cmp-host) fica na área FIXA do topo; o seletor de modo
  // (Cortina/Lado a lado/Sobrepor) vai ABAIXO da foto, na seção "Tipo de
  // comparação". O botão "Comparar" fica na topbar (#detail-action, v8.3).
  const singleSrc = hasBase ? baseMontageSrc(s) : (hasFollow ? followMontageSrc(s) : null);
  const singleLabel = hasBase ? s.baseLabel : s.followLabel;
  const stageHtml = bothPhotos
    ? `<div id="cmp-host"></div>`
    : singleSrc
      ? `<div class="compare-stage" id="cmp-host"><img src="${singleSrc}" style="object-fit:contain" />${capHtml(singleLabel, "cap-center", s.showLabels)}${Profile.wmHtml(Profile.config(), true)}</div>`
      : `<div class="compare-stage empty-stage" id="cmp-host"><div class="empty-photo">Sem foto.<br>Use os botões abaixo para <b>tirar</b> ou <b>importar</b>.</div></div>`;
  // v8.3: seção expansível "Tipo de comparação" com o seletor de modo E o
  // controle deslizante (o slider é injetado em #cmp-slider por renderCompare).
  const cmpTypeOpen = _detailOpenCards["cmptype-card"] !== false ? " open" : "";  // aberta por padrão
  const segHtml = bothPhotos
    ? `<div class="act-card collapsible${cmpTypeOpen}" id="cmptype-card">
         <div class="act-head"><span class="act-title">Tipo de comparação</span><span class="chev">▾</span></div>
         <div class="act-body">
           <div class="seg" id="cmp-seg">${segBtn("curtain", "Cortina")}${segBtn("side", "Lado a lado")}${segBtn("overlay", "Sobrepor")}</div>
           <div id="cmp-slider"></div>
           ${locked ? "" : `<button class="btn outline card-full" id="btn-swap">🔁 Inverter base ↔ acompanhamento</button>`}
         </div>
       </div>`
    : "";

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

  const openCls = (id) => _detailOpenCards[id] ? " open" : "";

  // Card FOTOS (v8.5): UMA seção com toggle Base/Acompanhamento e os 3 botões na
  // mesma linha (Refazer / Importar nova / Apagar) + "Pós-processamento". O
  // contorno/distrações/cortar/zoom/girar saíram para a janela de pós-processamento.
  const sideHas = side === "base" ? hasBase : hasFollow;
  const redoLabel = sideHas ? "📷 Refazer" : "📷 Tirar";
  const importLabel = sideHas ? "🖼 Importar nova" : "🖼 Importar";
  const segSide = (val, label) => `<button data-side="${val}"${val === side ? ' class="active"' : ""}>${label}</button>`;
  const photoCard = `
    <div class="act-card collapsible${openCls("photo-card")}" id="photo-card">
      <div class="act-head"><span class="act-title">Fotos</span><span class="chev">▾</span></div>
      <div class="act-body">
        <div class="seg" id="ph-side-seg">${segSide("base", "Base")}${segSide("follow", "Acompanhamento")}</div>
        ${locked ? `<p class="lock-note-inline">🔒 Fotos travadas — comparação concluída.</p>` : `
        <div class="btn-row three">
          <button class="btn outline" id="btn-ph-redo">${redoLabel}</button>
          <button class="btn outline" id="btn-ph-import">${importLabel}</button>
          <button class="btn outline danger" id="btn-ph-del"${sideHas ? "" : " disabled"}>🗑 Apagar</button>
        </div>
        <button class="btn outline card-full" id="btn-ph-post"${sideHas ? "" : " disabled"}>🎛 Pós-processamento</button>`}
      </div>
    </div>`;

  // Card AJUSTES PARA COMPARAÇÃO (v8.5, ex-"Ajustes Finos"): coloração/exposição e
  // posicionamento (o "Inverter" foi para "Tipo de comparação").
  const fineCard = bothPhotos ? `
    <div class="act-card collapsible${openCls("fine-card")}" id="fine-card">
      <div class="act-head"><span class="act-title">Ajustes para comparação</span><span class="chev">▾</span></div>
      <div class="act-body">
        <button class="btn outline card-full" id="btn-adjust">🎚 Colorações e Exposição</button>
        <button class="btn outline card-full" id="btn-reposition">↔️ Posicionamentos</button>
      </div>
    </div>` : "";

  const lockNote = locked
    ? `<p class="lock-note">🔒 Comparação concluída — as fotos não podem mais ser alteradas.</p>`
    : "";

  // v8.3: o botão "Comparar" foi para a topbar (#detail-action). Aqui só monta
  // a foto FIXA no topo e os cards que rolam.
  c.innerHTML =
    `<div class="photo-fixed">${stageHtml}</div>` +
    `<div class="scroll-area">${segHtml + labelHtml + lockNote + photoCard + fineCard}</div>`;

  // Botão "Comparar" na topbar: só quando há acompanhamento.
  const actBtn = $("#detail-action");
  if (actBtn) {
    actBtn.hidden = !bothPhotos;
    actBtn.onclick = bothPhotos ? () => confirmThenSave(s) : null;
  }

  // Ativa a tela ANTES de montar a comparação, para o palco já ter largura
  // (a cortina depende de clientWidth para dimensionar a foto de acompanhamento).
  showScreen("screen-detail");

  if (bothPhotos) {
    renderCompare(mode0);
    $("#cmp-seg").querySelectorAll("button").forEach((b) => {
      b.addEventListener("click", async () => {
        $("#cmp-seg").querySelectorAll("button").forEach((x) => x.classList.remove("active"));
        b.classList.add("active");
        s.compareMode = b.dataset.mode;   // lembra a aba p/ quando voltar à Montagem
        await DB.put(s);
        renderCompare(b.dataset.mode);
        refreshScrollCues();   // troca de modo muda o slider (altura da seção)
      });
    });
  }
  enableWmEdit();
  requestAnimationFrame(sizeWmNames);

  // Cards recolhíveis (Tipo de comparação / Fotos / Ajustes para comparação):
  // o cabeçalho abre/fecha e lembra o estado (p/ reabrir a Montagem igual).
  ["#cmptype-card", "#photo-card", "#fine-card"].forEach((sel) => {
    const card = $(sel);
    if (card) card.querySelector(".act-head").addEventListener("click", () => {
      card.classList.toggle("open");
      _detailOpenCards[card.id] = card.classList.contains("open");
      refreshScrollCues();   // a altura mudou: recalcula a seta de rolagem
    });
  });

  // Toggle Base/Acompanhamento da seção Fotos: troca o lado e re-renderiza.
  if ($("#ph-side-seg")) $("#ph-side-seg").querySelectorAll("button").forEach((b) =>
    b.addEventListener("click", () => {
      if (b.dataset.side === _detailSide) return;
      _detailSide = b.dataset.side;
      _detailOpenCards["photo-card"] = true;   // mantém o card aberto ao trocar
      openDetail(s.id);
    }));

  if ($("#btn-adjust")) $("#btn-adjust").addEventListener("click", () => Editor.open(s));
  if ($("#btn-reposition")) $("#btn-reposition").addEventListener("click", () => Aligner.open(s, s.followOriginal || s.followImage, true));
  // Os 3 botões da seção Fotos agem sobre o LADO selecionado (base/acomp.).
  if ($("#btn-ph-redo")) $("#btn-ph-redo").addEventListener("click", () => Cam.open(side, s));
  if ($("#btn-ph-import")) $("#btn-ph-import").addEventListener("click", () =>
    pickImage().then((file) => side === "base" ? importBasePhoto(file, s) : importFollowPhoto(s, file)));
  if ($("#btn-ph-del")) $("#btn-ph-del").addEventListener("click", () => discardPhoto(s, side));
  if ($("#btn-ph-post")) $("#btn-ph-post").addEventListener("click", () => PostProc.open(s, side));
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

// Apaga a foto de um lado (base/acompanhamento), descartando TODOS os derivados
// daquele lado (ajuste de cor, contorno, distrações, alinhamento). O rótulo é
// mantido para reaproveitar ao tirar/importar de novo. Confirma antes.
async function discardPhoto(s, kind) {
  if (!s) return;
  const nome = kind === "base" ? "a foto base" : "a foto de acompanhamento";
  const ok = await confirmDialog(
    "Apagar foto",
    `Isto descarta <b>${nome}</b> e todos os seus ajustes (cor, contorno, ` +
    `distrações e posicionamento). O rótulo é mantido.<br><br>Deseja apagar?`,
    "Apagar");
  if (!ok) return;
  if (kind === "base") {
    s.baseImage = null;
    s.baseImageView = null; s.baseAdj = null; s.baseTarget = null;
  } else {
    s.followImage = null; s.followOriginal = null; s.followAlign = null;
    s.followImageView = null; s.followAdj = null; s.followTarget = null;
    s.followAt = null;
  }
  clearSketch(s, kind);
  clearDistract(s, kind);
  await DB.put(s);
  await openDetail(s.id);
}

// Troca base ↔ acompanhamento (só as fotos/ajustes; rótulos e datas do rodapé ficam).
async function swapPhotos(s) {
  if (!s || !s.followImage) return;
  const swap = (a, b) => { const t = s[a]; s[a] = s[b]; s[b] = t; };
  swap("baseImage", "followImage");
  swap("baseImageView", "followImageView");
  swap("baseAdj", "followAdj");
  swap("baseTarget", "followTarget");
  // Distrações (v8.1) acompanham a foto: a máscara é normalizada sobre a imagem,
  // que continua com a mesma geometria após a troca; o desfoque assado também.
  swap("baseMask", "followMask");
  swap("baseDefocus", "followDefocus");
  // O acompanhamento passa a ser outra foto: seu "original" vira a própria foto
  // atual e o alinhamento salvo perde sentido (descartado).
  s.followOriginal = s.followImage;
  s.followAlign = null;
  // Ao inverter as fotos, os contornos guardados usam a cor errada (base=verde,
  // acomp.=ciano): descarta p/ serem regerados na cor certa quando reativados.
  clearSketch(s, "all");
  await DB.put(s);
  await openDetail(s.id);
}

/* ---------------- Pós-processamento (v8.5) ----------------
   Janela que age sobre UMA foto (base/acomp.), reunindo as ferramentas por foto:
   Remover distrações, Contorno neon, Cortar, Zoom e Girar. As telas abertas a
   partir daqui voltam para cá (finishTool). */
let _postSide = "base";
let _toolReturn = null;   // "postproc" quando uma ferramenta foi aberta daqui

// As ferramentas (distrações/cortar/zoom/girar) chamam isto ao terminar: volta
// ao Pós-processamento quando aberta de lá; senão à Montagem.
function finishTool(s) {
  const back = _toolReturn;
  _toolReturn = null;
  if (back === "postproc" && s) PostProc.open(s, _postSide);
  else if (s) openDetail(s.id);
  else { showScreen("screen-home"); renderHome(); }
}
window.finishTool = finishTool;

const PostProc = {
  session: null, side: "base",
  async open(session, side) {
    this.session = session;
    this.side = side === "follow" ? "follow" : "base";
    _postSide = this.side;
    const s = session;
    const has = this.side === "base" ? !!s.baseImage : !!s.followImage;
    if (!has) { openDetail(s.id); return; }
    await syncGhosts(s);   // v8.6.1: regera o filtro se a foto mudou
    const src = this.side === "base" ? baseMontageSrc0(s) : followMontageSrc0(s);
    try { const im = await loadImageEl(src); this._aspect = (im.naturalWidth / im.naturalHeight) || 0.75; }
    catch (_) { this._aspect = 0.75; }
    $("#pp-title").textContent = this.side === "base"
      ? "Pós-processamento — Base" : "Pós-processamento — Acompanhamento";
    $("#pp-img").src = src;
    // Filtro do fantasma (v8.6.1): contorno neon e preto e branco são exclusivos.
    const mode = ghostMode(s, this.side);
    const distractOn = this.side === "base" ? !!s.baseMask : !!s.followMask;
    const cb = $("#pp-contour");
    if (cb) { cb.disabled = false; cb.classList.toggle("active", mode === "neon"); cb.textContent = mode === "neon" ? "✨ Contorno: ligado" : "✨ Contorno neon"; }
    const wb = $("#pp-bw");
    if (wb) { wb.disabled = false; wb.classList.toggle("active", mode === "bw"); wb.textContent = mode === "bw" ? "◐ Preto e branco: ligado" : "◐ Preto e branco"; }
    const db = $("#pp-distract");
    if (db) db.classList.toggle("active", distractOn);
    showScreen("screen-postproc");
    requestAnimationFrame(() => this.layout());
  },
  layout() { fitStageEl($("#pp-stage"), this._aspect || 0.75); },
  // Abre uma ferramenta marcando que ao terminar deve voltar ao Pós-processamento.
  openTool(fn) { _toolReturn = "postproc"; fn(); },
  // Liga o filtro pedido; tocar de novo no que já está ligado volta para a foto.
  async setFilter(mode) {
    const s = this.session, side = this.side;
    const cur = ghostMode(s, side);
    const next = cur === mode ? "off" : mode;
    const btn = $(mode === "bw" ? "#pp-bw" : "#pp-contour");
    if (next !== "off" && btn) {
      btn.disabled = true;
      btn.textContent = mode === "bw" ? "◐ Gerando preto e branco…" : "✨ Gerando contorno…";
    }
    try { await setGhostMode(s, side, next); }
    catch (_) {
      if (btn) btn.disabled = false;
      alert("Não foi possível gerar esta versão da foto.");
      return;
    }
    await this.open(s, side);   // re-renderiza o Pós-processamento com o novo estado
  },
  back() { if (this.session) openDetail(this.session.id); },
};
window.PostProc = PostProc;

/* Zoom / Girar de UMA foto (v8.5): amplia/gira e SALVA a foto (base/acomp.),
   passando a valer em toda a comparação. Mesmo aspecto da foto original. */
const PhotoTx = {
  session: null, side: "base", z: 1, rot: 0, src: null, imgW: 1, imgH: 1,
  async open(session, side, focus) {
    this.session = session;
    this.side = side === "follow" ? "follow" : "base";
    this.z = 1; this.rot = 0;
    this.src = this.side === "base" ? baseSrcRaw(session) : followSrcRaw(session);
    if (!this.src) { finishTool(session); return; }
    try { const img = await loadImageEl(this.src); this.imgW = img.naturalWidth || 3; this.imgH = img.naturalHeight || 4; }
    catch (_) { this.imgW = 3; this.imgH = 4; }
    $("#px-img").src = this.src;
    $("#px-zoom").value = 1; $("#px-rot").value = 0;
    $("#px-title").textContent = focus === "rot" ? "Girar foto" : "Zoom da foto";
    showScreen("screen-phototx");
    requestAnimationFrame(() => { this.layout(); this.apply(); });
  },
  layout() { fitStageEl($("#px-stage"), this.imgW / this.imgH); },
  apply() {
    const img = $("#px-img");
    if (img) img.style.transform = `scale(${this.z}) rotate(${this.rot}deg)`;
  },
  async confirm() {
    const img = await loadImageEl(this.src);
    const W = img.naturalWidth, H = img.naturalHeight;
    const c = document.createElement("canvas");
    c.width = W; c.height = H;
    const ctx = c.getContext("2d");
    ctx.fillStyle = "#000"; ctx.fillRect(0, 0, W, H);
    ctx.translate(W / 2, H / 2);
    ctx.scale(this.z, this.z);
    ctx.rotate(this.rot * Math.PI / 180);
    ctx.drawImage(img, -W / 2, -H / 2, W, H);
    const out = c.toDataURL("image/jpeg", 0.92);
    const s = this.session;
    // v8.6.1: gira/amplia a máscara de distrações com a MESMA transformação, para
    // o desfoque continuar em cima do que o médico marcou (antes era descartado).
    const mk = this.side === "base" ? "baseMask" : "followMask";
    const newMask = typeof remapMask === "function"
      ? await remapMask(s[mk], W, H, (mx, mi) => {
          mx.translate(W / 2, H / 2);
          mx.scale(this.z, this.z);
          mx.rotate(this.rot * Math.PI / 180);
          mx.drawImage(mi, -W / 2, -H / 2, W, H);
        })
      : null;
    if (this.side === "base") {
      s.baseImage = out; s.baseImageView = null; s.baseAdj = null; s.baseTarget = null;
    } else {
      s.followImage = out; s.followOriginal = out; s.followAlign = null;
      s.followImageView = null; s.followAdj = null; s.followTarget = null;
    }
    if (typeof clearSketch === "function") clearSketch(s, this.side);
    if (newMask) { s[mk] = newMask; await rebakeDefocus(s, this.side); }
    else if (typeof clearDistract === "function") clearDistract(s, this.side);
    await DB.put(s);
    finishTool(s);
  },
  cancel() { finishTool(this.session); },
};
window.PhotoTx = PhotoTx;

// Controles das telas Pós-processamento e Zoom/Girar (v8.5).
window.addEventListener("DOMContentLoaded", () => {
  const pp = (id) => $(id);
  if (pp("#pp-back")) pp("#pp-back").addEventListener("click", () => PostProc.back());
  if (pp("#pp-distract")) pp("#pp-distract").addEventListener("click", () =>
    PostProc.openTool(() => Distract.open(PostProc.session, PostProc.side)));
  if (pp("#pp-contour")) pp("#pp-contour").addEventListener("click", () => PostProc.setFilter("neon"));
  if (pp("#pp-bw")) pp("#pp-bw").addEventListener("click", () => PostProc.setFilter("bw"));
  if (pp("#pp-crop")) pp("#pp-crop").addEventListener("click", () =>
    PostProc.openTool(() => Cropper.open(PostProc.session, PostProc.side)));
  if (pp("#pp-zoom")) pp("#pp-zoom").addEventListener("click", () =>
    PostProc.openTool(() => PhotoTx.open(PostProc.session, PostProc.side, "zoom")));
  if (pp("#pp-rot")) pp("#pp-rot").addEventListener("click", () =>
    PostProc.openTool(() => PhotoTx.open(PostProc.session, PostProc.side, "rot")));
  if (pp("#px-cancel")) pp("#px-cancel").addEventListener("click", () => PhotoTx.cancel());
  if (pp("#px-confirm")) pp("#px-confirm").addEventListener("click", () => PhotoTx.confirm());
  if (pp("#px-zoom")) pp("#px-zoom").addEventListener("input", (e) => { PhotoTx.z = parseFloat(e.target.value); PhotoTx.apply(); });
  if (pp("#px-rot")) pp("#px-rot").addEventListener("input", (e) => { PhotoTx.rot = parseFloat(e.target.value); PhotoTx.apply(); });
  window.addEventListener("resize", () => {
    if ($("#screen-postproc") && $("#screen-postproc").classList.contains("active")) PostProc.layout();
    if ($("#screen-phototx") && $("#screen-phototx").classList.contains("active")) PhotoTx.layout();
    // v8.6.1: o fantasma é posicionado em px sobre o frame — refaz ao virar a tela.
    if ($("#screen-camera") && $("#screen-camera").classList.contains("active")) Cam.layoutGhost();
  });
});

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

// Clicar em "Comparar" abre o diálogo "Gerar comparação".
// v8.6.1: NÃO trava mais a comparação aqui. Antes, só abrir o diálogo já
// confirmava o crédito e dava a comparação por concluída — quem abrisse e
// fechasse no X, sem gerar foto nem vídeo, perdia o crédito e ficava com as
// fotos travadas. Agora quem conclui é o salvamento de verdade (Share.handle).
async function lockAndGenerate(s) {
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
async function refreshCompareCaptions() {
  const s = _detailSession;
  if (!s) return;
  await ensureMontageFrame(s);
  // Sem as duas fotos não há comparação: mostra a única foto (ou o vazio) e sai.
  if (!s.baseImage || !s.followImage) {
    const host = $("#cmp-host");
    const src = s.baseImage ? baseMontageSrc(s) : (s.followImage ? followMontageSrc(s) : null);
    const lbl = s.baseImage ? s.baseLabel : s.followLabel;
    if (host) host.innerHTML = src
      ? `<img src="${src}" style="object-fit:contain" />${capHtml(lbl, "cap-center", s.showLabels)}${Profile.wmHtml(Profile.config(), true)}`
      : `<div class="empty-photo">Sem foto.<br>Use os botões abaixo para <b>tirar</b> ou <b>importar</b>.</div>`;
    requestAnimationFrame(sizeWmNames);
    return;
  }
  const active = $("#cmp-seg") && $("#cmp-seg").querySelector("button.active");
  renderCompare(active ? active.dataset.mode : "curtain");
}

function renderCompare(mode) {
  const s = _detailSession;
  const host = $("#cmp-host");
  // v8.3: o slider (cortina/sobrepor) vai para a seção "Tipo de comparação"
  // (#cmp-slider), NÃO junto da foto fixa. #cmp-host guarda só o palco.
  const sliderHost = $("#cmp-slider");
  if (sliderHost) sliderHost.innerHTML = "";
  const show = s.showLabels;
  const capB = capHtml(s.baseLabel, "cap-left", show);
  const capF = capHtml(s.followLabel, "cap-right", show);
  const wm = Profile.wmHtml(Profile.config(), true);
  if (mode === "side") {
    host.innerHTML = `<div class="side-by-side">
        <div class="side-cell"><img src="${baseMontageSrc(s)}" />${capHtml(s.baseLabel, "cap-center", show)}${wm}</div>
        <div class="side-cell"><img src="${followMontageSrc(s)}" />${capHtml(s.followLabel, "cap-center", show)}${wm}</div>
      </div>`;
    requestAnimationFrame(sizeWmNames);
    return;
  }
  if (mode === "overlay") {
    host.innerHTML = `
      <div class="compare-stage">
        <img src="${baseMontageSrc(s)}" />
        <img src="${followMontageSrc(s)}" id="ov-after" style="opacity:0.5" />
        ${capB}${capF}${wm}
      </div>`;
    if (sliderHost) sliderHost.innerHTML = `<div class="cmp-slider-row"><input type="range" min="0" max="1" step="0.01" value="0.5" id="ov-range" /></div>`;
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
      <img src="${baseMontageSrc(s)}" />
      <div class="after-clip" style="position:absolute;inset:0;width:50%"><img src="${followMontageSrc(s)}" style="width:200%;max-width:none" id="cur-after"/></div>
      <div class="curtain-line" id="cur-line" style="left:50%"></div>
      ${capB}${capF}${wm}
    </div>`;
  if (sliderHost) sliderHost.innerHTML = `<div class="cmp-slider-row"><input type="range" min="0" max="1" step="0.01" value="0.5" id="cur-range" /></div>`;
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
  // Dica de fundo (câmera): fecha e lembra a opção "não mostrar novamente".
  $("#bg-tip-ok").addEventListener("click", () => {
    if ($("#bg-tip-nomore").checked) localStorage.setItem("ff_no_bg_tip", "1");
    $("#bg-tip-dialog").close();
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
  if ($("#cam-contour")) $("#cam-contour").addEventListener("click", () => Cam.cycleGhostMode());
  $("#cam-start").querySelector("button").addEventListener("click", async () => {
    $("#cam-start").hidden = true;
    try { await $("#video").play(); } catch (_) {}
  });
  $("#ghost-opacity").addEventListener("input", (e) => {
    $("#ghost").style.opacity = e.target.value;
  });
  $("#cam-zoom").addEventListener("input", (e) => Cam.setZoom(parseFloat(e.target.value)));
  ["#f-brightness", "#f-contrast", "#f-saturate"].forEach((sel) => {
    $(sel).addEventListener("input", () => Cam.applyLiveFilter());
  });

  // Pinça para dar zoom direto sobre o vídeo (iOS via gesture, Android via 2 toques).
  setupCameraPinch();

  $("#detail-back").addEventListener("click", async () => {
    showScreen("screen-home");
    await renderHome();
  });
}

/* ---------- Pinça de zoom na câmera (iOS via gesture, Android via 2 toques) ---------- */
function setupCameraPinch() {
  const stage = $("#screen-camera");
  if (!stage) return;
  const active = () => stage.classList.contains("active");
  const supportsGesture = typeof window.GestureEvent !== "undefined";
  const d2 = (t) => Math.hypot(t[0].clientX - t[1].clientX, t[0].clientY - t[1].clientY) || 1;
  let pinchBase = null, gZoom = 1, gestureOn = false;

  // ----- Safari/iOS: gesture events -----
  stage.addEventListener("gesturestart", (e) => {
    if (!active()) return;
    e.preventDefault(); gestureOn = true; gZoom = Cam.zoom || 1;
  }, { passive: false });
  stage.addEventListener("gesturechange", (e) => {
    if (!gestureOn) return;
    e.preventDefault(); Cam.setZoom(gZoom * e.scale);
  }, { passive: false });
  const gEnd = () => { gestureOn = false; };
  stage.addEventListener("gestureend", gEnd, { passive: false });

  // ----- Android: pinça por 2 toques -----
  stage.addEventListener("touchstart", (e) => {
    if (supportsGesture) return;
    if (e.touches.length >= 2) pinchBase = { dist: d2(e.touches), zoom: Cam.zoom || 1 };
  }, { passive: false });
  stage.addEventListener("touchmove", (e) => {
    if (supportsGesture || !pinchBase || e.touches.length < 2) return;
    e.preventDefault();
    Cam.setZoom(pinchBase.zoom * (d2(e.touches) / pinchBase.dist));
  }, { passive: false });
  const tEnd = (e) => { if (e.touches.length < 2) pinchBase = null; };
  stage.addEventListener("touchend", tEnd);
  stage.addEventListener("touchcancel", tEnd);
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
