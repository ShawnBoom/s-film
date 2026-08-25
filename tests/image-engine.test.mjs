import assert from "node:assert/strict";
import test from "node:test";
import { hasEdits, visibleEditLabel } from "../lib/edit-state.js";
import {
  createNeutralEdit,
  getColorParameters,
  getGrainParameters,
  getLightParameters,
  processPixels,
} from "../lib/image-engine.js";
import { loadFilterLut } from "../lib/lut-loader.js";

await Promise.all([
  "classic", "gold", "youth", "slot04", "slot05", "slot06", "slot07",
  "slot08", "slot09", "slot10", "slot11", "slot12", "slot13", "slot14",
].map((filter) => loadFilterLut(filter)));

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

test("Original and Edited labels describe the currently visible image", () => {
  const original = createNeutralEdit();
  assert.equal(hasEdits(original), false);
  assert.equal(visibleEditLabel(original, false), "Original");

  const edits = [
    { ...original, filter: "classic" },
    { ...original, strength: 75 },
    { ...original, brightness: 1 },
    { ...original, color: -1 },
    { ...original, grain: 1 },
  ];
  for (const edit of edits) {
    assert.equal(hasEdits(edit), true);
    assert.equal(visibleEditLabel(edit, false), "Edited");
    assert.equal(visibleEditLabel(edit, true), "Original");
    assert.deepEqual(edit, { ...edit });
  }
});

test("neutral edit is an exact pixel no-op", () => {
  assert.deepEqual(processPixels(source, createNeutralEdit(), 42), source.data);
});

test("Light v2 uses the nonlinear two-stop EV curve", () => {
  const anchors = [
    [-100, -2],
    [-75, -1.336],
    [-50, -0.758],
    [-25, -0.287],
    [0, 0],
    [25, 0.287],
    [50, 0.758],
    [75, 1.336],
    [100, 2],
  ];
  for (const [value, expected] of anchors) {
    assert.ok(Math.abs(getLightParameters(value).ev - expected) < 0.002);
  }
});

test("Light v2 is true exposure reduction for negative values and protects positive highlights", () => {
  const grayscale = {
    width: 3,
    height: 1,
    data: new Uint8ClampedArray([
      0, 0, 0, 255,
      96, 96, 96, 255,
      235, 235, 235, 255,
    ]),
  };
  const darkened = processPixels(
    grayscale,
    { filter: null, strength: 100, brightness: -50, color: 0, grain: 0 },
  );
  const brightened = processPixels(
    grayscale,
    { filter: null, strength: 100, brightness: 50, color: 0, grain: 0 },
  );

  assert.deepEqual(Array.from(darkened.slice(0, 4)), [0, 0, 0, 255]);
  assert.ok(darkened[4] < 96);
  assert.ok(brightened[4] > 96);
  assert.ok(brightened[8] < 255);
  assert.ok((brightened[4] / 96) > (brightened[8] / 235));
});

function srgbChannelToLinear(value) {
  const channel = value / 255;
  return channel <= 0.04045
    ? channel / 12.92
    : ((channel + 0.055) / 1.055) ** 2.4;
}

function pixelOklabChroma(bytes, offset) {
  const r = srgbChannelToLinear(bytes[offset]);
  const g = srgbChannelToLinear(bytes[offset + 1]);
  const b = srgbChannelToLinear(bytes[offset + 2]);
  const l = 0.4122214708 * r + 0.5363325363 * g + 0.0514459929 * b;
  const m = 0.2119034982 * r + 0.6806995451 * g + 0.1073969566 * b;
  const s = 0.0883024619 * r + 0.2817188376 * g + 0.6299787005 * b;
  const lRoot = Math.cbrt(Math.max(0, l));
  const mRoot = Math.cbrt(Math.max(0, m));
  const sRoot = Math.cbrt(Math.max(0, s));
  const a = 1.9779984951 * lRoot - 2.428592205 * mRoot + 0.4505937099 * sRoot;
  const bValue = 0.0259040371 * lRoot + 0.7827717662 * mRoot - 0.808675766 * sRoot;
  return Math.hypot(a, bValue);
}

test("Color v2.1 strengthens positive response and preserves the grayscale endpoint", () => {
  assert.equal(getColorParameters(0).active, false);
  assert.ok(Math.abs(getColorParameters(50).boost - 0.7 * 0.5 ** 1.15) < 1e-12);
  assert.ok(getColorParameters(50).boost > 0.58 * 0.5 ** 1.15 * 1.15);
  assert.ok(Math.abs(getColorParameters(-50).fade - 0.5 ** 1.15) < 1e-12);
  assert.equal(getColorParameters(-100).fade, 1);
});

test("Color v2.1 wakes low-chroma colors before saturated colors and protects skin hues", () => {
  const colors = {
    width: 3,
    height: 1,
    data: new Uint8ClampedArray([
      112, 126, 140, 255,
      25, 70, 220, 255,
      190, 125, 100, 255,
    ]),
  };
  const result = processPixels(
    colors,
    { filter: null, strength: 100, brightness: 0, color: 50, grain: 0 },
  );
  const gains = [0, 4, 8].map((offset) =>
    pixelOklabChroma(result, offset) / pixelOklabChroma(colors.data, offset));

  assert.ok(gains[0] > gains[1]);
  assert.ok(gains[0] > gains[2]);
  assert.ok(gains[1] < 1.12);
  assert.ok(gains[2] < 1.12);
});

test("Color v2.1 fades muted colors sooner than saturated colors", () => {
  const colors = {
    width: 2,
    height: 1,
    data: new Uint8ClampedArray([
      112, 126, 140, 255,
      25, 70, 220, 255,
    ]),
  };
  const result = processPixels(
    colors,
    { filter: null, strength: 100, brightness: 0, color: -50, grain: 0 },
  );
  const mutedRemaining = pixelOklabChroma(result, 0) / pixelOklabChroma(colors.data, 0);
  const saturatedRemaining = pixelOklabChroma(result, 4) / pixelOklabChroma(colors.data, 4);

  assert.ok(mutedRemaining < saturatedRemaining);
  assert.ok(mutedRemaining > 0.45);
  assert.ok(saturatedRemaining < 0.7);
});

test("Color v2.1 reaches perceptual grayscale at -100", () => {
  const result = processPixels(
    source,
    { filter: null, strength: 100, brightness: 0, color: -100, grain: 0 },
  );
  for (let offset = 0; offset < result.length; offset += 4) {
    const channels = [result[offset], result[offset + 1], result[offset + 2]];
    assert.ok(Math.max(...channels) - Math.min(...channels) <= 1);
  }
});

test("Grain v2.1 keeps layer frequencies anchored while evolving their contribution", () => {
  const values = [15, 25, 50, 75, 100].map((grain) =>
    getGrainParameters(grain, 4032, 3024));
  for (let index = 1; index < values.length; index += 1) {
    assert.ok(values[index].amplitude > values[index - 1].amplitude);
    assert.ok(values[index].coarseWeight > values[index - 1].coarseWeight);
    assert.ok(values[index].clusterStrength > values[index - 1].clusterStrength);
    assert.equal(values[index].fineScale, values[0].fineScale);
    assert.equal(values[index].mediumScale, values[0].mediumScale);
    assert.equal(values[index].coarseScale, values[0].coarseScale);
    assert.equal(values[index].clusterScale, values[0].clusterScale);
  }
  assert.ok(values[4].fineWeight > values[4].mediumWeight);
  assert.ok(values[4].mediumWeight > values[4].coarseWeight);
  assert.ok(values[4].clusterStrength <= 0.025);
  assert.equal(getGrainParameters(0, 4032, 3024).active, false);
});

test("Grain v2.1 is luminance-only and approximately zero-mean", () => {
  const width = 128;
  const height = 128;
  const gray = new Uint8ClampedArray(width * height * 4);
  for (let offset = 0; offset < gray.length; offset += 4) {
    gray[offset] = 128;
    gray[offset + 1] = 128;
    gray[offset + 2] = 128;
    gray[offset + 3] = 255;
  }
  const result = processPixels(
    { width, height, data: gray },
    { filter: null, strength: 100, brightness: 0, color: 0, grain: 100 },
    2468,
  );
  let total = 0;
  for (let offset = 0; offset < result.length; offset += 4) {
    assert.equal(result[offset], result[offset + 1]);
    assert.equal(result[offset], result[offset + 2]);
    total += result[offset];
  }
  assert.ok(Math.abs(total / (width * height) - 128) < 1);
});

test("Grain v2.1 uses resolution-independent isotropic coordinates", () => {
  function uniformGray(width, height) {
    const data = new Uint8ClampedArray(width * height * 4);
    for (let offset = 0; offset < data.length; offset += 4) {
      data[offset] = 128;
      data[offset + 1] = 128;
      data[offset + 2] = 128;
      data[offset + 3] = 255;
    }
    return { width, height, data };
  }
  const edit = { filter: null, strength: 100, brightness: 0, color: 0, grain: 75 };
  const small = processPixels(uniformGray(40, 24), edit, 777);
  const large = processPixels(uniformGray(80, 48), edit, 777);

  for (let y = 0; y < 24; y += 3) {
    for (let x = 0; x < 40; x += 3) {
      const smallOffset = (y * 40 + x) * 4;
      const largeOffset = ((y * 2) * 80 + x * 2) * 4;
      assert.equal(small[smallOffset], large[largeOffset]);
    }
  }
});

test("preset strength zero restores the exact original", () => {
  const edit = { filter: "gold", strength: 0, brightness: 0, color: 0, grain: 0 };
  assert.deepEqual(processPixels(source, edit, 42), source.data);
});

test("the NN slot uses the provided 33-point Nostalgic Neg LUT", () => {
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
    4, 3, 3, 255,
    247, 248, 242, 255,
  ]));
});

test("the NC slot uses the provided 33-point Classic Neg LUT", () => {
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
    6, 6, 6, 255,
    250, 252, 250, 255,
  ]));
});

test("the CC slot uses the provided 33-point Classic Chrome LUT", () => {
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
    { filter: "youth", strength: 100, brightness: 0, color: 0, grain: 0 },
    42,
  );

  assert.deepEqual(result, new Uint8ClampedArray([
    0, 0, 0, 255,
    247, 253, 245, 255,
  ]));
});

test("the Pro400H slot uses the provided 33-point 400H LUT", () => {
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
    { filter: "slot04", strength: 100, brightness: 0, color: 0, grain: 0 },
    42,
  );

  assert.deepEqual(result, new Uint8ClampedArray([
    14, 23, 7, 255,
    255, 252, 249, 255,
  ]));
});

test("the Sup400 slot uses the provided 33-point Superia 400 LUT", () => {
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
    { filter: "slot05", strength: 100, brightness: 0, color: 0, grain: 0 },
    42,
  );

  assert.deepEqual(result, new Uint8ClampedArray([
    2, 14, 12, 255,
    250, 249, 250, 255,
  ]));
});

test("the Color100 slot uses the provided 33-point Color 100 LUT", () => {
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
    { filter: "slot06", strength: 100, brightness: 0, color: 0, grain: 0 },
    42,
  );

  assert.deepEqual(result, new Uint8ClampedArray([
    0, 16, 17, 255,
    248, 254, 254, 255,
  ]));
});

test("the Color800Z slot uses the provided 33-point Color 800Z LUT", () => {
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
    { filter: "slot07", strength: 100, brightness: 0, color: 0, grain: 0 },
    42,
  );

  assert.deepEqual(result, new Uint8ClampedArray([
    1, 16, 17, 255,
    250, 250, 249, 255,
  ]));
});

test("the Gold Blue slot uses the provided 64-point Kodak Gold Master Blue LUT", () => {
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
    { filter: "slot08", strength: 100, brightness: 0, color: 0, grain: 0 },
    42,
  );

  assert.deepEqual(result, new Uint8ClampedArray([
    1, 1, 1, 255,
    234, 239, 243, 255,
  ]));
});

test("the Portra Cool slot uses the provided 64-point Portra Cool LUT", () => {
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
    { filter: "slot09", strength: 100, brightness: 0, color: 0, grain: 0 },
    42,
  );

  assert.deepEqual(result, new Uint8ClampedArray([
    0, 1, 1, 255,
    252, 249, 240, 255,
  ]));
});

test("the Proimage Original slot uses the provided 25-point Proimage100 LUT", () => {
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
    { filter: "slot10", strength: 100, brightness: 0, color: 0, grain: 0 },
    42,
  );

  assert.deepEqual(result, new Uint8ClampedArray([
    21, 23, 20, 255,
    250, 250, 252, 255,
  ]));
});

test("the Ektar 100 slot uses the provided 64-point Kodak Ektar 100 LUT", () => {
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
    { filter: "slot11", strength: 100, brightness: 0, color: 0, grain: 0 },
    42,
  );

  assert.deepEqual(result, new Uint8ClampedArray([
    0, 0, 0, 255,
    254, 254, 254, 255,
  ]));
});

test("the Portra 400 slot uses the provided 64-point Kodak Portra 400 LUT", () => {
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
    { filter: "slot12", strength: 100, brightness: 0, color: 0, grain: 0 },
    42,
  );

  assert.deepEqual(result, new Uint8ClampedArray([
    10, 12, 6, 255,
    248, 244, 246, 255,
  ]));
});

test("the Gold 200 slot uses the provided 64-point Kodak Gold200 3 LUT", () => {
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
    { filter: "slot13", strength: 100, brightness: 0, color: 0, grain: 0 },
    42,
  );

  assert.deepEqual(result, new Uint8ClampedArray([
    2, 2, 1, 255,
    250, 245, 247, 255,
  ]));
});

test("the Chrome 64 slot uses the provided 64-point Kodak Chrome LUT", () => {
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
    { filter: "slot14", strength: 100, brightness: 0, color: 0, grain: 0 },
    42,
  );

  assert.deepEqual(result, new Uint8ClampedArray([
    0, 0, 0, 255,
    252, 251, 251, 255,
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

test("Grain v2.1 is neutral at zero and stable for a photo instance seed", () => {
  const edit = { filter: null, strength: 100, brightness: 0, color: 0, grain: 65 };
  const first = processPixels(source, edit, 123);
  const second = processPixels(source, edit, 123);
  const otherPhoto = processPixels(source, edit, 987);
  const lowFirst = processPixels(source, { ...edit, grain: 20 }, 123);
  processPixels(source, { ...edit, grain: 50 }, 123);
  const lowAgain = processPixels(source, { ...edit, grain: 20 }, 123);

  assert.deepEqual(first, second);
  assert.deepEqual(lowFirst, lowAgain);
  assert.ok(changed(first));
  assert.notDeepEqual(first, otherPhoto);
  assert.deepEqual(
    processPixels(source, { ...edit, grain: 0 }, 123),
    source.data,
  );
});
