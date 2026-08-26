import { createHash } from "node:crypto";
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

import { LUT_PACK_VERSION, LUT_SOURCES } from "./lut-pack-sources.mjs";

const projectRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const outputRoots = [resolve(projectRoot, "public"), resolve(projectRoot, "docs")];
const packDirectory = `luts-bin/v${LUT_PACK_VERSION}`;

function publicEntry(entry) {
  return {
    id: entry.id,
    displayName: entry.displayName,
    dimension: entry.dimension,
    url: entry.url,
    byteLength: entry.byteLength,
    floatCount: entry.floatCount,
    sha256: entry.sha256,
    version: entry.version,
    legacy: entry.legacy,
  };
}

function sha256(bytes) {
  return createHash("sha256").update(bytes).digest("hex");
}

const entries = [];
for (const source of LUT_SOURCES) {
  const moduleUrl = pathToFileURL(resolve(projectRoot, "lib", source.module));
  const lutModule = await import(moduleUrl.href);
  const values = lutModule[source.dataExport];
  const dimension = lutModule[source.sizeExport];
  const expectedFloatCount = source.dimension ** 3 * 3;

  if (!(values instanceof Float32Array)) throw new Error(`${source.id}: source is not Float32Array`);
  if (dimension !== source.dimension) throw new Error(`${source.id}: dimension mismatch`);
  if (values.length !== expectedFloatCount) throw new Error(`${source.id}: float count mismatch`);

  const bytes = Buffer.from(values.buffer, values.byteOffset, values.byteLength);
  const digest = sha256(bytes);
  const filename = `${source.slug}.${digest.slice(0, 12)}.bin`;
  const decoded = new Float32Array(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength));
  if (decoded.length !== values.length) throw new Error(`${source.id}: binary decode length mismatch`);
  for (let index = 0; index < values.length; index += 1) {
    if (Object.is(values[index], decoded[index]) === false) {
      throw new Error(`${source.id}: Float32 round-trip mismatch at ${index}`);
    }
  }

  entries.push({
    id: source.id,
    displayName: source.displayName,
    dimension,
    url: `./${packDirectory}/${filename}`,
    byteLength: bytes.byteLength,
    floatCount: values.length,
    sha256: digest,
    version: LUT_PACK_VERSION,
    legacy: {
      url: `./${source.module}`,
      dataExport: source.dataExport,
      sizeExport: source.sizeExport,
    },
    bytes,
  });
}

const manifest = {
  packVersion: LUT_PACK_VERSION,
  format: "float32-le-rgb",
  lutCount: entries.length,
  totalBytes: entries.reduce((sum, entry) => sum + entry.byteLength, 0),
  luts: entries.map(publicEntry),
};

for (const outputRoot of outputRoots) {
  const outputDirectory = resolve(outputRoot, packDirectory);
  await rm(outputDirectory, { recursive: true, force: true });
  await mkdir(outputDirectory, { recursive: true });
  for (const entry of entries) {
    const filename = new URL(entry.url, "https://see.invalid/").pathname.split("/").pop();
    await writeFile(resolve(outputDirectory, filename), entry.bytes);
  }
  await writeFile(
    resolve(outputRoot, `lut-pack-v${LUT_PACK_VERSION}.json`),
    JSON.stringify(manifest, null, 2) + "\n",
  );
}

const sourceBytes = await Promise.all(LUT_SOURCES.map((source) => (
  readFile(resolve(projectRoot, "lib", source.module)).then((file) => file.byteLength)
)));

console.log(JSON.stringify({
  packVersion: LUT_PACK_VERSION,
  lutCount: entries.length,
  totalBytes: manifest.totalBytes,
  previousJsSourceBytes: sourceBytes.reduce((sum, bytes) => sum + bytes, 0),
  luts: entries.map((entry) => ({ ...publicEntry(entry), equality: "bit-exact" })),
}, null, 2));
