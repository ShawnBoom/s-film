"use strict";

const CORE_CACHE = "see-core-v52";
const LUT_CACHE = "see-luts-v52";
const LEGACY_LUT_CACHE = "see-static-v48";
const ROOT = new URL("./", self.registration.scope).href;
const CORE_APP_SHELL = [
  ROOT,
  new URL("./index.html", ROOT).href,
  new URL("./styles.css?v=52", ROOT).href,
  new URL("./app.js?v=52", ROOT).href,
  new URL("./gpu-preview.js?v=52", ROOT).href,
  new URL("./gpu-export.js?v=52", ROOT).href,
  new URL("./export-processor.js?v=52", ROOT).href,
  new URL("./export-worker.js?v=52", ROOT).href,
  new URL("./edit-state.js?v=52", ROOT).href,
  new URL("./image-engine.js?v=52", ROOT).href,
  new URL("./lut-loader.js?v=52", ROOT).href,
  new URL("./manifest.webmanifest?v=52", ROOT).href,
  new URL("./apple-touch-icon.png?v=52", ROOT).href,
  new URL("./icons/see-apple-touch-icon-120.png", ROOT).href,
  new URL("./icons/see-apple-touch-icon-152.png", ROOT).href,
  new URL("./icons/see-apple-touch-icon-167.png", ROOT).href,
  new URL("./icons/see-apple-touch-icon-180.png", ROOT).href,
  new URL("./icons/see-icon-192.png", ROOT).href,
  new URL("./icons/see-icon-512.png", ROOT).href,
  new URL("./see-logo.png", ROOT).href,
  new URL("./see-welcome.png", ROOT).href,
  new URL("./see-cover.png", ROOT).href,
  new URL("./s-film-social.png", ROOT).href,
  new URL("./og.png", ROOT).href,
];

function isLutRequest(url) {
  return /\/s(?:0[1-9]|1[0-4])-[^/]+-lut\.js$/.test(url.pathname);
}

function canonicalLutRequest(request) {
  const url = new URL(request.url);
  url.searchParams.delete("retry");
  return new Request(url.href, request);
}

async function fetchAndCache(request, cacheName, cacheKey = request) {
  const response = await fetch(request);
  if (response.ok) {
    const cache = await caches.open(cacheName);
    await cache.put(cacheKey, response.clone());
  }
  return response;
}

self.addEventListener("install", (event) => {
  event.waitUntil(Promise.all([
    caches.open(CORE_CACHE).then((cache) => cache.addAll(CORE_APP_SHELL)),
    self.skipWaiting(),
  ]));
});

self.addEventListener("activate", (event) => {
  event.waitUntil((async () => {
    const keys = await caches.keys();
    await Promise.all(keys
      .filter((key) => (
        key !== CORE_CACHE
        && key !== LUT_CACHE
        && key !== LEGACY_LUT_CACHE
      ))
      .map((key) => caches.delete(key)));
    await self.clients.claim();
  })());
});

self.addEventListener("fetch", (event) => {
  const { request } = event;
  const url = new URL(request.url);
  if (request.method !== "GET" || url.origin !== self.location.origin) return;

  if (request.mode === "navigate") {
    const coreCachePromise = caches.open(CORE_CACHE);
    const networkUpdate = coreCachePromise.then((cache) => fetch(request).then((response) => {
      if (response.ok) return cache.put(ROOT, response.clone()).then(() => response);
      return response;
    }));
    event.waitUntil(networkUpdate.then(() => undefined).catch(() => undefined));
    event.respondWith(coreCachePromise.then(async (cache) => (
      await cache.match(ROOT)
      || networkUpdate
    )).catch(() => fetch(request)));
    return;
  }

  if (isLutRequest(url)) {
    event.respondWith((async () => {
      const lutCache = await caches.open(LUT_CACHE);
      const cacheKey = canonicalLutRequest(request);
      const cached = await lutCache.match(cacheKey);
      if (cached) return cached;
      try {
        return await fetchAndCache(request, LUT_CACHE, cacheKey);
      } catch (error) {
        const legacyCache = await caches.open(LEGACY_LUT_CACHE);
        const legacy = await legacyCache.match(cacheKey, { ignoreSearch: true });
        if (legacy) return legacy;
        throw error;
      }
    })());
    return;
  }

  if (["script", "style", "image", "font", "manifest"].includes(request.destination)) {
    event.respondWith(caches.open(CORE_CACHE).then(async (cache) => (
      await cache.match(request)
      || fetchAndCache(request, CORE_CACHE)
    )));
  }
});
