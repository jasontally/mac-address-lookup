import { strict as assert } from 'node:assert';
import test from 'node:test';
import {
  assignSlugs,
  computeFormerHubs,
  computeHubs,
  displayNameOf,
  renderCountryHubPage,
  renderFormerHubPage,
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
  assert.equal((html.match(/<tr/g) ?? []).length, 1201, 'header row plus all 1200 rows, count via <tr prefix');
  assert.equal((html.match(/<tr hidden>/g) ?? []).length, 700, 'rows past the initial batch ship hidden');
  assert.match(html, /00001199/, 'late rows carry real prefixes');
  assert.match(html, /1200 blocks registered to/, 'lede states the full total');
  assert.match(html, /Showing the first 500 of 1200/, 'display-cap note states the total');
  assert.match(html, /data-i18n="hub.rowsCount" data-i18n-params='\{"shown":500,"total":1200\}'/, 'the count note is a translated span');
  // Complete data is still in the source: the last row exists.
  assert.match(html, /<a href="\/00001199">/);
});

test('renderOrgHubPage links country hubs and the free-text search', () => {
  const html = renderOrgHubPage({ hub: orgHub, assets: ASSETS, site: 'https://example.test' });
  assert.match(html, /href="\/country\/us"/);
  assert.match(html, /href="\/Apple%20Inc\."[^>]*>Free-text search<\/a>/);
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

test('computeFormerHubs rolls up takeovers and skips single-prefix former orgs', () => {
  const lineage = [
    {
      prefix: '000017',
      prefixLen: 24,
      firstSeen: '2000-09-08',
      lastSeen: '2014-01-17',
      events: [
        { date: '2000-09-08', orgName: 'TEKELEC' },
        { date: '2014-01-17', orgName: 'Oracle' },
      ],
    },
    {
      prefix: '00001A',
      firstSeen: '1995-01-01',
      events: [
        { date: '1995-01-01', orgName: 'TEKELEC' },
        { date: '2013-05-02', orgName: 'Oracle' },
      ],
    },
    {
      // Same-name single former: excluded (needs >= 2 prefixes).
      prefix: '0000AB',
      firstSeen: '2001-01-01',
      events: [
        { date: '2001-01-01', orgName: 'Solo History Inc' },
        { date: '2010-01-01', orgName: 'Next Inc' },
      ],
    },
    {
      prefix: '0000AC',
      firstSeen: '2002-02-02',
      events: [
        { date: '2002-02-02', orgName: 'Oracle' },
        { date: '2011-03-03', orgName: 'Oracle Corp' },
      ],
    },
  ];
  const vendors = new Map([
    [
      'ORACLE',
      {
        key: 'ORACLE',
        displayName: 'Oracle',
        blocks: 100,
        slug: 'oracle',
        url: '/vendor/oracle',
      },
    ],
  ]);
  const data = computeFormerHubs(lineage, { vendors });
  const tekelec = data.byKey.get('TEKELEC');
  assert.ok(tekelec);
  assert.equal(tekelec.blocks, 2);
  assert.equal(tekelec.slug, 'tekelec');
  assert.equal(tekelec.url, '/former/tekelec');
  // Full takeover: one owner, all blocks, and the sentence detail rides along.
  const owners = [...tekelec.owners.entries()];
  assert.equal(owners.length, 1);
  assert.equal(owners[0][1].slug, 'oracle');
  assert.equal(tekelec.absorbed ?? 0, 0);
  // Take over the reverse index: Oracle absorbed 2 blocks from Tekelec.
  const absorbed = data.absorbedByVendor.get('ORACLE');
  assert.ok(absorbed.some((a) => a.slug === 'tekelec' && a.count === 2));
  // Rows carry record join info via current owner display.
  const first = [...tekelec.prefixes.values()].sort((a, b) => (a.prefix < b.prefix ? -1 : 1))[0];
  assert.equal(first.currentDisplay, 'Oracle');
  assert.equal(first.currentSlug, 'oracle');
  // Former owners with one prefix stay out.
  assert.ok(!data.byKey.get('SOLO HISTORY INC'));
});

test('computeFormerHubs marks partial takeovers without a sole owner', () => {
  const lineage = [
    {
      prefix: '0001AB',
      firstSeen: '2000-01-01',
      events: [
        { date: '2000-01-01', orgName: 'Split Inc' },
        { date: '2010-01-01', orgName: 'Left Corp' },
      ],
    },
    {
      prefix: '0001CD',
      firstSeen: '2004-01-01',
      events: [
        { date: '2004-01-01', orgName: 'Split Inc' },
        { date: '2012-02-02', orgName: 'Right Corp' },
      ],
    },
  ];
  const data = computeFormerHubs(lineage, { vendors: new Map() });
  const split = data.byKey.get('SPLIT INC');
  assert.ok(split);
  assert.ok(split.prefixes.size, 2);
  // No vendor hub slug - the takeover sentence states the names instead.
  assert.ok(![...split.owners.values()].some((owner) => owner.slug));
});

test('renderFormerHubPage shows the full-takeover sentence and hub row link', () => {
  const hub = {
    key: 'TEKELEC',
    slug: 'tekelec',
    displayName: 'Tekelec',
    blocks: 2,
    prefixes: new Map([
      ['000017', { prefix: '000017', firstDate: '2000-09-08', currentOwner: 'Oracle', currentKey: 'ORACLE', currentSlug: 'oracle', currentDisplay: 'Oracle' }],
      ['00001A', { prefix: '00001A', firstDate: '1995-01-01', currentOwner: 'Oracle', currentKey: 'ORACLE', currentSlug: 'oracle', currentDisplay: 'Oracle' }],
    ]),
    owners: new Map([
      ['ORACLE', { nameCounts: new Map([['Oracle', 2]]), slug: 'oracle', display: 'Oracle' }],
    ]),
  };
  const html = renderFormerHubPage({
    hub,
    recordsByPrefix: new Map([['000017', { blockType: 'MA-L', addressCount: 16777216 }]]),
    assets: ASSETS,
    site: 'https://example.test',
  });
  assert.match(html, /<title>Former Tekelec MAC address blocks \| MAC Address Lookup<\/title>/);
  assert.match(html, /took over all of them/);
  assert.match(html, /href="\/vendor\/oracle"/);
  assert.match(html, /href="\/000017"/);
  assert.match(html, /MA-L/);
  assert.match(html, /CollectionPage/);
});

test('renderFormerHubPage lists mixed takeovers by name', () => {
  const hub = {
    key: 'SPLIT INC',
    slug: 'split-inc',
    displayName: 'Split Inc',
    blocks: 2,
    prefixes: new Map([
      ['0001AB', { prefix: '0001AB', firstDate: '2000-01-01', currentOwner: 'Left Corp', currentSlug: null, currentDisplay: 'Left Corp' }],
      ['0001CD', { prefix: '0001CD', firstDate: '2004-01-01', currentOwner: 'Right Corp', currentSlug: null, currentDisplay: 'Right Corp' }],
    ]),
    owners: new Map([
      ['LEFT CORP', { nameCounts: new Map([['Left Corp', 1]]), slug: null, display: 'Left Corp' }],
      ['RIGHT CORP', { nameCounts: new Map([['Right Corp', 1]]), slug: null, display: 'Right Corp' }],
    ]),
  };
  const html = renderFormerHubPage({ hub, assets: ASSETS, site: 'https://example.test' });
  assert.match(html, /registered across 2 organizations/);
  assert.ok(!html.includes('took over all of them'));
});

test('writeHubPages writes former pages and their URLs', async () => {
  const { mkdtemp, readFile } = await import('node:fs/promises');
  const { tmpdir } = await import('node:os');
  const { join } = await import('node:path');
  const ledger = new Map([['TEKELEC', { slug: 'tekelec', displayName: 'Tekelec' }]]);
  const dir = await mkdtemp(join(tmpdir(), 'hubs-'));
  const data = {
    orgs: [],
    countries: [],
  };
  const formerData = {
    formers: [
      {
        key: 'TEKELEC',
        slug: 'tekelec',
        url: '/former/tekelec',
        displayName: 'Tekelec',
        blocks: 1,
        prefixes: new Map([
          ['000017', { prefix: '000017', firstDate: '2000-09-08', currentOwner: 'Oracle', currentSlug: 'oracle', currentDisplay: 'Oracle' }],
        ]),
        owners: new Map([['ORACLE', { nameCounts: new Map([['Oracle', 1]]), slug: 'oracle', display: 'Oracle' }]]),
      },
    ],
    byKey: ledger,
    absorbedByVendor: new Map(),
  };
  const result = await writeHubPages({ hubData: data, outDir: dir, assets: ASSETS, formerData, recordsByPrefix: new Map() });
  assert.deepEqual(result.formerUrls, ['/former/tekelec']);
  const html = await readFile(join(dir, 'former', 'tekelec.html'), 'utf8');
  assert.match(html, /MAC Address Lookup/);
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
