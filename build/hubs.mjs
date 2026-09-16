/**
 * Pre-rendered hub pages (step 2 of docs/thin-content-mitigation.md): one
 * page per multi-block organization (/vendor/<slug>) and one per country
 * (/country/<code>), both carrying the complete data as static tables —
 * no row caps; the whole table ships (static HTML compresses ~10:1 at the
 * edge; sizing in the plan).
 *
 * Grouping uses the same `normalizeOrgName` key as the vendor portfolio
 * stats on result cards, so hub membership can never disagree with them.
 */

import { createHash } from 'node:crypto';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { normalizeOrgName } from './lineage.mjs';
import { escapeHtml, SITE } from './page-template.mjs';
import { slugifyOrg } from '../src/engine/slugs.mjs';
import { countryName } from '../src/engine/countries.mjs';
import { colonize, formatAddresses, formatDate, formatCount } from '../src/ui/format.mjs';

const BOOT = `(function () {
        try {
          var mode = localStorage.getItem('mal.theme');
          if (mode === 'light' || mode === 'dark') document.documentElement.dataset.mode = mode;
        } catch (error) {
          /* storage unavailable; system preference applies */
        }
      })();`;

/**
 * Chunked rendering for very large hub tables (thin-content plan's fallback):
 * rows stay in the HTML — no data removed — but those past the initial batch
 * are hidden synchronously during parse, before first paint, so the browser
 * never lays out 8,881 rows at boot. "Show more" reveals the next batch;
 * without JavaScript the complete table renders as-is.
 */
const HUB_ROW_VIRTUALIZER = `<script>
      (function () {
        var rows = document.querySelectorAll('.hub tbody tr');
        var SHOW = 500;
        var STEP = 1000;
        var total = rows.length;
        if (total <= SHOW) return;
        for (var i = SHOW; i < total; i++) rows[i].style.display = 'none';
        var host = document.querySelector('#hub-rows-note');
        if (!host) return;
        var note = document.createElement('span');
        note.className = 'hub-rows-count';
        var refresh = function () {
          note.textContent = 'Showing the first ' + SHOW + ' of ' + total + '.';
        };
        var button = document.createElement('button');
        button.type = 'button';
        button.className = 'button button--ghost button--small';
        button.setAttribute('data-i18n', 'partial.showMore');
        button.textContent = 'Show more';
        button.addEventListener('click', function () {
          var until = Math.min(total, SHOW + STEP);
          for (var i = SHOW; i < until; i++) rows[i].style.display = '';
          SHOW = until;
          if (SHOW >= total) {
            button.remove();
            note.textContent = '';
          } else {
            refresh();
          }
        });
        refresh();
        host.append(note, ' ', button);
      })();
    </script>`;;

const LOOKUP_FORM = `          <form class="lookup-form" id="lookup-form" novalidate>            <label class="visually-hidden" for="lookup-input" data-i18n="lookup.label">MAC address or OUI prefix</label>
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
          </form>`;

/** Most frequent original spelling of an org name; ties to the smallest spelling. */
export function displayNameOf(nameCounts) {
  return [...nameCounts.entries()].sort(
    (a, b) => (b[1] - a[1]) || (a[0] < b[0] ? -1 : 1),
  )[0][0];
}

/**
 * Assign hub slugs. The first org to claim a bare slug keeps it; later
 * collisions take `-2`, `-3`, … Org names without ASCII fall back to a hash
 * of the normalized key. Deterministic across builds.
 */
export function assignSlugs(orgs) {
  const claims = new Map(); // slug → key
  const ranked = [...orgs].sort((a, b) => (a.key < b.key ? -1 : a.key > b.key ? 1 : 0));
  for (const hub of ranked) {
    let base = slugifyOrg(hub.displayName);
    if (base === '') {
      base = `org-${createHash('sha256').update(hub.key).digest('hex').slice(0, 8)}`;
    }
    let candidate = base;
    let suffix = 1;
    while (claims.has(candidate) && claims.get(candidate) !== hub.key) {
      suffix += 1;
      candidate = `${base}-${suffix}`;
    }
    claims.set(candidate, hub.key);
    hub.slug = candidate;
    hub.url = `/vendor/${candidate}`;
  }
}

/**
 * Group the registry into hub populations.
 * Orgs with a single block get no hub (their prefix page already serves as
 * the org page). Private and empty organizations are excluded, matching
 * page selection. Returns `{ orgs, countries }`, both sorted and sluged.
 */
export function computeHubs(records) {
  const orgs = new Map(); // key → hub entry
  const countries = new Map(); // country code → { code, orgs: Map(key → entry) }

  for (const record of records) {
    const orgKey = normalizeOrgName(record.orgName);
    if (orgKey === '' || record.isPrivate) continue;

    if (!orgs.has(orgKey)) {
      orgs.set(orgKey, {
        key: orgKey,
        nameCounts: new Map(),
        records: [],
        addresses: 0,
        firstSeen: null,
        lastSeen: null,
      });
    }
    const hub = orgs.get(orgKey);
    hub.nameCounts.set(record.orgName, (hub.nameCounts.get(record.orgName) ?? 0) + 1);
    hub.records.push(record);
    hub.addresses += record.addressCount ?? 0;
    if (record.firstSeen) {
      if (!hub.firstSeen || record.firstSeen < hub.firstSeen) hub.firstSeen = record.firstSeen;
      if (!hub.lastSeen || record.firstSeen > hub.lastSeen) hub.lastSeen = record.firstSeen;
    }

    if (record.country) {
      if (!countries.has(record.country)) {
        countries.set(record.country, { code: record.country, orgs: new Map() });
      }
      const countryEntry = countries.get(record.country);
      const orgEntry =
        countryEntry.orgs.get(orgKey) ?? { key: orgKey, nameCounts: new Map(), records: [] };
      orgEntry.nameCounts.set(record.orgName, (orgEntry.nameCounts.get(record.orgName) ?? 0) + 1);
      orgEntry.records.push(record);
      countryEntry.orgs.set(orgKey, orgEntry);
    }
  }

  for (const hub of orgs.values()) {
    hub.blocks = hub.records.length;
    hub.displayName = displayNameOf(hub.nameCounts);
    hub.countryCodes = [
      ...new Set(hub.records.map((record) => record.country).filter(Boolean)),
    ].sort();
    hub.slug = null;
    hub.url = null;
  }
  const multiBlock = [...orgs.values()].filter((hub) => hub.blocks >= 2);
  assignSlugs(multiBlock);
  multiBlock.sort((a, b) => (a.key < b.key ? -1 : a.key > b.key ? 1 : 0));
  const slugByKey = new Map(multiBlock.map((hub) => [hub.key, hub.slug]));

  const countryHubs = [...countries.values()];
  for (const hub of countryHubs) {
    hub.blocks = [...hub.orgs.values()].reduce(
      (sum, entry) => sum + entry.records.length,
      0,
    );
    hub.addresses = [...hub.orgs.values()].reduce(
      (sum, entry) =>
        sum +
        entry.records.reduce((acc, record) => acc + (record.addressCount ?? 0), 0),
      0,
    );
    for (const entry of hub.orgs.values()) {
      entry.blocks = entry.records.length;
      entry.addresses = entry.records.reduce((s, record) => s + (record.addressCount ?? 0), 0);
      entry.displayName = displayNameOf(entry.nameCounts);
      entry.firstSeen = entry.records.reduce(
        (min, record) => (record.firstSeen && (!min || record.firstSeen < min) ? record.firstSeen : min),
        null,
      );
      entry.slug = slugByKey.get(entry.key) ?? null;
    }
  }
  countryHubs.sort((a, b) => (a.code < b.code ? -1 : a.code > b.code ? 1 : 0));

  return { orgs: multiBlock, countries: countryHubs };
}

function jsonLdScript(node) {
  return `    <script type="application/ld+json">\n      ${node}\n    </script>\n`;
}

function breadcrumbLd(items) {
  return JSON.stringify({
    '@context': 'https://schema.org',
    '@type': 'BreadcrumbList',
    itemListElement: items.map(({ name, url }, index) => ({
      '@type': 'ListItem',
      position: index + 1,
      name,
      ...(url ? { item: url } : {}),
    })),
  }).replace(/</g, '\\u003c');
}

function renderPage({ title, description, canonical, breadcrumbLabel, heading, ledeHtml, body, assets, jsonLdNodes = [] }) {
  const breadcrumb = breadcrumbLd([
    { name: 'MAC Address Lookup', url: `${SITE}/` },
    { name: breadcrumbLabel, url: canonical },
  ]);
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
    <link rel="alternate" type="text/markdown" href="/help.md" />
    <link rel="describedby" type="text/plain" href="/llms.txt" />
    <link rel="icon" href="/favicon.svg" type="image/svg+xml" />
    <link rel="stylesheet" href="${assets.cssFile}" />
    <script>
      ${BOOT}
      window.__malWorker = '${escapeHtml(assets.workerFile)}';
    </script>
${jsonLdNodes.map(jsonLdScript).join('')}${jsonLdScript(breadcrumb)}    <script type="module" src="${assets.appFile}"></script>
  </head>
  <body data-static-page="true">
    <a class="skip-link" href="#main" data-i18n="a11y.skip">Skip to content</a>

    <header class="site-header">
      <div class="container">
        <a class="wordmark" href="/">MAC Address Lookup</a>
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
          <a href="/">MAC Address Lookup</a> <span aria-hidden="true">/</span> <span>${escapeHtml(breadcrumbLabel)}</span>
        </nav>
        <section class="hero hero--compact">
          <h1>${heading}</h1>
          ${ledeHtml}
${LOOKUP_FORM}
        </section>
        <article class="hub">
${body}
        </article>
        <p class="section-note" id="hub-rows-note"></p>
        <p class="section-note">Complete as of the current IEEE registry deploy. Dates are when each registration was first observed in public data, not legal assignment dates.</p>
${HUB_ROW_VIRTUALIZER}
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
          <span data-i18n="footer.dataNote">All lookups run in your browser — the addresses you look up are never sent to a server.</span>
          <a href="/help" data-i18n="footer.help">Help &amp; documentation</a> ·
          <a href="https://github.com/jasontally/mac-address-lookup" rel="noopener" data-i18n="footer.source">Source on GitHub</a>
        </p>
      </div>
    </footer>
  </body>
</html>
`;
}

export function renderOrgHubPage({ hub, assets, site = SITE }) {
  const canonical = `${site}${hub.url}`;
  const title = `${hub.displayName} MAC address blocks | MAC Address Lookup`;
  const suffix =
    hub.lastSeen && hub.lastSeen !== hub.firstSeen
      ? `, most recently ${formatDate(hub.lastSeen, 'en')}`
      : '';
  const description =
    `${hub.blocks} MAC address blocks registered to ${hub.displayName}, covering ` +
    `${formatAddresses(hub.addresses, 'en')} addresses. Complete block list with countries and registration dates.`;
  const heading = `${escapeHtml(hub.displayName)} MAC address blocks`;
  const ledeHtml =
    `          <p class="lede">The IEEE registry carries ${hub.blocks} blocks registered to ` +
    `${escapeHtml(hub.displayName)} — together ${escapeHtml(formatAddresses(hub.addresses, 'en'))} addresses, ` +
    `first observed ${escapeHtml(formatDate(hub.firstSeen, 'en') || 'before tracked records')}${escapeHtml(suffix)}.</p>` +
    (hub.countryCodes.length > 0
      ? `\n          <p class="hub-countries">Registered in ${countryLinks(hub.countryCodes)}.</p>`
      : '');

  const rows = hub.records
    .map(
      (record) =>
        `            <tr>` +
        `<td class="mono"><a href="/${escapeHtml(record.prefix)}">${escapeHtml(colonize(record.prefix))}</a></td>` +
        `<td>${escapeHtml(record.blockType)}</td>` +
        `<td>${escapeHtml(formatAddresses(record.addressCount, 'en'))}</td>` +
        `<td>${escapeHtml(record.country ?? '—')}</td>` +
        `<td>${escapeHtml(formatDate(record.firstSeen, 'en') || '—')}</td>` +
        `</tr>`,
    )
    .join('\n');

  const searchHref = `/${encodeURIComponent(hub.displayName)}`;
  const body = `        <div class="table-wrap">
          <table class="data-table">
            <thead>
              <tr>
                <th scope="col" data-i18n="table.prefix">Prefix</th>
                <th scope="col" data-i18n="table.block">Block</th>
                <th scope="col" data-i18n="table.addresses">Addresses</th>
                <th scope="col" data-i18n="detail.country">Country</th>
                <th scope="col" data-i18n="detail.firstRegistered">First registered</th>
              </tr>
            </thead>
            <tbody>
${rows}
            </tbody>
          </table>
        </div>
      <p class="section-note">Every block registered to ${escapeHtml(hub.displayName)} in the IEEE registries, complete. <a href="${escapeHtml(searchHref)}">Free-text search</a> also matches former owners.</p>`;

  const collectionLd = JSON.stringify({
    '@context': 'https://schema.org',
    '@type': 'CollectionPage',
    name: title,
    url: canonical,
    isPartOf: { '@type': 'WebSite', name: 'MAC Address Lookup', url: `${SITE}/` },
    about: { '@type': 'Organization', name: hub.displayName },
  }).replace(/</g, '\\u003c');

  return renderPage({
    title,
    description,
    canonical,
    breadcrumbLabel: hub.displayName,
    heading,
    ledeHtml,
    body: `${body}\n`,
    assets,
    jsonLdNodes: [collectionLd],
  });
}

export function renderCountryHubPage({ hub, assets, site = SITE }) {
  const canonical = `${site}/country/${hub.code.toLowerCase()}`;
  const name = displayNameForCountry(hub.code);
  const title = `${name} MAC address blocks | MAC Address Lookup`;
  const description =
    `${hub.blocks} MAC address blocks registered to organizations in ${name}, covering ` +
    `${formatAddresses(hub.addresses, 'en')} addresses.`;
  const heading = `${escapeHtml(name)} MAC address blocks`;
  const ledeHtml =
    `          <p class="lede">The IEEE registry carries ${hub.blocks} blocks with registration ` +
    `addresses in ${escapeHtml(name)} — together ${escapeHtml(formatAddresses(hub.addresses, 'en'))} ` +
    `addresses across ${hub.orgs.size} organizations.</p>`;

  const ranked = [...hub.orgs.values()].sort(
    (a, b) => b.addresses - a.addresses || (a.key < b.key ? -1 : 1),
  );

  const rows = ranked
    .map(
      (entry) =>
        `            <tr>` +
        `<td class="org">${orgAnchor(entry)}</td>` +
        `<td>${escapeHtml(formatCount(entry.blocks, 'en'))}</td>` +
        `<td>${escapeHtml(formatAddresses(entry.addresses, 'en'))}</td>` +
        `<td>${escapeHtml(formatDate(entry.firstSeen, 'en') || '—')}</td>` +
        `</tr>`,
    )
    .join('\n');

  const body = `        <div class="table-wrap">
          <table class="data-table">
            <thead>
              <tr>
                <th scope="col" data-i18n="table.org">Organization</th>
                <th scope="col" data-i18n="table.blocks">Blocks</th>
                <th scope="col" data-i18n="table.addresses">Addresses</th>
                <th scope="col" data-i18n="detail.firstRegistered">First registered</th>
              </tr>
            </thead>
            <tbody>
${rows}
            </tbody>
          </table>
        </div>
      <p class="section-note">Every organization with blocks registered in ${escapeHtml(name)}, sorted by total address space.</p>`;

  const collectionLd = JSON.stringify({
    '@context': 'https://schema.org',
    '@type': 'CollectionPage',
    name: title,
    url: canonical,
    isPartOf: { '@type': 'WebSite', name: 'MAC Address Lookup', url: `${SITE}/` },
  }).replace(/</g, '\\u003c');

  return renderPage({
    title,
    description,
    canonical,
    breadcrumbLabel: name,
    heading,
    ledeHtml,
    body: `${body}\n`,
    assets,
    jsonLdNodes: [collectionLd],
  });
}

/** Org display name rendered as a link to the org hub when one exists. */
function orgAnchor(entry) {
  const label = displayNameOf(entry.nameCounts);
  return entry.slug
    ? `<a href="/vendor/${escapeHtml(entry.slug)}">${escapeHtml(label)}</a>`
    : escapeHtml(label);
}

function countryLinks(codes) {
  return codes
    .map((code) => `<a href="/country/${escapeHtml(code.toLowerCase())}">${escapeHtml(code)}</a>`)
    .join(' · ');
}

function displayNameForCountry(code) {
  return countryName(code) ?? code;
}

/**
 * Write all hub pages and return relative URL arrays for the sitemap plus
 * the data, for wiring vendor hub links into prefix pages.
 */
export async function writeHubPages({ hubData, outDir, assets }) {
  const vendorDir = path.join(outDir, 'vendor');
  const countryDir = path.join(outDir, 'country');
  await mkdir(vendorDir, { recursive: true });
  await mkdir(countryDir, { recursive: true });

  const vendorUrls = [];
  for (const hub of hubData.orgs) {
    await writeFile(path.join(vendorDir, `${hub.slug}.html`), renderOrgHubPage({ hub, assets }));
    vendorUrls.push(hub.url);
  }

  const countryUrls = [];
  for (const hub of hubData.countries) {
    const file = `${hub.code.toLowerCase()}.html`;
    await writeFile(
      path.join(countryDir, file),
      renderCountryHubPage({ hub, assets }),
    );
    countryUrls.push(`/country/${hub.code.toLowerCase()}`);
  }

  return { vendorUrls, countryUrls };
}
