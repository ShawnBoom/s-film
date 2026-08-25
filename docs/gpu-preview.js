import { getFilterLut } from "./image-engine.js?v=45";

const VERTEX_SHADER = `#version 300 es
in vec2 aPosition;
out vec2 vUv;

void main() {
  gl_Position = vec4(aPosition, 0.0, 1.0);
  vUv = vec2(aPosition.x * 0.5 + 0.5, 0.5 - aPosition.y * 0.5);
}
`;

const FRAGMENT_SHADER = `#version 300 es
precision highp float;
precision highp int;
precision highp sampler3D;

in vec2 vUv;
out vec4 outColor;

uniform sampler2D uSource;
uniform sampler3D uLut;
uniform bool uHasLut;
uniform bool uShowOriginal;
uniform int uLutSize;
uniform float uStrength;
uniform float uBrightness;
uniform float uColor;
uniform float uGrain;
uniform uint uSeed;
uniform ivec2 uImageSize;

float clamp01(float value) {
  return clamp(value, 0.0, 1.0);
}

vec3 srgbToLinear(vec3 value) {
  vec3 low = value / 12.92;
  vec3 high = pow((value + 0.055) / 1.055, vec3(2.4));
  return mix(high, low, lessThanEqual(value, vec3(0.04045)));
}

vec3 linearToSrgb(vec3 value) {
  vec3 channel = clamp(value, 0.0, 1.0);
  vec3 low = channel * 12.92;
  vec3 high = 1.055 * pow(channel, vec3(1.0 / 2.4)) - 0.055;
  return mix(high, low, lessThanEqual(channel, vec3(0.0031308)));
}

vec3 applyLut(vec3 rgb) {
  float scale = float(uLutSize - 1);
  vec3 scaled = clamp(rgb, 0.0, 1.0) * scale;
  ivec3 p0 = ivec3(floor(scaled));
  ivec3 p1 = min(p0 + ivec3(1), ivec3(uLutSize - 1));
  vec3 t = fract(scaled);

  vec3 c000 = texelFetch(uLut, ivec3(p0.x, p0.y, p0.z), 0).rgb;
  vec3 c100 = texelFetch(uLut, ivec3(p1.x, p0.y, p0.z), 0).rgb;
  vec3 c010 = texelFetch(uLut, ivec3(p0.x, p1.y, p0.z), 0).rgb;
  vec3 c110 = texelFetch(uLut, ivec3(p1.x, p1.y, p0.z), 0).rgb;
  vec3 c001 = texelFetch(uLut, ivec3(p0.x, p0.y, p1.z), 0).rgb;
  vec3 c101 = texelFetch(uLut, ivec3(p1.x, p0.y, p1.z), 0).rgb;
  vec3 c011 = texelFetch(uLut, ivec3(p0.x, p1.y, p1.z), 0).rgb;
  vec3 c111 = texelFetch(uLut, ivec3(p1.x, p1.y, p1.z), 0).rgb;

  vec3 c00 = mix(c000, c100, t.x);
  vec3 c10 = mix(c010, c110, t.x);
  vec3 c01 = mix(c001, c101, t.x);
  vec3 c11 = mix(c011, c111, t.x);
  return clamp(mix(mix(c00, c10, t.y), mix(c01, c11, t.y), t.z), 0.0, 1.0);
}

vec3 applyExposure(vec3 rgb, float brightness) {
  if (brightness == 0.0) return rgb;

  float normalized = clamp(brightness / 100.0, -1.0, 1.0);
  float ev = sign(normalized) * 2.0 * pow(abs(normalized), 1.35);
  float gain = exp2(ev);
  float luminance = max(0.0, dot(rgb, vec3(0.2126, 0.7152, 0.0722)));
  float target = luminance * gain;

  if (ev > 0.0 && target > 0.68) {
    float over = (target - 0.68) / 0.32;
    target = 0.68 + 0.32 * (1.0 - exp(-2.0 * over));
  } else if (ev < 0.0) {
    target += abs(ev) * 0.006 * sqrt(target) * (1.0 - target);
  }

  float ratio = luminance > 0.0000001 ? target / luminance : gain;
  vec3 result = max(vec3(0.0), rgb * ratio);

  if (ev > 0.0) {
    float maximum = max(result.r, max(result.g, result.b));
    if (maximum > 0.82) {
      float over = (maximum - 0.82) / 0.18;
      float compressed = 0.82 + 0.18 * (1.0 - exp(-2.0 * over));
      result *= compressed / maximum;
    }
  }

  return result;
}

vec3 linearRgbToOklab(vec3 rgb) {
  float l = dot(rgb, vec3(0.4122214708, 0.5363325363, 0.0514459929));
  float m = dot(rgb, vec3(0.2119034982, 0.6806995451, 0.1073969566));
  float s = dot(rgb, vec3(0.0883024619, 0.2817188376, 0.6299787005));
  vec3 roots = pow(max(vec3(0.0), vec3(l, m, s)), vec3(1.0 / 3.0));
  return vec3(
    dot(roots, vec3(0.2104542553, 0.7936177850, -0.0040720468)),
    dot(roots, vec3(1.9779984951, -2.4285922050, 0.4505937099)),
    dot(roots, vec3(0.0259040371, 0.7827717662, -0.8086757660))
  );
}

vec3 oklabToLinearRgb(vec3 lab) {
  float lRoot = lab.x + 0.3963377774 * lab.y + 0.2158037573 * lab.z;
  float mRoot = lab.x - 0.1055613458 * lab.y - 0.0638541728 * lab.z;
  float sRoot = lab.x - 0.0894841775 * lab.y - 1.2914855480 * lab.z;
  vec3 roots = vec3(lRoot, mRoot, sRoot);
  vec3 values = roots * roots * roots;
  return vec3(
    dot(values, vec3(4.0767416621, -3.3077115913, 0.2309699292)),
    dot(values, vec3(-1.2684380046, 2.6097574011, -0.3413193965)),
    dot(values, vec3(-0.0041960863, -0.7034186147, 1.7076147010))
  );
}

bool inGamut(vec3 rgb) {
  return all(greaterThanEqual(rgb, vec3(0.0))) && all(lessThanEqual(rgb, vec3(1.0)));
}

vec3 gamutMapOklab(vec3 lab) {
  vec3 rgb = oklabToLinearRgb(lab);
  if (inGamut(rgb)) return rgb;

  float low = 0.0;
  float high = 1.0;
  for (int pass = 0; pass < 5; pass += 1) {
    float scale = (low + high) * 0.5;
    rgb = oklabToLinearRgb(vec3(lab.x, lab.yz * scale));
    if (inGamut(rgb)) low = scale;
    else high = scale;
  }
  return clamp(oklabToLinearRgb(vec3(lab.x, lab.yz * low)), 0.0, 1.0);
}

vec3 applyColor(vec3 rgb, float color) {
  if (color == 0.0) return rgb;

  vec3 lab = linearRgbToOklab(rgb);
  float chroma = length(lab.yz);
  if (chroma < 0.0000001) return rgb;

  float amount = clamp(color / 100.0, -1.0, 1.0);
  float factor;
  if (amount < 0.0) {
    factor = 1.0 + amount;
  } else {
    float chromaLevel = min(1.0, chroma / 0.3);
    float hue = mod(degrees(atan(lab.z, lab.y)) + 360.0, 360.0);
    float rawDistance = abs(hue - 50.0);
    float skinDistance = min(rawDistance, 360.0 - rawDistance);
    float skinProtection = max(0.0, 1.0 - skinDistance / 42.0)
      * max(0.0, 1.0 - abs(lab.x - 0.65) / 0.38);
    float vibranceResponse = 0.82 - 0.58 * chromaLevel;
    factor = 1.0 + amount * vibranceResponse * (1.0 - skinProtection * 0.38);
  }

  return gamutMapOklab(vec3(lab.x, lab.yz * factor));
}

float hash2d(ivec2 point, uint seed) {
  uint value = uint(point.x) * 374761393u ^ uint(point.y) * 668265263u ^ seed;
  value = (value ^ (value >> 13u)) * 1274126177u;
  value ^= value >> 16u;
  return (float(value) / 4294967295.0) * 2.0 - 1.0;
}

float smoothValue(float value) {
  return value * value * (3.0 - 2.0 * value);
}

float valueNoise(vec2 point, float scale, uint seed) {
  vec2 scaled = point / scale;
  ivec2 p0 = ivec2(floor(scaled));
  vec2 t = vec2(smoothValue(fract(scaled.x)), smoothValue(fract(scaled.y)));
  float n00 = hash2d(p0, seed);
  float n10 = hash2d(p0 + ivec2(1, 0), seed);
  float n01 = hash2d(p0 + ivec2(0, 1), seed);
  float n11 = hash2d(p0 + ivec2(1, 1), seed);
  return mix(mix(n00, n10, t.x), mix(n01, n11, t.x), t.y);
}

vec3 applyGrain(vec3 rgb, vec2 point, float grain) {
  if (grain == 0.0) return rgb;

  float amount = clamp(grain / 100.0, 0.0, 1.0);
  float longEdge = float(max(uImageSize.x, uImageSize.y));
  float baseScale = max(1.0, (longEdge / 1100.0) * (0.85 + amount * 0.5));
  float fine = valueNoise(point, baseScale, uSeed);
  float medium = valueNoise(point, baseScale * 2.45, uSeed ^ 0x045d9f3bu);
  float coarse = valueNoise(point, baseScale * 6.2, uSeed ^ 0x27d4eb2du);
  float cluster = valueNoise(point, baseScale * 13.0, uSeed ^ 0x165667b1u);
  float textureValue = (fine * 0.56 + medium * 0.3 + coarse * 0.14) * (0.84 + cluster * 0.16);
  float luminance = clamp01(dot(rgb, vec3(0.2126, 0.7152, 0.0722)));
  float visibility = 0.16 + 0.84 * pow(sin(3.141592653589793 * luminance), 0.62);
  float amplitude = 0.062 * pow(amount, 1.12) * visibility;
  float luminanceGrain = textureValue * amplitude;
  float chromaAmount = amplitude * 0.13;
  float chromaA = (fine * 0.65 + medium * 0.35) * chromaAmount;
  float chromaB = (medium * 0.55 + coarse * 0.45) * chromaAmount;

  return rgb + vec3(
    luminanceGrain + chromaA,
    luminanceGrain - chromaA * 0.45 + chromaB * 0.2,
    luminanceGrain - chromaB * 0.7
  );
}

void main() {
  vec4 source = texture(uSource, vUv);
  if (uShowOriginal) {
    outColor = source;
    return;
  }

  vec3 rgb = srgbToLinear(source.rgb);
  if (uHasLut && uStrength > 0.0) {
    vec3 preset = srgbToLinear(applyLut(source.rgb));
    rgb = mix(rgb, preset, clamp(uStrength / 100.0, 0.0, 1.0));
  }

  rgb = applyExposure(rgb, uBrightness);
  rgb = applyColor(rgb, uColor);
  vec2 pixel = floor(vUv * vec2(uImageSize));
  rgb = applyGrain(rgb, pixel, uGrain);
  outColor = vec4(linearToSrgb(rgb), source.a);
}
`;

function compileShader(gl, type, source) {
  const shader = gl.createShader(type);
  if (!shader) throw new Error("Unable to create preview shader");
  gl.shaderSource(shader, source);
  gl.compileShader(shader);
  if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
    const message = gl.getShaderInfoLog(shader) || "Preview shader compilation failed";
    gl.deleteShader(shader);
    throw new Error(message);
  }
  return shader;
}

function createProgram(gl) {
  const vertex = compileShader(gl, gl.VERTEX_SHADER, VERTEX_SHADER);
  const fragment = compileShader(gl, gl.FRAGMENT_SHADER, FRAGMENT_SHADER);
  const program = gl.createProgram();
  if (!program) throw new Error("Unable to create preview program");
  gl.attachShader(program, vertex);
  gl.attachShader(program, fragment);
  gl.linkProgram(program);
  gl.deleteShader(vertex);
  gl.deleteShader(fragment);
  if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
    const message = gl.getProgramInfoLog(program) || "Preview shader linking failed";
    gl.deleteProgram(program);
    throw new Error(message);
  }
  return program;
}

function location(gl, program, name) {
  const value = gl.getUniformLocation(program, name);
  if (value === null) throw new Error(`Missing preview uniform: ${name}`);
  return value;
}

class GpuPreviewRenderer {
  constructor(canvas, contextOptions = {}) {
    const gl = canvas.getContext("webgl2", {
      alpha: true,
      antialias: false,
      depth: false,
      powerPreference: "high-performance",
      preserveDrawingBuffer: false,
      stencil: false,
      ...contextOptions,
    });
    if (!gl) throw new Error("WebGL 2 is unavailable");

    this.canvas = canvas;
    this.gl = gl;
    this.program = createProgram(gl);
    this.sourceTexture = gl.createTexture();
    this.lutTexture = gl.createTexture();
    this.vertexArray = gl.createVertexArray();
    this.positionBuffer = gl.createBuffer();
    this.filter = undefined;
    this.hasSource = false;

    if (!this.sourceTexture || !this.lutTexture || !this.vertexArray || !this.positionBuffer) {
      throw new Error("Unable to allocate preview GPU resources");
    }

    gl.useProgram(this.program);
    gl.bindVertexArray(this.vertexArray);
    gl.bindBuffer(gl.ARRAY_BUFFER, this.positionBuffer);
    gl.bufferData(
      gl.ARRAY_BUFFER,
      new Float32Array([-1, -1, 1, -1, -1, 1, -1, 1, 1, -1, 1, 1]),
      gl.STATIC_DRAW,
    );
    const position = gl.getAttribLocation(this.program, "aPosition");
    gl.enableVertexAttribArray(position);
    gl.vertexAttribPointer(position, 2, gl.FLOAT, false, 0, 0);

    this.uniforms = {
      source: location(gl, this.program, "uSource"),
      lut: location(gl, this.program, "uLut"),
      hasLut: location(gl, this.program, "uHasLut"),
      showOriginal: location(gl, this.program, "uShowOriginal"),
      lutSize: location(gl, this.program, "uLutSize"),
      strength: location(gl, this.program, "uStrength"),
      brightness: location(gl, this.program, "uBrightness"),
      color: location(gl, this.program, "uColor"),
      grain: location(gl, this.program, "uGrain"),
      seed: location(gl, this.program, "uSeed"),
      imageSize: location(gl, this.program, "uImageSize"),
    };

    gl.uniform1i(this.uniforms.source, 0);
    gl.uniform1i(this.uniforms.lut, 1);
    gl.activeTexture(gl.TEXTURE1);
    gl.bindTexture(gl.TEXTURE_3D, this.lutTexture);
    gl.texParameteri(gl.TEXTURE_3D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
    gl.texParameteri(gl.TEXTURE_3D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
    gl.texParameteri(gl.TEXTURE_3D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_3D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_3D, gl.TEXTURE_WRAP_R, gl.CLAMP_TO_EDGE);
    gl.texImage3D(
      gl.TEXTURE_3D,
      0,
      gl.RGBA32F,
      1,
      1,
      1,
      0,
      gl.RGBA,
      gl.FLOAT,
      new Float32Array([0, 0, 0, 1]),
    );
    gl.uniform1i(this.uniforms.lutSize, 1);
    gl.disable(gl.BLEND);
    gl.disable(gl.DEPTH_TEST);
  }

  setSource(source) {
    const { gl } = this;
    this.canvas.width = source.width;
    this.canvas.height = source.height;
    gl.viewport(0, 0, source.width, source.height);
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, this.sourceTexture);
    gl.pixelStorei(gl.UNPACK_ALIGNMENT, 1);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    gl.texImage2D(
      gl.TEXTURE_2D,
      0,
      gl.RGBA,
      source.width,
      source.height,
      0,
      gl.RGBA,
      gl.UNSIGNED_BYTE,
      source.data,
    );
    this.hasSource = true;
  }

  setFilter(filter) {
    if (filter === this.filter) return Boolean(filter);
    this.filter = filter;
    const lut = getFilterLut(filter);
    if (!lut) return false;

    const rgba = new Float32Array(lut.size ** 3 * 4);
    for (let sourceIndex = 0, targetIndex = 0; sourceIndex < lut.data.length; sourceIndex += 3) {
      rgba[targetIndex] = lut.data[sourceIndex];
      rgba[targetIndex + 1] = lut.data[sourceIndex + 1];
      rgba[targetIndex + 2] = lut.data[sourceIndex + 2];
      rgba[targetIndex + 3] = 1;
      targetIndex += 4;
    }

    const { gl } = this;
    gl.activeTexture(gl.TEXTURE1);
    gl.bindTexture(gl.TEXTURE_3D, this.lutTexture);
    gl.pixelStorei(gl.UNPACK_ALIGNMENT, 1);
    gl.texParameteri(gl.TEXTURE_3D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
    gl.texParameteri(gl.TEXTURE_3D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
    gl.texParameteri(gl.TEXTURE_3D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_3D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_3D, gl.TEXTURE_WRAP_R, gl.CLAMP_TO_EDGE);
    gl.texImage3D(
      gl.TEXTURE_3D,
      0,
      gl.RGBA32F,
      lut.size,
      lut.size,
      lut.size,
      0,
      gl.RGBA,
      gl.FLOAT,
      rgba,
    );
    gl.uniform1i(this.uniforms.lutSize, lut.size);
    return true;
  }

  render(edit, seed, showOriginal = false) {
    if (!this.hasSource) return;
    const { gl } = this;
    gl.useProgram(this.program);
    gl.bindVertexArray(this.vertexArray);
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, this.sourceTexture);
    gl.activeTexture(gl.TEXTURE1);
    gl.bindTexture(gl.TEXTURE_3D, this.lutTexture);

    const hasLut = this.setFilter(edit.filter ?? null);
    gl.uniform1i(this.uniforms.hasLut, hasLut ? 1 : 0);
    gl.uniform1i(this.uniforms.showOriginal, showOriginal ? 1 : 0);
    gl.uniform1f(this.uniforms.strength, edit.strength ?? 100);
    gl.uniform1f(this.uniforms.brightness, edit.brightness ?? 0);
    gl.uniform1f(this.uniforms.color, edit.color ?? 0);
    gl.uniform1f(this.uniforms.grain, edit.grain ?? 0);
    gl.uniform1ui(this.uniforms.seed, seed >>> 0);
    gl.uniform2i(this.uniforms.imageSize, this.canvas.width, this.canvas.height);
    gl.drawArrays(gl.TRIANGLES, 0, 6);
  }

  destroy() {
    const { gl } = this;
    gl.deleteTexture(this.sourceTexture);
    gl.deleteTexture(this.lutTexture);
    gl.deleteBuffer(this.positionBuffer);
    gl.deleteVertexArray(this.vertexArray);
    gl.deleteProgram(this.program);
  }
}

function flipRowsInPlace(pixels, width, height) {
  const rowLength = width * 4;
  const temporary = new Uint8Array(rowLength);
  for (let top = 0, bottom = height - 1; top < bottom; top += 1, bottom -= 1) {
    const topOffset = top * rowLength;
    const bottomOffset = bottom * rowLength;
    temporary.set(pixels.subarray(topOffset, topOffset + rowLength));
    pixels.copyWithin(topOffset, bottomOffset, bottomOffset + rowLength);
    pixels.set(temporary, bottomOffset);
  }
}

async function waitForGpu(gl) {
  const sync = gl.fenceSync(gl.SYNC_GPU_COMMANDS_COMPLETE, 0);
  if (!sync) {
    const startedAt = performance.now();
    gl.finish();
    return performance.now() - startedAt;
  }

  const startedAt = performance.now();
  gl.flush();
  try {
    while (true) {
      if (gl.isContextLost()) throw new Error("GPU export context was lost");
      const status = gl.clientWaitSync(sync, 0, 0);
      if (status === gl.ALREADY_SIGNALED || status === gl.CONDITION_SATISFIED) {
        return performance.now() - startedAt;
      }
      if (status === gl.WAIT_FAILED) throw new Error("GPU export synchronization failed");
      if (performance.now() - startedAt > 30000) {
        throw new Error("GPU export synchronization timed out");
      }
      await new Promise((resolve) => setTimeout(resolve, 0));
    }
  } finally {
    gl.deleteSync(sync);
  }
}

class GpuExportBenchmarkRenderer extends GpuPreviewRenderer {
  constructor(canvas) {
    super(canvas, { premultipliedAlpha: false });
  }

  assertNoError(stage) {
    const error = this.gl.getError();
    if (error !== this.gl.NO_ERROR) throw new Error(`${stage} WebGL error: 0x${error.toString(16)}`);
  }

  capabilities(width, height) {
    const { gl } = this;
    const maxViewport = gl.getParameter(gl.MAX_VIEWPORT_DIMS);
    const limits = {
      maxTextureSize: gl.getParameter(gl.MAX_TEXTURE_SIZE),
      maxRenderbufferSize: gl.getParameter(gl.MAX_RENDERBUFFER_SIZE),
      maxViewportWidth: maxViewport[0],
      maxViewportHeight: maxViewport[1],
    };
    return {
      ...limits,
      fullSizeRenderPossible: width <= limits.maxTextureSize
        && height <= limits.maxTextureSize
        && width <= limits.maxRenderbufferSize
        && height <= limits.maxRenderbufferSize
        && width <= limits.maxViewportWidth
        && height <= limits.maxViewportHeight,
    };
  }

  verifyFilters(filters) {
    return filters.map((filter) => {
      const available = this.setFilter(filter);
      this.assertNoError(`LUT ${filter}`);
      return { filter, available };
    });
  }

  async renderPixels(source, edit, seed) {
    const totalStartedAt = performance.now();

    const uploadStartedAt = performance.now();
    this.setSource(source);
    this.assertNoError("Source upload");
    const upload = performance.now() - uploadStartedAt;

    const lutStartedAt = performance.now();
    const hasLut = this.setFilter(edit.filter ?? null);
    this.assertNoError("LUT preparation");
    const lut = performance.now() - lutStartedAt;
    if (edit.filter && !hasLut) throw new Error(`GPU export LUT is unavailable: ${edit.filter}`);

    const submissionStartedAt = performance.now();
    this.render(edit, seed, false);
    this.assertNoError("Draw submission");
    const submission = performance.now() - submissionStartedAt;
    const completion = await waitForGpu(this.gl);

    const readPixelsStartedAt = performance.now();
    const bytes = new Uint8ClampedArray(source.width * source.height * 4);
    this.gl.readPixels(
      0,
      0,
      source.width,
      source.height,
      this.gl.RGBA,
      this.gl.UNSIGNED_BYTE,
      bytes,
    );
    this.assertNoError("Pixel readback");
    const readPixels = performance.now() - readPixelsStartedAt;

    const rowFlipStartedAt = performance.now();
    flipRowsInPlace(bytes, source.width, source.height);
    const rowFlip = performance.now() - rowFlipStartedAt;

    return {
      pixels: bytes,
      timings: {
        upload,
        lut,
        submission,
        completion,
        processing: submission + completion,
        readPixels,
        rowFlip,
        readback: readPixels + rowFlip,
        totalPixelsReady: performance.now() - totalStartedAt,
      },
    };
  }
}

export function createGpuPreviewRenderer(canvas, options = {}) {
  const onError = typeof options.onError === "function" ? options.onError : null;
  try {
    const probe = document.createElement("canvas");
    const probeRenderer = new GpuPreviewRenderer(probe);
    probeRenderer.destroy();
  } catch (error) {
    onError?.({ stage: "probe", error });
    return null;
  }

  try {
    return new GpuPreviewRenderer(canvas);
  } catch (error) {
    onError?.({ stage: "renderer", error });
    return null;
  }
}

export function createGpuExportBenchmarkRenderer(options = {}) {
  const onError = typeof options.onError === "function" ? options.onError : null;
  try {
    const canvas = document.createElement("canvas");
    return new GpuExportBenchmarkRenderer(canvas);
  } catch (error) {
    onError?.(error);
    return null;
  }
}
