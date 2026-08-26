import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import vm from "node:vm";
import test from "node:test";

const helperSource = await readFile(new URL("../lib/lut-pack-sw.js", import.meta.url), "utf8");
const manifest = JSON.parse(await readFile(new URL("../public/lut-pack-v1.json", import.meta.url), "utf8"));
const origin = "https://see.test/";
const manifestUrl = origin + "lut-pack-v1.json";

function keyOf(input, ignoreSearch = false) {
  const value = typeof input === "string" ? input : input.url;
  const url = new URL(value, origin);
  if (ignoreSearch) url.search = "";
  return url.href;
}

class MemoryCache {
  constructor() { this.entries = new Map(); }
  async match(input, options = {}) {
    const key = keyOf(input, options.ignoreSearch);
    if (!options.ignoreSearch) return this.entries.get(key)?.clone();
    for (const [candidate, response] of this.entries) {
      if (keyOf(candidate, true) === key) return response.clone();
    }
    return undefined;
  }
  async put(input, response) { this.entries.set(keyOf(input), response.clone()); }
  async delete(input) { return this.entries.delete(keyOf(input)); }
}

class MemoryCaches {
  constructor() { this.stores = new Map(); }
  async open(name) {
    if (!this.stores.has(name)) this.stores.set(name, new MemoryCache());
    return this.stores.get(name);
  }
  async keys() { return Array.from(this.stores.keys()); }
  async delete(name) { return this.stores.delete(name); }
  async match(input, options) {
    for (const cache of this.stores.values()) {
      const response = await cache.match(input, options);
      if (response) return response;
    }
    return undefined;
  }
}

async function createHarness({ failIds = new Set() } = {}) {
  const caches = new MemoryCaches();
  const binaryByUrl = new Map();
  for (const entry of manifest.luts) {
    const bytes = await readFile(new URL(`../public/${entry.url.slice(2)}`, import.meta.url));
    binaryByUrl.set(new URL(entry.url, manifestUrl).href, bytes);
  }
  const fetchCounts = new Map();
  const self = {
    caches,
    crypto: globalThis.crypto,
    clients: { async matchAll() { return []; } },
    registration: { scope: origin },
    async fetch(input) {
      const url = keyOf(input);
      fetchCounts.set(url, (fetchCounts.get(url) ?? 0) + 1);
      if (url === manifestUrl) return new Response(JSON.stringify(manifest), { status: 200 });
      const entry = manifest.luts.find((candidate) => new URL(candidate.url, manifestUrl).href === url);
      if (entry && failIds.has(entry.id)) throw new TypeError("offline");
      const bytes = binaryByUrl.get(url);
      if (bytes) return new Response(bytes, { status: 200 });
      return new Response("Not found", { status: 404 });
    },
  };
  vm.runInNewContext(helperSource, {
    self,
    Response,
    Headers,
    Request,
    URL,
    Uint8Array,
    Array,
    Object,
    Map,
    Set,
    Promise,
    Date,
    Error,
    String,
    Number,
    Math,
    RegExp,
    JSON,
  });
  return { api: self.SeeLutPackSW, caches, fetchCounts, failIds };
}

test("background preparation resumes partial work, reaches 14/14, and avoids redownload", async () => {
  const harness = await createHarness();
  const cache = await harness.caches.open("see-luts-bin-v1");
  for (const entry of manifest.luts.slice(0, 3)) {
    const bytes = await readFile(new URL(`../public/${entry.url.slice(2)}`, import.meta.url));
    await cache.put(new URL(entry.url, manifestUrl).href, new Response(bytes));
  }
  const result = await harness.api.preparePack(manifestUrl, origin);
  assert.deepEqual(
    { cachedCount: result.cachedCount, ready: result.ready, cachedBytes: result.cachedBytes },
    { cachedCount: 14, ready: true, cachedBytes: manifest.totalBytes },
  );
  const binaryFetches = Array.from(harness.fetchCounts.entries())
    .filter(([url]) => url.endsWith(".bin"))
    .reduce((sum, [, count]) => sum + count, 0);
  assert.equal(binaryFetches, 11);
  await harness.api.preparePack(manifestUrl, origin);
  const afterWarmRun = Array.from(harness.fetchCounts.entries())
    .filter(([url]) => url.endsWith(".bin"))
    .reduce((sum, [, count]) => sum + count, 0);
  assert.equal(afterWarmRun, 11);
});

test("interrupted 13/14 preparation preserves completed files and resumes only the missing LUT", async () => {
  const missing = manifest.luts.at(-1);
  const harness = await createHarness({ failIds: new Set([missing.id]) });
  await assert.rejects(harness.api.preparePack(manifestUrl, origin), /offline/);
  const cache = await harness.caches.open("see-luts-bin-v1");
  let cached = 0;
  for (const entry of manifest.luts) {
    if (await cache.match(new URL(entry.url, manifestUrl).href)) cached += 1;
  }
  assert.equal(cached, 13);
  harness.failIds.delete(missing.id);
  const result = await harness.api.preparePack(manifestUrl, origin);
  assert.equal(result.ready, true);
  assert.equal(result.cachedCount, 14);
  assert.equal(harness.fetchCounts.get(new URL(missing.url, manifestUrl).href), 2);
  for (const entry of manifest.luts.slice(0, -1)) {
    assert.equal(harness.fetchCounts.get(new URL(entry.url, manifestUrl).href), 1);
  }
});

test("concurrent requests for one LUT coalesce and a complete pack serves fully offline", async () => {
  const harness = await createHarness();
  const entry = manifest.luts[7];
  const request = new Request(new URL(entry.url, manifestUrl).href);
  const [first, second] = await Promise.all([
    harness.api.handleBinaryRequest(request, manifestUrl, origin),
    harness.api.handleBinaryRequest(request, manifestUrl, origin),
  ]);
  assert.equal(first.headers.get("x-see-lut-source"), "network");
  assert.equal(second.headers.get("x-see-lut-source"), "network");
  assert.equal(harness.fetchCounts.get(request.url), 1);
  await harness.api.preparePack(manifestUrl, origin);
  for (const candidate of manifest.luts) harness.failIds.add(candidate.id);
  for (const candidate of manifest.luts) {
    const response = await harness.api.handleBinaryRequest(
      new Request(new URL(candidate.url, manifestUrl).href),
      manifestUrl,
      origin,
    );
    assert.equal(response.ok, true);
    assert.equal(response.headers.get("x-see-lut-source"), "Cache Storage");
  }
});

test("failed migration keeps legacy and previous caches; cleanup happens only after full verification", async () => {
  const last = manifest.luts.at(-1);
  const failed = await createHarness({ failIds: new Set([last.id]) });
  await failed.caches.open("see-luts-v52");
  await failed.caches.open("see-static-v48");
  await failed.caches.open("see-luts-bin-v0");
  await assert.rejects(failed.api.preparePack(manifestUrl, origin));
  assert.equal((await failed.caches.keys()).includes("see-luts-v52"), true);
  assert.equal((await failed.caches.keys()).includes("see-static-v48"), true);
  assert.equal((await failed.caches.keys()).includes("see-luts-bin-v0"), true);

  const complete = await createHarness();
  await complete.caches.open("see-luts-v52");
  await complete.caches.open("see-static-v48");
  await complete.caches.open("see-luts-bin-v0");
  await complete.api.preparePack(manifestUrl, origin);
  assert.equal((await complete.caches.keys()).includes("see-luts-v52"), false);
  assert.equal((await complete.caches.keys()).includes("see-static-v48"), false);
  assert.equal((await complete.caches.keys()).includes("see-luts-bin-v0"), false);
});
