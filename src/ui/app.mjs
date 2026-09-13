/** Application wiring: routing, data loading, lookups, history, theme. */

import { lookup, normalizeInput } from '../engine/index.mjs';
import { loadRegistry } from '../engine/load.mjs';
import { wireCopyButtons } from './clipboard.mjs';
import { clear, el } from './dom.mjs';
import { colonize, formatRelativeTime } from './format.mjs';
import { addHistory, clearHistory, loadHistory } from './history.mjs';
import {
  renderBatch,
  renderDataError,
  renderInvalid,
  renderMatch,
  renderNone,
  renderPartial,
} from './result.mjs';
import { canonicalQuery, parseLookup, splitBatch } from './router.mjs';
import { initTheme } from './theme.mjs';

const MAX_BATCH = 100;

const ui = {
  result: document.getElementById('result'),
  status: document.getElementById('status'),
  form: document.getElementById('lookup-form'),
  input: document.getElementById('lookup-input'),
  examples: document.getElementById('examples'),
  history: document.getElementById('history'),
  historyList: document.getElementById('history-list'),
  historyClear: document.getElementById('history-clear'),
  batchForm: document.getElementById('batch-form'),
  batchInput: document.getElementById('batch-input'),
  batchStatus: document.getElementById('batch-status'),
  lastUpdated: document.getElementById('last-updated'),
  themeToggle: document.getElementById('theme-toggle'),
};

initTheme({ toggleButton: ui.themeToggle });
wireCopyButtons();

let dataPromise = null;

/** Load the registry once, on first use. */
function ensureData() {
  if (!dataPromise) {
    ui.status.textContent = 'Loading registry…';
    dataPromise = loadRegistry()
      .then(({ manifest, registry, lineage }) => {
        ui.status.textContent = '';
        if (ui.lastUpdated) ui.lastUpdated.textContent = manifest.refreshDate ?? '';
        return { registry, lineage };
      })
      .catch((error) => {
        dataPromise = null;
        ui.status.textContent = '';
        throw error;
      });
  }
  return dataPromise;
}

async function runSingle(raw, { push = true } = {}) {
  const normalized = normalizeInput(raw);
  if (!normalized.ok) {
    renderInvalid(ui.result, { error: normalized.error });
    return;
  }

  try {
    const { registry, lineage } = await ensureData();
    const result = lookup(registry, raw);
    const lineageEntry = result.kind === 'match' ? lineage?.forPrefix(result.match.prefix) : null;

    if (result.kind === 'match') {
      renderMatch(ui.result, result, { lineage: lineageEntry });
    } else if (result.kind === 'none') {
      renderNone(ui.result, result);
    } else if (result.kind === 'partial') {
      renderPartial(ui.result, result, {
        onSelect: (prefix) => {
          ui.input.value = prefix;
          runSingle(prefix);
        },
      });
    } else {
      renderInvalid(ui.result, { error: result.error });
      return;
    }

    if (result.kind === 'match' || result.kind === 'none') {
      addHistory({
        hex: result.input.hex,
        label: result.kind === 'match' ? result.match.orgName : 'No registered vendor',
      });
      renderHistory();
    }

    document.title =
      result.kind === 'match'
        ? `${result.match.orgName} — ${colonize(result.input.hex)} | MAC Address Lookup`
        : `${colonize(result.input.hex)} | MAC Address Lookup`;

    updateSingleUrl(result.input.hex, { push });
    ui.result.focus({ preventScroll: true });
  } catch (error) {
    console.error(error);
    renderDataError(ui.result, { onRetry: () => runSingle(raw) });
  }
}

async function runBatch(text, { push = true } = {}) {
  const tokens = splitBatch(text);
  if (tokens.length === 0) {
    renderInvalid(ui.result, { error: 'empty' });
    return;
  }
  const limited = tokens.slice(0, MAX_BATCH);

  try {
    const { registry } = await ensureData();
    const entries = limited.map((token) => ({ raw: token, result: lookup(registry, token) }));
    renderBatch(ui.result, entries);
    if (ui.batchStatus) {
      ui.batchStatus.textContent =
        tokens.length > MAX_BATCH
          ? `Limited to the first ${MAX_BATCH} of ${tokens.length} addresses.`
          : `${limited.length} ${limited.length === 1 ? 'address' : 'addresses'} looked up.`;
    }
    document.title = `${limited.length} MAC lookups | MAC Address Lookup`;

    const query = canonicalQuery(limited);
    if (query) updateUrl(`/?q=${encodeURIComponent(query)}`, { push });
    ui.result.focus({ preventScroll: true });
  } catch (error) {
    console.error(error);
    renderDataError(ui.result, { onRetry: () => runBatch(text) });
  }
}

function updateSingleUrl(hex, { push }) {
  updateUrl(`/${hex}`, { push });
}

function updateUrl(url, { push }) {
  if (location.pathname + location.search === url) return;
  const method = push ? 'pushState' : 'replaceState';
  history[method]({}, '', url);
}

function runRoute(route) {
  if (!route) return;
  if (route.mode === 'batch') {
    runBatch(route.tokens.join(','), { push: false });
  } else {
    ui.input.value = route.value;
    runSingle(route.value, { push: false });
  }
}

function renderHistory() {
  if (!ui.history || !ui.historyList) return;
  const entries = loadHistory();
  ui.history.hidden = entries.length === 0;
  clear(ui.historyList);
  for (const entry of entries) {
    ui.historyList.append(
      el('li', {}, [
        el(
          'button',
          {
            type: 'button',
            class: 'history-item',
            onClick: () => {
              ui.input.value = entry.hex;
              runSingle(entry.hex);
            },
          },
          [
            el('span', { class: 'history-hex', text: colonize(entry.hex) }),
            el('span', { class: 'history-label', text: entry.label }),
            el('span', { class: 'history-when', text: formatRelativeTime(entry.at) }),
          ],
        ),
      ]),
    );
  }
}

ui.form.addEventListener('submit', (event) => {
  event.preventDefault();
  const value = ui.input.value.trim();
  if (splitBatch(value).length > 1) runBatch(value);
  else runSingle(value);
});

ui.batchForm?.addEventListener('submit', (event) => {
  event.preventDefault();
  runBatch(ui.batchInput.value);
});

ui.examples?.addEventListener('click', (event) => {
  const button = event.target.closest('[data-value]');
  if (!button) return;
  const value = button.dataset.value;
  ui.input.value = value;
  runSingle(value);
});

ui.historyClear?.addEventListener('click', () => {
  clearHistory();
  renderHistory();
});

window.addEventListener('popstate', () => {
  const route = parseLookup(location);
  if (route) runRoute(route);
});

renderHistory();

// Pre-rendered prefix pages already contain the result; skip the initial
// lookup (and the data fetch) but record the visit in history.
if (ui.result.dataset.prerendered === 'true') {
  const hex = ui.result.dataset.hex;
  if (hex) {
    addHistory({ hex, label: ui.result.dataset.label || 'Vendor' });
    renderHistory();
  }
} else {
  runRoute(parseLookup(location));
}
