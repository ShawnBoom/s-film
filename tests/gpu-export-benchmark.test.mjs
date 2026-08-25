import assert from "node:assert/strict";
import test from "node:test";

import {
  GPU_EXPORT_CASES,
  comparePixelBuffers,
  estimateGpuBenchmarkMemory,
  formatGpuExportBenchmark,
} from "../lib/gpu-export-benchmark.js";

test("defines the six required full-resolution A/B edit cases", () => {
  assert.deepEqual(
    GPU_EXPORT_CASES.map(({ key, strength, brightness, color, grain }) => ({
      key,
      strength,
      brightness,
      color,
      grain,
    })),
    [
      { key: "A", strength: 100, brightness: 0, color: 0, grain: 0 },
      { key: "B", strength: 50, brightness: 0, color: 0, grain: 0 },
      { key: "C", strength: 100, brightness: 50, color: 0, grain: 0 },
      { key: "D", strength: 100, brightness: 0, color: 50, grain: 0 },
      { key: "E", strength: 100, brightness: 0, color: 0, grain: 50 },
      { key: "F", strength: 100, brightness: 50, color: 50, grain: 50 },
    ],
  );
});

test("reports per-channel cumulative pixel differences before JPEG encoding", async () => {
  const cpu = new Uint8ClampedArray([
    10, 20, 30, 255,
    100, 110, 120, 200,
  ]);
  const gpu = new Uint8ClampedArray([
    10, 21, 33, 255,
    105, 108, 120, 199,
  ]);
  const result = await comparePixelBuffers(cpu, gpu, { chunkPixels: 1 });

  assert.equal(result.totalPixels, 2);
  assert.equal(result.channels.r.average, 2.5);
  assert.equal(result.channels.r.maximum, 5);
  assert.equal(result.channels.r.percentages.exact, 50);
  assert.equal(result.channels.r.percentages.le1, 50);
  assert.equal(result.channels.r.percentages.le2, 50);
  assert.equal(result.channels.r.percentages.le4, 50);
  assert.equal(result.channels.r.percentages.gt4, 50);
  assert.equal(result.channels.r.counts.gt4, 1);
  assert.equal(result.channels.g.average, 1.5);
  assert.equal(result.channels.g.percentages.le2, 100);
  assert.equal(result.channels.b.maximum, 3);
  assert.equal(result.channels.a.average, 0.5);
  assert.equal(result.alphaIdentical, false);
});

test("estimates the sequential A/B diagnostic peak without resizing", () => {
  const common = estimateGpuBenchmarkMemory(4032, 3024);
  const large = estimateGpuBenchmarkMemory(5712, 4284);

  assert.equal(common.rgbaBytes, 4032 * 3024 * 4);
  assert.equal(common.rgbaSurfaceCopies, 7);
  assert.equal(common.estimatedPeakBytes, common.rgbaBytes * 7 + common.lutTextureBytes);
  assert.ok(common.estimatedPeakBytes / 1048576 > 325);
  assert.ok(large.estimatedPeakBytes / 1048576 > 653);
});

test("formats capability, timing, LUT, and pixel diagnostics", () => {
  const text = formatGpuExportBenchmark({
    webgl2Available: true,
    image: { width: 4032, height: 3024 },
    capability: {
      maxTextureSize: 16384,
      maxRenderbufferSize: 16384,
      maxViewportWidth: 16384,
      maxViewportHeight: 16384,
      fullSizeRenderPossible: true,
    },
    allFiltersAvailable: true,
    memory: estimateGpuBenchmarkMemory(4032, 3024),
    cases: [],
    error: "",
  }, "Complete").join("\n");

  assert.match(text, /WebGL2: YES/);
  assert.match(text, /Image: 4032 × 3024/);
  assert.match(text, /MAX_TEXTURE_SIZE: 16384/);
  assert.match(text, /Full-size render possible: YES/);
  assert.match(text, /LUTs: 14 \/ 14 OK/);
  assert.match(text, /Estimated peak:/);
});
