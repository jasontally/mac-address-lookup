/** Theme: system default via `light-dark()`, explicit override persisted. */

const STORAGE_KEY = 'mal.theme';

export function effectiveMode() {
  const attr = document.documentElement.dataset.mode;
  if (attr === 'light' || attr === 'dark') return attr;
  return window.matchMedia?.('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
}

function updateToggle(button) {
  if (!button) return;
  const next = effectiveMode() === 'dark' ? 'light' : 'dark';
  button.setAttribute('aria-label', `Switch to ${next} theme`);
  button.setAttribute('title', `Switch to ${next} theme`);
}

export function initTheme({ toggleButton } = {}) {
  updateToggle(toggleButton);

  window.matchMedia?.('(prefers-color-scheme: dark)').addEventListener?.('change', () => {
    if (!document.documentElement.dataset.mode) updateToggle(toggleButton);
  });

  toggleButton?.addEventListener('click', () => {
    const next = effectiveMode() === 'dark' ? 'light' : 'dark';
    document.documentElement.dataset.mode = next;
    try {
      localStorage.setItem(STORAGE_KEY, next);
    } catch {
      // storage unavailable; the toggle still works for this session
    }
    updateToggle(toggleButton);
  });
}

/** Applied before first paint by a tiny inline script in index.html. */
export function storedMode() {
  try {
    const value = localStorage.getItem(STORAGE_KEY);
    return value === 'light' || value === 'dark' ? value : null;
  } catch {
    return null;
  }
}
