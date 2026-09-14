/** Weekly source check: trigger a rebuild only when data changed (or monthly). */

import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { fetchWithRetry } from './fetch-with-retry.mjs';
import { compareSources, sha256, shouldRefresh } from './source-cache.mjs';
import { DEFAULT_SITE, SOURCE_FILES } from './source-files.mjs';

const root = fileURLToPath(new URL('..', import.meta.url));

export async function currentSourceFiles(fetchImpl = fetch) {
  return Promise.all(
    SOURCE_FILES.map(async (source) => {
      const response = await fetchWithRetry(source.url, {
        fetchImpl,
        attempts: 3,
        timeoutMs: 60_000,
      });
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
