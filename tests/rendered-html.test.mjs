import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

async function render() {
  const workerUrl = new URL("../dist/server/index.js", import.meta.url);
  workerUrl.searchParams.set("test", `${process.pid}-${Date.now()}`);
  const { default: worker } = await import(workerUrl.href);

  return worker.fetch(
    new Request("http://localhost/", { headers: { accept: "text/html" } }),
    { ASSETS: { fetch: async () => new Response("Not found", { status: 404 }) } },
    { waitUntil() {}, passThroughOnException() {} },
  );
}

test("server-renders the See experience", async () => {
  const response = await render();
  assert.equal(response.status, 200);
  assert.match(response.headers.get("content-type") ?? "", /^text\/html\b/i);

  const html = await response.text();
  assert.match(html, />See</);
  assert.match(html, /FUJI Classic Chrome/);
  assert.match(html, /KODAK Gold 200/);
  assert.match(html, /FUJI Youth Blue/);
  assert.match(html, /照片仅在本机处理/);
  assert.match(html, /选择手机照片/);
});

test("keeps photo processing local and batch-capable", async () => {
  const [page, layout, packageJson] = await Promise.all([
    readFile(new URL("../app/page.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/layout.tsx", import.meta.url), "utf8"),
    readFile(new URL("../package.json", import.meta.url), "utf8"),
  ]);

  assert.match(page, /processPixels/);
  assert.match(page, /type="file"[^>]*multiple/);
  assert.match(page, /navigator\.share/);
  assert.match(page, /MAX_PHOTOS = 20/);
  assert.match(page, /createElement\("canvas"\)/);
  assert.match(layout, /manifest:\s*"\/manifest\.webmanifest"/);
  assert.match(layout, /PwaRegister/);
  assert.doesNotMatch(packageJson, /react-loading-skeleton/);
});

test("ships the requested iOS and PWA app icons", async () => {
  const [layout, appManifest, staticHtml, staticManifestText] = await Promise.all([
    readFile(new URL("../app/layout.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/manifest.ts", import.meta.url), "utf8"),
    readFile(new URL("../docs/index.html", import.meta.url), "utf8"),
    readFile(new URL("../docs/manifest.webmanifest", import.meta.url), "utf8"),
  ]);
  const staticManifest = JSON.parse(staticManifestText);

  assert.match(layout, /apple-touch-icon\.png/);
  assert.match(layout, /applicationName:\s*"See"/);
  assert.match(appManifest, /icon-192\.png/);
  assert.match(appManifest, /icon-512\.png/);
  assert.match(appManifest, /short_name:\s*"See"/);
  assert.match(staticHtml, /apple-touch-icon-120\.png/);
  assert.match(staticHtml, /apple-touch-icon-152\.png/);
  assert.match(staticHtml, /apple-touch-icon-167\.png/);
  assert.match(staticHtml, /apple-touch-icon-180\.png/);
  assert.match(staticHtml, /apple-mobile-web-app-title" content="See"/);
  assert.equal(staticManifest.name, "See");
  assert.equal(staticManifest.short_name, "See");
  assert.deepEqual(staticManifest.icons.map(({ sizes }) => sizes), ["192x192", "512x512"]);

  const icons = [
    ["../public/apple-touch-icon.png", 180],
    ["../public/icons/apple-touch-icon-120.png", 120],
    ["../public/icons/apple-touch-icon-152.png", 152],
    ["../public/icons/apple-touch-icon-167.png", 167],
    ["../public/icons/apple-touch-icon-180.png", 180],
    ["../public/icons/icon-192.png", 192],
    ["../public/icons/icon-512.png", 512],
    ["../docs/apple-touch-icon.png", 180],
    ["../docs/icons/apple-touch-icon-120.png", 120],
    ["../docs/icons/apple-touch-icon-152.png", 152],
    ["../docs/icons/apple-touch-icon-167.png", 167],
    ["../docs/icons/apple-touch-icon-180.png", 180],
    ["../docs/icons/icon-192.png", 192],
    ["../docs/icons/icon-512.png", 512],
  ];

  for (const [path, size] of icons) {
    const png = await readFile(new URL(path, import.meta.url));
    assert.equal(png.subarray(1, 4).toString("ascii"), "PNG", path);
    assert.equal(png.readUInt32BE(16), size, `${path} width`);
    assert.equal(png.readUInt32BE(20), size, `${path} height`);
  }
});
