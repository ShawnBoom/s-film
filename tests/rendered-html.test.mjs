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
  assert.match(html, /FUJI Nostalgic Neg/);
  assert.match(html, /FUJI Classic Neg/);
  assert.match(html, /FUJI Classic Chrome/);
  assert.match(html, /FUJI Pro 400H/);
  assert.match(html, /FUJI Superia 400/);
  assert.match(html, /FUJI Color 100/);
  assert.match(html, /FUJI Color 800Z/);
  assert.match(html, /KODAK Gold Blue/);
  assert.match(html, /KODAK Portra Cool/);
  assert.match(html, /KODAK Proimage 100/);
  assert.match(html, /KODAK Ektar 100/);
  assert.match(html, /KODAK Portra 400/);
  assert.match(html, /KODAK Gold 200/);
  assert.match(html, /KODAK Chrome 64/);
  assert.match(html, />Nostalgic<\/span><span>Neg</);
  assert.match(html, />Classic<\/span><span>Neg</);
  assert.match(html, />Classic<\/span><span>Chrome</);
  assert.match(html, />Provia<\/span><span>400H</);
  assert.match(html, />Superia<\/span><span>400</);
  assert.match(html, />Color<\/span><span>100</);
  assert.match(html, />Color<\/span><span>800Z</);
  assert.match(html, />Gold<\/span><span>Blue</);
  assert.match(html, />Portra<\/span><span>Cool</);
  assert.match(html, />Proimage<\/span><span>100</);
  assert.match(html, />Ektar<\/span><span>100</);
  assert.match(html, />Portra<\/span><span>400</);
  assert.match(html, />Gold<\/span><span>200</);
  assert.match(html, />Chrome<\/span><span>64</);
  assert.equal(Array.from(html.matchAll(/class="filter-button/g)).length, 14);
  assert.doesNotMatch(html, />S0[1-9]</);
  assert.doesNotMatch(html, />#S(?:0[1-9]|1[0-4])</);
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
  assert.match(page, /visibleEditLabel\(currentEdit, showOriginal\)/);
  assert.match(page, /if \(currentHasEdits\) setShowOriginal/);
  assert.match(staticApp, /visibleEditLabel\(edit, state\.showOriginal\)/);
  assert.match(staticApp, /value && photo && hasEdits\(photo\.edit\)/);
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

  assert.match(page, /label:\s*"Nostalgic Neg"/);
  assert.match(page, /label:\s*"Classic Neg"/);
  assert.match(page, /label:\s*"Classic Chrome"/);
  assert.match(page, /label:\s*"Provia 400H"/);
  assert.match(page, /label:\s*"Superia 400"/);
  assert.match(page, /label:\s*"Color 100"/);
  assert.match(page, /label:\s*"Color 800Z"/);
  assert.match(page, /label:\s*"Gold Blue"/);
  assert.match(page, /label:\s*"Portra Cool"/);
  assert.match(page, /label:\s*"Proimage 100"/);
  assert.match(page, /label:\s*"Ektar 100"/);
  assert.match(page, /label:\s*"Portra 400"/);
  assert.match(page, /label:\s*"Gold 200"/);
  assert.match(page, /label:\s*"Chrome 64"/);
  assert.match(staticHtml, />Nostalgic<\/span><span>Neg</);
  assert.match(staticHtml, />Classic<\/span><span>Neg</);
  assert.match(staticHtml, />Classic<\/span><span>Chrome</);
  assert.match(staticHtml, />Provia<\/span><span>400H</);
  assert.match(staticHtml, />Superia<\/span><span>400</);
  assert.match(staticHtml, />Color<\/span><span>100</);
  assert.match(staticHtml, />Color<\/span><span>800Z</);
  assert.match(staticHtml, />Gold<\/span><span>Blue</);
  assert.match(staticHtml, />Portra<\/span><span>Cool</);
  assert.match(staticHtml, />Proimage<\/span><span>100</);
  assert.match(staticHtml, />Ektar<\/span><span>100</);
  assert.match(staticHtml, />Portra<\/span><span>400</);
  assert.match(staticHtml, />Gold<\/span><span>200</);
  assert.match(staticHtml, />Chrome<\/span><span>64</);
  const firstRowMappings = [
    ["classic", "Nostalgic Neg"],
    ["gold", "Classic Neg"],
    ["youth", "Classic Chrome"],
    ["slot07", "Color 800Z"],
    ["slot06", "Color 100"],
    ["slot04", "Provia 400H"],
    ["slot05", "Superia 400"],
  ];
  const secondRowMappings = [
    ["slot12", "Portra 400"],
    ["slot09", "Portra Cool"],
    ["slot13", "Gold 200"],
    ["slot08", "Gold Blue"],
    ["slot10", "Proimage 100"],
    ["slot11", "Ektar 100"],
    ["slot14", "Chrome 64"],
  ];
  let previousPageIndex = -1;
  let previousStaticIndex = -1;
  for (const [id, label] of [...firstRowMappings, ...secondRowMappings]) {
    const pageIndex = page.indexOf(`{ id: "${id}", label: "${label}"`);
    const staticIndex = staticHtml.indexOf(`data-filter="${id}"`);
    assert.ok(pageIndex > previousPageIndex, `${label} order in app`);
    assert.ok(staticIndex > previousStaticIndex, `${label} order in static page`);
    previousPageIndex = pageIndex;
    previousStaticIndex = staticIndex;
  }
  assert.doesNotMatch(page, /label:\s*"S0[1-9]"/);
  assert.doesNotMatch(page, /label:\s*"#S(?:0[1-9]|1[0-4])"/);
  assert.doesNotMatch(staticHtml, />S0[1-9]</);
  assert.doesNotMatch(staticHtml, />#S(?:0[1-9]|1[0-4])</);
  for (const styles of [appStyles, staticStyles]) {
    assert.match(styles, /--accent:\s*#ffc926/i);
    assert.match(styles, /--privacy-dot:\s*#d52518/i);
    assert.match(styles, /--control-surface:\s*#f3e8cc/i);
    assert.match(styles, /--font-schoolbook:[^;]*Century Schoolbook/i);
    assert.match(styles, /HarmonyOS Sans SC/i);
    assert.doesNotMatch(styles, /--font-clarendon/);
    assert.match(styles, /\.filter-button\s*\{[^}]*color:\s*rgba\(243, 232, 204, 0\.5\)[^}]*font-family:\s*var\(--font-schoolbook\)[^}]*font-size:\s*12px[^}]*font-style:\s*normal/s);
    assert.match(styles, /\.filter-label\s*\{[^}]*flex-direction:\s*column[^}]*align-items:\s*center[^}]*justify-content:\s*center[^}]*text-align:\s*center/s);
    assert.match(styles, /background:\s*var\(--privacy-dot\)/);
    assert.match(styles, /\.filter-button\.is-active\s*\{[^}]*color:\s*var\(--control-surface\)[^}]*font-style:\s*italic/s);
    assert.match(styles, /\.filter-row\s*\{[^}]*grid-template-columns:\s*repeat\(7, minmax\(0, 1fr\)\)[^}]*grid-template-rows:\s*repeat\(2, minmax\(0, 1fr\)\)[^}]*flex:\s*0 0 68px[^}]*min-height:\s*68px/s);
    assert.doesNotMatch(styles, /\.filter-button\s*\{[^}]*border-right/s);
    assert.doesNotMatch(styles, /\.filter-button:nth-child\(7n\)/);
    assert.match(styles, /\.filter-button:nth-child\(-n \+ 7\)\s*\{[^}]*border-bottom:\s*0\.5px solid rgba\(243, 232, 204, 0\.08\)/s);
    assert.match(styles, /\.adjustment-tab\.is-active\s*\{[^}]*background:\s*var\(--accent\)[^}]*color:\s*var\(--privacy-dot\)/s);
    assert.match(styles, /\.adjustment-tab\s*\{[^}]*width:\s*70px[^}]*min-height:\s*26px[^}]*justify-self:\s*center[^}]*color:\s*rgba\(243, 232, 204, 0\.5\)[^}]*font-size:\s*12px/s);
    assert.match(styles, /\.bottom-action\s*\{[^}]*width:\s*fit-content[^}]*padding:\s*0 8px[^}]*justify-self:\s*center[^}]*border-radius:\s*999px[^}]*background:\s*transparent[^}]*color:\s*rgba\(243, 232, 204, 0\.5\)/s);
    assert.match(styles, /\.bottom-action\s*\{[^}]*font-size:\s*12px/s);
    assert.match(styles, /\.save-action\s*\{[^}]*background:\s*transparent[^}]*color:\s*rgba\(243, 232, 204, 0\.5\)/s);
    assert.match(styles, /\.compare-button\s*\{[^}]*border:\s*0[^}]*border-radius:\s*999px[^}]*color:\s*var\(--control-surface\)/s);
    assert.match(styles, /\.compare-button\.is-active\s*\{[^}]*color:\s*var\(--privacy-dot\)/s);
    assert.doesNotMatch(styles, /\.compare-button\.is-active\s*\{[^}]*border-color/s);
    assert.match(styles, /\.privacy-note\s*\{[^}]*color:\s*var\(--control-surface\)/s);
    assert.match(styles, /\.compare-button\s*\{[^}]*color:\s*var\(--control-surface\)/s);
    assert.match(styles, /\.thumbnail\.add-photo\s*\{[^}]*color:\s*var\(--control-surface\)/s);
    assert.match(styles, /\.value-input\s*\{[^}]*color:\s*var\(--control-surface\)[^}]*font-size:\s*15px/s);
    assert.match(styles, /\.photo-count\s*\{[^}]*background:\s*transparent[^}]*color:\s*var\(--privacy-dot\)/s);
    assert.match(styles, /\.bottom-action:active:not\(:disabled\)\s*\{[^}]*padding-right:\s*5px[^}]*padding-left:\s*5px[^}]*border-color:\s*var\(--privacy-dot\)[^}]*background:\s*var\(--privacy-dot\)[^}]*color:\s*var\(--accent\)/s);
    assert.match(styles, /\.thumbnail-rail\s*\{[^}]*position:\s*absolute[^}]*height:\s*40px/s);
    assert.match(styles, /\.photo-stage\s*\{[^}]*flex:\s*1 1 0[^}]*min-height:\s*0/s);
    assert.match(styles, /\.preview-canvas\s*\{[^}]*width:\s*100%[^}]*height:\s*100%[^}]*min-width:\s*0[^}]*min-height:\s*0[^}]*object-fit:\s*contain/s);
    assert.match(styles, /\.welcome-image\s*\{[^}]*position:\s*absolute[^}]*inset:\s*0[^}]*width:\s*100%[^}]*height:\s*100%[^}]*object-fit:\s*cover[^}]*object-position:\s*center[^}]*pointer-events:\s*none/s);
    assert.match(styles, /\.photo-stage:not\(\.has-photo\) \.thumbnail-rail\s*\{[^}]*background:\s*transparent/s);
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

  assert.match(staticHtml, /type="module" src="\.\/app\.js\?v=37"/);
  assert.match(staticHtml, /href="\.\/styles\.css\?v=37"/);
  assert.match(staticApp, /from "\.\/image-engine\.js\?v=37"/);
  assert.match(staticWorker, /see-static-v37/);
  assert.match(staticWorker, /image-engine\.js\?v=37/);
  assert.match(staticWorker, /edit-state\.js\?v=37/);
  assert.match(staticWorker, /s01-classic-neg-lut\.js\?v=37/);
  assert.match(staticWorker, /s02-classic-chrome-lut\.js\?v=37/);
  assert.match(staticWorker, /s03-classic-chrome-lut\.js\?v=37/);
  assert.match(staticWorker, /s04-pro400h-lut\.js\?v=37/);
  assert.match(staticWorker, /s05-superia400-lut\.js\?v=37/);
  assert.match(staticWorker, /s06-color100-lut\.js\?v=37/);
  assert.match(staticWorker, /s07-color800z-lut\.js\?v=37/);
  assert.match(staticWorker, /s08-gold-blue-lut\.js\?v=37/);
  assert.match(staticWorker, /s09-portra-cool-lut\.js\?v=37/);
  assert.match(staticWorker, /s10-proimage-original-lut\.js\?v=37/);
  assert.match(staticWorker, /s11-ektar100-lut\.js\?v=37/);
  assert.match(staticWorker, /s12-portra400-lut\.js\?v=37/);
  assert.match(staticWorker, /s13-gold200-lut\.js\?v=37/);
  assert.match(staticWorker, /s14-chrome64-lut\.js\?v=37/);
  assert.match(staticWorker, /see-welcome\.png/);
  assert.match(appWorker, /see-v21/);
  assert.match(appWorker, /see-welcome\.png/);
});
