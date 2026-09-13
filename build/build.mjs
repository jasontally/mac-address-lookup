import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { fetchRegistries } from './fetch-registries.mjs';
import { normalizeRegistries } from './normalize.mjs';
import { writeRegistryParquet } from './write-parquet.mjs';
import { checkBudget, formatBytes, walkDir } from './budget.mjs';
import { REGISTRIES } from './registries.mjs';

const root = fileURLToPath(new URL('..', import.meta.url));
const distDir = path.join(root, 'dist');
const dataDir = path.join(distDir, 'data');
const cacheDir = path.join(root, 'build', '.cache');

const flags = new Set(process.argv.slice(2));
const force = flags.has('--force');

const startedAt = Date.now();

console.log('Fetching IEEE registries...');
const sources = await fetchRegistries({ cacheDir, force });
for (const source of sources) {
  console.log(`  ${source.name.padEnd(5)} ${source.fromCache ? 'cached' : 'fetched'}  ${source.text.length} bytes`);
}

console.log('Normalizing...');
const { records, stats } = normalizeRegistries(sources);
for (const [name, registryStats] of Object.entries(stats.perRegistry)) {
  console.log(
    `  ${name.padEnd(5)} ${String(registryStats.kept).padStart(6)} kept` +
      (registryStats.skipped ? `, ${registryStats.skipped} skipped` : ''),
  );
}
if (stats.duplicates.length > 0) {
  console.log(`  duplicates skipped: ${stats.duplicates.length}`);
}

await mkdir(dataDir, { recursive: true });
console.log('Writing Parquet...');
const parquet = await writeRegistryParquet(records, { outDir: dataDir });
console.log(`  ${parquet.filename} (${formatBytes(parquet.bytes)})`);

const refreshDate = (await readFile(path.join(root, 'data', 'refresh.txt'), 'utf8')).trim();
const manifest = {
  schemaVersion: 1,
  generatedAt: new Date().toISOString(),
  refreshDate,
  data: {
    file: `data/${parquet.filename}`,
    bytes: parquet.bytes,
    sha256: parquet.sha256,
  },
  counts: {
    total: stats.total,
    private: stats.privateCount,
    byType: Object.fromEntries(
      Object.entries(stats.perRegistry).map(([name, registryStats]) => [name, registryStats.kept]),
    ),
  },
  sources: REGISTRIES.map((registry) => registry.url),
};
await writeFile(path.join(dataDir, 'manifest.json'), `${JSON.stringify(manifest, null, 2)}\n`);
console.log('  data/manifest.json');

const files = await walkDir(distDir);
const budget = checkBudget({ files });
for (const warning of budget.warnings) console.log(`  warning: ${warning}`);
if (budget.errors.length > 0) {
  for (const error of budget.errors) console.error(`  error: ${error}`);
  process.exitCode = 1;
} else {
  console.log(
    `Budget OK: ${budget.stats.files} files, ${budget.stats.pages} pages, ` +
      `${formatBytes(budget.stats.totalBytes)} total`,
  );
}

console.log(`Done in ${((Date.now() - startedAt) / 1000).toFixed(1)}s`);
