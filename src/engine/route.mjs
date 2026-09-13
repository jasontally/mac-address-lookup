/** Input classification: address/prefix list, pasted text, or free-text search. */

import { normalizeInput } from './input.mjs';
import { extractMacs } from './search.mjs';

/** Split list input on commas, semicolons, and whitespace. */
export function splitBatch(text) {
  return String(text ?? '')
    .split(/[,;\s]+/)
    .map((token) => token.trim())
    .filter(Boolean);
}

/**
 * Decide how to handle raw user input:
 *   single  — one valid MAC address or prefix
 *   batch   — several valid addresses/prefixes, or addresses extracted from text
 *   search  — free-text query
 *   invalid — MAC-shaped input that does not parse
 */
export function classifyInput(text) {
  const value = String(text ?? '').trim();
  if (value === '') return { mode: 'invalid', error: 'empty', value };

  const tokens = splitBatch(value);
  const allValid = tokens.length > 0 && tokens.every((token) => normalizeInput(token).ok);
  if (allValid) {
    return tokens.length > 1
      ? { mode: 'batch', value, tokens }
      : { mode: 'single', value: tokens[0], tokens };
  }

  const extracted = extractMacs(value);
  if (extracted.length > 0) {
    return { mode: 'batch', value, tokens: extracted, extracted: true };
  }

  // MAC-shaped typo (for example "00:1G" or 13+ hex characters): report the parse error.
  if (/^[0-9a-fA-F]{13,}$/.test(value)) {
    return { mode: 'invalid', error: 'too_long', value };
  }
  if (/^[0-9a-fA-F]{2}[:\-.]/.test(value) || /^[0-9a-fA-F]{4}\./.test(value)) {
    return { mode: 'invalid', error: normalizeInput(value).error ?? 'invalid_chars', value };
  }

  return { mode: 'search', value };
}
