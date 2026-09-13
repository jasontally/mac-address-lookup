/**
 * Transform runZero mac-tracker history into prefix lineage records.
 *
 * The tracker records an `add` entry plus a `change` entry per observed
 * snapshot diff. Many "changes" are only formatting (case, punctuation) or
 * transient data glitches, so entries are normalized and collapsed before
 * a prefix is considered to have changed hands.
 */

const IGNORED_ORGS = new Set(['', 'PRIVATE', 'IEEE REGISTRATION AUTHORITY']);

/** Fold case, punctuation, and whitespace for organization-name comparison. */
export function normalizeOrgName(name) {
  return String(name ?? '')
    .toUpperCase()
    .replace(/[.,'"()]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function prefixFromKey(key) {
  const [hex, maskText] = String(key).split('/');
  const mask = Number(maskText);
  if (!/^[0-9a-fA-F]+$/.test(hex ?? '') || ![24, 28, 36].includes(mask)) return null;
  return { prefix: hex.slice(0, mask / 4).toUpperCase(), prefixLen: mask };
}

/** Earliest observed date for every tracked prefix (not just changed ones). */
export function buildFirstSeen(history) {
  const map = new Map();
  for (const [key, records] of Object.entries(history)) {
    const parsed = prefixFromKey(key);
    if (!parsed || !Array.isArray(records)) continue;
    let earliest = null;
    for (const record of records) {
      const date = typeof record.d === 'string' && record.d !== '' ? record.d : null;
      if (date && (earliest === null || date < earliest)) earliest = date;
    }
    if (earliest) map.set(parsed.prefix, earliest);
  }
  return map;
}

/**
 * Build lineage entries keyed by prefix. A prefix qualifies only when it has
 * at least two distinct organizations after normalization.
 */
export function buildLineage(history) {
  const entries = [];
  for (const [key, records] of Object.entries(history)) {
    const parsed = prefixFromKey(key);
    if (!parsed || !Array.isArray(records) || records.length === 0) continue;

    const events = [];
    let firstSeen = null;
    let lastSeen = null;
    for (const record of records) {
      const date = typeof record.d === 'string' && record.d !== '' ? record.d : null;
      if (date) {
        if (firstSeen === null || date < firstSeen) firstSeen = date;
        if (lastSeen === null || date > lastSeen) lastSeen = date;
      }

      const orgName = String(record.o ?? '').trim();
      const normalized = normalizeOrgName(orgName);
      if (IGNORED_ORGS.has(normalized)) continue;

      const previous = events[events.length - 1];
      if (previous && normalizeOrgName(previous.orgName) === normalized) continue;
      events.push({ date, orgName, source: record.s || null });
    }

    if (events.length < 2) continue;
    entries.push({ ...parsed, firstSeen, lastSeen, events });
  }

  entries.sort((a, b) => (a.prefix < b.prefix ? -1 : a.prefix > b.prefix ? 1 : 0));
  return entries;
}
