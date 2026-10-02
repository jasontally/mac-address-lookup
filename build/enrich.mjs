/**
 * Per-page computed context (step 3 of docs/thin-content-mitigation.md):
 * at most three short sentences per prefix page, every one derived from data
 * already on the record or in the build's org groups - portfolio position,
 * block-type context, and registration cohort. Sentences are omitted, not
 * fudged, when the data is missing, and never repeat what the details grid,
 * badges, banners, or lineage already state.
 */

import { formatAddresses, formatCount, formatDate } from '../src/ui/format.mjs';

/**
 * Numeric params get pre-formatted at render time:
 * `count` → grouped digits, `addresses` → humanized, `date` → observed date.
 * The client repeats the same formats with the active locale.
 */
const ENRICH_FORMATS = {
  count: (value) => formatCount(value, 'en'),
  addresses: (value) => formatAddresses(value, 'en'),
  date: (value) => formatDate(value, 'en'),
};

export function enrichDisplayParams(params, { formatted = false } = {}) {
  return Object.fromEntries(
    Object.entries(params).map(([key, value]) => {
      const format = formatted ? ENRICH_FORMATS[key] : null;
      return [key, format ? format(value) : value];
    }),
  );
}

/**
 * Build the sentence list for one record.
 * `orgFirstSeen` is the org's earliest observed registration date; null has
 * no cohort statement (single-block orgs and missing dates omit, never pad).
 */
export function buildEnrichment(record, { orgFirstSeen = null } = {}) {
  const sentences = [];
  if ((record.vendorBlocks ?? 0) > 1) {
    if (record.vendorAddresses) {
      sentences.push({
        key: 'enrich.portfolio',
        params: { org: record.orgName, count: record.vendorBlocks, addresses: record.vendorAddresses },
      });
    }
    if (record.firstSeen && orgFirstSeen && record.firstSeen === orgFirstSeen) {
      sentences.push({
        key: 'enrich.oldest',
        params: { org: record.orgName, date: record.firstSeen },
      });
    }
  }
  if (record.blockType === 'CID') {
    sentences.push({ key: 'enrich.cid', params: {} });
  } else if (record.blockType !== 'MA-L') {
    sentences.push({
      key: 'enrich.blockSize',
      params: { type: record.blockType, addresses: record.addressCount },
    });
  }
  return sentences.slice(0, 3);
}
