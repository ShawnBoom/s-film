import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";

const networkFetch = globalThis.fetch;

globalThis.fetch = async function fileAwareFetch(input, init) {
  const url = new URL(input instanceof Request ? input.url : String(input));
  if (url.protocol !== "file:") return networkFetch(input, init);
  try {
    const bytes = await readFile(fileURLToPath(url));
    const contentType = url.pathname.endsWith(".json")
      ? "application/json"
      : "application/octet-stream";
    return new Response(bytes, { status: 200, headers: { "content-type": contentType, "content-length": String(bytes.byteLength) } });
  } catch {
    return new Response("Not found", { status: 404 });
  }
};
