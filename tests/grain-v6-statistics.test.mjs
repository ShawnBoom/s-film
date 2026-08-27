import assert from "node:assert/strict";
import test from "node:test";

import {
  createReferenceCalibratedGrainField,
  GRAIN_REFERENCE_PROFILES,
  getGrainParameters,
  processPixels,
  shapeReferenceGrain,
} from "../lib/image-engine.js";

const SIZE = 256;
const SEED = 77881;

function shapedField(grain = 100) {
  const field = createReferenceCalibratedGrainField(SIZE, SIZE, SEED);
  const parameters = getGrainParameters(grain, SIZE, SIZE);
  const values = new Float64Array(SIZE * SIZE);
  for (let pixel = 0; pixel < values.length; pixel += 1) {
    const rawA = field.data[pixel * 2];
    const rawB = field.data[pixel * 2 + 1];
    const profileA = rawA + (shapeReferenceGrain(rawA, "A") - rawA) * parameters.tailMix;
    const profileB = shapeReferenceGrain(rawB, "B");
    values[pixel] = (
      profileA + (profileB - profileA) * parameters.profileInterpolation
    ) * parameters.blendNormalization;
  }
  return values;
}

function meanAndRms(values) {
  let mean = 0;
  for (const value of values) mean += value;
  mean /= values.length;
  let variance = 0;
  for (const value of values) variance += (value - mean) ** 2;
  return { mean, rms: Math.sqrt(variance / values.length) };
}

function correlation(values, dx, dy) {
  const { mean, rms } = meanAndRms(values);
  let covariance = 0;
  let count = 0;
  for (let y = 0; y < SIZE - dy; y += 1) {
    for (let x = 0; x < SIZE - dx; x += 1) {
      covariance += (values[y * SIZE + x] - mean)
        * (values[(y + dy) * SIZE + x + dx] - mean);
      count += 1;
    }
  }
  return covariance / count / (rms * rms);
}

function fft(valuesReal, valuesImaginary) {
  const length = valuesReal.length;
  for (let index = 1, reversed = 0; index < length; index += 1) {
    let bit = length >> 1;
    while (reversed & bit) {
      reversed ^= bit;
      bit >>= 1;
    }
    reversed ^= bit;
    if (index < reversed) {
      [valuesReal[index], valuesReal[reversed]] = [valuesReal[reversed], valuesReal[index]];
      [valuesImaginary[index], valuesImaginary[reversed]] = [
        valuesImaginary[reversed],
        valuesImaginary[index],
      ];
    }
  }

  for (let span = 2; span <= length; span <<= 1) {
    const angle = -2 * Math.PI / span;
    const baseReal = Math.cos(angle);
    const baseImaginary = Math.sin(angle);
    for (let start = 0; start < length; start += span) {
      let twiddleReal = 1;
      let twiddleImaginary = 0;
      for (let offset = 0; offset < span / 2; offset += 1) {
        const first = start + offset;
        const second = first + span / 2;
        const productReal = valuesReal[second] * twiddleReal
          - valuesImaginary[second] * twiddleImaginary;
        const productImaginary = valuesReal[second] * twiddleImaginary
          + valuesImaginary[second] * twiddleReal;
        valuesReal[second] = valuesReal[first] - productReal;
        valuesImaginary[second] = valuesImaginary[first] - productImaginary;
        valuesReal[first] += productReal;
        valuesImaginary[first] += productImaginary;
        const nextReal = twiddleReal * baseReal - twiddleImaginary * baseImaginary;
        twiddleImaginary = twiddleReal * baseImaginary + twiddleImaginary * baseReal;
        twiddleReal = nextReal;
      }
    }
  }
}

function spectralMetrics(values) {
  const real = Float64Array.from(values);
  const imaginary = new Float64Array(values.length);
  const rowReal = new Float64Array(SIZE);
  const rowImaginary = new Float64Array(SIZE);

  for (let y = 0; y < SIZE; y += 1) {
    for (let x = 0; x < SIZE; x += 1) {
      rowReal[x] = real[y * SIZE + x];
      rowImaginary[x] = 0;
    }
    fft(rowReal, rowImaginary);
    for (let x = 0; x < SIZE; x += 1) {
      real[y * SIZE + x] = rowReal[x];
      imaginary[y * SIZE + x] = rowImaginary[x];
    }
  }

  for (let x = 0; x < SIZE; x += 1) {
    for (let y = 0; y < SIZE; y += 1) {
      rowReal[y] = real[y * SIZE + x];
      rowImaginary[y] = imaginary[y * SIZE + x];
    }
    fft(rowReal, rowImaginary);
    for (let y = 0; y < SIZE; y += 1) {
      real[y * SIZE + x] = rowReal[y];
      imaginary[y * SIZE + x] = rowImaginary[y];
    }
  }

  const binWidth = 0.025;
  const radialPower = new Float64Array(30);
  const radialCount = new Uint32Array(30);
  const sectorPower = new Float64Array(4);
  const sectorCount = new Uint32Array(4);
  let totalPower = 0;
  let lowFrequencyPower = 0;

  for (let y = 0; y < SIZE; y += 1) {
    for (let x = 0; x < SIZE; x += 1) {
      if (x === 0 && y === 0) continue;
      const frequencyX = (x <= SIZE / 2 ? x : x - SIZE) / SIZE;
      const frequencyY = (y <= SIZE / 2 ? y : y - SIZE) / SIZE;
      const radius = Math.hypot(frequencyX, frequencyY);
      const power = real[y * SIZE + x] ** 2 + imaginary[y * SIZE + x] ** 2;
      totalPower += power;
      if (radius < 0.05) lowFrequencyPower += power;
      const bin = Math.min(radialPower.length - 1, Math.floor(radius / binWidth));
      radialPower[bin] += power;
      radialCount[bin] += 1;

      if (radius > 0.1 && radius < 0.45) {
        const foldedAngle = (Math.atan2(frequencyY, frequencyX) + Math.PI * 2)
          % (Math.PI / 2);
        const sector = Math.min(3, Math.floor(foldedAngle / (Math.PI / 8)));
        sectorPower[sector] += power;
        sectorCount[sector] += 1;
      }
    }
  }

  const radialAverage = Array.from(radialPower, (power, index) => (
    power / Math.max(1, radialCount[index])
  ));
  const peakBin = radialAverage.reduce(
    (best, value, index) => (value > radialAverage[best] ? index : best),
    0,
  );
  const sectorAverage = Array.from(sectorPower, (power, index) => (
    power / Math.max(1, sectorCount[index])
  ));

  return {
    lowFrequencyRatio: lowFrequencyPower / totalPower,
    peakFrequency: (peakBin + 0.5) * binWidth,
    anisotropyRatio: Math.max(...sectorAverage) / Math.min(...sectorAverage),
  };
}

function connectedComponents(values, threshold) {
  const visited = new Uint8Array(values.length);
  const components = [];
  for (let start = 0; start < values.length; start += 1) {
    if (visited[start] || Math.abs(values[start]) < threshold) continue;
    const sign = Math.sign(values[start]);
    const queue = [start];
    visited[start] = 1;
    let area = 0;
    let minX = SIZE;
    let maxX = 0;
    let minY = SIZE;
    let maxY = 0;
    for (let head = 0; head < queue.length; head += 1) {
      const index = queue[head];
      const y = Math.floor(index / SIZE);
      const x = index - y * SIZE;
      area += 1;
      minX = Math.min(minX, x);
      maxX = Math.max(maxX, x);
      minY = Math.min(minY, y);
      maxY = Math.max(maxY, y);
      for (let neighborY = Math.max(0, y - 1); neighborY <= Math.min(SIZE - 1, y + 1); neighborY += 1) {
        for (let neighborX = Math.max(0, x - 1); neighborX <= Math.min(SIZE - 1, x + 1); neighborX += 1) {
          const neighbor = neighborY * SIZE + neighborX;
          if (!visited[neighbor]
            && Math.sign(values[neighbor]) === sign
            && Math.abs(values[neighbor]) >= threshold) {
            visited[neighbor] = 1;
            queue.push(neighbor);
          }
        }
      }
    }
    components.push({
      area,
      diameter: Math.hypot(maxX - minX + 1, maxY - minY + 1),
    });
  }
  return components;
}

function localDensityVariation(values, tileSize, threshold = 1.5) {
  const counts = [];
  for (let tileY = 0; tileY < SIZE; tileY += tileSize) {
    for (let tileX = 0; tileX < SIZE; tileX += tileSize) {
      let count = 0;
      for (let y = tileY; y < tileY + tileSize; y += 1) {
        for (let x = tileX; x < tileX + tileSize; x += 1) {
          if (Math.abs(values[y * SIZE + x]) > threshold) count += 1;
        }
      }
      counts.push(count);
    }
  }
  const mean = counts.reduce((total, value) => total + value, 0) / counts.length;
  const variance = counts.reduce((total, value) => total + (value - mean) ** 2, 0)
    / counts.length;
  return {
    coefficientOfVariation: Math.sqrt(variance) / mean,
    range: Math.max(...counts) - Math.min(...counts),
  };
}

function srgbToLinear(channel) {
  const value = channel / 255;
  return value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4;
}

function pixelOklab(r, g, b) {
  const red = srgbToLinear(r);
  const green = srgbToLinear(g);
  const blue = srgbToLinear(b);
  const lRoot = Math.cbrt(0.4122214708 * red + 0.5363325363 * green + 0.0514459929 * blue);
  const mRoot = Math.cbrt(0.2119034982 * red + 0.6806995451 * green + 0.1073969566 * blue);
  const sRoot = Math.cbrt(0.0883024619 * red + 0.2817188376 * green + 0.6299787005 * blue);
  return [
    0.2104542553 * lRoot + 0.793617785 * mRoot - 0.0040720468 * sRoot,
    1.9779984951 * lRoot - 2.428592205 * mRoot + 0.4505937099 * sRoot,
    0.0259040371 * lRoot + 0.7827717662 * mRoot - 0.808675766 * sRoot,
  ];
}

function flatPatchStopRms(gray, grain) {
  const width = 128;
  const height = 128;
  const source = new Uint8ClampedArray(width * height * 4);
  for (let offset = 0; offset < source.length; offset += 4) {
    source.set([gray, gray, gray, 255], offset);
  }
  const result = processPixels(
    { width, height, data: source },
    { filter: null, strength: 100, brightness: 0, color: 0, grain },
    SEED,
  );
  const original = srgbToLinear(gray);
  const values = new Float64Array(width * height);
  let mean = 0;
  for (let pixel = 0; pixel < values.length; pixel += 1) {
    values[pixel] = Math.log2(Math.max(1e-8, srgbToLinear(result[pixel * 4])) / original);
    mean += values[pixel];
  }
  mean /= values.length;
  let variance = 0;
  for (const value of values) variance += (value - mean) ** 2;
  return Math.sqrt(variance / values.length);
}

test("Grain v6.2 preserves the measured reference definitions", () => {
  assert.equal(GRAIN_REFERENCE_PROFILES.A.label, "黄油100 target");
  assert.equal(GRAIN_REFERENCE_PROFILES.B.label, "Snapseed100 target");
  assert.equal(GRAIN_REFERENCE_PROFILES.A.targetGrain, 50);
  assert.equal(GRAIN_REFERENCE_PROFILES.B.targetGrain, 100);
  assert.ok(Math.abs(GRAIN_REFERENCE_PROFILES.A.measuredRmsStops - 0.1987) < 1e-6);
  assert.ok(Math.abs(GRAIN_REFERENCE_PROFILES.B.measuredRmsStops - 0.5454) < 1e-6);
  assert.ok(GRAIN_REFERENCE_PROFILES.A.measuredMedianPeriodRefPx
    < GRAIN_REFERENCE_PROFILES.B.measuredMedianPeriodRefPx);
});

test("Grain v6.2 substantially shortens both profile correlation lengths", () => {
  const profileA = shapedField(50);
  const profileB = shapedField(100);
  const aHorizontal = correlation(profileA, 1, 0);
  const aVertical = correlation(profileA, 0, 1);
  const bHorizontal = correlation(profileB, 1, 0);
  const bVertical = correlation(profileB, 0, 1);
  assert.ok(aHorizontal > 0.02 && aHorizontal < 0.06);
  assert.ok(aVertical > 0.02 && aVertical < 0.06);
  assert.ok(bHorizontal > 0.05 && bHorizontal < 0.1);
  assert.ok(bVertical > 0.05 && bVertical < 0.1);
  assert.ok(bHorizontal > aHorizontal * 1.5);
  assert.ok(aHorizontal < 0.070417 * 0.7);
  assert.ok(bHorizontal < 0.18414 * 0.5);
  assert.ok(Math.abs(aHorizontal - aVertical) < 0.04);
  assert.ok(Math.abs(bHorizontal - bVertical) < 0.04);
  assert.ok(Math.abs(correlation(profileA, 3, 0)) < 0.08);
  assert.ok(Math.abs(correlation(profileB, 4, 0)) < 0.08);
});

test("Grain v6.2 preserves the accepted v6.1 strength response", () => {
  const profileA = flatPatchStopRms(128, 50);
  const profileB = flatPatchStopRms(128, 100);
  assert.ok(profileA > 0.18 && profileA < 0.23, `Profile A RMS ${profileA}`);
  assert.ok(profileB > 0.32 && profileB < 0.4, `Profile B RMS ${profileB}`);
  assert.ok(profileB > profileA * 1.6);
  assert.ok(profileB < profileA * 2);
});

test("Grain v6.2 fields remain broad-spectrum, normalized, and isotropic", () => {
  const profileA = shapedField(50);
  const profileB = shapedField(100);
  for (const values of [profileA, profileB]) {
    const { mean, rms } = meanAndRms(values);
    const spectrum = spectralMetrics(values);
    assert.ok(Math.abs(mean) < 0.012);
    assert.ok(rms > 0.97 && rms < 1.04);
    assert.ok(spectrum.lowFrequencyRatio < 0.035);
    assert.ok(
      spectrum.anisotropyRatio < 1.25,
      `anisotropy ${spectrum.anisotropyRatio.toFixed(4)}`,
    );
  }
  const spectrumA = spectralMetrics(profileA);
  const spectrumB = spectralMetrics(profileB);
  assert.ok(spectrumA.peakFrequency > spectrumB.peakFrequency);
  assert.ok(spectrumA.lowFrequencyRatio < spectrumB.lowFrequencyRatio);
});

test("Grain v6.2 strong excursions do not form large blocks", () => {
  for (const grain of [50, 100]) {
    const components = connectedComponents(shapedField(grain), 3);
    assert.ok(components.length > 100);
    assert.ok(Math.max(...components.map(({ area }) => area)) <= 4);
    assert.ok(Math.max(...components.map(({ diameter }) => diameter)) <= 4);
    assert.equal(components.filter(({ area }) => area > 4).length, 0);
  }
});

test("Grain v6.2 adds microscopic density variation without broad modulation", () => {
  for (const grain of [50, 100]) {
    const values = shapedField(grain);
    const microscopic = localDensityVariation(values, 8);
    const broad = localDensityVariation(values, 32);
    assert.ok(microscopic.coefficientOfVariation > 0.32);
    assert.ok(microscopic.coefficientOfVariation < 0.42);
    assert.ok(microscopic.range >= 16);
    assert.ok(broad.coefficientOfVariation < 0.11);
    assert.ok(microscopic.coefficientOfVariation > broad.coefficientOfVariation * 3.5);
  }
});

test("Grain v6.2 has only a restrained tail of connected micro-structures", () => {
  const components = connectedComponents(shapedField(100), 2);
  assert.ok(Math.max(...components.map(({ area }) => area)) <= 6);
  assert.ok(Math.max(...components.map(({ diameter }) => diameter)) <= 7);
  assert.ok(components.filter(({ area }) => area > 4).length <= 2);
});

test("Grain v6.2 preserves hue and average chroma on colored patches", () => {
  const patches = [
    [220, 112, 35],
    [202, 145, 120],
    [35, 190, 205],
    [45, 80, 220],
    [210, 40, 45],
    [45, 175, 70],
    [92, 52, 30],
    [225, 196, 150],
  ];
  const width = 64;
  const height = 64;

  for (const patch of patches) {
    const source = new Uint8ClampedArray(width * height * 4);
    for (let offset = 0; offset < source.length; offset += 4) {
      source.set([...patch, 255], offset);
    }
    const result = processPixels(
      { width, height, data: source },
      { filter: null, strength: 100, brightness: 0, color: 0, grain: 100 },
      SEED,
    );
    const originalLab = pixelOklab(...patch);
    const originalChroma = Math.hypot(originalLab[1], originalLab[2]);
    const originalHue = Math.atan2(originalLab[2], originalLab[1]);
    let chromaDrift = 0;
    let absoluteHueDrift = 0;
    let clipped = 0;

    for (let offset = 0; offset < result.length; offset += 4) {
      const lab = pixelOklab(result[offset], result[offset + 1], result[offset + 2]);
      chromaDrift += Math.hypot(lab[1], lab[2]) - originalChroma;
      let hueDrift = Math.atan2(lab[2], lab[1]) - originalHue;
      while (hueDrift > Math.PI) hueDrift -= Math.PI * 2;
      while (hueDrift < -Math.PI) hueDrift += Math.PI * 2;
      absoluteHueDrift += Math.abs(hueDrift);
      if ([result[offset], result[offset + 1], result[offset + 2]]
        .some((channel) => channel === 0 || channel === 255)) clipped += 1;
    }

    const averageChromaDrift = chromaDrift / (width * height);
    const averageHueDrift = absoluteHueDrift / (width * height);
    const clippingRate = clipped / (width * height);
    assert.ok(
      Math.abs(averageChromaDrift) < 0.006,
      `${patch.join(",")} chroma drift ${averageChromaDrift}`,
    );
    assert.ok(
      averageHueDrift < Math.PI / 180,
      `${patch.join(",")} hue drift ${averageHueDrift}`,
    );
    assert.ok(clippingRate < 0.001, `${patch.join(",")} clipping ${clippingRate}`);
  }
});

test("Grain v6.2 slider interpolation is continuous, deterministic, and reversible", () => {
  const before = shapedField(49);
  const anchor = shapedField(50);
  const after = shapedField(51);
  let beforeDelta = 0;
  let afterDelta = 0;
  for (let index = 0; index < anchor.length; index += 1) {
    beforeDelta += (anchor[index] - before[index]) ** 2;
    afterDelta += (after[index] - anchor[index]) ** 2;
  }
  beforeDelta = Math.sqrt(beforeDelta / anchor.length);
  afterDelta = Math.sqrt(afterDelta / anchor.length);
  assert.ok(beforeDelta < 0.025);
  assert.ok(afterDelta < 0.025);
  assert.deepEqual(shapedField(20), shapedField(20));
  assert.notDeepEqual(
    createReferenceCalibratedGrainField(SIZE, SIZE, SEED).data,
    createReferenceCalibratedGrainField(SIZE, SIZE, SEED + 1).data,
  );
});
