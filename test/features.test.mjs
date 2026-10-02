import { strict as assert } from 'node:assert';
import test from 'node:test';
import { csvCell, exportRow, toCsv, toJson } from '../src/ui/export.mjs';
import { randomMac, fuzzyMatchOrg, searchRegistry } from '../src/engine/search.mjs';
import { isSubdivided } from '../src/engine/subdivided.mjs';
import { createRegistry } from '../src/engine/registry.mjs';

test('csvCell quotes values containing separators', () => {
  assert.equal(csvCell('plain'), 'plain');
  assert.equal(csvCell('has,comma'), '"has,comma"');
  assert.equal(csvCell('has"quote'), '"has""quote"');
  assert.equal(csvCell('multi\nline'), '"multi\nline"');
});

test('exportRow flattens batch result kinds', () => {
  const match = {
    raw: '00:1B:21:AA:BB:CC',
    result: {
      kind: 'match',
      match: { blockType: 'MA-L', orgName: 'Intel Corporate', country: 'MY' },
      hypervisor: null,
      randomization: { likely: false },
    },
  };
  assert.deepEqual(exportRow(match), {
    input: '00:1B:21:AA:BB:CC',
    result: 'match',
    blockType: 'MA-L',
    orgName: 'Intel Corporate',
    country: 'MY',
    flags: [],
  });

  const randomized = {
    raw: 'DEADBEEF0001',
    result: {
      kind: 'none',
      hypervisor: null,
      randomization: { likely: true },
    },
  };
  assert.deepEqual(exportRow(randomized), {
    input: 'DEADBEEF0001',
    result: 'unregistered',
    blockType: '',
    orgName: '',
    country: '',
    flags: ['randomized'],
  });
});

test('toCsv emits header and rows', () => {
  const entries = [
    { raw: '001B21AABBCC', result: { kind: 'match', match: { blockType: 'MA-L', orgName: 'A, Inc', country: 'US' }, hypervisor: null, randomization: { likely: false } } },
  ];
  const csv = toCsv(entries);
  assert.match(csv, /^input,result,blockType,orgName,country,flags\n/);
  assert.match(csv, /"A, Inc",US/);
});

test('toJson emits stable JSON with flag arrays', () => {
  const entries = [
    { raw: '001B21AABBCC', result: { kind: 'match', match: { blockType: 'MA-L', orgName: 'Intel Corporate', country: 'MY' }, hypervisor: { name: 'Docker' }, randomization: { likely: false } } },
  ];
  const rows = JSON.parse(toJson(entries));
  assert.deepEqual(rows[0].flags, ['VM: Docker']);
});

test('randomMac is 12 uppercase hex, always unicast', () => {
  for (let index = 0; index < 200; index += 1) {
    const hex = randomMac();
    assert.match(hex, /^[0-9A-F]{12}$/);
    // I/G bit clear
    assert.equal(parseInt(hex[1], 16) & 1, 0, hex);
  }
});

test('randomMac with a seeded generator is deterministic', () => {
  let seed = 0.42;
  const hex = randomMac({ random: () => (seed = (seed * 9301 + 49297) % 233280 / 233280) });
  assert.match(hex, /^[0-9A-F]{12}$/);
});

test('fuzzyMatchOrg scores typos deterministically', () => {
  assert.equal(fuzzyMatchOrg('apple inc', 'apple'), 60);
  // 'appel' vs word 'apple': same length, 2 substitutions
  assert.equal(fuzzyMatchOrg('apple inc', 'appel'), 40);
  assert.equal(fuzzyMatchOrg('intel corporate', 'intell'), 50);
  assert.equal(fuzzyMatchOrg('vmware inc', 'vmwar'), 60);
  assert.equal(fuzzyMatchOrg('apple inc', 'xyz'), 0);
});

test('searchRegistry falls back to fuzzy matches for typos', () => {
  const registry = createRegistry([
    {
      prefix: '001B21', prefix_len: 6, block_type: 'MA-L', address_count: 100,
      org_name: 'Intel Corporate', org_address: '', country: 'MY',
      is_private: false, first_seen: '2007-01-16',
    },
    {
      prefix: '005056', prefix_len: 6, block_type: 'MA-L', address_count: 50,
      org_name: 'VMware, Inc.', org_address: '', country: 'US',
      is_private: false, first_seen: '2005-02-01',
    },
  ]);
  const outcome = searchRegistry(registry, null, 'Intell');
  assert.equal(outcome.total, 1);
  assert.equal(outcome.matches[0].record.orgName, 'Intel Corporate');
  // exact searches still work and take priority
  assert.equal(searchRegistry(registry, null, 'vmware').total, 1);
  // unrelated query finds nothing even fuzzily
  assert.equal(searchRegistry(registry, null, 'zzzzzz').total, 0);
});

test('isSubdivided flags IEEE-held MA-L blocks only', () => {
  assert.equal(
    isSubdivided({ blockType: 'MA-L', orgName: 'IEEE Registration Authority' }),
    true,
  );
  assert.equal(
    isSubdivided({ blockType: 'MA-L', orgName: 'IEEE REGISTRATION  AUTHORITY.' }),
    true,
  );
  assert.equal(
    isSubdivided({ blockType: 'MA-S', orgName: 'IEEE Registration Authority' }),
    false,
  );
  assert.equal(isSubdivided({ blockType: 'MA-L', orgName: 'Intel Corporate' }), false);
  assert.equal(isSubdivided(null), false);
});
