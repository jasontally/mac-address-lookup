/** Generate pre-rendered prefix pages plus the sitemap files. */

import { writeFile } from 'node:fs/promises';
import path from 'node:path';
import { renderPrefixPage } from './page-template.mjs';
import { selectPages } from './select-pages.mjs';
import { computeRelatedLinks } from './related.mjs';
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
    const html = renderPrefixPage({
      record,
      lineage: lineageByPrefix.get(record.prefix) ?? null,
      site,
      assets,
      related: related.get(record.prefix) ?? null,
      vendorHub: hubFor(record),
      countryHub: !record.isPrivate && record.country ? `/country/${record.country.toLowerCase()}` : null,
    });
    await writeFile(path.join(outDir, `${record.prefix}.html`), html);
  });

  const urls = [
    `${site}/`,
    ...extraUrls.map((url) => `${site}${url.startsWith('/') ? url : `/${url}`}`),
    ...selected.map((record) => `${site}/${record.prefix}`),
  ];
  const sitemap = await writeSitemaps({ urls, site, outDir, lastmod });

  return {
    selected: selected.length,
    dropped: dropped.length,
    selectedByType,
    droppedByType,
    sitemap,
  };
}
