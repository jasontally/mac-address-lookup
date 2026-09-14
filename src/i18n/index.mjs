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
  const pick = resolveLocale(navigator.language) ?? 'en';
  active = stored && SUPPORTED_LOCALES.includes(stored) ? stored : pick;
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

/** Switch locale, persist, and re-apply DOM translations. */
export async function setLocale(locale) {
  if (!SUPPORTED_LOCALES.includes(locale)) return;
  active = locale;
  table = locale === 'en' ? en : ((await loadLocale(locale)) ?? en);
  try {
    localStorage.setItem('mal.locale', locale);
  } catch {
    // storage unavailable
  }
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
