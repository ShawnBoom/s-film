import assert from "node:assert/strict";
import test from "node:test";

import { createExportProcessor } from "../lib/export-processor.js";
import { processPixels } from "../lib/image-engine.js";
import { loadFilterLut } from "../lib/lut-loader.js";

const FILTERS = [
  "classic",
  "gold",
  "youth",
  "slot07",
  "slot06",
  "slot04",
  "slot05",
  "slot12",
  "slot09",
  "slot13",
  "slot08",
  "slot10",
  "slot11",
  "slot14",
];

await Promise.all(FILTERS.map((filter) => loadFilterLut(filter)));

class FakeWorker {
  constructor({ failProcess = false } = {}) {
    this.failProcess = failProcess;
    this.listeners = new Map();
    queueMicrotask(() => this.emit("message", { data: { type: "ready" } }));
  }

  addEventListener(type, listener) {
    const listeners = this.listeners.get(type) ?? [];
    listeners.push(listener);
    this.listeners.set(type, listeners);
  }

  emit(type, event) {
    for (const listener of this.listeners.get(type) ?? []) listener(event);
  }

  postMessage(message, transfer) {
    const received = structuredClone(message, { transfer });
    queueMicrotask(() => {
      if (this.failProcess) {
        const returned = structuredClone(
          { type: "error", id: received.id, message: "forced Worker failure", buffer: received.buffer },
          { transfer: [received.buffer] },
        );
        this.emit("message", { data: returned });
        return;
      }

      const startedAt = performance.now();
      const pixels = processPixels(
        {
          data: new Uint8ClampedArray(received.buffer),
          width: received.width,
          height: received.height,
        },
        received.edit,
        received.seed,
      );
      const returned = structuredClone(
        {
          type: "result",
          id: received.id,
          buffer: pixels.buffer,
          duration: performance.now() - startedAt,
        },
        { transfer: [pixels.buffer] },
      );
      this.emit("message", { data: returned });
    });
  }

  terminate() {}
}

function sourcePixels() {
  return {
    width: 2,
    height: 2,
    data: new Uint8ClampedArray([
      12, 34, 56, 255,
      78, 90, 123, 255,
      145, 167, 189, 210,
      220, 200, 180, 128,
    ]),
  };
}

test("Worker export matches the shared CPU engine for all 14 LUT mappings", async () => {
  let workerCreations = 0;
  const processor = createExportProcessor({
    createWorker: () => {
      workerCreations += 1;
      return new FakeWorker();
    },
  });
  assert.equal(processor.mode, "idle");
  assert.equal(workerCreations, 0, "constructing the processor must not create a Worker");

  for (const filter of FILTERS) {
    const edit = { filter, strength: 73, brightness: 18, color: -21, grain: 26 };
    const expected = processPixels(sourcePixels(), edit, 2468);
    const source = sourcePixels();
    const result = await processor.process(source, edit, 2468);
    assert.equal(result.processor, "worker");
    assert.deepEqual(result.pixels, expected, filter);
    assert.equal(source.data.byteLength, 0, "input RGBA buffer should be transferred");
  }

  assert.equal(workerCreations, 1, "one lazily-created Worker is reused");

  processor.destroy();
});

test("Worker processing failure returns its buffer and falls back to the main thread", async () => {
  const failures = [];
  const processor = createExportProcessor({
    createWorker: () => new FakeWorker({ failProcess: true }),
    onFailure: (error) => failures.push(error.message),
  });
  const edit = { filter: "classic", strength: 100, brightness: 0, color: 0, grain: 0 };
  const expected = processPixels(sourcePixels(), edit, 42);
  const result = await processor.process(sourcePixels(), edit, 42);

  assert.equal(result.processor, "main-thread");
  assert.deepEqual(result.pixels, expected);
  assert.equal(processor.mode, "main-thread");
  assert.deepEqual(failures, ["forced Worker failure"]);
});

test("Worker initialization failure preserves main-thread export", async () => {
  const failures = [];
  const processor = createExportProcessor({
    createWorker() {
      throw new Error("forced initialization failure");
    },
    onFailure: (error) => failures.push(error.message),
  });
  const edit = { filter: null, strength: 0, brightness: -10, color: 15, grain: 8 };
  const expected = processPixels(sourcePixels(), edit, 99);
  const result = await processor.process(sourcePixels(), edit, 99);

  assert.equal(result.processor, "main-thread");
  assert.deepEqual(result.pixels, expected);
  assert.equal(processor.mode, "main-thread");
  assert.deepEqual(failures, ["forced initialization failure"]);
});
