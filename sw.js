/* Service worker do Cãotrole.
 * - Shell (HTML/JS/CSS) pré-cacheado com versão; navegação = rede primeiro (nunca serve app velho online).
 * - Estáticos same-origin = stale-while-revalidate.
 * - Nada de outra origem (Supabase, etc.) passa por aqui: dados sempre vêm da rede.
 * Ao mudar o app: suba VERSION aqui, em js/config.js e nos ?v= do index.html (o teste tests/wiring.test.js confere). */
const VERSION = "35";
const CACHE = "caotrole-v" + VERSION;
const SHELL = [
  "/", "/index.html", "/manifest.webmanifest", "/icon.svg", "/icon-192.png",
  "/style.css?v=" + VERSION,
  "/vendor/supabase-2.45.4.js", "/vendor/cropper-1.6.2.min.js", "/vendor/cropper-1.6.2.min.css",
  "/js/config.js?v=" + VERSION, "/js/lib/pure.js?v=" + VERSION, "/js/core.js?v=" + VERSION, "/js/auth.js?v=" + VERSION,
  "/js/router.js?v=" + VERSION, "/js/shared.js?v=" + VERSION, "/js/tutor.js?v=" + VERSION, "/js/creche.js?v=" + VERSION, "/js/main.js?v=" + VERSION
];

self.addEventListener("install", e => {
  e.waitUntil(caches.open(CACHE).then(c => c.addAll(SHELL)).then(() => self.skipWaiting()));
});

self.addEventListener("activate", e => {
  e.waitUntil(
    caches.keys().then(keys => Promise.all(keys.filter(k => k.startsWith("caotrole-") && k !== CACHE).map(k => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener("fetch", e => {
  const req = e.request, url = new URL(req.url);
  if (req.method !== "GET" || url.origin !== self.location.origin) return;

  if (req.mode === "navigate") {
    e.respondWith(fetch(req).catch(() => caches.match("/index.html")));
    return;
  }
  if (url.pathname === "/sw.js") return;
  e.respondWith(caches.open(CACHE).then(async cache => {
    const hit = await cache.match(req);
    const net = fetch(req).then(res => { if (res.ok) cache.put(req, res.clone()); return res; }).catch(() => hit);
    return hit || net;
  }));
});
