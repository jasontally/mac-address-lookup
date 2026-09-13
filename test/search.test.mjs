import { strict as assert } from 'node:assert';
import test from 'node:test';
import { countryName } from '../src/engine/countries.mjs';
import { createLineageIndex } from '../src/engine/lineage.mjs';
import { createRegistry } from '../src/engine/registry.mjs';
import { extractMacs, reasonLabel, searchRegistry, summarizeLookups } from '../src/engine/search.mjs';

const registryRows = [
  {
    prefix: '001B21',
    prefix_len: 24,
    block_type: 'MA-L',
    address_count: 16_777_216,
    org_name: 'Intel Corporate',
    org_address: 'Kulim MY',
    country: 'MY',
    is_private: false,
    first_seen: '2003-09-08',
  },
  {
    prefix: '000017',
    prefix_len: 24,
    block_type: 'MA-L',
    address_count: 16_777_216,
    org_name: 'Oracle',
    org_address: 'Santa Clara US',
    country: 'US',
    is_private: false,
    first_seen: '2000-09-08',
  },
  {
    prefix: 'FCFBFB1',
    prefix_len: 28,
    block_type: 'MA-M',
    address_count: 1_048_576,
    org_name: 'Apple, Inc.',
    org_address: 'Cupertino US',
    country: 'US',
    is_private: false,
    first_seen: '2020-01-01',
  },
];

const lineageRows = [
  {
    prefix: '000017',
    prefix_len: 24,
    seq: 0,
    first_seen: '2000-09-08',
    last_seen: '2014-01-17',
    date: '2000-09-08',
    org_name: 'TEKELEC',
    source: null,
  },
  {
    prefix: '000017',
    prefix_len: 24,
    seq: 1,
    first_seen: '2000-09-08',
    last_seen: '2014-01-17',
    date: '2014-01-17',
    org_name: 'Oracle',
    source: null,
  },
];

test('extractMacs finds every common format and dedupes', () => {
  const text = `
    eth0  00:1B:21:3C:4D:5E
    eth1  00-1B-21-3C-4D-5F
    eth2  001B.213C.4D60
    eth3  00 1B 21 3C 4D 61
    eth4  001B213C4D5E
    serial 1234567890123
    uuid 550e8400-e29b-41d4-a716-446655440000
  `;
  const found = extractMacs(text);
  assert.deepEqual(found, ['001B213C4D5E', '001B213C4D5F', '001B213C4D60', '001B213C4D61']);
});

test('extractMacs ignores non-addresses and returns empty for plain text', () => {
  assert.equal(extractMacs('Apple').length, 0);
  assert.equal(extractMacs('1234567890123').length, 0);
  assert.equal(extractMacs('hello world').length, 0);
  assert.deepEqual(extractMacs(''), []);
});

test('extractMacs survives newline stripping and adjacent hex characters', () => {
  // A single-line input strips newlines, so a MAC can end up next to the
  // next line's first character (which may itself be a hex letter).
  const collapsed =
    'Interface  eth0  00:1B:21:3C:4D:5Eeth1  DE:AD:BE:EF:00:01link 005056AABBCC';
  assert.deepEqual(extractMacs(collapsed), ['001B213C4D5E', 'DEADBEEF0001', '005056AABBCC']);
  assert.deepEqual(extractMacs('00 1B 21 3C 4D 5Eeth1'), ['001B213C4D5E']);
});

test('searchRegistry matches vendors, former owners, countries, registries, and years', () => {
  const registry = createRegistry(registryRows);
  const lineage = createLineageIndex(lineageRows);

  const intel = searchRegistry(registry, lineage, 'intel');
  assert.equal(intel.matches.length, 1);
  assert.equal(intel.matches[0].record.prefix, '001B21');
  assert.equal(intel.matches[0].reason.type, 'vendor');

  const tekelec = searchRegistry(registry, lineage, 'tekelec');
  assert.equal(tekelec.matches.length, 1);
  assert.equal(tekelec.matches[0].record.prefix, '000017');
  assert.equal(tekelec.matches[0].reason.type, 'former');
  assert.equal(tekelec.matches[0].reason.detail, 'TEKELEC');

  const malaysia = searchRegistry(registry, lineage, 'malaysia');
  assert.equal(malaysia.matches.length, 1);
  assert.equal(malaysia.matches[0].reason.type, 'country');

  const mam = searchRegistry(registry, lineage, 'ma-m');
  assert.equal(mam.matches.length, 1);
  assert.equal(mam.matches[0].reason.type, 'registry');

  const year = searchRegistry(registry, lineage, '2020');
  assert.equal(year.matches.length, 1);
  assert.equal(year.matches[0].record.prefix, 'FCFBFB1');
  assert.equal(year.matches[0].reason.type, 'registered');

  const none = searchRegistry(registry, lineage, 'zzz-no-match');
  assert.equal(none.total, 0);
});

test('searchRegistry requires all tokens and returns a vendor portfolio', () => {
  const registry = createRegistry(registryRows);
  const lineage = createLineageIndex(lineageRows);

  const combined = searchRegistry(registry, lineage, 'apple 2020');
  assert.equal(combined.matches.length, 1);

  const noCombined = searchRegistry(registry, lineage, 'apple 1999');
  assert.equal(noCombined.total, 0);

  const portfolio = searchRegistry(registry, lineage, 'apple');
  assert.equal(portfolio.portfolio.orgName, 'Apple, Inc.');
  assert.equal(portfolio.portfolio.blocks, 1);
  assert.equal(portfolio.portfolio.addresses, 1_048_576);
});

test('searchRegistry caps results and reports the total', () => {
  const registry = createRegistry(registryRows);
  const lineage = createLineageIndex(lineageRows);
  const all = searchRegistry(registry, lineage, 'united states');
  assert.equal(all.total, 2);
  const capped = searchRegistry(registry, lineage, 'united states', { limit: 1 });
  assert.equal(capped.total, 2);
  assert.equal(capped.matches.length, 1);
  assert.equal(capped.truncated, true);
});

test('summarizeLookups aggregates vendors and flags', () => {
  const entries = [
    { result: { kind: 'match', match: { orgName: 'Intel' }, hypervisor: null, randomization: { likely: false } } },
    { result: { kind: 'match', match: { orgName: 'Intel' }, hypervisor: { name: 'VMware' }, randomization: { likely: false } } },
    { result: { kind: 'match', match: { orgName: 'Apple' }, hypervisor: null, randomization: { likely: false } } },
    { result: { kind: 'none', hypervisor: null, randomization: { likely: true } } },
    { result: { kind: 'invalid', error: 'invalid_chars' } },
  ];
  const summary = summarizeLookups(entries);
  assert.equal(summary.total, 5);
  assert.equal(summary.matched, 3);
  assert.equal(summary.unregistered, 1);
  assert.equal(summary.randomized, 1);
  assert.equal(summary.hypervisor, 1);
  assert.equal(summary.invalid, 1);
  assert.deepEqual(summary.vendors, [
    { name: 'Intel', count: 2 },
    { name: 'Apple', count: 1 },
  ]);
});

test('countryName resolves codes, aliases, and unknown values', () => {
  assert.equal(countryName('DE'), 'Germany');
  assert.equal(countryName('us'), 'United States');
  assert.equal(countryName('UK'), 'United Kingdom');
  assert.equal(countryName('ZZ'), null);
  assert.equal(countryName(null), null);
});

test('reasonLabel maps search reasons to display labels', () => {
  assert.equal(reasonLabel({ type: 'vendor' }), 'Vendor');
  assert.equal(reasonLabel({ type: 'former' }), 'Former owner');
  assert.equal(reasonLabel({ type: 'registered' }), 'Registration year');
});
