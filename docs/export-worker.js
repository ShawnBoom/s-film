import { processPixels } from "./image-engine.js?v=45";

self.postMessage({ type: "ready" });

self.addEventListener("message", (event) => {
  const message = event.data;
  if (!message || message.type !== "process") return;

  const source = {
    data: new Uint8ClampedArray(message.buffer),
    width: message.width,
    height: message.height,
  };

  try {
    const startedAt = performance.now();
    const pixels = processPixels(source, message.edit, message.seed);
    const duration = performance.now() - startedAt;
    self.postMessage(
      {
        type: "result",
        id: message.id,
        buffer: pixels.buffer,
        duration,
      },
      [pixels.buffer],
    );
  } catch (error) {
    self.postMessage(
      {
        type: "error",
        id: message.id,
        message: error instanceof Error ? error.message : String(error),
        buffer: source.data.buffer,
      },
      [source.data.buffer],
    );
  }
});
