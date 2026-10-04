/* Service worker: network-first (sempre pega a versao nova quando online;
   usa o cache apenas como reserva offline). */
/* v4.3 (fase paga): login OBRIGATORIO por CODIGO OTP de 6 digitos (Supabase) —
   resolve a dissociacao do iOS (PWA na tela de inicio tem armazenamento separado
   do Safari). Conta/saldo no Perfil (botoes Sair + Trocar perfil); resgatar
   voucher em "Adquirir creditos", seguido de video obrigatorio do patrocinador.
   Bibliotecas externas (supabase-js) sao cacheadas pelo fetch handler apos o 1o
   acesso, para funcionar offline com sessao ja salva. */
/* v8.6.1: (1) faixa azul do topo imóvel (documento não rola mais no Android);
   (2) o desfoque de "Remover distrações" sobrevive a cortar/zoom/girar/
   reposicionar (a máscara é levada pela mesma transformação); (3) a comparação
   só é dada por concluída quando uma foto/vídeo é realmente salvo, não ao abrir
   o diálogo; (4) a câmera de acompanhamento retoma o zoom da foto base e o
   fantasma é encaixado sobre o frame do vídeo (fim do zoom aparente);
   (5) novo filtro "Preto e branco" para a foto fantasma, ao lado do contorno. */
/* v8.6.2: a foto fantasma aparece INTEIRA na câmera. No Android ela vinha
   ampliada pelo recorte "cover" do frame e as bordas ficavam fora da tela;
   agora ela é ajustada dentro da área visível com 4% de folga (Cam.GHOST_MARGIN
   em app.js), sem seguir o zoom. */
/* v8.7 = MARCO ESTÁVEL: consolida v8.6.1 + v8.6.2 sem mudança funcional
   (só promoção de versão: badge + cache do service worker). */
const CACHE = "fotos-fantasma-v87";
const ASSETS = [
  "./",
  "./index.html",
  "./styles.css",
  "./credits.js",
  "./sketch.js",
  "./app.js",
  "./editor.js",
  "./align.js",
  "./distract.js",
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
