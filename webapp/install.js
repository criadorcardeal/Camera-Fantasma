"use strict";

/* =========================================================================
   ComparaCam - splash de abertura + convite "Instalar na tela de início".
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

// ---- Convite para instalar (só no navegador; some quando já instalado) ----
(function () {
  const standalone = window.matchMedia("(display-mode: standalone)").matches ||
    window.navigator.standalone === true;
  if (standalone) return;
  if (localStorage.getItem("cc_install_dismissed") === "1") return;

  const isIOS = /iphone|ipad|ipod/i.test(navigator.userAgent);
  let deferred = null;

  const banner = (inner) => {
    const b = document.createElement("div");
    b.className = "install-banner";
    b.innerHTML =
      '<img src="./icon.svg" class="ib-ic" alt="" />' +
      '<div class="ib-txt">' + inner + "</div>" +
      '<button class="ib-close" type="button" aria-label="Fechar">✕</button>';
    document.body.appendChild(b);
    b.querySelector(".ib-close").addEventListener("click", () => {
      localStorage.setItem("cc_install_dismissed", "1");
      b.remove();
    });
    return b;
  };

  // Android/Chrome: prompt nativo de instalação.
  window.addEventListener("beforeinstallprompt", (e) => {
    e.preventDefault();
    deferred = e;
    const b = banner(
      "<b>Instalar o ComparaCam</b><span>Use como um app, direto na tela de início.</span>");
    const btn = document.createElement("button");
    btn.className = "ib-btn"; btn.type = "button"; btn.textContent = "Instalar";
    b.insertBefore(btn, b.querySelector(".ib-close"));
    btn.addEventListener("click", async () => {
      b.remove();
      if (!deferred) return;
      deferred.prompt();
      try { await deferred.userChoice; } catch (_) {}
      deferred = null;
    });
  });

  // iOS/Safari: não há prompt — mostra a instrução (uma vez, após um instante).
  if (isIOS) {
    setTimeout(() => {
      if (document.querySelector(".install-banner")) return;
      banner('<b>Instalar o ComparaCam</b><span>Toque em Compartilhar ⬆ e em “Adicionar à Tela de Início”.</span>');
    }, 2500);
  }
})();
