/**
 * Per-locale chunk loader. Each locale table lives in its own file
 * (./locales/<code>.mjs) so the browser fetches only the active locale.
 * Keys not present in a locale fall back to English (en.mjs), so tables
 * here are complete but the fallback still guards future keys.
 *
 * Chinese variants: zh-Hans covers written Mandarin, Wu, Min, Hakka, Xiang,
 * and Gan (they share a written form). zh-Hant covers written Cantonese.
 * Indo-Aryan: hi, bn, mr, ur, gu, pa. Dravidian: ta, te, kn, ml.
 * Arabic (ar) covers North Africa and the Middle East (RTL).
 * African: sw (Swahili), ha (Hausa). Indonesian: id.
 * European additions: pl, uk, nl. Middle East: fa (Persian, RTL).
 */

export const RTL_LOCALES = new Set(['ur', 'ar', 'fa']);

export const localeNames = {
  de: 'Deutsch', es: 'Español', fr: 'Français', pt: 'Português',
  'zh-Hans': '中文（简体）', 'zh-Hant': '中文（繁體）',
  hi: 'हिन्दी', bn: 'বাংলা', mr: 'मराठी', ur: 'اردو',
  gu: 'ગુજરાતી', pa: 'ਪੰਜਾਬੀ',
  ta: 'தமிழ்', te: 'తెలుగు', kn: 'ಕನ್ನಡ', ml: 'മലയാളം',
  ru: 'Русский', ja: '日本語', ko: '한국어',
  tr: 'Türkçe', vi: 'Tiếng Việt', it: 'Italiano',
  ar: 'العربية', sw: 'Kiswahili', id: 'Bahasa Indonesia',
  ha: 'Hausa', pl: 'Polski', fa: 'فارسی',
  uk: 'Українська', nl: 'Nederlands',
};

export const SUPPORTED = Object.keys(localeNames);

const TABLE_NAMES = {
  de: 'de', es: 'es', fr: 'fr', pt: 'pt',
  'zh-Hans': 'zhHans', 'zh-Hant': 'zhHant',
  hi: 'hi', bn: 'bn', mr: 'mr', ur: 'ur', gu: 'gu', pa: 'pa',
  ta: 'ta', te: 'te', kn: 'kn', ml: 'ml',
  ru: 'ru', ja: 'ja', ko: 'ko', tr: 'tr', vi: 'vi', it: 'it',
  ar: 'ar', sw: 'sw', id: 'id', ha: 'ha', pl: 'pl', fa: 'fa',
  uk: 'uk', nl: 'nl',
};

/** [locale code, exported table name] for each locale file. */
const loaders = {
  de: () => import('./locales/de.mjs'),
  es: () => import('./locales/es.mjs'),
  fr: () => import('./locales/fr.mjs'),
  pt: () => import('./locales/pt.mjs'),
  'zh-Hans': () => import('./locales/zh-Hans.mjs'),
  'zh-Hant': () => import('./locales/zh-Hant.mjs'),
  hi: () => import('./locales/hi.mjs'),
  bn: () => import('./locales/bn.mjs'),
  mr: () => import('./locales/mr.mjs'),
  ur: () => import('./locales/ur.mjs'),
  gu: () => import('./locales/gu.mjs'),
  pa: () => import('./locales/pa.mjs'),
  ta: () => import('./locales/ta.mjs'),
  te: () => import('./locales/te.mjs'),
  kn: () => import('./locales/kn.mjs'),
  ml: () => import('./locales/ml.mjs'),
  ru: () => import('./locales/ru.mjs'),
  ja: () => import('./locales/ja.mjs'),
  ko: () => import('./locales/ko.mjs'),
  tr: () => import('./locales/tr.mjs'),
  vi: () => import('./locales/vi.mjs'),
  it: () => import('./locales/it.mjs'),
  ar: () => import('./locales/ar.mjs'),
  sw: () => import('./locales/sw.mjs'),
  id: () => import('./locales/id.mjs'),
  ha: () => import('./locales/ha.mjs'),
  pl: () => import('./locales/pl.mjs'),
  fa: () => import('./locales/fa.mjs'),
  uk: () => import('./locales/uk.mjs'),
  nl: () => import('./locales/nl.mjs'),
};

/** Dynamically import one locale table; returns the table or null. */
export async function loadLocale(code) {
  const load = loaders[code];
  if (!load) return null;
  return (await load())[TABLE_NAMES[code]] ?? null;
}
