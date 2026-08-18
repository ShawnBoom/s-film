"use strict";

const CACHE_NAME = "s-film-static-v4";
const ROOT = new URL("./", self.registration.scope).href;
const APP_SHELL = [
  ROOT,
  new URL("./index.html", ROOT).href,
  new URL("./styles.css", ROOT).href,
  new URL("./app.js", ROOT).href,
  new URL("./manifest.webmanifest", ROOT).href,
  new URL("./sample-neutral.png", ROOT).href,
  new URL("./s-film-social.png", ROOT).href,
  new URL("./og.png", ROOT).href,
];

self.addEventListener("install", (event) => {
  event.waitUntil(caches.open(CACHE_NAME).then((cache) => cache.addAll(APP_SHELL)));
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys().then((keys) => Promise.all(
      keys.filter((key) => key !== CACHE_NAME).map((key) => caches.delete(key)),
    )),
  );
  self.clients.claim();
});

self.addEventListener("fetch", (event) => {
  const { request } = event;
  const url = new URL(request.url);
  if (request.method !== "GET" || url.origin !== self.location.origin) return;

  if (request.mode === "navigate") {
    event.respondWith(fetch(request).catch(() => caches.match(ROOT)));
    return;
  }

  if (["script", "style", "image", "font", "manifest"].includes(request.destination)) {
    event.respondWith(
      caches.match(request).then((cached) => cached || fetch(request).then((response) => {
        const copy = response.clone();
        caches.open(CACHE_NAME).then((cache) => cache.put(request, copy));
        return response;
      })),
    );
  }
});
