import assert from "node:assert/strict";
import test from "node:test";
import { createNeutralEdit, processPixels } from "../lib/image-engine.js";

const source = {
  width: 3,
  height: 2,
  data: new Uint8ClampedArray([
    18, 42, 90, 255,
    210, 120, 60, 255,
    245, 230, 205, 255,
    28, 190, 130, 255,
    120, 78, 170, 255,
    252, 252, 252, 255,
  ]),
};

function changed(result) {
  return Array.from(result).some((value, index) => value !== source.data[index]);
}

test("neutral edit is an exact pixel no-op", () => {
  assert.deepEqual(processPixels(source, createNeutralEdit(), 42), source.data);
});

test("preset strength zero restores the exact original", () => {
  const edit = { filter: "gold", strength: 0, brightness: 0, color: 0, grain: 0 };
  assert.deepEqual(processPixels(source, edit, 42), source.data);
});

test("S01 uses the provided 33-point Classic Neg LUT", () => {
  const endpoints = {
    width: 2,
    height: 1,
    data: new Uint8ClampedArray([
      0, 0, 0, 255,
      255, 255, 255, 255,
    ]),
  };
  const result = processPixels(
    endpoints,
    { filter: "classic", strength: 100, brightness: 0, color: 0, grain: 0 },
    42,
  );

  assert.deepEqual(result, new Uint8ClampedArray([
    6, 6, 6, 255,
    250, 252, 250, 255,
  ]));
});

test("S02 uses the provided 33-point Classic Chrome LUT", () => {
  const endpoints = {
    width: 2,
    height: 1,
    data: new Uint8ClampedArray([
      0, 0, 0, 255,
      255, 255, 255, 255,
    ]),
  };
  const result = processPixels(
    endpoints,
    { filter: "gold", strength: 100, brightness: 0, color: 0, grain: 0 },
    42,
  );

  assert.deepEqual(result, new Uint8ClampedArray([
    0, 0, 0, 255,
    247, 253, 245, 255,
  ]));
});

test("preset strength does not scale later manual adjustments", () => {
  const withPresetAtZero = {
    filter: "classic",
    strength: 0,
    brightness: 22,
    color: -15,
    grain: 0,
  };
  const withoutPreset = { ...withPresetAtZero, filter: null };
  assert.deepEqual(
    processPixels(source, withPresetAtZero, 42),
    processPixels(source, withoutPreset, 42),
  );
});

test("brightness and perceptual color controls respond across their full ranges", () => {
  const bright = processPixels(
    source,
    { filter: null, strength: 100, brightness: 100, color: 0, grain: 0 },
    42,
  );
  const dark = processPixels(
    source,
    { filter: null, strength: 100, brightness: -100, color: 0, grain: 0 },
    42,
  );
  const monochrome = processPixels(
    source,
    { filter: null, strength: 100, brightness: 0, color: -100, grain: 0 },
    42,
  );

  assert.ok(changed(bright));
  assert.ok(changed(dark));
  assert.ok(bright[0] > source.data[0]);
  assert.ok(dark[0] < source.data[0]);
  for (let index = 0; index < monochrome.length; index += 4) {
    assert.ok(Math.max(monochrome[index], monochrome[index + 1], monochrome[index + 2])
      - Math.min(monochrome[index], monochrome[index + 1], monochrome[index + 2]) <= 1);
  }
});

test("film grain is neutral at zero and deterministic per photo seed", () => {
  const edit = { filter: null, strength: 100, brightness: 0, color: 0, grain: 65 };
  const first = processPixels(source, edit, 123);
  const second = processPixels(source, edit, 123);
  const otherPhoto = processPixels(source, edit, 987);

  assert.deepEqual(first, second);
  assert.ok(changed(first));
  assert.notDeepEqual(first, otherPhoto);
  assert.deepEqual(
    processPixels(source, { ...edit, grain: 0 }, 123),
    source.data,
  );
});
