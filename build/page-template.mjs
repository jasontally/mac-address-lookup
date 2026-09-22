/**
 * Static prefix page template. Mirrors the class names used by
 * src/ui/result.mjs so the dynamic app can replace it seamlessly.
 * All registry data is HTML-escaped; JSON-LD escapes `<` for script safety.
 */

import { analyzeBits } from '../src/engine/input.mjs';
import { formatAddress } from '../src/engine/formats.mjs';
import { isSubdivided } from '../src/engine/subdivided.mjs';
import { classifyRandomization, detectHypervisor } from '../src/engine/vendors.mjs';
import { en } from '../src/i18n/en.mjs';
import { addressRange, colonize, formatAddresses, formatCount, formatDate } from '../src/ui/format.mjs';
import { enrichDisplayParams } from './enrich.mjs';

export const SITE = 'https://mac.jasontally.com';

/** [i18n key, format key] - static HTML keeps the English label from en.mjs. */
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

function badge(text, kind = 'neutral', i18n = null, params = null) {
  const cls = kind === 'neutral' ? 'badge' : `badge badge--${kind}`;
  const attr = i18n ? ` data-i18n="${i18n}"` : '';
  const paramAttr = params
    ? ` data-i18n-params='${JSON.stringify(params).replace(/'/g, '&#39;')}'`
    : '';
  return `<span class="${cls}"${attr}${paramAttr}>${escapeHtml(text)}</span>`;
}

function copyButton(label, value, i18nKey = null) {
  const kind = i18nKey ? 'format' : 'mac';
  const keyAttr = i18nKey ? ` data-copy-label="${i18nKey}"` : '';
  return `<button type="button" class="button button--ghost button--small" data-copy="${escapeHtml(value)}" data-copy-kind="${kind}" aria-label="Copy ${escapeHtml(label)}"${keyAttr}>Copy ${escapeHtml(label)}</button>`;
}

function bitSummary(bits) {
  const parts = [
    bits.multicast ? 'Multicast (I/G bit set)' : 'Unicast',
    bits.locallyAdministered
      ? 'Locally administered (U/L bit set)'
      : 'Universally administered (U/L bit clear)',
  ];
  if (bits.broadcast) parts.push('Broadcast address');
  if (bits.allZeros) parts.push('All-zero address');
  const payload = JSON.stringify({
    multicast: !!bits.multicast,
    locallyAdministered: !!bits.locallyAdministered,
    broadcast: !!bits.broadcast,
    allZeros: !!bits.allZeros,
  }).replace(/"/g, '&quot;');
  return `<p class="bits" data-bits="${payload}">${escapeHtml(parts.join(' · '))}</p>`;
}

function banner(kind, title, reasons, likely) {
  const titleKey = likely ? 'randomize.likelyTitle' : 'randomize.notesTitle';
  const payload = JSON.stringify(reasons).replace(/"/g, '&quot;');
  return (
    `<div class="banner banner--${kind}">` +
    `<strong data-i18n="${titleKey}">${escapeHtml(en[titleKey])}</strong>` +
    `<p class="banner-text" data-reasons="${payload}">${escapeHtml(reasonText(reasons, 'en'))}</p>` +
    `</div>`
  );
}

/** Structured reasons ({key, params}) → localized sentences for one locale. */
function reasonText(reasons, locale = 'en') {
  return reasons
    .map((reason) =>
      typeof reason === 'string'
        ? reason
        : interpolate(en[reason.key] ?? reason.key, reason.params ?? {}),
    )
    .join(' ');
}

function interpolate(text, params) {
  let out = text;
  for (const [name, value] of Object.entries(params)) {
    out = out.replaceAll(`{${name}}`, String(value));
  }
  return out;
}

function detailRows(rows) {
  const body = rows
    .filter(([, value]) => value !== null && value !== undefined && value !== '')
    .map(
      ([key, value, mono, raw]) =>
        `      <dt data-i18n="${key}">${escapeHtml(label(key))}</dt>\n      <dd>${mono ? `<code>${escapeHtml(value)}</code>` : raw === true ? value : escapeHtml(value)}</dd>`,
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
        `        ${copyButton(label(i18nKey), formats[key], i18nKey)}\n` +
        `      </li>`,
    )
    .join('\n');
  return `<ul class="format-list">\n${rows}\n    </ul>`;
}

function lineageSection(lineage, formerHub = null) {
  if (!lineage || !Array.isArray(lineage.events) || lineage.events.length < 2) return '';
  const events = lineage.events
    .map(
      (event) =>
        `        <li>\n` +
        `          <span class="timeline-org"${
          event.orgName ? '' : ' data-i18n="lineage.unknown"'
        }>${formerOrgHtml(event, formerHub)}</span>\n` +
        (event.date
          ? `          <span class="timeline-when">${escapeHtml(formatDate(event.date, 'en'))}</span>\n`
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

/** Org heading text; links to the vendor hub when one exists (raw HTML). */
function vendorLink(record, vendorHub) {
  const name = record.orgName || 'Unknown organization';
  if (!vendorHub) return escapeHtml(name);
  return `<a class="vendor-link" href="${escapeHtml(vendorHub.url)}">${escapeHtml(name)}</a>`;
}

/**
 * Timeline organization name; links to the former-owner page when that org
 * no longer holds any of its prefixes (raw HTML - hub existence is resolved
 * at build time).
 */
function formerOrgHtml(event, formerHub) {
  if (!event.orgName) return escapeHtml(en['lineage.unknown']);
  if (formerHub) {
    return `<a href="${escapeHtml(formerHub)}">${escapeHtml(event.orgName)}</a>`;
  }
  return escapeHtml(event.orgName);
}

/** Country detail row; raw HTML links to the country hub when one exists. */function countryDetail(record, countryHub) {
  if (!record.country) return [];
  if (!countryHub) return [['detail.country', record.country]];
  return [
    [
      'detail.country',
      `<a href="/country/${escapeHtml(record.country.toLowerCase())}">${escapeHtml(record.country)}</a>`,
      false,
      true,
    ],
  ];
}

function renderResult(record, lineage, { vendorHub = null, countryHub = null, formerHub = null } = {}) {
  const bits = analyzeBits(record.prefix);
  const formats = formatAddress(record.prefix);
  const hypervisor = detectHypervisor(record.prefix);
  const randomization = classifyRandomization({ bits, match: record, hypervisor });
  const range = addressRange(record.prefix, record.prefixLen);
  const colon = colonize(record.prefix);
  const firstSeen = record.firstSeen ?? lineage?.firstSeen ?? null;

  const badges = [
    badge(`${record.blockType} · ${record.prefixLen}-bit`),
    isSubdivided(record) ? badge('OUI subdivided: vendor lookup does not apply', 'warning', 'badge.subdivided') : '',
    record.isPrivate ? badge('Private registration', 'warning', 'badge.private') : '',
    hypervisor ? badge(`Virtual machine: ${hypervisor.name}`, 'neutral', 'badge.vm', { name: hypervisor.name }) : '',
    randomization.likely ? badge('Likely randomized', 'warning', 'badge.randomized') : '',
  ]
    .filter(Boolean)
    .join('\n          ');

  const bannerHtml =
    randomization.reasons.length > 0
      ? banner(
          randomization.likely ? 'warning' : 'info',
          randomization.likely ? 'Likely randomized or locally administered' : 'Address notes',
          randomization.reasons,
          randomization.likely,
        )
      : '';

  const details = detailRows([
    ['detail.matchedPrefix', colon, true],
    ['detail.match', `${record.blockType} assignment`],
    ['detail.addressRange', `${range.start} – ${range.end}`, true],
    ['detail.addressesInBlock', formatCount(record.addressCount, 'en')],
    ...countryDetail(record, countryHub),
    ['detail.orgAddress', record.orgAddress || null],
    ['detail.firstRegistered', firstSeen ? formatDate(firstSeen, 'en') : null],
  ]);

  return `    <article class="card result-card">
      <header class="result-header">
        <p class="eyebrow" data-i18n="result.eyebrow">Vendor</p>
        <h2 class="vendor">${vendorLink(record, vendorHub)}</h2>
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
${lineageSection(lineage, formerHub)}
    </article>`;
}

/**
 * Related-prefix link sections appended inside `#result` on pre-rendered
 * pages (prerender-only: the app clears `#result` on the next lookup,
 * discarding these sections along with the stale record).
 */
export function renderRelated(related, { record = null, vendorHub = null } = {}) {
  if (!related) return '';

  const list = (name, entries) =>
    `<ul class="related-list">\n${entries
      .map(
        (entry) =>
          `          <li><a href="/${escapeHtml(entry.prefix)}"><code>${escapeHtml(
            colonize(entry.prefix),
          )}</code></a><span class="related-org">${escapeHtml(entry.orgName)}</span></li>`,
      )
      .join('\n')}\n        </ul>`;

  const section = (name, inner) =>
    `      <section class="result-section" data-related="${name}">\n${inner}      </section>`;

  const parts = [];
  if (related.sameOrg?.length > 0) {
    const orgLabel = record?.orgName || related.sameOrg[0].orgName;
    const seeAll = vendorHub
      ? `        <p class="summary-line"><a href="${escapeHtml(
          vendorHub.url,
        )}" data-i18n="portfolio.viewAll">${escapeHtml(label('portfolio.viewAll'))}</a></p>\n`
      : '';
    parts.push(
      section(
        'sameOrg',
        `        <h3><span data-i18n="related.sameOrg">${escapeHtml(
          label('related.sameOrg'),
        )}</span> <span class="related-org-name">${escapeHtml(orgLabel)}</span></h3>\n` +
          list('sameOrg', related.sameOrg) +
          '\n' +
          seeAll,
      ),
    );
  }
  if (related.adjacent?.length > 0) {
    parts.push(
      section(
        'adjacent',
        `        <h3 data-i18n="related.adjacent">${escapeHtml(label('related.adjacent'))}</h3>\n` +
          list('adjacent', related.adjacent) +
          '\n',
      ),
    );
  }
  if (related.sameYear?.length > 0) {
    parts.push(
      section(
        'sameYear',
        `        <h3 data-i18n="related.cohort">${escapeHtml(label('related.cohort'))}</h3>\n` +
          list('sameYear', related.sameYear) +
          '\n',
      ),
    );
  }
  return parts.length > 0 ? `${parts.join('\n')}\n` : '';
}

/**
 * Computed context sentences (prerender-only). Static English for crawlers;
 * `data-enrich` carries raw params so applyPrerenderedI18n can re-format and
 * re-translate with the active locale.
 */
export function renderEnrichment(sentences) {
  if (!sentences?.length) return '';
  const text = sentences
    .map(({ key, params }) => interpolate(en[key], enrichDisplayParams(params, { formatted: true })))
    .join(' ');
  return `      <p class="section-note" data-enrich='${escapeHtml(
    JSON.stringify(sentences),
  )}'>${escapeHtml(text)}</p>\n`;
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
  assets = { appFile: '/assets/app.js', cssFile: '/assets/app.css', workerFile: '/assets/parquet-worker.js' },
  related = null,
  vendorHub = null,
  countryHub = null,
  enrich = null,
  formerHub = null,
  dataUpdated = null, // this page's own last content-change date (YYYY-MM-DD)
}) {
  const canonical = `${site}/${record.prefix}`;
  const colon = colonize(record.prefix);
  const orgName = record.orgName || 'Unknown organization';
  const title = `${colon} (${orgName}) | MAC Address Lookup`;
  const description = truncate(
    `${colon} is a ${record.prefixLen}-bit ${record.blockType} MAC address block registered to ${orgName}` +
      (record.country ? ` (${record.country})` : '') +
      '. Vendor details, address range, randomization checks, and prefix lineage.',
    156,
  );

  // The page describes one IEEE registry record and links dataset downloads,
  // so it is marked up as a Dataset (a CreativeWork subtype, the group Google
  // recommends for date fields). dateModified is the page's own last content
  // change from the page-hash tracker — never the wall clock, and never the
  // IEEE registration date (that describes the data, not the page).
  const jsonLd = JSON.stringify({
    '@context': 'https://schema.org',
    '@type': 'Dataset',
    name: `${colon} MAC address block (${orgName})`,
    url: canonical,
    description,
    ...(dataUpdated ? { dateModified: dataUpdated } : {}),
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
    distribution: [
      {
        '@type': 'DataDownload',
        encodingFormat: 'application/x-ndjson',
        contentUrl: `${site}/data/registry.ndjson`,
      },
      {
        '@type': 'DataDownload',
        encodingFormat: 'application/x-ndjson',
        contentUrl: `${site}/data/lineage.ndjson`,
      },
    ],
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
    <meta property="og:type" content="website" />
    <meta property="og:site_name" content="MAC Address Lookup" />
    <meta property="og:title" content="${escapeHtml(title)}" />
    <meta property="og:description" content="${escapeHtml(description)}" />
    <meta property="og:url" content="${escapeHtml(canonical)}" />
    <meta property="og:image" content="${site}/og-card.png" />
    <meta property="og:image:width" content="1200" />
    <meta property="og:image:height" content="630" />
    <meta property="og:image:alt" content="MAC Address Lookup" />
    <meta name="twitter:card" content="summary_large_image" />
    <link rel="icon" href="/favicon.svg" type="image/svg+xml" />
    <link rel="stylesheet" href="${assets.cssFile}" />
    <script>
      ${THEME_BOOT}
    </script>
    <script>
      // Pre-rendered pages keep English HTML for crawlers; the app swaps
      // translated labels after boot. Provide the decode worker URL early.
      window.__malWorker = '${escapeHtml(assets.workerFile)}';
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
        <a class="wordmark" href="/" data-i18n="nav.brand">MAC Address Lookup</a>
        <div class="header-actions">
          <a class="button button--ghost button--icon" href="/help" data-i18n-title="nav.help" aria-label="Help and documentation" title="Help and documentation">?</a>
          <select id="locale-picker" class="locale-picker" aria-label="Language" data-i18n-aria="a11y.language">
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
        <nav class="breadcrumb" aria-label="Breadcrumb" data-i18n-aria="a11y.breadcrumb">
          <a href="/" data-i18n="nav.brand">MAC Address Lookup</a> <span aria-hidden="true">/</span> <span>${escapeHtml(colon)}</span>
        </nav>
        <section class="hero hero--compact">
          <h1>${escapeHtml(orgName)} <span class="h1-prefix">${escapeHtml(colon)}</span></h1>
          <p class="lede" data-lede="${escapeHtml(JSON.stringify({
            prefix: colon,
            bits: record.prefixLen,
            blockType: record.blockType,
            org: orgName,
            country: record.country ?? null,
          }))}">
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
          data-prefixlen="${escapeHtml(record.prefixLen)}"
          data-blocktype="${escapeHtml(record.blockType)}"
        >
${renderResult(record, lineage, { vendorHub, countryHub, formerHub })}
${renderEnrichment(enrich)}${renderRelated(related, { record, vendorHub })}
        </section>
      </div>
    </main>

    <footer class="site-footer">
      <div class="container">
        <p>
          <span data-i18n="footer.dataSources">Data: IEEE Registration Authority registries; historical changes from</span>
          <a href="https://github.com/runZeroInc/mac-tracker" rel="noopener">runZero mac-tracker</a> <span data-i18n="footer.license">(MIT).</span>
          <span data-i18n="footer.bundled">Bundled software:</span> <a href="https://github.com/hyparam/hyparquet" rel="noopener">hyparquet</a> <span data-i18n="footer.license">(MIT).</span>
        </p>
        <p>
          <span data-i18n="footer.dataNote">All lookups run in your browser, and the addresses you look up are never sent to a server.</span>
          <span data-i18n="footer.refreshed">Data refreshed</span>
          ${
            dataUpdated
              ? `<time class="footer-date" datetime="${escapeHtml(dataUpdated)}">${escapeHtml(dataUpdated)}</time>`
              : `<span id="last-updated" data-i18n="footer.refreshPlaceholder">on the latest deploy</span>`
          }
          <a href="/recent" data-i18n="footer.recent">Latest OUIs</a> ·
          <a href="https://github.com/jasontally/mac-address-lookup" rel="noopener" data-i18n="footer.source">Source on GitHub</a>
        </p>
      </div>
    </footer>
  </body>
</html>
`;
}
