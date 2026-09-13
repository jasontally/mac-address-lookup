import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { REGISTRIES } from './registries.mjs';

const USER_AGENT =
  'mac-address-lookup build (+https://github.com/jasontally/mac-address-lookup)';

/**
 * Fetch every IEEE registry CSV, using a local cache when available.
 * A fresh cache is used unless `force` is set, so builds are reproducible offline.
 */
export async function fetchRegistries({ cacheDir, force = false, fetchImpl = fetch } = {}) {
  const results = [];
  for (const registry of REGISTRIES) {
    const cachePath = path.join(cacheDir, registry.cacheFile);
    let text = null;
    let fromCache = false;

    if (!force) {
      try {
        const cached = await readFile(cachePath, 'utf8');
        if (cached.trim() !== '') {
          text = cached;
          fromCache = true;
        }
      } catch {
        // cache miss
      }
    }

    if (text === null) {
      const response = await fetchImpl(registry.url, {
        headers: { 'user-agent': USER_AGENT },
      });
      if (!response.ok) {
        throw new Error(
          `Failed to fetch ${registry.name} (${registry.url}): ${response.status} ${response.statusText}`,
        );
      }
      text = await response.text();
      await mkdir(cacheDir, { recursive: true });
      await writeFile(cachePath, text);
    }

    results.push({ ...registry, text, fromCache });
  }
  return results;
}
