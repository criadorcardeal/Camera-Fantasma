"use strict";

/* =========================================================================
   ComparaCam - splash de abertura + convite/tutorial "Instalar na tela de
   início". No iPhone/iPad (Safari, fora da tela de início) o banner SEMPRE
   aparece; o X esconde só na sessão atual. O toque no banner abre o passo a
   passo ilustrado (o iOS não permite instalar automaticamente).
   ========================================================================= */

// ---- Splash: some suavemente após carregar ----
window.addEventListener("load", () => {
  const sp = document.getElementById("app-splash");
  if (!sp) return;
  setTimeout(() => {
    sp.classList.add("hide");
    setTimeout(() => sp.remove(), 450);
  }, 850);
});

(function () {
  const standalone = window.matchMedia("(display-mode: standalone)").matches ||
    window.navigator.standalone === true;
  if (standalone) return;   // já instalado: nada de banner

  const ua = navigator.userAgent;
  const isIOS = /iphone|ipad|ipod/i.test(ua) ||
    (/Macintosh/.test(ua) && navigator.maxTouchPoints > 1);   // iPadOS

  const shareIcon = '<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="#1b5e8c" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 15V4"/><path d="M8 8l4-4 4 4"/><path d="M6 12H5a2 2 0 0 0-2 2v5a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-5a2 2 0 0 0-2-2h-1"/></svg>';
  const plusIcon = '<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="#1b5e8c" stroke-width="2" stroke-linecap="round"><rect x="3" y="3" width="18" height="18" rx="4"/><path d="M12 8v8M8 12h8"/></svg>';

  function openHelp() {
    if (document.querySelector(".ihelp-overlay")) return;
    const o = document.createElement("div");
    o.className = "ihelp-overlay";
    o.innerHTML =
      '<div class="ihelp-card">' +
      '<button class="ihelp-close" type="button" aria-label="Fechar">✕</button>' +
      "<h3>Use como app — não perca suas comparações</h3>" +
      '<p class="ihelp-warn">Você está no <b>Safari</b>. Aqui as comparações podem ' +
      '<b>ser perdidas</b> se você abrir o app em outra aba/janela ou o navegador limpar os dados. ' +
      'Adicione à <b>Tela de Início</b> para usar como aplicativo e manter tudo salvo:</p>' +
      '<div class="ihelp-step"><span class="ihelp-num">1</span><p>Toque em <b>Compartilhar</b> ' + shareIcon + " na barra do Safari.</p></div>" +
      '<div class="ihelp-step"><span class="ihelp-num">2</span><p>Role e toque em <b>Adicionar à Tela de Início</b> ' + plusIcon + ".</p></div>" +
      '<div class="ihelp-step"><span class="ihelp-num">3</span><p>Toque em <b>Adicionar</b>, no canto superior direito.</p></div>' +
      '<button class="ihelp-backup" type="button">💾 Fazer backup agora</button>' +
      '<button class="ihelp-ok" type="button">Entendi</button>' +
      "</div>";
    document.body.appendChild(o);
    const close = () => o.remove();
    o.querySelector(".ihelp-close").addEventListener("click", close);
    o.querySelector(".ihelp-ok").addEventListener("click", close);
    o.querySelector(".ihelp-backup").addEventListener("click", () => {
      if (typeof Backup !== "undefined") Backup.openDialog();
    });
    o.addEventListener("click", (e) => { if (e.target === o) close(); });
  }

  function showBanner(opts) {
    if (document.querySelector(".install-banner")) return;
    const b = document.createElement("div");
    b.className = "install-banner";
    b.innerHTML =
      '<img src="./icon.svg" class="ib-ic" alt="" />' +
      '<div class="ib-txt"><b>Instalar o ComparaCam</b><span>' + opts.sub + "</span></div>";
    document.body.appendChild(b);
    if (opts.actionLabel) {
      const btn = document.createElement("button");
      btn.className = "ib-btn"; btn.type = "button"; btn.textContent = opts.actionLabel;
      btn.addEventListener("click", opts.onAction);
      b.appendChild(btn);
    }
    const x = document.createElement("button");
    x.className = "ib-close"; x.type = "button"; x.setAttribute("aria-label", "Fechar");
    x.textContent = "✕";
    x.addEventListener("click", () => { b.remove(); if (opts.onClose) opts.onClose(); });
    b.appendChild(x);
    if (opts.onTap) {
      const txt = b.querySelector(".ib-txt"), ic = b.querySelector(".ib-ic");
      txt.style.cursor = "pointer"; ic.style.cursor = "pointer";
      txt.addEventListener("click", opts.onTap);
      ic.addEventListener("click", opts.onTap);
    }
    return b;
  }

  if (isIOS) {
    // Popup de aviso (risco de perder comparações no Safari) — 1x por sessão.
    if (sessionStorage.getItem("cc_safari_warned") !== "1") {
      sessionStorage.setItem("cc_safari_warned", "1");
      setTimeout(openHelp, 2200);
    }
    // Banner persistente; X esconde só nesta sessão (volta na próxima visita).
    if (sessionStorage.getItem("cc_install_hidden") === "1") return;
    setTimeout(() => showBanner({
      sub: "Toque em “Ver como” para usar como app.",
      actionLabel: "Ver como",
      onAction: openHelp,
      onTap: openHelp,
      onClose: () => sessionStorage.setItem("cc_install_hidden", "1"),
    }), 1500);
    return;
  }

  // Android/Chrome: prompt nativo de instalação (dispensa permanente).
  if (localStorage.getItem("cc_install_dismissed") === "1") return;
  let deferred = null;
  window.addEventListener("beforeinstallprompt", (e) => {
    e.preventDefault();
    deferred = e;
    showBanner({
      sub: "Use como um app, direto na tela de início.",
      actionLabel: "Instalar",
      onAction: async () => {
        const bn = document.querySelector(".install-banner");
        if (bn) bn.remove();
        if (!deferred) return;
        deferred.prompt();
        try { await deferred.userChoice; } catch (_) {}
        deferred = null;
      },
      onClose: () => localStorage.setItem("cc_install_dismissed", "1"),
    });
  });
})();
