import { createHash } from 'node:crypto';
import { mkdir, readFile, rename } from 'node:fs/promises';
import path from 'node:path';
import { parquetWriteFile } from 'hyparquet-writer';

/**
 * Write the registry to a content-hashed Parquet file and return its metadata.
 * The hash is used by the client to cache the file immutably.
 */
export async function writeRegistryParquet(records, { outDir }) {
  await mkdir(outDir, { recursive: true });
  const tmpPath = path.join(outDir, 'registry.parquet');

  const columnData = [
    { name: 'prefix', data: records.map((record) => record.prefix), type: 'STRING' },
    { name: 'prefix_len', data: records.map((record) => record.prefixLen), type: 'INT32' },
    { name: 'block_type', data: records.map((record) => record.blockType), type: 'STRING' },
    { name: 'address_count', data: records.map((record) => record.addressCount), type: 'INT32' },
    { name: 'org_name', data: records.map((record) => record.orgName), type: 'STRING' },
    { name: 'org_address', data: records.map((record) => record.orgAddress), type: 'STRING' },
    { name: 'country', data: records.map((record) => record.country), type: 'STRING' },
    { name: 'is_private', data: records.map((record) => record.isPrivate), type: 'BOOLEAN' },
    { name: 'first_seen', data: records.map((record) => record.firstSeen ?? null), type: 'STRING' },
  ];

  await parquetWriteFile({ filename: tmpPath, columnData });
  const buffer = await readFile(tmpPath);
  const sha256 = createHash('sha256').update(buffer).digest('hex');
  const filename = `registry.${sha256.slice(0, 12)}.parquet`;
  await rename(tmpPath, path.join(outDir, filename));

  return { filename, sha256, bytes: buffer.byteLength };
}

/**
 * Write lineage events to a content-hashed Parquet file, one row per event.
 * Fields such as `first_seen` are repeated per prefix for simple client grouping.
 */
export async function writeLineageParquet(entries, { outDir }) {
  await mkdir(outDir, { recursive: true });
  const tmpPath = path.join(outDir, 'lineage.parquet');

  const rows = [];
  for (const entry of entries) {
    entry.events.forEach((event, seq) => {
      rows.push({
        prefix: entry.prefix,
        prefixLen: entry.prefixLen,
        seq,
        firstSeen: entry.firstSeen,
        lastSeen: entry.lastSeen,
        date: event.date,
        orgName: event.orgName,
        source: event.source,
      });
    });
  }

  const columnData = [
    { name: 'prefix', data: rows.map((row) => row.prefix), type: 'STRING' },
    { name: 'prefix_len', data: rows.map((row) => row.prefixLen), type: 'INT32' },
    { name: 'seq', data: rows.map((row) => row.seq), type: 'INT32' },
    { name: 'first_seen', data: rows.map((row) => row.firstSeen), type: 'STRING' },
    { name: 'last_seen', data: rows.map((row) => row.lastSeen), type: 'STRING' },
    { name: 'date', data: rows.map((row) => row.date), type: 'STRING' },
    { name: 'org_name', data: rows.map((row) => row.orgName), type: 'STRING' },
    { name: 'source', data: rows.map((row) => row.source), type: 'STRING' },
  ];

  await parquetWriteFile({ filename: tmpPath, columnData });
  const buffer = await readFile(tmpPath);
  const sha256 = createHash('sha256').update(buffer).digest('hex');
  const filename = `lineage.${sha256.slice(0, 12)}.parquet`;
  await rename(tmpPath, path.join(outDir, filename));

  return { filename, sha256, bytes: buffer.byteLength, prefixes: entries.length, events: rows.length };
}
