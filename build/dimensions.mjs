/**
 * Additional registry dimensions: registry type, first-observed year,
 * region, ownership history/successors, and historical country. All pages are
 * static HTML with complete tables and deterministic build-time links; dates
 * are observation dates, never legal transfer dates.
 */

import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';

import { countryName } from '../src/engine/countries.mjs';
import { regionForCountry, regionName, regionSlug } from '../src/engine/regions.mjs';
import { normalizeOrgName } from './lineage.mjs';
import { escapeHtml, SITE } from './page-template.mjs';
import { renderPage, paramsAttr } from './hubs.mjs';
import { renderAllocationTimeline } from './timeline.mjs';
import {
  colonize,
  formatAddresses,
  formatCount,
  formatDate,
} from '../src/ui/format.mjs';

/** Render one dimension page with the shared hub chrome and JSON-LD. */
function dimensionPage({
  title,
  titleKey = null,
  titleParams = null,
  description,
  canonical,
  breadcrumbLabel,
  breadcrumbKey = null,
  breadcrumbParent = null,
  heading,
  headingKey = null,
  headingParams = null,
  ledeHtml,
  body,
  assets,
  dataUpdated = null,
  site = SITE,
}) {
  const titleTag = titleKey
    ? `<title data-i18n="${escapeHtml(titleKey)}" ${paramsAttr(titleParams ?? {})}>${escapeHtml(title)}</title>`
    : `<title>${escapeHtml(title)}</title>`;
  const headingHtml = headingKey
    ? `<span data-i18n="${escapeHtml(headingKey)}" ${paramsAttr(headingParams ?? {})}>${heading}</span>`
    : heading;
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
    breadcrumbLabel,
    breadcrumbKey,
    breadcrumbParent,
    heading: headingHtml,
    ledeHtml,
    body,
    assets,
    jsonLdNodes: [collectionLd],
    dataUpdated,
    site,
  });
}

function table(headers, rows) {
  return `        <div class="table-wrap">
          <table class="data-table">
            <thead>
              <tr>
${headers.map((header) => `                <th scope="col"${header.key ? ` data-i18n="${header.key}"` : ''}>${escapeHtml(header.label)}</th>`).join('\n')}
              </tr>
            </thead>
            <tbody>
${rows.join('\n')}
            </tbody>
          </table>
        </div>`;
}

function statLine(entries) {
  return entries
    .filter(([, value]) => value !== null && value !== undefined && value !== '')
    .map(([label, value]) => `<div><dt>${escapeHtml(label)}</dt><dd>${value}</dd></div>`)
    .join('');
}

function statGrid(entries) {
  const body = statLine(entries);
  if (!body) return '';
  return `      <dl class="dimension-stats">${body}</dl>`;
}

function typeSlug(type) {
  return String(type).toLowerCase().replace(/[^a-z0-9]+/g, '-');
}

function typeLabel(type) {
  return String(type || 'Unknown').toUpperCase();
}

function summarizeRecords(records) {
  const orgKeys = new Set();
  const countries = new Set();
  let blocks = 0;
  let addresses = 0;
  let first = null;
  let last = null;
  for (const record of records) {
    blocks += 1;
    addresses += record.addressCount ?? 0;
    const key = normalizeOrgName(record.orgName);
    if (key) orgKeys.add(key);
    if (record.country) countries.add(record.country);
    if (record.firstSeen) {
      if (!first || record.firstSeen < first) first = record.firstSeen;
      if (!last || record.firstSeen > last) last = record.firstSeen;
    }
  }
  return { blocks, addresses, orgs: orgKeys.size, countries: [...countries].sort(), first, last };
}

function orgAnchor(record, selectedPrefixes = null) {
  const label = record.orgName || 'Unknown organization';
  if (!selectedPrefixes || selectedPrefixes.has(record.prefix)) {
    return `<a href="/${escapeHtml(record.prefix)}">${escapeHtml(label)}</a>`;
  }
  return escapeHtml(label);
}

function countryAnchor(code) {
  if (!code) return '-';
  return `<a href="/country/${escapeHtml(code.toLowerCase())}">${escapeHtml(countryName(code) ?? code)}</a>`;
}

function registryAnchor(type) {
  return `<a href="/registry/${escapeHtml(typeSlug(type))}">${escapeHtml(typeLabel(type))}</a>`;
}

function regionAnchor(code) {
  const key = regionForCountry(code);
  return `<a href="/region/${escapeHtml(regionSlug(key))}">${escapeHtml(regionName(key))}</a>`;
}

function linkList(links) {
  return links.map((link) => `<a href="${escapeHtml(link.url)}">${escapeHtml(link.label)}</a>`).join(' · ');
}

/* ---------------------------- Compute dimensions --------------------------- */

export function computeRegistryDimensions(records) {
  const groups = new Map();
  for (const record of records) {
    const key = typeLabel(record.blockType);
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(record);
  }
  return [...groups.entries()]
    .sort((a, b) => a[0].localeCompare(b[0]))
    .map(([type, typeRecords]) => ({
      type,
      slug: typeSlug(type),
      url: `/registry/${typeSlug(type)}`,
      records: typeRecords,
      ...summarizeRecords(typeRecords),
    }));
}

export function computeYearDimensions(records) {
  const groups = new Map();
  for (const record of records) {
    const year = String(record.firstSeen ?? '').slice(0, 4);
    if (!/^\d{4}$/.test(year)) continue;
    if (!groups.has(year)) groups.set(year, []);
    groups.get(year).push(record);
  }
  return [...groups.entries()]
    .sort((a, b) => a[0].localeCompare(b[0]))
    .map(([year, yearRecords]) => ({
      year,
      url: `/year/${year}`,
      records: yearRecords,
      ...summarizeRecords(yearRecords),
    }));
}

export function computeRegionDimensions(records) {
  const groups = new Map();
  for (const record of records) {
    const key = regionForCountry(record.country);
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(record);
  }
  return [...groups.entries()]
    .sort((a, b) => regionName(a[0]).localeCompare(regionName(b[0])))
    .map(([key, regionRecords]) => {
      const countryCodes = [...new Set(regionRecords.map((r) => r.country).filter(Boolean))].sort();
      return {
        key,
        slug: regionSlug(key),
        url: `/region/${regionSlug(key)}`,
        name: regionName(key),
        records: regionRecords,
        countryCodes,
        ...summarizeRecords(regionRecords),
      };
    });
}

function transitionRows(lineageEntries, recordsByPrefix) {
  const rows = [];
  for (const entry of lineageEntries ?? []) {
    entry.events?.forEach((event, seq) => {
      if (seq === 0) return;
      const previous = entry.events[seq - 1];
      const record = recordsByPrefix.get(entry.prefix) ?? null;
      rows.push({
        ...event,
        seq,
        prefix: entry.prefix,
        prefixLen: entry.prefixLen,
        firstSeen: entry.firstSeen,
        lastSeen: entry.lastSeen,
        addressCount: record?.addressCount ?? 0,
        currentOrg: record?.orgName ?? event.orgName,
        currentVendorHub: record?.vendorHub ?? null,
        previousOrg: previous?.orgName ?? '',
        previousCountry: previous?.country ?? null,
      });
    });
  }
  return rows.sort((a, b) => (a.date ?? '') < (b.date ?? '') ? -1 : (a.date ?? '') > (b.date ?? '') ? 1 : a.prefix.localeCompare(b.prefix));
}

export function computeHistoryDimensions(lineageEntries, recordsByPrefix = new Map()) {
  const changes = transitionRows(lineageEntries, recordsByPrefix);
  const years = new Map();
  for (const change of changes) {
    const year = String(change.date ?? '').slice(0, 4);
    if (!/^\d{4}$/.test(year)) continue;
    if (!years.has(year)) years.set(year, []);
    years.get(year).push(change);
  }
  return {
    changes,
    years: [...years.entries()]
      .sort((a, b) => a[0].localeCompare(b[0]))
      .map(([year, yearChanges]) => ({
        year,
        url: `/history/${year}`,
        changes: yearChanges,
        prefixes: new Set(yearChanges.map((change) => change.prefix)).size,
        addresses: yearChanges.reduce((sum, change) => sum + (change.addressCount ?? 0), 0),
      })),
  };
}

export function computeHistoryCountryDimensions(lineageEntries, recordsByPrefix = new Map()) {
  const changes = transitionRows(lineageEntries, recordsByPrefix).filter((change) => change.country);
  const countries = new Map();
  for (const change of changes) {
    const code = change.country;
    if (!countries.has(code)) countries.set(code, []);
    countries.get(code).push(change);
  }
  return [...countries.entries()]
    .sort((a, b) => (countryName(a[0]) ?? a[0]).localeCompare(countryName(b[0]) ?? b[0]))
    .map(([code, countryChanges]) => ({
      code,
      name: countryName(code) ?? code,
      url: `/history/country/${code.toLowerCase()}`,
      changes: countryChanges,
      prefixes: new Set(countryChanges.map((change) => change.prefix)).size,
      addresses: countryChanges.reduce((sum, change) => sum + (change.addressCount ?? 0), 0),
    }));
}

export function computeSuccessorDimensions(formerData, recordsByPrefix = new Map()) {
  if (!formerData?.absorbedByVendor) return [];
  const vendorByKey = new Map((formerData?.vendors ?? []).map((vendor) => [vendor.key, vendor]));
  const pages = [];
  for (const [ownerKey, absorbed] of formerData.absorbedByVendor) {
    const vendor = vendorByKey.get(ownerKey);
    if (!vendor?.slug || absorbed.length === 0) continue;
    const records = [];
    for (const former of formerData.formers ?? []) {
      for (const instance of former.prefixes.values()) {
        if (normalizeOrgName(instance.currentOwner) !== ownerKey) continue;
        const record = recordsByPrefix.get(instance.prefix);
        if (record) records.push({ ...record, formerOwner: former.displayName, formerSlug: former.slug });
      }
    }
    pages.push({
      key: ownerKey,
      slug: vendor.slug,
      url: `/successor/${vendor.slug}`,
      displayName: vendor.displayName,
      vendorUrl: vendor.url,
      absorbed,
      records,
      ...summarizeRecords(records),
    });
  }
  return pages.sort((a, b) => b.addresses - a.addresses || a.key.localeCompare(b.key));
}

/* ----------------------------- Render dimensions --------------------------- */

export function renderRegistryIndexPage({ dimensions, assets, site = SITE, dataUpdated = null }) {
  const title = 'MAC address blocks by registry type | MAC Address Lookup';
  const description =
    'MA-L, MA-M, MA-S, IAB, and CID IEEE registrations compared by block count, address space, organizations, and countries.';
  const rows = dimensions.map((dimension) =>
    `            <tr><td>${registryAnchor(dimension.type)}</td><td>${escapeHtml(formatCount(dimension.blocks, 'en'))}</td><td class="num">${escapeHtml(formatAddresses(dimension.addresses, 'en'))}</td><td>${escapeHtml(formatCount(dimension.orgs, 'en'))}</td><td>${escapeHtml(formatCount(dimension.countries.length, 'en'))}</td></tr>`,
  );
  const body = table(
    [
      { label: 'Registry' },
      { label: 'Blocks', key: 'table.blocks' },
      { label: 'Addresses', key: 'table.addresses' },
      { label: 'Organizations', key: 'table.org' },
      { label: 'Countries', key: 'detail.country' },
    ],
    rows,
  );
  return dimensionPage({
    title,
    titleKey: 'title.registryIndex',
    description,
    canonical: `${site}/registry`,
    breadcrumbLabel: 'Registry types',
    breadcrumbKey: 'hub.registry.all',
    heading: 'MAC address blocks by registry type',
    headingKey: 'hub.h1.registryIndex',
    ledeHtml: `          <p class="lede" data-i18n="hub.registryIndex.lede">Every IEEE registry type, from classic MA-L OUIs to small MA-S allocations and CID company identifiers.</p>`,
    body,
    assets,
    dataUpdated,
    site,
  });
}

export function renderRegistryPage({ dimension, timelineRange, assets, site = SITE, dataUpdated = null }) {
  const title = `${dimension.type} MAC address blocks | MAC Address Lookup`;
  const description = `${dimension.blocks} ${dimension.type} blocks covering ${formatAddresses(dimension.addresses, 'en')} addresses across ${dimension.orgs} organizations.`;
  const rows = dimension.records.map((record) =>
    `            <tr><td class="mono"><a href="/${escapeHtml(record.prefix)}">${escapeHtml(colonize(record.prefix))}</a></td><td>${orgAnchor(record)}</td><td>${countryAnchor(record.country)}</td><td class="num">${escapeHtml(formatAddresses(record.addressCount, 'en'))}</td><td>${escapeHtml(formatDate(record.firstSeen, 'en') || '-')}</td></tr>`,
  );
  const body = `${statGrid([
    ['Blocks', formatCount(dimension.blocks, 'en')],
    ['Addresses', formatAddresses(dimension.addresses, 'en')],
    ['Organizations', formatCount(dimension.orgs, 'en')],
    ['Countries', formatCount(dimension.countries.length, 'en')],
    ['First observed', formatDate(dimension.first, 'en') || '-'],
  ])}\n${renderAllocationTimeline(dimension.records, { label: `${dimension.type} allocations`, ...timelineRange })}\n${table(
    [
      { label: 'Prefix', key: 'table.prefix' },
      { label: 'Organization', key: 'table.org' },
      { label: 'Country', key: 'detail.country' },
      { label: 'Addresses', key: 'table.addresses' },
      { label: 'First observed', key: 'detail.firstRegistered' },
    ],
    rows,
  )}`;
  return dimensionPage({
    title,
    titleKey: 'title.registryHub',
    titleParams: { type: dimension.type },
    description,
    canonical: `${site}${dimension.url}`,
    breadcrumbLabel: dimension.type,
    breadcrumbParent: { name: 'Registry types', url: `${site}/registry`, key: 'hub.registry.all' },
    heading: `${escapeHtml(dimension.type)} MAC address blocks`,
    headingKey: 'hub.h1.registry',
    headingParams: { type: dimension.type },
    ledeHtml: `          <p class="lede" data-i18n="hub.registry.lede" ${paramsAttr({ type: dimension.type, blocks: dimension.blocks, addresses: dimension.addresses, orgs: dimension.orgs })}>The IEEE ${escapeHtml(dimension.type)} registry carries ${escapeHtml(formatCount(dimension.blocks, 'en'))} blocks covering ${escapeHtml(formatAddresses(dimension.addresses, 'en'))} addresses across ${escapeHtml(formatCount(dimension.orgs, 'en'))} organizations.</p>`,
    body,
    assets,
    dataUpdated,
    site,
  });
}

export function renderYearIndexPage({ dimensions, assets, site = SITE, dataUpdated = null, unknownCount = 0 }) {
  const title = 'MAC address blocks by first-observed year | MAC Address Lookup';
  const description = 'IEEE MAC registrations grouped by the year each block was first observed in public data.';
  const rows = dimensions.map((dimension) =>
    `            <tr><td><a href="${escapeHtml(dimension.url)}">${escapeHtml(dimension.year)}</a></td><td>${escapeHtml(formatCount(dimension.blocks, 'en'))}</td><td class="num">${escapeHtml(formatAddresses(dimension.addresses, 'en'))}</td><td>${escapeHtml(formatCount(dimension.orgs, 'en'))}</td><td>${escapeHtml(formatCount(dimension.countries.length, 'en'))}</td></tr>`,
  );
  const unknown = unknownCount > 0 ? `<p class="section-note">${escapeHtml(formatCount(unknownCount, 'en'))} records have no first-observed date.</p>` : '';
  const body = `${table(
    [
      { label: 'Year' },
      { label: 'Blocks', key: 'table.blocks' },
      { label: 'Addresses', key: 'table.addresses' },
      { label: 'Organizations', key: 'table.org' },
      { label: 'Countries', key: 'detail.country' },
    ],
    rows,
  )}\n${unknown}`;
  return dimensionPage({
    title,
    titleKey: 'title.yearIndex',
    description,
    canonical: `${site}/year`,
    breadcrumbLabel: 'Years',
    breadcrumbKey: 'hub.years.all',
    heading: 'MAC address blocks by first-observed year',
    headingKey: 'hub.h1.yearIndex',
    ledeHtml: `          <p class="lede" data-i18n="hub.yearIndex.lede">Registration cohorts by the first year each block appeared in public IEEE snapshots.</p>`,
    body,
    assets,
    dataUpdated,
    site,
  });
}

export function renderYearPage({ dimension, timelineRange, assets, site = SITE, dataUpdated = null }) {
  const title = `MAC address blocks first observed in ${dimension.year} | MAC Address Lookup`;
  const description = `${dimension.blocks} IEEE blocks first observed in ${dimension.year}, covering ${formatAddresses(dimension.addresses, 'en')} addresses.`;
  const rows = dimension.records.map((record) =>
    `            <tr><td class="mono"><a href="/${escapeHtml(record.prefix)}">${escapeHtml(colonize(record.prefix))}</a></td><td>${orgAnchor(record)}</td><td>${registryAnchor(record.blockType)}</td><td>${countryAnchor(record.country)}</td><td class="num">${escapeHtml(formatAddresses(record.addressCount, 'en'))}</td></tr>`,
  );
  const body = `${statGrid([
    ['Blocks', formatCount(dimension.blocks, 'en')],
    ['Addresses', formatAddresses(dimension.addresses, 'en')],
    ['Organizations', formatCount(dimension.orgs, 'en')],
    ['Countries', formatCount(dimension.countries.length, 'en')],
  ])}\n${table(
    [
      { label: 'Prefix', key: 'table.prefix' },
      { label: 'Organization', key: 'table.org' },
      { label: 'Registry', key: 'table.registry' },
      { label: 'Country', key: 'detail.country' },
      { label: 'Addresses', key: 'table.addresses' },
    ],
    rows,
  )}`;
  return dimensionPage({
    title,
    titleKey: 'title.yearHub',
    titleParams: { year: dimension.year },
    description,
    canonical: `${site}${dimension.url}`,
    breadcrumbLabel: dimension.year,
    breadcrumbParent: { name: 'Years', url: `${site}/year`, key: 'hub.years.all' },
    heading: `MAC address blocks first observed in ${escapeHtml(dimension.year)}`,
    headingKey: 'hub.h1.year',
    headingParams: { year: dimension.year },
    ledeHtml: `          <p class="lede" data-i18n="hub.year.lede" ${paramsAttr({ year: dimension.year, blocks: dimension.blocks, addresses: dimension.addresses, orgs: dimension.orgs })}>${escapeHtml(dimension.year)} produced ${escapeHtml(formatCount(dimension.blocks, 'en'))} newly observed blocks covering ${escapeHtml(formatAddresses(dimension.addresses, 'en'))} addresses across ${escapeHtml(formatCount(dimension.orgs, 'en'))} organizations.</p>`,
    body,
    assets,
    dataUpdated,
    site,
  });
}

export function renderRegionIndexPage({ dimensions, assets, site = SITE, dataUpdated = null }) {
  const title = 'MAC address blocks by region | MAC Address Lookup';
  const description = 'IEEE registration countries grouped into continents, with block and address-space totals.';
  const rows = dimensions.map((dimension) =>
    `            <tr><td><a href="${escapeHtml(dimension.url)}">${escapeHtml(dimension.name)}</a></td><td>${escapeHtml(formatCount(dimension.blocks, 'en'))}</td><td class="num">${escapeHtml(formatAddresses(dimension.addresses, 'en'))}</td><td>${escapeHtml(formatCount(dimension.orgs, 'en'))}</td><td>${escapeHtml(formatCount(dimension.countryCodes.length, 'en'))}</td></tr>`,
  );
  const body = table(
    [
      { label: 'Region' },
      { label: 'Blocks', key: 'table.blocks' },
      { label: 'Addresses', key: 'table.addresses' },
      { label: 'Organizations', key: 'table.org' },
      { label: 'Countries', key: 'detail.country' },
    ],
    rows,
  );
  return dimensionPage({
    title,
    titleKey: 'title.regionIndex',
    description,
    canonical: `${site}/region`,
    breadcrumbLabel: 'Regions',
    breadcrumbKey: 'hub.regions.all',
    heading: 'MAC address blocks by region',
    headingKey: 'hub.h1.regionIndex',
    ledeHtml: `          <p class="lede" data-i18n="hub.regionIndex.lede">A continental view of the current registration addresses in the IEEE registry.</p>`,
    body,
    assets,
    dataUpdated,
    site,
  });
}

export function renderRegionPage({ dimension, timelineRange, assets, site = SITE, dataUpdated = null }) {
  const title = `${dimension.name} MAC address blocks | MAC Address Lookup`;
  const description = `${dimension.blocks} MAC address blocks registered in ${dimension.name}, covering ${formatAddresses(dimension.addresses, 'en')} addresses.`;
  const countryGroups = new Map();
  for (const record of dimension.records) {
    if (!record.country) continue;
    if (!countryGroups.has(record.country)) countryGroups.set(record.country, []);
    countryGroups.get(record.country).push(record);
  }
  const countryRows = [...countryGroups.entries()]
    .sort((a, b) => b[1].reduce((s, r) => s + r.addressCount, 0) - a[1].reduce((s, r) => s + r.addressCount, 0))
    .map(([code, records]) => {
      const summary = summarizeRecords(records);
      return `            <tr><td>${countryAnchor(code)}</td><td>${escapeHtml(formatCount(summary.blocks, 'en'))}</td><td class="num">${escapeHtml(formatAddresses(summary.addresses, 'en'))}</td><td>${escapeHtml(formatCount(summary.orgs, 'en'))}</td></tr>`;
    });
  const sample = dimension.records.slice(0, 500).map((record) =>
    `            <tr><td class="mono"><a href="/${escapeHtml(record.prefix)}">${escapeHtml(colonize(record.prefix))}</a></td><td>${orgAnchor(record)}</td><td>${countryAnchor(record.country)}</td><td class="num">${escapeHtml(formatAddresses(record.addressCount, 'en'))}</td></tr>`,
  );
  const body = `${statGrid([
    ['Blocks', formatCount(dimension.blocks, 'en')],
    ['Addresses', formatAddresses(dimension.addresses, 'en')],
    ['Organizations', formatCount(dimension.orgs, 'en')],
    ['Countries', formatCount(dimension.countryCodes.length, 'en')],
  ])}\n${renderAllocationTimeline(dimension.records, { label: `${dimension.name} allocations`, ...timelineRange })}\n<h2>Countries</h2>\n${table(
    [
      { label: 'Country', key: 'detail.country' },
      { label: 'Blocks', key: 'table.blocks' },
      { label: 'Addresses', key: 'table.addresses' },
      { label: 'Organizations', key: 'table.org' },
    ],
    countryRows,
  )}\n<h2>Sample blocks</h2>\n${table(
    [
      { label: 'Prefix', key: 'table.prefix' },
      { label: 'Organization', key: 'table.org' },
      { label: 'Country', key: 'detail.country' },
      { label: 'Addresses', key: 'table.addresses' },
    ],
    sample,
  )}\n<p class="section-note">Showing the first ${escapeHtml(formatCount(sample.length, 'en'))} of ${escapeHtml(formatCount(dimension.blocks, 'en'))} blocks.</p>`;
  return dimensionPage({
    title,
    titleKey: 'title.regionHub',
    titleParams: { region: dimension.name },
    description,
    canonical: `${site}${dimension.url}`,
    breadcrumbLabel: dimension.name,
    breadcrumbParent: { name: 'Regions', url: `${site}/region`, key: 'hub.regions.all' },
    heading: `${escapeHtml(dimension.name)} MAC address blocks`,
    headingKey: 'hub.h1.region',
    headingParams: { region: dimension.name },
    ledeHtml: `          <p class="lede" data-i18n="hub.region.lede" ${paramsAttr({ region: dimension.name, blocks: dimension.blocks, addresses: dimension.addresses, orgs: dimension.orgs })}>Registration addresses in ${escapeHtml(dimension.name)} account for ${escapeHtml(formatCount(dimension.blocks, 'en'))} blocks and ${escapeHtml(formatAddresses(dimension.addresses, 'en'))} addresses across ${escapeHtml(formatCount(dimension.orgs, 'en'))} organizations.</p>`,
    body,
    assets,
    dataUpdated,
    site,
  });
}

export function renderHistoryIndexPage({ history, assets, site = SITE, dataUpdated = null }) {
  const title = 'MAC address ownership history | MAC Address Lookup';
  const description = 'Observed ownership changes in IEEE MAC registrations, grouped by year.';
  const rows = history.years.map((dimension) =>
    `            <tr><td><a href="${escapeHtml(dimension.url)}">${escapeHtml(dimension.year)}</a></td><td>${escapeHtml(formatCount(dimension.changes.length, 'en'))}</td><td>${escapeHtml(formatCount(dimension.prefixes, 'en'))}</td><td class="num">${escapeHtml(formatAddresses(dimension.addresses, 'en'))}</td></tr>`,
  );
  const body = table(
    [
      { label: 'Year' },
      { label: 'Changes' },
      { label: 'Prefixes', key: 'table.prefix' },
      { label: 'Addresses', key: 'table.addresses' },
    ],
    rows,
  );
  return dimensionPage({
    title,
    titleKey: 'title.historyIndex',
    description,
    canonical: `${site}/history`,
    breadcrumbLabel: 'History',
    breadcrumbKey: 'hub.history.all',
    heading: 'MAC address ownership history',
    headingKey: 'hub.h1.historyIndex',
    ledeHtml: `          <p class="lede" data-i18n="hub.historyIndex.lede">When registered prefixes changed organizations, based on public snapshot observations.</p>`,
    body,
    assets,
    dataUpdated,
    site,
  });
}

export function renderHistoryYearPage({ dimension, assets, site = SITE, dataUpdated = null }) {
  const title = `MAC address ownership changes in ${dimension.year} | MAC Address Lookup`;
  const description = `${dimension.changes.length} ownership changes across ${dimension.prefixes} prefixes were first observed in ${dimension.year}.`;
  const rows = dimension.changes.map((change) =>
    `            <tr><td class="mono"><a href="/${escapeHtml(change.prefix)}">${escapeHtml(colonize(change.prefix))}</a></td><td>${escapeHtml(change.previousOrg || '-')}</td><td>${escapeHtml(change.orgName || '-')}</td><td>${escapeHtml(formatDate(change.date, 'en') || '-')}</td></tr>`,
  );
  const body = `${statGrid([
    ['Changes', formatCount(dimension.changes.length, 'en')],
    ['Prefixes', formatCount(dimension.prefixes, 'en')],
    ['Addresses', formatAddresses(dimension.addresses, 'en')],
  ])}\n${table(
    [
      { label: 'Prefix', key: 'table.prefix' },
      { label: 'Previous organization' },
      { label: 'New organization' },
      { label: 'Observed' },
    ],
    rows,
  )}`;
  return dimensionPage({
    title,
    titleKey: 'title.historyYear',
    titleParams: { year: dimension.year },
    description,
    canonical: `${site}${dimension.url}`,
    breadcrumbLabel: dimension.year,
    breadcrumbParent: { name: 'History', url: `${site}/history`, key: 'hub.history.all' },
    heading: `MAC address ownership changes in ${escapeHtml(dimension.year)}`,
    headingKey: 'hub.h1.historyYear',
    headingParams: { year: dimension.year },
    ledeHtml: `          <p class="lede" data-i18n="hub.historyYear.lede" ${paramsAttr({ year: dimension.year, count: dimension.changes.length, prefixes: dimension.prefixes })}>${escapeHtml(formatCount(dimension.changes.length, 'en'))} ownership changes across ${escapeHtml(formatCount(dimension.prefixes, 'en'))} prefixes were first observed in ${escapeHtml(dimension.year)}.</p>`,
    body,
    assets,
    dataUpdated,
    site,
  });
}

export function renderHistoryCountryIndexPage({ dimensions, assets, site = SITE, dataUpdated = null }) {
  const title = 'MAC address history by registration country | MAC Address Lookup';
  const description = 'Ownership changes grouped by the historical registration country in each observed record.';
  const rows = dimensions.map((dimension) =>
    `            <tr><td><a href="${escapeHtml(dimension.url)}">${escapeHtml(dimension.name)}</a></td><td>${escapeHtml(formatCount(dimension.changes.length, 'en'))}</td><td>${escapeHtml(formatCount(dimension.prefixes, 'en'))}</td><td class="num">${escapeHtml(formatAddresses(dimension.addresses, 'en'))}</td></tr>`,
  );
  const body = table(
    [
      { label: 'Country', key: 'detail.country' },
      { label: 'Changes' },
      { label: 'Prefixes', key: 'table.prefix' },
      { label: 'Addresses', key: 'table.addresses' },
    ],
    rows,
  );
  return dimensionPage({
    title,
    titleKey: 'title.historyCountryIndex',
    description,
    canonical: `${site}/history/country`,
    breadcrumbLabel: 'History countries',
    breadcrumbParent: { name: 'History', url: `${site}/history`, key: 'hub.history.all' },
    heading: 'MAC address history by registration country',
    headingKey: 'hub.h1.historyCountryIndex',
    ledeHtml: `          <p class="lede" data-i18n="hub.historyCountryIndex.lede">Historical countries recorded when ownership changes were observed.</p>`,
    body,
    assets,
    dataUpdated,
    site,
  });
}

export function renderHistoryCountryPage({ dimension, assets, site = SITE, dataUpdated = null }) {
  const title = `${dimension.name} MAC address ownership history | MAC Address Lookup`;
  const description = `${dimension.changes.length} ownership changes in ${dimension.name} registration records.`;
  const rows = dimension.changes.map((change) =>
    `            <tr><td class="mono"><a href="/${escapeHtml(change.prefix)}">${escapeHtml(colonize(change.prefix))}</a></td><td>${escapeHtml(change.previousOrg || '-')}</td><td>${escapeHtml(change.orgName || '-')}</td><td>${escapeHtml(formatDate(change.date, 'en') || '-')}</td></tr>`,
  );
  const body = `${statGrid([
    ['Changes', formatCount(dimension.changes.length, 'en')],
    ['Prefixes', formatCount(dimension.prefixes, 'en')],
    ['Addresses', formatAddresses(dimension.addresses, 'en')],
  ])}\n${table(
    [
      { label: 'Prefix', key: 'table.prefix' },
      { label: 'Previous organization' },
      { label: 'New organization' },
      { label: 'Observed' },
    ],
    rows,
  )}`;
  return dimensionPage({
    title,
    titleKey: 'title.historyCountry',
    titleParams: { country: dimension.name },
    description,
    canonical: `${site}${dimension.url}`,
    breadcrumbLabel: dimension.name,
    breadcrumbParent: { name: 'History countries', url: `${site}/history/country`, key: 'hub.historyCountries.all' },
    heading: `${escapeHtml(dimension.name)} MAC address ownership history`,
    headingKey: 'hub.h1.historyCountry',
    headingParams: { country: dimension.name },
    ledeHtml: `          <p class="lede" data-i18n="hub.historyCountry.lede" ${paramsAttr({ country: dimension.name, count: dimension.changes.length, prefixes: dimension.prefixes })}>${escapeHtml(formatCount(dimension.changes.length, 'en'))} ownership changes in ${escapeHtml(dimension.name)} registration records were first observed across ${escapeHtml(formatCount(dimension.prefixes, 'en'))} prefixes.</p>`,
    body,
    assets,
    dataUpdated,
    site,
  });
}

export function renderSuccessorIndexPage({ dimensions, assets, site = SITE, dataUpdated = null }) {
  const title = 'MAC address successors and acquisitions | MAC Address Lookup';
  const description = 'Organizations that now hold blocks once registered to former owners.';
  const rows = dimensions.map((dimension) =>
    `            <tr><td><a href="${escapeHtml(dimension.url)}">${escapeHtml(dimension.displayName)}</a></td><td>${escapeHtml(formatCount(dimension.absorbed.length, 'en'))}</td><td>${escapeHtml(formatCount(dimension.blocks, 'en'))}</td><td class="num">${escapeHtml(formatAddresses(dimension.addresses, 'en'))}</td></tr>`,
  );
  const body = table(
    [
      { label: 'Current owner' },
      { label: 'Former owners' },
      { label: 'Blocks', key: 'table.blocks' },
      { label: 'Addresses', key: 'table.addresses' },
    ],
    rows,
  );
  return dimensionPage({
    title,
    titleKey: 'title.successorIndex',
    description,
    canonical: `${site}/successor`,
    breadcrumbLabel: 'Successors',
    breadcrumbKey: 'hub.successors.all',
    heading: 'MAC address successors and acquisitions',
    headingKey: 'hub.h1.successorIndex',
    ledeHtml: `          <p class="lede" data-i18n="hub.successorIndex.lede">The current owners of prefixes that changed hands, with the former portfolios they absorbed.</p>`,
    body,
    assets,
    dataUpdated,
    site,
  });
}

export function renderSuccessorPage({ dimension, assets, site = SITE, dataUpdated = null }) {
  const title = `${dimension.displayName} acquired MAC address blocks | MAC Address Lookup`;
  const description = `${dimension.blocks} MAC address blocks now registered to ${dimension.displayName} were previously registered to other organizations.`;
  const absorbedLinks = linkList(
    dimension.absorbed.map((entry) => ({ url: `/former/${entry.slug}`, label: `${entry.displayName} × ${entry.count}` })),
  );
  const rows = dimension.records.map((record) =>
    `            <tr><td class="mono"><a href="/${escapeHtml(record.prefix)}">${escapeHtml(colonize(record.prefix))}</a></td><td><a href="/former/${escapeHtml(record.formerSlug)}">${escapeHtml(record.formerOwner)}</a></td><td>${escapeHtml(record.blockType)}</td><td class="num">${escapeHtml(formatAddresses(record.addressCount, 'en'))}</td><td>${escapeHtml(formatDate(record.firstSeen, 'en') || '-')}</td></tr>`,
  );
  const body = `${statGrid([
    ['Current owner', `<a href="${escapeHtml(dimension.vendorUrl)}">${escapeHtml(dimension.displayName)}</a>`],
    ['Former owners', escapeHtml(formatCount(dimension.absorbed.length, 'en'))],
    ['Blocks', formatCount(dimension.blocks, 'en')],
    ['Addresses', formatAddresses(dimension.addresses, 'en')],
  ])}\n<p class="hub-countries">Former owners: ${absorbedLinks}</p>\n${table(
    [
      { label: 'Prefix', key: 'table.prefix' },
      { label: 'Former owner' },
      { label: 'Block', key: 'table.block' },
      { label: 'Addresses', key: 'table.addresses' },
      { label: 'First observed', key: 'detail.firstRegistered' },
    ],
    rows,
  )}`;
  return dimensionPage({
    title,
    titleKey: 'title.successor',
    titleParams: { org: dimension.displayName },
    description,
    canonical: `${site}${dimension.url}`,
    breadcrumbLabel: dimension.displayName,
    breadcrumbParent: { name: 'Successors', url: `${site}/successor`, key: 'hub.successors.all' },
    heading: `${escapeHtml(dimension.displayName)} acquired MAC address blocks`,
    headingKey: 'hub.h1.successor',
    headingParams: { org: dimension.displayName },
    ledeHtml: `          <p class="lede" data-i18n="hub.successor.lede" ${paramsAttr({ org: dimension.displayName, blocks: dimension.blocks, former: dimension.absorbed.length })}>${escapeHtml(formatCount(dimension.blocks, 'en'))} blocks now registered to ${escapeHtml(dimension.displayName)} came through ${escapeHtml(formatCount(dimension.absorbed.length, 'en'))} former-owner relationship${dimension.absorbed.length === 1 ? '' : 's'}.</p>`,
    body,
    assets,
    dataUpdated,
    site,
  });
}

/* ------------------------------ Page writing ------------------------------- */

export async function writeDimensionPages({
  records,
  lineageEntries = [],
  formerData = null,
  timelineRange = {},
  outDir,
  assets,
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

  const registries = computeRegistryDimensions(records);
  const years = computeYearDimensions(records);
  const regions = computeRegionDimensions(records);
  const history = computeHistoryDimensions(lineageEntries, new Map(records.map((record) => [record.prefix, record])));
  const historyCountries = computeHistoryCountryDimensions(lineageEntries, new Map(records.map((record) => [record.prefix, record])));
  const successors = computeSuccessorDimensions(formerData, new Map(records.map((record) => [record.prefix, record])));

  const urls = {
    registryIndexUrls: [],
    registryUrls: [],
    yearIndexUrls: [],
    yearUrls: [],
    regionIndexUrls: [],
    regionUrls: [],
    historyIndexUrls: [],
    historyUrls: [],
    historyCountryIndexUrls: [],
    historyCountryUrls: [],
    successorIndexUrls: [],
    successorUrls: [],
  };

  await mkdir(path.join(outDir, 'registry'), { recursive: true });
  await mkdir(path.join(outDir, 'year'), { recursive: true });
  await mkdir(path.join(outDir, 'region'), { recursive: true });
  await mkdir(path.join(outDir, 'history', 'country'), { recursive: true });
  await mkdir(path.join(outDir, 'successor'), { recursive: true });

  await renderTracked(path.join(outDir, 'registry.html'), `${site}/registry`, (date) => renderRegistryIndexPage({ dimensions: registries, assets, site, dataUpdated: date }));
  urls.registryIndexUrls.push('/registry');
  for (const dimension of registries) {
    await renderTracked(path.join(outDir, 'registry', `${dimension.slug}.html`), `${site}${dimension.url}`, (date) => renderRegistryPage({ dimension, timelineRange, assets, site, dataUpdated: date }));
    urls.registryUrls.push(dimension.url);
  }

  await renderTracked(path.join(outDir, 'year.html'), `${site}/year`, (date) => renderYearIndexPage({ dimensions: years, assets, site, dataUpdated: date, unknownCount: records.filter((record) => !record.firstSeen).length }));
  urls.yearIndexUrls.push('/year');
  for (const dimension of years) {
    await renderTracked(path.join(outDir, 'year', `${dimension.year}.html`), `${site}${dimension.url}`, (date) => renderYearPage({ dimension, timelineRange, assets, site, dataUpdated: date }));
    urls.yearUrls.push(dimension.url);
  }

  await renderTracked(path.join(outDir, 'region.html'), `${site}/region`, (date) => renderRegionIndexPage({ dimensions: regions, assets, site, dataUpdated: date }));
  urls.regionIndexUrls.push('/region');
  for (const dimension of regions) {
    await renderTracked(path.join(outDir, 'region', `${dimension.slug}.html`), `${site}${dimension.url}`, (date) => renderRegionPage({ dimension, timelineRange, assets, site, dataUpdated: date }));
    urls.regionUrls.push(dimension.url);
  }

  await renderTracked(path.join(outDir, 'history.html'), `${site}/history`, (date) => renderHistoryIndexPage({ history, assets, site, dataUpdated: date }));
  urls.historyIndexUrls.push('/history');
  for (const dimension of history.years) {
    await renderTracked(path.join(outDir, 'history', `${dimension.year}.html`), `${site}${dimension.url}`, (date) => renderHistoryYearPage({ dimension, assets, site, dataUpdated: date }));
    urls.historyUrls.push(dimension.url);
  }

  await renderTracked(path.join(outDir, 'history', 'country.html'), `${site}/history/country`, (date) => renderHistoryCountryIndexPage({ dimensions: historyCountries, assets, site, dataUpdated: date }));
  urls.historyCountryIndexUrls.push('/history/country');
  for (const dimension of historyCountries) {
    await renderTracked(path.join(outDir, 'history', 'country', `${dimension.code.toLowerCase()}.html`), `${site}${dimension.url}`, (date) => renderHistoryCountryPage({ dimension, assets, site, dataUpdated: date }));
    urls.historyCountryUrls.push(dimension.url);
  }

  await renderTracked(path.join(outDir, 'successor.html'), `${site}/successor`, (date) => renderSuccessorIndexPage({ dimensions: successors, assets, site, dataUpdated: date }));
  urls.successorIndexUrls.push('/successor');
  for (const dimension of successors) {
    await renderTracked(path.join(outDir, 'successor', `${dimension.slug}.html`), `${site}${dimension.url}`, (date) => renderSuccessorPage({ dimension, assets, site, dataUpdated: date }));
    urls.successorUrls.push(dimension.url);
  }

  return { ...urls, registries, years, regions, history, historyCountries, successors };
}
