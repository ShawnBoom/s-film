"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { ChangeEvent, CSSProperties, KeyboardEvent } from "react";

const FILTERS = [
  { id: "classic", name: "FUJI Classic Chrome", note: "克制 · 青灰 · 安静", defaultGrain: 8 },
  { id: "gold", name: "KODAK Gold 200", note: "暖阳 · 鲜活 · 怀旧", defaultGrain: 11 },
  { id: "youth", name: "FUJI Youth Blue", note: "蓝天 · 街头 · 自由", defaultGrain: 7 },
] as const;

type FilterId = (typeof FILTERS)[number]["id"];
type PhotoItem = { id: string; file: File; url: string };
type Adjustments = { strength: number; brightness: number; color: number; grain: number };
type AdjustmentId = keyof Adjustments;

const MAX_PHOTOS = 20;
const PREVIEW_LONG_EDGE = 1400;
const EXPORT_LONG_EDGE = 5000;

function clamp(value: number) {
  return Math.max(0, Math.min(255, value));
}

function saturation(r: number, g: number, b: number, amount: number) {
  const lightness = r * 0.299 + g * 0.587 + b * 0.114;
  return [
    lightness + (r - lightness) * amount,
    lightness + (g - lightness) * amount,
    lightness + (b - lightness) * amount,
  ];
}

function processPixels(source: ImageData, filter: FilterId, settings: Adjustments) {
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

function loadImage(url: string) {
  return new Promise<HTMLImageElement>((resolve, reject) => {
    const image = new Image();
    image.onload = () => resolve(image);
    image.onerror = () => reject(new Error("无法读取这张照片"));
    image.src = url;
  });
}

function canvasBlob(canvas: HTMLCanvasElement) {
  return new Promise<Blob>((resolve, reject) => {
    canvas.toBlob(
      (blob) => (blob ? resolve(blob) : reject(new Error("照片导出失败"))),
      "image/jpeg",
      0.92,
    );
  });
}

function rangeStyle(progress: number) {
  return { "--range-progress": `${progress}%` } as CSSProperties;
}

export default function Home() {
  const [photos, setPhotos] = useState<PhotoItem[]>([]);
  const [activeIndex, setActiveIndex] = useState(0);
  const [activeFilter, setActiveFilter] = useState<FilterId>("classic");
  const [strength, setStrength] = useState(72);
  const [brightness, setBrightness] = useState(0);
  const [color, setColor] = useState(0);
  const [grain, setGrain] = useState(8);
  const [activeAdjustment, setActiveAdjustment] = useState<AdjustmentId>("strength");
  const [sourceVersion, setSourceVersion] = useState(0);
  const [comparing, setComparing] = useState(false);
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState("准备好了");

  const canvasRef = useRef<HTMLCanvasElement>(null);
  const sourceDataRef = useRef<ImageData | null>(null);
  const objectUrlsRef = useRef<string[]>([]);
  const sourceUrl = photos[activeIndex]?.url ?? "/sample-neutral.png";
  const selectedName = FILTERS.find((item) => item.id === activeFilter)?.name;

  useEffect(() => {
    return () => objectUrlsRef.current.forEach((url) => URL.revokeObjectURL(url));
  }, []);

  useEffect(() => {
    let cancelled = false;
    loadImage(sourceUrl)
      .then((image) => {
        if (cancelled || !canvasRef.current) return;
        const canvas = canvasRef.current;
        const scale = Math.min(1, PREVIEW_LONG_EDGE / Math.max(image.naturalWidth, image.naturalHeight));
        canvas.width = Math.max(1, Math.round(image.naturalWidth * scale));
        canvas.height = Math.max(1, Math.round(image.naturalHeight * scale));
        const context = canvas.getContext("2d", { willReadFrequently: true });
        if (!context) return;
        context.imageSmoothingEnabled = true;
        context.imageSmoothingQuality = "high";
        context.drawImage(image, 0, 0, canvas.width, canvas.height);
        sourceDataRef.current = context.getImageData(0, 0, canvas.width, canvas.height);
        setSourceVersion((version) => version + 1);
        setStatus(photos.length ? `已选择 ${photos.length} 张照片` : "示例预览 · 请选择你的照片");
      })
      .catch(() => setStatus("这张照片暂时无法读取，请换一张试试"));
    return () => {
      cancelled = true;
    };
  }, [sourceUrl, photos.length]);

  useEffect(() => {
    const canvas = canvasRef.current;
    const source = sourceDataRef.current;
    if (!canvas || !source) return;
    const context = canvas.getContext("2d", { willReadFrequently: true });
    if (!context) return;
    const frame = context.createImageData(source.width, source.height);
    frame.data.set(
      comparing
        ? source.data
        : processPixels(source, activeFilter, { strength, brightness, color, grain }),
    );
    context.putImageData(frame, 0, 0);
  }, [activeFilter, brightness, color, comparing, grain, sourceVersion, strength]);

  const handleFiles = (event: ChangeEvent<HTMLInputElement>) => {
    const picked = Array.from(event.target.files ?? []).filter((file) => file.type.startsWith("image/"));
    const room = Math.max(0, MAX_PHOTOS - photos.length);
    const accepted = picked.slice(0, room).map((file) => {
      const url = URL.createObjectURL(file);
      objectUrlsRef.current.push(url);
      return { id: `${file.name}-${file.lastModified}-${crypto.randomUUID()}`, file, url };
    });

    if (accepted.length) {
      const hadPhotos = photos.length > 0;
      setPhotos((current) => [...current, ...accepted]);
      if (!hadPhotos) setActiveIndex(0);
      setStatus(
        picked.length > accepted.length
          ? `已加入 ${accepted.length} 张；为保证手机流畅，最多处理 ${MAX_PHOTOS} 张`
          : `已选择 ${photos.length + accepted.length} 张照片`,
      );
    }
    event.target.value = "";
  };

  const removeActivePhoto = () => {
    if (!photos.length) return;
    const target = photos[activeIndex];
    URL.revokeObjectURL(target.url);
    objectUrlsRef.current = objectUrlsRef.current.filter((url) => url !== target.url);
    const next = photos.filter((_, index) => index !== activeIndex);
    setPhotos(next);
    setActiveIndex(Math.max(0, Math.min(activeIndex, next.length - 1)));
    setStatus(next.length ? `还剩 ${next.length} 张照片` : "示例预览 · 请选择你的照片");
  };

  const chooseFilter = (id: FilterId) => {
    setActiveFilter(id);
    setGrain(FILTERS.find((item) => item.id === id)?.defaultGrain ?? 8);
  };

  const resetAdjustments = () => {
    setStrength(72);
    setBrightness(0);
    setColor(0);
    setGrain(FILTERS.find((item) => item.id === activeFilter)?.defaultGrain ?? 8);
  };

  const processPhoto = useCallback(async (photo: PhotoItem) => {
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
    frame.data.set(processPixels(source, activeFilter, { strength, brightness, color, grain }));
    context.putImageData(frame, 0, 0);
    const blob = await canvasBlob(canvas);
    const baseName = photo.file.name.replace(/\.[^.]+$/, "") || "photo";
    return new File([blob], `${baseName}-s-film.jpg`, { type: "image/jpeg" });
  }, [activeFilter, brightness, color, grain, strength]);

  const downloadFiles = async (files: File[]) => {
    for (const file of files) {
      const url = URL.createObjectURL(file);
      const link = document.createElement("a");
      link.href = url;
      link.download = file.name;
      document.body.appendChild(link);
      link.click();
      link.remove();
      await new Promise((resolve) => window.setTimeout(resolve, 160));
      URL.revokeObjectURL(url);
    }
  };

  const exportPhotos = async () => {
    if (!photos.length) {
      setStatus("请先选择一张或多张手机照片");
      return;
    }

    setBusy(true);
    try {
      const files: File[] = [];
      for (let index = 0; index < photos.length; index += 1) {
        setStatus(`正在处理 ${index + 1} / ${photos.length}…`);
        files.push(await processPhoto(photos[index]));
      }

      const shareData = { files, title: "S Film", text: `使用 ${selectedName} 处理` };
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
      setBusy(false);
    }
  };

  const compareKeyDown = (event: KeyboardEvent<HTMLButtonElement>) => {
    if (event.key === " " || event.key === "Enter") setComparing(true);
  };

  const adjustmentControls = {
    strength: {
      label: "浓度",
      value: strength,
      min: 0,
      max: 100,
      progress: strength,
      setValue: setStrength,
    },
    brightness: {
      label: "亮度",
      value: brightness,
      min: -25,
      max: 25,
      progress: (brightness + 25) * 2,
      setValue: setBrightness,
    },
    color: {
      label: "色彩",
      value: color,
      min: -30,
      max: 30,
      progress: ((color + 30) / 60) * 100,
      setValue: setColor,
    },
    grain: {
      label: "颗粒",
      value: grain,
      min: 0,
      max: 30,
      progress: (grain / 30) * 100,
      setValue: setGrain,
    },
  } satisfies Record<AdjustmentId, {
    label: string;
    value: number;
    min: number;
    max: number;
    progress: number;
    setValue: (value: number) => void;
  }>;
  const currentAdjustment = adjustmentControls[activeAdjustment];
  const displayAdjustmentValue = ["brightness", "color"].includes(activeAdjustment) && currentAdjustment.value > 0
    ? `+${currentAdjustment.value}`
    : currentAdjustment.value;

  return (
    <main className="app-shell">
      <header className="topbar">
        <div className="brand">S FILM</div>
        <div className="privacy-pill"><span /> 照片仅在本机处理</div>
      </header>

      <section className="workspace">
        <div className="photo-stage">
          <div className="photo-frame">
            <canvas ref={canvasRef} aria-label="滤镜实时预览" />
            <div className="film-mark">{selectedName}</div>
            <button
              type="button"
              className="compare-button"
              onPointerDown={() => setComparing(true)}
              onPointerUp={() => setComparing(false)}
              onPointerCancel={() => setComparing(false)}
              onPointerLeave={() => setComparing(false)}
              onKeyDown={compareKeyDown}
              onKeyUp={() => setComparing(false)}
            >
              按住看原图
            </button>
            {photos.length > 0 && <div className="photo-count">{activeIndex + 1} / {photos.length}</div>}
          </div>
        </div>

        <div className="controls-panel">
          {photos.length > 0 && (
            <div className="thumbnail-row" aria-label="已选照片">
              {photos.map((photo, index) => (
                <button
                  type="button"
                  key={photo.id}
                  className={index === activeIndex ? "active" : ""}
                  onClick={() => setActiveIndex(index)}
                  aria-label={`查看第 ${index + 1} 张照片`}
                >
                  {/* Blob previews cannot use the framework image optimizer. */}
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src={photo.url} alt="" />
                </button>
              ))}
            </div>
          )}

          <div className="photo-actions">
            <label className="upload-button">
              <span className="plus">＋</span>
              {photos.length ? "继续添加照片" : "选择手机照片"}
              <input type="file" accept="image/*" multiple onChange={handleFiles} />
            </label>
            {photos.length > 0 && (
              <button type="button" className="remove-button" onClick={removeActivePhoto}>移除当前</button>
            )}
          </div>
          <p className="upload-hint">可一次选择多张 · 原图不会被修改 · 最多 {MAX_PHOTOS} 张</p>

          <div className="section-heading filter-heading">
            <h2>滤镜</h2>
            <span>选择一种感觉</span>
          </div>

          <div className="filter-list">
            {FILTERS.map((filter, index) => (
              <button
                key={filter.id}
                type="button"
                className={`filter-card ${activeFilter === filter.id ? "active" : ""}`}
                onClick={() => chooseFilter(filter.id)}
              >
                <span className="filter-number">0{index + 1}</span>
                <strong>{filter.name}</strong>
              </button>
            ))}
          </div>

          <div className="adjustments-heading">
            <h2>微调</h2>
            <button type="button" onClick={resetAdjustments}>还原</button>
          </div>

          <div className="adjustment-tabs" role="tablist" aria-label="微调项目">
            {(Object.keys(adjustmentControls) as AdjustmentId[]).map((id) => (
              <button
                key={id}
                type="button"
                role="tab"
                aria-selected={activeAdjustment === id}
                className={activeAdjustment === id ? "active" : ""}
                onClick={() => setActiveAdjustment(id)}
              >
                {adjustmentControls[id].label}
              </button>
            ))}
          </div>

          <div className="adjustment-control">
            <span className="control-label">
              <span>{currentAdjustment.label}</span>
              <strong>{displayAdjustmentValue}</strong>
            </span>
            <input
              aria-label={currentAdjustment.label}
              type="range"
              min={currentAdjustment.min}
              max={currentAdjustment.max}
              value={currentAdjustment.value}
              onChange={(event) => currentAdjustment.setValue(Number(event.target.value))}
              style={rangeStyle(currentAdjustment.progress)}
            />
          </div>

          <button className="primary-button" type="button" onClick={exportPhotos} disabled={busy}>
            <span>{busy ? "正在处理…" : photos.length > 1 ? `保存 / 分享 ${photos.length} 张` : "保存 / 分享照片"}</span>
            <span aria-hidden="true">→</span>
          </button>
          <p className="status-line" role="status">{status}</p>
          <p className="local-note">所有滤镜计算都在当前设备完成，照片不会发送到服务器。</p>
        </div>
      </section>
    </main>
  );
}
