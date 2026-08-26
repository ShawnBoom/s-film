import {
  getColorParameters,
  getFilterLut,
  getGrainParameters,
  getLightParameters,
} from "./image-engine.js?v=54";

const VERTEX_SHADER = `#version 300 es
layout(location = 0) in vec2 aPosition;
out vec2 vUv;

void main() {
  gl_Position = vec4(aPosition, 0.0, 1.0);
  vUv = vec2(aPosition.x * 0.5 + 0.5, 0.5 - aPosition.y * 0.5);
}
`;

const COLOR_FRAGMENT_SHADER = `#version 300 es
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
uniform float uExposureGain;
uniform bool uLightPositive;
uniform float uColorBoost;
uniform float uColorFade;

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

vec3 applyExposure(vec3 rgb) {
  if (uExposureGain == 1.0) return rgb;
  if (!uLightPositive) return rgb * uExposureGain;

  float luminance = max(0.0, dot(rgb, vec3(0.2126, 0.7152, 0.0722)));
  float target = luminance * uExposureGain;
  const float shoulderStart = 0.82;
  const float shoulderRange = 0.18;
  if (target > shoulderStart) {
    float excess = target - shoulderStart;
    target = shoulderStart + excess / (1.0 + excess / shoulderRange);
  }

  float ratio = luminance > 0.0000001 ? target / luminance : uExposureGain;
  vec3 result = max(vec3(0.0), rgb * ratio);

  float maximum = max(result.r, max(result.g, result.b));
  const float peakStart = 0.97;
  if (maximum > peakStart) {
    float excess = maximum - peakStart;
    float compressed = peakStart + excess / (1.0 + excess / (1.0 - peakStart));
    result *= compressed / maximum;
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

vec3 applyColor(vec3 rgb) {
  if (uColorBoost == 0.0 && uColorFade == 0.0) return rgb;

  vec3 lab = linearRgbToOklab(rgb);
  float chroma = length(lab.yz);
  if (chroma < 0.0000001) return rgb;

  float factor;
  if (uColorBoost == 0.0) {
    float chromaRatio = chroma / 0.12;
    float highChromaWeight = chromaRatio / (1.0 + chromaRatio);
    float fadeMultiplier = mix(1.12, 0.88, highChromaWeight);
    float effectiveFade = clamp(
      uColorFade * (fadeMultiplier + (1.0 - fadeMultiplier) * uColorFade),
      0.0,
      1.0
    );
    factor = 1.0 - effectiveFade;
  } else {
    float hue = mod(degrees(atan(lab.z, lab.y)) + 360.0, 360.0);
    float rawDistance = abs(hue - 50.0);
    float skinDistance = min(rawDistance, 360.0 - rawDistance);
    float hueProtection = exp(-0.5 * pow(skinDistance / 34.0, 2.0));
    float lightnessProtection = exp(-0.5 * pow((lab.x - 0.65) / 0.28, 2.0));
    float skinProtection = hueProtection * lightnessProtection;
    float chromaRatio = chroma / 0.12;
    float lowChromaWeight = 1.0 / (1.0 + chromaRatio * chromaRatio);
    float vibranceResponse = 0.16 + 0.84 * lowChromaWeight;
    factor = 1.0 + uColorBoost * vibranceResponse * (1.0 - 0.7 * skinProtection);
  }

  return gamutMapOklab(vec3(lab.x, lab.yz * factor));
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

  rgb = applyExposure(rgb);
  rgb = applyColor(rgb);
  outColor = vec4(linearToSrgb(rgb), source.a);
}
`;

const GRAIN_NOISE_FRAGMENT_SHADER = `#version 300 es
precision highp float;
precision highp int;

out vec4 outColor;
uniform uint uSeed;

uint grainHashState(ivec2 point, uint seed) {
  uint value = uint(point.x) * 374761393u ^ uint(point.y) * 668265263u ^ seed;
  value = (value ^ (value >> 13u)) * 1274126177u;
  value ^= value >> 16u;
  return value == 0u ? 0x6d2b79f5u : value;
}

void main() {
  ivec2 point = ivec2(floor(gl_FragCoord.xy));
  float excitation = float(grainHashState(point, uSeed)) / 4294967295.0;
  outColor = vec4(excitation, 0.0, 0.0, 1.0);
}
`;

const GRAIN_HORIZONTAL_FRAGMENT_SHADER = `#version 300 es
precision highp float;
precision highp int;

out vec4 outColor;
uniform sampler2D uInput;
uniform ivec2 uSize;

float smallWeight(int tap) {
  if (tap == 0 || tap == 6) return 0.00001453;
  if (tap == 1 || tap == 5) return 0.00539458;
  if (tap == 2 || tap == 4) return 0.18785872;
  return 0.61346435;
}

float broadWeight(int tap) {
  if (tap == 0 || tap == 6) return 0.02153191;
  if (tap == 1 || tap == 5) return 0.09452136;
  if (tap == 2 || tap == 4) return 0.22961404;
  return 0.30866539;
}

void main() {
  ivec2 point = ivec2(floor(gl_FragCoord.xy));
  float small = 0.0;
  float broad = 0.0;
  for (int tap = -3; tap <= 3; tap += 1) {
    ivec2 samplePoint = ivec2(clamp(point.x + tap, 0, uSize.x - 1), point.y);
    float excitation = texelFetch(uInput, samplePoint, 0).r * 2.0 - 1.0;
    small += excitation * smallWeight(tap + 3);
    broad += excitation * broadWeight(tap + 3);
  }
  outColor = vec4(small * 0.5 + 0.5, broad * 0.5 + 0.5, 0.0, 1.0);
}
`;

const GRAIN_VERTICAL_FRAGMENT_SHADER = `#version 300 es
precision highp float;
precision highp int;

out vec4 outColor;
uniform sampler2D uInput;
uniform ivec2 uSize;

float smallWeight(int tap) {
  if (tap == 0 || tap == 6) return 0.00001453;
  if (tap == 1 || tap == 5) return 0.00539458;
  if (tap == 2 || tap == 4) return 0.18785872;
  return 0.61346435;
}

float broadWeight(int tap) {
  if (tap == 0 || tap == 6) return 0.02153191;
  if (tap == 1 || tap == 5) return 0.09452136;
  if (tap == 2 || tap == 4) return 0.22961404;
  return 0.30866539;
}

void main() {
  ivec2 point = ivec2(floor(gl_FragCoord.xy));
  float small = 0.0;
  float broad = 0.0;
  for (int tap = -3; tap <= 3; tap += 1) {
    ivec2 samplePoint = ivec2(point.x, clamp(point.y + tap, 0, uSize.y - 1));
    vec2 horizontal = texelFetch(uInput, samplePoint, 0).rg * 2.0 - 1.0;
    small += horizontal.r * smallWeight(tap + 3);
    broad += horizontal.g * broadWeight(tap + 3);
  }
  float band = clamp((small - broad) * 5.62214436, -3.0, 3.0);
  outColor = vec4(band / 6.0 + 0.5, 0.0, 0.0, 1.0);
}
`;

const GRAIN_COMPOSE_FRAGMENT_SHADER = `#version 300 es
precision highp float;
precision highp int;

in vec2 vUv;
out vec4 outColor;

uniform sampler2D uProcessed;
uniform sampler2D uGrain;
uniform ivec2 uReferenceSize;
uniform float uRmsStops;
uniform float uRoughness;
uniform float uDetailCoupling;

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

float luminanceAt(vec2 uv) {
  return dot(srgbToLinear(texture(uProcessed, uv).rgb), vec3(0.2126, 0.7152, 0.0722));
}

float shapeBandLimitedGrain(float value) {
  float heavyTail = value + uRoughness * 0.06 * (value * value * value - 3.0 * value);
  float normalization = 1.0865 + 0.0608 * uRoughness;
  return 2.8 * tanh(heavyTail / 2.8) * normalization;
}

void main() {
  vec2 processedUv = vec2(vUv.x, 1.0 - vUv.y);
  vec4 processed = texture(uProcessed, processedUv);
  vec3 rgb = srgbToLinear(processed.rgb);
  float luminance = dot(rgb, vec3(0.2126, 0.7152, 0.0722));
  if (luminance <= 0.0000001) {
    outColor = processed;
    return;
  }

  vec2 detailTexel = 1.0 / vec2(uReferenceSize);
  float microscopicBlur = luminance * 0.5 + 0.125 * (
    luminanceAt(processedUv - vec2(detailTexel.x, 0.0))
    + luminanceAt(processedUv + vec2(detailTexel.x, 0.0))
    + luminanceAt(processedUv - vec2(0.0, detailTexel.y))
    + luminanceAt(processedUv + vec2(0.0, detailTexel.y))
  );
  float fineDetail = luminance - microscopicBlur;
  float integratedLuminance = max(0.0, luminance - fineDetail * uDetailCoupling);

  float field = (texture(uGrain, vUv).r - 0.5) * 6.0;
  field = shapeBandLimitedGrain(field);
  float signalResponse = 0.9 + 0.1 * sqrt(clamp(4.0 * luminance * (1.0 - luminance), 0.0, 1.0));
  float exposureStops = field * uRmsStops * signalResponse;
  float targetLuminance = max(0.0, (integratedLuminance + 0.0015) * exp2(exposureStops) - 0.0015);

  float maximum = max(rgb.r, max(rgb.g, rgb.b));
  float requestedScale = targetLuminance / luminance;
  float gamutScale = maximum > 0.0000001 ? 1.0 / maximum : 1.0;
  float scale = max(0.0, min(requestedScale, gamutScale));
  outColor = vec4(linearToSrgb(rgb * scale), processed.a);
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

function createProgram(gl, fragmentSource) {
  const vertex = compileShader(gl, gl.VERTEX_SHADER, VERTEX_SHADER);
  const fragment = compileShader(gl, gl.FRAGMENT_SHADER, fragmentSource);
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
    this.program = createProgram(gl, COLOR_FRAGMENT_SHADER);
    this.noiseProgram = createProgram(gl, GRAIN_NOISE_FRAGMENT_SHADER);
    this.horizontalProgram = createProgram(gl, GRAIN_HORIZONTAL_FRAGMENT_SHADER);
    this.verticalProgram = createProgram(gl, GRAIN_VERTICAL_FRAGMENT_SHADER);
    this.composeProgram = createProgram(gl, GRAIN_COMPOSE_FRAGMENT_SHADER);
    this.sourceTexture = gl.createTexture();
    this.lutTexture = gl.createTexture();
    this.processedTexture = gl.createTexture();
    this.noiseTexture = gl.createTexture();
    this.horizontalTexture = gl.createTexture();
    this.grainTexture = gl.createTexture();
    this.intermediateFramebuffer = gl.createFramebuffer();
    this.vertexArray = gl.createVertexArray();
    this.positionBuffer = gl.createBuffer();
    this.filter = undefined;
    this.hasSource = false;
    this.presentationFramebuffer = null;
    this.grainCacheKey = "";

    if (!this.sourceTexture
      || !this.lutTexture
      || !this.processedTexture
      || !this.noiseTexture
      || !this.horizontalTexture
      || !this.grainTexture
      || !this.intermediateFramebuffer
      || !this.vertexArray
      || !this.positionBuffer) {
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
      exposureGain: location(gl, this.program, "uExposureGain"),
      lightPositive: location(gl, this.program, "uLightPositive"),
      colorBoost: location(gl, this.program, "uColorBoost"),
      colorFade: location(gl, this.program, "uColorFade"),
    };
    this.noiseUniforms = {
      seed: location(gl, this.noiseProgram, "uSeed"),
    };
    this.horizontalUniforms = {
      input: location(gl, this.horizontalProgram, "uInput"),
      size: location(gl, this.horizontalProgram, "uSize"),
    };
    this.verticalUniforms = {
      input: location(gl, this.verticalProgram, "uInput"),
      size: location(gl, this.verticalProgram, "uSize"),
    };
    this.composeUniforms = {
      processed: location(gl, this.composeProgram, "uProcessed"),
      grain: location(gl, this.composeProgram, "uGrain"),
      referenceSize: location(gl, this.composeProgram, "uReferenceSize"),
      rmsStops: location(gl, this.composeProgram, "uRmsStops"),
      roughness: location(gl, this.composeProgram, "uRoughness"),
      detailCoupling: location(gl, this.composeProgram, "uDetailCoupling"),
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
    gl.useProgram(this.horizontalProgram);
    gl.uniform1i(this.horizontalUniforms.input, 0);
    gl.useProgram(this.verticalProgram);
    gl.uniform1i(this.verticalUniforms.input, 0);
    gl.useProgram(this.composeProgram);
    gl.uniform1i(this.composeUniforms.processed, 0);
    gl.uniform1i(this.composeUniforms.grain, 1);
    gl.useProgram(this.program);
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
    this.grainCacheKey = "";
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

  allocateTexture(texture, width, height, filter = this.gl.NEAREST) {
    const { gl } = this;
    gl.bindTexture(gl.TEXTURE_2D, texture);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, filter);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, filter);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    gl.texImage2D(
      gl.TEXTURE_2D,
      0,
      gl.RGBA8,
      width,
      height,
      0,
      gl.RGBA,
      gl.UNSIGNED_BYTE,
      null,
    );
  }

  bindIntermediateTarget(texture, width, height) {
    const { gl } = this;
    gl.bindFramebuffer(gl.FRAMEBUFFER, this.intermediateFramebuffer);
    gl.framebufferTexture2D(
      gl.FRAMEBUFFER,
      gl.COLOR_ATTACHMENT0,
      gl.TEXTURE_2D,
      texture,
      0,
    );
    const status = gl.checkFramebufferStatus(gl.FRAMEBUFFER);
    if (status !== gl.FRAMEBUFFER_COMPLETE) {
      throw new Error(`Grain framebuffer incomplete: 0x${status.toString(16)}`);
    }
    gl.viewport(0, 0, width, height);
  }

  bindPresentationTarget() {
    const { gl } = this;
    gl.bindFramebuffer(gl.FRAMEBUFFER, this.presentationFramebuffer);
    gl.viewport(0, 0, this.canvas.width, this.canvas.height);
  }

  renderColor(edit, showOriginal, targetTexture = null) {
    const { gl } = this;
    if (targetTexture) {
      gl.activeTexture(gl.TEXTURE2);
      this.allocateTexture(targetTexture, this.canvas.width, this.canvas.height, gl.LINEAR);
      this.bindIntermediateTarget(targetTexture, this.canvas.width, this.canvas.height);
    } else {
      this.bindPresentationTarget();
    }

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
    const light = getLightParameters(edit.brightness ?? 0);
    gl.uniform1f(this.uniforms.exposureGain, light.gain);
    gl.uniform1i(this.uniforms.lightPositive, light.positive ? 1 : 0);
    const color = getColorParameters(edit.color ?? 0);
    gl.uniform1f(this.uniforms.colorBoost, color.boost);
    gl.uniform1f(this.uniforms.colorFade, color.fade);
    gl.drawArrays(gl.TRIANGLES, 0, 6);
  }

  ensureGrainField(seed, grain) {
    const { gl } = this;
    const width = grain.referenceWidth;
    const height = grain.referenceHeight;
    const cacheKey = `${seed >>> 0}:${width}x${height}`;
    if (cacheKey === this.grainCacheKey) return;

    gl.activeTexture(gl.TEXTURE2);
    this.allocateTexture(this.noiseTexture, width, height, gl.NEAREST);
    this.allocateTexture(this.horizontalTexture, width, height, gl.NEAREST);
    this.allocateTexture(this.grainTexture, width, height, gl.LINEAR);

    this.bindIntermediateTarget(this.noiseTexture, width, height);
    gl.useProgram(this.noiseProgram);
    gl.bindVertexArray(this.vertexArray);
    gl.uniform1ui(this.noiseUniforms.seed, seed >>> 0);
    gl.drawArrays(gl.TRIANGLES, 0, 6);

    this.bindIntermediateTarget(this.horizontalTexture, width, height);
    gl.useProgram(this.horizontalProgram);
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, this.noiseTexture);
    gl.uniform2i(this.horizontalUniforms.size, width, height);
    gl.drawArrays(gl.TRIANGLES, 0, 6);

    this.bindIntermediateTarget(this.grainTexture, width, height);
    gl.useProgram(this.verticalProgram);
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, this.horizontalTexture);
    gl.uniform2i(this.verticalUniforms.size, width, height);
    gl.drawArrays(gl.TRIANGLES, 0, 6);

    this.grainCacheKey = cacheKey;
  }

  renderGrain(grain) {
    const { gl } = this;
    this.bindPresentationTarget();
    gl.useProgram(this.composeProgram);
    gl.bindVertexArray(this.vertexArray);
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, this.processedTexture);
    gl.activeTexture(gl.TEXTURE1);
    gl.bindTexture(gl.TEXTURE_2D, this.grainTexture);
    gl.uniform2i(
      this.composeUniforms.referenceSize,
      grain.referenceWidth,
      grain.referenceHeight,
    );
    gl.uniform1f(this.composeUniforms.rmsStops, grain.rmsStops);
    gl.uniform1f(this.composeUniforms.roughness, grain.roughness);
    gl.uniform1f(this.composeUniforms.detailCoupling, grain.detailCoupling);
    gl.drawArrays(gl.TRIANGLES, 0, 6);
  }

  render(edit, seed, showOriginal = false) {
    if (!this.hasSource) return;
    const grain = getGrainParameters(
      edit.grain ?? 0,
      this.canvas.width,
      this.canvas.height,
    );
    if (showOriginal || !grain.active) {
      this.renderColor(edit, showOriginal);
      return;
    }

    this.renderColor(edit, false, this.processedTexture);
    this.ensureGrainField(seed, grain);
    this.renderGrain(grain);
  }

  destroy() {
    const { gl } = this;
    gl.deleteTexture(this.sourceTexture);
    gl.deleteTexture(this.lutTexture);
    gl.deleteTexture(this.processedTexture);
    gl.deleteTexture(this.noiseTexture);
    gl.deleteTexture(this.horizontalTexture);
    gl.deleteTexture(this.grainTexture);
    gl.deleteFramebuffer(this.intermediateFramebuffer);
    gl.deleteBuffer(this.positionBuffer);
    gl.deleteVertexArray(this.vertexArray);
    gl.deleteProgram(this.program);
    gl.deleteProgram(this.noiseProgram);
    gl.deleteProgram(this.horizontalProgram);
    gl.deleteProgram(this.verticalProgram);
    gl.deleteProgram(this.composeProgram);
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

async function waitForGpu(gl, isContextLost = () => gl.isContextLost()) {
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
      if (isContextLost()) throw new Error("WebGL context lost");
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

class GpuFullResolutionRenderer extends GpuPreviewRenderer {
  constructor(canvas) {
    super(canvas, { premultipliedAlpha: false });
    const { gl } = this;
    this.framebuffer = gl.createFramebuffer();
    this.renderTargetTexture = gl.createTexture();
    this.contextLost = false;
    this.handleContextLost = (event) => {
      event.preventDefault?.();
      this.contextLost = true;
    };
    canvas.addEventListener?.("webglcontextlost", this.handleContextLost, false);
    if (!this.framebuffer || !this.renderTargetTexture) {
      throw new Error("Unable to allocate GPU export render target");
    }
  }

  assertNoError(stage) {
    if (this.contextLost || this.gl.isContextLost()) throw new Error("WebGL context lost");
    const error = this.gl.getError();
    if (error === this.gl.OUT_OF_MEMORY) throw new Error(`${stage}: WebGL out of memory`);
    if (error !== this.gl.NO_ERROR) throw new Error(`${stage}: WebGL error 0x${error.toString(16)}`);
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
    this.gl.useProgram(this.program);
    return filters.map((filter) => {
      const available = this.setFilter(filter);
      this.assertNoError(`LUT ${filter}`);
      return { filter, available };
    });
  }

  createRenderTarget(width, height) {
    const { gl } = this;
    gl.bindTexture(gl.TEXTURE_2D, this.renderTargetTexture);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    gl.texImage2D(
      gl.TEXTURE_2D,
      0,
      gl.RGBA8,
      width,
      height,
      0,
      gl.RGBA,
      gl.UNSIGNED_BYTE,
      null,
    );
    this.assertNoError("Render target allocation");

    gl.bindFramebuffer(gl.FRAMEBUFFER, this.framebuffer);
    gl.framebufferTexture2D(
      gl.FRAMEBUFFER,
      gl.COLOR_ATTACHMENT0,
      gl.TEXTURE_2D,
      this.renderTargetTexture,
      0,
    );
    this.assertNoError("Framebuffer attachment");
    const status = gl.checkFramebufferStatus(gl.FRAMEBUFFER);
    if (status !== gl.FRAMEBUFFER_COMPLETE) {
      throw new Error(`Framebuffer incomplete: 0x${status.toString(16)}`);
    }
    this.presentationFramebuffer = this.framebuffer;
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

    this.createRenderTarget(source.width, source.height);
    this.gl.viewport(0, 0, source.width, source.height);

    const submissionStartedAt = performance.now();
    this.render(edit, seed, false);
    this.assertNoError("Draw submission");
    const submission = performance.now() - submissionStartedAt;
    const completion = await waitForGpu(
      this.gl,
      () => this.contextLost || this.gl.isContextLost(),
    );

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

  destroy() {
    const { gl } = this;
    this.canvas.removeEventListener?.("webglcontextlost", this.handleContextLost, false);
    if (!gl.isContextLost()) {
      gl.bindFramebuffer(gl.FRAMEBUFFER, null);
      gl.deleteFramebuffer(this.framebuffer);
      gl.deleteTexture(this.renderTargetTexture);
    }
    super.destroy();
    this.canvas.width = 1;
    this.canvas.height = 1;
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
    return new GpuFullResolutionRenderer(canvas);
  } catch (error) {
    onError?.(error);
    return null;
  }
}

export function createGpuFullResolutionRenderer(options = {}) {
  return createGpuExportBenchmarkRenderer(options);
}
