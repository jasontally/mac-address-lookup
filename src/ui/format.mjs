/** Presentation formatting helpers (pure, testable). */

/**
 * Locale-aware formatting via Intl. `locale` defaults to `'en'` so build-time
 * rendering and tests stay in English; runtime callers pass `getLocale()`.
 */

/** Format an ISO `YYYY-MM-DD` observation date for display. */
export function formatDate(iso, locale = 'en') {
  if (!iso) return '';
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso);
  if (!match) return iso;
  try {
    return new Intl.DateTimeFormat(locale, {
      year: 'numeric',
      month: 'short',
      day: 'numeric',
      timeZone: 'UTC',
    }).format(new Date(`${iso}T00:00:00Z`));
  } catch {
    return iso;
  }
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
    return new Date(timestamp).toLocaleDateString('en-US', {
      month: 'short',
      day: 'numeric',
      year: 'numeric',
    });
  }
  const rtf = new Intl.RelativeTimeFormat(locale, { numeric: 'auto' });
  const deltaMinutes = Math.round((timestamp - now) / 60_000);
  if (Math.abs(deltaMinutes) < 60) return rtf.format(deltaMinutes, 'minute');
  const deltaHours = Math.round(deltaMinutes / 60);
  if (Math.abs(deltaHours) < 24) return rtf.format(deltaHours, 'hour');
  const deltaDays = Math.round(deltaHours / 24);
  if (Math.abs(deltaDays) < 30) return rtf.format(deltaDays, 'day');
  return new Intl.DateTimeFormat(locale, {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
    timeZone: 'UTC',
  }).format(new Date(timestamp));
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
