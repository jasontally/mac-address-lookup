import { strict as assert } from 'node:assert';
import test from 'node:test';
import { computeRelatedLinks, MAX_LINKS, SIBLING_CAP, YEAR_CAP, yearOf } from '../build/related.mjs';

const record = (prefix, orgName, firstSeen = '2009-01-01') => ({
  prefix,
  orgName,
  firstSeen,
});

test('yearOf extracts a 4-digit year or null', () => {
  assert.equal(yearOf(record('00', 'A', '2008-05-06')), '2008');
  assert.equal(yearOf(record('00', 'A', null)), null);
  assert.equal(yearOf(record('00', 'A', 'March 2008')), null);
});

test('related links dedupe across groups and exclude the page itself', () => {
  const selected = [
    record('000001', 'Apple Inc', '2001-06-01'),
    record('000002', 'Apple Inc', '2001-06-01'),
    record('000003', 'Apple Inc', '2001-06-01'),
    record('00000A', 'Other Org', '2001-06-01'),
  ];
  const related = computeRelatedLinks(selected);

  const first = related.get('000001');
  // Siblings sorted by prefix; adjacency dedupes against siblings.
  assert.deepEqual(
    first.sameOrg.map((entry) => entry.prefix),
    ['000002', '000003'],
  );
  // The next-prefix neighbor 000002 was already used as a sibling, and the
  // other-org prefix lands in the same-year cohort instead (same year here).
  assert.ok(!first.sameOrg.concat(first.adjacent).some((l) => l.prefix === '000001'));
  assert.ok(first.sameYear.some((l) => l.prefix === '00000A'));
  const used = [
    ...first.sameOrg,
    ...first.adjacent,
    ...first.sameYear,
  ].map((l) => l.prefix);
  assert.equal(new Set(used).size, used.length, 'no duplicate links on one page');
});

test('caps hold: siblings 6, cohort 4, total 12 (which equals the cap sum)', () => {
  const siblings = Array.from({ length: 20 }, (_, i) => record(`0000A${String(i).padStart(2, '0')}`, 'Acme Corp', '2010-01-01'));
  const cohort = Array.from({ length: 8 }, (_, i) => record(`0000A${String(i + 20).padStart(2, '0')}`, `Vendor ${i}`, '2010-01-01'));
  const ranked = [...siblings, ...cohort].sort((a, b) => (a.prefix < b.prefix ? -1 : 1));
  const related = computeRelatedLinks(ranked);

  const first = related.get('0000A00');
  assert.equal(first.sameOrg.length, SIBLING_CAP);
  assert.ok(first.adjacent.length <= 2);
  assert.equal(first.sameYear.length, YEAR_CAP);
  const total = first.sameOrg.length + first.adjacent.length + first.sameYear.length;
  assert.ok(total <= MAX_LINKS);
  // Middle record: 6 siblings exclude itself, then 2 adjacent, then cohort fills.
  const middle = related.get('0000A05');
  assert.equal(middle.sameOrg.length, SIBLING_CAP);
});

test('empty orgs produce no siblings but still get adjacency', () => {
  const selected = [record('000001', '', '2001-01-01'), record('000002', '', '2001-01-01')];
  const related = computeRelatedLinks(selected);
  assert.deepEqual(related.get('000001').sameOrg, []);
  assert.equal(related.get('000001').adjacent[0].prefix, '000002');
});

test('results are deterministic regardless of input order', () => {
  const base = [
    record('0001AB', 'A Co', '2005-01-01'),
    record('0002CD', 'B Co', '2012-02-02'),
    record('0003EF', 'A Co', '2005-01-01'),
    record('0004AA', 'B Co', '2012-02-02'),
  ];
  const serialize = (map) => JSON.stringify([...map.entries()]);
  const forward = serialize(computeRelatedLinks(base));
  const backward = serialize(computeRelatedLinks([...base].reverse()));
  assert.equal(forward, backward);
  const parsed = new Map(JSON.parse(forward));
  const first = parsed.get('0001AB');
  assert.ok(first.sameOrg.some((l) => l.prefix === '0003EF'));
  assert.ok(first.adjacent.some((l) => l.prefix === '0002CD'));
});
