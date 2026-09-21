/**
 * Locale detection, string lookup, and DOM application.
 *
 * Locale resolution order:
 * 1. `localStorage['mal.locale']` (user override)
 * 2. `navigator.language` (and `navigator.languages` fallbacks)
 * 3. `'en'`
 *
 * Locale tables are code-split: only the active locale's chunk is fetched.
 */

import { en } from './en.mjs';
import { localeNames, RTL_LOCALES, SUPPORTED, loadLocale } from './locales.mjs';
import { formatDate, formatAddresses, formatCount } from '../ui/format.mjs';

/** Locale-aware values for pre-rendered interpolation params. */
function displayedParams(params, locale) {
  const formats = {
    blocks: (value) => formatCount(value, locale),
    count: (value) => formatCount(value, locale),
    orgs: (value) => formatCount(value, locale),
    shown: (value) => formatCount(value, locale),
    total: (value) => formatCount(value, locale),
    addresses: (value) => formatAddresses(value, locale),
    first: (value) => formatDate(value, locale),
    date: (value) => formatDate(value, locale),
  };
  return Object.fromEntries(
    Object.entries(params).map(([name, value]) => {
      const format = formats[name];
      if (!format) return [name, value];
      if (typeof value === 'number') return [name, format(value)];
      if (/^\d{4}-\d{2}-\d{2}$/.test(value)) return [name, format(value)];
      return [name, value];
    }),
  );
}

export const SUPPORTED_LOCALES = ['en', ...SUPPORTED];
export const LOCALE_NAMES = { en: 'English', ...localeNames };

let active = 'en';
let table = en;

/** Resolve the best available locale for a BCP 47 tag. */
export function resolveLocale(tag) {
  if (!tag) return null;
  const base = tag.split('-')[0].toLowerCase();
  if (localeNames[base]) return base;
  if (tag.startsWith('zh')) {
    if (/hant|hk|tw|mo/i.test(tag)) return 'zh-Hant';
    return 'zh-Hans';
  }
  if (tag.startsWith('pt')) return 'pt';
  return null;
}

function applyChrome() {
  applyDom();
  document.documentElement.lang = active;
  document.documentElement.dir = RTL_LOCALES.has(active) ? 'rtl' : 'ltr';
}

/** Initialize the locale from localStorage or the browser, apply to DOM. */
export async function initI18n() {
  let stored = null;
  try {
    stored = localStorage.getItem('mal.locale');
  } catch {
    // storage unavailable
  }
  // Pre-rendered /lang/{locale}/ pages declare their locale via
  // window.__malLocale (applied over the browser's language). A stored
  // manual choice still outranks the page URL - verified in
  // e2e: a returning visitor who picked a language sees their pick on
  // every /lang/ page, including pages in other languages.
  const forced = typeof window !== 'undefined' ? window.__malLocale : null;
  const pick = resolveLocale(navigator.language) ?? 'en';
  active =
    stored && SUPPORTED_LOCALES.includes(stored)
      ? stored
      : forced && SUPPORTED_LOCALES.includes(forced)
        ? forced
        : pick;
  for (const candidate of navigator.languages ?? []) {
    if (stored || active !== 'en') break;
    const resolved = resolveLocale(candidate);
    if (resolved) active = resolved;
  }
  if (active !== 'en') table = (await loadLocale(active)) ?? en;
  applyChrome();
  return active;
}

export function getLocale() {
  return active;
}

/** Switch locale, persist first (reload may follow), then load and apply. */
export async function setLocale(locale) {
  if (!SUPPORTED_LOCALES.includes(locale)) return;
  try {
    localStorage.setItem('mal.locale', locale);
  } catch {
    // storage unavailable
  }
  active = locale;
  table = locale === 'en' ? en : ((await loadLocale(locale)) ?? en);
  applyChrome();
}

/** Translate a key, interpolating `{param}` placeholders. Falls back to English. */
export function t(key, params = {}) {
  let text = table[key] ?? en[key] ?? key;
  for (const [name, value] of Object.entries(params)) {
    text = text.replaceAll(`{${name}}`, String(value));
  }
  return text;
}

/** Choose a singular or plural key based on count. */
export function tCount(key, count, params = {}) {
  return t(count === 1 ? key : `${key}Plural`, { count, ...params });
}

/** Walk `[data-i18n]` elements and set their text content. */
export function applyDom(root = document) {
  for (const element of root.querySelectorAll?.('[data-i18n]') ?? []) {
    const key = element.getAttribute('data-i18n');
    const params = element.getAttribute('data-i18n-params');
    if (params) {
      try {
        element.textContent = t(key, displayedParams(JSON.parse(params), active));
        continue;
      } catch {
        // fall through to the plain translation
      }
    }
    const text = table[key] ?? en[key];
    if (text !== undefined) element.textContent = text;
  }
  for (const element of root.querySelectorAll?.('[data-i18n-placeholder]')) {
    const key = element.getAttribute('data-i18n-placeholder');
    const text = table[key] ?? en[key];
    if (text !== undefined) element.setAttribute('placeholder', text);
  }
  for (const element of root.querySelectorAll?.('[data-i18n-data-label]')) {
    const key = element.getAttribute('data-i18n-data-label');
    const text = table[key] ?? en[key];
    if (text !== undefined) element.setAttribute('data-label', text);
  }
  for (const element of root.querySelectorAll?.('[data-i18n-title]')) {
    const key = element.getAttribute('data-i18n-title');
    const text = table[key] ?? en[key];
    if (text !== undefined) {
      element.setAttribute('title', text);
      element.setAttribute('aria-label', text);
    }
  }
  for (const element of root.querySelectorAll?.('[data-i18n-aria]')) {
    const key = element.getAttribute('data-i18n-aria');
    const text = table[key] ?? en[key];
    if (text !== undefined) element.setAttribute('aria-label', text);
  }
}

export function isRtl() {
  return RTL_LOCALES.has(active);
}

export { RTL_LOCALES } from './locales.mjs';
