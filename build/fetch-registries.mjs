import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fetchWithRetry } from './fetch-with-retry.mjs';
import { REGISTRIES } from './registries.mjs';

const USER_AGENT =
  'mac-address-lookup build (+https://github.com/jasontally/mac-address-lookup)';

async function loadRegistry(registry, { cacheDir, force, fetchImpl }) {
  const cachePath = path.join(cacheDir, registry.cacheFile);

  if (!force) {
    try {
      const cached = await readFile(cachePath, 'utf8');
      if (cached.trim() !== '') return { ...registry, text: cached, fromCache: true };
    } catch {
      // cache miss
    }
  }

  const response = await fetchWithRetry(registry.url, {
    fetchImpl,
    headers: { 'user-agent': USER_AGENT },
    attempts: 4,
    timeoutMs: 45_000,
  });
  const text = await response.text();
  await mkdir(cacheDir, { recursive: true });
  await writeFile(cachePath, text);
  return { ...registry, text, fromCache: false };
}

/**
 * Fetch every IEEE registry CSV in parallel, using the local cache when
 * available. Retries transient network failures so builds survive blips.
 */
export async function fetchRegistries({ cacheDir, force = false, fetchImpl = fetch } = {}) {
  return Promise.all(
    REGISTRIES.map((registry) => loadRegistry(registry, { cacheDir, force, fetchImpl })),
  );
}
