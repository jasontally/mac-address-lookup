import { strict as assert } from 'node:assert';
import test from 'node:test';
import { renderPrefixPage } from '../build/page-template.mjs';
import { computeRelatedLinks } from '../build/related.mjs';
import { chunkUrls, renderSitemapIndex, renderUrlSet } from '../build/generate-sitemaps.mjs';

const record = {
  prefix: '001A2B',
  prefixLen: 24,
  blockType: 'MA-L',
  addressCount: 16_777_216,
  orgName: 'Intel Corporate',
  orgAddress: 'Lot 8, Jalan Hi-Tech 2/3 Kulim Kedah MY 09000',
  country: 'MY',
  isPrivate: false,
  firstSeen: '2003-09-08',
};

test('renderPrefixPage contains escaped vendor data, canonical URL, and valid JSON-LD', () => {
  const html = renderPrefixPage({
    record,
    lineage: null,
    site: 'https://example.test',
    assets: { appFile: '/assets/app.abc123.js', cssFile: '/assets/app.abc123.css' },
  });

  assert.match(html, /<title>00:1A:2B — Intel Corporate \| MAC Address Lookup<\/title>/);
  assert.match(html, /<link rel="canonical" href="https:\/\/example\.test\/001A2B" \/>/);
  assert.match(html, /\/assets\/app\.abc123\.css/);
  assert.match(html, /\/assets\/app\.abc123\.js/);
  assert.match(html, /data-prerendered="true"/);
  assert.match(html, /data-hex="001A2B"/);
  assert.match(html, /Intel Corporate/);
  assert.match(html, /00:1A:2B:00:00:00 – 00:1A:2B:FF:FF:FF/);
  assert.match(html, /16,777,216/);
  assert.match(html, /First registered/);
  assert.match(html, /Sep 8, 2003/);
  assert.match(html, /data-copy="00:1A:2B"/);

  const jsonMatch = /<script type="application\/ld\+json">\s*([\s\S]*?)\s*<\/script>/.exec(html);
  assert.ok(jsonMatch, 'JSON-LD script is present');
  const jsonLd = JSON.parse(jsonMatch[1]);
  assert.equal(jsonLd['@type'], 'WebPage');
  assert.equal(jsonLd.url, 'https://example.test/001A2B');
  assert.equal(jsonLd.about.name, 'Intel Corporate');
});

test('agent discovery trial exposes a visible absolute shard link only on its pilot page', () => {
  const pilot = { ...record, prefix: '8C1F64AFA', prefixLen: 36, blockType: 'MA-S' };
  const html = renderPrefixPage({ record: pilot, site: 'https://example.test' });
  const note = html.match(/<p class="section-note" data-agent-shard>([\s\S]*?)<\/p>/)?.[1];
  assert.ok(note, 'agent note is present in static HTML');
  assert.match(note, /Agents: fetch this URL/);
  assert.match(note, /href="https:\/\/example\.test\/data\/registry\/8c1f64af\.txt">https:\/\/example\.test\/data\/registry\/8c1f64af\.txt<\/a>/);
  assert.match(note, /one JSON object per line/);
  assert.ok(html.indexOf('data-agent-shard') > html.indexOf('id="result"'));
  assert.ok(html.indexOf('data-agent-shard') < html.indexOf('<footer'));
  assert.doesNotMatch(renderPrefixPage({ record }), /data-agent-shard/);
});

test('renderPrefixPage adds breadcrumb JSON-LD', () => {
  const masRecord = { ...record, prefix: '001A2B0C1', prefixLen: 36, blockType: 'MA-S' };
  const html = renderPrefixPage({ record: masRecord, site: 'https://example.test' });

  const scripts = [
    ...html.matchAll(/<script type="application\/ld\+json">\s*([\s\S]*?)\s*<\/script>/g),
  ].map((match) => JSON.parse(match[1]));
  const breadcrumb = scripts.find((entry) => entry['@type'] === 'BreadcrumbList');
  assert.ok(breadcrumb, 'breadcrumb JSON-LD is present');
  assert.equal(breadcrumb.itemListElement.length, 2);
  assert.equal(breadcrumb.itemListElement[0].item, 'https://example.test/');
  assert.equal(breadcrumb.itemListElement[1].name, '00:1A:2B:0C:1');
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

const related = {
  sameOrg: [
    { prefix: '001A2C', orgName: 'Intel Corporate' },
    { prefix: '001A2D', orgName: 'Intel Corporate' },
  ],
  adjacent: [{ prefix: '001A2A', orgName: 'Other Org' }],
  sameYear: [{ prefix: '001B21', orgName: 'Raspberry Pi' }],
};

test('renderPrefixPage renders related-link sections inside #result', () => {
  const html = renderPrefixPage({ record, related, site: 'https://example.test' });

  assert.match(html, /data-related="sameOrg"/);
  assert.match(html, /data-related="adjacent"/);
  assert.match(html, /data-related="sameYear"/);
  assert.match(html, /More blocks from<\/span> <span class="related-org-name">Intel Corporate<\/span>/);
  assert.match(
    html,
    /<a href="\/001A2A"><code>00:1A:2A<\/code><\/a><span class="related-org">Other Org<\/span>/,
  );
  assert.match(html, /Adjacent prefixes/);
  assert.match(html, /Registered the same year/);
  // Related sections must sit inside #result so a new lookup clears them.
  const resultStart = html.indexOf('<section id="result"');
  const relatedStart = html.indexOf('data-related="sameOrg"');
  const bodyEnd = html.indexOf('<footer');
  assert.ok(relatedStart > resultStart && relatedStart < bodyEnd);
});

test('renderPrefixPage renders a hub link only when a vendor hub exists', () => {
  const withHub = renderPrefixPage({ record, related, site: 'https://example.test' });
  assert.ok(!withHub.includes('View all prefixes')); // no hub passed yet

  const linked = renderPrefixPage({
    record,
    related,
    vendorHub: { url: '/vendor/intel-corporate', blocks: 667 },
    site: 'https://example.test',
  });
  assert.match(linked, /<a href="\/vendor\/intel-corporate" data-i18n="portfolio.viewAll">View all prefixes<\/a>/);
});

test('renderPrefixPage escapes related-link org names', () => {
  const html = renderPrefixPage({
    record,
    related: { ...related, adjacent: [{ prefix: '001A2A', orgName: 'Acme <b>Corp</b>' }] },
    site: 'https://example.test',
  });
  assert.ok(!html.includes('<b>Corp</b>'));
  assert.match(html, /Acme &lt;b&gt;Corp&lt;\/b&gt;/);
});

test('renderPrefixPage omits empty related groups and empty related payload', () => {
  const html = renderPrefixPage({
    record,
    related: { sameOrg: [], adjacent: [], sameYear: [] },
    site: 'https://example.test',
  });
  assert.ok(!html.includes('data-related='));

  const none = renderPrefixPage({ record, site: 'https://example.test' });
  assert.ok(!none.includes('data-related='));
});
