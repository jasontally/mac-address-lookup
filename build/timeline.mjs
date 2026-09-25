/**
 * Static SVG allocation timeline for hub pages.
 *
 * A continuous line over exact first-observed dates. Line height is address
 * space on a linear scale, with the maximum sized independently per chart so
 * big and small vendors both fill the plot. Every chart uses the same
 * dataset-wide date range, so sparse vendors still occupy the full timeline.
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
  let cumulative = 0;
  const byDateEntries = [];
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

  for (const entry of dated) {
    cumulative += entry.addresses;
    entry.cumulative = cumulative;
  }

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
 * Build the visible step line plus its hover points for cumulative totals.
 * Value holds steady between allocations (step-after), so hovering reflects
 * the total through that date.
 */
function buildPathPoints(entries, {
  startTime,
  endTime,
  left,
  right,
  top,
  plotHeight,
  maxAddresses,
}) {
  const plotWidth = right - left;
  const xFor = (timestamp) =>
    left + ((timestamp - startTime) / (endTime - startTime)) * plotWidth;
  const yFor = (value) =>
    normalizedY(value, { plotHeight, maxAddresses }) + top;
  const point = (timestamp, value) => ({
    x: xFor(timestamp),
    y: yFor(value),
    value,
  });

  const points = [];
  if (entries[0].timestamp > startTime) points.push(point(startTime, 0));
  for (const [index, entry] of entries.entries()) {
    const next = entries[index + 1];
    points.push(point(entry.timestamp, entry.cumulative));
    if (!next) continue;
    // Step: hold the total until the next allocation, never dip.
    points.push(point(next.timestamp, entry.cumulative));
  }
  if (entries[entries.length - 1].timestamp < endTime) {
    points.push(point(endTime, entries[entries.length - 1].cumulative));
  }

  return points;
}

/** Distance from the baseline for one value on the linear scale. */
function normalizedY(value, { plotHeight, maxAddresses }) {
  const normalized = Math.max(0, value) / maxAddresses;
  return plotHeight * (1 - normalized);
}

/**
 * Linear y ticks: pick "nice" round numbers dividing the plot into roughly
 * three sections, always topped by the true maximum. Rejected when the
 * rendered labels would collide.
 */
function yTicks(maxAddresses) {
  const candidates = [maxAddresses];
  const magnitude = 10 ** Math.floor(Math.log10(maxAddresses));
  const scaled = maxAddresses / magnitude;
  const outerStep = scaled < 1.5 ? 1 : scaled < 3.5 ? 2 : scaled < 7.5 ? 5 : 10;
  const outer = magnitude * outerStep;
  if (outer <= maxAddresses) candidates.push(outer);
  const half = maxAddresses / 2;
  const halfMagnitude = 10 ** Math.floor(Math.log10(half));
  const halfScaled = half / halfMagnitude;
  const innerStep = halfScaled < 1.5 ? 1 : halfScaled < 3.5 ? 2 : halfScaled < 7.5 ? 5 : 10;
  const inner = halfMagnitude * innerStep;
  if (inner > 0 && inner < maxAddresses && inner !== outer) candidates.push(inner);
  return [...new Set(candidates.filter((value) => value > 0))];
}

/** Abbreviated axis label for an address count ("4.1 thousand", "16.8 million"). */
function tickLabel(value) {
  if (value >= 1e12) return `${trimValue(value / 1e12)} trillion`;
  if (value >= 1e9) return `${trimValue(value / 1e9)} billion`;
  if (value >= 1e6) return `${trimValue(value / 1e6)} million`;
  if (value >= 1e3) return `${trimValue(value / 1e3)} thousand`;
  return formatNumber(value);
}

function trimValue(scaled) {
  return scaled % 1 === 0 ? String(scaled) : scaled.toFixed(1);
}

/** Evenly spaced year labels across the plot's start and end years. */
function xTicks(startTime, endTime, count) {
  const ticks = [];
  const startYear = new Date(startTime).getUTCFullYear();
  const endYear = new Date(endTime).getUTCFullYear();
  const years = endYear - startYear;
  if (years <= 0) {
    return [{ timestamp: new Date(Date.UTC(startYear, 0, 1)).getTime(), label: String(startYear) }];
  }
  const step = Math.max(1, Math.ceil(years / (count - 1)));
  for (let year = startYear; year <= endYear; year += step) {
    ticks.push({
      timestamp: new Date(Date.UTC(year, 0, 1)).getTime(),
      label: String(year),
    });
  }
  return ticks;
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
  note = 'Cumulative address space by first-observed date on a linear scale sized to this chart; hover for date and total.',
} = {}) {
  const { points: dated, startDate: resolvedStart, endDate: resolvedEnd } =
    allocationDates(records, { startDate, endDate });
  if (dated.length === 0) return '';

  const width = 720;
  const height = 160;
  // Left margin scales with the longest y-tick label so nothing clips at the
  // viewBox edge: measure the max tick, add a 6px gap from the plot.
  const maxTickLabel = tickLabel(Math.max(...dated.map((entry) => entry.cumulative), 1));
  const left = 6 + Math.min(84, Math.ceil(maxTickLabel.length * 6.2));
  const right = width - 8;
  const top = 18;
  const bottom = 30;
  const baseline = top + (height - top - bottom);
  const maxAddresses = Math.max(...dated.map((entry) => entry.cumulative), 1);
  const plotHeight = baseline - top;
  const startTime = Date.parse(`${resolvedStart}T00:00:00Z`);
  const endTime = Date.parse(`${resolvedEnd}T00:00:00Z`);
  const pathPoints = buildPathPoints(dated, {
    startTime,
    endTime,
    left,
    right,
    top,
    plotHeight,
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

  // Y ticks: nice round values under the chart's own maximum. The topmost
  // tick is the max itself; keep interior ticks only when their rendered
  // labels stay 14px apart, so text never collides.
  const ticks = yTicks(maxAddresses);
  const gridRows = ticks.map((value) => {
    const y = top + normalizedY(value, { plotHeight, maxAddresses });
    return { value, y, label: tickLabel(value) };
  });
  const visible = [];
  for (let index = 0; index < gridRows.length; index += 1) {
    const current = gridRows[index];
    const next = gridRows[index + 1];
    const gap = next ? next.y - current.y : null;
    if (gap !== null && gap < 14) continue;
    visible.push(current);
    if (gap !== null && gap < 14) index += 1;
  }
  const yGrid = visible
    .map(({ value, y, label }) =>
      [
        `          <line class="allocation-grid" x1="${left}" y1="${y.toFixed(2)}" x2="${right}" y2="${y.toFixed(2)}" />`,
        `          <text class="allocation-tick" x="${left - 4}" y="${(y + 3).toFixed(2)}" text-anchor="end">${escapeSvg(label)}</text>`,
      ].join('\n'))
    .join('\n');

  // Bottom-row collision check: the pinned edge year labels and the interior
  // x-ticks share the same row (14px half-widths each).
  const yearHalfPx = 14;
  const startLabelRight = left + startYear.length * 7;
  const endLabelLeft = right - endYear.length * 7;
  const xTickLabels = xTicks(startTime, endTime, 6)
    .filter((tick) => {
      const position = left + ((tick.timestamp - startTime) / (endTime - startTime)) * (right - left);
      const tickLeft = position - yearHalfPx;
      const tickRight = position + yearHalfPx;
      const hitsStart = tickLeft < startLabelRight && tickRight > left;
      const hitsEnd = tickRight > endLabelLeft && tickLeft < right;
      return !(hitsStart || hitsEnd);
    })
    .map((tick) => {
      const x = left + ((tick.timestamp - startTime) / (endTime - startTime)) * (right - left);
      return `          <text class="allocation-tick allocation-tick--x" x="${x.toFixed(2)}" y="${height - 6}" text-anchor="middle">${escapeSvg(tick.label)}</text>`;
    })
    .join('\n');

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
${yGrid}
          <line class="allocation-axis" x1="${left}" y1="${baseline}" x2="${right}" y2="${baseline}" />
          <path class="allocation-area" d="${area}" />
          <path class="allocation-line" d="${line}" vector-effect="non-scaling-stroke" />
          <text class="allocation-year allocation-year--start" x="${left}" y="${height - 6}">${escapeSvg(startLabel)}</text>
          <text class="allocation-year allocation-year--end" x="${right}" y="${height - 6}" text-anchor="end">${escapeSvg(endLabel)}</text>
${xTickLabels}
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
