/** Composition: normalize input, resolve vendor, analyze, and classify. */

import { analyzeBits, normalizeInput } from './input.mjs';
import { formatAddress } from './formats.mjs';
import { classifyRandomization, detectHypervisor } from './vendors.mjs';

/**
 * Run a full lookup against a registry built with `createRegistry`.
 * Result kinds: `invalid` | `partial` | `none` | `match`.
 */
export function lookup(registry, raw) {
  const input = normalizeInput(raw);
  if (!input.ok) {
    return { kind: 'invalid', error: input.error, raw: typeof raw === 'string' ? raw : '' };
  }

  const { hex } = input;
  const bits = analyzeBits(hex);
  const formats = formatAddress(hex);
  const hypervisor = detectHypervisor(hex);
  const base = { input: { raw, hex, length: hex.length }, bits, formats, hypervisor };

  if (hex.length < 6) {
    const { matches, total, truncated } = registry.listPartials(hex);
    return { ...base, kind: 'partial', matches, total, truncated };
  }

  const resolved = registry.resolve(hex);
  const match = resolved?.record ?? null;
  const randomization = classifyRandomization({ bits, match, hypervisor });

  if (!match) {
    return { ...base, kind: 'none', randomization };
  }

  return {
    ...base,
    kind: 'match',
    randomization,
    match: { ...match, matchedLength: resolved.matchedLength, exact: resolved.exact },
  };
}
