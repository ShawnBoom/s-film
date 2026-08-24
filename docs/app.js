import { hashSeed, processPixels } from "./image-engine.js?v=29";

const MAX_PHOTOS = 20;
const PREVIEW_LONG_EDGE = 960;

const state = {
  photos: [],
  activeIndex: 0,
  activeAdjustment: "brightness",
  showOriginal: false,
  busy: false,
  sourceData: null,
  renderFrame: 0,
  loadToken: 0,
  toastTimer: 0,
};

const elements = {
  canvas: document.querySelector("#preview"),
  stage: document.querySelector("#photo-stage"),
  compareButton: document.querySelector("#compare-button"),
  deleteButton: document.querySelector("#delete-button"),
  photoCount: document.querySelector("#photo-count"),
  thumbnailRail: document.querySelector("#thumbnail-rail"),
  input: document.querySelector("#photo-input"),
  exportButton: document.querySelector("#export-button"),
  applyAll: document.querySelector("#apply-all"),
  resetCurrent: document.querySelector("#reset-current"),
  status: document.querySelector("#status-line"),
  toast: document.querySelector("#toast"),
  slider: document.querySelector("#active-adjustment"),
  valueInput: document.querySelector("#adjustment-value"),
  filters: Array.from(document.querySelectorAll("[data-filter]")),
  adjustmentTabs: Array.from(document.querySelectorAll("[data-adjustment]")),
};

function createNeutralEdit() {
  return { filter: null, strength: 100, brightness: 0, color: 0, grain: 0 };
}

function currentPhoto() {
  return state.photos[state.activeIndex] || null;
}

function setStatus(message) {
  elements.status.textContent = message;
}

function showToast(message) {
  elements.toast.textContent = message;
  elements.toast.hidden = false;
  window.clearTimeout(state.toastTimer);
  state.toastTimer = window.setTimeout(() => {
    elements.toast.hidden = true;
  }, 1800);
}

async function loadImage(url) {
  const image = new Image();
  image.decoding = "async";
  image.src = url;
  await image.decode();
  return image;
}

function sliderConfig(edit) {
  if (state.activeAdjustment === "strength") {
    return { label: "Strength", min: 0, max: 100, value: edit.strength };
  }
  if (state.activeAdjustment === "brightness") {
    return { label: "Light", min: -100, max: 100, value: edit.brightness };
  }
  if (state.activeAdjustment === "color") {
    return { label: "Color", min: -100, max: 100, value: edit.color };
  }
  return { label: "Grain", min: 0, max: 100, value: edit.grain };
}

function clampAdjustment(value, min, max) {
  return Math.max(min, Math.min(max, Math.round(value)));
}

function setShowOriginal(value) {
  state.showOriginal = Boolean(value && currentPhoto());
  elements.compareButton.classList.toggle("is-active", state.showOriginal);
  elements.compareButton.setAttribute("aria-pressed", String(state.showOriginal));
  elements.compareButton.textContent = state.showOriginal ? "Edited" : "Original";
  queuePreview();
}

function updateCurrentEdit(patch) {
  const photo = currentPhoto();
  if (!photo) return;
  Object.assign(photo.edit, patch);
  setShowOriginal(false);
  renderControls();
  queuePreview();
}

function updateAdjustmentValue(value) {
  const photo = currentPhoto();
  if (!photo) return;
  const config = sliderConfig(photo.edit);
  const clamped = clampAdjustment(value, config.min, config.max);
  updateCurrentEdit({ [state.activeAdjustment]: clamped });
}

function renderThumbnails() {
  elements.thumbnailRail.replaceChildren();
  state.photos.forEach((photo, index) => {
    const button = document.createElement("button");
    button.type = "button";
    button.className = "thumbnail" + (index === state.activeIndex ? " is-active" : "");
    button.setAttribute("aria-label", "选择第 " + (index + 1) + " 张照片");
    button.setAttribute("aria-pressed", String(index === state.activeIndex));
    const image = document.createElement("img");
    image.src = photo.url;
    image.alt = "";
    image.draggable = false;
    button.append(image);
    button.addEventListener("click", () => selectPhoto(index));
    elements.thumbnailRail.append(button);
  });

  if (state.photos.length < MAX_PHOTOS) {
    const add = document.createElement("button");
    add.type = "button";
    add.className = "thumbnail add-photo";
    add.setAttribute("aria-label", state.photos.length ? "继续添加照片" : "添加照片");
    add.addEventListener("click", () => elements.input.click());
    elements.thumbnailRail.append(add);
  }
}

function renderControls() {
  const photo = currentPhoto();
  const edit = photo ? photo.edit : createNeutralEdit();
  elements.stage.classList.toggle("has-photo", Boolean(photo));
  elements.compareButton.hidden = !photo;
  elements.deleteButton.hidden = !photo;
  elements.photoCount.hidden = !photo;
  elements.photoCount.textContent = photo ? state.activeIndex + 1 + " / " + state.photos.length : "";
  elements.exportButton.disabled = !photo || state.busy;
  elements.applyAll.disabled = state.photos.length < 2;
  elements.resetCurrent.disabled = !photo;
  elements.filters.forEach((button) => {
    const active = edit.filter === button.dataset.filter;
    button.disabled = !photo;
    button.classList.toggle("is-active", active);
    button.setAttribute("aria-pressed", String(active));
  });

  elements.adjustmentTabs.forEach((button) => {
    const id = button.dataset.adjustment;
    const active = id === state.activeAdjustment;
    button.disabled = !photo || (id === "strength" && !edit.filter);
    button.classList.toggle("is-active", active);
    button.setAttribute("aria-pressed", String(active));
  });

  const config = sliderConfig(edit);
  const sliderDisabled = !photo || (state.activeAdjustment === "strength" && !edit.filter);
  elements.slider.setAttribute("aria-label", config.label);
  elements.slider.min = String(config.min);
  elements.slider.max = String(config.max);
  elements.slider.value = String(config.value);
  elements.slider.disabled = sliderDisabled;
  elements.valueInput.min = String(config.min);
  elements.valueInput.max = String(config.max);
  elements.valueInput.value = String(config.value);
  elements.valueInput.disabled = sliderDisabled;
  elements.valueInput.setAttribute("aria-label", config.label + " value");
  elements.valueInput.closest("label").setAttribute("aria-label", config.label + " value");
  const progress = ((config.value - config.min) / (config.max - config.min)) * 100;
  elements.slider.style.setProperty("--range-progress", progress + "%");
  renderThumbnails();
}

async function prepareSource() {
  const photo = currentPhoto();
  const token = ++state.loadToken;
  state.sourceData = null;
  if (!photo) {
    const context = elements.canvas.getContext("2d");
    context?.clearRect(0, 0, elements.canvas.width, elements.canvas.height);
    renderControls();
    return;
  }

  try {
    const image = await loadImage(photo.url);
    if (token !== state.loadToken) return;
    const scale = Math.min(1, PREVIEW_LONG_EDGE / Math.max(image.naturalWidth, image.naturalHeight));
    const width = Math.max(1, Math.round(image.naturalWidth * scale));
    const height = Math.max(1, Math.round(image.naturalHeight * scale));
    elements.canvas.width = width;
    elements.canvas.height = height;
    const context = elements.canvas.getContext("2d", { willReadFrequently: true });
    if (!context) throw new Error("Canvas unavailable");
    context.clearRect(0, 0, width, height);
    context.drawImage(image, 0, 0, width, height);
    state.sourceData = context.getImageData(0, 0, width, height);
    photo.width = image.naturalWidth;
    photo.height = image.naturalHeight;
    setStatus("照片已载入");
    queuePreview();
  } catch {
    if (token === state.loadToken) setStatus("照片载入失败，请换一张照片");
  }
}

function queuePreview() {
  window.cancelAnimationFrame(state.renderFrame);
  state.renderFrame = window.requestAnimationFrame(() => {
    const photo = currentPhoto();
    if (!photo || !state.sourceData) return;
    const context = elements.canvas.getContext("2d");
    if (!context) return;
    const pixels = state.showOriginal
      ? new Uint8ClampedArray(state.sourceData.data)
      : processPixels(state.sourceData, photo.edit, photo.grainSeed);
    context.putImageData(
      new ImageData(pixels, state.sourceData.width, state.sourceData.height),
      0,
      0,
    );
  });
}

function selectPhoto(index) {
  if (index < 0 || index >= state.photos.length) return;
  state.activeIndex = index;
  setShowOriginal(false);
  renderControls();
  void prepareSource();
}

function handleFiles(files) {
  const selected = Array.from(files).filter((file) => file.type.startsWith("image/"));
  if (!selected.length) return;
  const room = Math.max(0, MAX_PHOTOS - state.photos.length);
  const accepted = selected.slice(0, room);
  if (!accepted.length) {
    showToast("最多添加 " + MAX_PHOTOS + " 张照片");
    return;
  }
  const startIndex = state.photos.length;
  const stamp = Date.now();
  accepted.forEach((file, index) => {
    const id = stamp + "-" + index + "-" + file.lastModified;
    state.photos.push({
      id,
      file,
      url: URL.createObjectURL(file),
      filename: file.name,
      width: 0,
      height: 0,
      grainSeed: hashSeed(file.name + ":" + file.size + ":" + file.lastModified + ":" + id),
      edit: createNeutralEdit(),
    });
  });
  state.activeIndex = startIndex;
  setShowOriginal(false);
  setStatus("已添加 " + accepted.length + " 张照片");
  renderControls();
  void prepareSource();
  if (accepted.length < selected.length) showToast("最多保留 " + MAX_PHOTOS + " 张照片");
}

function deleteCurrent() {
  const photo = currentPhoto();
  if (!photo) return;
  URL.revokeObjectURL(photo.url);
  state.photos.splice(state.activeIndex, 1);
  state.activeIndex = Math.max(0, Math.min(state.activeIndex, state.photos.length - 1));
  state.sourceData = null;
  setShowOriginal(false);
  renderControls();
  void prepareSource();
  showToast("已移除当前照片");
}

function applyToAll() {
  const photo = currentPhoto();
  if (!photo || state.photos.length < 2) return;
  state.photos.forEach((item) => {
    item.edit = { ...photo.edit };
  });
  setShowOriginal(false);
  renderControls();
  queuePreview();
  showToast("已应用到全部照片");
}

function resetCurrent() {
  const photo = currentPhoto();
  if (!photo) return;
  photo.edit = {
    ...photo.edit,
    strength: 100,
    brightness: 0,
    color: 0,
    grain: 0,
  };
  setShowOriginal(false);
  renderControls();
  queuePreview();
  showToast("当前照片已重置");
}

function canvasToJpeg(canvas, quality = 0.95) {
  return new Promise((resolve, reject) => {
    canvas.toBlob(
      (blob) => (blob ? resolve(blob) : reject(new Error("无法生成照片文件"))),
      "image/jpeg",
      quality,
    );
  });
}

async function processPhoto(photo) {
  const image = await loadImage(photo.url);
  const canvas = document.createElement("canvas");
  canvas.width = image.naturalWidth;
  canvas.height = image.naturalHeight;
  const context = canvas.getContext("2d", { willReadFrequently: true });
  if (!context) throw new Error("当前浏览器无法处理照片");
  context.drawImage(image, 0, 0);
  const source = context.getImageData(0, 0, canvas.width, canvas.height);
  const pixels = processPixels(source, photo.edit, photo.grainSeed);
  context.putImageData(new ImageData(pixels, canvas.width, canvas.height), 0, 0);
  const blob = await canvasToJpeg(canvas, 0.95);
  canvas.width = 1;
  canvas.height = 1;
  const base = photo.filename.replace(/\.[^.]+$/, "") || "photo";
  return new File([blob], base + "_See.jpg", {
    type: "image/jpeg",
    lastModified: Date.now(),
  });
}

function zipNumber(view, offset, value, bytes) {
  if (bytes === 2) view.setUint16(offset, value, true);
  else view.setUint32(offset, value, true);
}

function crc32(bytes) {
  let crc = 0xffffffff;
  for (const byte of bytes) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit += 1) {
      crc = (crc >>> 1) ^ (crc & 1 ? 0xedb88320 : 0);
    }
  }
  return (crc ^ 0xffffffff) >>> 0;
}

async function createZip(files) {
  const encoder = new TextEncoder();
  const body = [];
  const directory = [];
  let offset = 0;

  for (const file of files) {
    const name = encoder.encode(file.name);
    const bytes = new Uint8Array(await file.arrayBuffer());
    const crc = crc32(bytes);
    const local = new Uint8Array(30 + name.length);
    const localView = new DataView(local.buffer);
    zipNumber(localView, 0, 0x04034b50, 4);
    zipNumber(localView, 4, 20, 2);
    zipNumber(localView, 6, 0x0800, 2);
    zipNumber(localView, 8, 0, 2);
    zipNumber(localView, 14, crc, 4);
    zipNumber(localView, 18, bytes.length, 4);
    zipNumber(localView, 22, bytes.length, 4);
    zipNumber(localView, 26, name.length, 2);
    local.set(name, 30);
    body.push(local, bytes);

    const central = new Uint8Array(46 + name.length);
    const centralView = new DataView(central.buffer);
    zipNumber(centralView, 0, 0x02014b50, 4);
    zipNumber(centralView, 4, 20, 2);
    zipNumber(centralView, 6, 20, 2);
    zipNumber(centralView, 8, 0x0800, 2);
    zipNumber(centralView, 10, 0, 2);
    zipNumber(centralView, 16, crc, 4);
    zipNumber(centralView, 20, bytes.length, 4);
    zipNumber(centralView, 24, bytes.length, 4);
    zipNumber(centralView, 28, name.length, 2);
    zipNumber(centralView, 42, offset, 4);
    central.set(name, 46);
    directory.push(central);
    offset += local.length + bytes.length;
  }

  const directorySize = directory.reduce((sum, bytes) => sum + bytes.length, 0);
  const end = new Uint8Array(22);
  const endView = new DataView(end.buffer);
  zipNumber(endView, 0, 0x06054b50, 4);
  zipNumber(endView, 8, files.length, 2);
  zipNumber(endView, 10, files.length, 2);
  zipNumber(endView, 12, directorySize, 4);
  zipNumber(endView, 16, offset, 4);
  return new Blob([...body, ...directory, end], { type: "application/zip" });
}

function downloadBlob(blob, filename) {
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  anchor.click();
  window.setTimeout(() => URL.revokeObjectURL(url), 1000);
}

async function exportPhotos() {
  if (!state.photos.length || state.busy) return;
  setShowOriginal(false);
  state.busy = true;
  renderControls();

  try {
    const files = [];
    for (let index = 0; index < state.photos.length; index += 1) {
      setStatus("正在处理 " + (index + 1) + " / " + state.photos.length);
      files.push(await processPhoto(state.photos[index]));
      await new Promise((resolve) => window.setTimeout(resolve, 0));
    }

    const shareData = { files, title: "See.", text: "See. 处理的照片" };
    if (navigator.share && navigator.canShare?.(shareData)) {
      await navigator.share(shareData);
      setStatus("照片已分享");
    } else if (files.length === 1) {
      downloadBlob(files[0], files[0].name);
      setStatus("照片已保存");
    } else {
      downloadBlob(await createZip(files), "See_Photos.zip");
      setStatus("照片包已保存");
    }
  } catch (error) {
    if (error?.name === "AbortError") setStatus("已取消分享");
    else setStatus("保存失败，请减少照片数量后重试");
  } finally {
    state.busy = false;
    renderControls();
  }
}

elements.input.addEventListener("change", (event) => {
  handleFiles(event.target.files);
  event.target.value = "";
});
elements.compareButton.addEventListener("click", () => setShowOriginal(!state.showOriginal));
elements.deleteButton.addEventListener("click", deleteCurrent);
elements.applyAll.addEventListener("click", applyToAll);
elements.resetCurrent.addEventListener("click", resetCurrent);
elements.exportButton.addEventListener("click", exportPhotos);

elements.filters.forEach((button) => {
  button.addEventListener("click", () => updateCurrentEdit({ filter: button.dataset.filter }));
});

elements.adjustmentTabs.forEach((button) => {
  button.addEventListener("click", () => {
    const photo = currentPhoto();
    if (!photo || (button.dataset.adjustment === "strength" && !photo.edit.filter)) return;
    state.activeAdjustment = button.dataset.adjustment;
    setShowOriginal(false);
    renderControls();
  });
});

elements.slider.addEventListener("input", (event) => {
  updateAdjustmentValue(Number(event.target.value));
});

elements.valueInput.addEventListener("focus", (event) => event.target.select());

elements.valueInput.addEventListener("input", (event) => {
  const raw = event.target.value;
  if (raw === "" || raw === "-" || raw === "+") return;
  const parsed = Number(raw);
  if (Number.isFinite(parsed)) updateAdjustmentValue(parsed);
});

elements.valueInput.addEventListener("blur", () => {
  const photo = currentPhoto();
  if (!photo) return;
  const config = sliderConfig(photo.edit);
  const parsed = Number(elements.valueInput.value);
  if (elements.valueInput.value === "" || !Number.isFinite(parsed)) {
    elements.valueInput.value = String(config.value);
  } else {
    updateAdjustmentValue(parsed);
  }
});

elements.valueInput.addEventListener("keydown", (event) => {
  if (event.key === "Enter") event.target.blur();
});

document.querySelector(".interaction-surface").addEventListener("contextmenu", (event) => {
  if (event.target.closest("button, canvas, img")) event.preventDefault();
});

document.querySelector(".interaction-surface").addEventListener("dragstart", (event) => {
  if (event.target.closest("img")) event.preventDefault();
});

window.addEventListener("beforeunload", () => {
  state.photos.forEach((photo) => URL.revokeObjectURL(photo.url));
});

if ("serviceWorker" in navigator) {
  window.addEventListener("load", () => {
    navigator.serviceWorker.register("./sw.js?v=29", { scope: "./" }).catch(() => {});
  });
}

renderControls();
