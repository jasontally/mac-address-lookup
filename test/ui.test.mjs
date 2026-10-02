import { strict as assert } from 'node:assert';
import test from 'node:test';
import {
  addressRange,
  colonize,
  formatAddresses,
  formatCount,
  formatDate,
  formatRelativeTime,
} from '../src/ui/format.mjs';
import { canonicalQuery, canonicalToken, parseLookup, splitBatch } from '../src/ui/router.mjs';

test('splitBatch splits on commas, semicolons, and whitespace', () => {
  assert.deepEqual(splitBatch('a, b;c\nd'), ['a', 'b', 'c', 'd']);
  assert.deepEqual(splitBatch('  '), []);
  assert.deepEqual(splitBatch(null), []);
});

test('canonicalToken and canonicalQuery normalize valid hex only', () => {
  assert.equal(canonicalToken('00:1a:2b'), '001A2B');
  assert.equal(canonicalToken('nope'), null);
  assert.equal(canonicalQuery(['00:1a:2b', '005056', 'not-hex']), '001A2B,005056');
});

test('parseLookup accepts any single path segment and legacy ?q=', () => {
  assert.deepEqual(parseLookup({ pathname: '/001A2B' }), { value: '001A2B' });
  assert.deepEqual(parseLookup({ pathname: '/00%3A1A%3A2B' }), { value: '00:1A:2B' });
  assert.deepEqual(parseLookup({ pathname: '/apple' }), { value: 'apple' });
  assert.deepEqual(parseLookup({ pathname: '/apple%20inc' }), { value: 'apple inc' });
  assert.deepEqual(parseLookup({ pathname: '/001A2B,005056' }), { value: '001A2B,005056' });
  assert.deepEqual(parseLookup({ search: '?q=apple' }), { value: 'apple' });
  assert.deepEqual(parseLookup({ search: '?q=001A2B,005056' }), { value: '001A2B,005056' });
  assert.equal(parseLookup({ pathname: '/' }), null);
  assert.equal(parseLookup({ pathname: '/001A2B/extra' }), null);
  assert.equal(parseLookup({ pathname: '/', search: '?q=' }), null);
});

test('formatDate keeps the fixed DD MMM YYYY form for English and build-time rendering', () => {
  assert.equal(formatDate('2014-01-17'), '17 Jan 2014');
  assert.equal(formatDate('2000-09-08'), '8 Sep 2000');
  assert.equal(formatDate('2026-12-31'), '31 Dec 2026');
  assert.equal(formatDate(''), '');
  assert.equal(formatDate('sometime'), 'sometime');
});

test('formatDate renders localized month names for non-English locales', () => {
  // English keeps the fixed table (build-time rendering depends on it).
  assert.equal(formatDate('2016-02-21', 'en'), '21 Feb 2016');
  // Non-English locales use Intl short months: German renders "Dez",
  // Japanese orders year-month-day with the native month glyph.
  assert.match(formatDate('2026-12-31', 'de'), /Dez/);
  assert.match(formatDate('2016-12-31', 'ja'), /2016年12月31日/);
});



test('formatRelativeTime formats recent timestamps', () => {
  const now = Date.parse('2026-09-12T12:00:00Z');
  assert.equal(formatRelativeTime(now - 30_000, now), 'just now');
  assert.equal(formatRelativeTime(now - 5 * 60_000, now), '5m ago');
  assert.equal(formatRelativeTime(now - 3 * 3_600_000, now), '3h ago');
  assert.equal(formatRelativeTime(now - 2 * 86_400_000, now), '2d ago');
  assert.equal(formatRelativeTime(Date.parse('2026-07-01T12:00:00Z'), now), '1 Jul 2026');
});

test('formatRelativeTime localizes both the relative ranges and the absolute fallback', () => {
  const now = Date.parse('2026-09-12T12:00:00Z');
  // Same-timestamp branches: German relative format (e.g. "vor 5 Minuten").
  assert.match(formatRelativeTime(now - 5 * 60_000, now, 'de'), /vor|M/);
  // Beyond 30 days: German absolute date uses a German month name.
  assert.match(formatRelativeTime(Date.parse('2026-07-01T12:00:00Z'), now, 'de'), /Jul|Juli/);
});


test('formatCount adds thousands separators', () => {
  assert.equal(formatCount(16_777_216), '16,777,216');
  assert.equal(formatCount(0), '0');
  assert.equal(formatCount(null), '');
});

test('formatAddresses humanizes large counts', () => {
  assert.equal(formatAddresses(16_777_216), '16.8 million');
  assert.equal(formatAddresses(1_048_576), '1 million');
  assert.equal(formatAddresses(1_000_000_000), '1 billion');
  assert.equal(formatAddresses(2_100_000_000_000), '2.1 trillion');
  assert.equal(formatAddresses(4_096), '4.1 thousand');
  assert.equal(formatAddresses(999), '999');
  assert.equal(formatAddresses(null), '');
});

test('colonize and addressRange format prefixes', () => {
  assert.equal(colonize('001A2B'), '00:1A:2B');
  assert.equal(colonize('8C1F64AFA'), '8C:1F:64:AF:A');
  assert.deepEqual(addressRange('001A2B', 24), {
    start: '00:1A:2B:00:00:00',
    end: '00:1A:2B:FF:FF:FF',
  });
  assert.deepEqual(addressRange('8C1F64AFA', 36), {
    start: '8C:1F:64:AF:A0:00',
    end: '8C:1F:64:AF:AF:FF',
  });
});
