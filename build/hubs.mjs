/**
 * Pre-rendered hub pages (step 2 of docs/thin-content-mitigation.md): one
 * page per multi-block organization (/vendor/<slug>), one per country
 * (/country/<code>), and the /country rollup index over them, all carrying
 * their complete data as static tables - no row caps; the whole table ships
 * (static HTML compresses ~10:1 at the edge; sizing in the plan).
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
 * rows past the initial batch ship with `hidden` in the source HTML - the
 * complete data remains in the document for non-JS crawlers, but the browser
 * never lays out 8,881 rows at boot. A tiny inline script adds the "show
 * more" reveal; without JavaScript the note tells the reader, and the full
 * table remains in the page source either way.
 */
const HUB_ROWS_SHOWN = 500;
const HUB_ROWS_STEP = 1000;

/**
 * data-i18n-params attribute: client `applyDom` re-interpolates through
 * the active locale table. Values are engine-derived (counts, org names),
 * so JSON needs only entity escaping for the attribute literally.
 */
function paramsAttr(params) {
  const json = JSON.stringify(params)
    .replace(/&/g, '&amp;')
    .replace(/'/g, '&#39;')
    .replace(/</g, '&lt;');
  return `data-i18n-params='${json}'`;
}

/** Rows beyond the initial batch get `hidden`; caller tracks no state. */
export function hubRowHidden(index) {
  return index >= HUB_ROWS_SHOWN;
}

const HUB_ROW_VIRTUALIZER = `<script>
      (function () {
        var rows = document.querySelectorAll('.hub tbody tr');
        var SHOW = ${HUB_ROWS_SHOWN};
        var STEP = ${HUB_ROWS_STEP};
        var total = rows.length;
        if (total <= SHOW) return;
        var host = document.querySelector('#hub-rows-note');
        if (!host) return;
        var button = document.createElement('button');
        button.type = 'button';
        button.className = 'button button--ghost button--small';
        button.setAttribute('data-i18n', 'partial.showMore');
        button.textContent = 'Show more';
        button.addEventListener('click', function () {
          var until = Math.min(total, SHOW + STEP);
          for (var i = 0; i < until; i++) rows[i].removeAttribute('hidden');
          SHOW = until;
          // The static bundle (data-i18n-params aware) formats the count via
          // the active locale; the inline script only reports the state.
          host.dispatchEvent(new CustomEvent('hub-rows', { detail: { shown: SHOW, total: total } }));
          if (SHOW >= total) button.remove();
        });
        host.append(' ', button);
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
export function assignSlugs(orgs, { urlPrefix = '/vendor/' } = {}) {
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
    hub.url = `${urlPrefix}${candidate}`;
  }
}

/**
 * Group the lineage history by every organization that no longer holds a
 * prefix: all event owners except each prefix's final one. `vendors` (an org
 * hub Map, key → hub with slug/displayName) links the current owner's vendor
 * page. Returns a list sorted by key, slugged under /former/, plus a reverse
 * index for vendor hubs.
 */
export function computeFormerHubs(lineageEntries, { vendors = new Map() } = {}) {
  const formers = new Map(); // former key → hub entry

  for (const entry of lineageEntries) {
    const events = entry.events ?? [];
    if (events.length < 2) continue;
    const final = events[events.length - 1];
    const finalName = String(final?.orgName ?? '').trim();
    const finalKey = normalizeOrgName(finalName);
    for (let i = 0; i < events.length - 1; i++) {
      const name = String(events[i]?.orgName ?? '').trim();
      if (!name) continue;
      const key = normalizeOrgName(name);
      if (!key || key === finalKey) continue;

      if (!formers.has(key)) {
        formers.set(key, {
          key,
          nameCounts: new Map(),
          prefixes: new Map(),
          owners: new Map(), // current-owner key → { nameCounts: Map }
        });
      }
      const hub = formers.get(key);
      hub.nameCounts.set(name, (hub.nameCounts.get(name) ?? 0) + 1);
      // The same former owner can appear twice in one prefix's history only
      // when it lost and re-acquired the block; the earliest date wins.
      if (!hub.prefixes.has(entry.prefix)) {
        hub.prefixes.set(entry.prefix, {
          prefix: entry.prefix,
          firstDate: events[i]?.date ?? null,
          firstSeen: entry.firstSeen ?? null,
          currentOwner: finalName,
        });
      }
    }
  }

  const hubs = [];
  for (const hub of formers.values()) {
    if (hub.prefixes.size < 2) continue;
    hub.blocks = hub.prefixes.size;
    hub.displayName = displayNameOf(hub.nameCounts);
    // Roll up who holds the prefix today; rows link the owner's vendor page.
    for (const instance of hub.prefixes.values()) {
      const ownerKey = normalizeOrgName(instance.currentOwner);
      if (!ownerKey) continue;
      if (!hub.owners.has(ownerKey)) {
        hub.owners.set(ownerKey, { nameCounts: new Map() });
      }
      const owner = hub.owners.get(ownerKey);
      owner.nameCounts.set(instance.currentOwner, (owner.nameCounts.get(instance.currentOwner) ?? 0) + 1);
      const vendor = vendors.get(ownerKey);
      owner.slug = vendor?.slug ?? null;
      owner.display = vendor?.displayName ?? instance.currentOwner;
      instance.currentSlug = owner.slug;
      instance.currentDisplay = owner.display;
    }
    hubs.push(hub);
  }

  assignSlugs(hubs, { urlPrefix: '/former/' });
  hubs.sort((a, b) => (a.key < b.key ? -1 : a.key > b.key ? 1 : 0));

  // Reverse index for vendor hubs: former-owner pages a vendor's portfolio absorbed.
  const absorbedByVendor = new Map();
  for (const hub of hubs) {
    for (const [ownerKey] of hub.owners) {
      if (!(vendors.get(ownerKey)?.slug)) continue;
      if (!absorbedByVendor.has(ownerKey)) absorbedByVendor.set(ownerKey, []);
      absorbedByVendor.get(ownerKey).push({
        slug: hub.slug,
        displayName: hub.displayName,
        count: countOwnerBlocks(hub, ownerKey),
      });
    }
  }
  for (const list of absorbedByVendor.values()) {
    list.sort((a, b) => b.count - a.count || (a.displayName < b.displayName ? -1 : 1));
  }

  const byKey = new Map(hubs.map((hub) => [hub.key, hub]));
  return { formers: hubs, byKey, absorbedByVendor };
}

function countOwnerBlocks(hub, ownerKey) {
  let count = 0;
  for (const instance of hub.prefixes.values()) {
    if (normalizeOrgName(instance.currentOwner) === ownerKey) count += 1;
  }
  return count;
}

/**
 * Orgs with a single block get no hub (their prefix page already serves as
 * the org page, and country pages link straight to it). Private and empty
 * organizations are excluded, matching page selection. Returns
 * `{ orgs, countries }`, both sorted and sluged.
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

function renderPage({ title, titleTag = null, description, canonical, breadcrumbLabel, breadcrumbKey = null, breadcrumbParent = null, heading, ledeHtml, body, assets, jsonLdNodes = [], totalRows = 0, dataUpdated = null, site = SITE, countriesLink = true }) {
  // Breadcrumbs are Home / [index /] this page: country pages sit under the
  // /country rollup, which gives that index its internal links.
  const breadcrumb = breadcrumbLd([
    { name: 'MAC Address Lookup', url: `${SITE}/` },
    ...(breadcrumbParent ? [{ name: breadcrumbParent.name, url: breadcrumbParent.url }] : []),
    { name: breadcrumbLabel, url: canonical },
  ]);
  const breadcrumbNav =
    `          <a href="/" data-i18n="nav.brand">MAC Address Lookup</a> <span aria-hidden="true">/</span> ` +
    (breadcrumbParent
      ? `<a href="${escapeHtml(breadcrumbParent.url)}"${
          breadcrumbParent.key ? ` data-i18n="${breadcrumbParent.key}"` : ''
        }>${escapeHtml(breadcrumbParent.name)}</a> <span aria-hidden="true">/</span> `
      : '') +
    `<span${breadcrumbKey ? ` data-i18n="${breadcrumbKey}"` : ''}>${escapeHtml(breadcrumbLabel)}</span>`;
  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    ${titleTag ?? `<title>${escapeHtml(title)}</title>`}
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
    <link rel="alternate" type="text/markdown" href="/help.md" />
    <link rel="describedby" type="text/plain" href="/llms.txt" />
    <link rel="icon" href="/favicon.svg" type="image/svg+xml" />
    <link rel="stylesheet" href="${assets.cssFile}" />
    <script>
      ${BOOT}
      window.__malWorker = '${escapeHtml(assets.workerFile)}';
    </script>
${jsonLdNodes.map(jsonLdScript).join('')}${jsonLdScript(breadcrumb)}    <script type="module" src="${assets.staticFile ?? assets.appFile}"></script>
  </head>
  <body data-static-page="true">
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
${breadcrumbNav}
        </nav>
        <section class="hero hero--compact">
          <h1>${heading}</h1>
          ${ledeHtml}
${LOOKUP_FORM}
        </section>
        <article class="hub">
${body}
        </article>
        <p class="section-note" id="hub-rows-note">${
          totalRows > HUB_ROWS_SHOWN
            ? `<span class="hub-rows-count" data-i18n="hub.rowsCount" ${paramsAttr({ shown: HUB_ROWS_SHOWN, total: totalRows })}>Showing the first ${HUB_ROWS_SHOWN} of ${totalRows}</span> · <span data-i18n="hub.rowsTail">the rest is in this page's source HTML.</span>`
            : ''
        }</p>
        <p class="section-note" data-i18n="hub.completeNote">Complete as of the current IEEE registry deploy. Dates are when each registration was first observed in public data, not legal assignment dates.</p>
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
          <span data-i18n="footer.dataNote">All lookups run in your browser, and the addresses you look up are never sent to a server.</span>
          <span data-i18n="footer.refreshed">Data refreshed</span>
          ${
            dataUpdated
              ? `<time class="footer-date" datetime="${escapeHtml(dataUpdated)}">${escapeHtml(dataUpdated)}</time>`
              : ''
          }
          ${countriesLink ? `<a href="/country" data-i18n="footer.countries">Countries</a> ·\n          ` : ''}<a href="/help" data-i18n="footer.help">Help &amp; documentation</a> ·
          <a href="https://github.com/jasontally/mac-address-lookup" rel="noopener" data-i18n="footer.source">Source on GitHub</a>
        </p>
      </div>
    </footer>
  </body>
</html>
`;
}

/**
 * Former-owner hub: an organization that no longer holds any of the prefixes
 * it was once registered to. Every row states what happened to the block,
 * and the lede states the current owner(s) - including full acquisitions
 * ("X took over all of them"), the takeover case this page class exists for.
 */
export function renderFormerHubPage({ hub, recordsByPrefix = new Map(), assets, site = SITE, dataUpdated = null }) {
  const canonical = `${site}/former/${hub.slug}`;
  const title = `Former ${hub.displayName} MAC address blocks | MAC Address Lookup`;
  const description =
    `${hub.blocks} MAC address blocks were once registered to ${hub.displayName}; ` +
    `each has been renamed, reassigned, or absorbed. Complete table with what happened to every block.`;
  const heading =
    `<span data-i18n="hub.h1.former" ${paramsAttr({ org: hub.displayName })}>` +
    `Former ${escapeHtml(hub.displayName)} MAC address blocks</span>`;
  const titleTag =
    `<title data-i18n="title.formerHub" ${paramsAttr({ org: hub.displayName })}>${escapeHtml(title)}</title>`;

  const owners = [...hub.owners.entries()].sort(
    (a, b) => ownerWeight(b[1]) - ownerWeight(a[1]) || (a[0] < b[0] ? -1 : 1),
  );
  const sole = owners.length === 1 ? owners[0] : null;
  const soleDisplay = sole ? (sole[1].display ?? displayNameOf(sole[1].nameCounts)) : null;

  let takeoverHtml;
  if (sole) {
    takeoverHtml =
      `<span data-i18n="hub.former.ownedAll" ${paramsAttr({ blocks: hub.blocks, owner: soleDisplay })}>All ${hub.blocks} blocks are now registered to ${escapeHtml(soleDisplay)}.</span> ` +
      (sole[1].slug
        ? `<a href="/vendor/${escapeHtml(sole[1].slug)}">${escapeHtml(soleDisplay)}</a> <span data-i18n="hub.former.tookAll">took over all of them.</span>`
        : '');
  } else {
    takeoverHtml =
      `<span data-i18n="hub.former.mixedCount" ${paramsAttr({ count: owners.length })}>They are now registered across ${owners.length} organizations: </span>` +
      owners
        .map(([key, owner]) => escapeHtml(displayNameOf(owner.nameCounts)) + ' × ' + ownerWeight(owner))
        .join(', ') +
      '.';
  }
  const ledeHtml =
    `          <p class="lede"><span data-i18n="hub.former.lede" ${paramsAttr({ blocks: hub.blocks, org: hub.displayName })}>The IEEE registry once carried ${hub.blocks} blocks registered to ` +
    `${escapeHtml(hub.displayName)}.</span> ${takeoverHtml}</p>`;

  const rows = [...hub.prefixes.values()]
    .sort((a, b) => (a.prefix < b.prefix ? -1 : a.prefix > b.prefix ? 1 : 0))
    .map((instance, index) => {
      const record = recordsByPrefix.get(instance.prefix);
      const blockLabel = record ? record.blockType : '-';
      const addresses = record ? formatAddresses(record.addressCount, 'en') : '-';
      const ownerHtml = instance.currentSlug
        ? `<a href="/vendor/${escapeHtml(instance.currentSlug)}">${escapeHtml(instance.currentDisplay)}</a>`
        : escapeHtml(instance.currentDisplay || '-');
      return (
        `            <tr${hubRowHidden(index) ? ' hidden' : ''}>` +
        `<td class="mono"><a href="/${escapeHtml(instance.prefix)}">${escapeHtml(colonize(instance.prefix))}</a></td>` +
        `<td>${escapeHtml(blockLabel)}</td>` +
        `<td>${escapeHtml(addresses)}</td>` +
        `<td>${escapeHtml(formatDate(instance.firstDate, 'en') || '-')}</td>` +
        `<td class="org">${ownerHtml}</td>` +
        `</tr>`
      );
    })
    .join('\n');

  const body = `        <div class="table-wrap">
          <table class="data-table">
            <thead>
              <tr>
                <th scope="col" data-i18n="table.prefix">Prefix</th>
                <th scope="col" data-i18n="table.block">Block</th>
                <th scope="col" data-i18n="table.addresses">Addresses</th>
                <th scope="col" data-i18n="detail.firstRegistered">First registered</th>
                <th scope="col" data-i18n="table.org">Organization</th>
              </tr>
            </thead>
            <tbody>
${rows}
            </tbody>
          </table>
        </div>`;

  const collectionLd = JSON.stringify({
    '@context': 'https://schema.org',
    '@type': 'CollectionPage',
    name: title,
    url: canonical,
    ...(dataUpdated ? { dateModified: dataUpdated } : {}),
    isPartOf: { '@type': 'WebSite', name: 'MAC Address Lookup', url: `${SITE}/` },
    about: { '@type': 'Organization', name: hub.displayName },
  }).replace(/</g, '\\u003c');

  return renderPage({
    title,
    titleTag,
    description,
    canonical,
    breadcrumbLabel: hub.displayName,
    heading,
    ledeHtml,
    body: `${body}\n`,
    assets,
    jsonLdNodes: [collectionLd],
    totalRows: hub.blocks,
    dataUpdated,
    site,
  });
}

function ownerWeight(owner) {
  return [...owner.nameCounts.values()].reduce((sum, count) => sum + count, 0);
}
export function renderOrgHubPage({ hub, assets, site = SITE, absorbed = [], dataUpdated = null }) {
  const canonical = `${site}${hub.url}`;
  const title = `${hub.displayName} MAC address blocks | MAC Address Lookup`;
  const suffix =
    hub.lastSeen && hub.lastSeen !== hub.firstSeen
      ? `, most recently ${formatDate(hub.lastSeen, 'en')}`
      : '';
  const description =
    `${hub.blocks} MAC address blocks registered to ${hub.displayName}, covering ` +
    `${formatAddresses(hub.addresses, 'en')} addresses. Complete block list with countries and registration dates.`;
  const heading =
    `<span data-i18n="hub.h1.vendor" ${paramsAttr({ org: hub.displayName })}>` +
    `${escapeHtml(hub.displayName)} MAC address blocks</span>`;
  const titleTag =
    `<title data-i18n="title.vendorHub" ${paramsAttr({ org: hub.displayName })}>${escapeHtml(title)}</title>`;
  const firstParam = hub.firstSeen ?? 'before tracked records';
  const ledeKey = hub.lastSeen && hub.lastSeen !== hub.firstSeen ? 'hub.vendor.ledeLatest' : 'hub.vendor.lede';
  const ledeParams = { blocks: hub.blocks, org: hub.displayName, addresses: hub.addresses, first: firstParam };
  if (ledeKey === 'hub.vendor.ledeLatest') ledeParams.date = hub.lastSeen;
  const ledeHtml =
    `          <p class="lede" data-i18n="${ledeKey}" ${paramsAttr(ledeParams)}>The IEEE registry carries ${hub.blocks} blocks registered to ` +
    `${escapeHtml(hub.displayName)}, together ${escapeHtml(formatAddresses(hub.addresses, 'en'))} addresses, ` +
    `first observed ${escapeHtml(formatDate(hub.firstSeen, 'en') || 'before tracked records')}${escapeHtml(suffix)}.</p>` +
    (hub.countryCodes.length > 0
      ? `\n          <p class="hub-countries"><span data-i18n="hub.startedIn">Registered in</span> ${countryLinks(hub.countryCodes)}.</p>`
      : '') +
    (absorbed.length > 0
      ? `\n          <p class="hub-countries"><span data-i18n="hub.absorbedFrom">Its portfolio also includes blocks acquired from</span> ${absorbedListLink(absorbed)}.</p>`
      : '');

  const rows = hub.records
    .map(
      (record, index) =>
        `            <tr${hubRowHidden(index) ? ' hidden' : ''}>` +
        `<td class="mono"><a href="/${escapeHtml(record.prefix)}">${escapeHtml(colonize(record.prefix))}</a></td>` +
        `<td>${escapeHtml(record.blockType)}</td>` +
        `<td>${escapeHtml(formatAddresses(record.addressCount, 'en'))}</td>` +
        `<td>${escapeHtml(record.country ?? '-')}</td>` +
        `<td>${escapeHtml(formatDate(record.firstSeen, 'en') || '-')}</td>` +
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
      <p class="section-note"><span data-i18n="hub.vendor.caption" ${paramsAttr({ org: hub.displayName })}>Every block registered to ${escapeHtml(hub.displayName)} in the IEEE registries, complete.</span> <a href="${escapeHtml(searchHref)}" data-i18n="hub.search.link">Free-text search</a> <span data-i18n="hub.search.tail">also matches former owners.</span></p>`;

  const collectionLd = JSON.stringify({
    '@context': 'https://schema.org',
    '@type': 'CollectionPage',
    name: title,
    url: canonical,
    ...(dataUpdated ? { dateModified: dataUpdated } : {}),
    isPartOf: { '@type': 'WebSite', name: 'MAC Address Lookup', url: `${SITE}/` },
    about: { '@type': 'Organization', name: hub.displayName },
  }).replace(/</g, '\\u003c');

  return renderPage({
    title,
    titleTag,
    description,
    canonical,
    breadcrumbLabel: hub.displayName,
    heading,
    ledeHtml,
    body: `${body}\n`,
    assets,
    jsonLdNodes: [collectionLd],
    totalRows: hub.blocks,
    dataUpdated,
    site,
  });
}

export function renderCountryHubPage({ hub, assets, site = SITE, dataUpdated = null, selectedPrefixes = null }) {
  const canonical = `${site}/country/${hub.code.toLowerCase()}`;
  const name = displayNameForCountry(hub.code);
  const title = `${name} MAC address blocks | MAC Address Lookup`;
  const description =
    `${hub.blocks} MAC address blocks registered to organizations in ${name}, covering ` +
    `${formatAddresses(hub.addresses, 'en')} addresses.`;
  const heading =
    `<span data-i18n="hub.h1.country" ${paramsAttr({ country: name })}>` +
    `${escapeHtml(name)} MAC address blocks</span>`;
  const titleTag =
    `<title data-i18n="title.countryHub" ${paramsAttr({ country: name })}>${escapeHtml(title)}</title>`;
  const ledeHtml =
    `          <p class="lede" data-i18n="hub.country.lede" ${paramsAttr({ blocks: hub.blocks, country: name, addresses: hub.addresses, count: hub.orgs.size })}>The IEEE registry carries ${hub.blocks} blocks with registration ` +
    `addresses in ${escapeHtml(name)}, together ${escapeHtml(formatAddresses(hub.addresses, 'en'))} ` +
    `addresses across ${hub.orgs.size} organizations.</p>`;

  const ranked = [...hub.orgs.values()].sort(
    (a, b) => b.addresses - a.addresses || (a.key < b.key ? -1 : 1),
  );

  const rows = ranked
    .map(
      (entry, index) =>
        `            <tr${hubRowHidden(index) ? ' hidden' : ''}>` +
        `<td class="org">${orgAnchor(entry, selectedPrefixes)}</td>` +
        `<td>${escapeHtml(formatCount(entry.blocks, 'en'))}</td>` +
        `<td>${escapeHtml(formatAddresses(entry.addresses, 'en'))}</td>` +
        `<td>${escapeHtml(formatDate(entry.firstSeen, 'en') || '-')}</td>` +
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
      <p class="section-note"><span data-i18n="hub.country.caption" ${paramsAttr({ country: name })}>Every organization with blocks registered in ${escapeHtml(name)}, sorted by total address space.</span></p>`;

  const collectionLd = JSON.stringify({
    '@context': 'https://schema.org',
    '@type': 'CollectionPage',
    name: title,
    url: canonical,
    ...(dataUpdated ? { dateModified: dataUpdated } : {}),
    isPartOf: { '@type': 'WebSite', name: 'MAC Address Lookup', url: `${SITE}/` },
  }).replace(/</g, '\\u003c');

  return renderPage({
    title,
    description,
    canonical,
    breadcrumbLabel: name,
    // Every country page links the rollup index above it in the breadcrumb.
    breadcrumbParent: { name: 'All countries', url: `${site}/country`, key: 'hub.countries.all' },
    titleTag,
    heading,
    ledeHtml,
    body: `${body}\n`,
    assets,
    jsonLdNodes: [collectionLd],
    totalRows: ranked.length,
    dataUpdated,
  });
}

/**
 * Country index (`/country`): the rollup over every country hub - one row per
 * country with organization, block, and address totals, sorted by address
 * space, each row linking the country's own page. The sitemap's `country`
 * scope leads with it, and the country pages' breadcrumbs point back here.
 */
export function renderCountryIndexPage({ hubData, assets, site = SITE, dataUpdated = null }) {
  const canonical = `${site}/country`;
  const countries = [...hubData.countries].sort(
    (a, b) => b.addresses - a.addresses || (a.code < b.code ? -1 : 1),
  );
  const blocks = countries.reduce((sum, hub) => sum + hub.blocks, 0);
  const addresses = countries.reduce((sum, hub) => sum + hub.addresses, 0);
  // An organization registered in two countries appears on both country pages,
  // so this counts distinct organizations, not the sum of the column.
  const orgKeys = new Set();
  for (const hub of countries) for (const key of hub.orgs.keys()) orgKeys.add(key);
  const orgs = orgKeys.size;

  const title = 'MAC address blocks by country | MAC Address Lookup';
  const description =
    `${countries.length} countries carry IEEE-registered MAC address blocks: ` +
    `${formatCount(blocks, 'en')} blocks covering ${formatAddresses(addresses, 'en')} addresses ` +
    `across ${formatCount(orgs, 'en')} organizations. Totals per country, each linking its full page.`;
  const titleTag = `<title data-i18n="title.countries">${escapeHtml(title)}</title>`;
  const heading =
    `<span data-i18n="hub.h1.countries">MAC address blocks by country</span>`;
  const ledeHtml =
    `          <p class="lede" data-i18n="hub.countries.lede" ${paramsAttr({ countries: countries.length, blocks, addresses, orgs })}>` +
    `The IEEE registry carries ${escapeHtml(formatCount(blocks, 'en'))} blocks with registration ` +
    `addresses in ${escapeHtml(formatCount(countries.length, 'en'))} countries, together ` +
    `${escapeHtml(formatAddresses(addresses, 'en'))} addresses across ` +
    `${escapeHtml(formatCount(orgs, 'en'))} organizations.</p>`;

  const rows = countries
    .map(
      (hub, index) =>
        `            <tr${hubRowHidden(index) ? ' hidden' : ''}>` +
        `<td class="org"><a href="/country/${escapeHtml(hub.code.toLowerCase())}">${escapeHtml(displayNameForCountry(hub.code))}</a></td>` +
        `<td class="mono">${escapeHtml(hub.code)}</td>` +
        `<td>${escapeHtml(formatCount(hub.orgs.size, 'en'))}</td>` +
        `<td>${escapeHtml(formatCount(hub.blocks, 'en'))}</td>` +
        `<td>${escapeHtml(formatAddresses(hub.addresses, 'en'))}</td>` +
        `</tr>`,
    )
    .join('\n');

  const body = `        <div class="table-wrap">
          <table class="data-table">
            <thead>
              <tr>
                <th scope="col" data-i18n="detail.country">Country</th>
                <th scope="col" data-i18n="table.iso">ISO</th>
                <th scope="col" data-i18n="table.org">Organization</th>
                <th scope="col" data-i18n="table.blocks">Blocks</th>
                <th scope="col" data-i18n="table.addresses">Addresses</th>
              </tr>
            </thead>
            <tbody>
${rows}
            </tbody>
          </table>
        </div>
      <p class="section-note"><span data-i18n="hub.countries.caption">Every country with at least one registered MAC address block, with organization, block, and address totals, sorted by total address space.</span></p>`;

  const collectionLd = JSON.stringify({
    '@context': 'https://schema.org',
    '@type': 'CollectionPage',
    name: title,
    url: canonical,
    ...(dataUpdated ? { dateModified: dataUpdated } : {}),
    isPartOf: { '@type': 'WebSite', name: 'MAC Address Lookup', url: `${SITE}/` },
  }).replace(/</g, '\\u003c');

  return renderPage({
    title,
    titleTag,
    description,
    canonical,
    breadcrumbLabel: 'All countries',
    breadcrumbKey: 'hub.countries.all',
    heading,
    ledeHtml,
    body: `${body}\n`,
    assets,
    jsonLdNodes: [collectionLd],
    totalRows: countries.length,
    dataUpdated,
    site,
    countriesLink: false, // no self-link in the footer
  });
}

/**
 * Org display name rendered as a link to that org's page: the org hub when
 * the org has one (≥ 2 blocks), otherwise the pre-rendered page of its only
 * block - so every row on a country page is a link, and every target is a
 * pre-rendered page (the cross-cutting rule in docs/thin-content-mitigation.md:
 * the SPA shell is never a link destination). `selectedPrefixes` is the page
 * budget selection; a single-block org whose page was dropped by the budget
 * stays plain text instead of aiming at a soft-404.
 */
function orgAnchor(entry, selectedPrefixes = null) {
  const label = displayNameOf(entry.nameCounts);
  if (entry.slug) {
    return `<a href="/vendor/${escapeHtml(entry.slug)}">${escapeHtml(label)}</a>`;
  }
  const prefix = entry.records?.length === 1 ? entry.records[0].prefix : null;
  if (prefix && (!selectedPrefixes || selectedPrefixes.has(prefix))) {
    return `<a href="/${escapeHtml(prefix)}">${escapeHtml(label)}</a>`;
  }
  return escapeHtml(label);
}

function countryLinks(codes) {
  return codes
    .map((code) => `<a href="/country/${escapeHtml(code.toLowerCase())}">${escapeHtml(code)}</a>`)
    .join(' · ');
}

/** Former-owner links for the vendor hub lede: "F1 ×N · F2 ×M". */
function absorbedListLink(absorbed) {
  return absorbed
    .slice(0, 10)
    .map((entry) => `<a href="/former/${escapeHtml(entry.slug)}">${escapeHtml(entry.displayName)}</a> × ${entry.count}`)
    .join(' · ');
}

function displayNameForCountry(code) {
  return countryName(code) ?? code;
}

/**
 * Write all hub pages and return relative URL arrays for the sitemap plus
 * the data, for wiring vendor hub links into prefix pages.
 *
 * Each page embeds its own last-change date from the page-hash tracker
 * (footer freshness line + JSON-LD dateModified). When the freshly rendered
 * markup still differs from the deployed page, it is re-rendered once with
 * this build's refresh date, so the embedded date, the JSON-LD, and the
 * sitemap lastmod agree — and dates stay untouched for unchanged pages.
 */
export async function writeHubPages({
  hubData,
  outDir,
  assets,
  formerData = null,
  recordsByPrefix = new Map(),
  pageTracker = null,
  site = SITE,
  refreshDate = null,
  selectedPrefixes = null,
}) {
  const renderTracked = async (file, url, render) => {
    const priorDate = pageTracker?.priorLastmod(url) ?? refreshDate;
    let html = render(priorDate);
    await writeFile(file, html);
    if (pageTracker) {
      pageTracker.record(url, html);
      if (pageTracker.changedSince(url)) {
        html = render(refreshDate);
        await writeFile(file, html);
        pageTracker.record(url, html);
      }
    }
  };

  const vendorDir = path.join(outDir, 'vendor');
  const countryDir = path.join(outDir, 'country');
  await mkdir(vendorDir, { recursive: true });
  await mkdir(countryDir, { recursive: true });

  const vendorUrls = [];
  for (const hub of hubData.orgs) {
    const absorbed = formerData?.absorbedByVendor?.get(hub.key) ?? [];
    const url = `${site}${hub.url}`;
    await renderTracked(
      path.join(vendorDir, `${hub.slug}.html`),
      url,
      (dataUpdated) => renderOrgHubPage({ hub, assets, site, absorbed, dataUpdated }),
    );
    vendorUrls.push(hub.url);
  }

  const countryUrls = [];
  for (const hub of hubData.countries) {
    const file = `${hub.code.toLowerCase()}.html`;
    const url = `${site}/country/${hub.code.toLowerCase()}`;
    await renderTracked(
      path.join(countryDir, file),
      url,
      (dataUpdated) =>
        renderCountryHubPage({ hub, assets, site, dataUpdated, selectedPrefixes }),
    );
    countryUrls.push(`/country/${hub.code.toLowerCase()}`);
  }

  // The rollup index over those pages: the country scope of the sitemap leads
  // with it (build.mjs), and it gets the same last-change bookkeeping.
  await renderTracked(
    path.join(outDir, 'country.html'),
    `${site}/country`,
    (dataUpdated) => renderCountryIndexPage({ hubData, assets, site, dataUpdated }),
  );

  const formerUrls = [];
  if (formerData?.formers?.length) {
    const formerDir = path.join(outDir, 'former');
    await mkdir(formerDir, { recursive: true });
    for (const hub of formerData.formers) {
      const url = `${site}${hub.url}`;
      await renderTracked(
        path.join(formerDir, `${hub.slug}.html`),
        url,
        (dataUpdated) => renderFormerHubPage({ hub, recordsByPrefix, assets, site, dataUpdated }),
      );
      formerUrls.push(hub.url);
    }
  }

  return { vendorUrls, countryUrls, formerUrls, countryIndexUrl: '/country' };
}
