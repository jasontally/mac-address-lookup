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
    const svg = figure.querySelector('svg');
    const tooltip = figure.querySelector('.allocation-tooltip');
    if (!svg || !tooltip) continue;

    const needles = [...svg.querySelectorAll('[aria-label][stroke-opacity]')];
    if (!needles.length) continue;

    const show = (event) => {
      const target = event.target.closest('[aria-label]');
      if (!target?.getAttribute('aria-label')) {
        tooltip.hidden = true;
        return;
      }
      tooltip.textContent = target.getAttribute('aria-label');
      tooltip.hidden = false;
      const rect = figure.getBoundingClientRect();
      const pointerX = event.clientX - rect.left;
      const pointerY = event.clientY - rect.top;
      tooltip.style.left = `${Math.min(Math.max(pointerX, 8), Math.max(8, rect.width - 8))}px`;
      tooltip.style.top = `${Math.max(pointerY - 10, 8)}px`;
    };
    const hide = () => {
      tooltip.hidden = true;
    };

    svg.addEventListener('pointermove', show);
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
