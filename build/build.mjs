import { mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { fetchRegistries } from './fetch-registries.mjs';
import { fetchLineage, LINEAGE_SOURCE } from './fetch-lineage.mjs';
import { buildFirstSeen, buildLineage, countLineageEvents, normalizeOrgName } from './lineage.mjs';
import { normalizeRegistries } from './normalize.mjs';
import { writeLineageParquet, writeRegistryParquet, writeShardParquets } from './write-parquet.mjs';
import { writeSourceCache } from './source-cache.mjs';
import { DEFAULT_SITE } from './source-files.mjs';
import { checkBudget, formatBytes, walkDir } from './budget.mjs';
import { buildStatic } from './copy-static.mjs';
import { buildHomePage } from './generate-home.mjs';
import { generatePages } from './generate-pages.mjs';
import { REGISTRIES } from './registries.mjs';

const root = fileURLToPath(new URL('..', import.meta.url));
const distDir = path.join(root, 'dist');
const dataDir = path.join(distDir, 'data');
const cacheDir = path.join(root, 'build', '.cache');

const flags = new Set(process.argv.slice(2));
const force = flags.has('--force');
const skipLineage = flags.has('--no-lineage');
const fallbackBaseUrl = flags.has('--no-fallback') ? undefined : DEFAULT_SITE;

const startedAt = Date.now();

// Rebuild from a clean output so removed pages never linger in the deploy.
await rm(distDir, { recursive: true, force: true });

console.log('Fetching IEEE registries...');
const sources = await fetchRegistries({ cacheDir, force, fallbackBaseUrl });
for (const source of sources) {
  const origin = source.fromFallback ? 'live-cache' : source.fromCache ? 'cached' : 'fetched';
  console.log(`  ${source.name.padEnd(5)} ${origin}  ${source.text.length} bytes`);
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

// Global vendor totals, carried on every record so a single shard can report
// correct portfolio stats without loading the full registry.
const portfolios = new Map();
for (const record of records) {
  const key = normalizeOrgName(record.orgName);
  if (key === '') continue;
  const entry = portfolios.get(key) ?? { blocks: 0, addresses: 0 };
  entry.blocks += 1;
  entry.addresses += record.addressCount ?? 0;
  portfolios.set(key, entry);
}
for (const record of records) {
  const entry = portfolios.get(normalizeOrgName(record.orgName));
  record.vendorBlocks = entry?.blocks ?? null;
  record.vendorAddresses = entry?.addresses ?? null;
}

await mkdir(dataDir, { recursive: true });

let lineage = null;
let lineageEntries = [];
let firstSeen = new Map();
let lineageCounts = new Map();
let lineageText = null;
if (!skipLineage) {
  try {
    console.log(`Fetching lineage (${LINEAGE_SOURCE.name})...`);
    const historyText = await fetchLineage({ cacheDir, force, fallbackBaseUrl });
    lineageText = historyText.text;
    const origin = historyText.fromFallback ? 'live-cache' : historyText.fromCache ? 'cached' : 'fetched';
    console.log(`  macs.json ${origin}  ${historyText.text.length} bytes`);
    const history = JSON.parse(historyText.text);
    lineageEntries = buildLineage(history);
    firstSeen = buildFirstSeen(history);
    lineageCounts = countLineageEvents(lineageEntries);
    console.log(`  first-seen dates for ${firstSeen.size.toLocaleString('en-US')} prefixes`);
    const lineageParquet = await writeLineageParquet(lineageEntries, { outDir: dataDir });
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

// Join the earliest observed date and lineage event count into the registry
// table so a single shard can drive both display and lazy lineage loading.
for (const record of records) {
  record.firstSeen = firstSeen.get(record.prefix) ?? null;
  record.lineageCount = lineageCounts.get(record.prefix) ?? 0;
}

// Deploy the raw sources: an emergency cache for future builds and the
// baseline the weekly change-detection workflow diffs against.
const sourceCache = await writeSourceCache(
  [
    ...sources.map((source) => ({ file: source.cacheFile, text: source.text })),
    ...(lineageText ? [{ file: 'macs.json', text: lineageText }] : []),
  ],
  { outDir: dataDir },
);
console.log(
  `  source cache: ${sourceCache.files.length} files (${formatBytes(sourceCache.bytes)}), ` +
    `hash ${sourceCache.sourceHash.slice(0, 12)}`,
);

console.log('Writing Parquet...');
const parquet = await writeRegistryParquet(records, { outDir: dataDir });
console.log(`  ${parquet.filename} (${formatBytes(parquet.bytes)})`);

const shards = await writeShardParquets(records, { outDir: dataDir });
console.log(`  shards: ${shards.count} files (${formatBytes(shards.bytes)} total)`);

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
  shards: shards.files,
  counts: {
    total: stats.total,
    private: stats.privateCount,
    byType: Object.fromEntries(
      Object.entries(stats.perRegistry).map(([name, registryStats]) => [name, registryStats.kept]),
    ),
  },
  sourcesHash: sourceCache.sourceHash,
  sources: REGISTRIES.map((registry) => registry.url),
};
if (lineage) manifest.lineage = lineage;
await writeFile(path.join(dataDir, 'manifest.json'), `${JSON.stringify(manifest, null, 2)}\n`);
console.log('  data/manifest.json');

console.log('Building static site...');
const staticAssets = await buildStatic({ root, distDir });
console.log(
  `  ${staticAssets.appFile} ${formatBytes(staticAssets.appBytes)}, ` +
    `${staticAssets.cssFile} ${formatBytes(staticAssets.cssBytes)}`,
);

const home = await buildHomePage({ root, distDir, assets: staticAssets });
console.log(`  index.html ${formatBytes(home.bytes)} (FAQ content + schema injected)`);

const pageBudget = Number(process.env.PAGE_BUDGET ?? 90_000);
if (!flags.has('--no-pages')) {
  console.log(`Generating up to ${pageBudget.toLocaleString('en-US')} prefix pages...`);
  const vendorPriority = JSON.parse(
    await readFile(path.join(root, 'build', 'vendor-priority.json'), 'utf8'),
  );
  const pagesStartedAt = Date.now();
  const pages = await generatePages({
    records,
    lineageEntries,
    site: 'https://mac.jasontally.com',
    outDir: distDir,
    pageBudget,
    vendorPriority,
    lastmod: refreshDate,
    assets: staticAssets,
  });
  console.log(
    `  ${pages.selected.toLocaleString('en-US')} pages in ` +
      `${((Date.now() - pagesStartedAt) / 1000).toFixed(1)}s` +
      (pages.dropped > 0 ? `, ${pages.dropped} dropped by budget` : '') +
      ` (${Object.entries(pages.selectedByType)
        .map(([type, count]) => `${type} ${count}`)
        .join(', ')})`,
  );
  console.log(`  sitemap: ${pages.sitemap.files.join(', ')} (${pages.sitemap.urls} URLs)`);
}

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
