# Deployment Constraints & Capacity Plan

Target platform: **Cloudflare Workers Static Assets** (paid plan), custom domain `mac.jasontally.com`.

This document tracks the platform limits the architecture must stay within, the current data scale, and the policy for choosing which prefixes get a pre-rendered static page.

## Platform limits (verified September 2026)

| Limit | Workers Free | Workers Paid | Notes |
| --- | --- | --- | --- |
| Static asset files per Worker version | 20,000 | **100,000** | Increased Sep 2025; requires Wrangler ≥ 4.34.0 |
| Individual static asset file size | 25 MiB | **25 MiB** | All plans |
| Worker script size | 3 MB | 10 MB | Keep Worker thin; data lives in assets, not the bundle |
| Worker CPU time per request | 10 ms | up to 5 min (configurable) | Static asset requests do not invoke the Worker |
| Requests to static assets | Free, unlimited | Free, unlimited | Worker script invocations are billed |
| `_headers` rules | 100 | 100 | 2,000 characters per line |
| `_redirects` static / dynamic / total | 2,000 / 100 / 2,100 | same | 1,000 characters per rule |
| `run_worker_first` entries | 100 | 100 | Glob patterns; `!` negation supported |

Behavior notes:

- **Static assets are served directly and free** when a request matches a file. There is no Worker script: requests that do not match an asset are handled by the SPA fallback.
- **Range requests**: requests carrying `Range` or `Authorization` do not receive the default `Cache-Control: public, max-age=0, must-revalidate`, and Cloudflare's edge cache treats partial (206) responses as non-cacheable by default. Design for whole-file fetches with content-hashed filenames; treat byte-range reads (Hyparquet over HTTP) as an escape hatch for future large datasets, and verify cache behavior before depending on it.
- **HTML routing** (default `html_handling: auto-trailing-slash`): `/001A2B` serves `001A2B.html` with `200`; `/001A2B.html` and `/001A2B/` redirect to `/001A2B` with `307`. Flat `.html` files are the canonical layout — one file per prefix, no directories.
- **`not_found_handling`**: options are `none` (default), `404-page`, and `single-page-application`. **Decision: `single-page-application`** — Cloudflare returns `200 OK` with `index.html` for any unmatched path, and the client renders the lookup result. There is no Worker script; the deployment is assets-only (see below).
- **No Worker script.** The deployment is static assets only. Requests that match an asset are served directly and free; everything else falls back to the SPA shell. Unmatched-prefix pages therefore depend on client-side JavaScript for content.

## Current registry scale (September 2026)

| Registry | Prefix length | Assignments |
| --- | --- | --- |
| MA-L (OUI) | 24-bit (6 hex) | 40,130 |
| MA-M | 28-bit (7 hex) | 6,584 |
| MA-S | 36-bit (9 hex) | 7,186 |
| IAB | 36-bit (9 hex) | 4,575 |
| CID | 24-bit (6 hex) | 219 |
| **Total** | | **58,694** |

Measured from a live build on 2026-09-12 (3 cross-registry duplicates skipped).

- One pre-rendered page per assignment = **58,694 files today**: 59% of the paid budget, but 293% of the free budget.
- The paid plan is required to pre-render the full registry; the free plan can only pre-render a subset (dev/preview budget: 15,000 pages).
- Growth assumption: MA-L grows ~2,000/year and MA-M/MA-S are growing faster. The registry is on a path to 100,000 assignments; device-level data (future feature) would add many more potential pages. The page budget policy below is designed for that.

## File budget policy

**Hard budget: 90,000 pre-rendered pages** (10% headroom under the 100,000 limit), plus an allowance of up to ~2,000 non-page files.

Expected non-page files:

| Category | Count |
| --- | --- |
| App shell, CSS/JS, icons, manifest | ~30 |
| Parquet data (registry + lineage, or 256 shards if ever needed) | 2–256 |
| Sitemaps (chunked at 50,000 URLs) | 2–3 |
| `robots.txt`, `_headers`, `_redirects`, `404.html` | ~5 |

### Page priority (highest first)

1. **MA-L (all)** — classic OUIs, the overwhelming majority of searches; largest blocks (16.7M addresses each).
2. **MA-M** — 7-hex lookups; 1.0M addresses each.
3. **CID** — only 219 files; 24-bit company IDs (not NIC hardware, but cheap to include).
4. **IAB** — 4,575 files; 36-bit reserved-range blocks (4,096 addresses each).
5. **MA-S** — 7,186 files; 36-bit niche blocks (4,096 addresses each), least likely to be searched directly.

Priority adjustments:

- **Vendor demand**: popular vendors (Apple, Samsung, Intel, Cisco, Espressif, TP-Link, Xiaomi, Raspberry Pi, etc.) rank above block size alone; seed list first, observed analytics later.
- **Data quality**: assignments with empty or "Private" organization names are trimmed first.
- **Observed demand**: once analytics are available, never drop a prefix whose page received traffic in the last N days while a lower-demand page remains.

### Eviction order (budget exceeded)

Drop pages in reverse priority order — lowest-demand MA-S first, then low-demand IAB, then low-demand MA-M — while:

- never dropping a page with recent traffic, and
- never dropping every page of a registry type.

**Enforcement**: the build fails when `assets/` would exceed `PAGE_BUDGET + NON_PAGE_ALLOWANCE` files, prints the trim list, and expects the priority weights to be reviewed. Default `PAGE_BUDGET` is 90,000 (paid) / 15,000 (free preview), overridable per environment.

### Dropped prefixes still work

A prefix without a pre-rendered page remains fully functional:

- the client-side lookup engine resolves every assignment in the dataset, and
- the SPA fallback serves those URLs with the same UI.

Dropping only removes a pre-rendered HTML page — never data or functionality.

**Sitemap policy (provisional):** include only pre-rendered pages in `sitemap.xml` initially. Non-pre-rendered URLs return the app shell for non-JS crawlers, so listing all of them risks soft-duplicate signals. Re-evaluate once Search Console shows how the long-tail pages render and index.

## 25 MiB file-size strategy

- Estimated full-registry Parquet: **1–3 MB** (dictionary-encoded, snappy/zstd), well under 25 MiB. Measured 2026-09-12: registry 2.82 MB, lineage 232 KB. Measure at build time.
- **Build-time assertion**: any single asset > 20 MiB (5 MiB safety margin) fails the build and triggers sharding instead of shipping.
- **Sharding plan** (only if a dataset outgrows 25 MiB, e.g. device-level data): shard by the first byte of the prefix (`00`–`FF`) with a small `manifest.json` mapping byte range → shard. The client fetches only the shard(s) needed; each shard is content-hashed for long-lived caching.
- **Sitemaps** chunk at 50,000 URLs (Google limit), targeting < 10 MiB per file.
- **Never bundle data into the Worker script** (10 MB script limit, cold-start cost). Serve it as a content-hashed static asset fetched directly by the browser.

## Capacity accounting (worst case at 100,000 assignments)

| Item | Files |
| --- | --- |
| Pre-rendered pages (budget capped) | 90,000 |
| Parquet data (registry + lineage) | 2 |
| Sitemaps (100k URLs) | 3 |
| App shell + static assets | ~30 |
| Reserved headroom | 9,966 |
| **Total** | **100,000** |

## Build & deployment (Cloudflare Workers Builds)

- **Pipeline:** the GitHub repo is connected to the Worker via Workers Builds. A push to `main` triggers build + deploy. Build command: `npm run build` (fetch IEEE registries → normalize → Parquet → pre-render pages → SEO artifacts → budget checks). Deploy command: `npx wrangler deploy` (default). No GitHub Actions required.
- **Node version:** build image defaults to Node 24.18.0; pin with `.nvmrc` (`24`).
- **Manual data refresh:** bump the date in `data/refresh.txt` and push; the commit triggers a rebuild that re-fetches the registries. A manual build can also be triggered through the Workers Builds API if needed later.
- **Limits:** 3,000 build min/month free, 6,000 paid (+$0.005/min after); 20-minute build timeout; concurrent builds 1 free / 6 paid; paid build environment: 4 vCPU / 8 GB RAM / 20 GB disk.
- **Runtime cost:** static asset requests are free and unlimited; an assets-only deployment has no billed Worker invocations.
- **Risk — build duration:** deploying ~58,000 small files may take several minutes of upload time. The tiered page budget bounds this; if the 20-minute timeout is approached, reduce pre-rendered tiers first.
- **No analytics initially:** page-priority demand comes from the seed vendor list. Add privacy-friendly analytics later only if observed demand data is needed.

## Open items

1. Confirm `not_found_handling: "single-page-application"` behavior (200 + shell) in production and verify how long-tail pages render for crawlers via Search Console URL inspection.
2. Confirm redirect handling of `.html` / trailing-slash URL variants in Search Console once live.
3. ~~Decide the fallback architecture~~ **Resolved:** static pre-render + SPA fallback; assets-only deployment (no Worker script).
4. Confirm Workers Paid plan, connect Workers Builds, and pin Wrangler ≥ 4.34.0 plus Node via `.nvmrc`.
5. Decide whether CID assignments get pages (not NIC hardware) — default: include while they fit the budget (219 files).
6. Measure full build time (fetch + generate + upload) against the 20-minute build timeout; trim page tiers if needed.
