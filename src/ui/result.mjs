/** Result renderers. All external data goes through textContent. */

import { countryName } from '../engine/countries.mjs';
import { reasonLabel } from '../engine/search.mjs';
import { copyButton } from './clipboard.mjs';
import { clear, el } from './dom.mjs';
import { addressRange, colonize, formatAddresses, formatCount, formatDate } from './format.mjs';

const FORMATS = [
  ['Plain hex', 'plain'],
  ['Colon-separated', 'colon'],
  ['Hyphen-separated', 'hyphen'],
  ['Cisco dot notation', 'cisco'],
  ['EUI-64', 'eui64'],
  ['IPv6 link-local', 'ipv6LinkLocal'],
];

const INVALID_MESSAGES = {
  empty: 'Enter a MAC address, a prefix, a vendor name, or paste some text.',
  invalid_chars: 'Use hex characters only (0–9, A–F), with optional colons, hyphens, dots, or spaces.',
  too_long: 'A MAC address has at most 12 hex characters.',
};

export function invalidMessage(error) {
  return INVALID_MESSAGES[error] ?? 'That input could not be parsed as a MAC address.';
}

function badge(text, kind = 'neutral') {
  return el('span', { class: kind === 'neutral' ? 'badge' : `badge badge--${kind}` }, [text]);
}

function detailList(items) {
  const list = el('dl', { class: 'detail-grid' });
  for (const [term, value] of items) {
    if (value === null || value === undefined || value === '') continue;
    list.append(el('dt', { text: term }));
    list.append(el('dd', {}, [value]));
  }
  return list;
}

function bitSummary(bits) {
  if (!bits) return null;
  const parts = [
    bits.multicast ? 'Multicast (I/G bit set)' : 'Unicast',
    bits.locallyAdministered
      ? 'Locally administered (U/L bit set)'
      : 'Universally administered (U/L bit clear)',
  ];
  if (bits.broadcast) parts.push('Broadcast address');
  if (bits.allZeros) parts.push('All-zero address');
  return el('p', { class: 'bits', text: parts.join(' · ') });
}

function randomizationBanner(randomization) {
  if (!randomization || !randomization.reasons?.length) return null;
  const kind = randomization.likely ? 'warning' : 'info';
  const title = randomization.likely
    ? 'Likely randomized or locally administered'
    : 'Address notes';
  return el('div', { class: `banner banner--${kind}` }, [
    el('strong', { text: title }),
    el('p', { text: randomization.reasons.join(' ') }),
  ]);
}

function formatList(formats) {
  const list = el('ul', { class: 'format-list' });
  for (const [label, key] of FORMATS) {
    const value = formats[key];
    if (!value) continue;
    list.append(
      el('li', { class: 'format-row' }, [
        el('span', { class: 'format-label', text: label }),
        el('code', { class: 'format-value', text: value }),
        copyButton(() => value, { label: `Copy ${label}` }),
      ]),
    );
  }
  return list;
}

function macLine(value) {
  return el('div', { class: 'mac-line' }, [
    el('code', { class: 'mac', text: value }),
    copyButton(() => value, { label: 'Copy MAC address' }),
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

function resultsTable(columns, rows) {
  return el('div', { class: 'table-wrap' }, [
    el('table', { class: 'data-table stack-table' }, [
      el(
        'thead',
        {},
        [
          el(
            'tr',
            {},
            columns.map((label) => el('th', { scope: 'col', text: label })),
          ),
        ],
      ),
      el('tbody', {}, rows),
    ]),
  ]);
}

function countryLabel(code) {
  if (!code) return null;
  const name = countryName(code);
  return name ? `${name} (${code})` : code;
}

/** Chronological lineage timeline, or null when there is nothing to show. */
export function lineageTimeline(entry) {
  if (!entry || !Array.isArray(entry.events) || entry.events.length < 2) return null;
  return el('section', { class: 'result-section' }, [
    el('h3', { text: 'Prefix lineage' }),
    el('p', {
      class: 'section-note',
      text: 'This prefix has changed hands. Dates are when each change was first observed in public registration data (runZero mac-tracker).',
    }),
    el(
      'ol',
      { class: 'timeline' },
      entry.events.map((event) =>
        el('li', {}, [
          el('span', { class: 'timeline-org', text: event.orgName || 'Unknown organization' }),
          event.date ? el('span', { class: 'timeline-when', text: formatDate(event.date) }) : null,
        ]),
      ),
    ),
  ]);
}

export function renderMatch(container, result, { lineage = null, portfolio = null, onViewAll = null } = {}) {
  clear(container);
  const { match, bits, formats, randomization, hypervisor } = result;
  const range = addressRange(match.prefix, match.prefixLen);
  const firstSeen = match.firstSeen ?? lineage?.firstSeen ?? null;

  container.append(
    el('article', { class: 'card result-card' }, [
      el('header', { class: 'result-header' }, [
        el('p', { class: 'eyebrow', text: 'Vendor' }),
        el('h2', { class: 'vendor', text: match.orgName || 'Unknown organization' }),
        el('div', { class: 'badges' }, [
          badge(`${match.blockType} · ${match.prefixLen}-bit`),
          match.isPrivate ? badge('Private registration', 'warning') : null,
          hypervisor ? badge(`Virtual machine: ${hypervisor.name}`) : null,
          randomization?.likely ? badge('Likely randomized', 'warning') : null,
        ]),
      ]),
      macLine(formats.colon),
      bitSummary(bits),
      randomizationBanner(randomization),
      detailList([
        ['Matched prefix', el('code', { text: colonize(match.prefix) })],
        [
          'Match',
          match.exact
            ? `${match.blockType} assignment`
            : `Longest prefix match on the first ${match.matchedLength * 4} bits`,
        ],
        ['Address range', el('code', { text: `${range.start} – ${range.end}` })],
        ['Addresses in block', formatCount(match.addressCount)],
        ['Country', countryLabel(match.country)],
        ['Organization address', match.orgAddress || null],
        ['First registered', firstSeen ? formatDate(firstSeen) : null],
      ]),
      portfolio && portfolio.blocks > 1
        ? el('p', { class: 'summary-line' }, [
            `Vendor portfolio: ${formatCount(portfolio.blocks)} blocks · ${formatAddresses(portfolio.addresses)} addresses`,
            onViewAll
              ? el('button', {
                  type: 'button',
                  class: 'button button--ghost button--small',
                  text: 'View all prefixes',
                  onClick: onViewAll,
                })
              : null,
          ])
        : null,
      el('section', { class: 'result-section' }, [
        el('h3', { text: 'Formats' }),
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
        el('p', { class: 'eyebrow', text: 'No vendor match' }),
        el('h2', { class: 'vendor', text: 'Unregistered prefix' }),
        el('div', { class: 'badges' }, [
          hypervisor ? badge(`Virtual machine: ${hypervisor.name}`) : null,
          randomization?.likely ? badge('Likely randomized', 'warning') : null,
        ]),
      ]),
      macLine(formats.colon),
      el('p', {
        text: 'No IEEE registration matches this prefix. That usually means the address is locally administered — randomized for privacy, assigned by a virtual machine, or set manually.',
      }),
      bitSummary(bits),
      randomizationBanner(randomization),
      el('section', { class: 'result-section' }, [
        el('h3', { text: 'Formats' }),
        formatList(formats),
      ]),
    ]),
  );
}

export function renderPartial(container, result, { onSelect } = {}) {
  clear(container);
  const { matches, total, truncated, input } = result;

  const rows = matches.map((record) =>
    el('tr', {}, [
      el('td', { 'data-label': 'Prefix', class: 'mono' }, [prefixCell(record.prefix, onSelect)]),
      el('td', { 'data-label': 'Block' }, [record.blockType]),
      el('td', { 'data-label': 'Organization', class: 'org' }, [record.orgName || '—']),
    ]),
  );

  container.append(
    el('article', { class: 'card result-card' }, [
      el('h2', { text: `${formatCount(total)} matching ${total === 1 ? 'prefix' : 'prefixes'}` }),
      el('p', {
        class: 'section-note',
        text:
          `Prefixes beginning with ${colonize(input.hex)}` +
          (truncated ? `, showing the first ${formatCount(matches.length)}` : '') +
          '. Select a prefix for full details.',
      }),
      resultsTable(['Prefix', 'Block', 'Organization'], rows),
    ]),
  );
}

function summaryLine(summary) {
  if (!summary) return null;
  const parts = [`${formatCount(summary.total)} ${summary.total === 1 ? 'address' : 'addresses'}`];
  for (const vendor of summary.vendors) parts.push(`${vendor.name} ×${vendor.count}`);
  if (summary.randomized) parts.push(`${formatCount(summary.randomized)} randomized`);
  if (summary.hypervisor) parts.push(`${formatCount(summary.hypervisor)} virtual machine`);
  if (summary.unregistered) parts.push(`${formatCount(summary.unregistered)} unregistered`);
  if (summary.partial) parts.push(`${formatCount(summary.partial)} partial`);
  if (summary.invalid) parts.push(`${formatCount(summary.invalid)} invalid`);
  return el('p', { class: 'summary-line', text: parts.join(' · ') });
}

export function renderBatch(container, entries, { summary = null, extracted = false } = {}) {
  clear(container);

  const rows = entries.map(({ raw, result }) => {
    let label;
    if (result.kind === 'match') label = result.match.orgName || 'Unknown organization';
    else if (result.kind === 'invalid') label = invalidMessage(result.error);
    else if (result.kind === 'partial') label = `${formatCount(result.total)} matching prefixes`;
    else label = 'Unregistered prefix';

    const flags = [];
    if (result.kind === 'match') flags.push(result.match.blockType);
    if (result.hypervisor) flags.push(`VM: ${result.hypervisor.name}`);
    if (result.randomization?.likely) flags.push('Randomized?');

    return el('tr', {}, [
      el('td', { 'data-label': 'Input', class: 'mono' }, [
        result.input ? colonize(result.input.hex) : raw,
      ]),
      el('td', { 'data-label': 'Result', class: 'org' }, [label]),
      el('td', { 'data-label': 'Flags' }, [flags.length ? flags.join(' · ') : '—']),
    ]);
  });

  container.append(
    el('article', { class: 'card result-card' }, [
      el('h2', { text: `${formatCount(entries.length)} ${entries.length === 1 ? 'lookup' : 'lookups'}` }),
      summaryLine(summary),
      extracted
        ? el('p', {
            class: 'section-note',
            text: 'Extracted from pasted text; non-address content was ignored.',
          })
        : null,
      resultsTable(['Input', 'Result', 'Flags'], rows),
    ]),
  );
}

export function renderSearchResults(
  container,
  { query, matches = [], total = 0, truncated = false, portfolio = null, onSelect } = {},
) {
  clear(container);

  const rows = matches.map(({ record, reason }) =>
    el('tr', {}, [
      el('td', { 'data-label': 'Prefix', class: 'mono' }, [prefixCell(record.prefix, onSelect)]),
      el('td', { 'data-label': 'Block' }, [record.blockType]),
      el('td', { 'data-label': 'Organization', class: 'org' }, [record.orgName || '—']),
      el('td', { 'data-label': 'Match' }, [
        `${reasonLabel(reason)}${reason?.detail ? `: ${reason.detail}` : ''}`,
      ]),
    ]),
  );

  container.append(
    el('article', { class: 'card result-card' }, [
      el('h2', {
        text:
          total === 0
            ? 'No matching prefixes'
            : `${formatCount(total)} matching ${total === 1 ? 'prefix' : 'prefixes'}`,
      }),
      portfolio
        ? el('p', {
            class: 'summary-line',
            text:
              `${portfolio.orgName} — ${formatCount(portfolio.blocks)} ` +
              `${portfolio.blocks === 1 ? 'block' : 'blocks'} · ` +
              `${formatAddresses(portfolio.addresses)} addresses`,
          })
        : null,
      el('p', {
        class: 'section-note',
        text:
          `Results for “${query}”. Searches vendors, former owners, countries, registries, ` +
          `prefixes, and registration years.` +
          (truncated ? ` Showing the first ${formatCount(matches.length)}.` : ''),
      }),
      matches.length ? resultsTable(['Prefix', 'Block', 'Organization', 'Match'], rows) : null,
    ]),
  );
}

export function renderInvalid(container, { error }) {
  clear(container);
  container.append(
    el('div', { class: 'banner banner--danger', role: 'alert' }, [
      el('strong', { text: 'That does not look like a MAC address' }),
      el('p', { text: invalidMessage(error) }),
    ]),
  );
}

export function renderDataError(container, { onRetry } = {}) {
  clear(container);
  container.append(
    el('div', { class: 'banner banner--danger', role: 'alert' }, [
      el('strong', { text: 'Could not load the registry data' }),
      el('p', { text: 'Check your connection and try again.' }),
      onRetry
        ? el('p', {}, [
            el('button', {
              type: 'button',
              class: 'button button--small',
              text: 'Retry',
              onClick: onRetry,
            }),
          ])
        : null,
    ]),
  );
}
