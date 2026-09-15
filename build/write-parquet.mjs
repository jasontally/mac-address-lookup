import { createHash } from 'node:crypto';
import { mkdir, readFile, rename } from 'node:fs/promises';
import path from 'node:path';
import { parquetWriteFile } from 'hyparquet-writer';

/** Registry table columns. Vendor totals are global and repeated per row. */
function registryColumnData(records) {
  return [
    { name: 'prefix', data: records.map((record) => record.prefix), type: 'STRING' },
    { name: 'prefix_len', data: records.map((record) => record.prefixLen), type: 'INT32' },
    { name: 'block_type', data: records.map((record) => record.blockType), type: 'STRING' },
    { name: 'address_count', data: records.map((record) => record.addressCount), type: 'INT32' },
    { name: 'org_name', data: records.map((record) => record.orgName), type: 'STRING' },
    { name: 'org_address', data: records.map((record) => record.orgAddress), type: 'STRING' },
    { name: 'country', data: records.map((record) => record.country), type: 'STRING' },
    { name: 'is_private', data: records.map((record) => record.isPrivate), type: 'BOOLEAN' },
    { name: 'first_seen', data: records.map((record) => record.firstSeen ?? null), type: 'STRING' },
    { name: 'lineage_count', data: records.map((record) => record.lineageCount ?? 0), type: 'INT32' },
    { name: 'vendor_blocks', data: records.map((record) => record.vendorBlocks ?? null), type: 'INT32' },
    { name: 'vendor_addresses', data: records.map((record) => record.vendorAddresses ?? null), type: 'DOUBLE' },
  ];
}

async function writeHashedParquet({ columnData, dir, baseName }) {
  await mkdir(dir, { recursive: true });
  const tmpPath = path.join(dir, `${baseName}.parquet`);
  await parquetWriteFile({ filename: tmpPath, columnData });
  const buffer = await readFile(tmpPath);
  const sha256 = createHash('sha256').update(buffer).digest('hex');
  const filename = `${baseName}.${sha256.slice(0, 12)}.parquet`;
  await rename(tmpPath, path.join(dir, filename));
  return { filename, sha256, bytes: buffer.byteLength };
}

/** Write the full registry to a content-hashed Parquet file. */
export async function writeRegistryParquet(records, { outDir }) {
  return writeHashedParquet({ columnData: registryColumnData(records), dir: outDir, baseName: 'registry' });
}

/** Columns the free-text search needs; drops org_address and lookup-only fields. */
function searchColumnData(records) {
  return [
    { name: 'prefix', data: records.map((record) => record.prefix), type: 'STRING' },
    { name: 'prefix_len', data: records.map((record) => record.prefixLen), type: 'INT32' },
    { name: 'block_type', data: records.map((record) => record.blockType), type: 'STRING' },
    { name: 'address_count', data: records.map((record) => record.addressCount), type: 'INT32' },
    { name: 'org_name', data: records.map((record) => record.orgName), type: 'STRING' },
    { name: 'country', data: records.map((record) => record.country), type: 'STRING' },
    { name: 'first_seen', data: records.map((record) => record.firstSeen ?? null), type: 'STRING' },
  ];
}

/** Write the free-text search index (no org addresses, is_private, or lineage counts). */
export async function writeSearchParquet(records, { outDir }) {
  return writeHashedParquet({ columnData: searchColumnData(records), dir: outDir, baseName: 'search' });
}

/** Maximum rows per shard before the group is split by the next hex digit. */
export const SHARD_MAX_ROWS = 1500;

/**
 * Partition records into prefix-trie shards capped at `maxRows`.
 * Hot ranges (for example the IAB cluster under 00:50:C2) split deeper while
 * quiet ranges stay as a single shallow shard.
 */
export function buildShardGroups(records, maxRows = SHARD_MAX_ROWS) {
  const groups = new Map();
  const recurse = (list, key) => {
    if (list.length <= maxRows || key.length >= 12) {
      groups.set(key, list);
      return;
    }
    const self = [];
    const buckets = new Map();
    for (const record of list) {
      if (record.prefix.length <= key.length) {
        self.push(record);
        continue;
      }
      const nextKey = record.prefix.slice(0, key.length + 1);
      if (!buckets.has(nextKey)) buckets.set(nextKey, []);
      buckets.get(nextKey).push(record);
    }
    if (self.length > 0) groups.set(key, self);
    for (const [nextKey, childList] of buckets) recurse(childList, nextKey);
  };
  recurse(records, '');
  return groups;
}

/**
 * Write one Parquet file per shard key (variable-length hex prefixes).
 * Lookups select shards whose key is a prefix of the input, or the input's
 * prefix for partial searches.
 */
export async function writeShardParquets(records, { outDir, maxRows = SHARD_MAX_ROWS } = {}) {
  const shardsDir = path.join(outDir, 'shards');
  const groups = buildShardGroups(records, maxRows);
  const files = {};
  let bytes = 0;
  for (const key of [...groups.keys()].sort()) {
    const result = await writeHashedParquet({
      columnData: registryColumnData(groups.get(key)),
      dir: shardsDir,
      baseName: key === '' ? 'all' : key,
    });
    files[key] = `data/shards/${result.filename}`;
    bytes += result.bytes;
  }
  return { files, count: Object.keys(files).length, bytes };
}

/**
 * Write lineage events to a content-hashed Parquet file, one row per event.
 * Fields such as `first_seen` are repeated per prefix for simple client grouping.
 */
export async function writeLineageParquet(entries, { outDir }) {
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

  const result = await writeHashedParquet({ columnData, dir: outDir, baseName: 'lineage' });
  return { ...result, prefixes: entries.length, events: rows.length };
}
