/* Service worker: network-first (sempre pega a versao nova quando online;
   usa o cache apenas como reserva offline). */
/* v4.3 (fase paga): login OBRIGATORIO por CODIGO OTP de 6 digitos (Supabase) —
   resolve a dissociacao do iOS (PWA na tela de inicio tem armazenamento separado
   do Safari). Conta/saldo no Perfil (botoes Sair + Trocar perfil); resgatar
   voucher em "Adquirir creditos", seguido de video obrigatorio do patrocinador.
   Bibliotecas externas (supabase-js) sao cacheadas pelo fetch handler apos o 1o
   acesso, para funcionar offline com sessao ja salva. */
const CACHE = "fotos-fantasma-v753";
const ASSETS = [
  "./",
  "./index.html",
  "./styles.css",
  "./credits.js",
  "./app.js",
  "./editor.js",
  "./align.js",
  "./roi.js",
  "./profile.js",
  "./share.js",
  "./account.js",
  "./backup.js",
  "./install.js",
  "./manifest.webmanifest",
  "./icon.svg",
  "./icon-180.png",
  "./icon-192.png",
  "./icon-512.png",
];

self.addEventListener("install", (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(ASSETS)));
  self.skipWaiting();
});

self.addEventListener("activate", (e) => {
  e.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k)))
    )
  );
  self.clients.claim();
});

self.addEventListener("fetch", (e) => {
  const req = e.request;
  if (req.method !== "GET") return;
  e.respondWith(
    fetch(req)
      .then((res) => {
        const copy = res.clone();
        caches.open(CACHE).then((c) => c.put(req, copy)).catch(() => {});
        return res;
      })
      .catch(() => caches.match(req))
  );
});
