import assert from "node:assert/strict";
import test from "node:test";

import {
  createBandLimitedGrainField,
  getGrainParameters,
  processPixels,
  shapeBandLimitedGrain,
} from "../lib/image-engine.js";

const SIZE = 256;
const SEED = 77881;

function shapedField(grain = 100) {
  const field = createBandLimitedGrainField(SIZE, SIZE, SEED);
  const parameters = getGrainParameters(grain, SIZE, SIZE);
  return Float64Array.from(
    field.data,
    (value) => shapeBandLimitedGrain(value, parameters.roughness),
  );
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

test("Grain v5 field is normalized, band-limited, and isotropic", () => {
  const values = shapedField(100);
  const { mean, rms } = meanAndRms(values);
  const spectrum = spectralMetrics(values);
  assert.ok(Math.abs(mean) < 0.01);
  assert.ok(rms > 0.97 && rms < 1.03);
  assert.ok(spectrum.lowFrequencyRatio < 0.001);
  assert.ok(spectrum.peakFrequency > 0.18 && spectrum.peakFrequency < 0.32);
  assert.ok(spectrum.anisotropyRatio < 1.2);
});

test("Grain v5 autocorrelation decays within the microscopic band", () => {
  const values = shapedField(100);
  const horizontal = [1, 2, 3, 4].map((lag) => correlation(values, lag, 0));
  const vertical = [1, 2, 3, 4].map((lag) => correlation(values, 0, lag));
  const diagonal = [1, 2, 3, 4].map((lag) => correlation(values, lag, lag));
  assert.ok(horizontal[0] > 0.1 && horizontal[0] < 0.45);
  assert.ok(vertical[0] > 0.1 && vertical[0] < 0.45);
  assert.ok(Math.abs(horizontal[0] - vertical[0]) < 0.08);
  assert.ok(Math.abs(horizontal[3]) < 0.05);
  assert.ok(Math.abs(vertical[3]) < 0.05);
  assert.ok(Math.abs(diagonal[2]) < 0.05);
});

test("Grain v5 strong excursions do not form large isolated blobs", () => {
  for (const grain of [50, 100]) {
    const components = connectedComponents(shapedField(grain), 2);
    assert.ok(components.length > 100);
    assert.ok(Math.max(...components.map(({ area }) => area)) <= 5);
    assert.ok(Math.max(...components.map(({ diameter }) => diameter)) <= 4.5);
    assert.equal(components.filter(({ area }) => area > 5).length, 0);
  }
});

test("Grain v5 preserves hue and average chroma on colored patches", () => {
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

    assert.ok(Math.abs(chromaDrift / (width * height)) < 0.001);
    assert.ok(absoluteHueDrift / (width * height) < Math.PI / 180);
    assert.equal(clipped, 0);
  }
});
