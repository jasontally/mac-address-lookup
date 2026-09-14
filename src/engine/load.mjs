/** Data loading: manifest + Parquet files into in-memory indexes. */

import { parquetReadObjects } from 'hyparquet';
import { createRegistry } from './registry.mjs';
import { createLineageIndex } from './lineage.mjs';

/**
 * Bump when a breaking data change ships. Additive columns are tolerated by
 * createRegistry; renames/removals require a version bump and a client guard.
 */
export const SUPPORTED_SCHEMA_VERSION = 1;

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

async function fetchParquetRows(buffer) {
  return parquetReadObjects({ file: buffer });
}

async function fetchParquetRowsFromUrl(url, fetchImpl) {
  const response = await fetchImpl(url);
  if (!response.ok) {
    throw new Error(`Failed to fetch ${url}: ${response.status} ${response.statusText}`);
  }
  return fetchParquetRows(await response.arrayBuffer());
}

/** Registry and lineage fetches started by the inline preload script. */
function preloaded(name) {
  const preload = globalThis.__malPreload;
  return preload && preload[name] ? preload[name] : null;
}

async function fetchManifest(manifestUrl, fetchImpl) {
  if (manifestUrl === '/data/manifest.json') {
    const preload = preloaded('manifest');
    if (preload) {
      try {
        return await preload;
      } catch {
        // fall through to a normal fetch
      }
    }
  }
  const response = await fetchImpl(manifestUrl);
  if (!response.ok) {
    throw new Error(
      `Failed to fetch manifest (${manifestUrl}): ${response.status} ${response.statusText}`,
    );
  }
  return response.json();
}

async function loadRegistryIndex(manifest, { manifestUrl, fetchImpl }) {
  if (manifestUrl === '/data/manifest.json') {
    const preload = preloaded('registry');
    if (preload) {
      try {
        const buffer = await preload;
        if (buffer) return createRegistry(await fetchParquetRows(buffer));
      } catch {
        // fall through to a normal fetch
      }
    }
  }
  return createRegistry(await fetchParquetRowsFromUrl(`/${manifest.data.file}`, fetchImpl));
}

async function loadLineageIndex(manifest, { manifestUrl, fetchImpl }) {
  if (!manifest.lineage) return null;
  if (manifestUrl === '/data/manifest.json') {
    const preload = preloaded('lineage');
    if (preload) {
      try {
        const buffer = await preload;
        if (buffer) return createLineageIndex(await fetchParquetRows(buffer));
      } catch {
        // fall through to a normal fetch
      }
    }
  }
  return createLineageIndex(await fetchParquetRowsFromUrl(`/${manifest.lineage.file}`, fetchImpl));
}

/** Read a Parquet registry file from a URL into a lookup index. */
export async function registryFromParquetUrl(url, { fetchImpl = fetch } = {}) {
  return createRegistry(await fetchParquetRowsFromUrl(url, fetchImpl));
}

/** Read a Parquet lineage file from a URL into a lineage index. */
export async function lineageFromParquetUrl(url, { fetchImpl = fetch } = {}) {
  return createLineageIndex(await fetchParquetRowsFromUrl(url, fetchImpl));
}

/**
 * Load the manifest, then the content-hashed registry and (optional) lineage
 * files it points at. Consumes the inline preload when present.
 */
export async function loadRegistry({ manifestUrl = '/data/manifest.json', fetchImpl = fetch } = {}) {
  const manifest = await fetchManifest(manifestUrl, fetchImpl);
  checkSchemaVersion(manifest);
  const [registry, lineage] = await Promise.all([
    loadRegistryIndex(manifest, { manifestUrl, fetchImpl }),
    loadLineageIndex(manifest, { manifestUrl, fetchImpl }),
  ]);
  return { manifest, registry, lineage };
}
