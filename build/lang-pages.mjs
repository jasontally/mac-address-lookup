/**
 * Localized static home pages under /lang/{locale}/ plus the hreflang
 * clusters that declare them to search engines (docs/architecture.md →
 * "Multilingual discoverability plan").
 *
 * Scope note: only the home page ships a `/lang/` twin - its visible text
 * is entirely `data-i18n` UI strings (localized in all 30 locale tables)
 * plus an authored title/description pair per locale (src/i18n/discovery.mjs).
 * The help page's prose and FAQ are English-only in the repo, so it stays
 * a single URL until prose translations exist (a mostly-English page
 * claiming an hreflang variant is doorway-page risk).
 */

import { readFile, mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { SUPPORTED, RTL_LOCALES, loadLocale } from '../src/i18n/locales.mjs';
import { en } from '../src/i18n/en.mjs';
import { discoveryFor } from '../src/i18n/discovery.mjs';
import { SITE } from './page-template.mjs';

/**
 * The full alternate cluster for the home page set: English + every
 * locale + x-default (English serves visitors whose locale has no variant).
 */
export function homeAlternates({ site = 'https://mac.jasontally.com' } = {}) {
  const entries = [['en', `${site}/`]];
  for (const locale of SUPPORTED) {
    entries.push([locale, `${site}/lang/${locale}/`]);
  }
  entries.push(['x-default', `${site}/`]);
  return entries;
}

/** Render <link rel="alternate"> tags from an [hreflang, href] pair list. */
export function hreflangLinks(pairs, { indent = '    ' } = {}) {
  return pairs
    .map(
      ([lang, href]) =>
        `${indent}<link rel="alternate" hreflang="${lang}" href="${href.replace(/&/g, '&amp;')}" />`,
    )
    .join('\n');
}

function escapeTextHtml(value) {
  return String(value).replace(
    /[&<>]/g,
    (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' })[char],
  );
}

/**
 * Build-time translation of leaf text inside `data-i18n="key"` elements -
 * the server-side mirror of the client's `applyDom`, written for the
 * simple, well-formed chrome templates this build owns. Attribute-only
 * keys (data-i18n-title/-aria) stay English in the source; the client
 * bundle swaps those after boot. Missing keys keep their English text.
 */
export function i18nSwap(html, table) {
  return html.replace(
    /(<[a-zA-Z][^>]*?\sdata-i18n="([^"]*)"[^><]*>)([^<]*)/g,
    (match, open, key) => {
      const localized = table[key] ?? en[key];
      if (localized === undefined) return match;
      return open + escapeTextHtml(localized);
    },
  );
}

function withHtmlLang(html, locale) {
  const dir = RTL_LOCALES.has(locale) ? ' dir="rtl"' : '';
  return html.replace(/<html lang="en">/, `<html lang="${locale}"${dir}>`);
}

function attr(value) {
  return value.replace(/"/g, '&quot;');
}

/**
 * Replace a whole <meta> tag located by its `name=`/`property=` value.
 * Needed because the home shell's meta tags are multi-line.
 */
function metaTagByName(html, name) {
  const tags = html.match(/<meta\b[^>]*>/g) ?? [];
  return (
    tags.find((tag) => tag.includes(`name="${name}"`) || tag.includes(`property="${name}"`)) ?? null
  );
}

/** Localized <title>/<meta description>/og + canonical + hreflang cluster. */
function localizedHead(html, { locale, url, alternates }) {
  const discovery = discoveryFor(locale);
  let out = html
    .replace(/<title>[^<]*<\/title>/, `<title>${attr(discovery.title)}</title>`)
    .replace(/<link rel="canonical" href="[^"]*" \/>/, `<link rel="canonical" href="${url}" />`)
    .replace(
      /<meta property="og:url" content="[^"]*" \/>/,
      `<meta property="og:url" content="${url}" />`,
    );
  for (const [name, metaHtml] of [
    ['description', `<meta name="description" content="${attr(discovery.description)}" />`],
    ['og:title', `<meta property="og:title" content="${attr(discovery.title)}" />`],
    ['og:description', `<meta property="og:description" content="${attr(discovery.description)}" />`],
  ]) {
    const tag = metaTagByName(out, name);
    if (tag) out = out.replace(tag, metaHtml);
  }
  out = out.replace('</head>', `    ${hreflangLinks(alternates)}\n  </head>`);
  out = withHtmlLang(out, locale);
  // Tell the client bundle (i18n/index.mjs) which locale this page serves;
  // lower priority than the visitor's stored manual choice.
  return out.replace(
    '<script>',
    `<script>window.__malLocale='${locale}';</script>\n    <script>`,
  );
}

/**
 * Localize the pre-rendered home shell into dist/lang/{locale}/index.html
 * for every supported locale, and stamp the hreflang cluster onto the
 * canonical English home page.
 *
 * Must run after `buildStatic` (hashed asset tokens substituted) and after
 * recent/hub pages exist (any page may link home). Returns the sitemap
 * alternates entry for the URL set.
 */
export async function writeLangPages({ distDir, site = 'https://mac.jasontally.com' } = {}) {
  const homeHtml = await readFile(path.join(distDir, 'index.html'), 'utf8');
  const alternates = homeAlternates({ site });

  // The canonical English home declares its language variants too.
  if (!homeHtml.includes('rel="alternate" hreflang=')) {
    await writeFile(
      path.join(distDir, 'index.html'),
      homeHtml.replace('</head>', `    ${hreflangLinks(alternates)}\n  </head>`),
    );
  }

  await mkdir(path.join(distDir, 'lang'), { recursive: true });
  let written = 0;
  for (const locale of SUPPORTED) {
    const table = (await loadLocale(locale)) ?? en;
    const localized = i18nSwap(homeHtml, table);
    const outDir = path.join(distDir, 'lang', locale);
    await mkdir(outDir, { recursive: true });
    await writeFile(
      path.join(outDir, 'index.html'),
      localizedHead(localized, {
        locale,
        url: `${site}/lang/${locale}/`,
        alternates,
      }),
    );
    written += 1;
  }
  return {
    locales: SUPPORTED.length,
    written,
    sitemapEntry: {
      loc: `${site}/`,
      alternates,
    },
    urls: SUPPORTED.map((locale) => `${site}/lang/${locale}/`),
  };
}
