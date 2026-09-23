import { strict as assert } from 'node:assert';
import test from 'node:test';
import {
  extractCountry,
  normalizeAssignment,
  normalizeRegistries,
  parseCsv,
} from '../build/normalize.mjs';

test('parseCsv handles quoted fields, commas, escaped quotes, and newlines', () => {
  const csv =
    'Registry,Assignment,Organization Name,Organization Address\r\n' +
    'MA-L,286FB9,"Nokia Shanghai Bell Co., Ltd.","No.388 Ning Qiao Road, Jin Qiao  ""CN"" CN 201206 "\r\n' +
    'MA-L,001A2B,Simple Vendor,Plain Address\r\n';
  const rows = parseCsv(csv);
  assert.equal(rows.length, 3);
  assert.deepEqual(rows[0], ['Registry', 'Assignment', 'Organization Name', 'Organization Address']);
  assert.equal(rows[1][2], 'Nokia Shanghai Bell Co., Ltd.');
  assert.equal(rows[1][3], 'No.388 Ning Qiao Road, Jin Qiao  "CN" CN 201206 ');
  assert.equal(rows[2][2], 'Simple Vendor');
});

test('extractCountry finds trailing two-letter codes', () => {
  assert.equal(extractCountry('7760 France Ave S Suite 340 Bloomington MN US 55438'), 'US');
  assert.equal(extractCountry('"A1526, GREEN FIELDS COLONY Faridabad HARYANA IN 121001"'), 'IN');
  assert.equal(extractCountry('Road 156 Caguas West Ind. Park Caguas  PR 00726'), 'PR');
  assert.equal(extractCountry('No.388 Ning Qiao Road,Jin Qiao Pudong Shanghai Shanghai   CN 201206'), 'CN');
  assert.equal(extractCountry(''), null);
  assert.equal(extractCountry('Somewhere without a country'), null);
});

test('extractCountry accepts only ISO codes and prefers non-digit-preceded candidates', () => {
  // Dutch tail: `AE` is the postcode suffix; the country is the earlier `NL`.
  assert.equal(extractCountry('High Tech Campus 5 Eindhoven Noord Brabant NL 5656 AE'), 'NL');
  // Subdivision codes are not countries, and no fallback candidate remains.
  assert.equal(extractCountry('14450 John F. Kennedy Blvd Houston TX  77032'), null);
  // A digit-preceded candidate stands when it is the only ISO code in reach.
  assert.equal(extractCountry('2-5-12 Higashi-Kanda Chiyoda-ku Tokyo 101-0031 JP'), 'JP');
  assert.equal(extractCountry('Laemmerweg 32   DE'), 'DE');
  // Fall-through: `QC` is not an ISO code, so the earlier `CA` wins.
  assert.equal(extractCountry('600 Dr.Frederik-Philips Blvd Montreal  CA QC H4M 2S9'), 'CA');
  // The sanctioned UK alias; both codes display as United Kingdom.
  assert.equal(extractCountry('Times House UK CB4 GB 5LH'), 'UK');
});

test('normalizeAssignment maps prefix lengths and rejects invalid input', () => {
  assert.deepEqual(normalizeAssignment('001a2b'), {
    prefix: '001A2B',
    prefixLen: 24,
    addressCount: 16_777_216,
  });
  assert.equal(normalizeAssignment('741AE09').prefixLen, 28);
  assert.equal(normalizeAssignment('741AE09').addressCount, 1_048_576);
  assert.equal(normalizeAssignment('8C1F64AFA').prefixLen, 36);
  assert.equal(normalizeAssignment('8C1F64AFA').addressCount, 4_096);
  assert.equal(normalizeAssignment('0050C2F71').prefixLen, 36);
  assert.equal(normalizeAssignment('ZZZZZZ'), null);
  assert.equal(normalizeAssignment('001A2'), null);
  assert.equal(normalizeAssignment(''), null);
  assert.equal(normalizeAssignment(null), null);
});

test('normalizeRegistries sorts, dedupes, flags private orgs, and reports stats', () => {
  const makeCsv = (rows) =>
    'Registry,Assignment,Organization Name,Organization Address\n' + rows.join('\n');
  const sources = [
    {
      name: 'MA-L',
      text: makeCsv([
        'MA-L,38E2CA,Katun Corporation,7760 France Ave S Suite 340 Bloomington MN US 55438',
        'MA-L,286FB9,"Nokia Shanghai Bell Co., Ltd.","No.388 Ning Qiao Road Shanghai CN 201206"',
      ]),
    },
    {
      name: 'MA-M',
      text: makeCsv([
        'MA-M,741AE09,Private,',
        'MA-M,286FB9,Duplicate Block,Anywhere US 12345',
      ]),
    },
  ];
  const { records, stats } = normalizeRegistries(sources);

  assert.deepEqual(
    records.map((record) => record.prefix),
    ['286FB9', '38E2CA', '741AE09'],
  );
  assert.equal(records[2].isPrivate, true);
  assert.equal(records[0].country, 'CN');
  assert.equal(records[1].addressCount, 16_777_216);
  assert.equal(records[2].addressCount, 1_048_576);
  assert.deepEqual(stats.duplicates, ['286FB9']);
  assert.equal(stats.total, 3);
  assert.equal(stats.privateCount, 1);
  assert.equal(stats.perRegistry['MA-L'].kept, 2);
  assert.equal(stats.perRegistry['MA-M'].kept, 1);
  assert.equal(stats.perRegistry['MA-M'].rows, 2);
});

test('normalizeRegistries rejects unexpected headers', () => {
  const sources = [{ name: 'MA-L', text: 'Wrong,Header\nMA-L,001A2B,Vendor,Address' }];
  assert.throws(() => normalizeRegistries(sources), /unexpected CSV header/);
});
