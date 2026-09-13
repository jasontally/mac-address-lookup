import { strict as assert } from 'node:assert';
import test from 'node:test';
import { renderPrefixPage } from '../build/page-template.mjs';
import { chunkUrls, renderSitemapIndex, renderUrlSet } from '../build/generate-seo.mjs';

const record = {
  prefix: '001A2B',
  prefixLen: 24,
  blockType: 'MA-L',
  addressCount: 16_777_216,
  orgName: 'Intel Corporate',
  orgAddress: 'Lot 8, Jalan Hi-Tech 2/3 Kulim Kedah MY 09000',
  country: 'MY',
  isPrivate: false,
};

test('renderPrefixPage contains escaped vendor data, canonical URL, and valid JSON-LD', () => {
  const html = renderPrefixPage({ record, lineage: null, site: 'https://example.test' });

  assert.match(html, /<title>00:1A:2B — Intel Corporate \| MAC Address Lookup<\/title>/);
  assert.match(html, /<link rel="canonical" href="https:\/\/example\.test\/001A2B" \/>/);
  assert.match(html, /data-prerendered="true"/);
  assert.match(html, /data-hex="001A2B"/);
  assert.match(html, /Intel Corporate/);
  assert.match(html, /00:1A:2B:00:00:00 – 00:1A:2B:FF:FF:FF/);
  assert.match(html, /16,777,216/);
  assert.match(html, /data-copy="00:1A:2B"/);

  const jsonMatch = /<script type="application\/ld\+json">\s*([\s\S]*?)\s*<\/script>/.exec(html);
  assert.ok(jsonMatch, 'JSON-LD script is present');
  const jsonLd = JSON.parse(jsonMatch[1]);
  assert.equal(jsonLd['@type'], 'WebPage');
  assert.equal(jsonLd.url, 'https://example.test/001A2B');
  assert.equal(jsonLd.about.name, 'Intel Corporate');
});

test('renderPrefixPage escapes HTML in registry data', () => {
  const html = renderPrefixPage({
    record: {
      ...record,
      orgName: 'Acme <script>alert(1)</script> Corp',
      orgAddress: '1 <b>Road</b>',
    },
    site: 'https://example.test',
  });
  assert.ok(!html.includes('<script>alert(1)</script>'));
  assert.match(html, /Acme &lt;script&gt;alert\(1\)&lt;\/script&gt; Corp/);
  assert.ok(!html.includes('<b>Road</b>'));
});

test('renderPrefixPage includes lineage only for changed prefixes', () => {
  const unchanged = renderPrefixPage({ record, site: 'https://example.test' });
  assert.ok(!unchanged.includes('Prefix lineage'));

  const changed = renderPrefixPage({
    record,
    lineage: {
      firstSeen: '2000-09-08',
      events: [
        { date: '2000-09-08', orgName: 'TEKELEC' },
        { date: '2014-01-17', orgName: 'Oracle' },
      ],
    },
    site: 'https://example.test',
  });
  assert.match(changed, /Prefix lineage/);
  const tekelec = changed.indexOf('TEKELEC');
  const oracle = changed.indexOf('Oracle');
  assert.ok(tekelec !== -1 && oracle !== -1 && tekelec < oracle);
  assert.match(changed, /Sep 8, 2000/);
});

test('sitemap renderers escape URLs and chunk at the limit', () => {
  const urls = ['https://example.test/', 'https://example.test/001A2B?x=1&y=2'];
  const set = renderUrlSet(urls, { lastmod: '2026-09-12' });
  assert.match(set, /<loc>https:\/\/example\.test\/<\/loc>/);
  assert.match(set, /001A2B\?x=1&amp;y=2/);
  assert.match(set, /<lastmod>2026-09-12<\/lastmod>/);

  assert.deepEqual(chunkUrls([1, 2, 3, 4, 5], 2), [[1, 2], [3, 4], [5]]);
  assert.deepEqual(chunkUrls([], 2), []);

  const index = renderSitemapIndex([{ loc: 'https://example.test/sitemap-1.xml' }]);
  assert.match(index, /<sitemapindex/);
  assert.match(index, /sitemap-1\.xml/);
});
