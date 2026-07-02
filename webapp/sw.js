/* Service worker: network-first (sempre pega a versao nova quando online;
   usa o cache apenas como reserva offline). */
/* v3.6.4: botao "Alinhamento automatico" na tela de alinhar/reposicionar —
   detecta a silhueta (parte do corpo) nas 2 fotos e gira/escala/move o
   acompanhamento p/ empilhar na base (momentos + refino por IoU das mascaras). */
const CACHE = "fotos-fantasma-v33";
const ASSETS = [
  "./",
  "./index.html",
  "./styles.css",
  "./credits.js",
  "./app.js",
  "./editor.js",
  "./align.js",
  "./profile.js",
  "./share.js",
  "./manifest.webmanifest",
  "./icon.svg",
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
