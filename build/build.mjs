import { mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { fetchRegistries } from './fetch-registries.mjs';
import { fetchLineage, LINEAGE_SOURCE } from './fetch-lineage.mjs';
import { buildFirstSeen, buildLineage, countLineageEvents, normalizeOrgName } from './lineage.mjs';
import { normalizeRegistries } from './normalize.mjs';
import { writeLineageParquet, writeRegistryParquet, writeSearchParquet, writeShardParquets } from './write-parquet.mjs';
import { writeSourceCache } from './source-cache.mjs';
import { DEFAULT_SITE } from './source-files.mjs';
import { checkBudget, formatBytes, walkDir } from './budget.mjs';
import { buildStatic } from './copy-static.mjs';
import { generatePages } from './generate-pages.mjs';
import { computeHubs, computeFormerHubs, writeHubPages } from './hubs.mjs';
import { selectPages } from './select-pages.mjs';
import { writeAgentFiles } from './agent-files.mjs';
import { writeLangPages } from './lang-pages.mjs';
import { writeRecentPage } from './recent.mjs';
import { writeDimensionPages } from './dimensions.mjs';
import { datasetDateRange } from './timeline.mjs';
import { createPageTracker, finalizePageHashes, loadPreviousPageHashes, recordDistFile, urlToDistPath } from './page-hashes.mjs';
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
// refresh.txt bumps whenever the data-refresh action detects an upstream
// change (or monthly). Every timestamp that used to be "build now" reads
// this instead so identical inputs yield byte-identical outputs.
const refreshDate = (await readFile(path.join(root, 'data', 'refresh.txt'), 'utf8')).trim();

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
        retrievedAt: refreshDate,
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

// Hub populations (docs/thin-content-mitigation.md step 2): org-grouping and
// slug assignment run before Parquet writes so every row can carry its
// vendor hub slug (`vendor_hub` column) for dynamic deep links. Hub *files*
// are written later, after the static assets exist.
const hubData = computeHubs(records);
const hubByKey = new Map(hubData.orgs.map((hub) => [hub.key, hub]));
const hubSlugByKey = new Map(hubData.orgs.map((hub) => [hub.key, hub.slug]));
for (const record of records) {
  record.vendorHub = record.isPrivate
    ? null
    : (hubSlugByKey.get(normalizeOrgName(record.orgName)) ?? null);
}
// Former-owner hubs: every organization that no longer holds a prefix it was
// once registered to (docs/thin-content-mitigation.md; requests 2026-09-16).
const formerHubData = computeFormerHubs(lineageEntries, { vendors: hubByKey });
const recordsByPrefix = new Map(records.map((record) => [record.prefix, record]));
const timelineRange = datasetDateRange(records);

const hubIndex = {
  vendorHub: (record) => {
    const hub = hubByKey.get(normalizeOrgName(record.orgName));
    return hub
      ? { url: hub.url, blocks: hub.blocks, firstSeen: hub.firstSeen }
      : null;
  },
  formerHub: (orgName) => {
    const hub = (formerHubData?.byKey ?? new Map()).get(normalizeOrgName(orgName));
    return hub ? hub.url : null;
  },
};

// Deploy the raw sources: an emergency cache for future builds and the
// baseline the weekly change-detection workflow diffs against.
const sourceCache = await writeSourceCache(
  [
    ...sources.map((source) => ({ file: source.cacheFile, text: source.text })),
    ...(lineageText ? [{ file: 'macs.json', text: lineageText }] : []),
  ],
  { outDir: dataDir, generatedAt: refreshDate },
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

const search = await writeSearchParquet(records, { outDir: dataDir });
console.log(`  ${search.filename} (${formatBytes(search.bytes)})`);

const manifest = {
  schemaVersion: 1,
  generatedAt: refreshDate,
  refreshDate,
  data: {
    file: `data/${parquet.filename}`,
    bytes: parquet.bytes,
    sha256: parquet.sha256,
  },
  search: {
    file: `data/${search.filename}`,
    bytes: search.bytes,
    sha256: search.sha256,
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

// Localized home variants + hreflang clusters (Multilingual discoverability plan).
const SITE = 'https://mac.jasontally.com';
const langPages = await writeLangPages({ distDir, site: SITE });
console.log(
  `  lang pages: /lang/{locale}/ in ${langPages.written} locales`,
);

// Per-URL lastmod bookkeeping (docs/architecture.md → "Punctuation policy"
// notes the byte-stable pages contract): hash every rendered page up front,
// compare against the deployed manifest from production, and let the
// sitemap carry each URL's true last-change date.
const { previous: previousPageHashes, warning: pageHashWarning } = await loadPreviousPageHashes({
  site: process.env.PAGE_HASHES_SITE_URL ?? SITE,
});
if (pageHashWarning) console.log(`  page-hashes: ${pageHashWarning}`);
const pageTracker = createPageTracker({ previous: previousPageHashes, refreshDate });
await recordDistFile(pageTracker, { distDir, distRelativePath: 'index.html', site: SITE });
for (const url of langPages.urls) {
  await recordDistFile(pageTracker, {
    distDir,
    distRelativePath: urlToDistPath(new URL(url).pathname) ?? '',
    site: SITE,
  });
}
await recordDistFile(pageTracker, { distDir, distRelativePath: 'help.html', site: SITE });

const pageBudget = Number(process.env.PAGE_BUDGET ?? 90_000);
// Page selection runs once, before any hub page is written: country pages
// link single-block orgs to the page of their only block, and those links
// must only ever target pre-rendered pages (the budget decides that).
// generatePages renders this same selection.
const vendorPriority = JSON.parse(
  await readFile(path.join(root, 'build', 'vendor-priority.json'), 'utf8'),
);
const pageSelection = selectPages(records, { pageBudget, vendorPriority });
const selectedPrefixes = new Set(pageSelection.selected.map((record) => record.prefix));

let sitemapUrlSet = null;
if (!flags.has('--no-pages')) {
  console.log(
    `Generating ${hubData.orgs.length.toLocaleString('en-US')} vendor, ` +
      `${hubData.countries.length.toLocaleString('en-US')} country, and ` +
      `${formerHubData.formers.length.toLocaleString('en-US')} former-owner hub pages...`,
  );
  const hubWriteStartedAt = Date.now();
  const hubFiles = await writeHubPages({
    hubData,
    outDir: distDir,
    assets: staticAssets,
    formerData: formerHubData,
    recordsByPrefix,
    pageTracker,
    site: SITE,
    refreshDate,
    selectedPrefixes,
    timelineRange,
  });

  console.log('Generating registry, year, region, history, and successor pages...');
  const dimensions = await writeDimensionPages({
    records,
    lineageEntries,
    formerData: { ...formerHubData, vendors: hubData.orgs },
    timelineRange,
    outDir: distDir,
    assets: staticAssets,
    pageTracker,
    site: SITE,
    refreshDate,
    selectedPrefixes,
  });
  const dimensionIndexUrls = [
    ...dimensions.registryIndexUrls,
    ...dimensions.yearIndexUrls,
    ...dimensions.regionIndexUrls,
    ...dimensions.historyIndexUrls,
    ...dimensions.historyCountryIndexUrls,
    ...dimensions.successorIndexUrls,
  ];
  const dimensionUrls = [
    ...dimensions.registryUrls,
    ...dimensions.yearUrls,
    ...dimensions.regionUrls,
    ...dimensions.historyUrls,
    ...dimensions.historyCountryUrls,
    ...dimensions.successorUrls,
  ];

  // /recent before the sitemap: it reports its own lastmod inside
  const recentUrl = `${SITE}/recent`;
  const recentPriorDate = pageTracker?.priorLastmod(recentUrl) ?? (pageTracker ? refreshDate : null);
  const recent = await writeRecentPage({
    distDir,
    records,
    assets: staticAssets,
    dataUpdated: recentPriorDate,
  });
  await recordDistFile(pageTracker, { distDir, distRelativePath: 'recent.html', site: SITE });
  if (pageTracker?.changedSince(recentUrl)) {
    await writeRecentPage({
      distDir,
      records,
      assets: staticAssets,
      dataUpdated: refreshDate,
    });
    await recordDistFile(pageTracker, { distDir, distRelativePath: 'recent.html', site: SITE });
  }
  console.log(
    `  /recent: ${recent.length} newest blocks, first ${recent[0]?.prefix ?? 'n/a'} (${recent[0]?.firstSeen ?? ''})`,
  );

  console.log(
    `  hubs in ${((Date.now() - hubWriteStartedAt) / 1000).toFixed(1)}s ` +
      `(${hubFiles.vendorUrls.length} vendor, ${hubFiles.countryUrls.length} country)`,
  );

  console.log(`Generating up to ${pageBudget.toLocaleString('en-US')} prefix pages...`);
  const pagesStartedAt = Date.now();
  // Phased sitemap (docs/architecture.md → "Sitemap indexing plan"): the
  // 62,760-URL index diluted discovery against the handful of pages we most
  // want indexed (home, help, hubs). Scopes compose:
  //   core (home/help/recent + localized homes)
  //   country (phase 2, the default: + the 127 /country/ hubs)
  //   hubs (+ vendor and former-owner hubs) → all (everything)
  // Expand with SITEMAP_SCOPE once Search Console shows the current phase
  // indexed. Pages stay live and internally linked in every scope.
  const sitemapScope = process.env.SITEMAP_SCOPE ?? 'country';
  console.log(`Sitemap scope: ${sitemapScope}`);
  const pages = await generatePages({
    records,
    lineageEntries,
    site: 'https://mac.jasontally.com',
    outDir: distDir,
    pageBudget,
    vendorPriority,
    lastmod: refreshDate,
    extraUrls: ['/help', '/recent'],
    hubUrls: [...hubFiles.vendorUrls, ...hubFiles.formerUrls, ...dimensionUrls],
    // The two rollups lead the country set: /country is the parent of the 127
    // country pages, /vendor of the vendor pages (which join a later scope),
    // and both are the indexes the country scope should surface first.
    rollupUrls: [
      hubFiles.countryIndexUrl,
      hubFiles.vendorIndexUrl,
      ...dimensionIndexUrls,
    ],
    countryUrls: hubFiles.countryUrls,
    dimensionUrls,
    sitemapScope,
    homeUrl: langPages.sitemapEntry,
    langUrls: langPages.urls,
    assets: staticAssets,
    hubIndex,
    pageTracker,
    selection: pageSelection,
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
  sitemapUrlSet = pages.sitemapUrlSet;
}

const agentFiles = await writeAgentFiles({
  distDir,
  records,
  lineageEvents: lineageEntries.flatMap((entry) =>
    entry.events.map((event, index) => ({
      prefix: entry.prefix,
      date: event.date,
      orgName: event.orgName,
      seq: index,
    })),
  ),
});
console.log(
  `  agent files: llms.txt, help.md, registry.ndjson (${formatBytes(agentFiles.registryBytes)}), ` +
    `lineage.ndjson (${formatBytes(agentFiles.lineageBytes)})`,
);

const pageHashes = await finalizePageHashes({
  tracker: pageTracker,
  previous: previousPageHashes,
  refreshDate,
  outDir: distDir,
  sitemapUrlSet,
});
console.log(`  page hashes: ${pageHashes.urls} URLs (${formatBytes(pageHashes.bytes)})`);
console.log(`  pages changed this build: ${pageHashes.changedUrls.toLocaleString('en-US')}`);

const files = await walkDir(distDir);
const budget = checkBudget({ files });
for (const warning of budget.warnings) console.log(`  warning: ${warning}`);
if (budget.errors.length > 0) {
  for (const error of budget.errors) console.error(`  error: ${error}`);
  process.exitCode = 1;
} else {
  console.log(
    `Budget OK: ${budget.stats.files} files, ${budget.stats.pages} pages ` +
      `(prefixes ${budget.stats.pagesByType.prefixes} · vendor ${budget.stats.pagesByType.vendor} · ` +
      `country ${budget.stats.pagesByType.country} · former ${budget.stats.pagesByType.former} · ` +
      `registry ${budget.stats.pagesByType.registry} · year ${budget.stats.pagesByType.year} · ` +
      `region ${budget.stats.pagesByType.region} · history ${budget.stats.pagesByType.history} · ` +
      `successor ${budget.stats.pagesByType.successor}), ` +
      `${formatBytes(budget.stats.totalBytes)} total`,
  );
}

console.log(`Done in ${((Date.now() - startedAt) / 1000).toFixed(1)}s`);
