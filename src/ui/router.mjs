/** URL routing for deep links. Pure functions over path/search strings. */

import { normalizeInput } from '../engine/input.mjs';

const LOOKUP_PATH = /^[0-9a-fA-F][0-9a-fA-F\s:.-]*$/;

/** Split batch input on commas, semicolons, and whitespace. */
export function splitBatch(text) {
  return String(text ?? '')
    .split(/[,;\s]+/)
    .map((token) => token.trim())
    .filter(Boolean);
}

/** Canonical uppercase hex for a token, or null when it is not a valid address. */
export function canonicalToken(token) {
  const normalized = normalizeInput(token);
  return normalized.ok ? normalized.hex : null;
}

/** Canonical `?q=` value: comma-separated uppercase hex, order preserved. */
export function canonicalQuery(tokens) {
  return tokens.map(canonicalToken).filter(Boolean).join(',');
}

/**
 * Parse a location into a lookup route:
 *   `/001A2B` → `{ mode: 'single', value: '001A2B' }`
 *   `/?q=a,b` → `{ mode: 'batch', tokens: ['a','b'] }`
 * Returns null when the location is not a lookup.
 */
export function parseLookup({ pathname = '/', search = '' } = {}) {
  const query = new URLSearchParams(search).get('q');
  if (query && query.trim() !== '') {
    const tokens = splitBatch(query);
    if (tokens.length === 0) return null;
    return { mode: tokens.length > 1 ? 'batch' : 'single', value: query, tokens };
  }

  let segment = pathname;
  try {
    segment = decodeURIComponent(pathname);
  } catch {
    // keep raw path when decoding fails
  }
  segment = segment.replace(/^\/+/, '').replace(/\/+$/, '');
  if (segment === '' || segment.includes('/')) return null;
  if (!LOOKUP_PATH.test(segment)) return null;

  const tokens = splitBatch(segment);
  if (tokens.length === 0) return null;
  return { mode: tokens.length > 1 ? 'batch' : 'single', value: segment, tokens };
}
