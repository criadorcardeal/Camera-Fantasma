"use strict";

/* =========================================================================
   ComparaCam - Backup das comparações. As fotos ficam SÓ no aparelho
   (IndexedDB); este módulo exporta tudo para um arquivo .json (imagens já são
   data URLs) e permite restaurar em outro aparelho. No iPhone usa o Web Share
   (Salvar em Arquivos/nuvem); no desktop, download direto.
   ========================================================================= */

const Backup = {
  file: null,

  async build() {
    const list = await DB.getAll();
    const payload = {
      app: "ComparaCam", format: 1,
      exportedAt: new Date().toISOString(),
      count: list.length, sessions: list,
    };
    const json = JSON.stringify(payload);
    const name = "comparacam-backup-" + new Date().toISOString().slice(0, 10) + ".json";
    this.file = new File([json], name, { type: "application/json" });
    return { count: list.length, bytes: json.length };
  },

  async openDialog() {
    const dlg = document.getElementById("backup-dialog");
    if (!dlg) return;
    const info = document.getElementById("backup-info");
    const btn = document.getElementById("backup-save");
    const imsg = document.getElementById("backup-import-msg");
    if (imsg) imsg.textContent = "";
    info.textContent = "Preparando…";
    btn.disabled = true;
    if (!dlg.open) dlg.showModal();
    try {
      const r = await this.build();
      if (r.count === 0) { info.textContent = "Nenhuma comparação para salvar ainda."; btn.disabled = true; return; }
      info.textContent = r.count + " comparação(ões) · " + (r.bytes / 1024 / 1024).toFixed(1) + " MB";
      btn.disabled = false;
    } catch (e) { info.textContent = "Erro ao preparar: " + (e.message || e); }
  },

  async save() {
    if (!this.file) return;
    // iOS: Web Share salva em Arquivos/nuvem; desktop: download direto.
    if (navigator.canShare && navigator.canShare({ files: [this.file] })) {
      try { await navigator.share({ files: [this.file], title: "Backup ComparaCam" }); } catch (_) {}
    } else {
      const url = URL.createObjectURL(this.file);
      const a = document.createElement("a");
      a.href = url; a.download = this.file.name;
      document.body.appendChild(a); a.click(); a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 1500);
    }
  },

  async importFile(file) {
    const msg = document.getElementById("backup-import-msg");
    try {
      const data = JSON.parse(await file.text());
      const sessions = (data && Array.isArray(data.sessions)) ? data.sessions
        : (Array.isArray(data) ? data : null);
      if (!sessions) throw new Error("Arquivo de backup inválido.");
      if (!confirm("Restaurar " + sessions.length + " comparação(ões)? As que tiverem o mesmo código serão sobrescritas; as demais são mantidas.")) return;
      let n = 0;
      for (const s of sessions) { if (s && s.id) { await DB.put(s); n++; } }
      msg.textContent = "✔ " + n + " comparação(ões) restaurada(s).";
      if (typeof renderHome === "function") await renderHome();
    } catch (e) { msg.textContent = "Erro: " + (e.message || e); }
  },
};

window.addEventListener("DOMContentLoaded", () => {
  const on = (id, fn) => { const el = document.getElementById(id); if (el) el.addEventListener("click", fn); };
  on("prof-backup", () => Backup.openDialog());
  on("backup-save", () => Backup.save());
  on("backup-close", () => { const d = document.getElementById("backup-dialog"); if (d && d.open) d.close(); });
  const imp = document.getElementById("backup-import");
  if (imp) imp.addEventListener("change", (e) => {
    const f = e.target.files && e.target.files[0];
    e.target.value = "";
    if (f) Backup.importFile(f);
  });
});
