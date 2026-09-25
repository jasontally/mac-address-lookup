import { strict as assert } from 'node:assert';
import test from 'node:test';
import { renderAllocationTimeline, allocationDates, datasetDateRange } from '../build/timeline.mjs';
import {
  computeRegistryDimensions,
  computeYearDimensions,
  computeRegionDimensions,
  computeHistoryDimensions,
  computeHistoryCountryDimensions,
  computeSuccessorDimensions,
  renderRegistryPage,
  renderYearPage,
  renderRegionPage,
  renderHistoryYearPage,
  renderHistoryCountryPage,
  renderSuccessorPage,
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

test('allocation timelines use exact dates and the full dataset range', () => {
  const dates = allocationDates(
    [
      record('000001', { firstSeen: '1998-01-01' }),
      record('000002', { firstSeen: '2020-01-01' }),
      record('000003', { firstSeen: '2020-01-01', addressCount: 1_048_576 }),
    ],
    { startDate: '1998-01-01', endDate: '2020-01-01' },
  );
  assert.equal(dates.startDate, '1998-01-01');
  assert.equal(dates.endDate, '2020-01-01');
  assert.equal(dates.points.length, 2);
  assert.equal(dates.points[0].date, '1998-01-01');
  assert.equal(dates.points.at(-1).addresses, 16_777_216 + 1_048_576);
});

test('timeline chart is a continuous date line with hover data', () => {
  const html = renderAllocationTimeline(
    [record('000001', { firstSeen: '2010-01-01' })],
    { startDate: '1998-01-01', endDate: '2026-12-31' },
  );
  assert.match(html, /allocation-line/);
  assert.match(html, /data-start-date="1998-01-01"/);
  assert.match(html, /data-end-date="2026-12-31"/);
  assert.match(html, /Line height shows address space/);
  assert.match(html, /hover for date and value/);
});

test('datasetDateRange ignores missing dates and bounds the range', () => {
  assert.deepEqual(datasetDateRange([{ firstSeen: null }, { firstSeen: '2020-01-01' }]), {
    startDate: '2020-01-01',
    endDate: '2020-01-01',
  });
  assert.deepEqual(datasetDateRange([{ firstSeen: null }]), { startDate: null, endDate: null });
});

test('dimension computations group registry, year, region, history, and successors', () => {
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
  assert.deepEqual(regions.map((entry) => entry.key), ['americas', 'europe'], 'regions sort by address space');

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
  const timelineRange = { startDate: '1998-01-01', endDate: '2026-12-31' };
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

  const pages = [
    renderRegistryPage({ dimension: registry, timelineRange, assets: ASSETS, site: 'https://example.test' }),
    renderYearPage({ dimension: year, timelineRange, assets: ASSETS, site: 'https://example.test' }),
    renderRegionPage({ dimension: region, timelineRange, assets: ASSETS, site: 'https://example.test' }),
    renderHistoryYearPage({ dimension: historyYear, assets: ASSETS, site: 'https://example.test' }),
    renderHistoryCountryPage({ dimension: historyCountry, assets: ASSETS, site: 'https://example.test' }),
    renderSuccessorPage({ dimension: computeSuccessorDimensions({
      absorbedByVendor: new Map([['APPLE INC', [{ slug: 'old-co', displayName: 'Old Co', count: 1 }]]]),
      formers: [{
        slug: 'old-co',
        displayName: 'Old Co',
        prefixes: new Map([['000001', { prefix: '000001', currentOwner: 'Apple Inc.' }]]),
      }],
      vendors: [{ key: 'APPLE INC', slug: 'apple-inc', displayName: 'Apple Inc.', url: '/vendor/apple-inc' }],
    }, new Map([[registry.prefix, registry]]))[0], assets: ASSETS, site: 'https://example.test' }),
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
  assert.match(pages[5], /Former owner/);
});
