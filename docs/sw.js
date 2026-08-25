"use strict";

const CACHE_NAME = "see-static-v42";
const ROOT = new URL("./", self.registration.scope).href;
const APP_SHELL = [
  ROOT,
  new URL("./index.html", ROOT).href,
  new URL("./styles.css?v=42", ROOT).href,
  new URL("./app.js?v=42", ROOT).href,
  new URL("./gpu-preview.js?v=42", ROOT).href,
  new URL("./export-processor.js?v=42", ROOT).href,
  new URL("./export-worker.js?v=42", ROOT).href,
  new URL("./edit-state.js?v=42", ROOT).href,
  new URL("./image-engine.js?v=42", ROOT).href,
  new URL("./s01-classic-neg-lut.js?v=42", ROOT).href,
  new URL("./s02-classic-chrome-lut.js?v=42", ROOT).href,
  new URL("./s03-classic-chrome-lut.js?v=42", ROOT).href,
  new URL("./s04-pro400h-lut.js?v=42", ROOT).href,
  new URL("./s05-superia400-lut.js?v=42", ROOT).href,
  new URL("./s06-color100-lut.js?v=42", ROOT).href,
  new URL("./s07-color800z-lut.js?v=42", ROOT).href,
  new URL("./s08-gold-blue-lut.js?v=42", ROOT).href,
  new URL("./s09-portra-cool-lut.js?v=42", ROOT).href,
  new URL("./s10-proimage-original-lut.js?v=42", ROOT).href,
  new URL("./s11-ektar100-lut.js?v=42", ROOT).href,
  new URL("./s12-portra400-lut.js?v=42", ROOT).href,
  new URL("./s13-gold200-lut.js?v=42", ROOT).href,
  new URL("./s14-chrome64-lut.js?v=42", ROOT).href,
  new URL("./manifest.webmanifest?v=42", ROOT).href,
  new URL("./apple-touch-icon.png?v=42", ROOT).href,
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
