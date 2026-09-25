/**
 * Static SVG allocation timeline for hub pages.
 *
 * A continuous line over exact first-observed dates. Line height is address
 * space on a log1p scale, so zero stays at the baseline and MA-L vs MA-S
 * allocations remain visible. Every chart uses the same dataset-wide date
 * range, so a sparse vendor's blips remain comparable with busy periods.
 */

import { formatDate } from '../src/ui/format.mjs';

function escapeSvg(value) {
  return String(value ?? '').replace(
    /[&<>"']/g,
    (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char],
  );
}

function parseIsoDate(value) {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return null;
  const timestamp = Date.parse(`${value}T00:00:00Z`);
  return Number.isFinite(timestamp) ? timestamp : null;
}

function isoDateFromTimestamp(timestamp) {
  return new Date(timestamp).toISOString().slice(0, 10);
}

/** Group dated records by exact first-observed date. */
export function allocationDates(records, { startDate = null, endDate = null } = {}) {
  const byDate = new Map();
  for (const record of records ?? []) {
    const timestamp = parseIsoDate(record?.firstSeen);
    if (timestamp === null) continue;
    const date = record.firstSeen;
    const entry = byDate.get(date) ?? { date, timestamp, blocks: 0, addresses: 0 };
    entry.blocks += 1;
    entry.addresses += record.addressCount ?? 0;
    byDate.set(date, entry);
  }

  const dated = [...byDate.values()].sort((a, b) => a.timestamp - b.timestamp);
  if (dated.length === 0) return { points: [], startDate: null, endDate: null };

  const startTime = startDate ? parseIsoDate(startDate) : dated[0].timestamp;
  const endTime = endDate ? parseIsoDate(endDate) : dated[dated.length - 1].timestamp;
  if (startTime === null || endTime === null || startTime > endTime) {
    return { points: [], startDate: null, endDate: null };
  }

  const points = dated.filter(
    (entry) => entry.timestamp >= startTime && entry.timestamp <= endTime,
  );
  return {
    points,
    startDate: isoDateFromTimestamp(startTime),
    endDate: isoDateFromTimestamp(endTime),
  };
}

/**
 * Build the visible line plus its hover points. A large gap gets a zero
 * midpoint; a small gap connects directly from one allocation to the next.
 */
function buildPathPoints(entries, {
  startTime,
  endTime,
  left,
  right,
  top,
  plotHeight,
  maxAddresses,
  directGapPx = 16,
}) {
  const plotWidth = right - left;
  const logMax = Math.log10(1 + maxAddresses);
  const xFor = (timestamp) =>
    left + ((timestamp - startTime) / (endTime - startTime)) * plotWidth;
  const yFor = (value) => {
    const normalized = Math.log10(1 + Math.max(0, value)) / logMax;
    return top + plotHeight * (1 - normalized);
  };
  const point = (timestamp, value) => ({
    x: xFor(timestamp),
    y: yFor(value),
    value,
  });

  const points = [];
  if (entries[0].timestamp > startTime) points.push(point(startTime, 0));
  for (const [index, entry] of entries.entries()) {
    points.push(point(entry.timestamp, entry.addresses));
    const next = entries[index + 1];
    if (!next) continue;
    const gapPx = xFor(next.timestamp) - xFor(entry.timestamp);
    if (gapPx > directGapPx) {
      const midpoint = entry.timestamp + (next.timestamp - entry.timestamp) / 2;
      points.push(point(midpoint, 0));
    }
  }
  if (entries[entries.length - 1].timestamp < endTime) {
    points.push(point(endTime, 0));
  }

  return points;
}

function linePath(points) {
  return points
    .map((point, index) => `${index === 0 ? 'M' : 'L'} ${point.x.toFixed(2)} ${point.y.toFixed(2)}`)
    .join(' ');
}

/**
 * Render one continuous date timeline. `startDate`/`endDate` should be the
 * full dataset range so pages with sparse allocations do not compress time.
 */
export function renderAllocationTimeline(records, {
  label = 'MAC address allocations',
  startDate = null,
  endDate = null,
  note = 'Line height shows address space on a logarithmic scale; hover for date and value.',
} = {}) {
  const { points: dated, startDate: resolvedStart, endDate: resolvedEnd } =
    allocationDates(records, { startDate, endDate });
  if (dated.length === 0) return '';

  const width = 720;
  const height = 160;
  const left = 8;
  const right = width - 8;
  const top = 18;
  const bottom = 30;
  const baseline = top + (height - top - bottom);
  const maxAddresses = Math.max(...dated.map((entry) => entry.addresses), 1);
  const pathPoints = buildPathPoints(dated, {
    startTime: Date.parse(`${resolvedStart}T00:00:00Z`),
    endTime: Date.parse(`${resolvedEnd}T00:00:00Z`),
    left,
    right,
    top,
    plotHeight: baseline - top,
    maxAddresses,
  });
  if (pathPoints.length === 0) return '';

  const line = linePath(pathPoints);
  const area = `${line} L ${pathPoints[pathPoints.length - 1].x.toFixed(2)} ${baseline.toFixed(2)} L ${pathPoints[0].x.toFixed(2)} ${baseline.toFixed(2)} Z`;
  const hoverPoints = pathPoints.map((point) => [point.x, point.value]);
  const startYear = resolvedStart.slice(0, 4);
  const endYear = resolvedEnd.slice(0, 4);
  const startLabel =
    startYear === endYear ? formatDate(resolvedStart, 'en') : startYear;
  const endLabel =
    startYear === endYear ? formatDate(resolvedEnd, 'en') : endYear;
  const ariaLabel = `${label} by first-observed date, ${formatDate(resolvedStart, 'en')} through ${formatDate(resolvedEnd, 'en')}. ${note}`;

  return `      <figure class="allocation-timeline" role="img" aria-label="${escapeSvg(ariaLabel)}">
        <svg
          class="allocation-chart"
          viewBox="0 0 ${width} ${height}"
          preserveAspectRatio="xMidYMid meet"
          aria-hidden="true"
          focusable="false"
          data-start-date="${escapeSvg(resolvedStart)}"
          data-end-date="${escapeSvg(resolvedEnd)}"
          data-left="${left}"
          data-right="${right}"
          data-max-addresses="${maxAddresses}"
          data-points='${JSON.stringify(hoverPoints)}'
        >
          <title>${escapeSvg(label)}</title>
          <desc>${escapeSvg(note)}</desc>
          <line class="allocation-axis" x1="${left}" y1="${baseline}" x2="${right}" y2="${baseline}" />
          <line class="allocation-crosshair" x1="${left}" y1="${top}" x2="${left}" y2="${baseline}" visibility="hidden" vector-effect="non-scaling-stroke" />
          <path class="allocation-area" d="${area}" />
          <path class="allocation-line" d="${line}" vector-effect="non-scaling-stroke" />
          <text class="allocation-year allocation-year--start" x="${left}" y="${height - 6}">${escapeSvg(startLabel)}</text>
          <text class="allocation-year allocation-year--end" x="${right}" y="${height - 6}" text-anchor="end">${escapeSvg(endLabel)}</text>
        </svg>
        <div class="allocation-tooltip" hidden></div>
        <figcaption>${escapeSvg(note)}</figcaption>
      </figure>`;
}

/** Earliest and latest first-observed dates across the whole registry. */
export function datasetDateRange(records) {
  let startDate = null;
  let endDate = null;
  for (const record of records ?? []) {
    const timestamp = parseIsoDate(record?.firstSeen);
    if (timestamp === null) continue;
    const date = isoDateFromTimestamp(timestamp);
    if (startDate === null || date < startDate) startDate = date;
    if (endDate === null || date > endDate) endDate = date;
  }
  return startDate === null ? { startDate: null, endDate: null } : { startDate, endDate };
}
