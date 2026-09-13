/** Input normalization and MAC address bit analysis. */

const SEPARATORS = /[\s:.-]/g;

/**
 * Normalize raw user input into an uppercase hex string.
 * Accepts colons, hyphens, dots (Cisco), and whitespace as separators.
 */
export function normalizeInput(raw) {
  if (typeof raw !== 'string') return { ok: false, error: 'empty' };
  const hex = raw.replace(SEPARATORS, '').toUpperCase();
  if (hex === '') return { ok: false, error: 'empty' };
  if (hex.length > 12) return { ok: false, error: 'too_long' };
  if (!/^[0-9A-F]+$/.test(hex)) return { ok: false, error: 'invalid_chars' };
  return { ok: true, hex, length: hex.length };
}

/** Decode I/G (multicast) and U/L (locally administered) bits plus special addresses. */
export function analyzeBits(hex) {
  if (hex.length < 2) return null;
  const firstOctet = parseInt(hex.slice(0, 2), 16);
  const bytes = hex.match(/../g)?.map((byte) => parseInt(byte, 16)) ?? [];
  return {
    firstOctet,
    multicast: (firstOctet & 0b1) === 1,
    locallyAdministered: (firstOctet & 0b10) === 2,
    broadcast: hex.length === 12 && bytes.every((byte) => byte === 0xff),
    allZeros: bytes.length > 0 && bytes.every((byte) => byte === 0),
  };
}
