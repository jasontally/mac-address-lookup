/** In-memory registry index over normalized IEEE assignment rows. */

const BLOCK_LENGTHS = [9, 7, 6];

function toRecord(row) {
  return {
    prefix: String(row.prefix).toUpperCase(),
    prefixLen: row.prefix_len,
    blockType: row.block_type,
    addressCount: row.address_count,
    orgName: row.org_name ?? '',
    orgAddress: row.org_address ?? '',
    country: row.country ?? null,
    isPrivate: Boolean(row.is_private),
    firstSeen: row.first_seen ?? null,
    vendorBlocks: typeof row.vendor_blocks === 'number' ? row.vendor_blocks : null,
    vendorAddresses: typeof row.vendor_addresses === 'number' ? row.vendor_addresses : null,
  };
}

/** Case/punctuation-insensitive key for grouping vendor portfolios. */
function portfolioKey(name) {
  return String(name ?? '')
    .toUpperCase()
    .replace(/[.,'"()]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function lowerBound(values, target) {
  let low = 0;
  let high = values.length;
  while (low < high) {
    const mid = (low + high) >> 1;
    if (values[mid] < target) low = mid + 1;
    else high = mid;
  }
  return low;
}

/**
 * Build a lookup index from normalized rows (see build/normalize.mjs).
 * Supports exact and longest-prefix resolution plus partial-prefix listing.
 */
export function createRegistry(rows) {
  const buckets = new Map(
    BLOCK_LENGTHS.map((length) => [length, { records: [], values: [], map: new Map() }]),
  );

  for (const row of rows) {
    const record = toRecord(row);
    const bucket = buckets.get(record.prefix.length);
    if (!bucket) continue;
    bucket.records.push(record);
  }
  for (const bucket of buckets.values()) {
    bucket.records.sort((a, b) => parseInt(a.prefix, 16) - parseInt(b.prefix, 16));
    bucket.values = bucket.records.map((record) => parseInt(record.prefix, 16));
    for (const record of bucket.records) bucket.map.set(record.prefix, record);
  }

  const allRecords = [];
  const portfolios = new Map();
  for (const bucket of buckets.values()) {
    for (const record of bucket.records) {
      allRecords.push(record);
      const key = portfolioKey(record.orgName);
      if (key === '') continue;
      const entry = portfolios.get(key) ?? { orgName: record.orgName, blocks: 0, addresses: 0 };
      entry.blocks += 1;
      entry.addresses += record.addressCount ?? 0;
      portfolios.set(key, entry);
    }
  }
  allRecords.sort((a, b) => (a.prefix < b.prefix ? -1 : a.prefix > b.prefix ? 1 : 0));

  // Shard rows carry global vendor totals; prefer them over the local count.
  for (const record of allRecords) {
    if (record.vendorBlocks === null || record.vendorBlocks === undefined) continue;
    const entry = portfolios.get(portfolioKey(record.orgName));
    if (entry) {
      entry.blocks = record.vendorBlocks;
      if (record.vendorAddresses !== null && record.vendorAddresses !== undefined) {
        entry.addresses = record.vendorAddresses;
      }
    }
  }

  return {
    size: allRecords.length,

    /** All records, sorted by prefix (used by free-text search). */
    records: () => allRecords,

    /** Registered blocks and total address space for an organization. */
    portfolio(orgName) {
      const entry = portfolios.get(portfolioKey(orgName));
      return entry ? { blocks: entry.blocks, addresses: entry.addresses } : null;
    },

    /**
     * Resolve a hex string of 6+ characters against the longest registered prefix.
     * Returns `{ record, matchedLength, exact }` or null.
     */
    resolve(hex) {
      for (const length of BLOCK_LENGTHS) {
        if (hex.length < length) continue;
        const record = buckets.get(length).map.get(hex.slice(0, length));
        if (record) {
          return { record, matchedLength: length, exact: hex.length === length };
        }
      }
      return null;
    },

    /**
     * List assignments whose prefix begins with `hex` (1–5 characters),
     * ordered lexicographically by prefix, capped at `limit` rows while
     * still reporting the full total.
     */
    listPartials(hex, limit = 200) {
      const matches = [];
      for (const length of BLOCK_LENGTHS) {
        const bucket = buckets.get(length);
        const lower = parseInt(hex.padEnd(length, '0'), 16);
        const upper = parseInt(hex.padEnd(length, 'F'), 16);
        for (let i = lowerBound(bucket.values, lower); i < bucket.values.length; i++) {
          if (bucket.values[i] > upper) break;
          matches.push(bucket.records[i]);
        }
      }
      matches.sort((a, b) => (a.prefix < b.prefix ? -1 : a.prefix > b.prefix ? 1 : 0));
      return {
        matches: matches.slice(0, limit),
        total: matches.length,
        truncated: matches.length > limit,
      };
    },
  };
}
