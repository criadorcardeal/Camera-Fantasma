/* Service worker: network-first (sempre pega a versao nova quando online;
   usa o cache apenas como reserva offline). */
/* v3.6: botao "Reposicionar imagens"; dialogo "Gerar comparação" com seta Voltar
   e "Salvar fotos separadas"; rodape do video base 1o/4o e acomp 2o/3o; rotulo
   padrao "Antes"/"Depois"+data; travar so a troca de fotos; botoes do editor
   brancos que ficam azuis ao clicar. */
const CACHE = "fotos-fantasma-v28";
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
