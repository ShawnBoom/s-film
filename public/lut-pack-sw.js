(function installSeeLutPackServiceWorker(globalScope) {
  "use strict";

  const PACK_VERSION = "1";
  const LUT_CACHE = `see-luts-bin-v${PACK_VERSION}`;
  const META_CACHE = "see-luts-meta";
  const LEGACY_LUT_CACHE = "see-luts-v52";
  const LEGACY_STATIC_CACHE = "see-static-v48";
  const ACTIVE_STATE_KEY = "__see_lut_pack__/active.json";
  const PACK_STATE_KEY = `__see_lut_pack__/v${PACK_VERSION}.json`;
  const inFlightBinaries = new Map();
  let preparationPromise = null;
  let manifestPromise = null;
  let lastStatus = {
    cachedCount: 0,
    totalCount: 14,
    cachedBytes: 0,
    totalBytes: 0,
    ready: false,
    preparation: "idle",
    error: "",
  };

  function cacheKey(root, key) {
    return new URL(key, root).href;
  }

  async function sha256Hex(buffer) {
    const digest = await globalScope.crypto.subtle.digest("SHA-256", buffer);
    return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
  }

  function validateManifest(manifest) {
    if (!manifest || String(manifest.packVersion) !== PACK_VERSION) throw new Error("Unexpected LUT pack version");
    if (manifest.format !== "float32-le-rgb" || !Array.isArray(manifest.luts) || manifest.luts.length !== 14) {
      throw new Error("Malformed LUT pack manifest");
    }
    for (const entry of manifest.luts) {
      const expected = entry.dimension ** 3 * 3;
      if (entry.floatCount !== expected || entry.byteLength !== expected * 4 || !/^[a-f0-9]{64}$/.test(entry.sha256)) {
        throw new Error(`Malformed LUT metadata: ${entry.id}`);
      }
    }
    return manifest;
  }

  async function loadManifest(manifestUrl) {
    if (!manifestPromise) {
      manifestPromise = (async () => {
        const cached = await globalScope.caches.match(manifestUrl, { ignoreSearch: true });
        let response = cached;
        if (!response) response = await globalScope.fetch(manifestUrl, { cache: "no-cache" });
        if (!response?.ok) throw new Error(`LUT manifest HTTP ${response?.status ?? "offline"}`);
        return validateManifest(await response.json());
      })().catch((error) => {
        manifestPromise = null;
        throw error;
      });
    }
    return manifestPromise;
  }

  function resolveEntryUrl(entry, manifestUrl) {
    return new URL(entry.url, manifestUrl).href;
  }

  async function makeStoredResponse(buffer, entry) {
    return new Response(buffer, {
      status: 200,
      headers: {
        "content-type": "application/octet-stream",
        "content-length": String(entry.byteLength),
        "x-see-lut-id": entry.id,
        "x-see-lut-dimension": String(entry.dimension),
        "x-see-lut-sha256": entry.sha256,
        "x-see-lut-pack-version": String(entry.version || PACK_VERSION),
      },
    });
  }

  function withSource(response, source) {
    const headers = new Headers(response.headers);
    headers.set("x-see-lut-source", source);
    return new Response(response.body, {
      status: response.status,
      statusText: response.statusText,
      headers,
    });
  }

  async function validateResponse(response, entry) {
    if (!response?.ok) return null;
    const declaredLength = Number(response.headers.get("content-length"));
    const declaredChecksum = response.headers.get("x-see-lut-sha256");
    if (declaredLength === entry.byteLength && declaredChecksum === entry.sha256) return response;
    const buffer = await response.arrayBuffer();
    if (buffer.byteLength !== entry.byteLength) return null;
    if (await sha256Hex(buffer) !== entry.sha256) return null;
    return makeStoredResponse(buffer, entry);
  }

  async function fetchAndCacheEntry(entry, manifestUrl) {
    const url = resolveEntryUrl(entry, manifestUrl);
    const existing = inFlightBinaries.get(url);
    if (existing) return existing;
    const request = (async () => {
      const cache = await globalScope.caches.open(LUT_CACHE);
      const cached = await cache.match(url);
      const validCached = await validateResponse(cached, entry);
      if (validCached) {
        if (validCached !== cached) await cache.put(url, validCached.clone());
        return { response: validCached, source: "Cache Storage" };
      }
      if (cached) await cache.delete(url);
      const network = await globalScope.fetch(url, { cache: "no-cache" });
      if (!network.ok) throw new Error(`${entry.id}: LUT HTTP ${network.status}`);
      const buffer = await network.arrayBuffer();
      if (buffer.byteLength !== entry.byteLength) throw new Error(`${entry.id}: LUT byte length mismatch`);
      if (await sha256Hex(buffer) !== entry.sha256) throw new Error(`${entry.id}: LUT checksum mismatch`);
      const stored = await makeStoredResponse(buffer, entry);
      await cache.put(url, stored.clone());
      return { response: stored, source: "network" };
    })().finally(() => inFlightBinaries.delete(url));
    inFlightBinaries.set(url, request);
    return request;
  }

  async function inspectPack(manifest, manifestUrl) {
    const cache = await globalScope.caches.open(LUT_CACHE);
    let cachedCount = 0;
    let cachedBytes = 0;
    for (const entry of manifest.luts) {
      const url = resolveEntryUrl(entry, manifestUrl);
      const response = await cache.match(url);
      const valid = await validateResponse(response, entry);
      if (!valid) continue;
      if (valid !== response) await cache.put(url, valid.clone());
      cachedCount += 1;
      cachedBytes += entry.byteLength;
    }
    return {
      cachedCount,
      totalCount: manifest.luts.length,
      cachedBytes,
      totalBytes: manifest.totalBytes,
      ready: cachedCount === manifest.luts.length,
    };
  }

  async function writeState(root, state, complete, manifest = null) {
    const cache = await globalScope.caches.open(META_CACHE);
    const body = JSON.stringify({
      packVersion: PACK_VERSION,
      cacheName: LUT_CACHE,
      complete,
      updatedAt: Date.now(),
      ...(complete && manifest ? { manifest } : {}),
      ...state,
    });
    await cache.put(cacheKey(root, PACK_STATE_KEY), new Response(body, { headers: { "content-type": "application/json" } }));
    if (complete) {
      await cache.put(cacheKey(root, ACTIVE_STATE_KEY), new Response(body, { headers: { "content-type": "application/json" } }));
    }
  }

  async function readStoredState(root) {
    const cache = await globalScope.caches.open(META_CACHE);
    const response = await cache.match(cacheKey(root, PACK_STATE_KEY));
    if (!response) return null;
    try { return await response.json(); } catch { return null; }
  }

  async function readActiveState(root) {
    const cache = await globalScope.caches.open(META_CACHE);
    const response = await cache.match(cacheKey(root, ACTIVE_STATE_KEY));
    if (!response) return null;
    try { return await response.json(); } catch { return null; }
  }

  async function broadcastStatus(status) {
    lastStatus = { ...lastStatus, ...status };
    const clients = await globalScope.clients.matchAll({ type: "window", includeUncontrolled: true });
    for (const client of clients) client.postMessage({ type: "SEE_LUT_PACK_STATUS", status: lastStatus });
  }

  async function cleanObsoleteLutCaches() {
    const names = await globalScope.caches.keys();
    await Promise.all(names
      .filter((name) => name !== LUT_CACHE && name.startsWith("see-luts-bin-v"))
      .map((name) => globalScope.caches.delete(name)));
    await Promise.all([LEGACY_LUT_CACHE, LEGACY_STATIC_CACHE].map((name) => globalScope.caches.delete(name)));
  }

  async function preparePack(manifestUrl, root) {
    if (preparationPromise) return preparationPromise;
    preparationPromise = (async () => {
      await broadcastStatus({ preparation: "running", error: "" });
      const manifest = await loadManifest(manifestUrl);
      let state = await inspectPack(manifest, manifestUrl);
      await writeState(root, state, false);
      await broadcastStatus({ ...state, preparation: state.ready ? "complete" : "running", error: "" });

      const missing = manifest.luts;
      let cursor = 0;
      const workers = Array.from({ length: Math.min(2, missing.length) }, async () => {
        while (cursor < missing.length) {
          const entry = missing[cursor];
          cursor += 1;
          const cache = await globalScope.caches.open(LUT_CACHE);
          const existing = await cache.match(resolveEntryUrl(entry, manifestUrl));
          if (await validateResponse(existing, entry)) continue;
          await fetchAndCacheEntry(entry, manifestUrl);
          state = await inspectPack(manifest, manifestUrl);
          await writeState(root, state, false);
          await broadcastStatus({ ...state, preparation: "running", error: "" });
        }
      });
      const workerResults = await Promise.allSettled(workers);
      const rejectedWorker = workerResults.find((result) => result.status === "rejected");
      if (rejectedWorker) throw rejectedWorker.reason;

      state = await inspectPack(manifest, manifestUrl);
      if (!state.ready) throw new Error(`Incomplete LUT pack: ${state.cachedCount}/${state.totalCount}`);
      await writeState(root, state, true, manifest);
      await broadcastStatus({ ...state, preparation: "complete", error: "" });
      await cleanObsoleteLutCaches();
      return state;
    })().catch(async (error) => {
      const stored = await readStoredState(root);
      await broadcastStatus({
        cachedCount: stored?.cachedCount ?? lastStatus.cachedCount,
        cachedBytes: stored?.cachedBytes ?? lastStatus.cachedBytes,
        preparation: "interrupted",
        error: String(error?.message ?? error),
      });
      throw error;
    }).finally(() => {
      preparationPromise = null;
    });
    return preparationPromise;
  }

  async function postStoredStatus(root, source) {
    const stored = await readStoredState(root);
    if (stored) lastStatus = { ...lastStatus, ...stored, preparation: stored.complete ? "complete" : lastStatus.preparation };
    source?.postMessage({ type: "SEE_LUT_PACK_STATUS", status: lastStatus });
  }

  function isBinaryLutRequest(url) {
    return url.pathname.includes(`/luts-bin/v${PACK_VERSION}/`) && url.pathname.endsWith(".bin");
  }

  function isLegacyLutRequest(url) {
    return /\/s(?:0[1-9]|1[0-4])-[^/]+-lut\.js$/.test(url.pathname);
  }

  async function handleBinaryRequest(request, manifestUrl, root = globalScope.registration.scope) {
    const manifest = await loadManifest(manifestUrl);
    const requestedUrl = new URL(request.url);
    const entry = manifest.luts.find((candidate) => new URL(candidate.url, manifestUrl).pathname === requestedUrl.pathname);
    if (!entry) return globalScope.fetch(request);
    try {
      const loaded = await fetchAndCacheEntry(entry, manifestUrl);
      return withSource(loaded.response.clone(), loaded.source);
    } catch (error) {
      const active = await readActiveState(root);
      if (!active?.complete || !active.manifest || active.packVersion === PACK_VERSION) throw error;
      const previousEntry = active.manifest.luts.find((candidate) => candidate.id === entry.id);
      if (!previousEntry) throw error;
      const previousCache = await globalScope.caches.open(active.cacheName);
      const previousUrl = resolveEntryUrl(previousEntry, active.manifestUrl || manifestUrl);
      const previous = await previousCache.match(previousUrl);
      const validPrevious = await validateResponse(previous, previousEntry);
      if (!validPrevious) throw error;
      return withSource(validPrevious, "previous complete pack");
    }
  }

  async function handleLegacyRequest(request) {
    const canonical = new URL(request.url);
    canonical.searchParams.delete("legacy");
    canonical.searchParams.delete("retry");
    for (const name of [LEGACY_LUT_CACHE, LEGACY_STATIC_CACHE]) {
      const cache = await globalScope.caches.open(name);
      const cached = await cache.match(canonical.href, { ignoreSearch: true });
      if (cached) return cached;
    }
    const response = await globalScope.fetch(request);
    if (response.ok) {
      const cache = await globalScope.caches.open(LEGACY_LUT_CACHE);
      await cache.put(canonical.href, response.clone());
    }
    return response;
  }

  globalScope.SeeLutPackSW = Object.freeze({
    PACK_VERSION,
    LUT_CACHE,
    META_CACHE,
    LEGACY_LUT_CACHE,
    LEGACY_STATIC_CACHE,
    isBinaryLutRequest,
    isLegacyLutRequest,
    handleBinaryRequest,
    handleLegacyRequest,
    preparePack,
    postStoredStatus,
    protectedCacheNames: new Set([LUT_CACHE, META_CACHE, LEGACY_LUT_CACHE, LEGACY_STATIC_CACHE]),
  });
})(self);
