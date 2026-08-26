import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFile, stat } from "node:fs/promises";
import test from "node:test";

import { LUT_SOURCES } from "../scripts/lut-pack-sources.mjs";

const manifest = JSON.parse(await readFile(new URL("../public/lut-pack-v1.json", import.meta.url), "utf8"));

test("all 14 raw Float32 binaries exist with exact dimensions, counts, bytes, and checksums", async () => {
  assert.equal(manifest.luts.length, 14);
  assert.equal(manifest.totalBytes, 22_080_576);
  for (const [index, source] of LUT_SOURCES.entries()) {
    const entry = manifest.luts[index];
    assert.equal(entry.id, source.id);
    assert.equal(entry.displayName, source.displayName);
    assert.equal(entry.dimension, source.dimension);
    assert.equal(entry.floatCount, source.dimension ** 3 * 3);
    assert.equal(entry.byteLength, entry.floatCount * 4);
    const binaryUrl = new URL(`../public/${entry.url.slice(2)}`, import.meta.url);
    const bytes = await readFile(binaryUrl);
    assert.equal((await stat(binaryUrl)).size, entry.byteLength);
    assert.equal(createHash("sha256").update(bytes).digest("hex"), entry.sha256);
  }
});

test("binary conversion is bit-for-bit Float32 identical to every current JS LUT", async () => {
  for (const [index, source] of LUT_SOURCES.entries()) {
    const entry = manifest.luts[index];
    const legacyModule = await import(new URL(`../lib/${source.module}`, import.meta.url));
    const legacy = legacyModule[source.dataExport];
    const binary = await readFile(new URL(`../public/${entry.url.slice(2)}`, import.meta.url));
    const legacyBytes = Buffer.from(legacy.buffer, legacy.byteOffset, legacy.byteLength);
    assert.equal(Buffer.compare(binary, legacyBytes), 0, `${source.id} must remain bit exact`);
  }
});

test("public and GitHub Pages binary packs are identical", async () => {
  const docsManifest = await readFile(new URL("../docs/lut-pack-v1.json", import.meta.url));
  const publicManifest = await readFile(new URL("../public/lut-pack-v1.json", import.meta.url));
  assert.equal(Buffer.compare(docsManifest, publicManifest), 0);
  for (const entry of manifest.luts) {
    const relative = entry.url.slice(2);
    const [publicBinary, docsBinary] = await Promise.all([
      readFile(new URL(`../public/${relative}`, import.meta.url)),
      readFile(new URL(`../docs/${relative}`, import.meta.url)),
    ]);
    assert.equal(Buffer.compare(publicBinary, docsBinary), 0, entry.id);
  }
});

test("build source registry and runtime manifest preserve the intentional visual order", () => {
  assert.deepEqual(
    manifest.luts.map(({ id, displayName, dimension }) => ({ id, displayName, dimension })),
    LUT_SOURCES.map(({ id, displayName, dimension }) => ({ id, displayName, dimension })),
  );
});
