/**
 * Chrome-only entry for static pages (help, recent, vendor/country/former
 * hubs, built with data-static-page="true"): locale + theme + copy buttons
 * and the lookup-form deep-link. No engine, no Parquet, no hyparquet — a
 * fraction of the full app bundle for pages that never look up anything.
 */

import { LOCALE_NAMES, SUPPORTED_LOCALES, applyDom, getLocale, initI18n, setLocale, t } from '../i18n/index.mjs';
import { initTheme } from './theme.mjs';
import { wireCopyButtons } from './clipboard.mjs';

const themeToggle = document.getElementById('theme-toggle');
const localePicker = document.getElementById('locale-picker');
const lookupForm = document.getElementById('lookup-form');
const lookupInput = document.getElementById('lookup-input');

await initI18n();
initTheme({ toggleButton: themeToggle });
wireCopyButtons();

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

// Hub tables: the inline virtualizer (build/hubs.mjs) reports revealed-row
// state as events; format the visible count with the active locale (the
// initial state ships pre-rendered with data-i18n-params, swapped above).
const rowsNote = document.getElementById('hub-rows-note');
if (rowsNote) {
  const count = rowsNote.querySelector('.hub-rows-count');
  rowsNote.addEventListener('hub-rows', (event) => {
    const { shown, total } = event.detail ?? {};
    if (!count || !Number.isFinite(shown) || !Number.isFinite(total)) return;
    count.textContent = shown >= total ? t('hub.rowsAll', { total }) : t('hub.rowsCount', { shown, total });
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
