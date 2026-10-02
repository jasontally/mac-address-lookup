/**
 * Related-prefix link computation for pre-rendered pages (step 1 of
 * docs/thin-content-mitigation.md). Pure functions over the selected record
 * set so consecutive builds produce identical links for unchanged records.
 *
 * Links point only at pre-rendered pages: the selected set passed in is the
 * link-target universe. Groups with no members are omitted by the template.
 * Targets are deduped across sections so no link repeats on a page, and the
 * total is capped at MAX_LINKS.
 */

import { normalizeOrgName } from './lineage.mjs';

/** Cap on same-organization sibling links. */
export const SIBLING_CAP = 6;
/** Max links in the same-year cohort section. */
export const YEAR_CAP = 4;
/** Max related links on a page (6 siblings + 2 adjacent + 4 cohort). */
export const MAX_LINKS = 12;

function byPrefix(a, b) {
  return a.prefix < b.prefix ? -1 : a.prefix > b.prefix ? 1 : 0;
}

/** 4-digit year from the first-observed ISO date, or null when absent. */
export function yearOf(record) {
  const year = typeof record.firstSeen === 'string' ? record.firstSeen.slice(0, 4) : '';
  return /^\d{4}$/.test(year) ? year : null;
}

/**
 * Compute related links for every selected record.
 * Returns a Map: record.prefix → `{ sameOrg, adjacent, sameYear }`, each a
 * list of `{ prefix, orgName }` sorted by prefix. Records with no links are
 * omitted from the Map.
 */
export function computeRelatedLinks(selected) {
  const sorted = [...selected].sort(byPrefix);

  const orgRecords = new Map(); // normalized org name → records, prefix order
  const yearRecords = new Map(); // year → records, prefix order
  for (const record of sorted) {
    const orgKey = normalizeOrgName(record.orgName);
    if (orgKey !== '') {
      if (!orgRecords.has(orgKey)) orgRecords.set(orgKey, []);
      orgRecords.get(orgKey).push(record);
    }
    const year = yearOf(record);
    if (year) {
      if (!yearRecords.has(year)) yearRecords.set(year, []);
      yearRecords.get(year).push(record);
    }
  }

  const related = new Map();
  sorted.forEach((record, index) => {
    const entry = { sameOrg: [], adjacent: [], sameYear: [] };
    const used = new Set([record.prefix]);
    let budget = MAX_LINKS;

    const orgKey = normalizeOrgName(record.orgName);
    for (const sibling of orgRecords.get(orgKey) ?? []) {
      if (budget === 0 || entry.sameOrg.length >= SIBLING_CAP) break;
      if (used.has(sibling.prefix)) continue;
      entry.sameOrg.push({ prefix: sibling.prefix, orgName: sibling.orgName });
      used.add(sibling.prefix);
      budget -= 1;
    }

    for (const neighbor of [sorted[index - 1], sorted[index + 1]]) {
      if (!neighbor || budget === 0 || used.has(neighbor.prefix)) continue;
      entry.adjacent.push({ prefix: neighbor.prefix, orgName: neighbor.orgName });
      used.add(neighbor.prefix);
      budget -= 1;
    }

    const year = yearOf(record);
    for (const other of yearRecords.get(year) ?? []) {
      if (budget === 0 || entry.sameYear.length >= YEAR_CAP) break;
      if (used.has(other.prefix)) continue;
      entry.sameYear.push({ prefix: other.prefix, orgName: other.orgName });
      used.add(other.prefix);
      budget -= 1;
    }

    if (entry.sameOrg.length > 0 || entry.adjacent.length > 0 || entry.sameYear.length > 0) {
      related.set(record.prefix, entry);
    }
  });

  return related;
}
