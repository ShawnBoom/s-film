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

function srgbToLinear(value) {
  const channel = clamp01(value);
  return channel <= 0.04045
    ? channel / 12.92
    : ((channel + 0.055) / 1.055) ** 2.4;
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

function grainCellState(x, y, seed) {
  let state = (Math.imul(x, 374761393) ^ Math.imul(y, 668265263) ^ seed) >>> 0;
  state = Math.imul(state ^ (state >>> 13), 1274126177) >>> 0;
  state = (state ^ (state >>> 16)) >>> 0;
  return state === 0 ? 0x6d2b79f5 : state;
}

function smoothstepRange(low, high, value) {
  const normalized = clamp01((value - low) / (high - low));
  return normalized * normalized * (3 - 2 * normalized);
}

export function getGrainParameters(grain, width, height) {
  const amount = Math.max(0, Math.min(1, grain / 100));
  if (amount === 0) {
    return {
      active: false,
      engine: "v4-correlated",
      amount: 0,
      referenceLongEdge: 960,
      coordinateScale: 0,
      primaryScale: 3.6,
      correlationRadius: 0,
      variance: 0,
      roughness: 0,
      detailCoupling: 0,
      acutanceRecovery: 0,
    };
  }

  return {
    active: true,
    engine: "v4-correlated",
    amount,
    referenceLongEdge: 960,
    coordinateScale: 960 / Math.max(1, width, height),
    primaryScale: 3.6,
    correlationRadius: 3.6,
    variance: 0.12 * amount ** 0.82,
    roughness: 0.1 + 0.45 * amount ** 0.9,
    detailCoupling: 0.09 * amount ** 1.35,
    acutanceRecovery: 0.007 * amount ** 1.5,
  };
}

function grainLatticeValue(x, y, seed) {
  return grainCellState(x, y, seed) / 4294967295 * 2 - 1;
}

function sampleCorrelatedExcitation(x, y, scale, seed) {
  const scaledX = x / scale;
  const scaledY = y / scale;
  const originX = Math.floor(scaledX);
  const originY = Math.floor(scaledY);
  const blendX = smoothstepRange(0, 1, scaledX - originX);
  const blendY = smoothstepRange(0, 1, scaledY - originY);
  const top = grainLatticeValue(originX, originY, seed)
    + (grainLatticeValue(originX + 1, originY, seed)
      - grainLatticeValue(originX, originY, seed)) * blendX;
  const bottom = grainLatticeValue(originX, originY + 1, seed)
    + (grainLatticeValue(originX + 1, originY + 1, seed)
      - grainLatticeValue(originX, originY + 1, seed)) * blendX;
  return top + (bottom - top) * blendY;
}

function sampleCorrelatedGrainField(x, y, parameters, seed) {
  const pointX = (x + 0.5) * parameters.coordinateScale;
  const pointY = (y + 0.5) * parameters.coordinateScale;
  const first = sampleCorrelatedExcitation(pointX, pointY, parameters.primaryScale, seed);
  const rotatedX = 0.70710678 * (pointX - pointY) + 19.37;
  const rotatedY = 0.70710678 * (pointX + pointY) - 7.91;
  const second = sampleCorrelatedExcitation(
    rotatedX,
    rotatedY,
    parameters.primaryScale,
    seed ^ 0x9e3779b9,
  );
  const mixed = 0.78 * first + 0.52 * second;
  const localRoughness = 1 + parameters.roughness * 0.65 * Math.abs(first - second);
  return Math.max(-1.8, Math.min(1.8, mixed * localRoughness));
}

function sourceLuminanceAt(source, x, y) {
  const sampleX = Math.max(0, Math.min(source.width - 1, x));
  const sampleY = Math.max(0, Math.min(source.height - 1, y));
  const offset = (sampleY * source.width + sampleX) * 4;
  return (
    source.data[offset] * 0.2126
    + source.data[offset + 1] * 0.7152
    + source.data[offset + 2] * 0.0722
  ) / 255;
}

function sourceMicroDetail(source, x, y) {
  const center = sourceLuminanceAt(source, x, y);
  const neighbors = (
    sourceLuminanceAt(source, x - 1, y)
    + sourceLuminanceAt(source, x + 1, y)
    + sourceLuminanceAt(source, x, y - 1)
    + sourceLuminanceAt(source, x, y + 1)
  ) * 0.25;
  return center - neighbors;
}

function sampleGrain(r, g, b, x, y, microDetail, parameters, seed) {
  const texture = sampleCorrelatedGrainField(x, y, parameters, seed);
  const luminance = clamp01(r * 0.2126 + g * 0.7152 + b * 0.0722);
  const exposureResponse = Math.sqrt(0.58 + 0.42 * clamp01(4 * luminance * (1 - luminance)));
  const perceptualLuminance = linearToSrgb(luminance);
  const absoluteDetail = Math.abs(microDetail);
  const integrationWeight = 1 - smoothstepRange(0.035, 0.18, absoluteDetail);
  const edgeWeight = smoothstepRange(0.05, 0.18, absoluteDetail)
    * (1 - smoothstepRange(0.3, 0.55, absoluteDetail));
  const targetLuminance = clamp01(
    perceptualLuminance
      + texture * parameters.variance * exposureResponse
      - microDetail * parameters.detailCoupling * integrationWeight
      + microDetail * parameters.acutanceRecovery * edgeWeight,
  );
  return srgbToLinear(targetLuminance) - luminance;
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
        const microDetail = sourceMicroDetail(source, x, y);
        const grainValue = sampleGrain(r, g, b, x, y, microDetail, grainParameters, seed);
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
