/**
 * Per-URL page hashes + lastmod bookkeeping.
 *
 * Every pre-rendered page is content-hashed at build time. The newest hash
 * map ships as `data/page-hashes.json`; the *next* build fetches it from
 * production, so sitemap `<lastmod>` per URL tracks its true last content
 * change across deploys — even as the sitemap grows from the current core
 * scope toward every page. Pages whose bytes did not change keep their old
 * lastmod instead of being stamped "today".
 *
 * Built for deterministic output: pages whose data did not change render
 * byte-for-byte identical, so the platform's content-hash dedupe uploads
 * only the files that actually changed.
 */

import { createHash } from 'node:crypto';
import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';

export const PAGE_HASHES_FILE = 'data/page-hashes.json';
export const PAGE_HASHES_SCHEMA = 1;

export function sha1Hex(text) {
  return createHash('sha1').update(text).digest('hex');
}

/** Record wrapper: read one deployed HTML file and track it by canonical URL. */
export async function recordDistFile(tracker, { distDir, distRelativePath, site }) {
  const pathUrl = distPathToUrl(distRelativePath);
  if (!pathUrl) return null;
  const html = await readFile(path.join(distDir, distRelativePath), 'utf8');
  tracker.record(`${site.replace(/\/$/, '')}${pathUrl}`, html);
  return `${site.replace(/\/$/, '')}${pathUrl}`;
}

/**
 * Map a deployed HTML file's dist-relative path (POSIX separators) to its
 * canonical site URL, or null for non-page files.
 *   index.html            -> /
 *   app.html              -> /app
 *   lang/ja/index.html    -> /lang/ja/
 *   vendor/apple-inc.html -> /vendor/apple-inc
 */
export function distPathToUrl(distRelativePath) {
  if (!distRelativePath.endsWith('.html')) return null;
  const posix = distRelativePath.split(path.sep).join('/');
  if (posix === 'index.html') return '/';
  // lang/{locale}/index.html -> /lang/{locale}/  (the only index-in-dir pages)
  const langTwin = /^(?:lang)\/([^/]+)\/index\.html$/.exec(posix);
  if (langTwin) return `/lang/${langTwin[1]}/`;
  if (posix === 'lang/index.html') return null;
  const withoutExt = posix.replace(/\.html$/, '');
  return `/${withoutExt}`;
}

/** Inverse of distPathToUrl for record-by-URL callers. */
export function urlToDistPath(url) {
  if (!url) return null;
  if (url === '/') return 'index.html';
  if (url.endsWith('/')) return `${url.replace(/^\/|\/$/g, '')}/index.html`;
  return `${url.replace(/^\//, '')}.html`;
}

/**
 * Build-time tracker for rendered pages. `previous` is the parsed
 * data/page-hashes.json manifest from the currently deployed site (or null
 * on the first build or when the fetch fails). `lastmodFor` resolves
 * lazily, so the sitemap writer can query it the moment every page is
 * recorded.
 *
 * Renderers use `priorLastmod(url)` to embed the page's own last-change
 * date (footer freshness line + JSON-LD `dateModified`), then re-record:
 * if the re-render still differs from the deployed bytes, the page is
 * re-rendered once with `refreshDate`, keeping the embedded date, the
 * JSON-LD, and the sitemap `<lastmod>` for that URL consistent — and
 * untouched while the page really hasn't changed.
 */
export function createPageTracker({ previous = null, refreshDate }) {
  const hashes = new Map(); // canonical URL → sha1 of the rendered HTML

  return {
    record(url, html) {
      hashes.set(url, sha1Hex(html));
    },
    /** The deployed manifest's entry for this URL (hash + lastmod), or null. */
    prior(url) {
      return previous?.pages?.[url] ?? null;
    },
    /** The URL's last recorded lastmod from the deployed site, or null. */
    priorLastmod(url) {
      return previous?.pages?.[url]?.m ?? null;
    },
    /**
     * True when this build's recorded bytes differ from the deployed page's
     * bytes (or the page is new — callers treat new pages as current-dated,
     * so no re-render is needed there).
     */
    changedSince(url) {
      const hash = hashes.get(url);
      const prior = previous?.pages?.[url];
      if (!prior) return false;
      return prior.h !== hash;
    },
    has(url) {
      return hashes.has(url);
    },
    get size() {
      return hashes.size;
    },
    /** [url, hash] pairs in insertion order, for the finalizer. */
    entries() {
      return hashes.entries();
    },
    /**
     * Per-URL sitemap lastmod: the page's own previous lastmod when its
     * bytes are unchanged, otherwise this build's refresh date.
     */
    lastmodFor(url) {
      const hash = hashes.get(url);
      const prior = previous?.pages?.[url];
      return prior && prior.h === hash ? prior.m : refreshDate;
    },
    hash(url) {
      return hashes.get(url) ?? null;
    },
  };
}

/**
 * Read the deployed hash manifest so a build can tell which pages actually
 * changed. Failures (local dev, network error, first deploy) degrade
 * gracefully: every URL simply reports the current refresh date.
 */
export async function loadPreviousPageHashes({
  site,
  fetchImpl = fetch,
  attempts = 2,
  timeoutMs = 30_000,
} = {}) {
  try {
    const response = await fetchImpl(`${site.replace(/\/$/, '')}/${PAGE_HASHES_FILE}`, {
      signal: AbortSignal.timeout(timeoutMs),
    });
    if (!response.ok) {
      return { previous: null, warning: `page-hashes fetch returned ${response.status}` };
    }
    const parsed = await response.json();
    if (parsed?.schemaVersion !== PAGE_HASHES_SCHEMA || typeof parsed?.pages !== 'object') {
      return { previous: null, warning: 'page-hashes manifest has an unsupported schema' };
    }
    return { previous: parsed, warning: null };
  } catch (error) {
    if (error?.name === 'AbortError') {
      return { previous: null, warning: 'page-hashes fetch timed out' };
    }
    return { previous: null, warning: error.message };
  }
}

/** Serialize the merged manifest atomically and return its stats.
 *
 * Also writes `data/indexnow.json`: the URLs whose bytes changed this build
 * (sorted for byte stability), intersected with the current sitemap scope
 * when `sitemapUrlSet` is provided, so the post-deploy IndexNow ping
 * (build/indexnow.mjs) notifies exactly the pages the sitemap promotes.
 */
export async function finalizePageHashes({ tracker, previous, refreshDate, outDir, sitemapUrlSet = null }) {
  const merged = {};
  const pairs = [...tracker.entries()].sort((a, b) => (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0));
  const changedUrls = [];
  const inScope = sitemapUrlSet ? new Set(sitemapUrlSet) : null;
  for (const [url, hash] of pairs) {
    const prior = previous?.pages?.[url];
    merged[url] = { h: hash, m: prior && prior.h === hash ? prior.m : refreshDate };
    if ((!prior || prior.h !== hash) && (!inScope || inScope.has(url))) changedUrls.push(url);
  }
  const payload = `${JSON.stringify({ schemaVersion: PAGE_HASHES_SCHEMA, refreshDate, pages: merged })}\n`;
  await writeFile(path.join(outDir, PAGE_HASHES_FILE), payload);
  const indexnowPayload = `${JSON.stringify({ urls: changedUrls })}\n`;
  await writeFile(path.join(outDir, 'data', 'indexnow.json'), indexnowPayload);
  return {
    urls: Object.keys(merged).length,
    bytes: Buffer.byteLength(payload),
    changedUrls: changedUrls.length,
  };
}
