/** Recent lookup history in localStorage (no server, no tracking). */

const STORAGE_KEY = 'mal.history.v1';
const MAX_ENTRIES = 50;

export function loadHistory() {
  try {
    const raw = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? '[]');
    if (!Array.isArray(raw)) return [];
    return raw
      .filter((entry) => entry && typeof entry.hex === 'string')
      .slice(0, MAX_ENTRIES);
  } catch {
    return [];
  }
}

export function addHistory(entry) {
  const entries = loadHistory().filter((existing) => existing.hex !== entry.hex);
  entries.unshift({ ...entry, at: Date.now() });
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(entries.slice(0, MAX_ENTRIES)));
  } catch {
    // storage unavailable; history is simply not persisted
  }
}

export function clearHistory() {
  try {
    localStorage.removeItem(STORAGE_KEY);
  } catch {
    // ignore
  }
}
