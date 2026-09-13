import { strict as assert } from 'node:assert';
import { mkdtemp, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { parquetReadObjects } from 'hyparquet';
import { writeRegistryParquet } from '../build/write-parquet.mjs';

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
  assert.equal(second.prefix, '741AE09');
  assert.equal(second.prefix_len, 28);
  assert.equal(second.is_private, true);
  assert.equal(second.country, null);
});
