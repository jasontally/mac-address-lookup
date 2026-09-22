/** Application wiring: routing, data loading, lookups, search, history, theme. */

import {
  classifyInput,
  extractMacs,
  lookup,
  normalizeInput,
  randomMac,
  searchRegistry,
  summarizeLookups,
} from '../engine/index.mjs';
import { initI18n, t, tCount, applyDom, getLocale, setLocale, LOCALE_NAMES, SUPPORTED_LOCALES } from '../i18n/index.mjs';
import { loadLineage, loadManifest, loadRegistryFor, loadSearchIndex } from '../engine/load.mjs';
import { wireCopyButtons } from './clipboard.mjs';
import { clear, el } from './dom.mjs';
import { colonize, formatCount, formatRelativeTime } from './format.mjs';
import { addHistory, clearHistory, loadHistory } from './history.mjs';
import { downloadText, toCsv, toJson } from './export.mjs';
import { copyText } from './clipboard.mjs';
import {
  renderBatch,
  renderDataError,
  renderInvalid,
  renderMatch,
  renderNone,
  renderPartial,
  renderPending,
  renderSearchResults,
  applyPrerenderedI18n,
} from './result.mjs';
import { canonicalQuery, parseLookup, splitBatch } from './router.mjs';
import { initTheme } from './theme.mjs';

const MAX_BATCH = 250;

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

await initI18n();
initTheme({ toggleButton: ui.themeToggle });
wireCopyButtons();

// Pre-rendered cards keep English HTML for crawlers; swap the translatable
// pieces once the locale table is ready.
const prerendered = document.getElementById('result');
// Pre-rendered cards keep English HTML for crawlers; swap the translatable
// pieces once the locale table is ready.
if (prerendered?.dataset.prerendered) applyPrerenderedI18n();

// Populate the language picker (English included via SUPPORTED_LOCALES).
// Pages with pre-rendered language variants navigate to their sibling URL
// instead of swapping in place, so the served HTML matches the choice
// (hreflang sets must keep one language per URL).
const pickLocalizedUrl = (pathname, locale) => {
  if (/^\/lang\/[^/]+/.test(pathname)) return `/lang/${locale}/`;
  if (pathname === '/' || pathname === '') return `/lang/${locale}/`;
  return null;
};
const localePicker = document.getElementById('locale-picker');
if (localePicker) {
  for (const locale of SUPPORTED_LOCALES) {
    localePicker.append(el('option', { value: locale }, [LOCALE_NAMES[locale] ?? locale]));
  }
  localePicker.value = getLocale();
  localePicker.addEventListener('change', () => {
    setLocale(localePicker.value);
    const target = pickLocalizedUrl(location.pathname, localePicker.value);
    if (target) location.assign(target);
    else location.reload();
  });
}

const data = {
  manifestPromise: null,
  lineagePromise: null,
  shardRows: new Map(),
  fullRegistry: null,
};
let dataReady = false;

/** Show-more reveal for partial prefix listings (measured cap per chunk). */
const PARTIAL_STEP = 500;
const partialState = { hex: null, limit: PARTIAL_STEP };

/** Load the manifest once, on first use. */
function ensureManifest() {
  if (!data.manifestPromise) {
    ui.status.textContent = t('status.loadingRegistry');
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

  // Show-more reveal for partial listings (docs/thin-content-mitigation.md):
  // 500 rows per render follows the measured caps in e2e/measure-limits.mjs.
  if (partialState.hex !== normalized.hex) {
    partialState.hex = normalized.hex;
    partialState.limit = PARTIAL_STEP;
  }

  if (!dataReady) renderPending(ui.result, normalized.hex);

  try {
    const loaded = await registryFor([normalized.hex]);
    const result = lookup(loaded.registry, raw, { partialLimit: partialState.limit });
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
          if (result.match.vendorHub) {
            location.assign(`/vendor/${result.match.vendorHub}`);
            return;
          }
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
        onShowMore: () => {
          partialState.limit += PARTIAL_STEP;
          runSingle(raw, { push: false });
        },
        onShowAll: () => {
          partialState.limit = Number.MAX_SAFE_INTEGER;
          runSingle(raw, { push: false });
        },
      });
    } else {
      renderInvalid(ui.result, { error: result.error });
      return;
    }

    if (result.kind === 'match' || result.kind === 'none') {
      addHistory({
        hex: result.input.hex,
        label: result.kind === 'match' ? result.match.orgName : t('history.noVendor'),
      });
      renderHistory();
    }

    document.title =
      result.kind === 'match'
        ? t('title.match', { org: result.match.orgName, colon: colonize(result.input.hex) })
        : t('title.none', { colon: colonize(result.input.hex) });

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
      onExportCsv: () => downloadText('mac-lookup.csv', toCsv(entries)),
      onExportJson: async (event) => {
        const button = event?.currentTarget;
        const ok = await copyText(toJson(entries));
        if (button) {
          const original = button.textContent;
          button.textContent = ok ? t('format.copied') : t('format.copyFailed');
          setTimeout(() => { button.textContent = original; }, 1200);
        }
      },
    });

    if (ui.batchStatus) {
      ui.batchStatus.textContent =
        tokens.length > MAX_BATCH
          ? t('status.limited', { max: formatCount(MAX_BATCH), total: formatCount(tokens.length) })
          : limited.length === 1
            ? t(fromText ? 'status.addressExtracted' : 'status.addressLookedUp', { count: 1 })
            : t(fromText ? 'status.addressesExtracted' : 'status.addressesLookedUp', {
                count: formatCount(limited.length),
              });
    }

    const canonical = canonicalQuery(limited);
    if (canonical) updateUrl(`/${encodeURIComponent(canonical)}`, { push });
    setRobotsMeta(true);
    setCanonical(`${location.origin}/`);
    document.title = t('title.batch', { count: formatCount(limited.length, getLocale()) });
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
    const manifest = await ensureManifest();
    const [loaded, lineage] = await Promise.all([loadSearchIndex(manifest, { cache: data }), ensureLineage()]);
    const outcome = searchRegistry(loaded.registry, lineage, query, { limit: 500 });
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
    document.title = t('title.search', { query });
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
    el('span', { class: 'history-when', text: formatRelativeTime(entry.at, Date.now(), getLocale()) }),
          ],
        ),
      ]),
    );
  }
}

const staticPage = document.body.dataset.staticPage === 'true';

/** Real home pages: the English shell and the /lang/{locale}/ variants. */
function isLangHome(pathname) {
  return pathname === '/' || pathname === '' || /^\/lang\/[A-Za-z-]+\/?$/.test(pathname);
}

if (!staticPage) {
  ui.form.addEventListener('submit', (event) => {
    event.preventDefault();
    handleInput(ui.input.value);
  });

  ui.batchForm?.addEventListener('submit', (event) => {
    event.preventDefault();
    runBatch(ui.batchInput.value);
  });

  ui.examples?.addEventListener('click', (event) => {
    const button = event.target.closest('[data-value], [data-random]');
    if (!button) return;
    const value = button.dataset.random ? randomMac() : button.dataset.value;
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
    } else if (location.search !== '' || !isLangHome(location.pathname)) {
      // Unknown path or non-lookup query: this is a soft 404 served by the SPA
      // shell - but never for `/lang/{locale}/`, which is a real page.
      setRobotsMeta(true);
      setCanonical(`${location.origin}/`);
    }
  }
} else {
  // Static pages (help, recent, hub pages): submit navigates to the deep-link
  // path, which the SPA fallback resolves on the fresh page load.
  ui.form?.addEventListener('submit', (event) => {
    event.preventDefault();
    const value = ui.input.value.trim();
    if (value !== '') location.assign(`/${encodeURIComponent(value)}`);
  });
}
