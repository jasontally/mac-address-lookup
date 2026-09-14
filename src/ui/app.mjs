/** Application wiring: routing, data loading, lookups, search, history, theme. */

import {
  classifyInput,
  extractMacs,
  lookup,
  normalizeInput,
  searchRegistry,
  summarizeLookups,
} from '../engine/index.mjs';
import { loadLineage, loadManifest, loadRegistryFor } from '../engine/load.mjs';
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
  renderPending,
  renderSearchResults,
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

const data = {
  manifestPromise: null,
  lineagePromise: null,
  shardRows: new Map(),
  fullRegistry: null,
};
let dataReady = false;

/** Load the manifest once, on first use. */
function ensureManifest() {
  if (!data.manifestPromise) {
    ui.status.textContent = 'Loading registry…';
    data.manifestPromise = loadManifest()
      .then((manifest) => {
        ui.status.textContent = '';
        if (ui.lastUpdated) ui.lastUpdated.textContent = manifest.refreshDate ?? '';
        return manifest;
      })
      .catch((error) => {
        data.manifestPromise = null;
        ui.status.textContent = '';
        throw error;
      });
  }
  return data.manifestPromise;
}

/** Lineage is optional: failures degrade to "no timeline" rather than an error. */
function ensureLineage() {
  if (!data.lineagePromise) {
    data.lineagePromise = ensureManifest()
      .then((manifest) => loadLineage(manifest))
      .catch(() => null);
  }
  return data.lineagePromise;
}

/** Load a registry sized to the inputs (shards when possible). */
async function registryFor(inputs) {
  const manifest = await ensureManifest();
  const loaded = await loadRegistryFor(manifest, inputs, { cache: data });
  dataReady = true;
  return loaded;
}

/** Route any user input: address/prefix, pasted text, or free-text search. */
async function handleInput(text, options = {}) {
  const decision = classifyInput(text);
  if (decision.mode === 'single') {
    await runSingle(decision.value, options);
  } else if (decision.mode === 'batch') {
    await runBatch(text, options);
  } else if (decision.mode === 'invalid') {
    clearPendingLookup();
    renderInvalid(ui.result, { error: decision.error });
  } else {
    await runSearch(decision.value, options);
  }
}

async function runSingle(raw, { push = true } = {}) {
  const normalized = normalizeInput(raw);
  if (!normalized.ok) {
    renderInvalid(ui.result, { error: normalized.error });
    return;
  }

  if (!dataReady) renderPending(ui.result, normalized.hex);

  try {
    const loaded = await registryFor([normalized.hex]);
    const result = lookup(loaded.registry, raw);
    // Only prefixes that changed hands need the lineage file at all.
    const needsLineage = result.kind === 'match' && (result.match.lineageCount ?? 0) > 1;
    const lineage = needsLineage ? await ensureLineage() : null;
    const lineageEntry =
      result.kind === 'match' ? (lineage?.forPrefix(result.match.prefix) ?? null) : null;

    if (result.kind === 'match') {
      const portfolio = loaded.registry.portfolio(result.match.orgName);
      renderMatch(ui.result, result, {
        lineage: lineageEntry,
        portfolio,
        onViewAll: () => {
          ui.input.value = result.match.orgName;
          runSearch(result.match.orgName);
        },
      });
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
    setRobotsMeta(false);
    setCanonical(`${location.origin}${location.pathname}`);
    clearPendingLookup();
    requestAnimationFrame(() => ui.result.focus({ preventScroll: true }));
  } catch (error) {
    console.error(error);
    clearPendingLookup();
    renderDataError(ui.result, { onRetry: () => runSingle(raw), message: error?.userMessage ?? null });
  }
}

async function runBatch(text, { push = true } = {}) {
  const listTokens = splitBatch(text);
  const allValid =
    listTokens.length > 0 && listTokens.every((token) => normalizeInput(token).ok);

  let tokens = listTokens;
  let fromText = false;
  if (!allValid) {
    const discovered = extractMacs(text);
    if (discovered.length > 0) {
      tokens = discovered;
      fromText = true;
    }
  }

  if (tokens.length === 0) {
    renderInvalid(ui.result, { error: 'empty' });
    return;
  }
  const limited = tokens.slice(0, MAX_BATCH);

  try {
    const loaded = await registryFor(limited);
    const entries = limited.map((token) => ({ raw: token, result: lookup(loaded.registry, token) }));
    renderBatch(ui.result, entries, {
      summary: summarizeLookups(entries),
      extracted: fromText,
    });

    if (ui.batchStatus) {
      ui.batchStatus.textContent =
        tokens.length > MAX_BATCH
          ? `Limited to the first ${MAX_BATCH} of ${tokens.length} addresses.`
          : fromText
            ? `${limited.length} ${limited.length === 1 ? 'address' : 'addresses'} extracted from pasted text.`
            : `${limited.length} ${limited.length === 1 ? 'address' : 'addresses'} looked up.`;
    }

    const canonical = canonicalQuery(limited);
    if (canonical) updateUrl(`/${canonical}`, { push });
    setRobotsMeta(true);
    setCanonical(`${location.origin}/`);
    document.title = `${limited.length} MAC lookups | MAC Address Lookup`;
    clearPendingLookup();
    requestAnimationFrame(() => ui.result.focus({ preventScroll: true }));
  } catch (error) {
    console.error(error);
    clearPendingLookup();
    renderDataError(ui.result, { onRetry: () => runBatch(text), message: error?.userMessage ?? null });
  }
}

async function runSearch(query, { push = true } = {}) {
  try {
    const [loaded, lineage] = await Promise.all([registryFor(null), ensureLineage()]);
    const outcome = searchRegistry(loaded.registry, lineage, query, { limit: 200 });
    renderSearchResults(ui.result, {
      query,
      matches: outcome.matches,
      total: outcome.total,
      truncated: outcome.truncated,
      portfolio: outcome.portfolio,
      onSelect: (prefix) => {
        ui.input.value = prefix;
        runSingle(prefix);
      },
    });

    if (push || location.search) updateUrl(`/${encodeURIComponent(query)}`, { push });
    setRobotsMeta(true);
    setCanonical(`${location.origin}/`);
    document.title = `${query} — MAC Address Lookup`;
    clearPendingLookup();
    requestAnimationFrame(() => ui.result.focus({ preventScroll: true }));
  } catch (error) {
    console.error(error);
    clearPendingLookup();
    renderDataError(ui.result, { onRetry: () => runSearch(query), message: error?.userMessage ?? null });
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

/** Query-driven results should not be indexed standalone. */
function setRobotsMeta(noindex) {
  let meta = document.querySelector('meta[name="robots"]');
  if (noindex) {
    if (!meta) {
      meta = el('meta', { name: 'robots' });
      document.head.append(meta);
    }
    meta.setAttribute('content', 'noindex, follow');
  } else if (meta) {
    meta.remove();
  }
}

/** Keep the canonical link in step with dynamically rendered lookups. */
function setCanonical(href) {
  let link = document.querySelector('link[rel="canonical"]');
  if (!href) {
    link?.remove();
    return;
  }
  if (!link) {
    link = el('link', { rel: 'canonical' });
    document.head.append(link);
  }
  link.setAttribute('href', href);
}

/** Freeze the current result height, then reveal the pending state. */
function clearPendingLookup() {
  const node = ui.result;
  const height = node.getBoundingClientRect().height;
  if (height > 0) node.style.minHeight = `${Math.ceil(height)}px`;
  document.documentElement.removeAttribute('data-pending-lookup');
}

function runRoute(route) {
  if (!route) return;
  ui.input.value = route.value;
  handleInput(route.value, { push: false });
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
  handleInput(ui.input.value);
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
  const route = parseLookup(location);
  if (route) {
    runRoute(route);
  } else if (location.pathname !== '/' || location.search !== '') {
    // Unknown path or non-lookup query: this is a soft 404 served by the SPA shell.
    setRobotsMeta(true);
    setCanonical(`${location.origin}/`);
  }
}
