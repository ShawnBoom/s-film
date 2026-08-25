import { createGpuExportBenchmarkRenderer } from "./gpu-preview.js";

export const GPU_EXPORT_CASES = Object.freeze([
  { key: "A", label: "Filter only", strength: 100, brightness: 0, color: 0, grain: 0 },
  { key: "B", label: "Filter + Strength 50", strength: 50, brightness: 0, color: 0, grain: 0 },
  { key: "C", label: "Filter + Light +50", strength: 100, brightness: 50, color: 0, grain: 0 },
  { key: "D", label: "Filter + Color +50", strength: 100, brightness: 0, color: 50, grain: 0 },
  { key: "E", label: "Filter + Grain 50", strength: 100, brightness: 0, color: 0, grain: 50 },
  { key: "F", label: "Filter + Light + Color + Grain", strength: 100, brightness: 50, color: 50, grain: 50 },
]);

const LUT_TEXTURE_BYTES = 64 ** 3 * 4 * Float32Array.BYTES_PER_ELEMENT;
const CHANNELS = ["r", "g", "b", "a"];

function nextTask() {
  return new Promise((resolve) => setTimeout(resolve, 0));
}

function canvasToJpeg(canvas, quality = 0.95) {
  return new Promise((resolve, reject) => {
    canvas.toBlob(
      (blob) => (blob ? resolve(blob) : reject(new Error("GPU benchmark JPEG encoding failed"))),
      "image/jpeg",
      quality,
    );
  });
}

function createChannelStats() {
  return {
    sum: 0,
    squaredSum: 0,
    max: 0,
    exact: 0,
    le1: 0,
    le2: 0,
    le4: 0,
    gt4: 0,
  };
}

export async function comparePixelBuffers(cpu, gpu, options = {}) {
  if (cpu.length !== gpu.length || cpu.length % 4 !== 0) {
    throw new Error("CPU and GPU pixel buffers must have matching RGBA dimensions");
  }

  const pixels = cpu.length / 4;
  const chunkPixels = options.chunkPixels ?? 262144;
  const stats = CHANNELS.map(createChannelStats);

  for (let pixelStart = 0; pixelStart < pixels; pixelStart += chunkPixels) {
    const pixelEnd = Math.min(pixels, pixelStart + chunkPixels);
    for (let pixel = pixelStart; pixel < pixelEnd; pixel += 1) {
      const offset = pixel * 4;
      for (let channel = 0; channel < 4; channel += 1) {
        const difference = Math.abs(cpu[offset + channel] - gpu[offset + channel]);
        const channelStats = stats[channel];
        channelStats.sum += difference;
        channelStats.squaredSum += difference * difference;
        if (difference > channelStats.max) channelStats.max = difference;
        if (difference === 0) channelStats.exact += 1;
        if (difference <= 1) channelStats.le1 += 1;
        if (difference <= 2) channelStats.le2 += 1;
        if (difference <= 4) channelStats.le4 += 1;
        else channelStats.gt4 += 1;
      }
    }
    options.onProgress?.(pixelEnd, pixels);
    if (pixelEnd < pixels) await nextTask();
  }

  const result = { totalPixels: pixels, channels: {} };
  for (let channel = 0; channel < CHANNELS.length; channel += 1) {
    const values = stats[channel];
    result.channels[CHANNELS[channel]] = {
      average: values.sum / pixels,
      maximum: values.max,
      rmse: Math.sqrt(values.squaredSum / pixels),
      percentages: {
        exact: values.exact / pixels * 100,
        le1: values.le1 / pixels * 100,
        le2: values.le2 / pixels * 100,
        le4: values.le4 / pixels * 100,
        gt4: values.gt4 / pixels * 100,
      },
      counts: {
        exact: values.exact,
        le1: values.le1,
        le2: values.le2,
        le4: values.le4,
        gt4: values.gt4,
      },
    };
  }
  result.alphaIdentical = stats[3].exact === pixels;
  return result;
}

export function estimateGpuBenchmarkMemory(width, height) {
  const rgbaBytes = width * height * 4;
  // Peak diagnostic phase: source canvas, GPU input, GPU source texture,
  // drawing buffer, retained CPU output, GPU readback, and encoding canvas.
  const rgbaSurfaceCopies = 7;
  return {
    width,
    height,
    rgbaBytes,
    lutTextureBytes: LUT_TEXTURE_BYTES,
    rgbaSurfaceCopies,
    gpuResidentBytes: rgbaBytes * 2 + LUT_TEXTURE_BYTES,
    estimatedPeakBytes: rgbaBytes * rgbaSurfaceCopies + LUT_TEXTURE_BYTES,
  };
}

function fixed(value, digits = 1) {
  return Number.isFinite(value) ? value.toFixed(digits) : "—";
}

function channelLine(name, channel) {
  if (!channel) return `${name}: —`;
  const p = channel.percentages;
  return `${name} avg/rmse/max ${fixed(channel.average, 6)}/${fixed(channel.rmse, 6)}/${channel.maximum}`
    + ` | 0 ${fixed(p.exact, 6)}% ≤1 ${fixed(p.le1, 6)}% ≤2 ${fixed(p.le2, 6)}%`
    + ` ≤4 ${fixed(p.le4, 6)}% >4 ${fixed(p.gt4, 6)}% (${channel.counts.gt4})`;
}

export function formatGpuExportBenchmark(result, status = "Ready") {
  const lines = ["", "GPU EXPORT A/B", status];
  if (!result) {
    lines.push("Add a photo, then tap Run GPU A/B.");
    return lines;
  }

  lines.push(`WebGL2: ${result.webgl2Available ? "YES" : "NO"}`);
  lines.push(`Image: ${result.image.width} × ${result.image.height}`);
  if (result.capability) {
    lines.push(`MAX_TEXTURE_SIZE: ${result.capability.maxTextureSize}`);
    lines.push(`MAX_RENDERBUFFER_SIZE: ${result.capability.maxRenderbufferSize}`);
    lines.push(`MAX_VIEWPORT_DIMS: ${result.capability.maxViewportWidth} × ${result.capability.maxViewportHeight}`);
    lines.push(`Full-size render possible: ${result.capability.fullSizeRenderPossible ? "YES" : "NO"}`);
  }
  lines.push(`LUTs: ${result.allFiltersAvailable ? "14 / 14 OK" : "NOT VERIFIED"}`);
  lines.push(`Estimated peak: ${fixed(result.memory.estimatedPeakBytes / 1048576)} MiB`);
  if (result.error) lines.push(`Stopped: ${result.error}`);

  for (const test of result.cases) {
    lines.push("", `${test.key} ${test.label}`);
    lines.push(`CPU read/process: ${fixed(test.cpu.sourceRead)} / ${fixed(test.cpu.process)} ms (${test.cpu.processor})`);
    lines.push(`CPU put/JPEG/file: ${fixed(test.cpu.putImageData)} / ${fixed(test.cpu.jpeg)} / ${fixed(test.cpu.fileReady)} ms`);
    lines.push(`GPU read/upload/LUT: ${fixed(test.gpu.sourceRead)} / ${fixed(test.gpu.upload)} / ${fixed(test.gpu.lut)} ms`);
    lines.push(`GPU submit/sync: ${fixed(test.gpu.submission)} / ${fixed(test.gpu.completion)} ms`);
    lines.push(`GPU readPixels/flip/pixels: ${fixed(test.gpu.readPixels)} / ${fixed(test.gpu.rowFlip)} / ${fixed(test.gpu.totalPixelsReady)} ms`);
    lines.push(`GPU put/JPEG/file: ${fixed(test.gpu.putImageData)} / ${fixed(test.gpu.jpeg)} / ${fixed(test.gpu.fileReady)} ms`);
    lines.push(`Pixels: ${test.difference.totalPixels.toLocaleString()}`);
    lines.push(channelLine("R", test.difference.channels.r));
    lines.push(channelLine("G", test.difference.channels.g));
    lines.push(channelLine("B", test.difference.channels.b));
    lines.push(`Alpha identical: ${test.difference.alphaIdentical ? "YES" : "NO"}`);
  }
  return lines;
}

function benchmarkEdits(filter) {
  return GPU_EXPORT_CASES.map((testCase) => ({
    key: testCase.key,
    label: testCase.label,
    edit: {
      filter,
      strength: testCase.strength,
      brightness: testCase.brightness,
      color: testCase.color,
      grain: testCase.grain,
    },
  }));
}

async function encodePixels(pixels, width, height) {
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const context = canvas.getContext("2d");
  if (!context) throw new Error("GPU benchmark cannot create a 2D encoding canvas");

  const putStartedAt = performance.now();
  context.putImageData(new ImageData(pixels, width, height), 0, 0);
  const putImageData = performance.now() - putStartedAt;

  const jpegStartedAt = performance.now();
  let blob = await canvasToJpeg(canvas, 0.95);
  const jpeg = performance.now() - jpegStartedAt;
  const jpegBytes = blob.size;
  blob = null;
  canvas.width = 1;
  canvas.height = 1;
  return { putImageData, jpeg, jpegBytes };
}

async function loadOriginal(url) {
  const image = new Image();
  image.decoding = "async";
  image.src = url;
  await image.decode();
  return image;
}

export async function runGpuExportABBenchmark(options) {
  const { photo, filterIds, exportProcessor, onProgress = () => {} } = options;
  if (!photo) throw new Error("Add a photo before running the GPU export benchmark");
  if (!exportProcessor) throw new Error("CPU export processor is unavailable");
  if (!Array.isArray(filterIds) || filterIds.length !== 14) {
    throw new Error("GPU export benchmark requires all 14 filter IDs");
  }

  onProgress({ phase: "decode", message: "Decoding original photo…" });
  let image = await loadOriginal(photo.url);
  const width = image.naturalWidth;
  const height = image.naturalHeight;

  let rendererError = null;
  const renderer = createGpuExportBenchmarkRenderer({
    onError(error) {
      rendererError = error instanceof Error ? error.message : String(error);
    },
  });
  const memory = estimateGpuBenchmarkMemory(width, height);
  if (!renderer) {
    image = null;
    return {
      webgl2Available: false,
      image: { width, height },
      capability: null,
      memory,
      filterVerification: [],
      cases: [],
      skipped: true,
      error: rendererError || "WebGL2 export renderer initialization failed",
    };
  }

  let capability;
  let filterVerification;
  try {
    capability = renderer.capabilities(width, height);
    filterVerification = renderer.verifyFilters(filterIds);
  } catch (error) {
    renderer.destroy();
    image = null;
    throw error;
  }
  const allFiltersAvailable = filterVerification.every(({ available }) => available);
  const result = {
    webgl2Available: true,
    image: { width, height },
    capability,
    memory,
    filterVerification,
    allFiltersAvailable,
    selectedFilter: photo.edit.filter ?? filterIds[0],
    grainSeed: photo.grainSeed,
    cases: [],
    skipped: !capability.fullSizeRenderPossible || !allFiltersAvailable,
    error: "",
  };

  onProgress({ phase: "capability", message: "GPU capability checked", result });
  if (result.skipped) {
    if (!capability.fullSizeRenderPossible) {
      result.error = "Original dimensions exceed this device's WebGL2 limits";
    } else {
      result.error = "One or more LUT textures could not be prepared";
    }
    renderer.destroy();
    image = null;
    return result;
  }

  const sourceCanvas = document.createElement("canvas");
  sourceCanvas.width = width;
  sourceCanvas.height = height;
  const sourceContext = sourceCanvas.getContext("2d", { willReadFrequently: true });
  if (!sourceContext) {
    renderer.destroy();
    throw new Error("GPU benchmark cannot create the source canvas");
  }
  sourceContext.drawImage(image, 0, 0);
  image = null;

  const tests = benchmarkEdits(result.selectedFilter);
  try {
    for (let index = 0; index < tests.length; index += 1) {
      const test = tests[index];
      onProgress({
        phase: "case",
        index,
        total: tests.length,
        message: `Running ${test.key}: ${test.label}`,
        result,
      });

      const cpuFileStartedAt = performance.now();
      const cpuReadStartedAt = performance.now();
      let cpuSource = sourceContext.getImageData(0, 0, width, height);
      const cpuSourceRead = performance.now() - cpuReadStartedAt;
      let cpuProcessed = await exportProcessor.process(cpuSource, test.edit, photo.grainSeed);
      cpuSource = null;
      let cpuPixels = cpuProcessed.pixels;
      const cpuProcess = cpuProcessed.duration;
      const cpuProcessor = cpuProcessed.processor;
      cpuProcessed = null;
      const cpuEncoding = await encodePixels(cpuPixels, width, height);
      const cpuFileReady = performance.now() - cpuFileStartedAt;

      await nextTask();

      const gpuFileStartedAt = performance.now();
      const gpuReadStartedAt = performance.now();
      let gpuSource = sourceContext.getImageData(0, 0, width, height);
      const gpuSourceRead = performance.now() - gpuReadStartedAt;
      let gpuProcessed = await renderer.renderPixels(gpuSource, test.edit, photo.grainSeed);
      gpuSource = null;
      let gpuPixels = gpuProcessed.pixels;
      const gpuTimings = gpuProcessed.timings;
      gpuProcessed = null;
      const gpuEncoding = await encodePixels(gpuPixels, width, height);
      const gpuFileReady = performance.now() - gpuFileStartedAt;

      onProgress({
        phase: "compare",
        index,
        total: tests.length,
        message: `Comparing ${test.key}: ${test.label}`,
        result,
      });
      const compareStartedAt = performance.now();
      const difference = await comparePixelBuffers(cpuPixels, gpuPixels);
      const compare = performance.now() - compareStartedAt;

      result.cases.push({
        key: test.key,
        label: test.label,
        edit: test.edit,
        cpu: {
          processor: cpuProcessor,
          sourceRead: cpuSourceRead,
          process: cpuProcess,
          putImageData: cpuEncoding.putImageData,
          jpeg: cpuEncoding.jpeg,
          jpegBytes: cpuEncoding.jpegBytes,
          fileReady: cpuFileReady,
        },
        gpu: {
          sourceRead: gpuSourceRead,
          ...gpuTimings,
          putImageData: gpuEncoding.putImageData,
          jpeg: gpuEncoding.jpeg,
          jpegBytes: gpuEncoding.jpegBytes,
          fileReady: gpuFileReady,
        },
        difference,
        compare,
      });
      cpuPixels = null;
      gpuPixels = null;
      onProgress({
        phase: "case-complete",
        index,
        total: tests.length,
        message: `Completed ${test.key}: ${test.label}`,
        result,
      });
      await nextTask();
    }
  } finally {
    renderer.destroy();
    sourceCanvas.width = 1;
    sourceCanvas.height = 1;
  }

  return result;
}
