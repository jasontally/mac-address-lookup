import { strict as assert } from 'node:assert';
import test from 'node:test';
import { scoreRecord, selectPages, vendorBoost } from '../build/select-pages.mjs';

const record = (prefix, blockType, overrides = {}) => ({
  prefix,
  prefixLen: prefix.length === 6 ? 24 : prefix.length === 7 ? 28 : 36,
  blockType,
  addressCount: 1_000_000,
  orgName: 'Example Networks',
  orgAddress: '',
  country: 'US',
  isPrivate: false,
  ...overrides,
});

test('vendorBoost matches case-insensitively and takes the strongest keyword', () => {
  assert.equal(vendorBoost('Apple, Inc.', { apple: 1, intel: 0.9 }), 1);
  assert.equal(vendorBoost('Intel Corporate', { apple: 1, intel: 0.9 }), 0.9);
  assert.equal(vendorBoost('Unknown Vendor', { apple: 1 }), 0);
  assert.equal(vendorBoost('', { apple: 1 }), 0);
  assert.equal(vendorBoost(null), 0);
});

test('scoreRecord ranks by block type, vendor demand, and data quality', () => {
  const priority = { apple: 1 };
  const mal = scoreRecord(record('001A2B', 'MA-L'), priority);
  const mas = scoreRecord(record('FCFBFB1', 'MA-S'), priority);
  const appleMas = scoreRecord(record('FCFBFB2', 'MA-S', { orgName: 'Apple, Inc.' }), priority);
  const privateMal = scoreRecord(
    record('001A2C', 'MA-L', { orgName: 'Private', isPrivate: true }),
    priority,
  );

  assert.ok(mal > mas);
  assert.ok(appleMas > mas);
  assert.ok(mal > privateMal);
});

test('selectPages respects the budget and drops the lowest scores first', () => {
  const records = [
    record('001A2B', 'MA-L'),
    record('FCFBFB1', 'MA-S'),
    record('FCFBFB2', 'MA-S', { orgName: 'Private', isPrivate: true }),
    record('741AE09', 'MA-M', { orgName: 'Apple, Inc.' }),
  ];

  const result = selectPages(records, { pageBudget: 3, vendorPriority: { apple: 1 } });

  assert.equal(result.selected.length, 3);
  assert.equal(result.dropped.length, 1);
  assert.deepEqual(
    result.dropped.map((entry) => entry.prefix),
    ['FCFBFB2'],
  );
  assert.deepEqual(
    result.selected.map((entry) => entry.prefix),
    ['001A2B', '741AE09', 'FCFBFB1'],
  );
  assert.deepEqual(result.selectedByType, { 'MA-L': 1, 'MA-M': 1, 'MA-S': 1 });
  assert.deepEqual(result.droppedByType, { 'MA-S': 1 });
});

test('selectPages with a zero budget drops everything', () => {
  const records = [record('001A2B', 'MA-L')];
  const result = selectPages(records, { pageBudget: 0 });
  assert.equal(result.selected.length, 0);
  assert.equal(result.dropped.length, 1);
});
