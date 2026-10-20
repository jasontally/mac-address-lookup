/**
 * Sitemap reader for the browser tests.
 *
 * The sitemap is a `<sitemapindex>` over chunk files once the set passes
 * 50,000 URLs, which it does at scope `all`. A test that reads `/sitemap.xml`
 * alone would then see only the chunk names, so this helper follows the index
 * and returns the pages as one set.
 *
 * The chunk names in the index are absolute, and they name the production
 * host. A test may run against another host, so each chunk is requested by
 * path and the base URL of the test resolves it.
 */

/** The path part of a sitemap loc, so a chunk is read from the host under test. */
function pathOf(loc) {
  return new URL(loc).pathname;
}

/** Every `<loc>` in the sitemap, across the index and its chunks. */
export async function sitemapLocs(request) {
  const response = await request.get('/sitemap.xml');
  if (response.status() !== 200) {
    throw new Error(`/sitemap.xml returned ${response.status()}`);
  }
  const xml = await response.text();
  const chunkUrls = [...xml.matchAll(/<loc>([^<]+)<\/loc>/g)].map((match) => match[1]);
  // A sitemapindex lists the chunks; a plain urlset lists the pages itself.
  if (!xml.includes('<sitemapindex')) return chunkUrls;

  const pages = [];
  for (const chunkUrl of chunkUrls) {
    const chunk = await request.get(pathOf(chunkUrl));
    if (chunk.status() !== 200) {
      throw new Error(`${pathOf(chunkUrl)} returned ${chunk.status()}`);
    }
    const text = await chunk.text();
    for (const match of text.matchAll(/<loc>([^<]+)<\/loc>/g)) pages.push(match[1]);
  }
  return pages;
}

/** The sitemap text of every chunk, for the assertions that read markup. */
export async function sitemapText(request) {
  const response = await request.get('/sitemap.xml');
  if (response.status() !== 200) {
    throw new Error(`/sitemap.xml returned ${response.status()}`);
  }
  const xml = await response.text();
  if (!xml.includes('<sitemapindex')) return xml;

  let text = xml;
  for (const match of xml.matchAll(/<loc>([^<]+)<\/loc>/g)) {
    const chunk = await request.get(pathOf(match[1]));
    if (chunk.status() !== 200) {
      throw new Error(`${pathOf(match[1])} returned ${chunk.status()}`);
    }
    text += await chunk.text();
  }
  return text;
}
