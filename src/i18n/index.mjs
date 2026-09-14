/**
 * Locale detection, string lookup, and DOM application.
 *
 * Locale resolution order:
 * 1. `localStorage['mal.locale']` (user override)
 * 2. `navigator.language` (and `navigator.languages` fallbacks)
 * 3. `'en'`
 */

import { en } from './en.mjs';
import { locales, localeNames, RTL_LOCALES } from './locales.mjs';

export const SUPPORTED_LOCALES = Object.keys(locales);
export const LOCALE_NAMES = { en: 'English', ...localeNames };

let active = 'en';
let table = en;

/** Resolve the best available locale for a BCP 47 tag. */
export function resolveLocale(tag) {
  if (!tag) return null;
  const base = tag.split('-')[0].toLowerCase();
  if (locales[base]) return base;
  if (tag.startsWith('zh')) {
    if (/hant|hk|tw|mo/i.test(tag)) return 'zh-Hant';
    return 'zh-Hans';
  }
  if (tag.startsWith('pt')) return 'pt';
  return null;
}

/** Initialize the locale from localStorage or the browser, apply to DOM. */
export function initI18n() {
  let stored = null;
  try {
    stored = localStorage.getItem('mal.locale');
  } catch {
    // storage unavailable
  }
  active = stored && locales[stored] ? stored : resolveLocale(navigator.language) ?? 'en';
  for (const candidate of navigator.languages ?? []) {
    if (stored || active !== 'en') break;
    const resolved = resolveLocale(candidate);
    if (resolved) active = resolved;
  }
  table = locales[active] ?? en;
  applyDom();
  document.documentElement.lang = active;
  document.documentElement.dir = RTL_LOCALES.has(active) ? 'rtl' : 'ltr';
  return active;
}

export function getLocale() {
  return active;
}

/** Switch locale, persist, and re-apply DOM translations. */
export function setLocale(locale) {
  if (!locales[locale]) return;
  active = locale;
  table = locales[locale] ?? en;
  try {
    localStorage.setItem('mal.locale', locale);
  } catch {
    // storage unavailable
  }
  applyDom();
  document.documentElement.lang = locale;
  document.documentElement.dir = RTL_LOCALES.has(locale) ? 'rtl' : 'ltr';
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
    const text = table[key] ?? en[key];
    if (text !== undefined) element.textContent = text;
  }
  for (const element of root.querySelectorAll?.('[data-i18n-placeholder]')) {
    const key = element.getAttribute('data-i18n-placeholder');
    const text = table[key] ?? en[key];
    if (text !== undefined) element.setAttribute('placeholder', text);
  }
  for (const element of root.querySelectorAll?.('[data-i18n-title]')) {
    const key = element.getAttribute('data-i18n-title');
    const text = table[key] ?? en[key];
    if (text !== undefined) {
      element.setAttribute('title', text);
      element.setAttribute('aria-label', text);
    }
  }
}

export function isRtl() {
  return RTL_LOCALES.has(active);
}

export { RTL_LOCALES } from './locales.mjs';
