import { strict as assert } from 'node:assert';
import test from 'node:test';
import { renderAllocationTimeline, allocationYears, datasetYearRange } from '../build/timeline.mjs';
import {
  computeRegistryDimensions,
  computeYearDimensions,
  computeRegionDimensions,
  computeHistoryDimensions,
  computeHistoryCountryDimensions,
  computeCoverageDimensions,
  computeSuccessorDimensions,
  renderRegistryPage,
  renderYearPage,
  renderRegionPage,
  renderHistoryYearPage,
  renderHistoryCountryPage,
  renderSuccessorPage,
  renderCoveragePage,
} from '../build/dimensions.mjs';

const ASSETS = {
  appFile: '/assets/app.test.js',
  cssFile: '/assets/app.test.css',
  workerFile: '/assets/parquet-worker.js',
};

const record = (prefix, extras = {}) => ({
  prefix,
  prefixLen: 24,
  blockType: 'MA-L',
  addressCount: 16_777_216,
  orgName: 'Apple Inc.',
  country: 'US',
  isPrivate: false,
  firstSeen: '2020-01-01',
  vendorHub: null,
  ...extras,
});

test('allocation timelines fill the full dataset year range', () => {
  const years = allocationYears(
    [
      record('000001', { firstSeen: '1998-01-01' }),
      record('000002', { firstSeen: '2020-01-01' }),
    ],
    { startYear: 1998, endYear: 2020 },
  );
  assert.equal(years.length, 23);
  assert.equal(years[0].blocks, 1);
  assert.equal(years[1].blocks, 0);
  assert.equal(years.at(-1).blocks, 1);
});

test('timeline chart exposes accessible year data and uses the global range', () => {
  const html = renderAllocationTimeline(
    [record('000001', { firstSeen: '2010-01-01' })],
    { startYear: 1998, endYear: 2026 },
  );
  assert.match(html, /data-year="2010" data-blocks="1" data-addresses="16777216"/);
  assert.match(html, /1998 through 2026/);
  assert.match(html, /Bar height shows address space/);
});

test('datasetYearRange ignores missing dates and bounds the range', () => {
  assert.deepEqual(datasetYearRange([{ firstSeen: null }, { firstSeen: '2020-01-01' }]), {
    startYear: 2020,
    endYear: 2020,
  });
  assert.deepEqual(datasetYearRange([{ firstSeen: null }]), { startYear: null, endYear: null });
});

test('dimension computations group registry, year, region, history, coverage, and successors', () => {
  const records = [
    record('000001', { blockType: 'MA-L', firstSeen: '2020-01-01', country: 'US' }),
    record('000002AFA', { blockType: 'MA-S', prefixLen: 36, addressCount: 4096, firstSeen: '2022-01-01', country: 'DE' }),
    record('000002BFB', { blockType: 'MA-S', prefixLen: 36, addressCount: 4096, firstSeen: '2022-02-01', country: 'FR' }),
  ];
  const registries = computeRegistryDimensions(records);
  const years = computeYearDimensions(records);
  const regions = computeRegionDimensions(records);
  assert.deepEqual(registries.map((entry) => entry.type), ['MA-L', 'MA-S']);
  assert.deepEqual(years.map((entry) => entry.year), ['2020', '2022']);
  assert.equal(regions.find((entry) => entry.key === 'europe').blocks, 2);

  const lineage = [
    {
      prefix: '000001',
      prefixLen: 24,
      firstSeen: '2020-01-01',
      lastSeen: '2024-01-01',
      events: [
        { date: '2020-01-01', orgName: 'Old Co', country: 'US' },
        { date: '2024-01-01', orgName: 'Apple Inc.', country: 'US' },
      ],
    },
  ];
  const byPrefix = new Map(records.map((entry) => [entry.prefix, entry]));
  const history = computeHistoryDimensions(lineage, byPrefix);
  const historyCountries = computeHistoryCountryDimensions(lineage, byPrefix);
  assert.equal(history.changes.length, 1);
  assert.equal(history.years[0].year, '2024');
  assert.equal(historyCountries[0].code, 'US');

  const coverage = computeCoverageDimensions(records);
  assert.equal(coverage.length, 1);
  assert.equal(coverage[0].parent, '000002');
  assert.equal(coverage[0].blocks, 2);
});

test('successor pages use the existing current-owner rollup', () => {
  const vendor = { key: 'NEW CO', slug: 'new-co', displayName: 'New Co', url: '/vendor/new-co' };
  const former = {
    slug: 'old-co',
    displayName: 'Old Co',
    prefixes: new Map([
      ['000001', { prefix: '000001', currentOwner: 'New Co' }],
    ]),
  };
  const dimensions = computeSuccessorDimensions({
    absorbedByVendor: new Map([['NEW CO', [{ slug: 'old-co', displayName: 'Old Co', count: 1 }]]]),
    formers: [former],
    vendors: [vendor],
  }, new Map([['000001', record('000001')]]));
  assert.equal(dimensions.length, 1);
  assert.equal(dimensions[0].url, '/successor/new-co');
  assert.equal(dimensions[0].blocks, 1);
});

test('dimension pages render canonical URLs, breadcrumbs, stats, and tables', () => {
  const timelineRange = { startYear: 1998, endYear: 2026 };
  const registry = computeRegistryDimensions([record('000001', { blockType: 'MA-L' })])[0];
  const year = computeYearDimensions([record('000001', { firstSeen: '2020-01-01' })])[0];
  const region = computeRegionDimensions([record('000001', { country: 'US' })])[0];
  const lineage = [
    {
      prefix: '000001',
      prefixLen: 24,
      firstSeen: '2020-01-01',
      lastSeen: '2024-01-01',
      events: [
        { date: '2020-01-01', orgName: 'Old Co', country: 'US' },
        { date: '2024-01-01', orgName: 'Apple Inc.', country: 'US' },
      ],
    },
  ];
  const historyYear = computeHistoryDimensions(lineage, new Map([[registry.prefix, registry]])).years[0];
  const historyCountry = computeHistoryCountryDimensions(lineage, new Map([[registry.prefix, registry]]))[0];
  const coverage = computeCoverageDimensions([
    record('000001AFA', { prefixLen: 36, blockType: 'MA-S', addressCount: 4096 }),
    record('000001BFB', { prefixLen: 36, blockType: 'MA-S', addressCount: 4096 }),
  ])[0];

  const pages = [
    renderRegistryPage({ dimension: registry, timelineRange, assets: ASSETS, site: 'https://example.test' }),
    renderYearPage({ dimension: year, timelineRange, assets: ASSETS, site: 'https://example.test' }),
    renderRegionPage({ dimension: region, timelineRange, assets: ASSETS, site: 'https://example.test' }),
    renderHistoryYearPage({ dimension: historyYear, assets: ASSETS, site: 'https://example.test' }),
    renderHistoryCountryPage({ dimension: historyCountry, assets: ASSETS, site: 'https://example.test' }),
    renderCoveragePage({ dimension: coverage, timelineRange, assets: ASSETS, site: 'https://example.test' }),
  ];

  for (const html of pages) {
    assert.match(html, /rel="canonical" href="https:\/\/example\.test\//);
    assert.match(html, /BreadcrumbList/);
    assert.match(html, /data-static-page="true"/);
  }
  assert.match(pages[0], /canonical.*\/registry\/ma-l/);
  assert.match(pages[1], /first observed in 2020/);
  assert.match(pages[2], /href="\/country\/us"/);
  assert.match(pages[3], /Old Co/);
  assert.match(pages[4], /United States/);
  assert.match(pages[5], /Child blocks/);
});
