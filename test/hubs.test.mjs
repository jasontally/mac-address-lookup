import { strict as assert } from 'node:assert';
import test from 'node:test';
import {
  assignSlugs,
  computeFormerHubs,
  computeHubs,
  displayNameOf,
  renderCountryHubPage,
  renderCountryIndexPage,
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

  assert.match(html, /<title[^>]*>Apple Inc\. MAC address blocks \| MAC Address Lookup<\/title>/);
  assert.match(html, /rel="canonical" href="https:\/\/example\.test\/vendor\/apple-inc"/);
  assert.match(html, /data-static-page="true"/);
  assert.match(html, /CollectionPage/);
  assert.match(html, /"name":"Apple Inc."/);
  assert.match(html, /BreadcrumbList/);
  assert.equal((html.match(/<tr/g) ?? []).length, 1202, 'header row, all 1200 rows, plus the expand footer row, count via <tr prefix');
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

test('expand controls sit in the table last line and only call big reveals slow', () => {
  const rows = (n) =>
    Array.from({ length: n }, (_, i) => record(`0000${String(i).padStart(4, '0')}`, 'Apple Inc.'));
  const page = (n) =>
    renderOrgHubPage({
      hub: { ...orgHub, blocks: n, records: rows(n) },
      assets: ASSETS,
      site: 'https://example.test',
    });

  const small = page(2);
  assert.ok(!small.includes('<tfoot>'), 'tables within the display cap need no expand row');
  assert.ok(!small.includes('<noscript>'), 'no noscript shim without a control row');

  const plain = page(1200);
  const foot = /<tfoot>[\s\S]*?<\/tfoot>/.exec(plain)?.[0];
  assert.ok(foot, 'row-capped tables end with an expand row');
  assert.match(foot, /<td class="hub-expand" colspan="5">/, 'the control row spans the whole table');
  assert.ok(plain.indexOf(foot) > plain.indexOf('</tbody>'), 'after the last data row');
  assert.ok(plain.indexOf(foot) < plain.indexOf('</table>'), 'still inside the table');
  assert.match(
    foot,
    /data-hub-expand="more"><span aria-hidden="true">▾<\/span> <span data-i18n="partial.showMore">Show more<\/span>/,
    'Show more keeps its translated label behind a decorative glyph',
  );
  assert.match(foot, /data-i18n="partial.showAll">Show all</, '1,200 rows reveal plainly');
  assert.ok(!foot.includes('slow'), 'no slow warning below the threshold');

  assert.match(page(1600), /data-i18n="partial.showAllSlow">Show all \(slow\)</, 'past the threshold it warns');

  // The inline virtualizer wires both buttons; tbody stays data rows only.
  assert.match(plain, /\[data-hub-expand="more"\]'\)\.addEventListener/);
  assert.match(plain, /\[data-hub-expand="all"\]'\)\.addEventListener/);
  assert.match(plain, /querySelectorAll\('\.hub tbody tr'\)/);
  // Without JS nothing reveals, so the dead controls hide themselves.
  assert.match(plain, /<noscript><style>\.hub tfoot\{display:none\}<\/style><\/noscript>/);

  // Country tables have four columns, so their control cell spans four.
  const countryOrgs = new Map(
    Array.from({ length: 520 }, (_, i) => {
      const name = `Org ${i}`;
      return [name.toUpperCase(), {
        key: name.toUpperCase(),
        displayName: name,
        blocks: 1,
        addresses: 16_777_216,
        firstSeen: '2005-01-05',
        slug: null,
        nameCounts: new Map([[name, 1]]),
      }];
    }),
  );
  const country = renderCountryHubPage({
    hub: { code: 'XX', blocks: 520, addresses: 8_724_152_320, orgs: countryOrgs },
    assets: ASSETS,
    site: 'https://example.test',
  });
  assert.match(country, /<td class="hub-expand" colspan="4">/);
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
  assert.match(html, /<title[^>]*>United States MAC address blocks \| MAC Address Lookup<\/title>/);
  const bigIndex = html.indexOf('href="/vendor/big-co"');
  const smallIndex = html.indexOf('href="/000003"');
  assert.ok(bigIndex !== -1);
  assert.ok(smallIndex !== -1, 'a single-block org links the page of its only block');
  assert.ok(bigIndex < smallIndex, 'sorted by address space, hub-linked org first');
  assert.match(html, /<td class="org"><a href="\/000003">Small Co<\/a><\/td>/);
  assert.match(html, /data-i18n="table.blocks"/);
});

test('country rows honour the page budget: dropped single-block pages stay plain text', () => {
  const entry = {
    key: 'SOLO CO',
    displayName: 'Solo Co',
    blocks: 1,
    addresses: 16_777_216,
    firstSeen: '2005-01-05',
    slug: null,
    nameCounts: new Map([['Solo Co', 1]]),
    records: [record('000003', 'Solo Co')],
  };
  const hub = {
    code: 'US',
    blocks: 1,
    addresses: 16_777_216,
    orgs: new Map([['SOLO CO', entry]]),
  };
  const budgeted = renderCountryHubPage({
    hub,
    assets: ASSETS,
    site: 'https://example.test',
    selectedPrefixes: new Set(['000003']),
  });
  assert.match(budgeted, /<td class="org"><a href="\/000003">Solo Co<\/a><\/td>/);

  const dropped = renderCountryHubPage({
    hub,
    assets: ASSETS,
    site: 'https://example.test',
    selectedPrefixes: new Set(['FFFFFFFFFF']),
  });
  assert.ok(
    dropped.includes('<td class="org">Solo Co</td>'),
    'never link a page the budget dropped - the SPA shell is not a link destination',
  );
});

const indexHubData = {
  orgs: [],
  countries: [
    { code: 'US', blocks: 3, addresses: 50_331_648, orgs: new Map([['US ORP', {}], ['SHARED', {}]]) },
    { code: 'HK', blocks: 2, addresses: 1_000_000, orgs: new Map([['SHARED', {}]]) },
    { code: 'DE', blocks: 7, addresses: 50_331_648, orgs: new Map([['DE ORP', {}]]) },
  ],
};

test('renderCountryIndexPage rolls up organizations, blocks, and addresses per country', () => {
  const html = renderCountryIndexPage({ hubData: indexHubData, assets: ASSETS, site: 'https://example.test' });

  assert.match(html, /rel="canonical" href="https:\/\/example\.test\/country"/);
  assert.match(
    html,
    /<title data-i18n="title\.countries">MAC address blocks by country \| MAC Address Lookup<\/title>/,
  );
  assert.match(html, /data-static-page="true"/);
  assert.match(html, /CollectionPage/);

  // One row per country, linked to that country's page, sorted by address
  // space (ties by code), each carrying org/block/address totals.
  const order = [...html.matchAll(/<a href="\/country\/([a-z]{2})">/g)].map((match) => match[1]);
  assert.deepEqual(order, ['de', 'us', 'hk']);
  assert.match(
    html,
    /<td class="org"><a href="\/country\/us">United States<\/a><\/td><td class="mono">US<\/td><td>2<\/td><td>3<\/td><td>50.3 million<\/td>/,
  );
  assert.match(html, /<th scope="col" data-i18n="table\.iso">ISO<\/th>/);

  // Rollups: blocks and addresses are sums; organizations are distinct - the
  // org registered in both US and HK counts once, so the lede says 3 where
  // the column would add up to 4.
  assert.match(
    html,
    /data-i18n-params='\{"countries":3,"blocks":12,"addresses":101663296,"orgs":3\}'/,
  );
  assert.match(html, /together 102 million addresses across 3 organizations/);

  // The index never links itself from its own footer.
  assert.ok(!html.includes('href="/country" data-i18n="footer.countries"'));
});

test('country pages breadcrumb through the /country index; hubs keep the flat footer', () => {
  const hub = {
    code: 'HK',
    blocks: 1,
    addresses: 16_777_216,
    orgs: new Map([
      [
        'SOLO CO',
        {
          key: 'SOLO CO',
          displayName: 'Solo Co',
          blocks: 1,
          addresses: 16_777_216,
          firstSeen: '2005-01-05',
          slug: null,
          nameCounts: new Map([['Solo Co', 1]]),
          records: [record('000003', 'Solo Co')],
        },
      ],
    ]),
  };
  const html = renderCountryHubPage({ hub, assets: ASSETS, site: 'https://example.test' });

  assert.match(
    html,
    /<a href="https:\/\/example\.test\/country" data-i18n="hub\.countries\.all">All countries<\/a> <span aria-hidden="true">\/<\/span> <span>Hong Kong<\/span>/,
    'the visible breadcrumb carries an index link above the country',
  );
  assert.match(html, /"position":3,"name":"Hong Kong"/, 'the JSON-LD breadcrumb has three items');
  assert.match(html, /href="\/country" data-i18n="footer\.countries"/, 'country pages link the index in the footer too');

  const vendor = renderOrgHubPage({ hub: orgHub, assets: ASSETS, site: 'https://example.test' });
  assert.ok(!vendor.includes('hub.countries.all'), 'vendor breadcrumbs stay flat (Home / Org)');
  assert.match(vendor, /href="\/country" data-i18n="footer\.countries"/);
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
  assert.match(html, /<title[^>]*>Former Tekelec MAC address blocks \| MAC Address Lookup<\/title>/);
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
  assert.equal(result.countryIndexUrl, '/country');
  const { readFile } = await import('node:fs/promises');
  const vendorHtml = await readFile(join(dir, 'vendor', 'apple-inc.html'), 'utf8');
  assert.match(vendorHtml, /MAC Address Lookup/);
  const indexHtml = await readFile(join(dir, 'country.html'), 'utf8');
  assert.match(indexHtml, /rel="canonical" href="https:\/\/mac\.jasontally\.com\/country"/, 'the rollup index is written beside the country pages');
});
