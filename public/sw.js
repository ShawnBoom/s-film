const CORE_CACHE = "see-core-v54";
const RUNTIME_CACHE = "see-runtime-v54";
const APP_SHELL = [
  "/",
  "/manifest.webmanifest",
  "/apple-touch-icon.png",
  "/icons/see-apple-touch-icon-120.png",
  "/icons/see-apple-touch-icon-152.png",
  "/icons/see-apple-touch-icon-167.png",
  "/icons/see-apple-touch-icon-180.png",
  "/icons/see-icon-192.png",
  "/icons/see-icon-512.png",
  "/see-logo.png",
  "/see-welcome.png",
  "/see-cover.png",
  "/og.png",
];

self.addEventListener("install", (event) => {
  event.waitUntil(Promise.all([
    caches.open(CORE_CACHE).then((cache) => cache.addAll(APP_SHELL)),
    self.skipWaiting(),
  ]));
});

self.addEventListener("activate", (event) => {
  event.waitUntil((async () => {
    const keys = await caches.keys();
    await Promise.all(keys
      .filter((key) => key !== CORE_CACHE && key !== RUNTIME_CACHE)
      .map((key) => caches.delete(key)));
    await self.clients.claim();
  })());
});

self.addEventListener("fetch", (event) => {
  const { request } = event;
  const url = new URL(request.url);
  if (request.method !== "GET" || url.origin !== self.location.origin) return;

  if (request.mode === "navigate") {
    const cachePromise = caches.open(CORE_CACHE);
    const networkUpdate = cachePromise.then((cache) => fetch(request).then((response) => {
      if (response.ok) return cache.put("/", response.clone()).then(() => response);
      return response;
    }));
    event.waitUntil(networkUpdate.then(() => undefined).catch(() => undefined));
    event.respondWith(cachePromise.then(async (cache) => (
      await cache.match("/")
      || networkUpdate
    )).catch(() => fetch(request)));
    return;
  }

  if (["script", "style", "image", "font", "manifest"].includes(request.destination)) {
    event.respondWith(caches.open(RUNTIME_CACHE).then(async (cache) => (
      await cache.match(request)
      || fetch(request).then((response) => {
        if (response.ok) return cache.put(request, response.clone()).then(() => response);
        return response;
      })
    )));
  }
});
