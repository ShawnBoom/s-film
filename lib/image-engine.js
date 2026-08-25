import { S01_LUT, S01_LUT_SIZE } from "./s01-classic-neg-lut.js";
import { S02_LUT, S02_LUT_SIZE } from "./s02-classic-chrome-lut.js";
import { S03_LUT, S03_LUT_SIZE } from "./s03-classic-chrome-lut.js";
import { S04_LUT, S04_LUT_SIZE } from "./s04-pro400h-lut.js";
import { S05_LUT, S05_LUT_SIZE } from "./s05-superia400-lut.js";
import { S06_LUT, S06_LUT_SIZE } from "./s06-color100-lut.js";
import { S07_LUT, S07_LUT_SIZE } from "./s07-color800z-lut.js";
import { S08_LUT, S08_LUT_SIZE } from "./s08-gold-blue-lut.js";
import { S09_LUT, S09_LUT_SIZE } from "./s09-portra-cool-lut.js";
import { S10_LUT, S10_LUT_SIZE } from "./s10-proimage-original-lut.js";
import { S11_LUT, S11_LUT_SIZE } from "./s11-ektar100-lut.js";
import { S12_LUT, S12_LUT_SIZE } from "./s12-portra400-lut.js";
import { S13_LUT, S13_LUT_SIZE } from "./s13-gold200-lut.js";
import { S14_LUT, S14_LUT_SIZE } from "./s14-chrome64-lut.js";

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

function saturation(r, g, b, amount) {
  const lightness = r * 0.299 + g * 0.587 + b * 0.114;
  return [
    lightness + (r - lightness) * amount,
    lightness + (g - lightness) * amount,
    lightness + (b - lightness) * amount,
  ];
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

function applyExposure(r, g, b, brightness) {
  if (brightness === 0) return [r, g, b];

  const normalized = Math.max(-1, Math.min(1, brightness / 100));
  const ev = Math.sign(normalized) * 2 * Math.abs(normalized) ** 1.35;
  const gain = 2 ** ev;
  const luminance = Math.max(0, r * 0.2126 + g * 0.7152 + b * 0.0722);
  let target = luminance * gain;

  if (ev > 0 && target > 0.68) {
    const over = (target - 0.68) / 0.32;
    target = 0.68 + 0.32 * (1 - Math.exp(-2 * over));
  } else if (ev < 0) {
    const toeLift = Math.abs(ev) * 0.006 * Math.sqrt(target) * (1 - target);
    target += toeLift;
  }

  const ratio = luminance > 1e-7 ? target / luminance : gain;
  let rr = Math.max(0, r * ratio);
  let gg = Math.max(0, g * ratio);
  let bb = Math.max(0, b * ratio);

  if (ev > 0) {
    const maximum = Math.max(rr, gg, bb);
    if (maximum > 0.82) {
      const over = (maximum - 0.82) / 0.18;
      const compressed = 0.82 + 0.18 * (1 - Math.exp(-2 * over));
      const compression = compressed / maximum;
      rr *= compression;
      gg *= compression;
      bb *= compression;
    }
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

function applyColor(r, g, b, color) {
  if (color === 0) return [r, g, b];

  const [L, a, bValue] = linearRgbToOklab(r, g, b);
  const chroma = Math.hypot(a, bValue);
  if (chroma < 1e-7) return [r, g, b];

  const amount = Math.max(-1, Math.min(1, color / 100));
  let factor;
  if (amount < 0) {
    factor = 1 + amount;
  } else {
    const chromaLevel = Math.min(1, chroma / 0.3);
    const hue = ((Math.atan2(bValue, a) * 180) / Math.PI + 360) % 360;
    const skinDistance = Math.min(Math.abs(hue - 50), 360 - Math.abs(hue - 50));
    const skinProtection = Math.max(0, 1 - skinDistance / 42) * Math.max(0, 1 - Math.abs(L - 0.65) / 0.38);
    const vibranceResponse = 0.82 - 0.58 * chromaLevel;
    factor = 1 + amount * vibranceResponse * (1 - skinProtection * 0.38);
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

function applyGrain(r, g, b, x, y, width, height, grain, seed) {
  if (grain === 0) return [r, g, b];

  const amount = Math.max(0, Math.min(1, grain / 100));
  const longEdge = Math.max(width, height);
  const baseScale = Math.max(1, (longEdge / 1100) * (0.85 + amount * 0.5));
  const fine = valueNoise(x, y, baseScale, seed);
  const medium = valueNoise(x, y, baseScale * 2.45, seed ^ 0x45d9f3b);
  const coarse = valueNoise(x, y, baseScale * 6.2, seed ^ 0x27d4eb2d);
  const cluster = valueNoise(x, y, baseScale * 13, seed ^ 0x165667b1);
  const texture = (fine * 0.56 + medium * 0.3 + coarse * 0.14) * (0.84 + cluster * 0.16);
  const luminance = clamp01(r * 0.2126 + g * 0.7152 + b * 0.0722);
  const visibility = 0.16 + 0.84 * Math.sin(Math.PI * luminance) ** 0.62;
  const amplitude = 0.062 * amount ** 1.12 * visibility;
  const luminanceGrain = texture * amplitude;
  const chromaAmount = amplitude * 0.13;
  const chromaA = (fine * 0.65 + medium * 0.35) * chromaAmount;
  const chromaB = (medium * 0.55 + coarse * 0.45) * chromaAmount;

  return [
    r + luminanceGrain + chromaA,
    g + luminanceGrain - chromaA * 0.45 + chromaB * 0.2,
    b + luminanceGrain - chromaB * 0.7,
  ];
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
  const width = source.width;
  const height = source.height;

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

      [r, g, b] = applyExposure(r, g, b, brightness);
      [r, g, b] = applyColor(r, g, b, color);
      [r, g, b] = applyGrain(r, g, b, x, y, width, height, grain, seed);

      output[offset] = Math.round(linearToSrgb(r) * 255);
      output[offset + 1] = Math.round(linearToSrgb(g) * 255);
      output[offset + 2] = Math.round(linearToSrgb(b) * 255);
      output[offset + 3] = source.data[offset + 3];
    }
  }

  return output;
}
