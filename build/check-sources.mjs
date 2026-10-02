/** Weekly source check: trigger a rebuild only when data changed (or monthly). */

import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { fetchWithRetry } from './fetch-with-retry.mjs';
import { fetchLiveSource } from './live-source.mjs';
import { compareSources, sha256, shouldRefresh } from './source-cache.mjs';
import { DEFAULT_SITE, SOURCE_FILES } from './source-files.mjs';

const root = fileURLToPath(new URL('..', import.meta.url));

// IEEE endpoints are flaky enough that a patient retry is needed here; the
// library defaults (3 attempts, 2s base delay) stay unchanged elsewhere.
const envNumber = (name, fallback) => {
  const value = Number(process.env[name]);
  return Number.isFinite(value) && value > 0 ? value : fallback;
};
const USER_AGENT =
  'mac-address-lookup build (+https://github.com/jasontally/mac-address-lookup)';

export async function currentSourceFiles(fetchImpl = fetch) {
  const attempts = envNumber('SOURCE_FETCH_ATTEMPTS', 5);
  const baseDelayMs = envNumber('SOURCE_FETCH_RETRY_DELAY_MS', 10_000);
  return Promise.all(
    SOURCE_FILES.map(async (source) => {
      const response = await fetchWithRetry(
        source.url,
        {
          fetchImpl,
          headers: { 'user-agent': USER_AGENT },
          attempts,
          timeoutMs: 60_000,
          baseDelayMs,
        },
        {
          // An upstream file that exhausts every retry must not block change
          // detection for the other files: serve its last deployed copy (from
          // the production site) and treat it as unchanged this run.
          fallback: () => fetchLiveSource(source.file, { fetchImpl }),
          label: source.name,
        },
      );
      const text = await response.text();
      return { file: source.file, sha256: sha256(text) };
    }),
  );
}

export async function fetchDeployedManifest(fetchImpl = fetch) {
  try {
    const response = await fetchWithRetry(`${DEFAULT_SITE}/data/sources-index.json`, {
      fetchImpl,
      attempts: 2,
      timeoutMs: 30_000,
    });
    return await response.json();
  } catch (error) {
    console.warn(`warning: could not read the deployed sources manifest (${error.message})`);
    return null;
  }
}

async function main() {
  const force = process.argv.includes('--force');
  const refreshPath = path.join(root, 'data', 'refresh.txt');
  const refreshDate = (await readFile(refreshPath, 'utf8')).trim();

  const [files, deployed] = await Promise.all([currentSourceFiles(), fetchDeployedManifest()]);
  const comparison = compareSources(files, deployed);
  if (comparison.changed) {
    console.log(`source changes: ${comparison.changedFiles.join(', ')}`);
  } else {
    console.log('source hashes match the deployed copy');
  }

  const decision = shouldRefresh({ changed: comparison.changed || force, refreshDate });
  if (decision.refresh) {
    const today = new Date().toISOString().slice(0, 10);
    if (refreshDate !== today) await writeFile(refreshPath, `${today}\n`);
    console.log(
      `refresh triggered (${force ? 'forced' : decision.reason}); refresh.txt -> ${today}`,
    );
  } else {
    console.log('no refresh needed; leaving refresh.txt unchanged');
  }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  main().catch((error) => {
    console.error(error);
    process.exitCode = 1;
  });
}
