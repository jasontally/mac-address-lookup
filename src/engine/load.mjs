/** Data loading: manifest + Parquet registry into an in-memory index. */

import { parquetReadObjects } from 'hyparquet';
import { createRegistry } from './registry.mjs';

/** Read a Parquet registry file from a URL into a lookup index. */
export async function registryFromParquetUrl(url, { fetchImpl = fetch } = {}) {
  const response = await fetchImpl(url);
  if (!response.ok) {
    throw new Error(`Failed to fetch registry (${url}): ${response.status} ${response.statusText}`);
  }
  const buffer = await response.arrayBuffer();
  const rows = await parquetReadObjects({ file: buffer });
  return createRegistry(rows);
}

/**
 * Load the manifest, then the content-hashed Parquet file it points at.
 * `data.file` is relative to the site root, e.g. `data/registry.abc123.parquet`.
 */
export async function loadRegistry({ manifestUrl = '/data/manifest.json', fetchImpl = fetch } = {}) {
  const response = await fetchImpl(manifestUrl);
  if (!response.ok) {
    throw new Error(
      `Failed to fetch manifest (${manifestUrl}): ${response.status} ${response.statusText}`,
    );
  }
  const manifest = await response.json();
  const registry = await registryFromParquetUrl(`/${manifest.data.file}`, { fetchImpl });
  return { manifest, registry };
}
