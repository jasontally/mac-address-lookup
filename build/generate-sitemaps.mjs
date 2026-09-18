/** Sitemap rendering and writing. Pure renderers are exported for tests. */

import { writeFile } from 'node:fs/promises';
import path from 'node:path';

export const SITEMAP_URL_LIMIT = 50_000;

function escapeXml(value) {
  return String(value).replace(
    /[&<>"']/g,
    (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&apos;' })[char],
  );
}

/** Split URLs into sitemap-sized chunks. */
export function chunkUrls(urls, limit = SITEMAP_URL_LIMIT) {
  const chunks = [];
  for (let i = 0; i < urls.length; i += limit) chunks.push(urls.slice(i, i + limit));
  return chunks;
}

export function renderUrlSet(urls, { lastmod } = {}) {
  const entries = urls
    .map((entry) => {
      const item = typeof entry === 'string' ? { loc: entry } : entry;
      const mod = lastmod ? `\n    <lastmod>${escapeXml(lastmod)}</lastmod>` : '';
      const alternates = (item.alternates ?? [])
        .map(
          ([lang, href]) =>
            `\n    <xhtml:link rel="alternate" hreflang="${lang}" href="${escapeXml(href)}" />`,
        )
        .join('');
      return `  <url>\n    <loc>${escapeXml(item.loc)}</loc>${mod}${alternates}\n  </url>`;
    })
    .join('\n');
  return `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9" xmlns:xhtml="http://www.w3.org/1999/xhtml">\n${entries}\n</urlset>\n`;
}

export function renderSitemapIndex(entries, { lastmod } = {}) {
  const body = entries
    .map(
      ({ loc }) =>
        `  <sitemap>\n    <loc>${escapeXml(loc)}</loc>` +
        (lastmod ? `\n    <lastmod>${escapeXml(lastmod)}</lastmod>` : '') +
        `\n  </sitemap>`,
    )
    .join('\n');
  return `<?xml version="1.0" encoding="UTF-8"?>\n<sitemapindex xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${body}\n</sitemapindex>\n`;
}

/**
 * Write sitemap.xml (and chunk files when needed) into `outDir`.
 * A single urlset is written directly when the URL count fits one file.
 */
export async function writeSitemaps({ urls, site, outDir, lastmod }) {
  if (urls.length <= SITEMAP_URL_LIMIT) {
    await writeFile(path.join(outDir, 'sitemap.xml'), renderUrlSet(urls, { lastmod }));
    return { files: ['sitemap.xml'], urls: urls.length };
  }

  const chunks = chunkUrls(urls, SITEMAP_URL_LIMIT);
  const files = [];
  for (let index = 0; index < chunks.length; index++) {
    const name = `sitemap-${index + 1}.xml`;
    await writeFile(path.join(outDir, name), renderUrlSet(chunks[index], { lastmod }));
    files.push(name);
  }
  await writeFile(
    path.join(outDir, 'sitemap.xml'),
    renderSitemapIndex(
      files.map((name) => ({ loc: `${site}/${name}` })),
      { lastmod },
    ),
  );
  return { files: ['sitemap.xml', ...files], urls: urls.length };
}
