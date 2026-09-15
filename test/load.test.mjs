import { strict as assert } from 'node:assert';
import test from 'node:test';
import { checkSchemaVersion, loadSearchIndex, MAX_SHARDS, shardKeysFor, SUPPORTED_SCHEMA_VERSION } from '../src/engine/load.mjs';

const shardManifest = {
  shards: {
    0: 'data/shards/0.x.parquet',
    '00': 'data/shards/00.x.parquet',
    '001B': 'data/shards/001B.x.parquet',
    '001B21': 'data/shards/001B21.x.parquet',
    '8C1F64': 'data/shards/8C1F64.x.parquet',
    DEAD: 'data/shards/DEAD.x.parquet',
  },
};

test('shardKeysFor selects ancestor shards for full addresses', () => {
  assert.deepEqual(shardKeysFor(shardManifest, ['001B21AABBCC']).keys, [
    '0',
    '00',
    '001B',
    '001B21',
  ]);
  assert.deepEqual(shardKeysFor(shardManifest, ['001B21A']).keys, ['0', '00', '001B', '001B21']);
  assert.deepEqual(shardKeysFor(shardManifest, ['8C1F64']).keys, ['8C1F64']);
});

test('shardKeysFor selects descendant shards for partial prefixes', () => {
  assert.deepEqual(shardKeysFor(shardManifest, ['001B2']).keys, ['001B21']);
  assert.deepEqual(shardKeysFor(shardManifest, ['00']).keys, ['00', '001B', '001B21']);
  assert.deepEqual(shardKeysFor(shardManifest, ['0']).keys, ['0', '00', '001B', '001B21']);
});

test('shardKeysFor unions batch inputs and falls back when needed', () => {
  assert.deepEqual(shardKeysFor(shardManifest, ['001B21AABBCC', 'DEADBEEF0001']).keys, [
    '0',
    '00',
    '001B',
    '001B21',
    'DEAD',
  ]);
  assert.deepEqual(shardKeysFor(null, ['001B21']), { mode: 'full' });
  assert.deepEqual(shardKeysFor({}, ['001B21']), { mode: 'full' });
  assert.deepEqual(shardKeysFor(shardManifest, null), { mode: 'full' });
  assert.deepEqual(shardKeysFor(shardManifest, []), { mode: 'full' });
  assert.deepEqual(shardKeysFor(shardManifest, ['']), { mode: 'full' });
  assert.deepEqual(shardKeysFor(shardManifest, ['001B21AABBCC'], { maxShards: 1 }), {
    mode: 'full',
  });
  const wideManifest = {
    shards: Object.fromEntries(
      Array.from({ length: MAX_SHARDS + 1 }, (_, index) => [
        `A${index.toString(16).padStart(2, '0')}`,
        'x',
      ]),
    ),
  };
  assert.equal(shardKeysFor(wideManifest, ['A']).mode, 'full');
});

test('checkSchemaVersion accepts supported and legacy manifests', () => {
  assert.equal(checkSchemaVersion({ schemaVersion: 1 }), 1);
  assert.equal(checkSchemaVersion({ schemaVersion: 0 }), 0);
  assert.equal(checkSchemaVersion({}), 1);
  assert.equal(checkSchemaVersion(null), 1);
});

test('checkSchemaVersion rejects newer schemas with a user-facing message', () => {
  try {
    checkSchemaVersion({ schemaVersion: SUPPORTED_SCHEMA_VERSION + 1 });
    assert.fail('expected checkSchemaVersion to throw');
  } catch (error) {
    assert.match(error.message, /newer than this app supports/);
    assert.match(error.userMessage, /Reload to update/);
  }
});

test('loadSearchIndex prefers the lean search file and falls back to data', async () => {
  const { mkdir, mkdtemp, readFile, rm, writeFile } = await import('node:fs/promises');
  const os = await import('node:os');
  const path = await import('node:path');
  const { writeSearchParquet, writeRegistryParquet } = await import('../build/write-parquet.mjs');

  const records = [
    {
      prefix: '001B21', prefixLen: 6, blockType: 'MA-L', addressCount: 100,
      orgName: 'Intel Corporate', orgAddress: 'Lot 8', country: 'MY',
      isPrivate: false, firstSeen: '2007-01-16', lineageCount: 1,
      vendorBlocks: null, vendorAddresses: null,
    },
    {
      prefix: '005056', prefixLen: 6, blockType: 'MA-L', addressCount: 50,
      orgName: 'VMware, Inc.', orgAddress: '3401 Hillview', country: 'US',
      isPrivate: false, firstSeen: '2005-02-01', lineageCount: 0,
      vendorBlocks: null, vendorAddresses: null,
    },
  ];
  const dir = await mkdtemp(path.join(os.tmpdir(), 'mal-search-'));
  await mkdir(dir, { recursive: true });
  const search = await writeSearchParquet(records, { outDir: dir });
  const full = await writeRegistryParquet(records, { outDir: dir });

  const toArrayBuffer = (buf) => buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength);
  const buffers = {
    [`/data/${search.filename}`]: toArrayBuffer(await readFile(path.join(dir, search.filename))),
    [`/data/${full.filename}`]: toArrayBuffer(await readFile(path.join(dir, full.filename))),
  };
  const fetchImpl = (url) => Promise.resolve({ ok: true, arrayBuffer: async () => buffers[url] });

  // Lean file: resolve + portfolio work without org_address or vendor totals.
  const leanManifest = { search: { file: `data/${search.filename}` }, data: { file: `data/${full.filename}` } };
  const lean = await loadSearchIndex(leanManifest, { fetchImpl });
  assert.equal(lean.mode, 'search');
  const resolved = lean.registry.resolve('001B21AABBCC');
  assert.equal(resolved.record.orgName, 'Intel Corporate');
  assert.equal(resolved.record.orgAddress, '');
  assert.deepEqual(lean.registry.portfolio('Intel Corporate'), { blocks: 1, addresses: 100 });

  // Without manifest.search, the full registry file is used.
  const fallbackManifest = { data: { file: `data/${full.filename}` } };
  const fallback = await loadSearchIndex(fallbackManifest, { fetchImpl });
  assert.equal(fallback.registry.resolve('001B21AABBCC').record.orgAddress, 'Lot 8');

  await rm(dir, { recursive: true, force: true });
});
