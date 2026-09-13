/** MAC address format conversions. */

/** Convert a hex string into every common representation. */
export function formatAddress(hex) {
  const upper = hex.toUpperCase();
  const formats = {
    plain: upper,
    colon: group(upper, 2, ':'),
    hyphen: group(upper, 2, '-'),
    cisco: group(upper, 4, '.'),
  };
  if (upper.length === 12) {
    formats.eui64 = formatEui64(upper);
    formats.ipv6LinkLocal = formatIpv6LinkLocal(upper);
  }
  return formats;
}

function group(hex, size, separator) {
  return hex.match(new RegExp(`.{1,${size}}`, 'g')).join(separator);
}

/** Build 64-bit interface identifier bytes, flipping the universal/local bit. */
function eui64Bytes(hex) {
  const bytes = hex.match(/../g).map((byte) => parseInt(byte, 16));
  bytes[0] ^= 0x02;
  return [bytes[0], bytes[1], bytes[2], 0xff, 0xfe, bytes[3], bytes[4], bytes[5]];
}

function formatEui64(hex) {
  return eui64Bytes(hex)
    .map((byte) => byte.toString(16).padStart(2, '0').toUpperCase())
    .join('-');
}

function formatIpv6LinkLocal(hex) {
  const eui = eui64Bytes(hex);
  const groups = [
    0xfe80,
    0,
    0,
    0,
    (eui[0] << 8) | eui[1],
    (eui[2] << 8) | eui[3],
    (eui[4] << 8) | eui[5],
    (eui[6] << 8) | eui[7],
  ];
  return compressIpv6(groups);
}

/** Compress a group array to RFC 5952 form (lowercase, longest zero run as `::`). */
function compressIpv6(groups) {
  let bestStart = -1;
  let bestLength = 0;
  for (let i = 0; i < groups.length; ) {
    if (groups[i] !== 0) {
      i++;
      continue;
    }
    let end = i;
    while (end < groups.length && groups[end] === 0) end++;
    if (end - i > bestLength) {
      bestStart = i;
      bestLength = end - i;
    }
    i = end;
  }
  const parts = groups.map((group) => group.toString(16));
  if (bestLength < 2) return parts.join(':');
  const left = parts.slice(0, bestStart).join(':');
  const right = parts.slice(bestStart + bestLength).join(':');
  return `${left}::${right}`;
}
