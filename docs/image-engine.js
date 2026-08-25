import { S01_LUT, S01_LUT_SIZE } from "./s01-classic-neg-lut.js?v=47";
import { S02_LUT, S02_LUT_SIZE } from "./s02-classic-chrome-lut.js?v=47";
import { S03_LUT, S03_LUT_SIZE } from "./s03-classic-chrome-lut.js?v=47";
import { S04_LUT, S04_LUT_SIZE } from "./s04-pro400h-lut.js?v=47";
import { S05_LUT, S05_LUT_SIZE } from "./s05-superia400-lut.js?v=47";
import { S06_LUT, S06_LUT_SIZE } from "./s06-color100-lut.js?v=47";
import { S07_LUT, S07_LUT_SIZE } from "./s07-color800z-lut.js?v=47";
import { S08_LUT, S08_LUT_SIZE } from "./s08-gold-blue-lut.js?v=47";
import { S09_LUT, S09_LUT_SIZE } from "./s09-portra-cool-lut.js?v=47";
import { S10_LUT, S10_LUT_SIZE } from "./s10-proimage-original-lut.js?v=47";
import { S11_LUT, S11_LUT_SIZE } from "./s11-ektar100-lut.js?v=47";
import { S12_LUT, S12_LUT_SIZE } from "./s12-portra400-lut.js?v=47";
import { S13_LUT, S13_LUT_SIZE } from "./s13-gold200-lut.js?v=47";
import { S14_LUT, S14_LUT_SIZE } from "./s14-chrome64-lut.js?v=47";

const SRGB_TO_LINEAR = Array.from({ length: 256 }, (_, value) => {
  const channel = value / 255;
  return channel <= 0.04045
    ? channel / 12.92
    : ((channel + 0.055) / 1.055) ** 2.4;
});

function clamp01(value) {
  return Math.max(0, Math.min(1, value));
}

function linearToSrgb(value) {
  const channel = clamp01(value);
  return channel <= 0.0031308
    ? channel * 12.92
    : 1.055 * channel ** (1 / 2.4) - 0.055;
}

function lutIndex(size, r, g, b) {
  return ((b * size + g) * size + r) * 3;
}

function applyLut(lut, size, r, g, b) {
  const scale = size - 1;
  const scaledR = clamp01(r) * scale;
  const scaledG = clamp01(g) * scale;
  const scaledB = clamp01(b) * scale;
  const r0 = Math.floor(scaledR);
  const g0 = Math.floor(scaledG);
  const b0 = Math.floor(scaledB);
  const r1 = Math.min(r0 + 1, scale);
  const g1 = Math.min(g0 + 1, scale);
  const b1 = Math.min(b0 + 1, scale);
  const tr = scaledR - r0;
  const tg = scaledG - g0;
  const tb = scaledB - b0;
  const output = [0, 0, 0];

  const i000 = lutIndex(size, r0, g0, b0);
  const i100 = lutIndex(size, r1, g0, b0);
  const i010 = lutIndex(size, r0, g1, b0);
  const i110 = lutIndex(size, r1, g1, b0);
  const i001 = lutIndex(size, r0, g0, b1);
  const i101 = lutIndex(size, r1, g0, b1);
  const i011 = lutIndex(size, r0, g1, b1);
  const i111 = lutIndex(size, r1, g1, b1);

  for (let channel = 0; channel < 3; channel += 1) {
    const c00 = lut[i000 + channel]
      + (lut[i100 + channel] - lut[i000 + channel]) * tr;
    const c10 = lut[i010 + channel]
      + (lut[i110 + channel] - lut[i010 + channel]) * tr;
    const c01 = lut[i001 + channel]
      + (lut[i101 + channel] - lut[i001 + channel]) * tr;
    const c11 = lut[i011 + channel]
      + (lut[i111 + channel] - lut[i011 + channel]) * tr;
    const c0 = c00 + (c10 - c00) * tg;
    const c1 = c01 + (c11 - c01) * tg;
    output[channel] = clamp01(c0 + (c1 - c0) * tb);
  }

  return output;
}

export function getFilterLut(filter) {
  if (filter === "classic") return { data: S01_LUT, size: S01_LUT_SIZE };
  if (filter === "gold") return { data: S02_LUT, size: S02_LUT_SIZE };
  if (filter === "youth") return { data: S03_LUT, size: S03_LUT_SIZE };
  if (filter === "slot04") return { data: S04_LUT, size: S04_LUT_SIZE };
  if (filter === "slot05") return { data: S05_LUT, size: S05_LUT_SIZE };
  if (filter === "slot06") return { data: S06_LUT, size: S06_LUT_SIZE };
  if (filter === "slot07") return { data: S07_LUT, size: S07_LUT_SIZE };
  if (filter === "slot08") return { data: S08_LUT, size: S08_LUT_SIZE };
  if (filter === "slot09") return { data: S09_LUT, size: S09_LUT_SIZE };
  if (filter === "slot10") return { data: S10_LUT, size: S10_LUT_SIZE };
  if (filter === "slot11") return { data: S11_LUT, size: S11_LUT_SIZE };
  if (filter === "slot12") return { data: S12_LUT, size: S12_LUT_SIZE };
  if (filter === "slot13") return { data: S13_LUT, size: S13_LUT_SIZE };
  if (filter === "slot14") return { data: S14_LUT, size: S14_LUT_SIZE };
  return null;
}

function applyPresetSrgb(r, g, b, filter) {
  let rr = r;
  let gg = g;
  let bb = b;

  if (filter === "classic") {
    return applyLut(S01_LUT, S01_LUT_SIZE, r, g, b);
  } else if (filter === "gold") {
    return applyLut(S02_LUT, S02_LUT_SIZE, r, g, b);
  } else if (filter === "youth") {
    return applyLut(S03_LUT, S03_LUT_SIZE, r, g, b);
  } else if (filter === "slot04") {
    return applyLut(S04_LUT, S04_LUT_SIZE, r, g, b);
  } else if (filter === "slot05") {
    return applyLut(S05_LUT, S05_LUT_SIZE, r, g, b);
  } else if (filter === "slot06") {
    return applyLut(S06_LUT, S06_LUT_SIZE, r, g, b);
  } else if (filter === "slot07") {
    return applyLut(S07_LUT, S07_LUT_SIZE, r, g, b);
  } else if (filter === "slot08") {
    return applyLut(S08_LUT, S08_LUT_SIZE, r, g, b);
  } else if (filter === "slot09") {
    return applyLut(S09_LUT, S09_LUT_SIZE, r, g, b);
  } else if (filter === "slot10") {
    return applyLut(S10_LUT, S10_LUT_SIZE, r, g, b);
  } else if (filter === "slot11") {
    return applyLut(S11_LUT, S11_LUT_SIZE, r, g, b);
  } else if (filter === "slot12") {
    return applyLut(S12_LUT, S12_LUT_SIZE, r, g, b);
  } else if (filter === "slot13") {
    return applyLut(S13_LUT, S13_LUT_SIZE, r, g, b);
  } else if (filter === "slot14") {
    return applyLut(S14_LUT, S14_LUT_SIZE, r, g, b);
  }

  return [clamp01(rr), clamp01(gg), clamp01(bb)];
}

export function getLightParameters(light) {
  const normalized = Math.max(-1, Math.min(1, light / 100));
  const ev = Math.sign(normalized) * 2 * Math.abs(normalized) ** 1.4;
  return {
    active: normalized !== 0,
    ev,
    gain: 2 ** ev,
    positive: ev > 0,
  };
}

function applyExposure(r, g, b, parameters) {
  const { gain, positive } = parameters;
  if (!positive) return [r * gain, g * gain, b * gain];

  const luminance = Math.max(0, r * 0.2126 + g * 0.7152 + b * 0.0722);
  let target = luminance * gain;

  const shoulderStart = 0.82;
  const shoulderRange = 1 - shoulderStart;
  if (target > shoulderStart) {
    const excess = target - shoulderStart;
    target = shoulderStart + excess / (1 + excess / shoulderRange);
  }

  const ratio = luminance > 1e-7 ? target / luminance : gain;
  let rr = Math.max(0, r * ratio);
  let gg = Math.max(0, g * ratio);
  let bb = Math.max(0, b * ratio);

  const maximum = Math.max(rr, gg, bb);
  const peakStart = 0.97;
  if (maximum > peakStart) {
    const excess = maximum - peakStart;
    const compressed = peakStart + excess / (1 + excess / (1 - peakStart));
    const compression = compressed / maximum;
    rr *= compression;
    gg *= compression;
    bb *= compression;
  }

  return [rr, gg, bb];
}

function linearRgbToOklab(r, g, b) {
  const l = 0.4122214708 * r + 0.5363325363 * g + 0.0514459929 * b;
  const m = 0.2119034982 * r + 0.6806995451 * g + 0.1073969566 * b;
  const s = 0.0883024619 * r + 0.2817188376 * g + 0.6299787005 * b;
  const lRoot = Math.cbrt(Math.max(0, l));
  const mRoot = Math.cbrt(Math.max(0, m));
  const sRoot = Math.cbrt(Math.max(0, s));
  return [
    0.2104542553 * lRoot + 0.793617785 * mRoot - 0.0040720468 * sRoot,
    1.9779984951 * lRoot - 2.428592205 * mRoot + 0.4505937099 * sRoot,
    0.0259040371 * lRoot + 0.7827717662 * mRoot - 0.808675766 * sRoot,
  ];
}

function oklabToLinearRgb(L, a, b) {
  const lRoot = L + 0.3963377774 * a + 0.2158037573 * b;
  const mRoot = L - 0.1055613458 * a - 0.0638541728 * b;
  const sRoot = L - 0.0894841775 * a - 1.291485548 * b;
  const l = lRoot ** 3;
  const m = mRoot ** 3;
  const s = sRoot ** 3;
  return [
    4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s,
    -1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s,
    -0.0041960863 * l - 0.7034186147 * m + 1.707614701 * s,
  ];
}

function inGamut(rgb) {
  return rgb.every((channel) => channel >= 0 && channel <= 1);
}

function gamutMapOklab(L, a, b) {
  let rgb = oklabToLinearRgb(L, a, b);
  if (inGamut(rgb)) return rgb;

  let low = 0;
  let high = 1;
  for (let pass = 0; pass < 5; pass += 1) {
    const scale = (low + high) / 2;
    rgb = oklabToLinearRgb(L, a * scale, b * scale);
    if (inGamut(rgb)) low = scale;
    else high = scale;
  }
  return oklabToLinearRgb(L, a * low, b * low).map(clamp01);
}

export function getColorParameters(color) {
  const normalized = Math.max(-1, Math.min(1, color / 100));
  if (normalized > 0) {
    return {
      active: true,
      boost: 0.58 * normalized ** 1.15,
      chromaScale: 1,
    };
  }
  if (normalized < 0) {
    return {
      active: true,
      boost: 0,
      chromaScale: 1 - Math.abs(normalized) ** 1.15,
    };
  }
  return { active: false, boost: 0, chromaScale: 1 };
}

function applyColor(r, g, b, parameters) {
  const { boost, chromaScale } = parameters;

  const [L, a, bValue] = linearRgbToOklab(r, g, b);
  const chroma = Math.hypot(a, bValue);
  if (chroma < 1e-7) return [r, g, b];

  let factor;
  if (boost === 0) {
    factor = chromaScale;
  } else {
    const hue = ((Math.atan2(bValue, a) * 180) / Math.PI + 360) % 360;
    const skinDistance = Math.min(Math.abs(hue - 50), 360 - Math.abs(hue - 50));
    const hueProtection = Math.exp(-0.5 * (skinDistance / 34) ** 2);
    const lightnessProtection = Math.exp(-0.5 * ((L - 0.65) / 0.28) ** 2);
    const skinProtection = hueProtection * lightnessProtection;
    const chromaRatio = chroma / 0.12;
    const lowChromaWeight = 1 / (1 + chromaRatio * chromaRatio);
    const vibranceResponse = 0.16 + 0.84 * lowChromaWeight;
    factor = 1 + boost * vibranceResponse * (1 - 0.7 * skinProtection);
  }

  return gamutMapOklab(L, a * factor, bValue * factor);
}

function hash2d(x, y, seed) {
  let value = Math.imul(x, 374761393) ^ Math.imul(y, 668265263) ^ seed;
  value = Math.imul(value ^ (value >>> 13), 1274126177);
  value ^= value >>> 16;
  return ((value >>> 0) / 4294967295) * 2 - 1;
}

function smooth(value) {
  return value * value * (3 - 2 * value);
}

function valueNoise(x, y, scale, seed) {
  const scaledX = x / scale;
  const scaledY = y / scale;
  const x0 = Math.floor(scaledX);
  const y0 = Math.floor(scaledY);
  const tx = smooth(scaledX - x0);
  const ty = smooth(scaledY - y0);
  const n00 = hash2d(x0, y0, seed);
  const n10 = hash2d(x0 + 1, y0, seed);
  const n01 = hash2d(x0, y0 + 1, seed);
  const n11 = hash2d(x0 + 1, y0 + 1, seed);
  const top = n00 + (n10 - n00) * tx;
  const bottom = n01 + (n11 - n01) * tx;
  return top + (bottom - top) * ty;
}

export function getGrainParameters(grain, width, height) {
  const amount = Math.max(0, Math.min(1, grain / 100));
  if (amount === 0) {
    return {
      active: false,
      coordinateScale: 0,
      baseScale: 1,
      amplitude: 0,
      fineWeight: 0,
      mediumWeight: 0,
      coarseWeight: 0,
      clusterStrength: 0,
    };
  }

  const character = amount ** 1.2;
  const fineWeight = 0.68 - 0.22 * amount;
  const coarseWeight = 0.07 + 0.12 * amount;
  return {
    active: true,
    coordinateScale: 1100 / Math.max(1, width, height),
    baseScale: 0.75 + 2.25 * character,
    amplitude: 0.06 * amount ** 1.15,
    fineWeight,
    mediumWeight: 1 - fineWeight - coarseWeight,
    coarseWeight,
    clusterStrength: 0.05 + 0.15 * amount,
  };
}

function sampleGrain(r, g, b, x, y, parameters, seed) {
  const pointX = x * parameters.coordinateScale;
  const pointY = y * parameters.coordinateScale;
  const fine = valueNoise(pointX, pointY, parameters.baseScale, seed);
  const medium = valueNoise(pointX, pointY, parameters.baseScale * 2.4, seed ^ 0x45d9f3b);
  const coarse = valueNoise(pointX, pointY, parameters.baseScale * 5.8, seed ^ 0x27d4eb2d);
  const cluster = valueNoise(pointX, pointY, parameters.baseScale * 12.5, seed ^ 0x165667b1);
  const texture = (
    fine * parameters.fineWeight
    + medium * parameters.mediumWeight
    + coarse * parameters.coarseWeight
  ) * (1 + cluster * parameters.clusterStrength);
  const luminance = clamp01(r * 0.2126 + g * 0.7152 + b * 0.0722);
  const edgeVisibility = 0.35 + (0.3 - 0.35) * luminance;
  const midtone = 4 * luminance * (1 - luminance);
  const visibility = edgeVisibility + (1 - edgeVisibility) * midtone * midtone;
  return texture * parameters.amplitude * visibility;
}

export function hashSeed(value) {
  let hash = 2166136261;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}

export function createNeutralEdit() {
  return { filter: null, strength: 100, brightness: 0, color: 0, grain: 0 };
}

export function processPixels(source, edit, seed = 1) {
  const filter = edit.filter ?? null;
  const strength = Math.max(0, Math.min(100, edit.strength ?? 100));
  const brightness = Math.max(-100, Math.min(100, edit.brightness ?? 0));
  const color = Math.max(-100, Math.min(100, edit.color ?? 0));
  const grain = Math.max(0, Math.min(100, edit.grain ?? 0));
  const neutral = (!filter || strength === 0) && brightness === 0 && color === 0 && grain === 0;
  if (neutral) return new Uint8ClampedArray(source.data);

  const output = new Uint8ClampedArray(source.data.length);
  const presetMix = filter ? strength / 100 : 0;
  const lightParameters = getLightParameters(brightness);
  const colorParameters = getColorParameters(color);
  const width = source.width;
  const height = source.height;
  const grainParameters = getGrainParameters(grain, width, height);

  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const offset = (y * width + x) * 4;
      const originalR = source.data[offset] / 255;
      const originalG = source.data[offset + 1] / 255;
      const originalB = source.data[offset + 2] / 255;
      let r = SRGB_TO_LINEAR[source.data[offset]];
      let g = SRGB_TO_LINEAR[source.data[offset + 1]];
      let b = SRGB_TO_LINEAR[source.data[offset + 2]];

      if (presetMix > 0) {
        const preset = applyPresetSrgb(originalR, originalG, originalB, filter);
        const presetR = preset[0] <= 0.04045 ? preset[0] / 12.92 : ((preset[0] + 0.055) / 1.055) ** 2.4;
        const presetG = preset[1] <= 0.04045 ? preset[1] / 12.92 : ((preset[1] + 0.055) / 1.055) ** 2.4;
        const presetB = preset[2] <= 0.04045 ? preset[2] / 12.92 : ((preset[2] + 0.055) / 1.055) ** 2.4;
        r += (presetR - r) * presetMix;
        g += (presetG - g) * presetMix;
        b += (presetB - b) * presetMix;
      }

      if (lightParameters.active) [r, g, b] = applyExposure(r, g, b, lightParameters);
      if (colorParameters.active) [r, g, b] = applyColor(r, g, b, colorParameters);
      if (grainParameters.active) {
        const grainValue = sampleGrain(r, g, b, x, y, grainParameters, seed);
        r += grainValue;
        g += grainValue;
        b += grainValue;
      }

      output[offset] = Math.round(linearToSrgb(r) * 255);
      output[offset + 1] = Math.round(linearToSrgb(g) * 255);
      output[offset + 2] = Math.round(linearToSrgb(b) * 255);
      output[offset + 3] = source.data[offset + 3];
    }
  }

  return output;
}
