/** Text extraction and free-text search over the registry and lineage. */

import { normalizeInput } from './input.mjs';
import { countryName } from './countries.mjs';

const COLON_OR_HYPHEN = /\b[0-9A-Fa-f]{2}(?:[:\-][0-9A-Fa-f]{2}){5}/g;
const CISCO = /\b[0-9A-Fa-f]{4}\.[0-9A-Fa-f]{4}\.[0-9A-Fa-f]{4}/g;
const SPACED = /\b[0-9A-Fa-f]{2}(?:\s+[0-9A-Fa-f]{2}){5}/g;
const BARE = /\b[0-9A-Fa-f]{12}\b/g;

/**
 * Extract full MAC addresses from arbitrary text (CLI output, tickets, logs).
 * Bare 12-hex tokens are accepted only with clean boundaries so UUID tails and
 * longer identifiers are not misread. Returns unique uppercase hex strings.
 */
export function extractMacs(text) {
  const source = String(text ?? '');
  const found = new Map();

  const accept = (value) => {
    const normalized = normalizeInput(value);
    if (normalized.ok && normalized.hex.length === 12) found.set(normalized.hex, true);
  };

  for (const match of source.matchAll(COLON_OR_HYPHEN)) accept(match[0]);
  for (const match of source.matchAll(CISCO)) accept(match[0]);
  for (const match of source.matchAll(SPACED)) accept(match[0]);

  for (const match of source.matchAll(BARE)) {
    const before = match.index > 0 ? source[match.index - 1] : '';
    if (before && /[0-9A-Fa-f:.\-]/.test(before)) continue; // e.g. a UUID tail
    accept(match[0]);
  }

  return [...found.keys()];
}

function normalizeOrg(name) {
  return String(name ?? '')
    .toUpperCase()
    .replace(/[.,'"()]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function reasonLabel(reason) {
  const labels = {
    vendor: 'Vendor',
    former: 'Former owner',
    country: 'Country',
    registry: 'Block type',
    prefix: 'Prefix',
    registered: 'Registration year',
  };
  return labels[reason.type] ?? reason.type;
}

/**
 * Free-text search across current organizations, former organizations from
 * lineage, countries, registry types, prefixes, and registration years.
 * All tokens must match; results are ranked and capped.
 */
export function searchRegistry(registry, lineage, query, { limit = 200 } = {}) {
  const tokens = String(query ?? '')
    .toLowerCase()
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 6);
  if (tokens.length === 0) return { matches: [], total: 0, truncated: false, portfolio: null };

  const formerByPrefix = new Map();
  for (const entry of lineage?.all?.() ?? []) {
    formerByPrefix.set(
      entry.prefix,
      entry.events.map((event) => event.orgName).filter(Boolean),
    );
  }

  const matchToken = (record, formerNames, token) => {
    const org = normalizeOrg(record.orgName).toLowerCase();
    if (org === token) return { score: 100, reason: { type: 'vendor' } };
    if (org.split(' ').some((word) => word.startsWith(token))) {
      return { score: 80, reason: { type: 'vendor' } };
    }
    if (org.includes(token)) return { score: 60, reason: { type: 'vendor' } };

    const former = formerNames.find((name) => normalizeOrg(name).toLowerCase().includes(token));
    if (former) return { score: 70, reason: { type: 'former', detail: former } };

    const country = record.country ? String(record.country).toLowerCase() : '';
    const name = countryName(record.country)?.toLowerCase() ?? '';
    if (country && (name === token || country === token)) {
      return { score: 55, reason: { type: 'country', detail: record.country.toUpperCase() } };
    }
    if (name && name.split(' ').some((word) => word.startsWith(token))) {
      return { score: 48, reason: { type: 'country', detail: record.country.toUpperCase() } };
    }
    if (name.includes(token)) {
      return { score: 42, reason: { type: 'country', detail: record.country.toUpperCase() } };
    }

    if (record.blockType?.toLowerCase() === token) {
      return { score: 40, reason: { type: 'registry', detail: record.blockType } };
    }
    if (/^[0-9a-f]+$/.test(token) && record.prefix.toLowerCase().startsWith(token)) {
      return { score: 75, reason: { type: 'prefix' } };
    }
    if (record.firstSeen && record.firstSeen.startsWith(token)) {
      return { score: 45, reason: { type: 'registered', detail: record.firstSeen.slice(0, 4) } };
    }
    return null;
  };

  const matches = [];
  for (const record of registry.records()) {
    const formerNames = formerByPrefix.get(record.prefix) ?? [];
    let score = 0;
    let reason = null;
    let matchedAll = true;
    for (const token of tokens) {
      const hit = matchToken(record, formerNames, token);
      if (!hit) {
        matchedAll = false;
        break;
      }
      score += hit.score;
      if (!reason) reason = hit.reason;
    }
    if (matchedAll) matches.push({ record, score, reason });
  }

  matches.sort((a, b) => {
    if (b.score !== a.score) return b.score - a.score;
    return a.record.prefix < b.record.prefix ? -1 : 1;
  });

  const total = matches.length;
  let portfolio = null;
  if (tokens.length === 1 && matches.length > 0) {
    const firstOrg = normalizeOrg(matches[0].record.orgName).toLowerCase();
    const sameVendor = matches.every(
      (match) => normalizeOrg(match.record.orgName).toLowerCase() === firstOrg,
    );
    if (sameVendor) {
      const stats = registry.portfolio(matches[0].record.orgName);
      if (stats) portfolio = { orgName: matches[0].record.orgName, ...stats };
    }
  }

  return { matches: matches.slice(0, limit), total, truncated: total > limit, portfolio };
}

/** Aggregate batch/extraction results into one compact summary. */
export function summarizeLookups(entries) {
  const summary = {
    total: entries.length,
    matched: 0,
    unregistered: 0,
    randomized: 0,
    hypervisor: 0,
    invalid: 0,
    partial: 0,
    vendors: [],
  };
  const vendorCounts = new Map();

  for (const { result } of entries) {
    if (result.kind === 'match') {
      summary.matched += 1;
      const name = result.match.orgName || 'Unknown organization';
      vendorCounts.set(name, (vendorCounts.get(name) ?? 0) + 1);
    } else if (result.kind === 'none') {
      summary.unregistered += 1;
    } else if (result.kind === 'partial') {
      summary.partial += 1;
    } else {
      summary.invalid += 1;
    }
    if (result.hypervisor) summary.hypervisor += 1;
    if (result.randomization?.likely) summary.randomized += 1;
  }

  summary.vendors = [...vendorCounts.entries()]
    .sort((a, b) => b[1] - a[1] || (a[0] < b[0] ? -1 : 1))
    .slice(0, 3)
    .map(([name, count]) => ({ name, count }));

  return summary;
}

export { reasonLabel };
