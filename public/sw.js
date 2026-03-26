const CACHE_VERSION = "fc25-cache-v4";
const ASSETS = [
  "/",
  "/index.html",
  "/styles.css",
  "/app.js",
  "/coupon.html",
  "/coupon.css",
  "/coupon.js",
  "/match.html",
  "/match.css",
  "/match.js",
  "/about.html",
  "/about.css",
  "/developpeur.html",
  "/mode-emploi.html",
  "/mode-emploi.css",
  "/mode-emploi.js",
  "/chat-widget.css",
  "/chat-widget.js",
  "/signature.css",
  "/manifest.webmanifest",
  "/icon-192.svg",
  "/icon-512.svg"
];

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(CACHE_VERSION).then((cache) => cache.addAll(ASSETS)).catch(() => null)
  );
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(
        keys
          .filter((k) => k !== CACHE_VERSION)
          .map((k) => caches.delete(k))
      )
    )
  );
  self.clients.claim();
});

self.addEventListener("fetch", (event) => {
  const req = event.request;
  if (req.method !== "GET") return;

  const url = new URL(req.url);
  if (url.pathname.startsWith("/api/")) {
    event.respondWith(
      fetch(req).catch(() =>
        new Response(
          JSON.stringify({
            success: false,
            message: "Mode hors ligne: API indisponible."
          }),
          {
            status: 503,
            headers: { "Content-Type": "application/json; charset=utf-8" }
          }
        )
      )
    );
    return;
  }

  event.respondWith(
    caches.match(req).then((cached) => {
      if (cached) return cached;
      return fetch(req)
        .then((res) => {
          if (!res || res.status !== 200 || res.type !== "basic") return res;
          const clone = res.clone();
          caches.open(CACHE_VERSION).then((cache) => cache.put(req, clone)).catch(() => null);
          return res;
        })
        .catch(() => caches.match("/index.html"));
    })
  );
});
