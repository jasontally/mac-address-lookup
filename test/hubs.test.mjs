import { strict as assert } from 'node:assert';
import test from 'node:test';
import {
  assignSlugs,
  computeHubs,
  displayNameOf,
  renderCountryHubPage,
  renderOrgHubPage,
  writeHubPages,
} from '../build/hubs.mjs';
import { slugifyOrg } from '../src/engine/slugs.mjs';

const ASSETS = {
  appFile: '/assets/app.test.js',
  cssFile: '/assets/app.test.css',
  workerFile: '/assets/parquet-worker.js',
};

const record = (prefix, orgName, extras = {}) => ({
  prefix,
  prefixLen: 24,
  blockType: 'MA-L',
  addressCount: 16_777_216,
  orgName,
  orgAddress: '1 Main St',
  country: 'US',
  isPrivate: false,
  firstSeen: '2005-01-05',
  lineageCount: 0,
  ...extras,
});

test('slugifyOrg collapses non-alphanumerics and caps length', () => {
  assert.equal(slugifyOrg('Apple Inc.'), 'apple-inc');
  assert.equal(slugifyOrg('  Router Choice "--//GmbH '), 'router-choice-gmbh');
  assert.equal(slugifyOrg('中文'), '');
  assert.equal(slugifyOrg('A'.repeat(100)), 'a'.repeat(80));
});

test('hub grouping matches portfolio keys and skips private/empty/single-block orgs', () => {
  const records = [
    record('000001', 'Apple Inc.'),
    record('000002', 'Apple Inc,'), // same normalized key
    record('000003'), // empty org
    record('000004', 'Private s.r.o.', { isPrivate: true }),
    record('000005', 'Solo Vendor'), // single block, no hub
    record('000006', 'Solo Vendor', { isPrivate: true }),
  ];
  const { orgs } = computeHubs(records);
  assert.equal(orgs.length, 1);
  assert.equal(orgs[0].key, 'APPLE INC');
  assert.equal(orgs[0].blocks, 2);
  assert.equal(orgs[0].slug, 'apple-inc');
  assert.equal(orgs[0].url, '/vendor/apple-inc');
});

test('displayNameOf picks the most frequent spelling, ties to the smallest', () => {
  assert.equal(displayNameOf(new Map([['Apple Inc.', 5], ['Apple Inc', 2]])), 'Apple Inc.');
  assert.equal(displayNameOf(new Map([['B Co', 2], ['A Co', 2]])), 'A Co');
});

test('slug collisions resolve deterministically, first claim keeps the bare slug', () => {
  // Hyphens survive normalizeOrgName, so these are two distinct orgs whose
  // display names reduce to the same slug.
  const base = [
    record('000001', 'Acme Corp'),
    record('000002', 'Acme Corp'),
    record('000003', 'Acme-Corp'),
    record('000004', 'Acme-Corp'),
    record('000005', 'Solo, Inc.'),
  ];
  const make = (records) => computeHubs(records).orgs;
  const firstRun = make(base);
  assert.equal(firstRun.length, 2);
  assert.equal(firstRun[0].slug, 'acme-corp'); // key 'ACME CORP' < 'ACME-CORP'
  assert.equal(firstRun[1].slug, 'acme-corp-2');

  const serialize = (orgs) => orgs.map((hub) => `${hub.key}=${hub.slug}`).join('|');
  assert.equal(serialize(firstRun), serialize(make([...base].reverse())));

  assignSlugs(firstRun); // rewriting slugs stays stable
  assert.equal(firstRun[0].slug, 'acme-corp');
});

const orgHub = {
  key: 'APPLE INC',
  slug: 'apple-inc',
  url: '/vendor/apple-inc',
  displayName: 'Apple Inc.',
  blocks: 2,
  addresses: 33_554_432,
  firstSeen: '2005-01-05',
  lastSeen: '2010-01-05',
  countryCodes: ['US'],
  records: [
    record('000001', 'Apple Inc.'),
    record('000002', 'Apple Inc.'),
  ],
};

test('renderOrgHubPage renders the complete table without caps', () => {
  const records = Array.from({ length: 1200 }, (_, i) => record(`0000${String(i).padStart(4, '0')}`, 'Apple Inc.'));
  const hub = { ...orgHub, blocks: 1200, records };
  const html = renderOrgHubPage({ hub, assets: ASSETS, site: 'https://example.test' });

  assert.match(html, /<title>Apple Inc\. MAC address blocks \| MAC Address Lookup<\/title>/);
  assert.match(html, /rel="canonical" href="https:\/\/example\.test\/vendor\/apple-inc"/);
  assert.match(html, /data-static-page="true"/);
  assert.match(html, /CollectionPage/);
  assert.match(html, /"name":"Apple Inc."/);
  assert.match(html, /BreadcrumbList/);
  assert.equal((html.match(/<tr>/g) ?? []).length, 1201, 'header row plus all 1200 rows');
  assert.match(html, /1200 blocks registered to/, 'lede states the full total');
  assert.ok(!html.includes('showing the first'), 'no truncation notice');
});

test('renderOrgHubPage links country hubs and the free-text search', () => {
  const html = renderOrgHubPage({ hub: orgHub, assets: ASSETS, site: 'https://example.test' });
  assert.match(html, /href="\/country\/us"/);
  assert.match(html, /href="\/Apple%20Inc\.">Free-text search<\/a>/);
});

test('renderCountryHubPage lists orgs sorted by address space, linking hubs', () => {
  const countryHub = {
    code: 'US',
    blocks: 3,
    addresses: 50_331_648,
    orgs: new Map([
      [
        'BIG CO',
        {
          key: 'BIG CO',
          displayName: 'Big Co',
          blocks: 2,
          addresses: 33_554_432,
          firstSeen: '2001-01-01',
          slug: 'big-co',
          nameCounts: new Map([['Big Co', 2]]),
          records: [record('000001', 'Big Co'), record('000002', 'Big Co')],
        },
      ],
      [
        'SMALL CO',
        {
          key: 'SMALL CO',
          displayName: 'Small Co',
          blocks: 1,
          addresses: 16_777_216,
          firstSeen: '2005-01-05',
          slug: null,
          nameCounts: new Map([['Small Co', 1]]),
          records: [record('000003', 'Small Co')],
        },
      ],
    ]),
  };
  const html = renderCountryHubPage({ hub: countryHub, assets: ASSETS, site: 'https://example.test' });

  assert.match(html, /rel="canonical" href="https:\/\/example\.test\/country\/us"/);
  assert.match(html, /<title>United States MAC address blocks \| MAC Address Lookup<\/title>/);
  const bigIndex = html.indexOf('href="/vendor/big-co"');
  const smallIndex = html.indexOf('Small Co</a>'.replace('</a>', ''));
  assert.ok(bigIndex !== -1);
  assert.ok(smallIndex !== -1);
  assert.ok(bigIndex < smallIndex, 'sorted by address space, hub-linked org first');
  assert.match(html, /data-i18n="table.blocks"/);
});

test('writeHubPages writes nested files and reports relative URLs', async () => {
  const { mkdtemp } = await import('node:fs/promises');
  const { tmpdir } = await import('node:os');
  const { join } = await import('node:path');
  const dir = await mkdtemp(join(tmpdir(), 'hubs-'));
  const data = {
    orgs: [orgHub],
    countries: [
      {
        code: 'US',
        blocks: 2,
        addresses: 33_554_432,
        orgs: new Map([
          ['APPLE INC', { key: 'APPLE INC', displayName: 'Apple Inc.', slug: 'apple-inc', blocks: 2, addresses: 33_554_432, firstSeen: '2005-01-05', nameCounts: new Map([['Apple Inc.', 2]]), records: [] }],
        ]),
      },
    ],
  };
  const result = await writeHubPages({ hubData: data, outDir: dir, assets: ASSETS });
  assert.deepEqual(result.vendorUrls, ['/vendor/apple-inc']);
  assert.deepEqual(result.countryUrls, ['/country/us']);
  const { readFile } = await import('node:fs/promises');
  const vendorHtml = await readFile(join(dir, 'vendor', 'apple-inc.html'), 'utf8');
  assert.match(vendorHtml, /MAC Address Lookup/);
});
