import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import { getFilterLut } from "../lib/image-engine.js";
import { FILTER_LUT_MANIFEST, loadFilterLut } from "../lib/lut-loader.js";

const EXPECTED = {
  classic: ["s01-classic-neg-lut.js", 33],
  gold: ["s02-classic-chrome-lut.js", 33],
  youth: ["s03-classic-chrome-lut.js", 33],
  slot04: ["s04-pro400h-lut.js", 33],
  slot05: ["s05-superia400-lut.js", 33],
  slot06: ["s06-color100-lut.js", 33],
  slot07: ["s07-color800z-lut.js", 33],
  slot08: ["s08-gold-blue-lut.js", 64],
  slot09: ["s09-portra-cool-lut.js", 64],
  slot10: ["s10-proimage-original-lut.js", 25],
  slot11: ["s11-ektar100-lut.js", 64],
  slot12: ["s12-portra400-lut.js", 64],
  slot13: ["s13-gold200-lut.js", 64],
  slot14: ["s14-chrome64-lut.js", 64],
};

test("keeps the exact 14-filter ID, filename, and LUT-size mapping", () => {
  assert.deepEqual(
    Object.fromEntries(Object.entries(FILTER_LUT_MANIFEST).map(([id, entry]) => (
      [id, [entry.module, entry.size]]
    ))),
    EXPECTED,
  );
});

test("loads one requested LUT, deduplicates in-flight work, and reuses it in memory", async () => {
  assert.equal(getFilterLut("classic"), null);
  const first = loadFilterLut("classic");
  const duplicate = loadFilterLut("classic");
  assert.equal(duplicate, first);
  const loaded = await first;
  assert.equal(loaded.size, 33);
  assert.equal(loaded.data.length, 33 ** 3 * 3);
  assert.equal(getFilterLut("classic"), loaded);
  assert.equal(await loadFilterLut("classic"), loaded);
});

test("the lightweight image engine has no static LUT import chain", async () => {
  const [sourceEngine, deployedEngine] = await Promise.all([
    readFile(new URL("../lib/image-engine.js", import.meta.url), "utf8"),
    readFile(new URL("../docs/image-engine.js", import.meta.url), "utf8"),
  ]);
  for (const engine of [sourceEngine, deployedEngine]) {
    assert.doesNotMatch(engine, /from "\.\/s(?:0[1-9]|1[0-4])-[^"]+-lut\.js/);
    assert.match(engine, /const FILTER_LUTS = new Map\(\)/);
    assert.match(engine, /export function registerFilterLut/);
  }
});

test("an invalid LUT request can be retried without retaining a poisoned result", async () => {
  await assert.rejects(loadFilterLut("unknown-filter"), /Unknown filter LUT/);
  await assert.rejects(loadFilterLut("unknown-filter"), /Unknown filter LUT/);
});

test("failed network imports are removed from pending state and retried with a fresh URL", async () => {
  const [sourceLoader, deployedLoader] = await Promise.all([
    readFile(new URL("../lib/lut-loader.js", import.meta.url), "utf8"),
    readFile(new URL("../docs/lut-loader.js", import.meta.url), "utf8"),
  ]);
  for (const loader of [sourceLoader, deployedLoader]) {
    assert.match(loader, /pendingLoads\.delete\(filter\)/);
    assert.match(loader, /failedImportUrls\.set\(filter/);
    assert.match(loader, /retryUrl\.searchParams\.set\("retry", String\(attempt\)\)/);
  }
});
