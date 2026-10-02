import { strict as assert } from 'node:assert';
import test from 'node:test';
import { buildFirstSeen, buildLineage, countLineageEvents, normalizeOrgName } from '../build/lineage.mjs';
import { createLineageIndex } from '../src/engine/lineage.mjs';

test('normalizeOrgName folds case, punctuation, and whitespace', () => {
  assert.equal(normalizeOrgName('CISCO SYSTEMS, INC.'), 'CISCO SYSTEMS INC');
  assert.equal(normalizeOrgName('Cisco Systems, Inc'), 'CISCO SYSTEMS INC');
  assert.equal(normalizeOrgName("  Acme  Networks'  "), 'ACME NETWORKS');
  assert.equal(normalizeOrgName(null), '');
  assert.equal(normalizeOrgName(''), '');
});

test('buildLineage keeps only real organization changes', () => {
  const history = {
    // Genuine acquisition: TEKELEC -> Oracle, with a transient Private glitch.
    '000017000000/24': [
      { d: '2000-09-08', t: 'add', o: 'TEKELEC', a: '', c: '', s: '' },
      { d: '2002-06-05', t: 'change', o: 'PRIVATE', a: '', c: '', s: '' },
      { d: '2004-02-12', t: 'change', o: 'TEKELEC', a: '', c: '', s: '' },
      { d: '2014-01-17', t: 'change', o: 'Oracle', a: '', c: '', s: 'ieee-oui.csv' },
    ],
    // Formatting-only changes collapse and do not qualify.
    '00000C000000/24': [
      { d: '1998-04-22', t: 'add', o: 'CISCO SYSTEMS, INC.', a: 'OLD', c: 'US', s: '' },
      { d: '2015-08-27', t: 'change', o: 'CISCO SYSTEMS, INC.', a: 'NEW', c: 'US', s: '' },
      { d: '2015-09-01', t: 'change', o: 'Cisco Systems, Inc', a: 'NEW', c: 'US', s: '' },
    ],
    // Single organization: no lineage.
    '000001000000/24': [{ d: '1998-04-22', t: 'add', o: 'XEROX CORPORATION', a: '', c: '', s: '' }],
    // Malformed keys are ignored.
    'nonsense': [{ d: '2000-01-01', t: 'add', o: 'X', a: '', c: '', s: '' }],
    '000099000000/33': [{ d: '2000-01-01', t: 'add', o: 'X', a: '', c: '', s: '' }],
  };

  const entries = buildLineage(history);
  assert.equal(entries.length, 1);

  const tekelec = entries[0];
  assert.equal(tekelec.prefix, '000017');
  assert.equal(tekelec.prefixLen, 24);
  assert.equal(tekelec.firstSeen, '2000-09-08');
  assert.equal(tekelec.lastSeen, '2014-01-17');
  assert.deepEqual(
    tekelec.events.map((event) => `${event.orgName}@${event.date}`),
    ['TEKELEC@2000-09-08', 'Oracle@2014-01-17'],
  );
  assert.equal(tekelec.events[1].source, 'ieee-oui.csv');
});

test('buildLineage sorts entries and handles missing dates', () => {
  const history = {
    '0000FF000000/24': [
      { d: '2001-01-01', t: 'add', o: 'First Co', a: '', c: '', s: '' },
      { d: '2002-01-01', t: 'change', o: 'Second Co', a: '', c: '', s: '' },
    ],
    '000001000000/24': [
      { d: null, t: 'add', o: 'Alpha', a: '', c: '', s: '' },
      { d: '2005-05-05', t: 'change', o: 'Beta', a: '', c: '', s: '' },
    ],
  };
  const entries = buildLineage(history);
  assert.deepEqual(
    entries.map((entry) => entry.prefix),
    ['000001', '0000FF'],
  );
  assert.equal(entries[0].firstSeen, '2005-05-05');
  assert.equal(entries[0].lastSeen, '2005-05-05');
  assert.equal(entries[0].events[0].date, null);
});

test('buildFirstSeen picks the earliest observation date per prefix', () => {
  const map = buildFirstSeen({
    '000017000000/24': [{ d: '2014-01-17' }, { d: '2000-09-08' }],
    '000001000000/24': [{ d: null }],
    nonsense: [{ d: '2000-01-01' }],
  });
  assert.equal(map.get('000017'), '2000-09-08');
  assert.equal(map.has('000001'), false);
  assert.equal(map.size, 1);
});

test('countLineageEvents maps changed prefixes to event counts', () => {
  const counts = countLineageEvents([
    { prefix: '000017', events: [{}, {}] },
    { prefix: '000052', events: [{}, {}, {}] },
  ]);
  assert.equal(counts.get('000017'), 2);
  assert.equal(counts.get('000052'), 3);
  assert.equal(counts.has('001B21'), false);
});

test('createLineageIndex groups events chronologically and looks up case-insensitively', () => {
  const rows = [
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
      source: 'ieee-oui.csv',
    },
  ];
  const index = createLineageIndex(rows);
  assert.equal(index.size, 1);

  const entry = index.forPrefix('000017');
  assert.equal(entry.events.length, 2);
  assert.equal(entry.events[0].orgName, 'TEKELEC');
  assert.equal(entry.events[1].orgName, 'Oracle');
  assert.equal(index.forPrefix('0000ff'), null);
  assert.equal(index.forPrefix(null), null);
});
