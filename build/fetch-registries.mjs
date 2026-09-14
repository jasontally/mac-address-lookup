import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fetchWithRetry } from './fetch-with-retry.mjs';
import { REGISTRIES } from './registries.mjs';

const USER_AGENT =
  'mac-address-lookup build (+https://github.com/jasontally/mac-address-lookup)';

async function loadRegistry(
  registry,
  { cacheDir, force, fetchImpl, fallbackBaseUrl, attempts, timeoutMs, baseDelayMs },
) {
  const cachePath = path.join(cacheDir, registry.cacheFile);

  if (!force) {
    try {
      const cached = await readFile(cachePath, 'utf8');
      if (cached.trim() !== '') {
        return { ...registry, text: cached, fromCache: true, fromFallback: false };
      }
    } catch {
      // cache miss
    }
  }

  const save = async (text, fromFallback) => {
    await mkdir(cacheDir, { recursive: true });
    await writeFile(cachePath, text);
    return { ...registry, text, fromCache: false, fromFallback };
  };

  try {
    const response = await fetchWithRetry(registry.url, {
      fetchImpl,
      headers: { 'user-agent': USER_AGENT },
      attempts,
      timeoutMs,
      baseDelayMs,
    });
    return save(await response.text(), false);
  } catch (error) {
    if (!fallbackBaseUrl) throw error;
    console.warn(
      `  warning: ${registry.name} upstream failed (${error.message}); fetching the live cache`,
    );
    const response = await fetchWithRetry(`${fallbackBaseUrl}/data/sources/${registry.cacheFile}`, {
      fetchImpl,
      headers: { 'user-agent': USER_AGENT },
      attempts: 3,
      timeoutMs: 60_000,
    });
    return save(await response.text(), true);
  }
}

/**
 * Fetch every IEEE registry CSV in parallel, using the local cache when
 * available. Retries transient failures, then falls back to the raw copy
 * deployed with the live site so an IEEE outage cannot block builds.
 */
export async function fetchRegistries({
  cacheDir,
  force = false,
  fetchImpl = fetch,
  fallbackBaseUrl = undefined,
  attempts = 4,
  timeoutMs = 45_000,
  baseDelayMs = 2_000,
} = {}) {
  return Promise.all(
    REGISTRIES.map((registry) =>
      loadRegistry(registry, {
        cacheDir,
        force,
        fetchImpl,
        fallbackBaseUrl,
        attempts,
        timeoutMs,
        baseDelayMs,
      }),
    ),
  );
}
