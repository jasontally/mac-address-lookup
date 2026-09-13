# Architecture

Consolidated architecture for the MAC Address Lookup project. Decisions are locked; implementation has not started.

Related docs: [design language](design.md) · [deployment constraints & capacity](deployment-constraints.md) · [README](../README.md)

## Overview

A static, assets-only Cloudflare Worker serving a client-side MAC address lookup tool. Pre-rendered HTML pages cover the largest and most-searched IEEE prefixes for SEO; everything else (trimmed long-tail prefixes, full-MAC deep links, batch) is resolved in the browser via the SPA fallback. The IEEE registry ships as a single Parquet file read with Hyparquet. No server code, no API, no analytics.

```
Build (Workers Builds)                          Runtime (Cloudflare edge)
┌─────────────────────────────┐                ┌──────────────────────────────────────┐
│ fetch IEEE CSVs             │                │ /001A2B  → 001A2B.html (static, free)│
│ normalize + parquet         │   wrangler     │ /001A2B3C4D5E → SPA shell → engine   │
│ pre-render priority pages   │ ──deploy─────▶ │ /        → app shell                  │
│ sitemap/robots/budget check │                │ /data/*  → parquet (lazy, hashed)     │
└─────────────────────────────┘                └──────────────────────────────────────┘
```

## Confirmed decisions

| Area | Decision |
| --- | --- |
| Stack | Vanilla HTML/CSS/JS, no framework, no Tailwind, no React |
| Hosting | Cloudflare Workers Static Assets, assets-only (no Worker script), paid plan |
| Fallback | `not_found_handling: "single-page-application"` → `200` + shell for unmatched paths |
| Data | Single Apache Parquet file, read in-browser with Hyparquet; Apache Arrow JS not used |
| SEO | Pre-rendered priority tiers, flat `<prefix>.html` pages, canonical uppercase URLs, sitemap for pre-rendered pages only (provisional) |
| Design | Kumo-inspired semantic tokens, monochrome + status colors, system font stack, system-aware dark mode + toggle |
| Deep links | Path (`/001A2B`) or query (`?q=001A2B`); batch via `?q=a,b,c` (cap 100) |
| Partials | < 6 hex lists matching prefixes, capped at 200 with total count |
| Build/deploy | Cloudflare Workers Builds, push-triggered; manual data refresh by bumping `data/refresh.txt` |
| Analytics | None initially; seed vendor-demand list drives page priority |

## Repository layout

```
mac-address-lookup/
├── src/                    # client app (committed)
│   ├── engine/             # normalization, lookup, bit analysis, formats
│   ├── ui/                 # rendering, deep links, batch, history, theme
│   └── styles/             # token layer + component CSS
├── build/                  # Node build pipeline (committed)
│   ├── fetch-registries.mjs
│   ├── normalize.mjs
│   ├── write-parquet.mjs
│   ├── generate-pages.mjs
│   ├── generate-seo.mjs    # sitemap, robots, structured data
│   ├── budget.mjs          # file-count and file-size assertions
│   └── vendor-priority.json
├── public/                 # hand-authored static files (icons, _headers, 404)
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
2. **Normalize**: trim and validate hex assignments; uppercase; derive `prefixLength` (24/28/36 bits), `addressCount`, and `country` (parsed from the address tail); mark `Private`/empty organizations; dedupe; sort by prefix value.
3. **Write Parquet** (`dist/data/registry.<hash>.parquet`) with `hyparquet-writer`, snappy compression. Columns: `prefix` (string), `prefixLen` (int8), `blockType` (dictionary), `addressCount` (uint32), `orgName`, `orgAddress`, `country`. Expected 1–3 MB.
4. **Emit manifest** (`dist/data/manifest.json`): content-hashed data filename, `generatedAt`, counts by block type, schema version.
5. **Budget checks** (`build/budget.mjs`): any asset > 20 MiB fails; total asset count > `PAGE_BUDGET + NON_PAGE_ALLOWANCE` fails; page budget defaults 90,000 (paid) / 15,000 (preview).

Caching: `data/manifest.json` → `no-cache`; `data/*.parquet` → `public, max-age=31536000, immutable` (content-hashed). Generated pages keep the platform default (`max-age=0, must-revalidate` + ETag).

## Client engine

- **Loading**: the app fetches `data/manifest.json`, then the hashed Parquet. Pre-rendered pages do not load the dataset at all until the user interacts (search, batch, unknown prefix); the embedded record covers the initial render.
- **Normalization**: strip separators (`:` `-` `.` space), uppercase, validate `[0-9A-F]`, accept 1–12 hex digits.
- **Lookup**: longest-prefix match over 9-hex (MA-S/IAB), 7-hex (MA-M), 6-hex (MA-L/CID), using a first-byte index over sorted prefix arrays.
- **Partials**: 1–5 hex digits return all matching assignments, capped at 200 rows plus a total count.
- **Bit analysis**: I/G bit (multicast), U/L bit (locally administered → likely randomized when unregistered); broadcast (`FF:FF:FF:FF:FF:FF`) and all-zero special cases.
- **VM/hypervisor detection**: organization-name map (VMware, Oracle/VirtualBox, Microsoft, Parallels, XenSource/Citrix) plus the Docker `02:42:xx` convention.
- **Format conversions**: colon, hyphen, Cisco dot, plain hex, EUI-64, IPv6 link-local.
- **Batch**: split on comma/whitespace/newline, dedupe, cap 100, results table (collapses to cards on mobile).

## Page generation & SEO

- Page selection follows the priority policy in [deployment-constraints.md](deployment-constraints.md).
- Each page is a flat `<PREFIX>.html` file; Cloudflare's default `html_handling` serves it at `/<PREFIX>` and 307-redirects `.html`/trailing-slash variants to the canonical URL.
- Page content: unique vendor record (name, block type, range, address count, country), all format conversions, randomization/VM notes, FAQ snippets, canonical link, JSON-LD (`WebPage` + vendor `Organization` where known; `FAQPage` only on pages with genuine Q&A).
- `sitemap.xml` (index + 50k-URL chunks) lists pre-rendered pages initially; `robots.txt` points to it.
- `_redirects` is not used for per-prefix canonicalization (2,100-rule cap); client-side `replaceState` normalizes case and variants instead.
- Long-tail/full-MAC paths return the SPA shell with `200`; the engine renders them after load.

## Build & deploy

- Cloudflare Workers Builds connected to `jasontally/mac-address-lookup`; push to `main` triggers build + deploy.
- Build: `npm ci && npm run build` → `npx wrangler deploy` (default deploy command).
- Node pinned via `.nvmrc` (build image default is 24.18.0).
- Manual data refresh: bump `data/refresh.txt`, commit, push. (Workers Builds has no cron trigger for assets-only Workers.)
- Budgets: paid plan allows 6,000 build min/month, 20-minute timeout; see constraints doc for the upload-time risk.

## Testing

- Unit tests for normalization, longest-prefix matching, partial listing, bit flags, VM mapping, batch parsing (Node's built-in `node:test` to avoid dependencies).
- Fixtures: a small synthetic Parquet file plus a trimmed real-registry subset.
- Build tests: parquet size, budget assertions, page count per tier, sitemap validity.
- Manual verification: Lighthouse on a pre-rendered page and the SPA shell; mobile viewport checks.

## Milestones

1. Scaffold: `package.json`, `.nvmrc`, `wrangler.jsonc`, directory skeleton.
2. Data pipeline (fetch → normalize → Parquet → budget checks) + tests.
3. Lookup engine + tests.
4. UI: token layer, home/search, result, batch, history, theme toggle.
5. Page generator, sitemap/robots, JSON-LD, `_headers`.
6. Deploy via Workers Builds; wire custom domain `mac.jasontally.com`.
7. FAQ/explainer content and final SEO polish.

## Open items

Tracked in [deployment-constraints.md](deployment-constraints.md#open-items): production SPA-fallback verification, crawler rendering of long-tail pages, Workers/Builds setup confirmation, CID page inclusion, and measured build time against the 20-minute timeout.
