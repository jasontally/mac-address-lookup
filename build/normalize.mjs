/** Supported assignment lengths → prefix bits. */
export const PREFIX_LENGTH_BITS = { 6: 24, 7: 28, 9: 36 };

/** Parse CSV text into rows of string fields (RFC 4180 style, no dependencies). */
export function parseCsv(text) {
  const rows = [];
  let row = [];
  let field = '';
  let inQuotes = false;
  const src = text.charCodeAt(0) === 0xfeff ? text.slice(1) : text;

  for (let i = 0; i < src.length; i++) {
    const char = src[i];
    if (inQuotes) {
      if (char === '"') {
        if (src[i + 1] === '"') {
          field += '"';
          i++;
        } else {
          inQuotes = false;
        }
      } else {
        field += char;
      }
    } else if (char === '"') {
      inQuotes = true;
    } else if (char === ',') {
      row.push(field);
      field = '';
    } else if (char === '\n') {
      row.push(field);
      rows.push(row);
      row = [];
      field = '';
    } else if (char !== '\r') {
      field += char;
    }
  }

  if (field !== '' || row.length > 0) {
    row.push(field);
    rows.push(row);
  }
  return rows;
}

/**
 * IEEE organization addresses end with a country code, often followed by a
 * postal code. Scan the last few tokens for a two-letter uppercase code.
 */
export function extractCountry(address) {
  if (!address) return null;
  const tokens = address.trim().toUpperCase().split(/\s+/);
  for (let i = tokens.length - 1; i >= 0 && i >= tokens.length - 4; i--) {
    if (/^[A-Z]{2}$/.test(tokens[i])) return tokens[i];
  }
  return null;
}

/** Normalize one registry assignment string into prefix metadata, or null if invalid. */
export function normalizeAssignment(assignment) {
  if (typeof assignment !== 'string') return null;
  const prefix = assignment.trim().toUpperCase();
  if (!/^[0-9A-F]+$/.test(prefix)) return null;
  const prefixLen = PREFIX_LENGTH_BITS[prefix.length];
  if (!prefixLen) return null;
  return { prefix, prefixLen, addressCount: 2 ** (48 - prefixLen) };
}

/**
 * Normalize fetched registry sources into sorted records plus statistics.
 * Later registries never override an earlier prefix; duplicates are reported.
 */
export function normalizeRegistries(sources) {
  const records = [];
  const seen = new Map();
  const stats = { perRegistry: {}, skipped: [], duplicates: [], total: 0, privateCount: 0 };

  for (const source of sources) {
    const rows = parseCsv(source.text);
    const header = (rows.shift() ?? []).map((name) => name.trim().toLowerCase());
    const columns = {
      assignment: header.indexOf('assignment'),
      orgName: header.indexOf('organization name'),
      orgAddress: header.indexOf('organization address'),
    };
    if (columns.assignment === -1 || columns.orgName === -1) {
      throw new Error(`${source.name}: unexpected CSV header: ${header.join(', ')}`);
    }

    let kept = 0;
    let skipped = 0;
    for (const row of rows) {
      if (row.length === 1 && row[0].trim() === '') continue;
      const parsed = normalizeAssignment(row[columns.assignment]);
      if (!parsed) {
        skipped++;
        stats.skipped.push({ registry: source.name, assignment: row[columns.assignment] ?? '' });
        continue;
      }
      if (seen.has(parsed.prefix)) {
        stats.duplicates.push(parsed.prefix);
        continue;
      }
      const orgName = (row[columns.orgName] ?? '').trim();
      const orgAddress = columns.orgAddress === -1 ? '' : (row[columns.orgAddress] ?? '').trim();
      const record = {
        prefix: parsed.prefix,
        prefixLen: parsed.prefixLen,
        blockType: source.name,
        addressCount: parsed.addressCount,
        orgName,
        orgAddress,
        country: extractCountry(orgAddress),
        isPrivate: /^private$/i.test(orgName),
      };
      seen.set(record.prefix, record);
      records.push(record);
      kept++;
    }
    stats.perRegistry[source.name] = { rows: rows.length, kept, skipped };
  }

  records.sort((a, b) => parseInt(a.prefix, 16) - parseInt(b.prefix, 16));
  stats.total = records.length;
  stats.privateCount = records.filter((record) => record.isPrivate).length;
  return { records, stats };
}
