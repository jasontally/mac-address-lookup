import { strict as assert } from 'node:assert';
import { mkdtemp, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';
import {
  compareSources,
  sha256,
  shouldRefresh,
  sourceHashOf,
  writeSourceCache,
} from '../build/source-cache.mjs';

test('sha256 hashes text deterministically', () => {
  assert.equal(sha256('abc'), 'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad');
});

test('sourceHashOf is order-independent and content-sensitive', () => {
  const a = [
    { file: 'oui.csv', sha256: '111' },
    { file: 'macs.json', sha256: '222' },
  ];
  const b = [
    { file: 'macs.json', sha256: '222' },
    { file: 'oui.csv', sha256: '111' },
  ];
  assert.equal(sourceHashOf(a), sourceHashOf(b));
  const changed = [
    { file: 'oui.csv', sha256: '999' },
    { file: 'macs.json', sha256: '222' },
  ];
  assert.notEqual(sourceHashOf(a), sourceHashOf(changed));
});

test('compareSources detects changed, added, and removed files', () => {
  const previous = {
    files: [
      { file: 'oui.csv', sha256: 'a' },
      { file: 'macs.json', sha256: 'b' },
    ],
  };
  const same = compareSources(
    [
      { file: 'oui.csv', sha256: 'a' },
      { file: 'macs.json', sha256: 'b' },
    ],
    previous,
  );
  assert.deepEqual(same, { changed: false, changedFiles: [] });

  const changed = compareSources(
    [
      { file: 'oui.csv', sha256: 'CHANGED' },
      { file: 'macs.json', sha256: 'b' },
      { file: 'new.csv', sha256: 'c' },
    ],
    previous,
  );
  assert.equal(changed.changed, true);
  assert.deepEqual(changed.changedFiles.sort(), ['new.csv', 'oui.csv']);

  const noBaseline = compareSources([{ file: 'oui.csv', sha256: 'a' }], null);
  assert.equal(noBaseline.changed, true);
});

test('shouldRefresh skips no-op weeks and forces a monthly redeploy', () => {
  const now = new Date('2026-09-14T06:17:00Z');
  assert.deepEqual(shouldRefresh({ changed: true, refreshDate: '2026-09-01', now }), {
    refresh: true,
    reason: 'sources-changed',
  });
  assert.deepEqual(shouldRefresh({ changed: false, refreshDate: '2026-08-03', now }), {
    refresh: true,
    reason: 'monthly-refresh',
  });
  assert.deepEqual(shouldRefresh({ changed: false, refreshDate: '2026-09-01', now }), {
    refresh: false,
    reason: 'no-change',
  });
  assert.deepEqual(shouldRefresh({ changed: false, refreshDate: '', now }), {
    refresh: true,
    reason: 'monthly-refresh',
  });
});

test('writeSourceCache writes hashed files and a verifiable index', async () => {
  const outDir = await mkdtemp(path.join(tmpdir(), 'sources-'));
  const result = await writeSourceCache(
    [
      { file: 'oui.csv', text: 'Registry,Assignment\nMA-L,001A2B\n' },
      { file: 'macs.json', text: '{"a":1}' },
    ],
    { outDir },
  );

  assert.equal(result.files.length, 2);
  assert.equal(result.sourceHash, sourceHashOf(result.files));
  assert.match(result.files[0].path, /^data\/sources\/oui\.[0-9a-f]{12}\.csv$/);

  const manifest = JSON.parse(await readFile(path.join(outDir, 'sources-index.json'), 'utf8'));
  assert.equal(manifest.sourceHash, result.sourceHash);
  assert.equal(manifest.files.length, 2);

  const ouiEntry = manifest.files.find((file) => file.file === 'oui.csv');
  const oui = await readFile(path.join(outDir, 'sources', path.basename(ouiEntry.path)), 'utf8');
  assert.equal(oui, 'Registry,Assignment\nMA-L,001A2B\n');
  assert.equal(ouiEntry.sha256, sha256(oui));
});
