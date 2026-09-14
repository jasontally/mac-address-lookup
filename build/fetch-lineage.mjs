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

const CACHE_FILE = 'macs.json';
const USER_AGENT = 'mac-address-lookup build';

/**
 * Fetch the lineage history JSON, using the local cache when available and
 * falling back to the live site's raw copy when the upstream source fails.
 */
export async function fetchLineage({
  cacheDir,
  force = false,
  fetchImpl = fetch,
  fallbackBaseUrl = undefined,
} = {}) {
  const cachePath = path.join(cacheDir, CACHE_FILE);

  if (!force) {
    try {
      const cached = await readFile(cachePath, 'utf8');
      if (cached.trim() !== '') return { text: cached, fromCache: true, fromFallback: false };
    } catch {
      // cache miss
    }
  }

  const save = async (text, fromFallback) => {
    await mkdir(cacheDir, { recursive: true });
    await writeFile(cachePath, text);
    return { text, fromCache: false, fromFallback };
  };

  try {
    const response = await fetchWithRetry(LINEAGE_SOURCE.url, {
      fetchImpl,
      headers: { 'user-agent': USER_AGENT },
      attempts: 4,
      timeoutMs: 60_000,
    });
    return save(await response.text(), false);
  } catch (error) {
    if (!fallbackBaseUrl) throw error;
    console.warn(
      `  warning: lineage upstream failed (${error.message}); fetching the live cache`,
    );
    const response = await fetchWithRetry(`${fallbackBaseUrl}/data/sources/${CACHE_FILE}`, {
      fetchImpl,
      headers: { 'user-agent': USER_AGENT },
      attempts: 3,
      timeoutMs: 60_000,
    });
    return save(await response.text(), true);
  }
}
