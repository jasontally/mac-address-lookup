/** Client-side exports for batch results: CSV download and JSON copy. */

const CSV_COLUMNS = ['input', 'result', 'blockType', 'orgName', 'country', 'flags'];

/** CSV-escape a value: quote when it contains comma, quote, or newline. */
export function csvCell(value) {
  const text = String(value ?? '');
  return /[",\n]/.test(text) ? `"${text.replaceAll('"', '""')}"` : text;
}

/** Flatten one batch entry's result into a row object. */
export function exportRow({ raw, result }) {
  const row = { input: raw, result: '', blockType: '', orgName: '', country: '', flags: [] };
  if (!result) return { ...row, result: 'invalid' };
  if (result.kind === 'match') {
    row.result = 'match';
    row.blockType = result.match.blockType ?? '';
    row.orgName = result.match.orgName ?? '';
    row.country = result.match.country ?? '';
  } else if (result.kind === 'none') {
    row.result = 'unregistered';
  } else if (result.kind === 'partial') {
    row.result = 'partial';
  } else {
    row.result = 'invalid';
  }
  if (result.hypervisor) row.flags.push(`VM: ${result.hypervisor.name}`);
  if (result.randomization?.likely) row.flags.push('randomized');
  return row;
}

export function toCsv(entries) {
  const header = CSV_COLUMNS.join(',');
  const body = entries
    .map((entry) => {
      const row = exportRow(entry);
      return CSV_COLUMNS.map((column) =>
        csvCell(Array.isArray(row[column]) ? row[column].join(' ') : row[column]),
      ).join(',');
    })
    .join('\n');
  return `${header}\n${body}\n`;
}

export function toJson(entries) {
  return JSON.stringify(
    entries.map((entry) => {
      const row = exportRow(entry);
      return {
        input: row.input,
        result: row.result,
        blockType: row.blockType || null,
        orgName: row.orgName || null,
        country: row.country || null,
        flags: row.flags,
      };
    }),
    null,
    2,
  ) + '\n';
}

/** Trigger a client-side file download for the given text. */
export function downloadText(filename, text, type = 'text/csv') {
  const blob = new Blob([text], { type: `${type};charset=utf-8` });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = filename;
  document.body.append(anchor);
  anchor.click();
  anchor.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1_000);
}
