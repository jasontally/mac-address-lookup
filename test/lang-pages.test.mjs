import { strict as assert } from 'node:assert';
import test from 'node:test';
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { generatePages, sitemapUrlSelection } from '../build/generate-pages.mjs';
import { homeAlternates, hreflangLinks, i18nSwap, writeLangPages } from '../build/lang-pages.mjs';
import { renderUrlSet } from '../build/generate-sitemaps.mjs';

test('i18nSwap translates leaf data-i18n texts and escapes injected markup', () => {
  const html = `<p><span data-i18n="footer.help">Help &amp; documentation</span></p>
<table><th scope="col" data-i18n="table.prefix">Prefix</th></table>
<th data-i18n="detail.missing.key">Fallback stays</th>`;
  const swapped = i18nSwap(html, { 'footer.help': 'Ayuda y documentación', 'table.prefix': '<b>Préfixe</b>' });
  assert.match(swapped, /Ayuda y documentación/);
  assert.match(swapped, /&lt;b&gt;Préfixe&lt;\/b&gt;/, 'table values are escaped, not raw HTML');
  assert.match(swapped, /Fallback stays/, 'missing keys keep the source English');
  assert.doesNotMatch(swapped, /Help &amp; documentation/);
});

test('homeAlternates lists English, every locale, and x-default', () => {
  const pairs = homeAlternates({ site: 'https://example.test' });
  assert.equal(pairs[0][0], 'en');
  assert.equal(pairs[0][1], 'https://example.test/');
  const last = pairs[pairs.length - 1];
  assert.deepEqual(last, ['x-default', 'https://example.test/']);
  assert.ok(pairs.some(([lang, href]) => lang === 'es' && href === 'https://example.test/lang/es/'));
  assert.ok(pairs.some(([lang, href]) => lang === 'zh-Hans' && href === 'https://example.test/lang/zh-Hans/'));
  const links = hreflangLinks(pairs);
  assert.match(links, /<link rel="alternate" hreflang="x-default" href="https:\/\/example\.test\/" \/>/);
  assert.match(links, /hreflang="ja" href="https:\/\/example\.test\/lang\/ja\/"/);
});

test('writeLangPages renders localized, hreflang-stamped homes into dist/lang/', async () => {
  const dist = await mkdtemp(path.join(os.tmpdir(), 'mal-lang-'));
  try {
    // Minimal stand-in for the built home shell (tokens already substituted
    // by buildStatic before writeLangPages runs).
    await mkdir(path.join(dist, 'lang'), { recursive: true }).catch(() => {});
    await writeFile(
      path.join(dist, 'index.html'),
      `<!doctype html><html lang="en"><head><title>MAC Address Lookup — Vendor &amp; OUI Lookup</title>
<meta
      name="description"
      content="Free, private MAC address lookup. Paste a full or partial MAC address or OUI to identify the vendor, IEEE block details, randomization, virtualization, and prefix lineage — all in your browser."
    />
<meta property="og:title" content="MAC Address Lookup — Vendor &amp; OUI Lookup" />
<meta
      property="og:description"
      content="Identify the vendor behind any full or partial MAC address. IEEE block details, randomization detection, virtualization, and prefix lineage — all in your browser."
    />
<link rel="canonical" href="https://example.test/" />
<meta property="og:url" content="https://example.test/" />
<script>boot</script></head>
<body><span data-i18n="lookup.submit">Look up</span></body></html>`,
    );
    const result = await writeLangPages({ distDir: dist, site: 'https://example.test' });
    assert.equal(result.locales, 30);
    assert.equal(result.written, 30);
    assert.equal(result.urls.length, 30);

    const es = await readFile(path.join(dist, 'lang', 'es', 'index.html'), 'utf8');
    assert.match(es, /<html lang="es">/);
    assert.match(es, /<title>Buscador de direcciones/);
    // Multi-line English meta tags are fully replaced, not left in English.
    assert.match(es, /<meta name="description" content="Buscador gratuito y privado/);
    assert.match(es, /<meta property="og:description" content="Buscador gratuito/);
    assert.doesNotMatch(es, /Free, private MAC address lookup/);
    assert.match(es, /rel="canonical" href="https:\/\/example\.test\/lang\/es\/"/);
    assert.match(es, /hreflang="x-default"/);
    assert.match(es, /hreflang="en" href="https:\/\/example\.test\/"/);
    assert.match(es, /window\.__malLocale='es'/);
    assert.match(es, /Buscar|Consultar/); // es lookup.submit applied

    const ar = await readFile(path.join(dist, 'lang', 'ar', 'index.html'), 'utf8');
    assert.match(ar, /<html lang="ar" dir="rtl">/);

    // The canonical English home got the cluster stamped onto it too.
    const home = await readFile(path.join(dist, 'index.html'), 'utf8');
    assert.match(home, /hreflang="x-default"/);
    assert(!home.includes('window.__malLocale'), 'canonical home keeps clean env');
  } finally {
    await rm(dist, { recursive: true, force: true });
  }
});

test('renderUrlSet emits xhtml:link alternates for lang entries', () => {
  const xml = renderUrlSet([
    'https://example.test/recent',
    {
      loc: 'https://example.test/',
      alternates: [
        ['en', 'https://example.test/'],
        ['es', 'https://example.test/lang/es/'],
        ['x-default', 'https://example.test/'],
      ],
    },
  ]);
  assert.match(xml, /xmlns:xhtml="http:\/\/www\.w3\.org\/1999\/xhtml"/);
  assert.match(xml, /<xhtml:link rel="alternate" hreflang="es" href="https:\/\/example\.test\/lang\/es\/" \/>/);
  assert.match(xml, /<loc>https:\/\/example\.test\/<\/loc>/);
  assert.equal((xml.match(/<url>/g) ?? []).length, 2);
});

test('all sitemap scopes include the lang URLs, prefix pages only in all', () => {
  const core = ['https://e/'];
  const lang = ['https://e/lang/es/'];
  const hubs = ['https://e/vendor/intel'];
  const countries = ['https://e/country/us'];
  const prefixes = ['https://e/001A2B'];
  const withCountry = { coreUrls: core, langUrls: lang, hubUrls: hubs, countryUrls: countries, prefixUrls: prefixes };
  assert.deepEqual(sitemapUrlSelection({ scope: 'core', ...withCountry }), [
    ...core,
    ...lang,
  ]);
  assert.deepEqual(sitemapUrlSelection({ scope: 'country', ...withCountry }), [
    ...core,
    ...lang,
    ...countries,
  ]);
  assert.deepEqual(sitemapUrlSelection({ scope: 'hubs', ...withCountry }), [
    ...core,
    ...lang,
    ...hubs,
    ...countries,
  ]);
  assert.deepEqual(sitemapUrlSelection({ scope: 'all', ...withCountry }), [
    ...core,
    ...lang,
    ...hubs,
    ...countries,
    ...prefixes,
  ]);
});
