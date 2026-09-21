/** Presentation formatting helpers (pure, testable). */

/**
 * Locale-aware formatting via Intl. `locale` defaults to `'en'` so build-time
 * rendering and tests stay in English; runtime callers pass `getLocale()`.
 */

/**
 * English month abbreviations: the observation site is language-neutral
 * data, and a fixed 3-letter Latin month table renders identically in
 * every locale ("21 Feb 2016") - ICU short-month names vary by locale
 * ("sept.", "9月") and en-US reorders to "MMM D, YYYY". English keeps this
 * fixed form (build-time rendering depends on it); other locales format
 * the parts with Intl so month names and ordering are native
 * ("21. feb. 2016", "2016年2月21日").
 */
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/** English fallback form for a Date: `DD MMM YYYY` (UTC parts). */
function englishDate(date) {
  return `${date.getUTCDate()} ${MONTHS[date.getUTCMonth()]} ${date.getUTCFullYear()}`;
}

/** Locale-aware short-date form for a Date, falling back to English. */
function localeDate(date, locale) {
  if (!locale || locale === 'en' || typeof Intl === 'undefined' || !Intl.DateTimeFormat) {
    return englishDate(date);
  }
  try {
    return new Intl.DateTimeFormat(locale, {
      day: 'numeric',
      month: 'short',
      year: 'numeric',
      timeZone: 'UTC',
    }).format(date);
  } catch {
    return englishDate(date); // unknown locale tag
  }
}

/** Format an ISO `YYYY-MM-DD` observation date for display: `DD MMM YYYY`. */
export function formatDate(iso, _locale = 'en') {
  if (!iso) return '';
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso);
  if (!match) return iso;
  const [, year, month, day] = match;
  const date = new Date(Date.UTC(Number(year), Number(month) - 1, Number(day)));
  if (Number.isNaN(date.getTime())) return iso;
  return localeDate(date, _locale);
}

/** Compact relative time for history entries. */
export function formatRelativeTime(timestamp, now = Date.now(), locale = 'en') {
  if (locale === 'en') {
    const minutes = Math.floor((now - timestamp) / 60_000);
    if (minutes < 1) return 'just now';
    if (minutes < 60) return `${minutes}m ago`;
    const hours = Math.floor(minutes / 60);
    if (hours < 24) return `${hours}h ago`;
    const days = Math.floor(hours / 24);
    if (days < 30) return `${days}d ago`;
    return englishDate(new Date(timestamp));
  }
  const rtf = new Intl.RelativeTimeFormat(locale, { numeric: 'auto' });
  const deltaMinutes = Math.round((timestamp - now) / 60_000);
  if (Math.abs(deltaMinutes) < 60) return rtf.format(deltaMinutes, 'minute');
  const deltaHours = Math.round(deltaMinutes / 60);
  if (Math.abs(deltaHours) < 24) return rtf.format(deltaHours, 'hour');
  const deltaDays = Math.round(deltaHours / 24);
  if (Math.abs(deltaDays) < 30) return rtf.format(deltaDays, 'day');
  return localeDate(new Date(timestamp), locale);
}

export function formatCount(value, locale = 'en') {
  return typeof value === 'number' && Number.isFinite(value)
    ? value.toLocaleString(locale)
    : '';
}

/** Humanize very large address counts (16,777,216 → "16.8 million"). */
export function formatAddresses(value, locale = 'en') {
  if (typeof value !== 'number' || !Number.isFinite(value)) return '';
  if (locale !== 'en') {
    try {
      return new Intl.NumberFormat(locale, {
        notation: 'compact',
        compactDisplay: 'long',
        maximumFractionDigits: 1,
      }).format(value);
    } catch {
      // fall through to the English form
    }
  }
  const scaled = (divisor, suffix) => {
    const result = value / divisor;
    const text = result >= 100 ? String(Math.round(result)) : result.toFixed(1).replace(/\.0$/, '');
    return `${text} ${suffix}`;
  };
  if (value >= 1e12) return scaled(1e12, 'trillion');
  if (value >= 1e9) return scaled(1e9, 'billion');
  if (value >= 1e6) return scaled(1e6, 'million');
  if (value >= 1e3) return scaled(1e3, 'thousand');
  return formatCount(value);
}

/** Uppercase hex to colon-separated octets (`001A2B` → `00:1A:2B`). */
export function colonize(hex) {
  return String(hex).toUpperCase().match(/.{1,2}/g)?.join(':') ?? '';
}

/** First and last address of a registered block, colon-separated. */
export function addressRange(prefix, prefixLen) {
  const width = 12;
  const normalized = String(prefix).toUpperCase();
  const start = normalized.padEnd(width, '0');
  const end = normalized.padEnd(width, 'F');
  return { start: colonize(start), end: colonize(end) };
}
