import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { fetchRegistries } from './fetch-registries.mjs';
import { fetchLineage, LINEAGE_SOURCE } from './fetch-lineage.mjs';
import { buildLineage } from './lineage.mjs';
import { normalizeRegistries } from './normalize.mjs';
import { writeLineageParquet, writeRegistryParquet } from './write-parquet.mjs';
import { checkBudget, formatBytes, walkDir } from './budget.mjs';
import { REGISTRIES } from './registries.mjs';

const root = fileURLToPath(new URL('..', import.meta.url));
const distDir = path.join(root, 'dist');
const dataDir = path.join(distDir, 'data');
const cacheDir = path.join(root, 'build', '.cache');

const flags = new Set(process.argv.slice(2));
const force = flags.has('--force');
const skipLineage = flags.has('--no-lineage');

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

let lineage = null;
if (!skipLineage) {
  try {
    console.log(`Fetching lineage (${LINEAGE_SOURCE.name})...`);
    const historyText = await fetchLineage({ cacheDir, force });
    console.log(`  macs.json ${historyText.fromCache ? 'cached' : 'fetched'}  ${historyText.text.length} bytes`);
    const entries = buildLineage(JSON.parse(historyText.text));
    const lineageParquet = await writeLineageParquet(entries, { outDir: dataDir });
    console.log(
      `  ${lineageParquet.filename} (${formatBytes(lineageParquet.bytes)}): ` +
        `${lineageParquet.prefixes} prefixes, ${lineageParquet.events} events`,
    );
    lineage = {
      file: `data/${lineageParquet.filename}`,
      bytes: lineageParquet.bytes,
      sha256: lineageParquet.sha256,
      prefixes: lineageParquet.prefixes,
      events: lineageParquet.events,
      source: {
        name: LINEAGE_SOURCE.name,
        url: LINEAGE_SOURCE.url,
        homepage: LINEAGE_SOURCE.homepage,
        license: LINEAGE_SOURCE.license,
        retrievedAt: new Date().toISOString(),
      },
    };
  } catch (error) {
    console.warn(`  warning: lineage unavailable, continuing without it (${error.message})`);
  }
}

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
if (lineage) manifest.lineage = lineage;
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
