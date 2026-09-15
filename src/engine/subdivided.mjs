/**
 * "OUI subdivided" honesty: ~400 MA-L blocks are held by the IEEE
 * Registration Authority itself for subdivision into smaller blocks.
 * A lookup that lands on one shows the IEEE as if it were a vendor;
 * classify those distinctly instead (see docs/feature-research.md §7).
 */

const SUBDIVIDED_ORGS = new Set(['IEEE REGISTRATION AUTHORITY']);

/**
 * True when the block is an IEEE-held MA-L reserved for subdivision.
 * Vendor lookup does not apply to these blocks.
 */
export function isSubdivided(record) {
  return (
    record?.blockType === 'MA-L' &&
    SUBDIVIDED_ORGS.has(normalizeAuthority(record?.orgName))
  );
}

function normalizeAuthority(name) {
  return String(name ?? '')
    .toUpperCase()
    .replace(/[.,'"()]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}
