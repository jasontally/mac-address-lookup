/** Data loading: manifest + Parquet files into in-memory indexes. */

import { parquetReadObjects } from 'hyparquet';
import { createRegistry } from './registry.mjs';
import { createLineageIndex } from './lineage.mjs';

/**
 * Bump when a breaking data change ships. Additive columns are tolerated by
 * createRegistry; renames/removals require a version bump and a client guard.
 */
export const SUPPORTED_SCHEMA_VERSION = 1;

/** Load at most this many shards before falling back to the full registry. */
export const MAX_SHARDS = 24;

/** Throws a user-facing error when the deployed data is newer than this app. */
export function checkSchemaVersion(manifest) {
  const version = Number(manifest?.schemaVersion ?? 1);
  if (version > SUPPORTED_SCHEMA_VERSION) {
    const error = new Error(
      `Deployed registry schema v${version} is newer than this app supports (v${SUPPORTED_SCHEMA_VERSION})`,
    );
    error.userMessage =
      'The deployed data uses a newer format than this page was built for. Reload to update.';
    throw error;
  }
  return version;
}

/**
 * Select the manifest shards needed for the given inputs.
 * A single address needs only the shards whose keys are prefixes of it
 * (longest-prefix match ancestors); a partial prefix needs the shards that
 * extend it. Too many shards falls back to the full registry.
 * Pass `null` inputs for "everything" (free-text search).
 */
export function shardKeysFor(manifest, inputs, { maxShards = MAX_SHARDS } = {}) {
  const keys = Object.keys(manifest?.shards ?? {});
  if (keys.length === 0) return { mode: 'full' };
  if (!Array.isArray(inputs) || inputs.length === 0) return { mode: 'full' };

  const selected = new Set();
  for (const input of inputs) {
    const hex = String(input ?? '').toUpperCase();
    if (hex === '') return { mode: 'full' };
    for (const key of keys) {
      const matches =
        hex.length >= 6 ? hex.startsWith(key) : key.startsWith(hex);
      if (matches) selected.add(key);
      if (selected.size > maxShards) return { mode: 'full' };
    }
  }
  if (selected.size === 0) return { mode: 'full' };
  return { mode: 'shards', keys: [...selected].sort() };
}

async function fetchBuffer(url, fetchImpl) {
  const response = await fetchImpl(url);
  if (!response.ok) {
    throw new Error(`Failed to fetch ${url}: ${response.status} ${response.statusText}`);
  }
  return response.arrayBuffer();
}

let workerSequence = 0;

/** Decode in a dedicated worker when the page provides one; else main thread. */
function decodeParquetInWorker(buffer, workerUrl) {
  return new Promise((resolve, reject) => {
    const worker = new Worker(workerUrl, { name: 'parquet-decode' });
    const id = ++workerSequence;
    const timeout = setTimeout(() => {
      worker.terminate();
      reject(new Error('parquet worker timed out'));
    }, 120_000);
    worker.onmessage = (event) => {
      if (event.data?.id !== id) return;
      clearTimeout(timeout);
      worker.terminate();
      if (event.data.error) reject(new Error(event.data.error));
      else resolve(event.data.rows);
    };
    worker.onerror = () => {
      clearTimeout(timeout);
      worker.terminate();
      reject(new Error('parquet worker failed'));
    };
    // Structured clone copies the buffer; transferring would detach it and
    // break any main-thread fallback path.
    worker.postMessage({ id, buffer });
  });
}

async function fetchParquetRows(buffer) {
  const workerUrl = globalThis.__malWorker;
  if (workerUrl && typeof Worker === 'function') {
    try {
      return await decodeParquetInWorker(buffer, workerUrl);
    } catch {
      // fall through to main-thread decode
    }
  }
  return parquetReadObjects({ file: buffer });
}

async function fetchParquetRowsFromUrl(url, fetchImpl) {
  return fetchParquetRows(await fetchBuffer(url, fetchImpl));
}

/** Promises started by the inline preload script in the page head. */
function preload() {
  return globalThis.__malPreload ?? null;
}

async function usePreload(promise) {
  if (!promise) return null;
  try {
    return await promise;
  } catch {
    return null;
  }
}

/** Load and validate the manifest, consuming the inline preload if present. */
export async function loadManifest({ manifestUrl = '/data/manifest.json', fetchImpl = fetch } = {}) {
  let manifest = null;
  if (manifestUrl === '/data/manifest.json') {
    manifest = await usePreload(preload()?.manifest);
  }
  if (!manifest) {
    const response = await fetchImpl(manifestUrl);
    if (!response.ok) {
      throw new Error(
        `Failed to fetch manifest (${manifestUrl}): ${response.status} ${response.statusText}`,
      );
    }
    manifest = await response.json();
  }
  checkSchemaVersion(manifest);
  return manifest;
}

/** Load the lineage index (returns null when the manifest has no lineage). */
export async function loadLineage(manifest, { fetchImpl = fetch } = {}) {
  if (!manifest.lineage) return null;
  let buffer = null;
  const preloadPromise = preload()?.lineage;
  if (preloadPromise) buffer = await usePreload(preloadPromise);
  if (!buffer) buffer = await fetchBuffer(`/${manifest.lineage.file}`, fetchImpl);
  return createLineageIndex(await fetchParquetRows(buffer));
}

async function loadShardRows(manifest, key, cache, fetchImpl) {
  if (cache.shardRows.has(key)) return;
  const file = manifest.shards?.[key];
  let buffer = null;
  if (file) {
    const preloaded = await usePreload(preload()?.shardsForInput);
    let value = preloaded?.[key] ?? null;
    if (value && typeof value.then === 'function') value = await value;
    buffer = value ?? null;
    if (!buffer) buffer = await fetchBuffer(`/${file}`, fetchImpl);
  }
  cache.shardRows.set(key, buffer ? await fetchParquetRows(buffer) : []);
}

/**
 * Load a registry suitable for the given inputs.
 * Prefix-trie shards when few enough; otherwise the full registry.
 * `cache` persists across calls (shardRows map, fullRegistry).
 */
export async function loadRegistryFor(manifest, inputs, { fetchImpl = fetch, cache = {} } = {}) {
  const shardRows = cache.shardRows ?? (cache.shardRows = new Map());
  const plan = inputs == null ? { mode: 'full' } : shardKeysFor(manifest, inputs);

  if (plan.mode === 'full' || !manifest.shards) {
    if (!cache.fullRegistryPromise) {
      cache.fullRegistryPromise = (async () => {
        const buffer = await fetchBuffer(`/${manifest.data.file}`, fetchImpl);
        const registry = createRegistry(await fetchParquetRows(buffer));
        cache.fullRegistry = registry;
        return registry;
      })();
    }
    return { registry: await cache.fullRegistryPromise, mode: 'full', shardKeys: [] };
  }

  await Promise.all(plan.keys.map((key) => loadShardRows(manifest, key, cache, fetchImpl)));
  const rows = [];
  for (const key of plan.keys) rows.push(...(shardRows.get(key) ?? []));
  return { registry: createRegistry(rows), mode: 'shards', shardKeys: plan.keys };
}

/** Read a Parquet registry file from a URL into a lookup index. */
export async function registryFromParquetUrl(url, { fetchImpl = fetch } = {}) {
  return createRegistry(await fetchParquetRowsFromUrl(url, fetchImpl));
}

/**
 * Load the lean free-text search index when the manifest provides one;
 * otherwise fall back to the full registry (older deployments, tests).
 */
export async function loadSearchIndex(manifest, { fetchImpl = fetch, cache = {} } = {}) {
  const file = manifest?.search?.file ?? manifest?.data?.file;
  if (cache.searchIndexPromise && cache.searchIndexPromise.file === file) {
    return { registry: await cache.searchIndexPromise.registry, mode: 'search' };
  }
  const promise = (async () => {
    let buffer = null;
    const preloaded = await usePreload(preload()?.searchIndex);
    buffer = preloaded ?? (await fetchBuffer(`/${file}`, fetchImpl));
    return createRegistry(await fetchParquetRows(buffer));
  })();
  cache.searchIndexPromise = { file, registry: promise };
  return { registry: await promise, mode: 'search' };
}

/** Read a Parquet lineage file from a URL into a lineage index. */
export async function lineageFromParquetUrl(url, { fetchImpl = fetch } = {}) {
  return createLineageIndex(await fetchParquetRowsFromUrl(url, fetchImpl));
}

/**
 * Load the full registry and lineage (convenience for callers that need
 * everything, such as tests or free-text search without shard support).
 */
export async function loadRegistry({ manifestUrl = '/data/manifest.json', fetchImpl = fetch, cache = {} } = {}) {
  const manifest = await loadManifest({ manifestUrl, fetchImpl });
  const [loaded, lineage] = await Promise.all([
    loadRegistryFor(manifest, null, { fetchImpl, cache }),
    loadLineage(manifest, { fetchImpl }),
  ]);
  return { manifest, registry: loaded.registry, lineage };
}
