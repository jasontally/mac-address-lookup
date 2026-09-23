/** Generate pre-rendered prefix pages plus the sitemap files. */

import { writeFile } from 'node:fs/promises';
import path from 'node:path';
import { renderPrefixPage } from './page-template.mjs';
import { selectPages } from './select-pages.mjs';
import { computeRelatedLinks } from './related.mjs';
import { buildEnrichment } from './enrich.mjs';
import { writeSitemaps } from './generate-sitemaps.mjs';

async function mapConcurrent(items, limit, fn) {
  let index = 0;
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (true) {
      const current = index++;
      if (current >= items.length) return;
      await fn(items[current]);
    }
  });
  await Promise.all(workers);
}

/**
 * Sitemap scoping for the phased index plan (docs/architecture.md →
 * "Sitemap indexing plan"). Scopes compose cumulatively:
 *   `core`    → home, /help, /recent + the localized homes
 *   `country` → `core` + the /country and /vendor rollup indexes and the 249
 *               /country/<code> hubs (the indexes lead the set)
 *   `hubs`    → `core` + every hub (vendor + country + former-owner)
 *   `all`     → everything, including the ~58,700 prefix pages
 * Pages remain live and internally linked in every scope - the sitemap is a
 * discovery hint and dropping rows cannot deindex anything.
 */
export function sitemapUrlSelection({
  scope = 'all',
  coreUrls = [],
  langUrls = [],
  rollupUrls = [],
  hubUrls = [],
  countryUrls = [],
  prefixUrls = [],
} = {}) {
  const base = [...coreUrls, ...langUrls];
  if (scope === 'core') return base;
  // The /country and /vendor rollup indexes lead every hub-carrying scope.
  if (scope === 'country') return [...base, ...rollupUrls, ...countryUrls];
  if (scope === 'hubs') return [...base, ...rollupUrls, ...hubUrls, ...countryUrls];
  if (scope === 'all') return [...base, ...rollupUrls, ...hubUrls, ...countryUrls, ...prefixUrls];
  throw new Error(`Unknown sitemap scope: ${scope}`);
}

/**
 * Select pages within the budget, render them as flat `<PREFIX>.html` files,
 * and write sitemap.xml (+ chunks) covering the home page and every page.
 */
export async function generatePages({
  records,
  lineageEntries = [],
  site,
  outDir,
  pageBudget = 90_000,
  vendorPriority = {},
  lastmod,
  extraUrls = [],
  hubUrls = [],
  rollupUrls = [],
  countryUrls = [],
  langUrls = [],
  sitemapScope = 'all',
  homeUrl = null,
  assets = { appFile: '/assets/app.js', cssFile: '/assets/app.css' },
  hubIndex = null,
  pageTracker = null,
  // Pre-computed page selection (build.mjs picks pages before it writes the
  // hub pages, so country-hub links can already honour the budget). When
  // omitted (tests, callers with no hubs) the pages are selected here.
  selection = null,
}) {
  const { selected, dropped, selectedByType, droppedByType } =
    selection ??
    selectPages(records, {
      pageBudget,
      vendorPriority,
    });

  const lineageByPrefix = new Map(lineageEntries.map((entry) => [entry.prefix, entry]));

  const related = computeRelatedLinks(selected);
  const hubFor = hubIndex
    ? (record) => hubIndex.vendorHub(record) ?? null
    : () => null;

  await mapConcurrent(selected, 64, async (record) => {
    const vendorHub = hubFor(record);
    const render = (dataUpdated) =>
      renderPrefixPage({
        record,
        lineage: lineageByPrefix.get(record.prefix) ?? null,
        site,
        assets,
        related: related.get(record.prefix) ?? null,
        vendorHub,
        countryHub: !record.isPrivate && record.country ? `/country/${record.country.toLowerCase()}` : null,
        enrich: buildEnrichment(record, { orgFirstSeen: vendorHub?.firstSeen ?? null }),
        formerHub: hubIndex?.formerHub ? hubIndex.formerHub(record.orgName) : null,
        dataUpdated,
      });
    const url = `${site.replace(/\/$/, '')}/${record.prefix}`;
    // Two-pass date embedding (docs/architecture.md → "Per-page change dates"):
    // unchanged pages render with their prior last-change date so their bytes
    // stay identical; pages that really changed re-render with this build's
    // refresh date, keeping footer date, JSON-LD dateModified, and sitemap
    // lastmod consistent. Pages with no tracker (tests) render dateless.
    const priorDate = pageTracker?.priorLastmod(url) ?? (pageTracker ? lastmod : null);
    let html = render(priorDate);
    pageTracker?.record(url, html);
    if (pageTracker?.changedSince(url)) {
      html = render(lastmod);
      pageTracker.record(url, html);
    }
    await writeFile(path.join(outDir, `${record.prefix}.html`), html);
  });

  const urls = sitemapUrlSelection({
    scope: sitemapScope,
    coreUrls: [
      homeUrl ?? `${site}/`,
      ...extraUrls.map((url) => `${site}${url.startsWith('/') ? url : `/${url}`}`),
    ],
    langUrls,
    hubUrls: hubUrls.map((url) => `${site}${url.startsWith('/') ? url : `/${url}`}`),
    rollupUrls: rollupUrls.map((url) => `${site}${url.startsWith('/') ? url : `/${url}`}`),
    countryUrls: countryUrls.map((url) => `${site}${url.startsWith('/') ? url : `/${url}`}`),
    prefixUrls: selected.map((record) => `${site}/${record.prefix}`),
  });
  const sitemap = await writeSitemaps({ urls, site, outDir, lastmod, lastmodFor: pageTracker?.lastmodFor ?? null });

  return {
    selected: selected.length,
    dropped: dropped.length,
    selectedByType,
    droppedByType,
    sitemap,
    // The exact URLs this build's sitemap covers (entry.loc of every entry) —
    // the IndexNow manifest intersects the changed pages with this set, so
    // the ping follows the same phased scope contract as the sitemap.
    sitemapUrlSet: urls.map((entry) => (typeof entry === 'string' ? entry : entry.loc)),
  };
}
