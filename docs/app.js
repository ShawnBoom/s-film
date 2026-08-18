"use strict";

const FILTERS = {
  classic: { name: "FUJI Classic Chrome", defaultGrain: 8 },
  gold: { name: "KODAK Gold 200", defaultGrain: 11 },
  youth: { name: "FUJI Youth Blue", defaultGrain: 7 },
};

const MAX_PHOTOS = 20;
const PREVIEW_LONG_EDGE = 1400;
const EXPORT_LONG_EDGE = 5000;

const state = {
  photos: [],
  activeIndex: 0,
  activeFilter: "classic",
  strength: 72,
  brightness: 0,
  color: 0,
  grain: 8,
  activeAdjustment: "strength",
  comparing: false,
  busy: false,
  sourceData: null,
};

const elements = {
  canvas: document.querySelector("#preview"),
  compareButton: document.querySelector("#compare-button"),
  photoCount: document.querySelector("#photo-count"),
  input: document.querySelector("#photo-input"),
  resetButton: document.querySelector("#reset-button"),
  exportButton: document.querySelector("#export-button"),
  exportCopy: document.querySelector("#export-copy"),
  status: document.querySelector("#status-line"),
  filters: Array.from(document.querySelectorAll("[data-filter]")),
  adjustmentTabs: Array.from(document.querySelectorAll("[data-adjustment]")),
  sliderControls: Array.from(document.querySelectorAll("[data-slider]")),
  sliders: {
    strength: document.querySelector("#strength"),
    brightness: document.querySelector("#brightness"),
    color: document.querySelector("#color"),
    grain: document.querySelector("#grain"),
  },
  values: {
    strength: document.querySelector("#strength-value"),
    brightness: document.querySelector("#brightness-value"),
    color: document.querySelector("#color-value"),
    grain: document.querySelector("#grain-value"),
  },
};

function clamp(value) {
  return Math.max(0, Math.min(255, value));
}

function saturation(r, g, b, amount) {
  const lightness = r * 0.299 + g * 0.587 + b * 0.114;
  return [
    lightness + (r - lightness) * amount,
    lightness + (g - lightness) * amount,
    lightness + (b - lightness) * amount,
  ];
}

function processPixels(source, filter, settings) {
  const output = new Uint8ClampedArray(source.data.length);
  const mix = settings.strength / 100;
  const brightnessShift = settings.brightness * 1.7;
  const colorAmount = 1 + settings.color / 100;

  for (let i = 0; i < source.data.length; i += 4) {
    const r = source.data[i];
    const g = source.data[i + 1];
    const b = source.data[i + 2];
    let rr = r;
    let gg = g;
    let bb = b;

    if (filter === "classic") {
      [rr, gg, bb] = saturation(r, g, b, 0.76);
      rr = (rr - 128) * 1.04 + 127;
      gg = (gg - 128) * 1.02 + 130;
      bb = (bb - 128) * 0.98 + 134;
      rr *= 0.97;
      gg *= 0.99;
    } else if (filter === "gold") {
      [rr, gg, bb] = saturation(r, g, b, 1.1);
      rr = (rr - 128) * 1.04 + 141;
      gg = (gg - 128) * 1.02 + 134;
      bb = (bb - 128) * 0.94 + 123;
    } else {
      [rr, gg, bb] = saturation(r, g, b, 1.16);
      rr = (rr - 128) * 1.05 + 129;
      gg = (gg - 128) * 1.06 + 132;
      bb = (bb - 128) * 1.08 + 139;
    }

    rr = r + (rr - r) * mix + brightnessShift;
    gg = g + (gg - g) * mix + brightnessShift;
    bb = b + (bb - b) * mix + brightnessShift;
    [rr, gg, bb] = saturation(rr, gg, bb, colorAmount);

    const pixel = i >> 2;
    const hash = (Math.imul(pixel + 17, 1103515245) + 12345) >>> 0;
    const noise = (((hash & 1023) / 1023) - 0.5) * settings.grain * 1.35;

    output[i] = clamp(rr + noise);
    output[i + 1] = clamp(gg + noise);
    output[i + 2] = clamp(bb + noise);
    output[i + 3] = source.data[i + 3];
  }

  return output;
}

function loadImage(url) {
  return new Promise((resolve, reject) => {
    const image = new Image();
    image.onload = () => resolve(image);
    image.onerror = () => reject(new Error("无法读取这张照片"));
    image.src = url;
  });
}

function canvasBlob(canvas) {
  return new Promise((resolve, reject) => {
    canvas.toBlob(
      (blob) => (blob ? resolve(blob) : reject(new Error("照片导出失败"))),
      "image/jpeg",
      0.92,
    );
  });
}

function settings() {
  return {
    strength: state.strength,
    brightness: state.brightness,
    color: state.color,
    grain: state.grain,
  };
}

function signed(value) {
  return value > 0 ? `+${value}` : String(value);
}

function setStatus(message) {
  elements.status.textContent = message;
}

function updateSlider(name) {
  const input = elements.sliders[name];
  const value = state[name];
  const progress = name === "strength"
    ? value
    : name === "brightness"
      ? (value + 25) * 2
      : name === "color"
        ? ((value + 30) / 60) * 100
        : (value / 30) * 100;
  input.value = String(value);
  input.style.setProperty("--range-progress", `${progress}%`);
  elements.values[name].textContent = ["brightness", "color"].includes(name)
    ? signed(value)
    : String(value);
}

function updateAllSliders() {
  Object.keys(elements.sliders).forEach(updateSlider);
}

function drawPreview() {
  if (!state.sourceData) return;
  const context = elements.canvas.getContext("2d", { willReadFrequently: true });
  if (!context) return;
  const frame = context.createImageData(state.sourceData.width, state.sourceData.height);
  frame.data.set(
    state.comparing
      ? state.sourceData.data
      : processPixels(state.sourceData, state.activeFilter, settings()),
  );
  context.putImageData(frame, 0, 0);
}

async function loadPreview() {
  const sourceUrl = state.photos[state.activeIndex]?.url || "./sample-neutral.png";
  try {
    const image = await loadImage(sourceUrl);
    const scale = Math.min(1, PREVIEW_LONG_EDGE / Math.max(image.naturalWidth, image.naturalHeight));
    const canvas = elements.canvas;
    canvas.width = Math.max(1, Math.round(image.naturalWidth * scale));
    canvas.height = Math.max(1, Math.round(image.naturalHeight * scale));
    const context = canvas.getContext("2d", { willReadFrequently: true });
    if (!context) throw new Error("当前浏览器无法处理照片");
    context.imageSmoothingEnabled = true;
    context.imageSmoothingQuality = "high";
    context.drawImage(image, 0, 0, canvas.width, canvas.height);
    state.sourceData = context.getImageData(0, 0, canvas.width, canvas.height);
    drawPreview();
    setStatus(state.photos.length ? `已选择 ${state.photos.length} 张照片` : "示例预览 · 请选择你的照片");
  } catch {
    setStatus("这张照片暂时无法读取，请换一张试试");
  }
}

function updatePhotoControls() {
  const hasPhotos = state.photos.length > 0;
  elements.photoCount.textContent = hasPhotos ? `${state.activeIndex + 1} / ${state.photos.length}` : "轻点选照片";
  elements.photoCount.setAttribute("aria-label", hasPhotos && state.photos.length > 1 ? "查看下一张照片" : "选择手机照片");
  elements.exportCopy.textContent = state.busy
    ? "正在处理…"
    : state.photos.length > 1
      ? `保存 ${state.photos.length} 张照片`
      : "保存照片";
}

function addPhotos(files) {
  const picked = Array.from(files).filter((file) => file.type.startsWith("image/"));
  const room = Math.max(0, MAX_PHOTOS - state.photos.length);
  const accepted = picked.slice(0, room).map((file) => ({
    id: `${file.name}-${file.lastModified}-${crypto.randomUUID()}`,
    file,
    url: URL.createObjectURL(file),
  }));

  if (accepted.length) {
    const hadPhotos = state.photos.length > 0;
    state.photos.push(...accepted);
    if (!hadPhotos) state.activeIndex = 0;
    updatePhotoControls();
    loadPreview();
    setStatus(
      picked.length > accepted.length
        ? `已加入 ${accepted.length} 张；为保证手机流畅，最多处理 ${MAX_PHOTOS} 张`
        : `已选择 ${state.photos.length} 张照片`,
    );
  }
}

function showNextPhoto() {
  if (!state.photos.length) {
    elements.input.click();
    return;
  }
  if (state.photos.length > 1) state.activeIndex = (state.activeIndex + 1) % state.photos.length;
  updatePhotoControls();
  loadPreview();
}

function chooseFilter(filter) {
  state.activeFilter = filter;
  state.grain = FILTERS[filter].defaultGrain;
  elements.filters.forEach((button) => {
    const active = button.dataset.filter === filter;
    button.classList.toggle("active", active);
    button.setAttribute("aria-pressed", String(active));
  });
  updateSlider("grain");
  drawPreview();
}

function chooseAdjustment(adjustment) {
  state.activeAdjustment = adjustment;
  elements.adjustmentTabs.forEach((button) => {
    const active = button.dataset.adjustment === adjustment;
    button.classList.toggle("active", active);
    button.setAttribute("aria-selected", String(active));
  });
  elements.sliderControls.forEach((control) => {
    control.classList.toggle("active", control.dataset.slider === adjustment);
  });
}

function resetAdjustments() {
  state.strength = 72;
  state.brightness = 0;
  state.color = 0;
  state.grain = FILTERS[state.activeFilter].defaultGrain;
  updateAllSliders();
  drawPreview();
}

async function processPhoto(photo) {
  const image = await loadImage(photo.url);
  const scale = Math.min(1, EXPORT_LONG_EDGE / Math.max(image.naturalWidth, image.naturalHeight));
  const canvas = document.createElement("canvas");
  canvas.width = Math.max(1, Math.round(image.naturalWidth * scale));
  canvas.height = Math.max(1, Math.round(image.naturalHeight * scale));
  const context = canvas.getContext("2d", { willReadFrequently: true });
  if (!context) throw new Error("当前浏览器无法处理照片");
  context.imageSmoothingEnabled = true;
  context.imageSmoothingQuality = "high";
  context.drawImage(image, 0, 0, canvas.width, canvas.height);
  const source = context.getImageData(0, 0, canvas.width, canvas.height);
  const frame = context.createImageData(source.width, source.height);
  frame.data.set(processPixels(source, state.activeFilter, settings()));
  context.putImageData(frame, 0, 0);
  const blob = await canvasBlob(canvas);
  const baseName = photo.file.name.replace(/\.[^.]+$/, "") || "photo";
  return new File([blob], `${baseName}-see.jpg`, { type: "image/jpeg" });
}

async function downloadFiles(files) {
  for (const file of files) {
    const url = URL.createObjectURL(file);
    const link = document.createElement("a");
    link.href = url;
    link.download = file.name;
    document.body.append(link);
    link.click();
    link.remove();
    await new Promise((resolve) => window.setTimeout(resolve, 160));
    URL.revokeObjectURL(url);
  }
}

async function exportPhotos() {
  if (!state.photos.length) {
    setStatus("请先选择一张或多张手机照片");
    return;
  }

  state.busy = true;
  elements.exportButton.disabled = true;
  updatePhotoControls();
  try {
    const files = [];
    for (let index = 0; index < state.photos.length; index += 1) {
      setStatus(`正在处理 ${index + 1} / ${state.photos.length}…`);
      files.push(await processPhoto(state.photos[index]));
    }

    const shareData = { files, title: "See", text: `使用 ${FILTERS[state.activeFilter].name} 处理` };
    const canShare = typeof navigator.share === "function"
      && (typeof navigator.canShare !== "function" || navigator.canShare(shareData));

    if (canShare) {
      try {
        await navigator.share(shareData);
        setStatus(`已处理 ${files.length} 张，可在分享面板中存到“照片”`);
      } catch (error) {
        if (error instanceof DOMException && error.name === "AbortError") {
          setStatus("已取消分享，照片没有上传");
        } else {
          await downloadFiles(files);
          setStatus(`已下载 ${files.length} 张照片`);
        }
      }
    } else {
      await downloadFiles(files);
      setStatus(`已下载 ${files.length} 张照片`);
    }
  } catch (error) {
    setStatus(error instanceof Error ? error.message : "处理失败，请减少照片数量后重试");
  } finally {
    state.busy = false;
    elements.exportButton.disabled = false;
    updatePhotoControls();
  }
}

elements.input.addEventListener("change", (event) => {
  addPhotos(event.target.files || []);
  event.target.value = "";
});
elements.photoCount.addEventListener("click", showNextPhoto);
elements.resetButton.addEventListener("click", resetAdjustments);
elements.exportButton.addEventListener("click", exportPhotos);
elements.filters.forEach((button) => {
  button.addEventListener("click", () => chooseFilter(button.dataset.filter));
});
elements.adjustmentTabs.forEach((button) => {
  button.addEventListener("click", () => chooseAdjustment(button.dataset.adjustment));
});

Object.keys(elements.sliders).forEach((name) => {
  elements.sliders[name].addEventListener("input", (event) => {
    state[name] = Number(event.target.value);
    updateSlider(name);
    drawPreview();
  });
});

function showOriginal() {
  state.comparing = true;
  drawPreview();
}

function showFilter() {
  state.comparing = false;
  drawPreview();
}

elements.compareButton.addEventListener("pointerdown", showOriginal);
elements.compareButton.addEventListener("pointerup", showFilter);
elements.compareButton.addEventListener("pointercancel", showFilter);
elements.compareButton.addEventListener("pointerleave", showFilter);
elements.compareButton.addEventListener("keydown", (event) => {
  if (event.key === " " || event.key === "Enter") showOriginal();
});
elements.compareButton.addEventListener("keyup", showFilter);

window.addEventListener("pagehide", () => {
  state.photos.forEach((photo) => URL.revokeObjectURL(photo.url));
});

if ("serviceWorker" in navigator && location.protocol === "https:") {
  navigator.serviceWorker.register("./sw.js?v=6").catch(() => {});
}

updateAllSliders();
updatePhotoControls();
loadPreview();
