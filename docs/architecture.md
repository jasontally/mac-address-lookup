# Architecture

Consolidated architecture, platform constraints, and capacity plan for the MAC Address Lookup project. This document records how the system works and the limits it must stay within.

**On numbers.** Counts that move with the data — assignment totals, page and
file totals, byte sizes — are deliberately approximate here. `npm run build`
prints the exact figures and the budget verdict on every run; that output is the
source of truth. What is written down precisely is the part that must not drift:
the limits, the thresholds, the invariants, and the reasoning behind each
decision.

Related docs: [MCP endpoint](mcp-endpoint.md) · [design language](design.md) ·
[thin-content plan](thin-content-mitigation.md) · [README](../README.md)

## Overview

A static, assets-only Cloudflare Worker serving a client-side MAC address lookup tool. Pre-rendered HTML pages cover the largest and most-searched IEEE prefixes so search engines can index them and people can find them; everything else (trimmed long-tail prefixes, full-MAC deep links) is resolved in the browser via the SPA fallback. The registry and its prefix-lineage history ship as two small Parquet files read with Hyparquet. No server code, no API, no in-app analytics. The project is feature-complete; this document is the maintenance reference.

```
Build (Workers Builds)                          Runtime (Cloudflare edge)
┌──────────────────────────────┐               ┌──────────────────────────────────────┐
│ fetch IEEE CSVs + lineage    │               │ /001A2B  → 001A2B.html (static, free)│
│ normalize + parquet ×2       │   wrangler    │ /001A2B3C4D5E → SPA shell → engine   │
│ pre-render priority pages    │ ──deploy────▶ │ /        → app shell                  │
│ sitemap/robots/budget check  │               │ /data/*  → parquet (lazy, hashed)     │
└──────────────────────────────┘               └──────────────────────────────────────┘
```

## Confirmed decisions

| Area | Decision |
| --- | --- |
| Stack | Vanilla HTML/CSS/JS, no framework, no Tailwind, no React |
| Hosting | Cloudflare Workers Static Assets, assets-only (no Worker script), paid plan |
| Fallback | `not_found_handling: "single-page-application"` → `200` + shell for unmatched paths |
| Data | Apache Parquet files (registry + lean search index + lineage), read in-browser with Hyparquet; Apache Arrow JS not used |
| Indexing | Pre-rendered priority tiers, flat `<prefix>.html` pages, canonical uppercase URLs, sitemap covers the pre-rendered pages selected by the active `SITEMAP_SCOPE` (currently `country`: core + rollups + country hubs + dimension pages; still provisional — see the sitemap indexing plan) |
| Design | Kumo-inspired semantic tokens, monochrome + status colors, system font stack, system-aware dark mode + toggle |
| Deep links | Every single-segment path: `/001A2B`, `/apple`, `/001A2B,005056` (comma-separated batch, cap 250); legacy `?q=` still accepted and canonicalized to the path form |
| Partials | < 6 hex lists matching prefixes, capped at 500 with total count |
| Build/deploy | Cloudflare Workers Builds, push-triggered; manual data refresh by bumping `data/refresh.txt` |
| Analytics | None in the app; seed vendor-demand list drives page priority; the Cloudflare zone injects privacy-first, cookieless Web Analytics (see Privacy stance) |

## Repository layout

```
mac-address-lookup/
├── src/                    # client app (committed)
│   ├── engine/             # normalization, lookup, bits, formats, lineage, slugs
│   ├── ui/                 # rendering, deep links, history, theme
│   └── styles/             # token layer + component CSS
├── build/                  # Node build pipeline (committed)
│   ├── build.mjs           # orchestrator
│   ├── fetch-registries.mjs  fetch-lineage.mjs
│   ├── normalize.mjs         # normalize IEEE CSV rows
│   ├── lineage.mjs           # runZero history → lineage records + org keys
│   ├── write-parquet.mjs
│   ├── select-pages.mjs    # budget + priority scoring
│   ├── related.mjs         # related-prefix links on prefix pages
│   ├── hubs.mjs            # vendor + country hub pages (compute/render/write)
│   ├── enrich.mjs          # computed context sentences for prefix pages
│   ├── page-template.mjs   # static prefix page HTML
│   ├── generate-pages.mjs  # page writes + sitemaps
│   ├── generate-sitemaps.mjs  # sitemap renderers
│   ├── generate-home.mjs   # FAQ injection into the home page
│   ├── faq.mjs             # FAQ content + schema (single source)
│   ├── copy-static.mjs     # shell copy + esbuild client bundle
│   ├── serve.mjs           # local preview with SPA fallback
│   ├── budget.mjs          # file-count and file-size assertions
│   └── vendor-priority.json
├── public/                 # hand-authored static files (icons, robots, headers)
├── data/refresh.txt        # manual refresh trigger (bump date + push)
├── docs/
├── dist/                   # build output (gitignored — never commit 58k files)
├── wrangler.jsonc
├── package.json
└── .nvmrc                  # 24
```

## Data pipeline

1. **Fetch** the five IEEE registries in parallel, with retries and backoff so builds survive transient network failures (`build/fetch-with-retry.mjs`):
   - `https://standards-oui.ieee.org/oui/oui.csv` (MA-L)
   - `https://standards-oui.ieee.org/oui28/mam.csv` (MA-M)
   - `https://standards-oui.ieee.org/oui36/oui36.csv` (MA-S)
   - `https://standards-oui.ieee.org/iab/iab.csv` (IAB)
   - `https://standards-oui.ieee.org/cid/cid.csv` (CID)
2. **Fetch lineage** (`build/fetch-lineage.mjs`): the runZero mac-tracker history JSON (MIT, updated twice daily) — dated `add`/`change` records per prefix going back to ~1998. Uses the same retry helper as the registries.
3. **Normalize registries**: trim and validate hex assignments; uppercase; derive `prefixLength` (24/28/36 bits), `addressCount`, and `country` (parsed from the address tail); mark `Private`/empty organizations; dedupe; sort by prefix value.
4. **Build lineage** (`build/lineage.mjs`): normalize organization names (case, punctuation), drop `Private`/empty glitches, collapse consecutive identical organizations, and keep prefixes with at least two distinct organizations. `buildFirstSeen` also derives the earliest observed date for every tracked prefix. **Measured 2026-09-12: 5,665 changed prefixes / 14,350 events.**
5. **Write Parquet** (`dist/data/registry.<hash>.parquet`, prefix-trie shards under `dist/data/shards/`, and `lineage.<hash>.parquet`) with `hyparquet-writer`, snappy compression. Registry columns: `prefix`, `prefixLen` (bits), `blockType`, `addressCount`, `orgName`, `orgAddress`, `country`, `isPrivate`, `firstSeen`, `lineageCount` (events for changed prefixes), `vendorBlocks`, `vendorAddresses` (global vendor totals repeated per row so a single shard reports correct portfolio stats), `vendorHub` (hub slug for orgs with ≥ 2 blocks — see [thin-content-mitigation](thin-content-mitigation.md); additive, resolved at build time so client links and static hub files always agree). Shards split any prefix group over 1,500 rows by the next hex digit, so hot ranges (IAB under `00:50:C2`, MA-S under `8C:1F:64`) get deep keys while quiet ranges stay shallow. The registry is a few MB, the search index about 1 MB, the trie shards a few MB in total, and the lineage file a few hundred KB; `npm run build` prints current figures.
6. **Emit manifest** (`dist/data/manifest.json`): content-hashed filenames, `generatedAt`, counts by block type, schema version, and lineage source attribution (name, homepage, license, retrieval time).
7. **Budget checks** (`build/budget.mjs`): file-count and file-size assertions — see [Capacity & page budget](#capacity--page-budget).

Caching: `data/manifest.json` and `data/sources-index.json` → `no-cache` (they map to content-hashed files that are replaced every deploy, so a stale copy could reference removed files); `data/*.parquet`, `data/sources/*`, and `assets/*` → `public, max-age=31536000, immutable` (all content-hashed); `favicon.svg`, `robots.txt`, and `sitemap*.xml` → `public, max-age=604800` (a week); generated HTML pages keep `max-age=0, must-revalidate` + ETag so deploys and new prefixes are visible immediately — they reference hashed assets, which makes a longer HTML cache unsafe.

## Source resilience & data refresh

- **Deployed raw cache.** Alongside the Parquet data, the build writes the raw inputs (five IEEE CSVs + `macs.json`, **6 files / ~22 MB**) to `dist/data/sources/` with content-hashed filenames, plus `data/sources-index.json` mapping each logical name to its hashed path, per-file sha256, and a combined `sourceHash`. These files are cached immutably and only fetched by builds and CI, never by pages.
- **Fetch order:** upstream (retries + backoff) → the live site's raw copy (resolved through `data/sources-index.json`) → fail. Because the fallback is served by Cloudflare's own CDN, an IEEE outage or block cannot stop rebuilds; only the very first build has no fallback. `--no-fallback` disables the fallback for local experiments.
- **Daily change detection.** `.github/workflows/data-refresh.yml` runs every morning: it fetches the upstream sources, hashes them, and compares against the deployed `sources-index.json`. A refresh-date bump is committed only when something changed; if the deployed data is from an earlier month it forces a bump anyway, so the site redeploys at least monthly to keep indexed pages current. A no-op day costs ~30s of workflow time and zero build minutes. Pushes made with `GITHUB_TOKEN` do not start other Actions workflows but do reach GitHub Apps, so the commit still triggers Workers Builds.
- **Manual alternatives** (if a mirror is ever needed): Debian's [`ieee-data`](https://salsa.debian.org/debian/ieee-data) package, npm [`oui-data`](https://github.com/silverwind/oui-data) (BSD-2-Clause; MA-L/MA-M/MA-S names, addresses, countries — no IAB/CID), [`jfisbein/ouidb-json`](https://github.com/jfisbein/ouidb-json), Wireshark's `manuf` (GPL-2.0-or-later, derived), and runZero mac-tracker (MIT, already used for lineage).

Schema versioning: the manifest carries `schemaVersion`. The client refuses to run against a newer schema and shows a reload message, so an older cached bundle fails safely instead of querying columns it does not understand. Additive columns are tolerated (`createRegistry` reads known fields only); renames or removals require a version bump (`SUPPORTED_SCHEMA_VERSION` in `src/engine/load.mjs`).

## Prefix lineage

Provenance: [runZero mac-tracker](https://github.com/runZeroInc/mac-tracker) (MIT), which bootstrapped IEEE assignment history from the DeepMAC snapshot and Wireshark/Ethereal archives (~1998 onward) and updates twice daily. Dates are **observation dates** — when a change first appeared in the tracked snapshots — not authoritative legal transfer dates.

Display rules (visual details in [design.md](design.md#prefix-lineage-display)):

- Lineage appears **only for the exact matched prefix**, and only when it has at least two distinct organizations after normalization.
- History is **never inherited from parent or child prefixes**. A /28 carved out of a /24 shows its own history or none; the /24's past is not presented as the /28's lineage. Rationale: allocation/split events do not imply a shared corporate lineage, and inherited history would be misleading.
- Address-only and formatting-only changes (case, punctuation, `Private` glitches) are excluded by `build/lineage.mjs`.
- Events are presented chronologically, labeled as observed dates, with source credit.
- Prefixes without lineage render no timeline (no placeholder).

The data lives in its own Parquet file so it can be updated, attributed, and reasoned about independently of the registry.

## Client engine

- **Loading**: the app fetches `data/manifest.json`, then loads only what the input needs. Full addresses and 6+ hex prefixes select the trie shards whose keys are prefixes of the input (usually one small file); partial prefixes select the shards that extend the input (up to 24, then the full registry). Free-text search and wide batches use the full registry, and only search (which matches former owners) loads the lineage file eagerly. On dynamic deep links an inline head script preloads the manifest and the matching shard(s) before the app bundle runs, and `loadRegistryFor` consumes those promises instead of refetching. Pre-rendered pages do not load any data at all; the embedded record covers the initial render.
- **Lazy lineage**: registry rows carry `lineageCount`, so a matched prefix without lineage never fetches the ~240 KB lineage file. Changed prefixes load it (before first render, so the timeline is inline and nothing shifts); search loads it for former-owner matching.
- **Lineage**: `createLineageIndex` groups event rows per prefix and exposes `forPrefix(prefix)`; `loadRegistry` returns `{ manifest, registry, lineage }`.
- **Normalization**: strip separators (`:` `-` `.` space), uppercase, validate `[0-9A-F]`, accept 1–12 hex digits.
- **Lookup**: longest-prefix match over 9-hex (MA-S/IAB), 7-hex (MA-M), 6-hex (MA-L/CID), using a first-byte index over sorted prefix arrays.
- **Partials**: 1–5 hex digits return all matching assignments, capped at 500 rows plus a total count; a "show more" reveal re-queries `listPartials` in 500-row chunks (measured render budget in `e2e/measure-limits.mjs`), never refetching data, and a "show all" beside it renders every match in one pass — suffixed "(slow)" past 1,500 rows, where that rebuild measures 2.2 s at 1× / 9.4 s at 4× CPU (`e2e/measure-showall.mjs`). Both controls sit in a `<tfoot>` row: the table's own last line, not a button under it.
- **Bit analysis**: I/G bit (multicast), U/L bit (locally administered → likely randomized when unregistered); broadcast (`FF:FF:FF:FF:FF:FF`) and all-zero special cases.
- **VM/hypervisor detection**: known prefix map (VMware, VirtualBox, Microsoft Hyper-V/Virtual PC, Parallels, Xen, QEMU/KVM, Docker).
- **Format conversions**: colon, hyphen, Cisco dot, plain hex, EUI-64, IPv6 link-local.
- **Input routing**: a valid address/prefix is looked up directly; otherwise full MACs are extracted from pasted text; if none are found, the input is treated as a free-text search.
- **Text extraction** (`extractMacs`): colon, hyphen, Cisco-dot, space-separated, and bare 12-hex formats; bare matches require clean boundaries so UUID tails and longer identifiers are ignored; deduped; batch caps at 250 (`MAX_BATCH` in `src/ui/app.mjs`).
- **Free-text search** (`searchRegistry`): matches current organizations, former organizations from lineage, country names and codes, registry types, prefixes, and registration years; all tokens must match; ranked by match quality; capped at 500; results are `noindex`.
- **Summaries** (`summarizeLookups`): batch and extraction views show counts by vendor, randomized addresses, virtual machines, unregistered prefixes, and invalid inputs.
- **Vendor portfolios** (`registry.portfolio`): registered block count and total address space per organization, shown on results with a "View all prefixes" action that navigates to the org's static hub (`/vendor/<slug>`, resolved via the registry's `vendor_hub` column); search-result portfolio lines link there too.

## UI structure

- `src/ui/app.mjs` — wiring: deep-link routing, input routing (address / pasted text / search), lazy data loading, lookup dispatch, history, theme, canonical/robots meta management
- `src/ui/result.mjs` — match / none / partial / batch / search / invalid renderers, summaries, lineage timeline
- `src/ui/router.mjs` — pure URL parsing and canonicalization (`/001A2B`, `?q=a,b`)
- `src/ui/format.mjs` — dates, counts, address ranges, colonization (pure, tested)
- `src/ui/history.mjs` — recent lookups in localStorage (max 50)
- `src/ui/theme.mjs` — system-aware dark mode with explicit override
- `src/ui/clipboard.mjs` — copy buttons with insecure-context fallback
- `public/index.html` — indexable shell (search + FAQ); the app hydrates results on top
- esbuild bundles `app.mjs` + engine + Hyparquet into `dist/assets/app.<hash>.js` (~91 KB); CSS is bundled into one hashed ~18 KB file

## Platform constraints

Verified September 2026 for **Cloudflare Workers Static Assets** (paid plan), custom domain `mac.jasontally.com`.

| Limit | Workers Free | Workers Paid | Notes |
| --- | --- | --- | --- |
| Static asset files per Worker version | 20,000 | **100,000** | Increased Sep 2025; requires Wrangler ≥ 4.34.0 |
| Individual static asset file size | 25 MiB | **25 MiB** | All plans |
| Worker script size | 3 MB | 10 MB | Not used: deployment is assets-only |
| Worker CPU time per request | 10 ms | up to 5 min (configurable) | Static asset requests do not invoke the Worker |
| Requests to static assets | Free, unlimited | Free, unlimited | Worker script invocations are billed |
| `_headers` rules | 100 | 100 | 2,000 characters per line |
| `_redirects` static / dynamic / total | 2,000 / 100 / 2,100 | same | 1,000 characters per rule |
| `run_worker_first` entries | 100 | 100 | Glob patterns; `!` negation supported |

Behavior notes:

- **Static assets are served directly and free** when a request matches a file. There is no Worker script: requests that do not match an asset are handled by the SPA fallback.
- **Range requests**: requests carrying `Range` or `Authorization` do not receive the default `Cache-Control: public, max-age=0, must-revalidate`, and Cloudflare's edge cache treats partial (206) responses as non-cacheable by default. Design for whole-file fetches with content-hashed filenames; treat byte-range reads (Hyparquet over HTTP) as an escape hatch for future large datasets, and verify cache behavior before depending on it.
- **HTML routing** (default `html_handling: auto-trailing-slash`): `/001A2B` serves `001A2B.html` with `200`; `/001A2B.html` and `/001A2B/` redirect to `/001A2B` with `307`. Flat `.html` files are the canonical layout — one file per prefix, no directories.
- **`_headers` rules all apply.** Cloudflare merges the headers of every matching `_headers` rule, so patterns must be non-overlapping — for example `/data/manifest.json` plus `/data/*.parquet`, never a broad `/data/*` alongside. Production testing caught `immutable, no-cache` merged onto the manifest before this was corrected.
- **SPA fallback**: `not_found_handling: "single-page-application"` returns `200 OK` with `index.html` for any unmatched path; the client then decides what to render (lookup result, or `noindex` for unrecognized paths).

## Capacity & page budget

### Registry scale, and why the exact numbers live elsewhere

Assignment counts move on every data refresh, so they are not written down
here. `npm run build` prints the exact totals, per-registry breakdown, and the
file-budget verdict on every run; that output is the source of truth. What
follows is the shape, which is what the budget policy actually depends on.

| Registry | Prefix length | Share of assignments | Block size |
| --- | --- | --- | --- |
| MA-L (OUI) | 24-bit (6 hex) | roughly two-thirds | 16.7M addresses |
| MA-M | 28-bit (7 hex) | around a tenth | 1.0M addresses |
| MA-S | 36-bit (9 hex) | around a tenth | 4,096 addresses |
| IAB | 36-bit (9 hex) | under a tenth | 4,096 addresses |
| CID | 24-bit (6 hex) | a few hundred | 24-bit company IDs, not NIC hardware |

What this means for capacity:

- One pre-rendered page per assignment is currently **about 60% of the paid file
  budget** and several times the free budget.
- Total build output is **under 1 GB across roughly 75,000 files**. Hub and page
  generation each take tens of seconds.
- The paid plan is required to pre-render the full registry; the free plan can
  only pre-render a subset (dev/preview budget: 15,000 pages).
- Growth assumption: MA-L grows ~2,000/year and MA-M/MA-S are growing faster.
  The registry is on a path to 100,000 assignments; device-level data (a
  declined future feature) would add many more potential pages. The page budget
  policy below is designed for that.

### File budget policy

**Hard budget: 90,000 pre-rendered pages** (10% headroom under the 100,000 limit), plus an allowance of up to ~2,000 non-page files.

Expected non-page files:

| Category | Count |
| --- | --- |
| App shell, CSS/JS, icons, manifest | ~30 |
| Parquet data (registry + lineage + trie shards) | 3–300 |
| Raw source copies (CSV + JSON + manifest) | 7 |
| Sitemaps (chunked at 50,000 URLs) | 2–3 |
| `robots.txt`, `_headers`, `_redirects` | ~5 |

Page priority (highest first):

1. **MA-L (all)** — classic OUIs, the overwhelming majority of searches; largest blocks (16.7M addresses each).
2. **MA-M** — 7-hex lookups; 1.0M addresses each.
3. **CID** — only a few hundred files; 24-bit company IDs (not NIC hardware, but cheap to include).
4. **IAB** — several thousand files; 36-bit reserved-range blocks (4,096 addresses each).
5. **MA-S** — several thousand files; 36-bit niche blocks (4,096 addresses each), least likely to be searched directly.

Priority adjustments:

- **Vendor demand**: popular vendors (Apple, Samsung, Intel, Cisco, Espressif, TP-Link, Xiaomi, Raspberry Pi, etc.) rank above block size alone; the seed list lives in `build/vendor-priority.json`.
- **Data quality**: assignments with empty or "Private" organization names are trimmed first.
- **Observed demand**: if analytics are ever added, never drop a prefix whose page received traffic recently while a lower-demand page remains.

Eviction order (budget exceeded): drop pages in reverse priority order — lowest-demand MA-S first, then low-demand IAB, then low-demand MA-M — while never dropping a page with recent traffic and never dropping every page of a registry type.

**Enforcement**: the build fails when the output would exceed `PAGE_BUDGET + NON_PAGE_ALLOWANCE` files, prints the trim list, and expects the priority weights to be reviewed. Default `PAGE_BUDGET` is 90,000 (paid) / 15,000 (free preview), overridable per environment.

Dropped prefixes still work: the client-side engine resolves every assignment, and the SPA fallback serves those URLs with the same UI. Dropping only removes a pre-rendered HTML page — never data or functionality.

**Sitemap policy:** include only pre-rendered pages in `sitemap.xml`.
Non-pre-rendered URLs return the app shell for non-JS crawlers, so listing all
of them risks soft-duplicate signals. The `hubs` scope is the current setting
and is intended to stay: it indexes the pages that matter for discovery without
diluting them against the long tail. The owner monitors Search Console directly.

### 25 MiB file-size strategy

- Full-registry Parquet measured at 3.11 MB + ~240 KB, well under 25 MiB. Measure at build time.
- **Build-time assertion**: any single asset > 20 MiB (5 MiB safety margin) fails the build and triggers sharding instead of shipping.
- **Sharding plan** (implemented): records are partitioned into a prefix trie where any group over 1,500 rows splits by the next hex digit, producing variable-length keys. The client selects shards by prefix relationship (ancestors for full addresses, descendants for partials) and falls back to the full registry beyond 24 shards. Each shard file is content-hashed and cached immutably.
- **Sitemaps** chunk at 50,000 URLs (Google limit), targeting < 10 MiB per file.
- **Never bundle data into the Worker script** (10 MB script limit, cold-start cost). Serve it as a content-hashed static asset fetched directly by the browser.

### Capacity accounting (worst case at 100,000 assignments)

| Item | Files |
| --- | --- |
| Pre-rendered pages (budget capped: prefixes + vendor hubs + country hubs) | 90,000 |
| Parquet data (registry + lineage + search + shards) | 3–300 |
| Raw source copies | 7 |
| Sitemaps (100k URLs) | 3 |
| App shell + static assets | ~30 |
| Reserved headroom | 9,959 |
| **Total** | **100,000** |

Hub classes grow slower than assignments (roughly one new hub per new org reaching
a second block), so the portal/prefix split inside the 90,000 cap self-balances.

## Pre-rendered pages

- Page selection follows the page budget policy above.
- Each page is a flat `<PREFIX>.html` file; Cloudflare's `html_handling` serves it at `/<PREFIX>` and 307-redirects `.html`/trailing-slash variants to the canonical URL.
- Page content: unique vendor record (name, block type, range, address count, country), lineage timeline when present, all format conversions, randomization/VM notes, canonical link, JSON-LD (`WebPage`, vendor `Organization`, `BreadcrumbList`).
- **Related-prefix links** (`build/related.mjs`): same-org siblings (≤ 6), adjacent prefixes (2), same-year cohort (≤ 4), deduped and capped at 12 links per page, targets limited to pre-rendered pages. Sections live inside `#result`, so a follow-up lookup clears them with the card ([thin-content-mitigation](thin-content-mitigation.md)).
- **Per-page context** (`build/enrich.mjs`): at most three computed sentences — portfolio position (`vendorBlocks`/`vendorAddresses`), block-type note for non-MA-L assignments, and a "org's oldest registration" note. English rendered statically; raw params ride in `data-enrich` for the client locale swap. Omitted, never padded, when data is missing.
- **Hub pages** (`build/hubs.mjs`): `/vendor/<slug>` for every org with ≥ 2 blocks (a few thousand; grouping uses the same `normalizeOrgName` key as the portfolio stats, slugs resolve collisions by sorted org key) and `/country/<code>` for every country (a little over a hundred). Complete static tables (no row caps — the plan's sizing holds: Apple 240 KB, US 1.3 MB raw; ~10:1 compression at the edge), lookup form wired via the static-page path, `CollectionPage` + `BreadcrumbList` JSON-LD, canonical URLs, `data-static-page` hydration. Every country-table row is a link: multi-block orgs go to their org hub, single-block orgs (the large majority of rows) to the pre-rendered page of their only block, and both are checked against the page-budget selection so a row never targets the SPA shell.
- **Country rollup index** (`/country`, 2026-09-22): the page over the 127 country pages — one row per country (linked name, ISO code, organizations, blocks, addresses) sorted by address space, with the totals in the lede (blocks and addresses summed; organizations counted **distinct**, since one org can register in several countries). Written as root-level `country.html` beside the `country/` directory so the canonical is extensionless `/country` like `/help` and `/recent`; it leads the `country` sitemap scope, is the breadcrumb parent of every country page (`renderPage`'s `breadcrumbParent`), and is linked from the home page's hub nav (`hub.nav.countries`), plus `/help` and the agent files (`llms.txt`, `help.md`).
- **Vendor rollup index** (`/vendor`, 2026-09-23): the page over every vendor page — one row per organization with two or more blocks (linked name, blocks, addresses) sorted by address space, with the totals in the lede (blocks and addresses summed; one row per organization). Written as root-level `vendor.html` beside the `vendor/` directory so the canonical is extensionless `/vendor`; it leads the `country` sitemap scope alongside `/country` (build.mjs), is the breadcrumb parent of every vendor page (`renderPage`'s `breadcrumbParent`), and is linked from the home page's hub nav (`hub.nav.vendors`), plus `/help` and the agent files (`llms.txt`, `help.md`).
- **Dimension pages** (`build/dimensions.mjs`, 2026-09-25): registry type
  (`/registry/<type>`), first-observed year (`/year/<year>`), region
  (`/region/<slug>`), ownership history (`/history/<year>` and
  `/history/country/<code>`), and successors (`/successor/<slug>`). Vendor,
  country, region, and registry pages include a static SVG allocation line over
  the full 1998–current dataset range; the line is address space on a log1p
  scale, grouped by exact first-observed date, with a pointer tooltip for the
  date and address value. The lineage events also carry the historical `c`
  country from runZero for the history-country views. Dimension detail URLs join
  the sitemap and IndexNow scope in the `country` phase; their indexes lead the
  set through `rollupUrls`.
- **Canonical & alternate URLs (audited 2026-09-22):** every static page is self-referential and points at the exact URL that serves it — `/`, `/help`, `/recent`, the 30 `/lang/{locale}/` homes, prefix pages (uppercase, extensionless), and all hubs; Cloudflare `html_handling` 307s `.html`, trailing-slash and case variants onto those URLs (verified live). The home set carries one identical hreflang cluster (en + 30 locales + `x-default`) in the HTML of all 31 pages and on the sitemap's home entry. The only URLs without a self-canonical are dynamic paths: `not_found_handling: single-page-application` returns the shell at `200` with the shell's own `canonical → /`, and `noindex, follow` is added client-side (`src/ui/app.mjs`). Google reports those as **"Alternate page with proper canonical tag"** — expected for internal search results, which is what the ~22 excluded URLs are (the only non-static internal links are the vendor-hub "Free-text search" links to `/<org name>`; every other internal link resolves to a real file). Nothing to fix: canonical-to-`/` + `noindex` is the sanctioned treatment for internal search results.
- Sitemap order: home, `/help`, `/recent`, hub pages, then prefixes — hubs ahead of the bulk.
- The home page is generated at build time with ten FAQ entries; the visible content and `FAQPage` schema come from a single source (`build/faq.mjs`), and a `WebSite` + `SearchAction` node covers `?q=` deep links.
- Batch (`?q=`) results set `noindex, follow` client-side; single lookups remove it once the URL is canonicalized to `/<prefix>`; unrecognized paths are `noindex` too.
- Security headers (`X-Content-Type-Options`, `Referrer-Policy`, `Permissions-Policy`, `X-Frame-Options`) ship via the `_headers` catch-all rule.
- `sitemap.xml` (index + 50k-URL chunks) lists pre-rendered pages and hubs; `robots.txt` points to it.
- `_redirects` is not used for per-prefix canonicalization (2,100-rule cap); client-side `replaceState` normalizes case and variants instead.
- Long-tail/full-MAC paths return the SPA shell with `200`; the engine renders them after load.
- Pre-rendered pages hydrate without fetching the Parquet data: the app detects `data-prerendered` and only wires copy buttons and history.

## Performance

- Pre-rendered pages fetch only the content-hashed CSS and JS bundles — no Parquet, no data fetch.
- Large hub tables ship every row visible — no caps, `hidden` rows, or reveal script. A chunked form (500 rows visible plus an inline reveal) was tried and removed: simulated 4× CPU throttling predicted several seconds to paint, but a real phone revealed the largest table in well under one second, so the cap was costing more than it saved. Small pages are unaffected either way; static pages ship a chrome-only bundle (`src/ui/static.mjs`, locale chunks shared with the app build). Re-measure with `e2e/measure-showall.mjs` on real hardware before reintroducing any cap.
- Dynamic routes start the manifest and Parquet fetches from an inline head script, in parallel with the app bundle download.
- Content below the result is hidden until a dynamic lookup renders (removing the layout shift from inserting the result card; desktop CLS was 0.296 before this change).
- Asset filenames are content-hashed and cached immutably; the manifest is always revalidated.
- Prefix-trie sharding cuts a dynamic deep link from the 3.1 MB full registry to one small shard (the `001B` example is 30 KB), and lazy lineage keeps the ~240 KB lineage file out of lookups entirely unless the matched prefix changed hands. Measured payload for `/001B21AABBCC` is ~150 KB including JS, CSS, manifest, and shard (vs ~3.35 MB before sharding); changed prefixes add the lineage file.

### Measured limits

Display caps and the batch cap were derived from measurement rather than
guessed. The numbers move with the dataset; the **decisions** below are the
durable part, and the scripts named here regenerate the evidence.

| Limit | Decision | Re-measure with |
| --- | --- | --- |
| Result table display cap | 500 rows for partial listings, with a "(slow)" marker past 1,500. Static hub tables are **uncapped** — every row ships visible | `e2e/measure-limits.mjs`, `e2e/measure-showall.mjs` |
| Batch lookup cap | **250** rows. Rows are cheap; the cost that dominates is the full-registry fallback, which a diverse batch hits anyway past ~100 addresses | `e2e/measure-limits.mjs` |
| Client shard fan-out | `MAX_SHARDS = 24`. Past that, fetching the whole registry is faster than fanning out | `e2e/measure-engine.mjs` |
| Engine compute | Not compute-bound: a `lookup()` is microseconds and even a fuzzy fallback across every vendor name stays well inside a frame | `e2e/measure-engine.mjs` |
| Cap transparency | Totals are always shown with a "showing the first N" note, never silently truncated | — |

Simulated CPU throttling over-predicts paint time on very tall tables by a wide
margin. Measure on real hardware before acting on a Lighthouse score for
`/country/*`.

### MCP endpoint and lookup shards

`/mcp` is a stateless [MCP](https://modelcontextprotocol.io) server over
Streamable HTTP. It exposes one tool, `lookup`, and returns one resolved answer
per call. No key, no auth, no session, and under the 2026-07-28 specification no
`initialize` handshake and no `Mcp-Session-Id` header.

**Why it replaced the text-shard surface.** The previous agent interface was
`data/registry/{key}.txt` plus `data/registry/index.txt`, keyed by a
variable-length hex trie. It was correct and small (23.7 KB largest shard, under
the 30 KB target), but it asked the *model* to run two longest-prefix searches
over free text: find the longest key in a 25.1 KB index, then find the longest
row in that shard. Models did that unreliably, which is what motivated the
change. MCP removes the step rather than simplifying it — the model sends a MAC
address and the edge does the matching, so no index is involved at any point.

**The rule must be host-scoped.** A Snippet rule is zone-wide, so
`http.request.uri.path eq "/mcp"` alone also fires on every other subdomain in
`jasontally.com`. The snippet resolves its shard fetch against the incoming
request's own host, so on the wrong hostname it would 404 every key and report
no vendor for every address. The rule is
`(http.host eq "mac.jasontally.com" and (http.request.uri.path eq "/mcp" or http.request.uri.path eq "/mcp/"))`,
and the snippet independently refuses a host mismatch with a 404. Both come from
`mcpRuleExpression()` in `build/mcp-shards.mjs`, which the build, the snippet
header, and `build/deploy-mcp-snippet.mjs` all share.

**The rule must match the trailing slash too.** Clients disagree on whether to
send `/mcp` or `/mcp/`, and the two forms are different paths to the Rules
engine. With an exact `eq "/mcp"`, a POST to `/mcp/` does not run the snippet at
all: it falls through to the assets-only Worker, and Workers Static Assets
serves GET and HEAD only, so the POST returns `405` with an empty body and none
of the MCP headers. Glama's MCP Inspector Online sends the slashed form, so the
endpoint looked broken while `/mcp` was healthy. A `307` redirect to `/mcp` is
not a fix, because the Streamable HTTP transport must not depend on a client
re-POSTing after a redirect. Match both paths instead.

**Who executes the snippet.** A Cloudflare Snippet, not a Worker. Workers Builds
deploys the Worker; the Snippets product has no wrangler command, so the Snippet
is a separate hand-installed file. The shards publish automatically, the Snippet
does not, and the Snippet carries the shard route table inlined — so the build
compares the generated Snippet against the committed `mcp/snippet.js` and fails
on drift, before the shards are published. That converts the one silent-failure
path left in this design into a build error. See
[mcp-endpoint.md](mcp-endpoint.md) for the pipeline split and install steps.

**Cost model, which is the reason for the choice.** Static asset requests are
free and unlimited, storing assets is free, and Snippet execution is included on
every paid plan. A Worker script is $0.30 per million requests above 10 M per
month, so one trillion lookups per month would be about $300,000 per month. The
snippet is on the rules path and the Worker script never runs, because
`run_worker_first` is not set. Against the live registries this is roughly
14,000 files totalling a few MB, median well under 0.1 KB, with the largest in
the high hundreds of KB in one of three dense clusters. `npm run build` prints
the current figures.

**Shard layout, and the rule that makes it correct.** A MAC is 48 bits, and the
IEEE registries only ever register assignments of 6, 7, or 9 hex characters. One
consequence drives everything:

> Splitting a bucket at depth *d* is lossless if and only if *d* ≤ 6.

A record of length *L* is keyed by its first `min(L, d)` characters, and the
snippet fetches the query's first *d* characters. Those agree exactly when
*L* ≥ *d*. So while *d* stays at or below the shortest registered prefix (6,
MA-L), one fetch is guaranteed to carry every candidate. Past 6, the 6-character
parents are keyed by themselves, land in a different file, and are silently
missed. `planShards` throws if `maxDepth` exceeds 6, and
`test/mcp-shards.test.mjs` asserts it for every entry in the route table.

The build uses **depth 4**, which is the deepest base that fits the file budget:

- `dist/data/mcp/{first-4-hex}.txt` — every record in that 4-character range.
  One file carries the MA-L block, any MA-M inside it, and the MA-S and IAB
  blocks inside those. Roughly 14,000 files, median well under 0.1 KB.
- `dist/data/mcp/catalog.json` — the `tools/list` body.
- Three dense clusters (the IAB and MA-S blocks under `0050C2`, `70B3D`, and
  `8C1F64`) hold thousands of records that all share one 6-character prefix, so
  no prefix key splits them below 174 KB. They are carved to depth 6, the
  ceiling, and a **28-byte** depth table inlined in the snippet routes to them.
  3 files exceed the 30 KB target; the build fails if that count grows.
- Line format is `prefix|blockType|addressCount|country|orgName`. The
  organization name is last so a name containing `|` round-trips without
  escaping, and the snippet splits with four `indexOf` calls and never calls
  `JSON.parse` on shard data. The organization address is omitted; the record
  page carries it and the snippet links that page.

**Why not a separate Worker for `/mcp`.** It would work, and Routes do allow a
second Worker on the same hostname with a more specific pattern
(`mac.jasontally.com/data/mcp/*` beats `mac.jasontally.com/*`). It is not needed,
and it has a cost trap: a Worker *with a script* is billed $0.30 per million
requests, so every lookup would be metered. An *assets-only* Worker on a Custom
Domain subdomain would stay free and would also work, but depth 4 removes the
motivation. Recorded here because the 100,000-file limit is shared per Worker
version, so a future growth of the MCP surface past the main budget is the
trigger to revisit this.

**Rejected layouts, with the reason.** A per-prefix layout (one file per
registered prefix) is correct and its files are tiny, but it does not fit: the
main project already ships tens of thousands of pages, and a file per prefix
would add about as many again, putting the deploy past the 100,000 hard limit
and the 90,000 build budget. It also costs two subrequests per lookup, because a 6-character
and a 9-character candidate live in different files. A 3-hex bucket layout
(1,181 files) is worse than it looks for the reason above: carved past depth 6 it
loses its parents. Measured and rejected: 1,668 files but 1,141 lookups in an
exhaustive sweep returned the wrong prefix or none.

**Verified.** Against the live registries, an exhaustive sweep of all 58,879
registered prefixes — each tested twice, once padded to 12 characters and once
with an address inside the block — returns the same answer as a brute-force
oracle over the whole registry. 117,758 lookups, 0 mismatches, 0 false
positives on unregistered addresses. The build's budget check passes at 77,418
files.

**Version negotiation (bug fixed 2026-10-01).** The guard that refuses an
unsupported protocol version read only the `MCP-Protocol-Version` header and
`_meta`. But `initialize` carries its version in `params.protocolVersion`, and
that is the only place a real client sends it — 2025-03-26 removed the header
requirement from the handshake. So on `initialize` the guard saw `null`, was
skipped, and the reply fell through to a "negotiate down to anything" branch that
substituted `PROTOCOL_VERSION`:

| Requested via `params` | Before | After |
|---|---|---|
| `2025-06-18`, `2025-11-25`, `2026-07-28` | echoed exactly | echoed exactly |
| `2025-03-26`, `2024-11-05` | **200, claimed `2026-07-28`** | 400 `-32022` |
| `1999-01-01`, `bogus` | **200, claimed `2026-07-28`** | 400 `-32022` |
| absent | current | current |

The lie was worse than a refusal, because the header path *did* apply the guard.
A client asking for `2024-11-05` was told the server speaks `2026-07-28`, believed
it, then sent `2024-11-05` on every later request — where it was refused. The same
client was waved through the door and turned away at the counter, with no way to
learn why. `claimedVersion()` now reads `params.protocolVersion` first;
`initialize` echoes the validated value with no fallback branch; a non-string
version is coerced so it is refused rather than treated as absent; and
`params._meta` is read in addition to top-level `_meta`. Seven checks in
`test/mcp-conformance.test.mjs` guard this, and were verified to fail against the
old behaviour by reintroducing it.

**Discovery negotiation (bug fixed 2026-10-02).** `server/discover` returned the
tool catalog, and the catalog carried no `supportedVersions`. That is the field a
2026-07-28 client reads to pick a version, and a client that pins `2026-07-28`
and does not find it fails its own connection with no server-side error to
explain it. Found from a third-party playground: the endpoint connected from its
**stateful** test mode, which handshakes, and failed from **stateless** mode,
which probes. The legacy lane working is what made the endpoint look healthy.

The catalog is now the union of both result shapes: `resultType`,
`supportedVersions`, and `_meta['io.modelcontextprotocol/serverInfo']` next to the
top-level identity fields a 2025-era client reads. `MCP_SUPPORTED_VERSIONS` in
`build/mcp-shards.mjs` is the single source for the snippet's guard and the
advertised list, and a check in `test/mcp-conformance.test.mjs` claims each
advertised version against the endpoint, so the two cannot drift apart.

**Caching hints (bug fixed 2026-10-02).** `resultType: "complete"` is not
decoration. The specification requires servers to include caching hints on every
result that carries it — `ttlMs`, an integer in milliseconds, and `cacheScope`,
`"public"` or `"private"` — and says so for `server/discover` and every list call.

The fix above added `resultType` and the discover fields but not the hints, so the
next fault arrived immediately: the connection succeeded, then the client came
back with **no tools**. A strict validator discards the whole result when the hints
are missing, so the tool list is thrown away with them. The server sees a correct
`200` carrying a good tool list and has nothing to report. The catalog now carries
`ttlMs: 3600000` and `cacheScope: "public"` — the tool list is identical for every
caller and changes only when the build deploys.

The lesson is the one these three bugs share: a client that fails on a strict
validator reports the *symptom it can see*, and "no tools" points at the tool list
rather than at two absent fields. Reach for the validator's own error text before
guessing at the data.

### ARD well-known catalogs

`public/.well-known/ai-catalog.json` and `public/.well-known/ard.json` are
copied into `dist/` as valid ARD 1.0 manifests. Both carry **one entry, the MCP
server**, and both describe it identically.

**Correction (2026-10-01).** These files were first published with an empty
`entries` array, on the reasoning that `/mcp` is "a plain Streamable HTTP
endpoint rather than an ARD entry point, so there is no ARD entry to declare
yet". That reasoning was wrong. ARD defines an MCP Server Card as a first-class
entry type (`application/mcp-server-card+json`), and its own federated example
points the entry `url` straight at an MCP endpoint. Advertising a domain's MCP
servers is the purpose of the catalog, so leaving it empty meant a discovery
crawler found nothing.

Two details the specs forced. The base AI Catalog schema names the media-type
field `mediaType` while ARD names it `type`; they diverged, so both are emitted
with the same value and the manifest validates under either. And the schema
allows exactly one of `url` or `data` per entry, so the entry carries `url` and
no `data`. `representativeQueries` is the field a registry matches against for
intent, so it is filled with the five questions a person would actually ask.
`host.trustManifest` lets a client verify the publisher over TLS, which the
`mac.jasontally.com` certificate supports.

The real JSON also does the job it was originally added for: the assets-only SPA
fallback would otherwise serve `index.html` with `200` at every missing path.
Lighthouse 13.5's experimental Agentic Resource Discovery audit requests
`/.well-known/ai-catalog.json`, treats a `200` response as a catalog, and
reports invalid schema when it receives HTML. `public/_headers` serves both as
`application/ai-catalog+json` with a one-day cache. `test/agent-catalog.test.mjs`
pins the entry against `MCP_ROUTE` and `SITE`, so a route change fails the test
instead of shipping a stale URL.

### How the MCP server is discovered

Four surfaces, three of them invisible to a visitor:

**`robots.txt` carries no discovery directive (corrected 2026-10-01).** It had
an `Agentmap:` entry-source pointer, which ARD's spec does define, alongside a
`<link rel="ai-catalog">` tag. PageSpeed Insights rejected it: "Unknown
directive", two errors, and robots.txt validity is a scored SEO check, so the
audit dropped to 92. RFC 9309 tells parsers to ignore unknown directives, so it
never broke crawling; it only ever cost points. Both lines are removed and
`test/agent-catalog.test.mjs` now checks the file against Google's documented
directive set, so an unrecognised directive fails the build. If a future
`Agentmap` lands in RFC form or in Google's parser, the pointer can come back.

The head tag remains, and it is the better carrier: it is valid HTML that every
agent fetch already parses, and it costs no SEO point.

| Surface | What it does |
|---|---|
| `/.well-known/ai-catalog.json`, `/.well-known/ard.json` | The ARD entry, as above |
| `<link rel="ai-catalog">` in every page head | The pointer the agent-readiness check names |
| `Sitemap:` in `robots.txt` | The crawl map. No discovery directive; see below |
| A footer link on every page | The only human-visible affordance |
| A `#mcp` section on `/help` | The instructions the footer link points at |

**The footer link goes to `/help#mcp`, not to `/mcp`.** `GET /mcp` answers `405`
by design, since the endpoint is POST-only. A browser that followed a footer
link to the endpoint would show a bare method-not-allowed error, so the link text
promises instructions and the destination delivers them. This is asserted in
`test/agent-catalog.test.mjs`.

**No per-page card, badge, or banner.** `docs/architecture.md` already records
that per-page "fetch this URL" notes were tried live on 2026-09-17, validated
with ChatGPT and Claude, and then removed at the owner's request because the
visible note cluttered every page. A link inside the existing footer paragraph
adds no new element, so it does not repeat that mistake. The cost is real and
was measured: about 86 bytes of footer plus 97 bytes of head link, times every
page, is roughly 10 MB added to `dist/`.

**The footer and the `<head>` are written out in five files, not one.** They are
`build/page-template.mjs`, `build/hubs.mjs`, `build/recent.mjs`,
`public/index.html`, and `public/help.html`. Adding the link to only the
page template left it off 4,364 hub, year, region, registry, and recent pages
while every test still passed, because each file had its own copy of the markup.
`test/agent-catalog.test.mjs` now walks all five source files. Both links were
verified present on every built HTML file.

### Privacy policy and terms of service

`public/privacy.html` and `public/terms.html` are static pages at `/privacy` and
`/terms`, in the `core` sitemap scope and tracked for IndexNow. All four URLs
ChatGPT's public MCP registry requires are declared in both ARD manifests under
`metadata`, which is the slot the AI Catalog schema reserves for extensions;
`websiteURL` and `supportURL` point at pages that already existed rather than
new ones.

**The policy is a factual claim about code, so it is tested against the code.**
`test/legal.test.mjs` reads the `localStorage` keys out of `src/` and requires
each to be documented in the policy, so adding a key without documenting it
fails the build. It also asserts the pages admit the host's request metadata
rather than denying it, and that the four registry URLs are present in both
manifests.

**The site previously made a claim that the MCP endpoint made false.** Six places
stated that addresses are never processed by a server: the footer, the FAQ, and
two copies in `llms.txt`. True of the browser app, false of the MCP endpoint,
where the address arrives in a `POST` body and the host sees it. The claim is now
scoped to lookups on the website with the exception named. A privacy policy that
contradicts your own footer is worse than none.

**On the negligence clause, the obvious move is the wrong one.** The owner asked
for the strongest protection against negligence. Waiving *all* negligence would
be the worst version: gross negligence, willful misconduct, and fraud are not
waivable in Florida or anywhere else, so a clause claiming them would be struck
in whole or part, taking the liability cap with it. So the terms release
*ordinary* negligence explicitly, and state plainly that the release stops at the
non-waivable line. The narrower clause is the one more likely to survive. The cap
is the greater of zero or 100 USD, with mandatory consumer rights and non-US
venues preserved.

**One contracting party, defined as "the Operator".** The terms originally named
"the project and the people behind it", which names individuals directly and
undercuts the point of a liability shield. The defined term covers either an
individual or a legal entity, so an LLC can be substituted without rewording.
That substitution is the single largest available protection, because no contract
can move tort liability behind a veil — only a separate entity can.

**No contact email is published, by decision.** The registry list did not
require one, and `test/legal.test.mjs` asserts no email address appears on the
legal pages, so a placeholder that looked real cannot be committed later.

## Sitemap indexing

**Why the sitemap is trimmed.** Google indexed only a subset of the prefix
pages and none of the home or hub pages early on. A sitemap holding every page
is dominated by one homogeneous template, which steers crawl prioritization
toward the prefix-page flood and starves the pages that matter most for
discovery.

**Principle:** the sitemap is a discovery hint, not a directive. Pages stay live
and internally linked regardless, so trimming rows cannot deindex anything
already indexed. Internal linking is what actually carries hub discovery — every
prefix page links its vendor, country, and former-owner hubs plus related
prefixes, and every hub breadcrumbs up to its rollup index.

`SITEMAP_SCOPE` composes cumulatively:

| Value | Adds | Intended role |
| --- | --- | --- |
| `core` | `/`, `/help`, `/recent`, `/privacy`, `/terms`, and the localized homes | The pages that must be indexed first |
| `country` | the country rollups and `/country/<code>` hubs | Country-level discovery |
| `hubs` **(current)** | vendor and former-owner hubs | **The default, and expected to stay** |
| `all` | every prefix page | The long tail; dilutes the above |

The owner monitors Search Console directly and treats the scope as settled
unless that data says otherwise.

Expand by editing the `?? 'hubs'` default in `build/build.mjs` (Workers
Builds runs plain `npm run build`, so the constant is the only carrier) or by
setting `SITEMAP_SCOPE` in the build environment. `sitemapUrlSelection`
(`build/generate-pages.mjs`, unit-tested in `test/sitemap-scope.test.mjs`)
implements the scopes — `core` ⊂ `country` ⊂ `hubs` ⊂ `all`; unknown values
fail the build instead of shipping an empty sitemap.

**If a scope ever stalls:** hold the next one and strengthen internal links
before retrying expansion — for example a home-page module linking top vendor
hubs, or `/recent` rows linking hubs. The IndexNow manifest intersects changed
URLs with the same scope, so newly-added pages ride along in post-deploy pings
rather than needing a separate signal.

## IndexNow is refused by Bing, and it is not a bug in the build

**Symptom.** The deploy log ends with
`indexnow: batch 3628 URLs -> 403 (IndexNow rejected the batch with 403)`.

**What it is.** The engine's own answer, which the old script threw away:

```
403 {"errorCode":"UserForbiddedToAccessSite",
     "message":"User is unauthorized to access the site. Please verify the site
                using the key and try again"}
```

Per the IndexNow documentation, 403 means the key could not be validated. The key
file is correct and is not the problem:

| Check | Result |
| --- | --- |
| `public/<key>.txt` matches the `KEY` constant | yes |
| `https://mac.jasontally.com/<key>.txt` | `200`, `text/plain`, 32 bytes, the key |
| Fetched as `bingbot`, `IndexNow/1.0`, `YandexBot` | all `200` |
| `robots.txt` | `User-agent: * / Allow: /`, so the key file is crawlable |
| Submitted URLs | 3,631, all `https`, all on this host, 214 KB of 3 MB |
| `POST` to `www.bing.com/indexnow` directly | same `403` |

Bing keeps the domain-to-key binding in its own backend and refuses pings until
that binding exists. There is nothing to fix in the request. The binding is
created when Bingbot crawls the key file, or when the owner verifies the domain
in **Bing Webmaster Tools**. Microsoft support confirms this is a back-end
matter they do not debug per site.

**Owner action.** Add `https://mac.jasontally.com` in Bing Webmaster Tools and
verify it by XML file or meta tag. Bing then registers the binding and the next
ping is accepted. Nothing in this repo changes.

**What the build does instead of pretending.** Three things, all in
`build/indexnow.mjs`:

1. Logs the response body on a refusal, because `-> 403` does not say
   `UserForbiddedToAccessSite` and sends you to change a payload that is correct.
2. Checks the *deployed* key file before pinging, so "our fault" and "their
   backend" stop looking identical. A pass is not proof of a working ping.
3. Pings Yandex directly as well as the shared endpoint. `api.indexnow.org`
   validates the key before sharing, so a Bing refusal means Yandex, Seznam and
   Yep are told nothing. With the direct ping, 3,631 URLs reach Yandex
   (`202`) while Bing still refuses (`403`).

**The trap this avoids.** Yandex answers `202 {"success":true}` for the exact
batch Bing rejects. A script that treats any 2xx as success reports a working
IndexNow while Bing has refused every URL.

`test/indexnow.test.mjs` holds the body-in-the-log behaviour, the endpoint
independence, and the split that the batch cap is honoured.

## Multilingual discoverability plan (Tier 1 + Tier 2, 2026-09-18)

The interface translates client-side on shared URLs, which search engines
cannot see. The agreed plan: Tier 3 (localized hub pages) is parked; help-doc
localization waits for prose translations (its body is English-only in the
repo — a mostly-English page under an hreflang cluster invites doorway
treatment).

Terminology note (2026-09-21): this work is framed as *discoverability*,
not "SEO" — the goal is letting people find a utility in their own words.
No brand is promoted as part of the app, and each locale's title leads with
its own native site name (see `src/i18n/discovery.mjs`), because an
English-only brand name would make the tool harder to find for speakers of
other languages. The former `src/i18n/seo.mjs` / `seoFor` are now
`src/i18n/discovery.mjs` / `discoveryFor`.

- **Tier 1 (documentation-level):** `llms.txt` and `help.md`/`help.txt`
  state the 31-language interface and the `/lang/{locale}/` scheme.
- **Tier 2 (shipped scope — the home page only):** every supported locale
  gets a pre-rendered home at `/lang/{locale}/` (`build/lang-pages.mjs`:
  a server-side `i18nSwap` over the built shell's `data-i18n` leaf texts,
  mirroring the client's `applyDom`, plus *authored* per-locale
  title/description in `src/i18n/discovery.mjs` — no machine translation). RTL
  locales get `<html dir="rtl">`; each variant sets `window.__malLocale`
  as the boot-time default (src/i18n/index.mjs), below the visitor's stored
  manual choice in resolution order.
- **hreflang:** every variant (English + 30 locales + `x-default` →
  English) carries the full 32-link alternate cluster in `<head>`
  (`homeAlternates`/`hreflangLinks`), and the sitemap home entry carries
  the same alternates as `xhtml:link` (`renderUrlSet` accepts
  `{ loc, alternates }` entries). Head and sitemap agree.
- **Locale picker:** on `/` and `/lang/*` it navigates between locale twins
  (one language per URL) instead of swapping in place
  (`pickLocalizedUrl` in `src/ui/app.mjs`).
- **Deliberately excluded from hreflang:** `/help` and `/recent` (English
  prose) and all `/{hex}`/hub pages (org names are language-neutral).
  The `/lang/` prefix also avoids colliding with free-text search routes
  (`/es` alone stays a search query).
- **Note (2026-09-18):** hub and `/recent` pages swap their `<title>` and
  `<h1>` client-side after boot (`title.vendorHub`/`title.formerHub`/
  `title.countryHub`/`title.recent` + `hub.h1.*` keys; static HTML stays
  English for crawlers, same contract as all `data-i18n` content). Dates
  render with the active locale's short months via `Intl.DateTimeFormat`
  for non-`en` (`src/ui/format.mjs`); English keeps the fixed
  `DD MMM YYYY` table that build-time rendering depends on. Country names
  remain English (language-neutral data).
- **Note (2026-09-21):** the brand localizes — `nav.brand` (header
  wordmark + breadcrumb home link) and every `title.*` suffix use each
  locale's own site name (e.g. German "MAC-Adressen-Suche"), matching the
  head phrase of the authored home titles in `src/i18n/discovery.mjs`. The
  English "MAC Address Lookup" remains the canonical name in crawlable
  HTML, JSON-LD, `og:site_name`, and the fallback `en` table.
- **Punctuation policy (2026-09-21):** no em dashes in generated or UI
  strings (the project's docs still use them in running prose). Titles
  separate the page part from the brand with `|`; the identifier inside a
  title is parenthesized (`00:1A:2B (Intel Corporate)`); peer items inside
  one string separate with ` · `; spec/definition clauses use `:`;
  appositive clauses use `,`; two independent clauses use `, and` or a
  sentence split; empty-value table cells render `-`. Exception: the IEEE
  registry data (org names/addresses) keeps its em dashes verbatim, as do
  Slavic-language copula dashes in ru/uk translations.

## Build & deployment

- **Pipeline:** the GitHub repo is connected to the Worker via Workers Builds. A push to `main` triggers build + deploy. Build command: `npm run build` (fetch IEEE registries → normalize → Parquet → pre-render pages → sitemap/robots → budget checks). Dependencies install automatically. Deploy command: `npx wrangler deploy && node build/indexnow.mjs` (deploy, then the post-deploy IndexNow ping — see below; the deploy command is configured in the Cloudflare dashboard, Workers & Pages → project → Settings → Build). No GitHub Actions required for deploys; the daily data-refresh workflow only commits the refresh bump, and Cloudflare's build does the rest.
- **Node version:** build image defaults to Node 24.18.0; pin with `.nvmrc` (`24`).
- **Deterministic builds & per-URL lastmod:** every data-without-code-change build renders byte-identical HTML. Two ties were cut for this: all build-time "now" stamps (`generatedAt`, `retrievedAt`, sitemap lastmod) come from `data/refresh.txt` instead of the wall clock, and per-page content hashes live in `dist/data/page-hashes.json` (`build/page-hashes.mjs`). Each build hashes every pre-rendered page; the **next** build fetches that manifest from production, so a URL keeps its previous `<lastmod>` when its bytes are unchanged and only re-dates (to the current refresh date) when its content actually changed. The sitemap resolves per-URL lastmod through this map (`writeSitemaps({ ..., lastmodFor })`) — for the entire core scope today and ready to cover every page when the sitemap expands. Byte-stable output also means Cloudflare's content-hash dedupe uploads only files that really changed on data-refresh deploys, keeping edge caches warm for unchanged pages. `data/page-hashes.json` currently tracks 62,762 URLs at ~6.2 MB; if that grows unwieldy as the sitemap expands, the manifest can move behind a build env fallback without changing the contract.
- **Per-page change dates (2026-09-21):** the same hash manifest is the single source of truth for page freshness off the sitemap too. Prefix pages, hubs, and `/recent` embed each page's own last-change date twice — a footer `<time>` line ("Data refreshed <date>") and JSON-LD `dateModified` (prefix pages as `Dataset`, hubs as `CollectionPage`) — and always the same date as that URL's sitemap `<lastmod>`. Renderers use a two-pass contract (`render → record → re-render with the refresh date only if the bytes differ from the deployed page`), so an unchanged page keeps byte-identical output (and its old date), while a changed page converges to `dateModified = lastmod = refreshDate`. No wall-clock stamps, no per-refresh footers (a changed footer date on an otherwise unchanged page would re-date everything and teach Google the dates are meaningless), and the IEEE registration dates on a page are never reused as `dateModified` or `datePublished` (they describe the data, not the page). The home/help shells carry no static dates; their client-filled date (`manifest.refreshDate`) describes the dataset refresh, not the page.
- **IndexNow (post-deploy, Cloudflare-side):** `build/indexnow.mjs` runs after `wrangler deploy` (much of the deployed set is chunked ≤10,000 URLs per POST to `api.indexnow.org`; the key/ownership file lives at `/{key}.txt` from `public/`). The build emits `dist/data/indexnow.json` = the URLs whose bytes changed this build, intersected with the current sitemap scope (finalizePageHashes) — so the ping covers exactly changed pages the sitemap already promotes, and sends an empty manifest when nothing changed (Bing, Yandex, Seznam, Yep consume IndexNow; Google does not). Ping failures never fail the deploy. Regenerate the og-card (og:image/twitter:card on every page) with `node build/make-og-card.mjs` when the site copy changes.
- **Manual data refresh:** bump the date in `data/refresh.txt` and push; the commit triggers a rebuild that re-fetches the registries. The **daily** GitHub Action does this automatically when sources change (see [Source resilience & data refresh](#source-resilience--data-refresh)), and forces a monthly refresh so indexed pages stay current.
- **Local development:** `npm install`; `npm run build` (or `npm run build -- --no-pages` for quick iterations, `PAGE_BUDGET=500 npm run build` to limit pages); `npm run serve` previews `dist/` at `http://localhost:8788` with the SPA fallback (or set `E2E_BASE_URL=http://localhost:8788` for `npm run test:e2e`); `npm test` runs the unit tests; `node build/check-sources.mjs` performs the weekly source check locally.
- **Limits:** 3,000 build min/month free, 6,000 paid (+$0.005/min after); 20-minute build timeout; concurrent builds 1 free / 6 paid; paid build environment: 4 vCPU / 8 GB RAM / 20 GB disk.
- **Runtime cost:** static asset requests are free and unlimited; an assets-only deployment has no billed Worker invocations.
- **Measured duration:** ~6 minutes end-to-end for 62,763 files / ~753 MB (2026-09-16), comfortably inside the 20-minute timeout. Added page weight grows roughly linearly with the registry; the page budget (or a `PAGE_BUDGET` build variable) bounds upload time.
- **No in-app analytics:** page-priority demand comes from the seed vendor list. The Cloudflare zone injects a Web Analytics beacon — see the analytics disclosure note in the open items.
## Production verification

Checks worth re-running after a deploy. Each one exists because its failure
mode is silent.

- Build + deploy completes, and the asset count matches what the build printed.
- Security headers applied; `/data/manifest.json` served `no-cache`; content-hashed
  assets and Parquet served immutable.
- `.html` and trailing-slash variants `307` to canonical URLs; unmatched paths return
  `200` + the SPA shell.
- Pre-rendered pages fetch only `app.css` + `app.js`, no Parquet; dynamic paths load
  the hashed data files.
- `npm run mcp:conformance` passes against the live endpoint. This is the only
  check that catches a zone running a stale Snippet or a rule that lost its host
  term.
- The official conformance runner supports 2026-07-28 via `--requirements`. An
  earlier note in this repository said it did not, quoting a `Valid versions`
  list without `2026-07-28`; that has been corrected in
  [docs/mcp-endpoint.md](mcp-endpoint.md). Twenty of its 37 required server
  scenarios cover capabilities this endpoint does not implement, which is a
  correct answer rather than a defect. `dns-rebinding-protection` is the one to
  read: it checks `Origin` validation, which the Snippet does not perform. The
  command needs `@0.2.0-alpha.12` pinned; `latest` predates the revision.
- Sitemap and robots live; sitemap accepted by Google Search Console.

## Testing

| Layer | Command | Scope |
| --- | --- | --- |
| MCP wire schema | `npm test` (`test/mcp-wire-schema.test.mjs`) | Every response validated against the pinned 2026-07-28 JSON Schema. The local stand-in for the official runner's `wire-schema-valid` check, which needs an install this environment cannot make. Validates the envelope and then the method-specific definition, since the envelope alone permits almost anything |
| Unit and in-process | `npm test` | Normalization, longest-prefix matching, partial listings, bit flags, VM mapping, batch parsing, MAC extraction, shard selection and grouping, lineage counting, free-text search, vendor portfolios, schema-version guard, page selection, template escaping, sitemap chunking, hub rendering, FAQ injection, the MCP snippet's conformance suite, the shard-layout oracle, and the legal/privacy claims. Node's built-in `node:test`, no test dependencies |
| Browser | `npm run test:e2e` | Playwright specs in `e2e/`: `lookup`, `thin-pages`, `lang-pages`. Against production by default, or a local build with `E2E_BASE_URL=http://localhost:8788` |
| Live MCP | `npm run mcp:conformance` | The deployed `/mcp` endpoint. The only check that catches a stale zone Snippet, a rule that lost its host term, or shards that never reached the edge. Not part of `npm test` because it sends real traffic |
| Load and correctness | `npm run mcp:load` | Drives the deployed endpoint with a real request mix and validates every response against a brute-force oracle. See [MCP endpoint](mcp-endpoint.md) |
| Official conformance | `npx @modelcontextprotocol/conformance@0.2.0-alpha.12 server --url https://mac.jasontally.com/mcp --requirements 2026-07-28` | The 37 server scenarios the 2026-07-28 revision requires, frozen at the revision's release. The strongest gate, and the only check that validates outbound messages against the specification's JSON Schema. Pin the version: `latest` is `0.1.16`, which predates the revision and has no `--requirements` flag. Needs an install, so it is not wired into `npm test`. Coverage and the known gaps are in [MCP endpoint](mcp-endpoint.md) |
| Ad-hoc | `node e2e/<script>.mjs` | `locale-sweep`, `i18n-audit`, the `measure-*` benchmarks, Lighthouse runners |

## Privacy stance

The Cloudflare zone injects the Web Analytics beacon
(`static.cloudflareinsights.com/beacon.min.js` and `/cdn-cgi/rum`). It is
Cloudflare Web Analytics: aggregate, cookieless, no client-side state, no
fingerprinting. The host's processing is governed by Cloudflare's privacy
policy, not by this project.

Every user-facing claim follows one framing, and `test/legal.test.mjs` enforces
it: **the app** sets no cookies, runs no tracking or analytics, and performs
lookups in the browser — **the host** serves static files and collects
aggregate analytics. Claims live in `README.md`, the FAQ (`build/faq.mjs`),
`llms.txt` and `help.md` (`build/agent-files.mjs`), the footer
(`footer.dataNote`), `public/robots.txt`, and the [privacy
policy](https://mac.jasontally.com/privacy).

The one exception is the MCP endpoint: it is an HTTP request, so a submitted
address is visible to the host. That is stated in the privacy policy rather than
glossed over, and the test fails if the exception is ever dropped from the
claim.

## Future work & parked ideas

Residue of `docs/feature-research.md` (deleted after the 2026-09-15
execution pass; the competitive survey and shipped-feature history lived
there and is preserved in the git history of that file).

**Not started:**

- **PWA / offline lookup (medium):** a service worker caching the app shell
  plus previously-fetched shards would make repeat visits work offline, and
  a web app manifest would make it installable. Interacts with the existing
  hashed-asset caching strategy and the manifest-revalidation contract;
  design the SW around hashed filenames before building.

**Parked (only if demand appears):**

- **Notes/tags/favorites on history entries** — inventory-workflow feature
  (Choate-style); still localStorage, still private, but a larger effort
  that only pays off for inventory-style use.
- **Camera/OCR capture of device labels** — heavy dependency for a
  vanilla-JS project; even on-device OCR bundles sit awkwardly with the
  privacy stance.
- **Device-type hints** — declined as unreliable. IEEE registries record who owns
  a prefix, never what devices use it. Vendors span categories (HP: printers,
  PCs, servers; HPE: servers and network gear; Samsung: phones, TVs,
  appliances), contract manufacturers appear across many product types, and one
  vendor's prefixes spread across product lines with no public mapping.
  Third-party category fields and name heuristics are guesses, not
  registrations. If ever added, label it a low-confidence category from a
  curated vendor list, never a claim about a specific device.

**Closed with evidence:**

- **Wireshark manufacturer DB as a second source (2026-09-15):** adds
  nothing. Full overlap check of all 58,257 manuf rows (24/28/36-bit)
  against the deployed registry found **0 prefixes missing**; IEEE remains
  authoritative on names. No pipeline integration warranted.
- **Router default-login directory / DHCP fingerprints** — off-mission or
  not a website feature; declined.
