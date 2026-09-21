/**
 * Pre-rendered "latest OUIs" page: the most recently registered blocks per
 * deploy, from lineage first-observed dates. One static page; the "what's
 * new" surface (a 2026-09 feature; rationale in docs/architecture.md).
 */

import path from 'node:path';
import { writeFile } from 'node:fs/promises';
import { escapeHtml, SITE } from './page-template.mjs';
import { colonize, formatDate } from '../src/ui/format.mjs';

const RECENT_LIMIT = 50;

const BOOT = `(function () {
        try {
          var mode = localStorage.getItem('mal.theme');
          if (mode === 'light' || mode === 'dark') document.documentElement.dataset.mode = mode;
        } catch (error) {
          /* storage unavailable; system preference applies */
        }
      })();`;

export function recentBlocks(records, { limit = RECENT_LIMIT } = {}) {
  return records
    .filter((record) => record.firstSeen)
    .sort((a, b) => (a.firstSeen < b.firstSeen ? 1 : a.firstSeen > b.firstSeen ? -1 : 0))
    .slice(0, limit);
}

export function renderRecentPage({ blocks, assets }) {
  const rows = blocks
    .map(
      (record) =>
        `            <tr>` +
        `<td class="mono"><a href="/${escapeHtml(record.prefix)}">${escapeHtml(colonize(record.prefix))}</a></td>` +
        `<td>${escapeHtml(record.orgName)}</td>` +
        `<td>${escapeHtml(record.blockType)}</td>` +
        `<td>${escapeHtml(record.country ?? '')}</td>` +
        `<td>${escapeHtml(formatDate(record.firstSeen, 'en'))}</td>` +
        `</tr>`,
    )
    .join('\n');

  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title data-i18n="title.recent">Latest OUIs | MAC Address Lookup</title>
    <meta name="description" content="The most recently registered IEEE MAC address blocks, with first-observed dates. Refreshed on every data deploy." />
    <link rel="canonical" href="${SITE}/recent" />
    <meta name="theme-color" content="#fbfbfb" media="(prefers-color-scheme: light)" />
    <meta name="theme-color" content="#1b1b1b" media="(prefers-color-scheme: dark)" />
    <meta property="og:type" content="article" />
    <meta property="og:title" content="Latest OUIs | MAC Address Lookup" />
    <meta property="og:url" content="${SITE}/recent" />
    <link rel="alternate" type="text/markdown" href="/help.md" />
    <link rel="describedby" type="text/plain" href="/llms.txt" />
    <link rel="icon" href="/favicon.svg" type="image/svg+xml" />
    <link rel="stylesheet" href="${assets.cssFile}" />
    <script>
      ${BOOT}
      window.__malWorker = '${escapeHtml(assets.workerFile)}';
    </script>
    <script type="module" src="${assets.staticFile ?? assets.appFile}"></script>
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
          <a href="/" data-i18n="nav.brand">MAC Address Lookup</a> <span aria-hidden="true">/</span> <span data-i18n="recent.title">Latest OUIs</span>
        </nav>
        <section class="prose">
          <h1 data-i18n="recent.title">Latest OUIs</h1>
          <p class="lede">
            The ${blocks.length} most recently registered MAC address blocks, by the date each
            registration was first observed in public IEEE data. Refreshed on every data deploy.
          </p>
          <div class="table-wrap">
            <table class="data-table">
              <thead>
                <tr>
                  <th scope="col" data-i18n="table.prefix">Prefix</th>
                  <th scope="col" data-i18n="table.org">Organization</th>
                  <th scope="col" data-i18n="table.block">Block</th>
                  <th scope="col" data-i18n="detail.country">Country</th>
                  <th scope="col" data-i18n="result.firstRegistered">First registered</th>
                </tr>
              </thead>
              <tbody>
${rows}
              </tbody>
            </table>
          </div>
          <p class="section-note">Dates are when each registration was first observed in public data, not the legal assignment date.</p>
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
          <a href="/help" data-i18n="footer.help">Help &amp; documentation</a> ·
          <a href="https://github.com/jasontally/mac-address-lookup" rel="noopener" data-i18n="footer.source">Source on GitHub</a>
        </p>
      </div>
    </footer>
  </body>
</html>
`;
}

export async function writeRecentPage({ distDir, records, assets, limit = RECENT_LIMIT }) {
  const blocks = recentBlocks(records, { limit });
  await writeFile(path.join(distDir, 'recent.html'), renderRecentPage({ blocks, assets }));
  return blocks;
}
