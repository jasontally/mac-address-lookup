/** Lineage index over `lineage.<hash>.parquet` event rows. */

/**
 * Group lineage event rows by prefix into chronological entries.
 * Returns an index with `forPrefix(prefix)` lookup.
 */
export function createLineageIndex(rows) {
  const map = new Map();
  for (const row of rows) {
    let entry = map.get(row.prefix);
    if (!entry) {
      entry = {
        prefix: row.prefix,
        prefixLen: row.prefix_len,
        firstSeen: row.first_seen ?? null,
        lastSeen: row.last_seen ?? null,
        events: [],
      };
      map.set(row.prefix, entry);
    }
    entry.events.push({
      date: row.date ?? null,
      orgName: row.org_name ?? '',
      source: row.source ?? null,
    });
  }
  for (const entry of map.values()) {
    entry.events.sort((a, b) => {
      if (a.date === b.date) return 0;
      if (a.date === null) return 1;
      if (b.date === null) return -1;
      return a.date < b.date ? -1 : 1;
    });
  }
  return {
    size: map.size,
    /** Return the lineage entry for an exact prefix, or null. */
    forPrefix(prefix) {
      if (typeof prefix !== 'string') return null;
      return map.get(prefix.toUpperCase()) ?? null;
    },
    /** All lineage entries (used by free-text search). */
    all() {
      return [...map.values()];
    },
  };
}
