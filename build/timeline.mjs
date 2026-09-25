/**
 * Static SVG allocation timeline for hub pages.
 *
 * One column per first-observed year. Bar height is address space (log-scaled,
 * because MA-L and MA-S differ by four orders of magnitude); the dot above each
 * bar is allocation count. Every chart uses the same dataset-wide year range,
 * so a sparse vendor's blips remain comparable with busy years.
 */

function escapeSvg(value) {
  return String(value ?? '').replace(
    /[&<>"']/g,
    (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char],
  );
}

function formatNumber(value) {
  return Number(value ?? 0).toLocaleString('en-US');
}

/** Group dated records by observation year, filling every year in the range. */
export function allocationYears(records, { startYear = null, endYear = null } = {}) {
  const byYear = new Map();
  for (const record of records ?? []) {
    const year = Number(String(record?.firstSeen ?? '').slice(0, 4));
    if (!Number.isInteger(year) || year < 1000 || year > 9999) continue;
    const entry = byYear.get(year) ?? { year, blocks: 0, addresses: 0 };
    entry.blocks += 1;
    entry.addresses += record.addressCount ?? 0;
    byYear.set(year, entry);
  }

  const dated = [...byYear.values()].map((entry) => entry.year);
  const first = startYear ?? (dated.length ? Math.min(...dated) : null);
  const last = endYear ?? (dated.length ? Math.max(...dated) : null);
  if (first === null || last === null || first > last) return [];

  const years = [];
  for (let year = first; year <= last; year += 1) {
    years.push(
      byYear.get(year) ?? { year, blocks: 0, addresses: 0 },
    );
  }
  return years;
}

/**
 * Render one horizontal year timeline. `startYear`/`endYear` should be the
 * full dataset range so pages with sparse allocations do not compress time.
 */
export function renderAllocationTimeline(records, {
  label = 'MAC address allocations',
  startYear = null,
  endYear = null,
  note = 'Bar height shows address space on a logarithmic scale; the dot shows allocation count.',
} = {}) {
  const years = allocationYears(records, { startYear, endYear });
  if (years.length === 0) return '';

  const width = 720;
  const height = 150;
  const left = 8;
  const right = 8;
  const top = 20;
  const bottom = 30;
  const plotWidth = width - left - right;
  const plotHeight = height - top - bottom;
  const step = plotWidth / years.length;
  const barWidth = Math.max(1, Math.min(30, step * 0.62));
  const maxAddresses = Math.max(...years.map((year) => year.addresses), 1);
  const maxBlocks = Math.max(...years.map((year) => year.blocks), 1);

  const bars = years
    .map((year, index) => {
      if (year.blocks === 0 || year.addresses === 0) return '';
      const centered = left + index * step + step / 2;
      const ratio = Math.log10(Math.max(1, year.addresses)) / Math.log10(maxAddresses);
      const barHeight = Math.max(2, ratio * plotHeight);
      const x = centered - barWidth / 2;
      const y = top + plotHeight - barHeight;
      const dotRadius = 1.5 + 3.5 * Math.sqrt(year.blocks / maxBlocks);
      const title = `${year.year}: ${formatNumber(year.blocks)} block${
        year.blocks === 1 ? '' : 's'
      }, ${formatNumber(year.addresses)} addresses`;
      return [
        `        <g data-year="${year.year}" data-blocks="${year.blocks}" data-addresses="${year.addresses}">`,
        `          <title>${escapeSvg(title)}</title>`,
        `          <rect class="allocation-bar" x="${x.toFixed(2)}" y="${y.toFixed(2)}" width="${barWidth.toFixed(2)}" height="${barHeight.toFixed(2)}" rx="1" />`,
        `          <circle class="allocation-dot" cx="${centered.toFixed(2)}" cy="${(y - dotRadius - 2).toFixed(2)}" r="${dotRadius.toFixed(2)}" />`,
        `        </g>`,
      ].join('\n');
    })
    .filter(Boolean)
    .join('\n');

  const firstYear = years[0].year;
  const lastYear = years[years.length - 1].year;
  const ariaLabel = `${label} by first-observed year, ${firstYear} through ${lastYear}. ${note}`;

  return `      <figure class="allocation-timeline" role="img" aria-label="${escapeSvg(ariaLabel)}">
        <svg viewBox="0 0 ${width} ${height}" preserveAspectRatio="xMidYMid meet" aria-hidden="true" focusable="false">
          <title>${escapeSvg(label)}</title>
          <desc>${escapeSvg(note)}</desc>
          <line class="allocation-axis" x1="${left}" y1="${top + plotHeight}" x2="${width - right}" y2="${top + plotHeight}" />
${bars}
          <text class="allocation-year allocation-year--start" x="${left}" y="${height - 6}">${firstYear}</text>
          <text class="allocation-year allocation-year--end" x="${width - right}" y="${height - 6}" text-anchor="end">${lastYear}</text>
        </svg>
        <figcaption>${escapeSvg(note)}</figcaption>
      </figure>`;
}

/** Earliest and latest first-observed years across the whole registry. */
export function datasetYearRange(records) {
  let startYear = null;
  let endYear = null;
  for (const record of records ?? []) {
    const year = Number(String(record?.firstSeen ?? '').slice(0, 4));
    if (!Number.isInteger(year) || year < 1000 || year > 9999) continue;
    if (startYear === null || year < startYear) startYear = year;
    if (endYear === null || year > endYear) endYear = year;
  }
  return startYear === null ? { startYear: null, endYear: null } : { startYear, endYear };
}
