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

test("server-renders the S Film experience", async () => {
  const response = await render();
  assert.equal(response.status, 200);
  assert.match(response.headers.get("content-type") ?? "", /^text\/html\b/i);

  const html = await response.text();
  assert.match(html, /S Film/i);
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
