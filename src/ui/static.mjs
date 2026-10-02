/**
 * Chrome-only entry for static pages (help, recent, vendor/country/former
 * hubs, built with data-static-page="true"): locale + theme + copy buttons
 * and the lookup-form deep-link. No engine, no Parquet, no hyparquet - a
 * fraction of the full app bundle for pages that never look up anything.
 */

import { LOCALE_NAMES, SUPPORTED_LOCALES, applyDom, getLocale, initI18n, setLocale } from '../i18n/index.mjs';
import { initTheme } from './theme.mjs';
import { wireCopyButtons } from './clipboard.mjs';
import { formatCount, formatDate } from './format.mjs';

const themeToggle = document.getElementById('theme-toggle');
const localePicker = document.getElementById('locale-picker');
const lookupForm = document.getElementById('lookup-form');
const lookupInput = document.getElementById('lookup-input');

function wireAllocationTimelines() {
  for (const figure of document.querySelectorAll('.allocation-timeline')) {
    const svg = figure.querySelector('.allocation-chart');
    const tooltip = figure.querySelector('.allocation-tooltip');
    const crosshair = figure.querySelector('.allocation-crosshair');
    if (!svg || !tooltip) continue;

    const points = JSON.parse(svg.dataset.points ?? '[]');
    const maxAddresses = Number(svg.dataset.maxAddresses ?? 0);
    const startDate = svg.dataset.startDate;
    const endDate = svg.dataset.endDate;
    const left = Number(svg.dataset.left ?? 0);
    const right = Number(svg.dataset.right ?? 0);
    const width = svg.viewBox?.baseVal?.width ?? 0;
    // `right` is an absolute right-edge x, not a margin: the plot spans left..right.
    const plotWidth = right - left;
    if (!points.length || !maxAddresses || !plotWidth) continue;

    const startTime = Date.parse(`${startDate}T00:00:00Z`);
    const endTime = Date.parse(`${endDate}T00:00:00Z`);
    if (!Number.isFinite(startTime) || !Number.isFinite(endTime)) continue;

    const svgX = (event) => {
      const rect = svg.getBoundingClientRect();
      return ((event.clientX - rect.left) / rect.width) * width;
    };
    const valueAt = (x) => {
      // Step-after interpolation over raw [x, cumulativeValue] pairs: the
      // cumulative total holds steady until the next allocation's x position.
      let low = 0;
      let high = points.length - 1;
      if (x <= points[0][0]) return 0;
      while (high - low > 1) {
        const mid = (low + high) >> 1;
        if (points[mid][0] <= x) low = mid;
        else high = mid;
      }
      return points[low][1];
    };

    const show = (event) => {
      const x = svgX(event);
      const ratio = Math.min(1, Math.max(0, (x - left) / plotWidth));
      const timestamp = startTime + ratio * (endTime - startTime);
      const date = new Date(timestamp).toISOString().slice(0, 10);
      const value = valueAt(x);
      const formattedValue =
        value > 0 ? `${formatCount(value, getLocale())} addresses` : 'No allocations';
      if (crosshair) {
        const lineX = left + ratio * plotWidth;
        crosshair.setAttribute('x1', String(lineX));
        crosshair.setAttribute('x2', String(lineX));
        crosshair.setAttribute('visibility', 'visible');
      }

      tooltip.textContent = `${formatDate(date, getLocale())} · ${formattedValue} total`;
      tooltip.hidden = false;
      const rect = figure.getBoundingClientRect();
      const pointerX = event.clientX - rect.left;
      const pointerY = event.clientY - rect.top;
      tooltip.style.left = `${Math.min(Math.max(pointerX, 8), Math.max(8, rect.width - 8))}px`;
      tooltip.style.top = `${Math.max(pointerY - 8, 8)}px`;
    };
    const hide = () => {
      tooltip.hidden = true;
      crosshair?.setAttribute('visibility', 'hidden');
    };

    svg.addEventListener('pointermove', show);
    svg.addEventListener('pointerdown', show);
    svg.addEventListener('pointerleave', hide);
  }
}

await initI18n();
initTheme({ toggleButton: themeToggle });
wireCopyButtons();
wireAllocationTimelines();

if (localePicker) {
  for (const locale of SUPPORTED_LOCALES) {
    const option = document.createElement('option');
    option.value = locale;
    option.textContent = LOCALE_NAMES[locale] ?? locale;
    localePicker.append(option);
  }
  localePicker.value = getLocale();
  localePicker.addEventListener('change', () => {
    setLocale(localePicker.value);
    location.reload();
  });
}

// Static-page lookup form: navigate to the deep-link path; the SPA fallback
// resolves it on the fresh page load (same wiring as app.mjs).
if (lookupForm) {
  lookupForm.addEventListener('submit', (event) => {
    event.preventDefault();
    const value = (lookupInput?.value ?? '').trim();
    if (value !== '') location.assign(`/${encodeURIComponent(value)}`);
  });
}
