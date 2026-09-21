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
 * "Sitemap indexing plan"). `all` keeps the current behavior; `hubs` drops
 * the 58,694 prefix pages; `core` keeps only the homepage, /help, and /recent.
 * Pages remain live and internally linked in every scope - the sitemap is a
 * discovery hint and dropping rows cannot deindex anything.
 */
export function sitemapUrlSelection({
  scope = 'all',
  coreUrls = [],
  langUrls = [],
  hubUrls = [],
  prefixUrls = [],
} = {}) {
  if (scope === 'core') return [...coreUrls, ...langUrls];
  if (scope === 'hubs') return [...coreUrls, ...langUrls, ...hubUrls];
  if (scope === 'all') return [...coreUrls, ...langUrls, ...hubUrls, ...prefixUrls];
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
  langUrls = [],
  sitemapScope = 'all',
  homeUrl = null,
  assets = { appFile: '/assets/app.js', cssFile: '/assets/app.css' },
  hubIndex = null,
}) {
  const { selected, dropped, selectedByType, droppedByType } = selectPages(records, {
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
    const html = renderPrefixPage({
      record,
      lineage: lineageByPrefix.get(record.prefix) ?? null,
      site,
      assets,
      related: related.get(record.prefix) ?? null,
      vendorHub,
      countryHub: !record.isPrivate && record.country ? `/country/${record.country.toLowerCase()}` : null,
      enrich: buildEnrichment(record, { orgFirstSeen: vendorHub?.firstSeen ?? null }),
      formerHub: hubIndex?.formerHub ? hubIndex.formerHub(record.orgName) : null,
    });
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
    prefixUrls: selected.map((record) => `${site}/${record.prefix}`),
  });
  const sitemap = await writeSitemaps({ urls, site, outDir, lastmod });

  return {
    selected: selected.length,
    dropped: dropped.length,
    selectedByType,
    droppedByType,
    sitemap,
  };
}
