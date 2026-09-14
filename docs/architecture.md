# Architecture

Consolidated architecture, platform constraints, and capacity plan for the MAC Address Lookup project. All core milestones are complete and deployed (2026-09-12); this document records how the system works and the limits it must stay within.

Related docs: [design language](design.md) · [README](../README.md)

## Overview

A static, assets-only Cloudflare Worker serving a client-side MAC address lookup tool. Pre-rendered HTML pages cover the largest and most-searched IEEE prefixes for SEO; everything else (trimmed long-tail prefixes, full-MAC deep links, batch) is resolved in the browser via the SPA fallback. The registry and its prefix-lineage history ship as two small Parquet files read with Hyparquet. No server code, no API, no in-app analytics.

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
| Data | Apache Parquet files (registry + lineage), read in-browser with Hyparquet; Apache Arrow JS not used |
| SEO | Pre-rendered priority tiers, flat `<prefix>.html` pages, canonical uppercase URLs, sitemap for pre-rendered pages only (provisional) |
| Design | Kumo-inspired semantic tokens, monochrome + status colors, system font stack, system-aware dark mode + toggle |
| Deep links | Path (`/001A2B`) or query (`?q=001A2B`); batch via `?q=a,b,c` (cap 100) |
| Partials | < 6 hex lists matching prefixes, capped at 200 with total count |
| Build/deploy | Cloudflare Workers Builds, push-triggered; manual data refresh by bumping `data/refresh.txt` |
| Analytics | None in the app; seed vendor-demand list drives page priority |

## Repository layout

```
mac-address-lookup/
├── src/                    # client app (committed)
│   ├── engine/             # normalization, lookup, bits, formats, lineage
│   ├── ui/                 # rendering, deep links, batch, history, theme
│   └── styles/             # token layer + component CSS
├── build/                  # Node build pipeline (committed)
│   ├── build.mjs           # orchestrator
│   ├── fetch-registries.mjs  fetch-lineage.mjs
│   ├── normalize.mjs         lineage.mjs
│   ├── write-parquet.mjs
│   ├── select-pages.mjs    # budget + priority scoring
│   ├── page-template.mjs   # static prefix page HTML
│   ├── generate-pages.mjs  # page writes + sitemaps
│   ├── generate-seo.mjs    # sitemap renderers
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

1. **Fetch** the five IEEE registries:
   - `https://standards-oui.ieee.org/oui/oui.csv` (MA-L)
   - `https://standards-oui.ieee.org/oui28/mam.csv` (MA-M)
   - `https://standards-oui.ieee.org/oui36/oui36.csv` (MA-S)
   - `https://standards-oui.ieee.org/iab/iab.csv` (IAB)
   - `https://standards-oui.ieee.org/cid/cid.csv` (CID)
2. **Fetch lineage** (`build/fetch-lineage.mjs`): the runZero mac-tracker history JSON (MIT, updated twice daily) — dated `add`/`change` records per prefix going back to ~1998.
3. **Normalize registries**: trim and validate hex assignments; uppercase; derive `prefixLength` (24/28/36 bits), `addressCount`, and `country` (parsed from the address tail); mark `Private`/empty organizations; dedupe; sort by prefix value.
4. **Build lineage** (`build/lineage.mjs`): normalize organization names (case, punctuation), drop `Private`/empty glitches, collapse consecutive identical organizations, and keep prefixes with at least two distinct organizations. `buildFirstSeen` also derives the earliest observed date for every tracked prefix. **Measured 2026-09-12: 5,665 changed prefixes / 14,350 events.**
5. **Write Parquet** (`dist/data/registry.<hash>.parquet`, prefix-trie shards under `dist/data/shards/`, and `lineage.<hash>.parquet`) with `hyparquet-writer`, snappy compression. Registry columns: `prefix`, `prefixLen` (bits), `blockType`, `addressCount`, `orgName`, `orgAddress`, `country`, `isPrivate`, `firstSeen`, `vendorBlocks`, `vendorAddresses` (global vendor totals repeated per row so a single shard reports correct portfolio stats). Shards split any prefix group over 1,500 rows by the next hex digit, so hot ranges (IAB under `00:50:C2`, MA-S under `8C:1F:64`) get deep keys while quiet ranges stay shallow. **Measured: registry 3.00 MB / 58,694 records; lineage 232 KB; 293 shards totaling 4.15 MB (largest 63 KB, `001B` shard 30 KB).**
6. **Emit manifest** (`dist/data/manifest.json`): content-hashed filenames, `generatedAt`, counts by block type, schema version, and lineage source attribution (name, homepage, license, retrieval time).
7. **Budget checks** (`build/budget.mjs`): file-count and file-size assertions — see [Capacity & page budget](#capacity--page-budget).

Caching: `data/manifest.json` → `no-cache` (it maps to content-hashed filenames that are replaced every deploy, so serving it stale could reference removed files); `data/*.parquet` → `public, max-age=31536000, immutable`; `assets/*` → `immutable` with content-hashed filenames; generated pages keep the platform default (`max-age=0, must-revalidate` + ETag).

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

- **Loading**: the app fetches `data/manifest.json`, then loads only what the input needs. Full addresses and 6+ hex prefixes select the trie shards whose keys are prefixes of the input (usually one small file); partial prefixes select the shards that extend the input (up to 24, then the full registry). Free-text search and wide batches use the full registry. On dynamic deep links an inline head script preloads the manifest and the matching shard(s) before the app bundle runs, and `loadRegistryFor` consumes those promises instead of refetching. Pre-rendered pages do not load any data at all; the embedded record covers the initial render.
- **Lineage**: `createLineageIndex` groups event rows per prefix and exposes `forPrefix(prefix)`; `loadRegistry` returns `{ manifest, registry, lineage }`.
- **Normalization**: strip separators (`:` `-` `.` space), uppercase, validate `[0-9A-F]`, accept 1–12 hex digits.
- **Lookup**: longest-prefix match over 9-hex (MA-S/IAB), 7-hex (MA-M), 6-hex (MA-L/CID), using a first-byte index over sorted prefix arrays.
- **Partials**: 1–5 hex digits return all matching assignments, capped at 200 rows plus a total count.
- **Bit analysis**: I/G bit (multicast), U/L bit (locally administered → likely randomized when unregistered); broadcast (`FF:FF:FF:FF:FF:FF`) and all-zero special cases.
- **VM/hypervisor detection**: known prefix map (VMware, VirtualBox, Microsoft Hyper-V/Virtual PC, Parallels, Xen, QEMU/KVM, Docker).
- **Format conversions**: colon, hyphen, Cisco dot, plain hex, EUI-64, IPv6 link-local.
- **Input routing**: a valid address/prefix is looked up directly; otherwise full MACs are extracted from pasted text; if none are found, the input is treated as a free-text search.
- **Text extraction** (`extractMacs`): colon, hyphen, Cisco-dot, space-separated, and bare 12-hex formats; bare matches require clean boundaries so UUID tails and longer identifiers are ignored; deduped, capped at 100.
- **Free-text search** (`searchRegistry`): matches current organizations, former organizations from lineage, country names and codes, registry types, prefixes, and registration years; all tokens must match; ranked by match quality; capped at 200; results are `noindex`.
- **Summaries** (`summarizeLookups`): batch and extraction views show counts by vendor, randomized addresses, virtual machines, unregistered prefixes, and invalid inputs.
- **Vendor portfolios** (`registry.portfolio`): registered block count and total address space per organization, shown on results with a "View all prefixes" action.
- **Batch**: split on comma/whitespace/newline, dedupe, cap 100, results table (collapses to cards on mobile).

## UI structure

- `src/ui/app.mjs` — wiring: deep-link routing, input routing (address / pasted text / search), lazy data loading, lookup dispatch, history, theme, canonical/robots meta management
- `src/ui/result.mjs` — match / none / partial / batch / search / invalid renderers, summaries, lineage timeline
- `src/ui/router.mjs` — pure URL parsing and canonicalization (`/001A2B`, `?q=a,b`)
- `src/ui/format.mjs` — dates, counts, address ranges, colonization (pure, tested)
- `src/ui/history.mjs` — recent lookups in localStorage (max 50)
- `src/ui/theme.mjs` — system-aware dark mode with explicit override
- `src/ui/clipboard.mjs` — copy buttons with insecure-context fallback
- `public/index.html` — indexable shell (search + FAQ); the app hydrates results on top
- esbuild bundles `app.mjs` + engine + Hyparquet into `dist/assets/app.<hash>.js` (~86 KB); CSS is bundled into one hashed ~14 KB file

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
| MA-L (OUI) | 24-bit (6 hex) | 40,130 |
| MA-M | 28-bit (7 hex) | 6,584 |
| MA-S | 36-bit (9 hex) | 7,186 |
| IAB | 36-bit (9 hex) | 4,575 |
| CID | 24-bit (6 hex) | 219 |
| **Total** | | **58,694** |

Measured from a live build on 2026-09-12 (3 cross-registry duplicates skipped).

- One pre-rendered page per assignment = **58,694 files today**: 64% of the paid file budget, but 293% of the free budget.
- Build output: **~451 MB across 58,707 files**; page generation 2.8s; sitemaps 50,000 + 8,695 URLs (4.8 MB + 0.9 MB).
- The paid plan is required to pre-render the full registry; the free plan can only pre-render a subset (dev/preview budget: 15,000 pages).
- Growth assumption: MA-L grows ~2,000/year and MA-M/MA-S are growing faster. The registry is on a path to 100,000 assignments; device-level data (future feature) would add many more potential pages. The page budget policy below is designed for that.

### File budget policy

**Hard budget: 90,000 pre-rendered pages** (10% headroom under the 100,000 limit), plus an allowance of up to ~2,000 non-page files.

Expected non-page files:

| Category | Count |
| --- | --- |
| App shell, CSS/JS, icons, manifest | ~30 |
| Parquet data (registry + lineage + trie shards) | 3–300 |
| Sitemaps (chunked at 50,000 URLs) | 2–3 |
| `robots.txt`, `_headers`, `_redirects` | ~5 |

Page priority (highest first):

1. **MA-L (all)** — classic OUIs, the overwhelming majority of searches; largest blocks (16.7M addresses each).
2. **MA-M** — 7-hex lookups; 1.0M addresses each.
3. **CID** — only 219 files; 24-bit company IDs (not NIC hardware, but cheap to include).
4. **IAB** — 4,575 files; 36-bit reserved-range blocks (4,096 addresses each).
5. **MA-S** — 7,186 files; 36-bit niche blocks (4,096 addresses each), least likely to be searched directly.

Priority adjustments:

- **Vendor demand**: popular vendors (Apple, Samsung, Intel, Cisco, Espressif, TP-Link, Xiaomi, Raspberry Pi, etc.) rank above block size alone; the seed list lives in `build/vendor-priority.json`.
- **Data quality**: assignments with empty or "Private" organization names are trimmed first.
- **Observed demand**: if analytics are ever added, never drop a prefix whose page received traffic recently while a lower-demand page remains.

Eviction order (budget exceeded): drop pages in reverse priority order — lowest-demand MA-S first, then low-demand IAB, then low-demand MA-M — while never dropping a page with recent traffic and never dropping every page of a registry type.

**Enforcement**: the build fails when the output would exceed `PAGE_BUDGET + NON_PAGE_ALLOWANCE` files, prints the trim list, and expects the priority weights to be reviewed. Default `PAGE_BUDGET` is 90,000 (paid) / 15,000 (free preview), overridable per environment.

Dropped prefixes still work: the client-side engine resolves every assignment, and the SPA fallback serves those URLs with the same UI. Dropping only removes a pre-rendered HTML page — never data or functionality.

**Sitemap policy (provisional):** include only pre-rendered pages in `sitemap.xml`. Non-pre-rendered URLs return the app shell for non-JS crawlers, so listing all of them risks soft-duplicate signals. Re-evaluate once Search Console shows how the long-tail pages render and index.

### 25 MiB file-size strategy

- Full-registry Parquet measured at 2.82 MB + 232 KB, well under 25 MiB. Measure at build time.
- **Build-time assertion**: any single asset > 20 MiB (5 MiB safety margin) fails the build and triggers sharding instead of shipping.
- **Sharding plan** (implemented): records are partitioned into a prefix trie where any group over 1,500 rows splits by the next hex digit, producing variable-length keys. The client selects shards by prefix relationship (ancestors for full addresses, descendants for partials) and falls back to the full registry beyond 24 shards. Each shard file is content-hashed and cached immutably.
- **Sitemaps** chunk at 50,000 URLs (Google limit), targeting < 10 MiB per file.
- **Never bundle data into the Worker script** (10 MB script limit, cold-start cost). Serve it as a content-hashed static asset fetched directly by the browser.

### Capacity accounting (worst case at 100,000 assignments)

| Item | Files |
| --- | --- |
| Pre-rendered pages (budget capped) | 90,000 |
| Parquet data (registry + lineage + shards) | 3–300 |
| Sitemaps (100k URLs) | 3 |
| App shell + static assets | ~30 |
| Reserved headroom | 9,966 |
| **Total** | **100,000** |

## Page generation & SEO

- Page selection follows the page budget policy above.
- Each page is a flat `<PREFIX>.html` file; Cloudflare's `html_handling` serves it at `/<PREFIX>` and 307-redirects `.html`/trailing-slash variants to the canonical URL.
- Page content: unique vendor record (name, block type, range, address count, country), lineage timeline when present, all format conversions, randomization/VM notes, canonical link, JSON-LD (`WebPage`, vendor `Organization`, `BreadcrumbList`).
- The home page is generated at build time with ten FAQ entries; the visible content and `FAQPage` schema come from a single source (`build/faq.mjs`), and a `WebSite` + `SearchAction` node covers `?q=` deep links.
- Batch (`?q=`) results set `noindex, follow` client-side; single lookups remove it once the URL is canonicalized to `/<prefix>`; unrecognized paths are `noindex` too.
- Security headers (`X-Content-Type-Options`, `Referrer-Policy`, `Permissions-Policy`, `X-Frame-Options`) ship via the `_headers` catch-all rule.
- `sitemap.xml` (index + 50k-URL chunks) lists pre-rendered pages; `robots.txt` points to it.
- `_redirects` is not used for per-prefix canonicalization (2,100-rule cap); client-side `replaceState` normalizes case and variants instead.
- Long-tail/full-MAC paths return the SPA shell with `200`; the engine renders them after load.
- Pre-rendered pages hydrate without fetching the Parquet data: the app detects `data-prerendered` and only wires copy buttons and history.

## Performance

- Pre-rendered pages fetch only the content-hashed CSS and JS bundles — no Parquet, no data fetch.
- Dynamic routes start the manifest and Parquet fetches from an inline head script, in parallel with the app bundle download.
- Content below the result is hidden until a dynamic lookup renders (removing the layout shift from inserting the result card; desktop CLS was 0.296 before this change).
- Asset filenames are content-hashed and cached immutably; the manifest is always revalidated.
- Prefix-trie sharding cuts a dynamic deep link from the 3.0 MB full registry to one small shard (the `001B` example is 30 KB); measured payload for `/001B21AABBCC` is ~390 KB including JS, CSS, lineage, and manifest. The remaining largest asset is the 232 KB lineage file; deferring it (via a small lineage-prefix index) is the next optimization if cold loads need to be smaller.

## Build & deployment

- **Pipeline:** the GitHub repo is connected to the Worker via Workers Builds. A push to `main` triggers build + deploy. Build command: `npm run build` (fetch IEEE registries → normalize → Parquet → pre-render pages → SEO artifacts → budget checks). Dependencies install automatically. Deploy command: `npx wrangler deploy` (default). No GitHub Actions required.
- **Node version:** build image defaults to Node 24.18.0; pin with `.nvmrc` (`24`).
- **Manual data refresh:** bump the date in `data/refresh.txt` and push; the commit triggers a rebuild that re-fetches the registries. A manual build can also be triggered through the Workers Builds API if needed later.
- **Limits:** 3,000 build min/month free, 6,000 paid (+$0.005/min after); 20-minute build timeout; concurrent builds 1 free / 6 paid; paid build environment: 4 vCPU / 8 GB RAM / 20 GB disk.
- **Runtime cost:** static asset requests are free and unlimited; an assets-only deployment has no billed Worker invocations.
- **Measured duration:** ~5 minutes end-to-end for 58,707 files / ~448 MB (2026-09-12), comfortably inside the 20-minute timeout. If the file set grows, the page budget (or a `PAGE_BUDGET` build variable) bounds upload time.
- **No in-app analytics:** page-priority demand comes from the seed vendor list. Note: the Cloudflare zone injects a Web Analytics beacon — see open items.

## Production verification (2026-09-12)

- Build + deploy: 58,701 assets uploaded; ~5 minutes end-to-end.
- Security headers applied; `/data/manifest.json` served `no-cache`; Parquet served immutable.
- `.html` and trailing-slash variants return `307` to canonical URLs; unmatched paths return `200` + SPA shell.
- Pre-rendered pages fetch only `app.css` + `app.js` (no Parquet); dynamic paths load the hashed Parquet files.
- Sitemap and robots live; sitemap accepted by Google Search Console.

## Testing

- Unit tests for normalization, longest-prefix matching, partial listing, bit flags, VM mapping, batch parsing, MAC extraction (including newline-collapsed text and UUID tails), input classification, shard selection and shard grouping, free-text search, summaries, vendor portfolios, country names, schema-version guard, page selection/scoring, template escaping, sitemap chunking, and FAQ injection (Node's built-in `node:test`, no dependencies).
- Synthetic fixtures only; no network access in tests.
- Browser verification during development with Playwright against the local preview server (deep links, hydration skip, batch indexing rules, mobile overflow).

## Open items

1. **Cloudflare Web Analytics beacon:** the zone injects `static.cloudflareinsights.com/beacon.min.js` and `/cdn-cgi/rum`. Keep (cookieless, aggregate) or disable in the dashboard; site copy says addresses are never sent to a server and no cookies are set.
2. Monitor Search Console indexing; re-evaluate the provisional sitemap policy if the page budget ever trims long-tail pages.
3. CID pages are included while they fit the budget (219 files); revisit only if the budget binds.
