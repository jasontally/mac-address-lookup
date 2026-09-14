/**
 * Static prefix page template. Mirrors the class names used by
 * src/ui/result.mjs so the dynamic app can replace it seamlessly.
 * All registry data is HTML-escaped; JSON-LD escapes `<` for script safety.
 */

import { analyzeBits } from '../src/engine/input.mjs';
import { formatAddress } from '../src/engine/formats.mjs';
import { classifyRandomization, detectHypervisor } from '../src/engine/vendors.mjs';
import { en } from '../src/i18n/en.mjs';
import { addressRange, colonize, formatCount, formatDate } from '../src/ui/format.mjs';

export const SITE = 'https://mac.jasontally.com';

/** [i18n key, format key] — static HTML keeps the English label from en.mjs. */
const FORMAT_LABELS = [
  ['format.plain', 'plain'],
  ['format.colon', 'colon'],
  ['format.hyphen', 'hyphen'],
  ['format.cisco', 'cisco'],
  ['format.eui64', 'eui64'],
  ['format.ipv6', 'ipv6LinkLocal'],
];

const label = (key) => en[key];

export function escapeHtml(value) {
  return String(value ?? '').replace(
    /[&<>"']/g,
    (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char],
  );
}

function truncate(text, max) {
  if (text.length <= max) return text;
  const cut = text.slice(0, max);
  const lastSpace = cut.lastIndexOf(' ');
  return `${cut.slice(0, lastSpace > 40 ? lastSpace : max - 1).trimEnd()}…`;
}

function badge(text, kind = 'neutral') {
  const cls = kind === 'neutral' ? 'badge' : `badge badge--${kind}`;
  return `<span class="${cls}">${escapeHtml(text)}</span>`;
}

function copyButton(label, value) {
  return `<button type="button" class="button button--ghost button--small" data-copy="${escapeHtml(value)}" aria-label="Copy ${escapeHtml(label)}">Copy ${escapeHtml(label)}</button>`;
}

function bitSummary(bits) {
  const parts = [
    bits.multicast ? 'Multicast (I/G bit set)' : 'Unicast',
    bits.locallyAdministered
      ? 'Locally administered (U/L bit set)'
      : 'Universally administered (U/L bit clear)',
  ];
  return `<p class="bits">${escapeHtml(parts.join(' · '))}</p>`;
}

function banner(kind, title, text) {
  return `<div class="banner banner--${kind}"><strong>${escapeHtml(title)}</strong><p>${escapeHtml(text)}</p></div>`;
}

function detailRows(rows) {
  const body = rows
    .filter(([, value]) => value !== null && value !== undefined && value !== '')
    .map(
      ([key, value, mono]) =>
        `      <dt data-i18n="${key}">${escapeHtml(label(key))}</dt>\n      <dd>${mono ? `<code>${escapeHtml(value)}</code>` : escapeHtml(value)}</dd>`,
    )
    .join('\n');
  return `<dl class="detail-grid">\n${body}\n    </dl>`;
}

function formatList(formats) {
  const rows = FORMAT_LABELS.filter(([, key]) => formats[key])
    .map(
      ([i18nKey, key]) =>
        `      <li class="format-row">\n` +
        `        <span class="format-label" data-i18n="${i18nKey}">${escapeHtml(label(i18nKey))}</span>\n` +
        `        <code class="format-value">${escapeHtml(formats[key])}</code>\n` +
        `        ${copyButton(label(i18nKey), formats[key])}\n` +
        `      </li>`,
    )
    .join('\n');
  return `<ul class="format-list">\n${rows}\n    </ul>`;
}

function lineageSection(lineage) {
  if (!lineage || !Array.isArray(lineage.events) || lineage.events.length < 2) return '';
  const events = lineage.events
    .map(
      (event) =>
        `        <li>\n` +
        `          <span class="timeline-org">${escapeHtml(event.orgName || 'Unknown organization')}</span>\n` +
        (event.date
          ? `          <span class="timeline-when">${escapeHtml(formatDate(event.date))}</span>\n`
          : '') +
        `        </li>`,
    )
    .join('\n');
  return `      <section class="result-section">
        <h3 data-i18n="result.prefixLineage">Prefix lineage</h3>
        <p class="section-note" data-i18n="lineage.note">This prefix has changed hands. Dates are when each change was first observed in public registration data (runZero mac-tracker).</p>
        <ol class="timeline">
${events}
        </ol>
      </section>`;
}

function renderResult(record, lineage) {
  const bits = analyzeBits(record.prefix);
  const formats = formatAddress(record.prefix);
  const hypervisor = detectHypervisor(record.prefix);
  const randomization = classifyRandomization({ bits, match: record, hypervisor });
  const range = addressRange(record.prefix, record.prefixLen);
  const colon = colonize(record.prefix);
  const firstSeen = record.firstSeen ?? lineage?.firstSeen ?? null;

  const badges = [
    badge(`${record.blockType} · ${record.prefixLen}-bit`),
    record.isPrivate ? badge('Private registration', 'warning') : '',
    hypervisor ? badge(`Virtual machine: ${hypervisor.name}`) : '',
    randomization.likely ? badge('Likely randomized', 'warning') : '',
  ]
    .filter(Boolean)
    .join('\n          ');

  const bannerHtml =
    randomization.reasons.length > 0
      ? banner(
          randomization.likely ? 'warning' : 'info',
          randomization.likely ? 'Likely randomized or locally administered' : 'Address notes',
          randomization.reasons.join(' '),
        )
      : '';

  const details = detailRows([
    ['detail.matchedPrefix', colon, true],
    ['detail.match', `${record.blockType} assignment`],
    ['detail.addressRange', `${range.start} – ${range.end}`, true],
    ['detail.addressesInBlock', formatCount(record.addressCount)],
    ['detail.country', record.country],
    ['detail.orgAddress', record.orgAddress || null],
    ['detail.firstRegistered', firstSeen ? formatDate(firstSeen) : null],
  ]);

  return `    <article class="card result-card">
      <header class="result-header">
        <p class="eyebrow" data-i18n="result.eyebrow">Vendor</p>
        <h2 class="vendor">${escapeHtml(record.orgName || 'Unknown organization')}</h2>
        <div class="badges">
          ${badges}
        </div>
      </header>
      <div class="mac-line">
        <code class="mac">${escapeHtml(colon)}</code>
        ${copyButton('MAC address', colon)}
      </div>
      ${bitSummary(bits)}
      ${bannerHtml}
      ${details}
      <section class="result-section">
        <h3 data-i18n="result.formats">Formats</h3>
        ${formatList(formats)}
      </section>
${lineageSection(lineage)}
    </article>`;
}

const THEME_BOOT = `(function () {
        try {
          var mode = localStorage.getItem('mal.theme');
          if (mode === 'light' || mode === 'dark') document.documentElement.dataset.mode = mode;
        } catch (error) {
          /* storage unavailable; system preference applies */
        }
      })();`;

/** Render a complete static HTML page for one registered prefix. */
export function renderPrefixPage({
  record,
  lineage = null,
  site = SITE,
  assets = { appFile: '/assets/app.js', cssFile: '/assets/app.css' },
}) {
  const colon = colonize(record.prefix);
  const canonical = `${site}/${record.prefix}`;
  const orgName = record.orgName || 'Unknown organization';
  const title = `${colon} — ${orgName} | MAC Address Lookup`;
  const description = truncate(
    `${colon} is a ${record.prefixLen}-bit ${record.blockType} MAC address block registered to ${orgName}` +
      (record.country ? ` (${record.country})` : '') +
      '. Vendor details, address range, randomization checks, and prefix lineage.',
    156,
  );

  const jsonLd = JSON.stringify({
    '@context': 'https://schema.org',
    '@type': 'WebPage',
    name: title,
    url: canonical,
    description,
    isPartOf: { '@type': 'WebSite', name: 'MAC Address Lookup', url: `${site}/` },
    ...(record.orgName
      ? {
          about: {
            '@type': 'Organization',
            name: record.orgName,
            ...(record.orgAddress ? { address: record.orgAddress } : {}),
            ...(record.country ? { addressCountry: record.country } : {}),
          },
        }
      : {}),
  }).replace(/</g, '\\u003c');

  const breadcrumbLd = JSON.stringify({
    '@context': 'https://schema.org',
    '@type': 'BreadcrumbList',
    itemListElement: [
      { '@type': 'ListItem', position: 1, name: 'MAC Address Lookup', item: `${site}/` },
      { '@type': 'ListItem', position: 2, name: colon, item: canonical },
    ],
  }).replace(/</g, '\\u003c');

  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>${escapeHtml(title)}</title>
    <meta name="description" content="${escapeHtml(description)}" />
    <link rel="canonical" href="${escapeHtml(canonical)}" />
    <meta name="theme-color" content="#fbfbfb" media="(prefers-color-scheme: light)" />
    <meta name="theme-color" content="#1b1b1b" media="(prefers-color-scheme: dark)" />
    <meta property="og:type" content="article" />
    <meta property="og:title" content="${escapeHtml(title)}" />
    <meta property="og:description" content="${escapeHtml(description)}" />
    <meta property="og:url" content="${escapeHtml(canonical)}" />
    <link rel="icon" href="/favicon.svg" type="image/svg+xml" />
    <link rel="stylesheet" href="${assets.cssFile}" />
    <script>
      ${THEME_BOOT}
    </script>
    <script type="application/ld+json">
      ${jsonLd}
    </script>
    <script type="application/ld+json">
      ${breadcrumbLd}
    </script>
    <script type="module" src="${assets.appFile}"></script>
  </head>
  <body>
    <a class="skip-link" href="#main" data-i18n="a11y.skip">Skip to content</a>

    <header class="site-header">
      <div class="container">
        <a class="wordmark" href="/">MAC Address Lookup</a>
        <div class="header-actions">
          <a class="button button--ghost button--icon" href="/help" data-i18n-title="nav.help" aria-label="Help and documentation" title="Help and documentation">?</a>
          <select id="locale-picker" class="locale-picker" aria-label="Language">
          </select>
          <button type="button" id="theme-toggle" class="button button--ghost button--icon" data-i18n-title="nav.theme" aria-label="Toggle theme">
            <svg width="16" height="16" viewBox="0 0 16 16" aria-hidden="true" fill="currentColor">
              <path d="M8 1a7 7 0 1 0 0 14A7 7 0 0 0 8 1Zm0 12.5V2.5a5.5 5.5 0 0 1 0 11Z" />
            </svg>
          </button>
        </div>
      </div>
    </header>

    <main id="main">
      <div class="container">
        <nav class="breadcrumb" aria-label="Breadcrumb">
          <a href="/">MAC Address Lookup</a> <span aria-hidden="true">/</span> <span>${escapeHtml(colon)}</span>
        </nav>
        <section class="hero hero--compact">
          <h1>${escapeHtml(orgName)} <span class="h1-prefix">${escapeHtml(colon)}</span></h1>
          <p class="lede">
            ${escapeHtml(colon)} is a ${record.prefixLen}-bit ${escapeHtml(record.blockType)} MAC address block
            registered to ${escapeHtml(orgName)}${record.country ? ` in ${escapeHtml(record.country)}` : ''}.
          </p>
          <form class="lookup-form" id="lookup-form" novalidate>
            <label class="visually-hidden" for="lookup-input" data-i18n="lookup.label">MAC address or OUI prefix</label>
            <input
              class="lookup-input"
              id="lookup-input"
              name="q"
              type="text"
              inputmode="text"
              autocomplete="off"
              autocapitalize="characters"
              spellcheck="false"
              placeholder="e.g. 00:1A:2B or 001A2B3C4D5E"
            />
            <button class="button button--primary" type="submit" data-i18n="lookup.submit">Look up</button>
          </form>
          <p class="status" id="status" role="status" aria-live="polite"></p>
        </section>

        <section
          id="result"
          aria-live="polite"
          tabindex="-1"
          data-prerendered="true"
          data-hex="${escapeHtml(record.prefix)}"
          data-label="${escapeHtml(orgName)}"
        >
${renderResult(record, lineage)}
        </section>
      </div>
    </main>

    <footer class="site-footer">
      <div class="container">
        <p>
          Data: IEEE Registration Authority registries; historical changes from
          <a href="https://github.com/runZeroInc/mac-tracker" rel="noopener">runZero mac-tracker</a> (MIT).
          Bundled software: <a href="https://github.com/hyparam/hyparquet" rel="noopener">hyparquet</a> (MIT).
        </p>
        <p>
          <span data-i18n="footer.dataNote">All lookups run in your browser — nothing is sent to a server.</span> Data refreshed
          <span id="last-updated">on the latest deploy</span>.
          <a href="https://github.com/jasontally/mac-address-lookup" rel="noopener" data-i18n="footer.source">Source on GitHub</a>.
        </p>
      </div>
    </footer>
  </body>
</html>
`;
}
