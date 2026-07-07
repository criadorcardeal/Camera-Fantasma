"use strict";

/* =========================================================================
   Polyfill mínimo de <dialog> para Safari antigo (ex.: iPad iOS 12.5 /
   Safari 12.1, que só ganhou <dialog> no Safari 15.4).

   Sem suporte nativo, os <dialog> renderizam como blocos normais e ficam
   TODOS visíveis empilhados na página, e showModal()/close() nem existem.
   Aqui adicionamos a classe .no-dialog no <html> (o CSS esconde os diálogos
   fechados e centraliza os abertos como modal) e implementamos
   show()/showModal()/close()/.open + os eventos close/cancel (Esc).

   Carregado no <head> (script clássico, síncrono) para a classe entrar ANTES
   do body renderizar — evita o "flash" dos diálogos empilhados. Aparelhos
   modernos, com <dialog> nativo, saem logo no início (return) e não são
   afetados. Nenhum diálogo do app é criado dinamicamente, então basta corrigir
   os que já estão no HTML (no DOMContentLoaded).
   ========================================================================= */
(function () {
  // Suporte nativo? Então não faz nada.
  try {
    if (typeof document.createElement("dialog").showModal === "function") return;
  } catch (_) {}

  document.documentElement.className += " no-dialog";

  var openStack = [];      // diálogos modais abertos (o último é o do topo)
  var backdrop = null;

  function syncBackdrop() {
    if (!backdrop) {
      backdrop = document.createElement("div");
      backdrop.className = "dialog-backdrop-polyfill";
      (document.body || document.documentElement).appendChild(backdrop);
    }
    backdrop.style.display = openStack.length ? "block" : "none";
  }

  function fire(el, type, cancelable) {
    var ev;
    try { ev = new Event(type, { cancelable: !!cancelable }); }
    catch (_) { ev = document.createEvent("Event"); ev.initEvent(type, false, !!cancelable); }
    return el.dispatchEvent(ev);
  }

  function patch(dlg) {
    if (dlg._dlgPolyfilled) return;
    dlg._dlgPolyfilled = true;

    Object.defineProperty(dlg, "open", {
      configurable: true,
      get: function () { return this.hasAttribute("open"); },
      set: function (v) { if (v) this.setAttribute("open", ""); else this.removeAttribute("open"); }
    });

    dlg.show = function () {
      if (this.hasAttribute("open")) return;
      this.setAttribute("open", "");
    };

    dlg.showModal = function () {
      if (this.hasAttribute("open")) return;
      this.setAttribute("open", "");
      if (openStack.indexOf(this) === -1) openStack.push(this);
      syncBackdrop();
      // Leva para o topo do body para ficar acima do conteúdo empilhado.
      try { document.body.appendChild(this); } catch (_) {}
      if (this.scrollTop) this.scrollTop = 0;
    };

    dlg.close = function (val) {
      if (val !== undefined) this.returnValue = val;
      if (!this.hasAttribute("open")) return;
      this.removeAttribute("open");
      var i = openStack.indexOf(this);
      if (i !== -1) openStack.splice(i, 1);
      syncBackdrop();
      fire(this, "close", false);
    };
  }

  function patchAll() {
    var dlgs = document.querySelectorAll("dialog");
    for (var i = 0; i < dlgs.length; i++) patch(dlgs[i]);
  }

  // Esc → dispara 'cancel' (cancelável) no diálogo do topo; fecha se não for
  // impedido com preventDefault (mesma semântica do <dialog> nativo).
  document.addEventListener("keydown", function (e) {
    if (e.key !== "Escape" && e.keyCode !== 27) return;
    var top = openStack[openStack.length - 1];
    if (!top) return;
    var notPrevented = fire(top, "cancel", true);
    if (notPrevented) top.close();
  });

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", patchAll);
  } else {
    patchAll();
  }
})();
