/** URL routing for deep links. Pure functions over path/search strings. */

import { normalizeInput } from '../engine/input.mjs';
import { splitBatch } from '../engine/route.mjs';

export { splitBatch };

/** Canonical uppercase hex for a token, or null when it is not a valid address. */
export function canonicalToken(token) {
  const normalized = normalizeInput(token);
  return normalized.ok ? normalized.hex : null;
}

/** Canonical path value: comma-separated uppercase hex, order preserved. */
export function canonicalQuery(tokens) {
  return tokens.map(canonicalToken).filter(Boolean).join(',');
}

/**
 * Parse a location into a lookup value. Any single non-empty path segment is
 * accepted (address, prefix, batch list, or free-text query); the input
 * classifier decides what it means. `?q=` is still supported for old links.
 * Returns `{ value }` or null when the location is not a lookup.
 */
export function parseLookup({ pathname = '/', search = '' } = {}) {
  const query = new URLSearchParams(search).get('q');
  if (query && query.trim() !== '') {
    return { value: query };
  }

  let segment = pathname;
  try {
    segment = decodeURIComponent(pathname);
  } catch {
    // keep the raw path when decoding fails
  }
  segment = segment.replace(/^\/+/, '').replace(/\/+$/, '');
  if (segment === '' || segment.includes('/')) return null;
  return { value: segment };
}
