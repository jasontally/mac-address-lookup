import { strict as assert } from 'node:assert';
import { mkdtemp, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { parquetReadObjects } from 'hyparquet';
import {
  buildShardGroups,
  writeLineageParquet,
  writeRegistryParquet,
  writeShardParquets,
} from '../build/write-parquet.mjs';
import { createLineageIndex } from '../src/engine/lineage.mjs';

test('writeRegistryParquet round-trips records through hyparquet', async () => {
  const outDir = await mkdtemp(path.join(tmpdir(), 'registry-'));
  const records = [
    {
      prefix: '001A2B',
      prefixLen: 24,
      blockType: 'MA-L',
      addressCount: 16_777_216,
      orgName: 'Test Vendor, Inc.',
      orgAddress: '1 Test Road, Testville US 12345',
      country: 'US',
      isPrivate: false,
      firstSeen: '2003-09-08',
      lineageCount: 2,
      vendorBlocks: 1,
      vendorAddresses: 16_777_216,
    },
    {
      prefix: '741AE09',
      prefixLen: 28,
      blockType: 'MA-M',
      addressCount: 1_048_576,
      orgName: 'Private',
      orgAddress: '',
      country: null,
      isPrivate: true,
    },
  ];

  const result = await writeRegistryParquet(records, { outDir });
  assert.match(result.filename, /^registry\.[0-9a-f]{12}\.parquet$/);

  const buffer = await readFile(path.join(outDir, result.filename));
  const arrayBuffer = buffer.buffer.slice(buffer.byteOffset, buffer.byteOffset + buffer.byteLength);
  const rows = await parquetReadObjects({ file: arrayBuffer });

  assert.equal(rows.length, 2);
  const [first, second] = rows;
  assert.equal(first.prefix, '001A2B');
  assert.equal(first.prefix_len, 24);
  assert.equal(first.block_type, 'MA-L');
  assert.equal(first.address_count, 16_777_216);
  assert.equal(first.org_name, 'Test Vendor, Inc.');
  assert.equal(first.org_address, '1 Test Road, Testville US 12345');
  assert.equal(first.country, 'US');
  assert.equal(first.is_private, false);
  assert.equal(first.first_seen, '2003-09-08');
  assert.equal(first.lineage_count, 2);
  assert.equal(first.vendor_blocks, 1);
  assert.equal(first.vendor_addresses, 16_777_216);
  assert.equal(second.prefix, '741AE09');
  assert.equal(second.prefix_len, 28);
  assert.equal(second.is_private, true);
  assert.equal(second.country, null);
});

test('writeShardParquets writes one file per first byte', async () => {
  const outDir = await mkdtemp(path.join(tmpdir(), 'shards-'));
  const record = (prefix, orgName) => ({
    prefix,
    prefixLen: 24,
    blockType: 'MA-L',
    addressCount: 16_777_216,
    orgName,
    orgAddress: '',
    country: 'US',
    isPrivate: false,
    firstSeen: null,
    vendorBlocks: 1,
    vendorAddresses: 16_777_216,
  });
  const records = [
    record('001A2B', 'Alpha'),
    record('00FFEE', 'Beta'),
    record('DEAD01', 'Gamma'),
    record('DEAD02', 'Delta'),
  ];

  const result = await writeShardParquets(records, { outDir, maxRows: 2 });
  assert.equal(result.count, 2);
  assert.deepEqual(Object.keys(result.files).sort(), ['0', 'D']);

  const shardPath = path.join(outDir, 'shards', result.files.D.replace('data/shards/', ''));
  const buffer = await readFile(shardPath);
  const arrayBuffer = buffer.buffer.slice(buffer.byteOffset, buffer.byteOffset + buffer.byteLength);
  const rows = await parquetReadObjects({ file: arrayBuffer });
  assert.equal(rows.length, 2);
  assert.deepEqual(
    rows.map((row) => row.prefix).sort(),
    ['DEAD01', 'DEAD02'],
  );
});

test('buildShardGroups splits hot ranges by deeper prefixes', () => {
  const record = (prefix) => ({ prefix });
  const records = [
    record('001A2B'),
    record('001A2C'),
    record('001A2D'),
    record('8C1F64AFA'),
    record('8C1F64AFB'),
    record('DEAD01'),
  ];
  const groups = buildShardGroups(records, 2);
  // 001A2* exceeds two rows and splits; quiet ranges stay together.
  const keys = [...groups.keys()].sort();
  assert.ok(keys.length > 3);
  const deadGroup = [...groups.values()].find((list) =>
    list.some((item) => item.prefix === 'DEAD01'),
  );
  assert.deepEqual(deadGroup.map((item) => item.prefix), ['DEAD01']);
  for (const list of groups.values()) {
    assert.ok(list.length <= 2, `group has ${list.length} rows`);
  }
});

test('writeLineageParquet round-trips events through hyparquet', async () => {
  const outDir = await mkdtemp(path.join(tmpdir(), 'lineage-'));
  const entries = [
    {
      prefix: '000017',
      prefixLen: 24,
      firstSeen: '2000-09-08',
      lastSeen: '2014-01-17',
      events: [
        { date: '2000-09-08', orgName: 'TEKELEC', source: null },
        { date: '2014-01-17', orgName: 'Oracle', source: 'ieee-oui.csv' },
      ],
    },
  ];

  const result = await writeLineageParquet(entries, { outDir });
  assert.match(result.filename, /^lineage\.[0-9a-f]{12}\.parquet$/);
  assert.equal(result.prefixes, 1);
  assert.equal(result.events, 2);

  const buffer = await readFile(path.join(outDir, result.filename));
  const arrayBuffer = buffer.buffer.slice(buffer.byteOffset, buffer.byteOffset + buffer.byteLength);
  const rows = await parquetReadObjects({ file: arrayBuffer });
  assert.equal(rows.length, 2);

  const entry = createLineageIndex(rows).forPrefix('000017');
  assert.equal(entry.events.length, 2);
  assert.equal(entry.events[0].orgName, 'TEKELEC');
  assert.equal(entry.events[1].source, 'ieee-oui.csv');
  assert.equal(entry.firstSeen, '2000-09-08');
  assert.equal(entry.lastSeen, '2014-01-17');
});
