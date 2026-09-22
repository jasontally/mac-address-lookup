/** Result renderers. All external data goes through textContent. */

import { formatAddress } from '../engine/formats.mjs';
import { isSubdivided } from '../engine/subdivided.mjs';
import { analyzeBits } from '../engine/input.mjs';
import { t, tCount, getLocale } from '../i18n/index.mjs';
import { copyButton } from './clipboard.mjs';
import { clear, el } from './dom.mjs';
import { addressRange, colonize, formatAddresses, formatCount, formatDate } from './format.mjs';

const FORMATS = [
  ['format.plain', 'plain'],
  ['format.colon', 'colon'],
  ['format.hyphen', 'hyphen'],
  ['format.cisco', 'cisco'],
  ['format.eui64', 'eui64'],
  ['format.ipv6', 'ipv6LinkLocal'],
];

const INVALID_KEYS = {
  empty: 'invalid.empty',
  invalid_chars: 'invalid.chars',
  too_long: 'invalid.tooLong',
};

export function invalidMessage(error) {
  return t(INVALID_KEYS[error] ?? INVALID_KEYS.default);
}

function badge(text, kind = 'neutral') {
  return el('span', { class: kind === 'neutral' ? 'badge' : `badge badge--${kind}` }, [text]);
}

function detailList(items) {
  const list = el('dl', { class: 'detail-grid' });
  for (const [key, value] of items) {
    if (value === null || value === undefined || value === '') continue;
    list.append(el('dt', { text: t(key) }));
    list.append(el('dd', {}, [value]));
  }
  return list;
}

function bitSummary(bits) {
  if (!bits) return null;
  const parts = [
    bits.multicast ? t('bits.multicast') : t('bits.unicast'),
    bits.locallyAdministered ? t('bits.locallyAdministered') : t('bits.universallyAdministered'),
  ];
  if (bits.broadcast) parts.push(t('bits.broadcast'));
  if (bits.allZeros) parts.push(t('bits.allZeros'));
  return el('p', { class: 'bits', text: parts.join(' · ') });
}

/**
 * Re-translate a pre-rendered result card after the locale table loads.
 * The static HTML keeps English for crawlers; here we swap the pieces that
 * data-i18n alone cannot express: interpolated badges, the lede sentence,
 * the match value, copy-button labels, and the randomization reasons.
 */
export function applyPrerenderedI18n(root = document) {
  if (!root) return;
  const locale = getLocale();

  const lede = root.querySelector('.lede[data-lede]');
  if (lede) {
    const params = JSON.parse(lede.getAttribute('data-lede'));
    const key = params.country ? 'prerender.ledeCountry' : 'prerender.lede';
    lede.textContent = t(key, { ...params, country: countryLabel(params.country) });
  }

  const bits = root.querySelector('.bits[data-bits]');
  if (bits) {
    const flags = JSON.parse(bits.getAttribute('data-bits'));
    const parts = [
      flags.multicast ? t('bits.multicast') : t('bits.unicast'),
      flags.locallyAdministered
        ? t('bits.locallyAdministered')
        : t('bits.universallyAdministered'),
    ];
    if (flags.broadcast) parts.push(t('bits.broadcast'));
    if (flags.allZeros) parts.push(t('bits.allZeros'));
    bits.textContent = parts.join(' · ');
  }

  const resultSection = root.querySelector('#result[data-blocktype]') ?? root;
  const matchValue = resultSection.querySelector('dt[data-i18n="detail.match"] + dd');
  const blockType = resultSection.getAttribute('data-blocktype');
  if (matchValue && blockType) matchValue.textContent = t('result.assignment', { type: blockType });

  const badges = root.querySelector('.badges');
  for (const badgeEl of (badges ?? root).querySelectorAll('.badge[data-i18n]')) {
    const key = badgeEl.getAttribute('data-i18n');
    const params = badgeEl.hasAttribute('data-i18n-params')
      ? JSON.parse(badgeEl.getAttribute('data-i18n-params'))
      : null;
    badgeEl.textContent = params ? t(key, params) : t(key);
  }

  for (const button of root.querySelectorAll('button[data-copy]')) {
    const kind = button.getAttribute('data-copy-kind');
    const labelKey = button.getAttribute('data-copy-label');
    const label = kind === 'mac' ? t('format.copyMac') : t('format.copy', { label: t(labelKey) });
    button.textContent = label;
    button.setAttribute('aria-label', label);
  }

  for (const text of root.querySelectorAll('.banner-text[data-reasons]')) {
    const reasons = JSON.parse(text.getAttribute('data-reasons'));
    text.textContent = reasonText(reasons);
  }

  // Computed context sentences carry raw params; re-format for the locale.
  for (const node of root.querySelectorAll('[data-enrich]')) {
    const sentences = JSON.parse(node.getAttribute('data-enrich'));
    node.textContent = sentences
      .map(({ key, params }) => t(key, enrichDisplayParams(params, locale)))
      .join(' ');
  }
}

function enrichDisplayParams(params, locale) {
  const formats = {
    count: (value) => formatCount(value, locale),
    addresses: (value) => formatAddresses(value, locale),
    date: (value) => formatDate(value, locale),
  };
  return Object.fromEntries(
    Object.entries(params).map(([key, value]) => {
      const format = formats[key];
      return [key, format ? format(value) : value];
    }),
  );
}

function randomizationBanner(randomization) {
  if (!randomization || !randomization.reasons?.length) return null;
  const kind = randomization.likely ? 'warning' : 'info';
  const title = randomization.likely
    ? t('randomize.likelyTitle')
    : t('randomize.notesTitle');
  return el('div', { class: `banner banner--${kind}` }, [
    el('strong', { text: title }),
    el('p', { text: reasonText(randomization.reasons) }),
  ]);
}

/** Render structured reasons ({key, params}) as localized sentences. */
function reasonText(reasons) {
  const locale = getLocale();
  return reasons
    .map((reason) => (typeof reason === 'string' ? reason : t(reason.key, reason.params)))
    .join(' ');
}

/** One search-match reason label with locale-aware country detail. */
function reasonCell(reason) {
  const label = t(`reason.${reason.type}`);
  const detail = reason.type === 'country' ? countryLabel(reason.detail) : reason?.detail;
  return detail ? `${label}: ${detail}` : label;
}

function formatList(formats) {
  const list = el('ul', { class: 'format-list' });
  for (const [i18nKey, key] of FORMATS) {
    const value = formats[key];
    if (!value) continue;
    list.append(
      el('li', { class: 'format-row' }, [
        el('span', { class: 'format-label', text: t(i18nKey) }),
        el('code', { class: 'format-value', text: value }),
        copyButton(() => value, { label: t('format.copy', { label: t(i18nKey) }) }),
      ]),
    );
  }
  return list;
}

function macLine(value) {
  return el('div', { class: 'mac-line' }, [
    el('code', { class: 'mac', text: value }),
    copyButton(() => value, { label: t('format.copyMac') }),
  ]);
}

function prefixCell(prefix, onSelect) {
  return onSelect
    ? el(
        'button',
        {
          type: 'button',
          class: 'prefix-button',
          title: `Look up ${colonize(prefix)}`,
          onClick: () => onSelect(prefix),
        },
        [colonize(prefix)],
      )
    : el('code', { text: colonize(prefix) });
}

function resultsTable(headerKeys, rows, footer = null) {
  return el('div', { class: 'table-wrap' }, [
    el('table', { class: 'data-table stack-table' }, [
      el('thead', {}, [
        el('tr', {}, [
          headerKeys.map((key) => el('th', { scope: 'col', text: t(key) })),
        ]),
      ]),
      el('tbody', {}, rows),
      footer
        ? el('tfoot', {}, [
            el('tr', {}, [el('td', { class: 'hub-expand', colspan: headerKeys.length }, footer)]),
          ])
        : null,
    ]),
  ]);
}

/**
 * Expand control for a table's <tfoot> last line. The triangle glyph is
 * aria-hidden, so the accessible name stays "Show more"/"Show all".
 */
function expandButton(label, onClick) {
  return el(
    'button',
    { type: 'button', class: 'button button--ghost button--small', onClick },
    [el('span', { 'aria-hidden': 'true', text: '▾' }), ' ', label],
  );
}

function countryLabel(code) {
  if (!code) return null;
  const locale = getLocale();
  try {
    const name = new Intl.DisplayNames([locale], { type: 'region' }).of(code.toUpperCase());
    if (name && name !== code.toUpperCase()) return `${name} (${code})`;
  } catch {
    // fall through to the raw code
  }
  return code;
}

/** Chronological lineage timeline, or null when there is nothing to show. */
export function lineageTimeline(entry) {
  if (!entry || !Array.isArray(entry.events) || entry.events.length < 2) return null;
  return el('section', { class: 'result-section' }, [
    el('h3', { text: t('result.prefixLineage') }),
    el('p', { class: 'section-note', text: t('lineage.note') }),
    el(
      'ol',
      { class: 'timeline' },
      entry.events.map((event) =>
        el('li', {}, [
          el('span', { class: 'timeline-org', text: event.orgName || t('lineage.unknown') }),
          event.date
            ? el('span', { class: 'timeline-when', text: formatDate(event.date, getLocale()) })
            : null,
        ]),
      ),
    ),
  ]);
}

/** Placeholder card for a dynamic lookup while the registry loads. */
export function renderPending(container, hex) {
  clear(container);
  const formats = formatAddress(hex);
  const bits = analyzeBits(hex);
  container.append(
    el('article', { class: 'card result-card', 'aria-busy': 'true' }, [
      el('header', { class: 'result-header' }, [
        el('p', { class: 'eyebrow', text: t('result.eyebrow') }),
        el('h2', { class: 'vendor', text: t('result.loading') }),
      ]),
      macLine(formats.colon),
      bitSummary(bits),
      el('section', { class: 'result-section' }, [
        el('h3', { text: t('result.formats') }),
        formatList(formats),
      ]),
    ]),
  );
}

export function renderMatch(container, result, { lineage = null, portfolio = null, onViewAll = null } = {}) {
  clear(container);
  const { match, bits, formats, randomization, hypervisor } = result;
  const range = addressRange(match.prefix, match.prefixLen);
  const firstSeen = match.firstSeen ?? lineage?.firstSeen ?? null;

  container.append(
    el('article', { class: 'card result-card' }, [
      el('header', { class: 'result-header' }, [
        el('p', { class: 'eyebrow', text: t('result.eyebrow') }),
        el('h2', { class: 'vendor', text: match.orgName || t('result.unknownOrg') }),
        el('div', { class: 'badges' }, [
          badge(`${match.blockType} · ${match.prefixLen}-bit`),
          isSubdivided(match) ? badge(t('badge.subdivided'), 'warning') : null,
          match.isPrivate ? badge(t('badge.private'), 'warning') : null,
          hypervisor ? badge(t('badge.vm', { name: hypervisor.name })) : null,
          randomization?.likely ? badge(t('badge.randomized'), 'warning') : null,
        ]),
      ]),
      macLine(formats.colon),
      bitSummary(bits),
      randomizationBanner(randomization),
      detailList([
        ['detail.matchedPrefix', el('code', { text: colonize(match.prefix) })],
        [
          'detail.match',
          match.exact
            ? `${match.blockType}`
            : t('result.longestMatch', { bits: match.matchedLength * 4 }),
        ],
        ['detail.addressRange', el('code', { text: `${range.start} – ${range.end}` })],
        ['detail.addressesInBlock', formatCount(match.addressCount, getLocale())],
        ['detail.country', countryLabel(match.country)],
        ['detail.orgAddress', match.orgAddress || null],
        ['detail.firstRegistered', firstSeen ? formatDate(firstSeen, getLocale()) : null],
      ]),
      portfolio && portfolio.blocks > 1
        ? el('p', { class: 'summary-line' }, [
            t('portfolio.label', {
              blocks: formatCount(portfolio.blocks, getLocale()),
              addresses: formatAddresses(portfolio.addresses),
            }),
            onViewAll
              ? el('button', {
                  type: 'button',
                  class: 'button button--ghost button--small',
                  text: t('portfolio.viewAll'),
                  onClick: onViewAll,
                })
              : null,
          ])
        : null,
      el('section', { class: 'result-section' }, [
        el('h3', { text: t('result.formats') }),
        formatList(formats),
      ]),
      lineageTimeline(lineage),
    ]),
  );
}

export function renderNone(container, result) {
  clear(container);
  const { formats, bits, randomization, hypervisor } = result;

  container.append(
    el('article', { class: 'card result-card' }, [
      el('header', { class: 'result-header' }, [
        el('p', { class: 'eyebrow', text: t('none.eyebrow') }),
        el('h2', { class: 'vendor', text: t('none.title') }),
        el('div', { class: 'badges' }, [
          hypervisor ? badge(t('badge.vm', { name: hypervisor.name })) : null,
          randomization?.likely ? badge(t('badge.randomized'), 'warning') : null,
        ]),
      ]),
      macLine(formats.colon),
      el('p', { text: t('none.description') }),
      bitSummary(bits),
      randomizationBanner(randomization),
      el('section', { class: 'result-section' }, [
        el('h3', { text: t('result.formats') }),
        formatList(formats),
      ]),
    ]),
  );
}

/** See build/hubs.mjs SHOW_ALL_SLOW_ROWS: ~0.6 s stall on a phone at 4x. */
const PARTIAL_SLOW_ROWS = 1500;

export function renderPartial(container, result, { onSelect, onShowMore = null, onShowAll = null } = {}) {
  clear(container);
  const { matches, total, truncated, input } = result;

  const rows = matches.map((record) =>
    el('tr', {}, [
      el('td', { 'data-label': t('table.prefix'), class: 'mono' }, [prefixCell(record.prefix, onSelect)]),
      el('td', { 'data-label': t('table.block') }, [record.blockType]),
      el('td', { 'data-label': t('table.org'), class: 'org' }, [record.orgName || '-']),
    ]),
  );

  // The expand controls are the table's own last line (a <tfoot> row), not a
  // button under it. "Show all" renders every match in one pass, so past
  // PARTIAL_SLOW_ROWS it warns that the page will stall (measured in
  // e2e/measure-showall.mjs: /00's 17,394 rows take 2.2 s to rebuild+paint
  // at 1x CPU and 9.4 s at 4x).
  const footer =
    truncated && onShowMore
      ? [
          expandButton(t('partial.showMore'), onShowMore),
          ...(onShowAll
            ? [
                expandButton(
                  total > PARTIAL_SLOW_ROWS ? t('partial.showAllSlow') : t('partial.showAll'),
                  onShowAll,
                ),
              ]
            : []),
        ]
      : null;

  const heading = total === 1
    ? t('search.matching', { count: formatCount(total) })
    : t('search.matchingPlural', { count: formatCount(total) });

  container.append(
    el('article', { class: 'card result-card' }, [
      el('h2', { text: heading }),
      el('p', {
        class: 'section-note',
        text:
          t('partial.note.start', { prefix: colonize(input.hex) }) +
          (truncated ? t('partial.note.cap', { shown: formatCount(matches.length) }) : '') +
          t('partial.note.end'),
      }),
      resultsTable(['table.prefix', 'table.block', 'table.org'], rows, footer),
    ]),
  );
}

function summaryLine(summary) {
  if (!summary) return null;
  const parts = [
    summary.total === 1
      ? t('summary.address', { count: 1 })
      : t('summary.addresses', { count: formatCount(summary.total) }),
  ];
  for (const vendor of summary.vendors) parts.push(`${vendor.name} ×${vendor.count}`);
  if (summary.randomized) parts.push(t('summary.randomized', { count: formatCount(summary.randomized) }));
  if (summary.hypervisor) parts.push(t('summary.hypervisor', { count: formatCount(summary.hypervisor) }));
  if (summary.unregistered) parts.push(t('summary.unregistered', { count: formatCount(summary.unregistered) }));
  if (summary.partial) parts.push(t('summary.partial', { count: formatCount(summary.partial) }));
  if (summary.invalid) parts.push(t('summary.invalid', { count: formatCount(summary.invalid) }));
  return el('p', { class: 'summary-line', text: parts.join(' · ') });
}

export function renderBatch(container, entries, { summary = null, extracted = false, onExportCsv = null, onExportJson = null } = {}) {
  clear(container);

  const rows = entries.map(({ raw, result }) => {
    let label;
    if (result.kind === 'match') label = result.match.orgName || t('result.unknownOrg');
    else if (result.kind === 'invalid') label = invalidMessage(result.error);
    else if (result.kind === 'partial') label = tCount('partial.matching', result.total, { count: formatCount(result.total) });
    else label = t('batch.unregistered');

    const flags = [];
    if (result.kind === 'match') flags.push(result.match.blockType);
    if (result.hypervisor) flags.push(`VM: ${result.hypervisor.name}`);
    if (result.randomization?.likely) flags.push(t('badge.randomized'));

    return el('tr', {}, [
      el('td', { 'data-label': t('table.input'), class: 'mono' }, [
        result.input ? colonize(result.input.hex) : raw,
      ]),
      el('td', { 'data-label': t('table.result'), class: 'org' }, [label]),
      el('td', { 'data-label': t('table.flags') }, [flags.length ? flags.join(' · ') : '-']),
    ]);
  });

  const heading = entries.length === 1
    ? t('batch.lookups', { count: 1 })
    : tCount('batch.lookups', entries.length, { count: formatCount(entries.length) });

  const exports =
    onExportCsv || onExportJson
      ? el('p', { class: 'export-row' }, [
          onExportCsv
            ? el('button', {
                type: 'button',
                class: 'button button--ghost button--small',
                text: t('batch.exportCsv'),
                onClick: onExportCsv,
              })
            : null,
          onExportJson
            ? el('button', {
                type: 'button',
                class: 'button button--ghost button--small',
                text: t('batch.exportJson'),
                onClick: onExportJson,
              })
            : null,
        ])
      : null;

  container.append(
    el('article', { class: 'card result-card' }, [
      el('h2', { text: heading }),
      summaryLine(summary),
      extracted ? el('p', { class: 'section-note', text: t('batch.extracted') }) : null,
      exports,
      resultsTable(['table.input', 'table.result', 'table.flags'], rows),
    ]),
  );
}

export function renderSearchResults(
  container,
  { query, matches = [], total = 0, truncated = false, portfolio = null, onSelect, vendorHubUrl = null } = {},
) {
  clear(container);

  const rows = matches.map(({ record, reason }) =>
    el('tr', {}, [
      el('td', { 'data-label': t('table.prefix'), class: 'mono' }, [prefixCell(record.prefix, onSelect)]),
      el('td', { 'data-label': t('table.block') }, [record.blockType]),
      el('td', { 'data-label': t('table.org'), class: 'org' }, [record.orgName || '-']),
      el('td', { 'data-label': t('table.match') }, [
        reasonCell(reason),
      ]),
    ]),
  );

  const heading = total === 0
    ? t('search.noMatch')
    : total === 1
      ? t('search.matching', { count: formatCount(total) })
      : tCount('search.matching', total, { count: formatCount(total) });

  // The dynamic view is capped at 500; the build writes the org's hub slug
  // into matching rows, so any vendor match links the complete static hub.
  const hubUrl = vendorHubUrl ?? matches.find((entry) => entry.record.vendorHub)?.record.vendorHub;

  container.append(
    el('article', { class: 'card result-card' }, [
      el('h2', { text: heading }),
      portfolio
        ? el('p', {
            class: 'summary-line',
            text: `${portfolio.orgName} · ${formatCount(portfolio.blocks, getLocale())} · ${formatAddresses(portfolio.addresses, getLocale())}`,
          })
        : null,
      hubUrl
        ? el('p', { class: 'summary-line' }, [
            el('a', {
              href: `/vendor/${hubUrl}`,
              class: 'button button--ghost button--small',
              text: t('portfolio.viewAll'),
            }),
          ])
        : null,
      el('p', {
        class: 'section-note',
        text:
          `${t('search.resultsFor', { query })} ${t('search.description')}` +
          (truncated ? ` ${t('search.showing', { shown: formatCount(matches.length) })}` : ''),
      }),
      matches.length
        ? resultsTable(['table.prefix', 'table.block', 'table.org', 'table.match'], rows)
        : null,
    ]),
  );
}

export function renderInvalid(container, { error }) {
  clear(container);
  container.append(
    el('div', { class: 'banner banner--danger', role: 'alert' }, [
      el('strong', { text: t('invalid.banner') }),
      el('p', { text: invalidMessage(error) }),
    ]),
  );
}

export function renderDataError(container, { onRetry, message = null } = {}) {
  clear(container);
  container.append(
    el('div', { class: 'banner banner--danger', role: 'alert' }, [
      el('strong', { text: t('dataError.title') }),
      el('p', { text: message || t('dataError.connection') }),
      onRetry
        ? el('p', {}, [
            el('button', {
              type: 'button',
              class: 'button button--small',
              text: t('dataError.retry'),
              onClick: onRetry,
            }),
          ])
        : null,
    ]),
  );
}
