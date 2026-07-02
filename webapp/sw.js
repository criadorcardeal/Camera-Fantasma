/* Service worker: network-first (sempre pega a versao nova quando online;
   usa o cache apenas como reserva offline). */
/* v3.5.5 (2a leva): aviso ao salvar (1a vez), slider da cortina abaixo das fotos,
   editar logo/nome sobre as fotos (mover/redimensionar/girar), placeholder "Seu
   nome", checkboxes mostram/ocultam a previa no perfil. */
const CACHE = "fotos-fantasma-v24";
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
