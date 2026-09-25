/**
 * Static SVG allocation timeline for hub pages, rendered at build time with
 * Observable Plot. Ships zero Plot code to the browser: `Plot.plot()` returns
 * an SVG element whose `outerHTML` is inlined statically; hover uses a small
 * delegated listener reading `aria-label` on each `<line>` element.
 *
 * Each allocation is one thin vertical needle where height encodes
 * log(addressCount) and stroke-opacity encodes the block type, revealing
 * burst periods, clustering, and the block-type mix over time.
 */

import * as Plot from '@observablehq/plot';
import { parseHTML } from 'linkedom';

// A single reusable Document: Plot only needs DOM creators, not a heavy window.
const { document } = parseHTML('<!doctype html><html><head></head><body></body></html>');

function escapeHtml(value) {
  return String(value ?? '').replace(
    /[&<>"']/g,
    (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char],
  );
}

/**
 * Spread same-day allocations slightly so needles don't perfectly overlap.
 * The k-th allocation on one date moves ±n/2 * 1 hour. Deterministic.
 */
function spreadSameDayDupes(list) {
  const byDateMs = new Map();
  for (const item of list) {
    const key = item.date.getTime();
    if (!byDateMs.has(key)) byDateMs.set(key, []);
    byDateMs.get(key).push(item);
  }
  for (const group of byDateMs.values()) {
    for (const [index, item] of group.entries()) {
      if (group.length > 1) {
        const offsetHours = (index - (group.length - 1) / 2);
        item.date = new Date(item.date.getTime() + offsetHours * 36e5);
      }
    }
  }
  return list;
}

/**
 * Render one Observable Plot timeline: vertical needle per allocation,
 * x = first-observed date (UTC), y = addressCount on a log scale,
 * stroke-opacity encodes block type, per-event `aria-label`.
 * Returns the complete `<figure>…</figure>` HTML string for inlining.
 */
export function renderAllocationTimeline(records, {
  label = 'MAC address allocations',
  startDate = null,
  endDate = null,
  width = 720,
  height = 200,
  note = 'Vertical needles show allocation size on a logarithmic scale; darker means larger block type. Hover an allocation for its date and value.',
} = {}) {
  // The global date range is passed in from `build.mjs` so every chart spans the same era.
  const startDateObj = startDate ? new Date(`${startDate}T00:00:00Z`) : null;
  const endDateObj = endDate ? new Date(`${endDate}T00:00:00Z`) : new Date();
  if(!Number.isFinite(startDateObj?.getTime()) || !Number.isFinite(endDateObj?.getTime()) || startDateObj >= endDateObj) return '';

  const data = [...(records ?? [])]
    .filter((d) => d.firstSeen)
    .map((d) => ({ ...d, date: new Date(`${d.firstSeen}T00:00:00Z`) }))
    .filter((d) => Number.isFinite(d.date.getTime()))
    .sort((a, b) => a.date - b.date);
  if (data.length === 0) return '';

  spreadSameDayDupes(data);

  // Use the global date range, not the page's own range, so axes are stable.
  const xDomain = [startDateObj, endDateObj];
  const blockOpacity = (d) =>
    d.blockType === 'MA-L' ? 0.9 : d.blockType === 'MA-M' ? 0.6 : 0.35;
  const ariaLabel = (d) =>
    `${d.date.toISOString().slice(0, 10)} · ${d.blockType} · ${d.addressCount.toLocaleString('en-US')}`;

  const figureAria = `${label} allocation timeline: needle height shows allocation size on a log scale, opacity shows block type.`;

  const svg = Plot.plot({
    document,
    width,
    height,
    marginRight: 12,
    marginLeft: 44,
    style: {
      color: 'currentColor',
      background: 'transparent',
      fontFamily: 'var(--font-mono, monospace)',
      fontSize: 10,
    },
    x: {
      type: 'utc',
      domain: xDomain,
      grid: true,
      tickSize: 2,
      label: null,
      tickFormat: (d) => String(d.getUTCFullYear()),
    },
    year: null,
    y: {
      type: 'log',
      domain: [2048, 16_777_216],
      ticks: [4096, 1_048_576, 16_777_216],
      tickFormat: (d) =>
        Object.entries({ 4096: '4K', 1048576: '1M', 16777216: '16.7M' }).find(
          ([k]) => Number(k) === d,
        )?.[1] ?? String(d),
      label: null,
      grid: true,
      tickSize: 2,
      stroke: 'currentColor',
      strokeOpacity: 0.15,
    },
    marks: [
      Plot.ruleX(data, {
        x: 'date',
        y1: 2048,                   // baseline, a hair above the log-domain floor
        y2: 'addressCount',
        strokeWidth: 1,
        strokeLinecap: 'butt',
        strokeOpacity: blockOpacity,
        ariaLabel,
      }),
    ],
  });

  if (!svg || typeof svg.outerHTML !== 'string') return '';
  return `      <figure class="allocation-timeline" role="img" aria-label="${escapeHtml(figureAria)}">
${svg.outerHTML}
        <div class="allocation-tooltip" hidden></div>
        <figcaption>${escapeHtml(note)}</figcaption>
      </figure>`;
}

/** Earliest and latest first-observed dates across the whole registry. */
export function datasetDateRange(records) {
  let startDate = null;
  let endDate = null;
  for (const record of records ?? []) {
    const raw = record?.firstSeen;
    if (typeof raw !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(raw)) continue;
    if (startDate === null || raw < startDate) startDate = raw;
    if (endDate === null || raw > endDate) endDate = raw;
  }
  return startDate === null ? { startDate: null, endDate: null } : { startDate, endDate };
}
