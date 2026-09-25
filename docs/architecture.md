# Architecture

Consolidated architecture, platform constraints, and capacity plan for the MAC Address Lookup project. All core milestones are complete and deployed (2026-09-12); this document records how the system works and the limits it must stay within.

Related docs: [design language](design.md) · [README](../README.md)

## Overview

A static, assets-only Cloudflare Worker serving a client-side MAC address lookup tool. Pre-rendered HTML pages cover the largest and most-searched IEEE prefixes so search engines can index them and people can find them; everything else (trimmed long-tail prefixes, full-MAC deep links, is resolved in the browser via the SPA fallback. The registry and its prefix-lineage history ship as two small Parquet files read with Hyparquet. No server code, no API, no in-app analytics. The project is feature-complete; this document is the maintenance reference.

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
| Indexing | Pre-rendered priority tiers, flat `<prefix>.html` pages, canonical uppercase URLs, sitemap for pre-rendered pages only (provisional) |
| Design | Kumo-inspired semantic tokens, monochrome + status colors, system font stack, system-aware dark mode + toggle |
| Deep links | Every single-segment path: `/001A2B`, `/apple`, `/001A2B,005056` (comma-separated batch, cap 250); legacy `?q=` still accepted and canonicalized to the path form |
| Partials | < 6 hex lists matching prefixes, capped at 500 with total count |
| Build/deploy | Cloudflare Workers Builds, push-triggered; manual data refresh by bumping `data/refresh.txt` |
| Analytics | None in the app; seed vendor-demand list drives page priority |

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
5. **Write Parquet** (`dist/data/registry.<hash>.parquet`, prefix-trie shards under `dist/data/shards/`, and `lineage.<hash>.parquet`) with `hyparquet-writer`, snappy compression. Registry columns: `prefix`, `prefixLen` (bits), `blockType`, `addressCount`, `orgName`, `orgAddress`, `country`, `isPrivate`, `firstSeen`, `lineageCount` (events for changed prefixes), `vendorBlocks`, `vendorAddresses` (global vendor totals repeated per row so a single shard reports correct portfolio stats), `vendorHub` (hub slug for orgs with ≥ 2 blocks — see [thin-content-mitigation](thin-content-mitigation.md); additive, resolved at build time so client links and static hub files always agree). Shards split any prefix group over 1,500 rows by the next hex digit, so hot ranges (IAB under `00:50:C2`, MA-S under `8C:1F:64`) get deep keys while quiet ranges stay shallow. **Measured 2026-09-23: registry 3.11 MB / 58,783 records; lineage 232 KB; search index 1.22 MB; 293 shards totaling 4.59 MB.**
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
- **Lazy lineage**: registry rows carry `lineageCount`, so a matched prefix without lineage never fetches the 232 KB lineage file. Changed prefixes load it (before first render, so the timeline is inline and nothing shifts); search loads it for former-owner matching.
- **Lineage**: `createLineageIndex` groups event rows per prefix and exposes `forPrefix(prefix)`; `loadRegistry` returns `{ manifest, registry, lineage }`.
- **Normalization**: strip separators (`:` `-` `.` space), uppercase, validate `[0-9A-F]`, accept 1–12 hex digits.
- **Lookup**: longest-prefix match over 9-hex (MA-S/IAB), 7-hex (MA-M), 6-hex (MA-L/CID), using a first-byte index over sorted prefix arrays.
- **Partials**: 1–5 hex digits return all matching assignments, capped at 500 rows plus a total count; a "show more" reveal re-queries `listPartials` in 500-row chunks (measured render budget in `e2e/measure-limits.mjs`), never refetching data, and a "show all" beside it renders every match in one pass — suffixed "(slow)" past 1,500 rows, where that rebuild measures 2.2 s at 1× / 9.4 s at 4× CPU (`e2e/measure-showall.mjs`). Both controls sit in a `<tfoot>` row: the table's own last line, not a button under it.
- **Bit analysis**: I/G bit (multicast), U/L bit (locally administered → likely randomized when unregistered); broadcast (`FF:FF:FF:FF:FF:FF`) and all-zero special cases.
- **VM/hypervisor detection**: known prefix map (VMware, VirtualBox, Microsoft Hyper-V/Virtual PC, Parallels, Xen, QEMU/KVM, Docker).
- **Format conversions**: colon, hyphen, Cisco dot, plain hex, EUI-64, IPv6 link-local.
- **Input routing**: a valid address/prefix is looked up directly; otherwise full MACs are extracted from pasted text; if none are found, the input is treated as a free-text search.
- **Text extraction** (`extractMacs`): colon, hyphen, Cisco-dot, space-separated, and bare 12-hex formats; bare matches require clean boundaries so UUID tails and longer identifiers are ignored; deduped, capped at 100.
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
- esbuild bundles `app.mjs` + engine + Hyparquet into `dist/assets/app.<hash>.js` (~91 KB); CSS is bundled into one hashed ~16 KB file

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

### Current registry scale (September 2026)

| Registry | Prefix length | Assignments |
| --- | --- | --- |
| MA-L (OUI) | 24-bit (6 hex) | 40,199 |
| MA-M | 28-bit (7 hex) | 6,595 |
| MA-S | 36-bit (9 hex) | 7,195 |
| IAB | 36-bit (9 hex) | 4,575 |
| CID | 24-bit (6 hex) | 219 |
| **Total** | | **58,783** |

Measured from a live build on 2026-09-23 (3 cross-registry duplicates skipped).

- One pre-rendered page per assignment = **58,783 files today**: 64% of the paid file budget, but 294% of the free budget.
- Build output: **~753 MB across 62,763 files** (including the ~22 MB raw source cache); hub generation 2.1s, page generation 4.7s; sitemaps 62,415 URLs (50,000 + 12,415; ~6 MB total). 2026-09-16 measurements; hub counting follows the thin-content plan's budget policy.
- The paid plan is required to pre-render the full registry; the free plan can only pre-render a subset (dev/preview budget: 15,000 pages).
- Growth assumption: MA-L grows ~2,000/year and MA-M/MA-S are growing faster. The registry is on a path to 100,000 assignments; device-level data (future feature) would add many more potential pages. The page budget policy below is designed for that.

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
3. **CID** — only 219 files; 24-bit company IDs (not NIC hardware, but cheap to include).
4. **IAB** — 4,575 files; 36-bit reserved-range blocks (4,096 addresses each).
5. **MA-S** — 7,195 files; 36-bit niche blocks (4,096 addresses each), least likely to be searched directly.

Priority adjustments:

- **Vendor demand**: popular vendors (Apple, Samsung, Intel, Cisco, Espressif, TP-Link, Xiaomi, Raspberry Pi, etc.) rank above block size alone; the seed list lives in `build/vendor-priority.json`.
- **Data quality**: assignments with empty or "Private" organization names are trimmed first.
- **Observed demand**: if analytics are ever added, never drop a prefix whose page received traffic recently while a lower-demand page remains.

Eviction order (budget exceeded): drop pages in reverse priority order — lowest-demand MA-S first, then low-demand IAB, then low-demand MA-M — while never dropping a page with recent traffic and never dropping every page of a registry type.

**Enforcement**: the build fails when the output would exceed `PAGE_BUDGET + NON_PAGE_ALLOWANCE` files, prints the trim list, and expects the priority weights to be reviewed. Default `PAGE_BUDGET` is 90,000 (paid) / 15,000 (free preview), overridable per environment.

Dropped prefixes still work: the client-side engine resolves every assignment, and the SPA fallback serves those URLs with the same UI. Dropping only removes a pre-rendered HTML page — never data or functionality.

**Sitemap policy (provisional):** include only pre-rendered pages in `sitemap.xml`. Non-pre-rendered URLs return the app shell for non-JS crawlers, so listing all of them risks soft-duplicate signals. Re-evaluate once Search Console shows how the long-tail pages render and index.

### 25 MiB file-size strategy

- Full-registry Parquet measured at 3.11 MB + 232 KB, well under 25 MiB. Measure at build time.
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
- **Hub pages** (`build/hubs.mjs`): `/vendor/<slug>` for every org with ≥ 2 blocks (3,472; grouping uses the same `normalizeOrgName` key as the portfolio stats, slugs resolve collisions by sorted org key) and `/country/<code>` for every country (127). Complete static tables (no row caps — the plan's sizing holds: Apple 240 KB, US 1.3 MB raw; ~10:1 compression at the edge), lookup form wired via the static-page path, `CollectionPage` + `BreadcrumbList` JSON-LD, canonical URLs, `data-static-page` hydration. Every country-table row is a link: multi-block orgs go to their org hub, single-block orgs (29,897 of the 33,567 rows) to the pre-rendered page of their only block, and both are checked against the page-budget selection so a row never targets the SPA shell.
- **Country rollup index** (`/country`, 2026-09-22): the page over the 127 country pages — one row per country (linked name, ISO code, organizations, blocks, addresses) sorted by address space, with the totals in the lede (blocks and addresses summed; organizations counted **distinct**, since one org can register in several countries). Written as root-level `country.html` beside the `country/` directory so the canonical is extensionless `/country` like `/help` and `/recent`; it leads the `country` sitemap scope, is the breadcrumb parent of every country page (`renderPage`'s `breadcrumbParent`), and is linked from every footer except its own (`footer.countries`), plus `/help` and the agent files (`llms.txt`, `help.md`).
- **Vendor rollup index** (`/vendor`, 2026-09-23): the page over the 3,472 vendor pages — one row per organization with two or more blocks (linked name, blocks, addresses) sorted by address space, with the totals in the lede (blocks and addresses summed; one row per organization). Written as root-level `vendor.html` beside the `vendor/` directory so the canonical is extensionless `/vendor`; it leads the `country` sitemap scope alongside `/country` (build.mjs), is the breadcrumb parent of every vendor page (`renderPage`'s `breadcrumbParent`), and is linked from every footer except its own (`footer.vendors`), plus `/help` and the agent files (`llms.txt`, `help.md`).
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
- **Canonical & alternate URLs (audited 2026-09-22):** every static page is self-referential and points at the exact URL that serves it — `/`, `/help`, `/recent`, the 30 `/lang/{locale}/` homes, prefix pages (uppercase, extensionless), and all hubs; Cloudflare `html_handling` 307s `.html`, trailing-slash and case variants onto those URLs (verified live). The home set carries one identical hreflang cluster (en + 30 locales + `x-default`) in the HTML of all 31 pages and on the sitemap's home entry. The only URLs without a self-canonical are dynamic paths: `not_found_handling: single-page-application` returns the shell at `200` with the shell's own `canonical → /`, and `noindex, follow` is added client-side (`src/ui/app.mjs`). Google reports those as **"Alternate page with proper canonical tag"** — expected for internal search results, which is what the ~22 excluded URLs are (the only non-static internal links are the 3,472 vendor-hub "Free-text search" links to `/<org name>`; every other internal link resolves to a real file). Nothing to fix: canonical-to-`/` + `noindex` is the sanctioned treatment for internal search results.
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
- Large hub tables ship every row visible — no caps, `hidden` rows, or reveal script. The 2026-09-16 chunked form (500 rows visible + inline reveal) measured `/country/us` mobile at TBT 20 ms / perf **100**; it was removed 2026-09-22 after a real phone revealed all 8,885 rows in well under a second (the lab's simulated 4× CPU over-predicted ~4 s). Post-removal, Lighthouse 13 `--preset=perf` on the local build: `/country/us` mobile **69** (TBT ~10 s), desktop **57** — the giant page's style+layout dominates (Rendering 5.5 s vs Script Evaluation 60 ms), while small pages are untouched (qualcomm hub and /help: 99, TBT 70 ms). Without Lighthouse's filmstrip tracing the same load blocks 0.33 s (mobile 1×) / 0.77 s (desktop 1×), load event ~3.3 s / 2.4 s (own `longtask` trace) — the lab score is dominated by repeated re-layout of a ~355,000-px-tall page under simulated throttle, not by script. LCP/FCP stay ~1.6 s either way; static pages ship a chrome-only bundle (src/ui/static.mjs, shared locale chunks with the app build).
- Dynamic routes start the manifest and Parquet fetches from an inline head script, in parallel with the app bundle download.
- Content below the result is hidden until a dynamic lookup renders (removing the layout shift from inserting the result card; desktop CLS was 0.296 before this change).
- Asset filenames are content-hashed and cached immutably; the manifest is always revalidated.
- Prefix-trie sharding cuts a dynamic deep link from the 3.1 MB full registry to one small shard (the `001B` example is 30 KB), and lazy lineage keeps the 232 KB lineage file out of lookups entirely unless the matched prefix changed hands. Measured payload for `/001B21AABBCC` is ~150 KB including JS, CSS, manifest, and shard (vs ~3.35 MB before sharding); changed prefixes add the lineage file.

### Measured limits (2026-09-15, `e2e/measure-limits.mjs` / `e2e/measure-engine.mjs`)

Display caps and the batch cap were re-derived from measurements instead of
guesses. Method: DOM table render timing in a real browser at 1× and 4× CPU
throttling; engine timing in Node over the real registry; parallel
fetch+worker-decode timing for k shards vs the full registry on the
production edge.

| Measurement | Result | Decision |
| --- | --- | --- |
| Table render, N rows | 200 rows = 10 ms, 1000 = 48 ms, 5000 = 296 ms at 4× CPU | Display caps raised 200 → **500** (23 ms throttled; well below any degradation); static hub tables uncapped 2026-09-22 — every row ships visible |
| Full-reveal "Show all" (`e2e/measure-showall.mjs`, 2026-09-22, mobile viewport) | Hub un-hide: 1,573 rows = 613 ms, 5,402 = 2,891 ms, 8,885 (`/country/us`) = 4,091 ms to paint at 4× CPU (US = 1,018 ms at 1×) — but a real phone ran the same reveal in <1 s, so the throttle over-predicts; `/00` rebuild of 17,394 partial rows = 2,242 ms at 1× / 9,414 ms at 4× | Static hubs uncapped (reveal controls, cap note, and inline script removed); partial listings keep **(slow)** past **1,500 rows** |
| Engine compute | `lookup()` ×2000 = 4 ms; full search incl. fuzzy fallback over 58,700 names = 30–64 ms | Search/token limits are not compute-bound |
| Batch, end-to-end (production) | n=25/50 stay on shards (~370–420 ms); n=100 diverse addresses exceeds the shard union → full-registry fallback (~950 ms cold, dominated by the 3 MB fetch) | Batch cap raised 100 → **250** (rows are cheap; the fallback that dominates cost happens anyway for diverse batches) |
| Shard crossover | 24 parallel shards: fetch 169 ms + decode 63 ms ≈ 130 ms best vs full registry 267 ms; on slow networks the gap widens (336 KB vs 3 MB) | `MAX_SHARDS = 24` confirmed |
| Result cap visibility | totals always shown with a "showing the first N" note | caps stay transparent |

### Agent-facing text shards

For AI agents and scripts that cannot reasonably ingest the 13.6 MB
`registry.ndjson` (verified live: a ChatGPT web tool refuses it at its content-size
limit, and binary Parquet is refused as `application/octet-stream`), the build
also emits the same registry rows as plain-text trie shards:

- `dist/data/registry/{key}.txt` — one JSON object per line (same schema as
  `registry.ndjson`), grouped by the same trie partition as the browser Parquet
  shards but capped at 120 rows per file via `build/write-parquet.mjs`'s
  `buildShardGroups`, so files stay 1–30 KB and stable-name (no content hash,
  unlike the Parquet shards).
- `dist/data/registry/index.txt` — `key<TAB>rows` for every shard, so a tool
  can pick the longest key that is a prefix of its MAC's hex in two small
  fetches (index, then shard).
- Served as `text/plain` (`.txt` extension is enough on Workers assets);
  `public/_headers` adds the 1-day cache rule. +2,863 files against the
  100,000-file Worker limit.
- Documented in `llms.txt`, `help.md`/`help.txt` (section *Using the data
  programmatically*), and the README. The worked example is
  `8C:1F:64:AF:A4:B2` → `/data/registry/8c1f64af.txt` → row `8C1F64AFA`.
- **Data links are documented, not displayed:** per-page "fetch this URL"
  notes were tried live (2026-09-17, validated with ChatGPT and Claude) and
  then removed at the owner's request — the visible note cluttered every
  page. Agent access to the shards runs entirely through `llms.txt` and the
  documentation above; the shard URL pattern is in `llms.txt`, so an agent
  reading that file can reconstruct any MAC's shard without fetching the
  index first.
- Verified live 2026-09-17 with the visible-link trial on `/8C1F64AFA`:
  ChatGPT's cached-page web tool and Claude both followed the page link,
  fetched the shard, and completed longest-prefix lookup with proof-of-read
  checks (row count, first row); Gemini cannot follow arbitrary raw-file
  links.

### ARD well-known catalogs

`public/.well-known/ai-catalog.json` and `public/.well-known/ard.json` are
copied into `dist/` as valid ARD 1.0 manifests with an empty `entries` array.
The site currently publishes static data and documentation, not MCP servers,
A2A agents, or skills, so an empty catalog is the accurate advertisement.

The files exist primarily because the assets-only SPA fallback would otherwise
serve `index.html` with `200` at every missing path. Lighthouse 13.5's
experimental Agentic Resource Discovery audit requests
`/.well-known/ai-catalog.json`, treats a `200` response as a catalog, and
reports invalid schema when it receives HTML. Publishing real static JSON
fixes that without adding a Worker or changing the fallback for lookup paths.
`public/_headers` serves both as `application/ai-catalog+json` with a one-day
cache. If agent-callable resources are added later, populate `entries` and keep
the two paths byte-identical until the predecessor path is retired.

## Sitemap indexing plan (phased, 2026-09-17)

**Observed** (Search Console, 2026-09-17): Google indexed only a subset of the
58,696 prefix pages and **none** of the home page or the 4,063 hub pages;
impressions and clicks come exclusively from prefix pages. This matches the
new-low-authority-domain failure mode: a 62,760-URL sitemap dominated by one
homogeneous template steers crawl prioritization toward the prefix-page flood,
starving the pages we most want indexed (home, help, hubs).

**Principle:** the sitemap is a discovery hint, not a directive. Pages stay
live and internally linked in every phase, so trimming rows cannot deindex
anything already indexed, and prefix pages Google already knows about are
unaffected. What actually drives hub discovery without the sitemap is internal
linking — every prefix page links its vendor/country/former hubs and related
prefixes, every country page breadcrumbs up to `/country`, and every footer
carries a Countries link, so the indexed subset keeps the rest of the graph
reachable.

| Phase | `SITEMAP_SCOPE` | Sitemap URLs | Flip when (Search Console gate, user-side) |
| --- | --- | --- | --- |
| 1 | `core` | 33: `/`, `/help`, `/recent` + the 30 localized homes | Home (`site:` query) + `/help` indexed — typically 1–4 weeks |
| 2 (now, the default) | `country` | 162: phase 1 + the `/country` and `/vendor` rollups + the 127 `/country/<code>` hubs | Country hubs entered the sitemap 2026-09-22; the ISO-code fix pruned invalid-code hubs 2026-09-23; watch their coverage |
| 3 | `hubs` | 3,979: phase 2 + 3,472 vendor + 345 former-owner hubs | Hub pages indexing healthily (e.g. ≥ half showing coverage after a few weeks) |
| 4 | `all` (the 2026-09-17 behavior) | ~62,800: everything | Always the end state; prefix pages are the proven traffic source |

Expand by editing the `?? 'country'` default in `build/build.mjs` (Workers
Builds runs plain `npm run build`, so the constant is the only carrier) or by
setting `SITEMAP_SCOPE` in the build environment. `sitemapUrlSelection`
(`build/generate-pages.mjs`, unit-tested in `test/sitemap-scope.test.mjs`)
implements the scopes — `core` ⊂ `country` ⊂ `hubs` ⊂ `all`; unknown values
fail the build instead of shipping an empty sitemap.

**What to monitor in Search Console each phase:** Pages-report coverage for
the newly added URL set, home-page query appearances, and the prefix-page
report continuing unchanged (impressions/clicks should not regress — dropping
sitemap rows does not remove discovered pages). If a scope stalls, hold the
next one and strengthen internal links (e.g. a home-page module linking top
vendor hubs, `/recent` rows linking hubs) before retrying expansion.

**Notes:** (2026-09-18) "core" includes the 30 localized home pages
(`/lang/{locale}/`; see the multilingual plan below), so every scope carries
them (+30 over the pre-multilingual counts). (2026-09-22) the default moved
from `core` to `country` — country hubs are the second-rarest page class, they
are the target of the prefix pages' country links, and the IndexNow manifest
(`finalizePageHashes`) intersects changed URLs with the same scope, so the
country pages now ride along in post-deploy pings too. (2026-09-22, same day)
the country set gained the `/country` rollup index as its first row, so the
scope was 283 URLs (33 core + 1 index + 249 hubs); (2026-09-23) the `/vendor`
rollup joined it — 284 URLs (33 core + 2 indexes + 249 hubs); later the same
day the ISO-code country fix pruned the invalid-code hubs — 162 URLs (33
core + 2 indexes + 127 hubs).

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
- **Punctuation policy (2026-09-21):** no em dashes. Titles separate the
  page part from the brand with `|`; the identifier inside a title is
  parenthesized (`00:1A:2B (Intel Corporate)`); peer items inside one
  string separate with ` · `; spec/definition clauses use `:`; appositive
  clauses use `,`; two independent clauses use `, and` or a sentence
  split; empty-value table cells render `-`. Exception: the IEEE registry
  data (org names/addresses) keeps its em dashes verbatim, as do
  Slavic-language copula dashes in ru/uk translations.

## Build & deployment

- **Pipeline:** the GitHub repo is connected to the Worker via Workers Builds. A push to `main` triggers build + deploy. Build command: `npm run build` (fetch IEEE registries → normalize → Parquet → pre-render pages → sitemap/robots → budget checks). Dependencies install automatically. Deploy command: `npx wrangler deploy && node build/indexnow.mjs` (deploy, then the post-deploy IndexNow ping — see below; the deploy command is configured in the Cloudflare dashboard, Workers & Pages → project → Settings → Build). No GitHub Actions required for deploys; the daily data-refresh workflow only commits the refresh bump, and Cloudflare's build does the rest.
- **Node version:** build image defaults to Node 24.18.0; pin with `.nvmrc` (`24`).
- **Deterministic builds & per-URL lastmod:** every data-without-code-change build renders byte-identical HTML. Two ties were cut for this: all build-time "now" stamps (`generatedAt`, `retrievedAt`, sitemap lastmod) come from `data/refresh.txt` instead of the wall clock, and per-page content hashes live in `dist/data/page-hashes.json` (`build/page-hashes.mjs`). Each build hashes every pre-rendered page; the **next** build fetches that manifest from production, so a URL keeps its previous `<lastmod>` when its bytes are unchanged and only re-dates (to the current refresh date) when its content actually changed. The sitemap resolves per-URL lastmod through this map (`writeSitemaps({ ..., lastmodFor })`) — for the entire core scope today and ready to cover every page when the sitemap expands. Byte-stable output also means Cloudflare's content-hash dedupe uploads only files that really changed on data-refresh deploys, keeping edge caches warm for unchanged pages. `data/page-hashes.json` currently tracks 62,762 URLs at ~6.2 MB; if that grows unwieldy as the sitemap expands, the manifest can move behind a build env fallback without changing the contract.
- **Per-page change dates (2026-09-21):** the same hash manifest is the single source of truth for page freshness off the sitemap too. Prefix pages, hubs, and `/recent` embed each page's own last-change date twice — a footer `<time>` line ("Data refreshed <date>") and JSON-LD `dateModified` (prefix pages as `Dataset`, hubs as `CollectionPage`) — and always the same date as that URL's sitemap `<lastmod>`. Renderers use a two-pass contract (`render → record → re-render with the refresh date only if the bytes differ from the deployed page`), so an unchanged page keeps byte-identical output (and its old date), while a changed page converges to `dateModified = lastmod = refreshDate`. No wall-clock stamps, no per-refresh footers (a changed footer date on an otherwise unchanged page would re-date everything and teach Google the dates are meaningless), and the IEEE registration dates on a page are never reused as `dateModified` or `datePublished` (they describe the data, not the page). The home/help shells carry no static dates; their client-filled date (`manifest.refreshDate`) describes the dataset refresh, not the page.
- **IndexNow (post-deploy, Cloudflare-side):** `build/indexnow.mjs` runs after `wrangler deploy` (much of the deployed set is chunked ≤10,000 URLs per POST to `api.indexnow.org`; the key/ownership file lives at `/{key}.txt` from `public/`). The build emits `dist/data/indexnow.json` = the URLs whose bytes changed this build, intersected with the current sitemap scope (finalizePageHashes) — so the ping covers exactly changed pages the sitemap already promotes, and sends an empty manifest when nothing changed (Bing, Yandex, Seznam, Yep consume IndexNow; Google does not). Ping failures never fail the deploy. Regenerate the og-card (og:image/twitter:card on every page) with `node build/make-og-card.mjs` when the site copy changes.
- **Manual data refresh:** bump the date in `data/refresh.txt` and push; the commit triggers a rebuild that re-fetches the registries. The **daily** GitHub Action does this automatically when sources change (see [Source resilience & data refresh](#source-resilience--data-refresh)), and forces a monthly refresh so indexed pages stay current.
- **Local development:** `npm install`; `npm run build` (or `npm run build -- --no-pages` for quick iterations, `PAGE_BUDGET=500 npm run build` to limit pages); `npm run serve` previews `dist/` at `http://localhost:8788` with the SPA fallback; `npm test` runs the unit tests; `node build/check-sources.mjs` performs the weekly source check locally.
- **Limits:** 3,000 build min/month free, 6,000 paid (+$0.005/min after); 20-minute build timeout; concurrent builds 1 free / 6 paid; paid build environment: 4 vCPU / 8 GB RAM / 20 GB disk.
- **Runtime cost:** static asset requests are free and unlimited; an assets-only deployment has no billed Worker invocations.
- **Measured duration:** ~6 minutes end-to-end for 62,763 files / ~753 MB (2026-09-16), comfortably inside the 20-minute timeout. Added page weight grows roughly linearly with the registry; the page budget (or a `PAGE_BUDGET` build variable) bounds upload time.
- **No in-app analytics:** page-priority demand comes from the seed vendor list. The Cloudflare zone injects a Web Analytics beacon — see the analytics disclosure note in the open items.

## Production verification (2026-09-12)

- Build + deploy: 58,701 assets uploaded; ~5 minutes end-to-end.
- Security headers applied; `/data/manifest.json` served `no-cache`; Parquet served immutable.
- `.html` and trailing-slash variants return `307` to canonical URLs; unmatched paths return `200` + SPA shell.
- Pre-rendered pages fetch only `app.css` + `app.js` (no Parquet); dynamic paths load the hashed Parquet files.
- Sitemap and robots live; sitemap accepted by Google Search Console.

## Testing

- Unit tests for normalization, longest-prefix matching, partial listing, bit flags, VM mapping, batch parsing, MAC extraction (including newline-collapsed text and UUID tails), input classification, shard selection and shard grouping, lineage event counting, free-text search, summaries, vendor portfolios, country names, schema-version guard, page selection/scoring, template escaping, sitemap chunking, and FAQ injection (Node's built-in `node:test`, no dependencies).
- Synthetic fixtures only; no network access in tests.
- Browser verification during development with Playwright against the local preview server (deep links, hydration skip, batch indexing rules, mobile overflow).

## Open items

1. **Analytics disclosure (resolved 2026-09-21):** the Cloudflare zone injects the Web Analytics beacon (`static.cloudflareinsights.com/beacon.min.js` and `/cdn-cgi/rum`). Decision: keep it. It is Cloudflare Web Analytics — privacy-first, aggregate, cookieless (no cookies or localStorage, no fingerprinting per Cloudflare's documentation). All user-facing privacy claims follow one framing: the *app* does no tracking, no cookies, and lookups are **processed in the browser and never by a server** (refined 2026-09-23 — the earlier "never leave the browser / never sent to a server" wording was too strong: URL paths of direct links such as `/apple` do reach the CDN, which serves the matching static file without running any search code, and the app fetches its data files by URL); the *host* (Cloudflare) collects privacy-first, cookieless, aggregate web analytics. Claims live in README.md, the on-site FAQ (`build/faq.mjs`), `llms.txt` (`build/agent-files.mjs`), the site footer (`footer.dataNote`), and `public/robots.txt`.
2. Monitor Search Console indexing; re-evaluate the provisional sitemap policy if the page budget ever trims long-tail pages.
3. CID pages are included while they fit the budget (219 files); revisit only if the budget binds.
4. **Device-type hints (not implemented, unlikely to be reliable):** IEEE registries record who owns a prefix, never what devices use it. Vendors span categories (HP: printers, PCs, servers; HPE: servers and network gear; Samsung: phones, TVs, appliances, SSDs), contract manufacturers and module vendors (AzureWave, Wistron, Foxconn) appear in many product types, and a single vendor's prefixes are spread across product lines with no public mapping. Sources that offer categories — for example OUI-Master-Database's `device_type` field, or vendor-name heuristics like "name contains Printer" — are guesses rather than registrations. If this is ever added it should be a clearly labeled low-confidence category derived from a curated vendor list, never a claim about the specific device.

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
- **MCP server** — a separate artifact, not a website feature; the engine is
  plain ES modules so a thin wrapper over the Parquet loader is plausible,
  but any agent that can `curl` already has full access via `llms.txt`.

**Closed with evidence:**

- **Wireshark manufacturer DB as a second source (2026-09-15):** adds
  nothing. Full overlap check of all 58,257 manuf rows (24/28/36-bit)
  against the deployed registry found **0 prefixes missing**; IEEE remains
  authoritative on names. No pipeline integration warranted.
- **Router default-login directory / DHCP fingerprints** — off-mission or
  not a website feature; declined.
