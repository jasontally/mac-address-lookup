/** Data loading: manifest + Parquet files into in-memory indexes. */

import { parquetReadObjects } from 'hyparquet';
import { createRegistry } from './registry.mjs';
import { createLineageIndex } from './lineage.mjs';

async function fetchParquetRows(url, fetchImpl) {
  const response = await fetchImpl(url);
  if (!response.ok) {
    throw new Error(`Failed to fetch ${url}: ${response.status} ${response.statusText}`);
  }
  const buffer = await response.arrayBuffer();
  return parquetReadObjects({ file: buffer });
}

/** Read a Parquet registry file from a URL into a lookup index. */
export async function registryFromParquetUrl(url, { fetchImpl = fetch } = {}) {
  return createRegistry(await fetchParquetRows(url, fetchImpl));
}

/** Read a Parquet lineage file from a URL into a lineage index. */
export async function lineageFromParquetUrl(url, { fetchImpl = fetch } = {}) {
  return createLineageIndex(await fetchParquetRows(url, fetchImpl));
}

/**
 * Load the manifest, then the content-hashed registry and (optional) lineage
 * files it points at. `data.file` is relative to the site root.
 */
export async function loadRegistry({ manifestUrl = '/data/manifest.json', fetchImpl = fetch } = {}) {
  const response = await fetchImpl(manifestUrl);
  if (!response.ok) {
    throw new Error(
      `Failed to fetch manifest (${manifestUrl}): ${response.status} ${response.statusText}`,
    );
  }
  const manifest = await response.json();
  const [registry, lineage] = await Promise.all([
    registryFromParquetUrl(`/${manifest.data.file}`, { fetchImpl }),
    manifest.lineage
      ? lineageFromParquetUrl(`/${manifest.lineage.file}`, { fetchImpl })
      : Promise.resolve(null),
  ]);
  return { manifest, registry, lineage };
}
