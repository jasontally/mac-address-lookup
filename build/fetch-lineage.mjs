import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fetchWithRetry } from './fetch-with-retry.mjs';

/** Historical assignment changes tracked by runZero (MIT). */
export const LINEAGE_SOURCE = {
  name: 'runZero mac-tracker',
  url: 'https://raw.githubusercontent.com/runZeroInc/mac-tracker/refs/heads/main/data/macs.json',
  homepage: 'https://github.com/runZeroInc/mac-tracker',
  license: 'MIT (runZero, Inc.; HD Moore; dutchcoders)',
};

/** Fetch the lineage history JSON, using the local cache when available. */
export async function fetchLineage({ cacheDir, force = false, fetchImpl = fetch } = {}) {
  const cachePath = path.join(cacheDir, 'macs.json');
  if (!force) {
    try {
      const cached = await readFile(cachePath, 'utf8');
      if (cached.trim() !== '') return { text: cached, fromCache: true };
    } catch {
      // cache miss
    }
  }

  const response = await fetchWithRetry(LINEAGE_SOURCE.url, {
    fetchImpl,
    headers: { 'user-agent': 'mac-address-lookup build' },
    attempts: 4,
    timeoutMs: 60_000,
  });
  if (!response.ok) {
    throw new Error(`Failed to fetch lineage (${LINEAGE_SOURCE.url}): ${response.status}`);
  }
  const text = await response.text();
  await mkdir(cacheDir, { recursive: true });
  await writeFile(cachePath, text);
  return { text, fromCache: false };
}
