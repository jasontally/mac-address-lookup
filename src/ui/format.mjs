/** Presentation formatting helpers (pure, testable). */

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/** Format an ISO `YYYY-MM-DD` observation date for display. */
export function formatDate(iso) {
  if (!iso) return '';
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso);
  if (!match) return iso;
  const [, year, month, day] = match;
  const index = Number(month) - 1;
  if (index < 0 || index > 11) return iso;
  return `${MONTHS[index]} ${Number(day)}, ${year}`;
}

/** Compact relative time for history entries. */
export function formatRelativeTime(timestamp, now = Date.now()) {
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

export function formatCount(value) {
  return typeof value === 'number' && Number.isFinite(value) ? value.toLocaleString('en-US') : '';
}

/** Humanize very large address counts (16,777,216 → "16.8 million"). */
export function formatAddresses(value) {
  if (typeof value !== 'number' || !Number.isFinite(value)) return '';
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
