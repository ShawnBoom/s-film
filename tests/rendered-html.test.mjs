import assert from "node:assert/strict";
import { createHash } from "node:crypto";
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
  assert.match(html, /src="\/see-logo\.png"/);
  assert.match(html, /alt="See"/);
  assert.match(html, /FUJI Classic Chrome/);
  assert.match(html, /KODAK Gold 200/);
  assert.match(html, /FUJI Youth Blue/);
  assert.match(html, />S01</);
  assert.match(html, />S02</);
  assert.match(html, />S03</);
  assert.doesNotMatch(html, />#S0[123]</);
  assert.match(html, /照片仅在本机处理/);
  assert.match(html, /src="\/see-welcome\.png"/);
  assert.doesNotMatch(html, /class="empty-upload"/);
  assert.doesNotMatch(html, />添加照片<\/button>/);
  assert.match(html, />Reset</);
  assert.match(html, />Apply All</);
  assert.match(html, />Save</);
});

test("keeps photo processing local, independent per photo, and batch-capable", async () => {
  const [page, engine, staticApp, layout, packageJson] = await Promise.all([
    readFile(new URL("../app/page.tsx", import.meta.url), "utf8"),
    readFile(new URL("../lib/image-engine.js", import.meta.url), "utf8"),
    readFile(new URL("../docs/app.js", import.meta.url), "utf8"),
    readFile(new URL("../app/layout.tsx", import.meta.url), "utf8"),
    readFile(new URL("../package.json", import.meta.url), "utf8"),
  ]);

  assert.match(page, /processPixels/);
  assert.match(page, /edit:\s*EditState/);
  assert.match(page, /filter:\s*null,\s*strength:\s*100,\s*brightness:\s*0,\s*color:\s*0,\s*grain:\s*0/);
  assert.match(page, /type="file"[^>]*multiple/);
  assert.match(page, /navigator\.share/);
  assert.match(page, /createZip/);
  assert.match(page, /applyToAll/);
  assert.match(page, /deleteCurrent/);
  assert.match(page, /requestAnimationFrame/);
  assert.match(page, /showOriginal \? "Edited" : "Original"/);
  assert.match(page, /type="number"/);
  assert.match(page, /updateAdjustmentValue/);
  assert.match(page, /MAX_PHOTOS = 20/);
  assert.match(page, /createElement\("canvas"\)/);
  assert.match(page, /0\.95/);
  assert.match(engine, /linearRgbToOklab/);
  assert.match(engine, /applyExposure/);
  assert.match(engine, /valueNoise/);
  assert.match(engine, /strength === 0/);
  assert.match(staticApp, /edit:\s*createNeutralEdit\(\)/);
  assert.match(staticApp, /navigator\.canShare/);
  assert.match(staticApp, /See_Photos\.zip/);
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
  assert.match(layout, /title:\s*"See\."/);
  assert.match(layout, /applicationName:\s*"See\."/);
  assert.match(appManifest, /see-icon-192\.png/);
  assert.match(appManifest, /see-icon-512\.png/);
  assert.match(appManifest, /name:\s*"See\."/);
  assert.match(appManifest, /short_name:\s*"See\."/);
  assert.match(staticHtml, /see-apple-touch-icon-120\.png/);
  assert.match(staticHtml, /see-apple-touch-icon-152\.png/);
  assert.match(staticHtml, /see-apple-touch-icon-167\.png/);
  assert.match(staticHtml, /see-apple-touch-icon-180\.png/);
  assert.match(staticHtml, /apple-mobile-web-app-title" content="See\."/);
  assert.match(staticHtml, /<title>See\.<\/title>/);
  assert.doesNotMatch(staticHtml, /S-Film Mobile|See｜手机胶片滤镜/);
  assert.equal(staticManifest.name, "See.");
  assert.equal(staticManifest.short_name, "See.");
  assert.deepEqual(staticManifest.icons.map(({ sizes }) => sizes), ["192x192", "512x512"]);

  const icons = [
    ["../public/apple-touch-icon.png", 180],
    ["../public/icons/see-apple-touch-icon-120.png", 120],
    ["../public/icons/see-apple-touch-icon-152.png", 152],
    ["../public/icons/see-apple-touch-icon-167.png", 167],
    ["../public/icons/see-apple-touch-icon-180.png", 180],
    ["../public/icons/see-icon-192.png", 192],
    ["../public/icons/see-icon-512.png", 512],
    ["../docs/apple-touch-icon.png", 180],
    ["../docs/icons/see-apple-touch-icon-120.png", 120],
    ["../docs/icons/see-apple-touch-icon-152.png", 152],
    ["../docs/icons/see-apple-touch-icon-167.png", 167],
    ["../docs/icons/see-apple-touch-icon-180.png", 180],
    ["../docs/icons/see-icon-192.png", 192],
    ["../docs/icons/see-icon-512.png", 512],
  ];

  for (const [path, size] of icons) {
    const png = await readFile(new URL(path, import.meta.url));
    assert.equal(png.subarray(1, 4).toString("ascii"), "PNG", path);
    assert.equal(png.readUInt32BE(16), size, `${path} width`);
    assert.equal(png.readUInt32BE(20), size, `${path} height`);
  }
});

test("preserves the supplied logo, cover, and welcome image bytes", async () => {
  const assets = [
    ["../public/see-logo.png", "e7d3f9b0e02fa8fc70d8c3ca8624b0a50b76b06967cd3e2958b9fb0a541b597a"],
    ["../docs/see-logo.png", "e7d3f9b0e02fa8fc70d8c3ca8624b0a50b76b06967cd3e2958b9fb0a541b597a"],
    ["../public/see-cover.png", "9b326205899b9e9f55c98a1f0a5e5083d4195a5e634a8cc234056033c2028b54"],
    ["../docs/see-cover.png", "9b326205899b9e9f55c98a1f0a5e5083d4195a5e634a8cc234056033c2028b54"],
    ["../public/see-welcome.png", "45d245f23b5ca47780c1592707eeed632c4b685ea4688a62a8b017ded626e6d4"],
    ["../docs/see-welcome.png", "45d245f23b5ca47780c1592707eeed632c4b685ea4688a62a8b017ded626e6d4"],
  ];

  for (const [path, expectedHash] of assets) {
    const bytes = await readFile(new URL(path, import.meta.url));
    assert.equal(createHash("sha256").update(bytes).digest("hex"), expectedHash, path);
  }
});

test("uses the requested filter labels and interface colors", async () => {
  const [page, appStyles, staticHtml, staticStyles] = await Promise.all([
    readFile(new URL("../app/page.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/globals.css", import.meta.url), "utf8"),
    readFile(new URL("../docs/index.html", import.meta.url), "utf8"),
    readFile(new URL("../docs/styles.css", import.meta.url), "utf8"),
  ]);

  for (const label of ["S01", "S02", "S03"]) {
    assert.match(page, new RegExp(label));
    assert.match(staticHtml, new RegExp(label));
  }
  assert.doesNotMatch(page, /label:\s*"#S0[123]"/);
  assert.doesNotMatch(staticHtml, />#S0[123]</);
  for (const styles of [appStyles, staticStyles]) {
    assert.match(styles, /--accent:\s*#ffc926/i);
    assert.match(styles, /--privacy-dot:\s*#d52518/i);
    assert.match(styles, /--control-surface:\s*#f3e8cc/i);
    assert.match(styles, /--font-schoolbook:[^;]*Century Schoolbook/i);
    assert.match(styles, /HarmonyOS Sans SC/i);
    assert.doesNotMatch(styles, /--font-clarendon/);
    assert.match(styles, /\.filter-button\s*\{[^}]*color:\s*rgba\(243, 232, 204, 0\.5\)[^}]*font-family:\s*var\(--font-schoolbook\)[^}]*font-style:\s*italic/s);
    assert.match(styles, /background:\s*var\(--privacy-dot\)/);
    assert.match(styles, /\.filter-button\.is-active\s*\{[^}]*color:\s*var\(--control-surface\)/s);
    assert.match(styles, /\.adjustment-tab\.is-active\s*\{[^}]*background:\s*var\(--accent\)[^}]*color:\s*var\(--privacy-dot\)/s);
    assert.match(styles, /\.adjustment-tab\s*\{[^}]*color:\s*rgba\(243, 232, 204, 0\.5\)/s);
    assert.match(styles, /\.bottom-action\s*\{[^}]*border-radius:\s*999px[^}]*background:\s*transparent[^}]*color:\s*rgba\(243, 232, 204, 0\.5\)/s);
    assert.match(styles, /\.save-action\s*\{[^}]*background:\s*transparent[^}]*color:\s*rgba\(243, 232, 204, 0\.5\)/s);
    assert.match(styles, /\.compare-button\s*\{[^}]*border:\s*0[^}]*border-radius:\s*999px/s);
    assert.match(styles, /\.compare-button\.is-active\s*\{[^}]*color:\s*var\(--privacy-dot\)/s);
    assert.match(styles, /\.privacy-note\s*\{[^}]*color:\s*var\(--control-surface\)/s);
    assert.match(styles, /\.compare-button\s*\{[^}]*color:\s*var\(--control-surface\)/s);
    assert.match(styles, /\.thumbnail\.add-photo\s*\{[^}]*color:\s*var\(--control-surface\)/s);
    assert.match(styles, /\.value-input\s*\{[^}]*color:\s*var\(--control-surface\)/s);
    assert.match(styles, /\.photo-count\s*\{[^}]*background:\s*transparent[^}]*color:\s*var\(--privacy-dot\)/s);
    assert.match(styles, /\.bottom-action:active:not\(:disabled\)\s*\{[^}]*border-color:\s*var\(--privacy-dot\)[^}]*background:\s*var\(--privacy-dot\)[^}]*color:\s*var\(--accent\)/s);
    assert.match(styles, /\.thumbnail-rail\s*\{[^}]*position:\s*absolute[^}]*height:\s*40px/s);
    assert.match(styles, /\.photo-stage\s*\{[^}]*flex:\s*1 1 0[^}]*min-height:\s*0/s);
    assert.match(styles, /\.preview-canvas\s*\{[^}]*width:\s*100%[^}]*height:\s*100%[^}]*object-fit:\s*contain/s);
    assert.match(styles, /\.welcome-image\s*\{[^}]*width:\s*100%[^}]*height:\s*100%[^}]*object-fit:\s*cover[^}]*pointer-events:\s*none/s);
    assert.doesNotMatch(styles, /\.empty-upload\s*\{/);
    assert.match(styles, /\.thumbnail\.add-photo::before,[^}]*\.thumbnail\.add-photo::after\s*\{[^}]*width:\s*10px[^}]*height:\s*1\.25px/s);
    assert.match(styles, /overflow:\s*hidden/);
    assert.match(styles, /100dvh/);
  }
});

test("ships cache-busted, relative GitHub Pages assets", async () => {
  const [staticHtml, staticWorker, staticApp, appWorker] = await Promise.all([
    readFile(new URL("../docs/index.html", import.meta.url), "utf8"),
    readFile(new URL("../docs/sw.js", import.meta.url), "utf8"),
    readFile(new URL("../docs/app.js", import.meta.url), "utf8"),
    readFile(new URL("../public/sw.js", import.meta.url), "utf8"),
  ]);

  assert.match(staticHtml, /type="module" src="\.\/app\.js\?v=26"/);
  assert.match(staticHtml, /href="\.\/styles\.css\?v=26"/);
  assert.match(staticApp, /from "\.\/image-engine\.js\?v=26"/);
  assert.match(staticWorker, /see-static-v26/);
  assert.match(staticWorker, /image-engine\.js\?v=26/);
  assert.match(staticWorker, /see-welcome\.png/);
  assert.match(appWorker, /see-v16/);
  assert.match(appWorker, /see-welcome\.png/);
});
