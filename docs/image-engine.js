const FILTER_LUTS = new Map();

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
  return FILTER_LUTS.get(filter) ?? null;
}

export function registerFilterLut(filter, data, size) {
  if (!filter || !(data instanceof Float32Array) || !Number.isInteger(size) || size < 2) {
    throw new TypeError("Invalid filter LUT registration");
  }
  if (data.length !== size ** 3 * 3) {
    throw new RangeError(`Invalid LUT data length for ${filter}`);
  }
  const current = FILTER_LUTS.get(filter);
  if (current && (current.data !== data || current.size !== size)) {
    throw new Error(`Conflicting LUT registration for ${filter}`);
  }
  const entry = current ?? Object.freeze({ data, size });
  FILTER_LUTS.set(filter, entry);
  return entry;
}

function applyPresetSrgb(r, g, b, filter) {
  const lut = getFilterLut(filter);
  if (!lut) throw new Error(`Filter LUT not loaded: ${filter}`);
  return applyLut(lut.data, lut.size, r, g, b);
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
      boost: 0.95 * normalized ** 1.15,
      fade: 0,
    };
  }
  if (normalized < 0) {
    return {
      active: true,
      boost: 0,
      fade: Math.abs(normalized) ** 1.15,
    };
  }
  return { active: false, boost: 0, fade: 0 };
}

function applyColor(r, g, b, parameters) {
  const { boost, fade } = parameters;

  const [L, a, bValue] = linearRgbToOklab(r, g, b);
  const chroma = Math.hypot(a, bValue);
  if (chroma < 1e-7) return [r, g, b];

  let factor;
  if (boost === 0) {
    const chromaRatio = chroma / 0.12;
    const highChromaWeight = chromaRatio / (1 + chromaRatio);
    const fadeMultiplier = 1.12 + (0.88 - 1.12) * highChromaWeight;
    const effectiveFade = Math.min(
      1,
      fade * (fadeMultiplier + (1 - fadeMultiplier) * fade),
    );
    factor = 1 - effectiveFade;
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

const GRAIN_SMALL_WEIGHTS = Object.freeze([
  0.00001453,
  0.00539458,
  0.18785872,
  0.61346435,
  0.18785872,
  0.00539458,
  0.00001453,
]);

const GRAIN_BROAD_WEIGHTS = Object.freeze([
  0.02153191,
  0.09452136,
  0.22961404,
  0.30866539,
  0.22961404,
  0.09452136,
  0.02153191,
]);

const GRAIN_BAND_NORMALIZATION = 5.62214436;
const GRAIN_FIELD_LIMIT = 3;

function grainHashState(x, y, seed) {
  let state = (Math.imul(x, 374761393) ^ Math.imul(y, 668265263) ^ seed) >>> 0;
  state = Math.imul(state ^ (state >>> 13), 1274126177) >>> 0;
  state = (state ^ (state >>> 16)) >>> 0;
  return state === 0 ? 0x6d2b79f5 : state;
}

function grainHashValue(x, y, seed) {
  return grainHashState(x, y, seed) / 4294967295 * 2 - 1;
}

function grainReferenceSize(width, height) {
  const scale = Math.min(1, 960 / Math.max(1, width, height));
  return {
    width: Math.max(1, Math.round(width * scale)),
    height: Math.max(1, Math.round(height * scale)),
  };
}

export function getGrainParameters(grain, width, height) {
  const amount = Math.max(0, Math.min(1, grain / 100));
  const referenceSize = grainReferenceSize(width, height);
  if (amount === 0) {
    return {
      active: false,
      engine: "v5-band-limited",
      amount: 0,
      referenceLongEdge: 960,
      coordinateScale: 0,
      referenceWidth: referenceSize.width,
      referenceHeight: referenceSize.height,
      bandPassSmallSigma: 0.65,
      bandPassBroadSigma: 1.3,
      rmsStops: 0,
      roughness: 0,
      detailCoupling: 0,
      referenceLowFrequencyEnergyRatio: 0.0002,
    };
  }

  return {
    active: true,
    engine: "v5-band-limited",
    amount,
    referenceLongEdge: 960,
    coordinateScale: Math.min(1, 960 / Math.max(1, width, height)),
    referenceWidth: referenceSize.width,
    referenceHeight: referenceSize.height,
    bandPassSmallSigma: 0.65,
    bandPassBroadSigma: 1.3,
    rmsStops: 0.085 * amount ** 0.9,
    roughness: 0.25 * amount ** 0.8,
    detailCoupling: 0.035 * amount ** 1.5,
    referenceLowFrequencyEnergyRatio: 0.0002,
  };
}

export function createBandLimitedGrainField(width, height, seed = 1) {
  const { width: referenceWidth, height: referenceHeight } = grainReferenceSize(width, height);
  const length = referenceWidth * referenceHeight;
  const noise = new Float32Array(length);
  const smallHorizontal = new Float32Array(length);
  const broadHorizontal = new Float32Array(length);
  const field = new Float32Array(length);

  for (let y = 0; y < referenceHeight; y += 1) {
    for (let x = 0; x < referenceWidth; x += 1) {
      noise[y * referenceWidth + x] = grainHashValue(x, y, seed);
    }
  }

  for (let y = 0; y < referenceHeight; y += 1) {
    const row = y * referenceWidth;
    for (let x = 0; x < referenceWidth; x += 1) {
      let small = 0;
      let broad = 0;
      for (let tap = -3; tap <= 3; tap += 1) {
        const sampleX = Math.max(0, Math.min(referenceWidth - 1, x + tap));
        const sample = noise[row + sampleX];
        small += sample * GRAIN_SMALL_WEIGHTS[tap + 3];
        broad += sample * GRAIN_BROAD_WEIGHTS[tap + 3];
      }
      smallHorizontal[row + x] = small;
      broadHorizontal[row + x] = broad;
    }
  }

  for (let y = 0; y < referenceHeight; y += 1) {
    for (let x = 0; x < referenceWidth; x += 1) {
      let small = 0;
      let broad = 0;
      for (let tap = -3; tap <= 3; tap += 1) {
        const sampleY = Math.max(0, Math.min(referenceHeight - 1, y + tap));
        const index = sampleY * referenceWidth + x;
        small += smallHorizontal[index] * GRAIN_SMALL_WEIGHTS[tap + 3];
        broad += broadHorizontal[index] * GRAIN_BROAD_WEIGHTS[tap + 3];
      }
      field[y * referenceWidth + x] = Math.max(
        -GRAIN_FIELD_LIMIT,
        Math.min(GRAIN_FIELD_LIMIT, (small - broad) * GRAIN_BAND_NORMALIZATION),
      );
    }
  }

  return { width: referenceWidth, height: referenceHeight, data: field };
}

export function shapeBandLimitedGrain(value, roughness) {
  const heavyTail = value + roughness * 0.06 * (value ** 3 - 3 * value);
  const normalization = 1.0865 + 0.0608 * roughness;
  return 2.8 * Math.tanh(heavyTail / 2.8) * normalization;
}

function sampleBandLimitedGrain(field, x, y, outputWidth, outputHeight) {
  const fieldX = (x + 0.5) * field.width / outputWidth - 0.5;
  const fieldY = (y + 0.5) * field.height / outputHeight - 0.5;
  const x0 = Math.max(0, Math.min(field.width - 1, Math.floor(fieldX)));
  const y0 = Math.max(0, Math.min(field.height - 1, Math.floor(fieldY)));
  const x1 = Math.min(field.width - 1, x0 + 1);
  const y1 = Math.min(field.height - 1, y0 + 1);
  const mixX = clamp01(fieldX - x0);
  const mixY = clamp01(fieldY - y0);
  const top = field.data[y0 * field.width + x0]
    + (field.data[y0 * field.width + x1] - field.data[y0 * field.width + x0]) * mixX;
  const bottom = field.data[y1 * field.width + x0]
    + (field.data[y1 * field.width + x1] - field.data[y1 * field.width + x0]) * mixX;
  return top + (bottom - top) * mixY;
}

function fillProcessedLuminanceRow(pixels, width, height, y, target) {
  const sampleY = Math.max(0, Math.min(height - 1, y));
  for (let x = 0; x < width; x += 1) {
    const offset = (sampleY * width + x) * 4;
    target[x] = (
      SRGB_TO_LINEAR[pixels[offset]] * 0.2126
      + SRGB_TO_LINEAR[pixels[offset + 1]] * 0.7152
      + SRGB_TO_LINEAR[pixels[offset + 2]] * 0.0722
    );
  }
}

function applyBandLimitedGrain(output, width, height, parameters, seed) {
  const field = createBandLimitedGrainField(width, height, seed);
  let previous = new Float32Array(width);
  let current = new Float32Array(width);
  let next = new Float32Array(width);
  fillProcessedLuminanceRow(output, width, height, 0, previous);
  fillProcessedLuminanceRow(output, width, height, 0, current);
  fillProcessedLuminanceRow(output, width, height, 1, next);

  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const offset = (y * width + x) * 4;
      const r = SRGB_TO_LINEAR[output[offset]];
      const g = SRGB_TO_LINEAR[output[offset + 1]];
      const b = SRGB_TO_LINEAR[output[offset + 2]];
      const luminance = current[x];
      if (luminance <= 1e-7) continue;

      const left = current[Math.max(0, x - 1)];
      const right = current[Math.min(width - 1, x + 1)];
      const microscopicBlur = luminance * 0.5
        + (left + right + previous[x] + next[x]) * 0.125;
      const fineDetail = luminance - microscopicBlur;
      const integratedLuminance = Math.max(
        0,
        luminance - fineDetail * parameters.detailCoupling,
      );
      const fieldValue = shapeBandLimitedGrain(
        sampleBandLimitedGrain(field, x, y, width, height),
        parameters.roughness,
      );
      const signalResponse = 0.9
        + 0.1 * Math.sqrt(clamp01(4 * luminance * (1 - luminance)));
      const exposureStops = fieldValue * parameters.rmsStops * signalResponse;
      const targetLuminance = Math.max(
        0,
        (integratedLuminance + 0.0015) * 2 ** exposureStops - 0.0015,
      );
      const maximum = Math.max(r, g, b);
      const requestedScale = targetLuminance / luminance;
      const gamutScale = maximum > 1e-7 ? 1 / maximum : 1;
      const scale = Math.max(0, Math.min(requestedScale, gamutScale));

      output[offset] = Math.round(linearToSrgb(r * scale) * 255);
      output[offset + 1] = Math.round(linearToSrgb(g * scale) * 255);
      output[offset + 2] = Math.round(linearToSrgb(b * scale) * 255);
    }

    const reusable = previous;
    previous = current;
    current = next;
    next = reusable;
    fillProcessedLuminanceRow(output, width, height, y + 2, next);
  }
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
      output[offset] = Math.round(linearToSrgb(r) * 255);
      output[offset + 1] = Math.round(linearToSrgb(g) * 255);
      output[offset + 2] = Math.round(linearToSrgb(b) * 255);
      output[offset + 3] = source.data[offset + 3];
    }
  }

  if (grainParameters.active) {
    applyBandLimitedGrain(output, width, height, grainParameters, seed);
  }

  return output;
}
