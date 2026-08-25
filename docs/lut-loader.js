import { getFilterLut, registerFilterLut } from "./image-engine.js?v=53";

export const FILTER_LUT_MANIFEST = Object.freeze({
  classic: Object.freeze({ module: "s01-classic-neg-lut.js", size: 33 }),
  gold: Object.freeze({ module: "s02-classic-chrome-lut.js", size: 33 }),
  youth: Object.freeze({ module: "s03-classic-chrome-lut.js", size: 33 }),
  slot04: Object.freeze({ module: "s04-pro400h-lut.js", size: 33 }),
  slot05: Object.freeze({ module: "s05-superia400-lut.js", size: 33 }),
  slot06: Object.freeze({ module: "s06-color100-lut.js", size: 33 }),
  slot07: Object.freeze({ module: "s07-color800z-lut.js", size: 33 }),
  slot08: Object.freeze({ module: "s08-gold-blue-lut.js", size: 64 }),
  slot09: Object.freeze({ module: "s09-portra-cool-lut.js", size: 64 }),
  slot10: Object.freeze({ module: "s10-proimage-original-lut.js", size: 25 }),
  slot11: Object.freeze({ module: "s11-ektar100-lut.js", size: 64 }),
  slot12: Object.freeze({ module: "s12-portra400-lut.js", size: 64 }),
  slot13: Object.freeze({ module: "s13-gold200-lut.js", size: 64 }),
  slot14: Object.freeze({ module: "s14-chrome64-lut.js", size: 64 }),
});

const LOADERS = Object.freeze({
  classic: () => import("./s01-classic-neg-lut.js?v=52"),
  gold: () => import("./s02-classic-chrome-lut.js?v=52"),
  youth: () => import("./s03-classic-chrome-lut.js?v=52"),
  slot04: () => import("./s04-pro400h-lut.js?v=52"),
  slot05: () => import("./s05-superia400-lut.js?v=52"),
  slot06: () => import("./s06-color100-lut.js?v=52"),
  slot07: () => import("./s07-color800z-lut.js?v=52"),
  slot08: () => import("./s08-gold-blue-lut.js?v=52"),
  slot09: () => import("./s09-portra-cool-lut.js?v=52"),
  slot10: () => import("./s10-proimage-original-lut.js?v=52"),
  slot11: () => import("./s11-ektar100-lut.js?v=52"),
  slot12: () => import("./s12-portra400-lut.js?v=52"),
  slot13: () => import("./s13-gold200-lut.js?v=52"),
  slot14: () => import("./s14-chrome64-lut.js?v=52"),
});

const PICKERS = Object.freeze({
  classic: (module) => [module.S01_LUT, module.S01_LUT_SIZE],
  gold: (module) => [module.S02_LUT, module.S02_LUT_SIZE],
  youth: (module) => [module.S03_LUT, module.S03_LUT_SIZE],
  slot04: (module) => [module.S04_LUT, module.S04_LUT_SIZE],
  slot05: (module) => [module.S05_LUT, module.S05_LUT_SIZE],
  slot06: (module) => [module.S06_LUT, module.S06_LUT_SIZE],
  slot07: (module) => [module.S07_LUT, module.S07_LUT_SIZE],
  slot08: (module) => [module.S08_LUT, module.S08_LUT_SIZE],
  slot09: (module) => [module.S09_LUT, module.S09_LUT_SIZE],
  slot10: (module) => [module.S10_LUT, module.S10_LUT_SIZE],
  slot11: (module) => [module.S11_LUT, module.S11_LUT_SIZE],
  slot12: (module) => [module.S12_LUT, module.S12_LUT_SIZE],
  slot13: (module) => [module.S13_LUT, module.S13_LUT_SIZE],
  slot14: (module) => [module.S14_LUT, module.S14_LUT_SIZE],
});

const pendingLoads = new Map();
const failedImportUrls = new Map();
const retryCounts = new Map();

function failureUrl(error, fallback) {
  const match = String(error?.message ?? error).match(/https?:\/\/[^\s)]+/);
  return match?.[0] ?? new URL(fallback, import.meta.url).href;
}

function importFilterModule(filter, loader) {
  const failedUrl = failedImportUrls.get(filter);
  if (!failedUrl) return loader();
  const attempt = (retryCounts.get(filter) ?? 0) + 1;
  retryCounts.set(filter, attempt);
  const retryUrl = new URL(failedUrl);
  retryUrl.searchParams.set("retry", String(attempt));
  return import(retryUrl.href);
}

export function isFilterLutLoaded(filter) {
  return Boolean(getFilterLut(filter));
}

export function loadFilterLut(filter) {
  if (!filter) return Promise.resolve(null);
  const cached = getFilterLut(filter);
  if (cached) return Promise.resolve(cached);
  const loader = LOADERS[filter];
  if (!loader) return Promise.reject(new Error(`Unknown filter LUT: ${filter}`));
  const pending = pendingLoads.get(filter);
  if (pending) return pending;

  const request = importFilterModule(filter, loader)
    .then((module) => {
      const [data, size] = PICKERS[filter](module);
      const expected = FILTER_LUT_MANIFEST[filter];
      if (size !== expected.size) throw new Error(`Unexpected LUT size for ${filter}`);
      const registered = registerFilterLut(filter, data, size);
      failedImportUrls.delete(filter);
      retryCounts.delete(filter);
      return registered;
    })
    .catch((error) => {
      pendingLoads.delete(filter);
      failedImportUrls.set(filter, failureUrl(error, FILTER_LUT_MANIFEST[filter].module));
      throw error;
    });
  pendingLoads.set(filter, request);
  return request;
}
