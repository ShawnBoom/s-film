import assert from "node:assert/strict";
import test from "node:test";

import {
  attemptGpuFullResolutionExport,
  capabilityFailure,
} from "../lib/gpu-export.js";

const source = {
  width: 2,
  height: 3,
  data: new Uint8ClampedArray(2 * 3 * 4),
};
const edit = { filter: null, strength: 100, brightness: 0, color: 0, grain: 0 };

function supportedCapabilities() {
  return {
    maxTextureSize: 16384,
    maxRenderbufferSize: 16384,
    maxViewportWidth: 16384,
    maxViewportHeight: 16384,
  };
}

test("production GPU export returns full-size pixels and always releases its renderer", async () => {
  let destroyed = false;
  const pixels = new Uint8ClampedArray(source.data.length).fill(17);
  const result = await attemptGpuFullResolutionExport(source, edit, 41, {
    createRenderer() {
      return {
        capabilities: supportedCapabilities,
        async renderPixels(actualSource, actualEdit, seed) {
          assert.equal(actualSource, source);
          assert.equal(actualEdit, edit);
          assert.equal(seed, 41);
          return { pixels, timings: { totalPixelsReady: 12.5 } };
        },
        destroy() {
          destroyed = true;
        },
      };
    },
  });

  assert.equal(result.ok, true);
  assert.equal(result.processor, "gpu");
  assert.equal(result.pixels, pixels);
  assert.equal(result.duration, 12.5);
  assert.equal(destroyed, true);
});

test("production GPU export rejects unsupported full-size dimensions without resizing", async () => {
  let rendered = false;
  let destroyed = false;
  const result = await attemptGpuFullResolutionExport(source, edit, 1, {
    createRenderer() {
      return {
        capabilities() {
          return { ...supportedCapabilities(), maxTextureSize: 2 };
        },
        async renderPixels() {
          rendered = true;
        },
        destroy() {
          destroyed = true;
        },
      };
    },
  });

  assert.equal(result.ok, false);
  assert.match(result.reason, /MAX_TEXTURE_SIZE exceeded/);
  assert.equal(rendered, false);
  assert.equal(destroyed, true);
});

test("production GPU export reports initialization and runtime failures for CPU fallback", async () => {
  const initialization = await attemptGpuFullResolutionExport(source, edit, 1, {
    createRenderer({ onError }) {
      onError(new Error("WebGL2 unavailable"));
      return null;
    },
  });
  assert.equal(initialization.ok, false);
  assert.match(initialization.reason, /WebGL2 initialization failed: WebGL2 unavailable/);

  let destroyed = false;
  const framebuffer = await attemptGpuFullResolutionExport(source, edit, 1, {
    createRenderer() {
      return {
        capabilities: supportedCapabilities,
        async renderPixels() {
          throw new Error("Framebuffer incomplete: 0x8cd6");
        },
        destroy() {
          destroyed = true;
        },
      };
    },
  });
  assert.equal(framebuffer.ok, false);
  assert.match(framebuffer.reason, /Framebuffer incomplete/);
  assert.equal(destroyed, true);

  const contextLost = await attemptGpuFullResolutionExport(source, edit, 1, {
    createRenderer() {
      return {
        capabilities: supportedCapabilities,
        async renderPixels() {
          throw new Error("WebGL context lost");
        },
        destroy() {},
      };
    },
  });
  assert.equal(contextLost.ok, false);
  assert.equal(contextLost.reason, "WebGL context lost");
});

test("capability checks cover renderbuffer and viewport limits", () => {
  assert.match(
    capabilityFailure({ ...supportedCapabilities(), maxRenderbufferSize: 2 }, 2, 3),
    /MAX_RENDERBUFFER_SIZE exceeded/,
  );
  assert.match(
    capabilityFailure({ ...supportedCapabilities(), maxViewportHeight: 2 }, 2, 3),
    /MAX_VIEWPORT_DIMS exceeded/,
  );
  assert.equal(capabilityFailure(supportedCapabilities(), 5712, 4284), "");
});
