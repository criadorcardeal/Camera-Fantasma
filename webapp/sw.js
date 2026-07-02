/* Service worker: network-first (sempre pega a versao nova quando online;
   usa o cache apenas como reserva offline). */
/* re-deploy v3.6.6 (Pages: "try again later" transitorio; nova tentativa). */
/* v3.6.6: alinhamento automatico mais exato — refino fino por otimizacao
   (hill-climb) das 4 variaveis (zoom/rotacao/2 translacoes) maximizando a
   sobreposicao das silhuetas; rotacao limitada a +-90 (nunca inverte a perna);
   resolucao de trabalho maior. */
const CACHE = "fotos-fantasma-v35";
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
