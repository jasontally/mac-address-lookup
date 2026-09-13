# Architecture

Consolidated architecture for the MAC Address Lookup project. Core decisions are locked; milestones 1–3 are implemented.

Related docs: [design language](design.md) · [deployment constraints & capacity](deployment-constraints.md) · [README](../README.md)

## Overview

A static, assets-only Cloudflare Worker serving a client-side MAC address lookup tool. Pre-rendered HTML pages cover the largest and most-searched IEEE prefixes for SEO; everything else (trimmed long-tail prefixes, full-MAC deep links, batch) is resolved in the browser via the SPA fallback. The registry and its prefix-lineage history ship as two small Parquet files read with Hyparquet. No server code, no API, no analytics.

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
| Analytics | None initially; seed vendor-demand list drives page priority |

## Repository layout

```
mac-address-lookup/
├── src/                    # client app (committed)
│   ├── engine/             # normalization, lookup, bits, formats, lineage
│   ├── ui/                 # rendering, deep links, batch, history, theme
│   └── styles/             # token layer + component CSS
├── build/                  # Node build pipeline (committed)
│   ├── fetch-registries.mjs
│   ├── fetch-lineage.mjs   # runZero mac-tracker history (MIT)
│   ├── normalize.mjs
│   ├── lineage.mjs         # history normalization + hand-change extraction
│   ├── write-parquet.mjs
│   ├── copy-static.mjs     # shell copy + esbuild client bundle
│   ├── serve.mjs           # local preview with SPA fallback
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
2. **Fetch lineage** (`build/fetch-lineage.mjs`): the runZero mac-tracker history JSON (MIT, updated twice daily) — dated `add`/`change` records per prefix going back to ~1998.
3. **Normalize registries**: trim and validate hex assignments; uppercase; derive `prefixLength` (24/28/36 bits), `addressCount`, and `country` (parsed from the address tail); mark `Private`/empty organizations; dedupe; sort by prefix value.
4. **Build lineage** (`build/lineage.mjs`): normalize organization names (case, punctuation), drop `Private`/empty glitches, collapse consecutive identical organizations, and keep prefixes with at least two distinct organizations. **Measured 2026-09-12: 5,665 prefixes / 14,350 events.**
5. **Write Parquet** (`dist/data/registry.<hash>.parquet` and `lineage.<hash>.parquet`) with `hyparquet-writer`, snappy compression. Registry columns: `prefix`, `prefixLen` (bits), `blockType`, `addressCount`, `orgName`, `orgAddress`, `country`, `isPrivate`. Lineage columns: `prefix`, `prefixLen`, `seq`, `firstSeen`, `lastSeen`, `date`, `orgName`, `source`. **Measured 2026-09-12: registry 2.82 MB / 58,694 records; lineage 232 KB.**
6. **Emit manifest** (`dist/data/manifest.json`): content-hashed filenames, `generatedAt`, counts by block type, schema version, and lineage source attribution (name, homepage, license, retrieval time).
7. **Budget checks** (`build/budget.mjs`): any asset > 20 MiB fails; total asset count > `PAGE_BUDGET + NON_PAGE_ALLOWANCE` fails; page budget defaults 90,000 (paid) / 15,000 (preview).

Caching: `data/manifest.json` → `no-cache`; `data/*.parquet` → `public, max-age=31536000, immutable` (content-hashed). Generated pages keep the platform default (`max-age=0, must-revalidate` + ETag).

## Prefix lineage

Provenance: [runZero mac-tracker](https://github.com/runZeroInc/mac-tracker) (MIT), which bootstrapped IEEE assignment history from the DeepMAC snapshot and Wireshark/Ethereal archives (~1998 onward) and updates twice daily. Dates are **observation dates** — when a change first appeared in the tracked snapshots — not authoritative legal transfer dates.

Display rules:

- Lineage appears **only for the exact matched prefix**, and only when it has at least two distinct organizations after normalization.
- History is **never inherited from parent or child prefixes**. A /28 carved out of a /24 shows its own history or none; the /24's past is not presented as the /28's lineage. Rationale: allocation/split events do not imply a shared corporate lineage, and inherited history would be misleading.
- Address-only and formatting-only changes (case, punctuation, `Private` glitches) are excluded by `build/lineage.mjs`.
- Events are presented chronologically, labeled as observed dates, with source credit.
- Prefixes without lineage render no timeline (no placeholder).

The data lives in its own Parquet file so it can be updated, attributed, and reasoned about independently of the registry.

## Client engine

- **Loading**: the app fetches `data/manifest.json`, then the hashed registry and lineage Parquet files in parallel. Pre-rendered pages do not load either file until the user interacts (search, batch, unknown prefix); the embedded record covers the initial render.
- **Lineage**: `createLineageIndex` groups event rows per prefix and exposes `forPrefix(prefix)`; `loadRegistry` returns `{ manifest, registry, lineage }`.
- **Normalization**: strip separators (`:` `-` `.` space), uppercase, validate `[0-9A-F]`, accept 1–12 hex digits.
- **Lookup**: longest-prefix match over 9-hex (MA-S/IAB), 7-hex (MA-M), 6-hex (MA-L/CID), using a first-byte index over sorted prefix arrays.
- **Partials**: 1–5 hex digits return all matching assignments, capped at 200 rows plus a total count.
- **Bit analysis**: I/G bit (multicast), U/L bit (locally administered → likely randomized when unregistered); broadcast (`FF:FF:FF:FF:FF:FF`) and all-zero special cases.
- **VM/hypervisor detection**: organization-name map (VMware, Oracle/VirtualBox, Microsoft, Parallels, XenSource/Citrix) plus the Docker `02:42:xx` convention.
- **Format conversions**: colon, hyphen, Cisco dot, plain hex, EUI-64, IPv6 link-local.
- **Batch**: split on comma/whitespace/newline, dedupe, cap 100, results table (collapses to cards on mobile).

## UI structure

- `src/ui/app.mjs` — wiring: deep-link routing, lazy data loading, lookup dispatch, history, theme
- `src/ui/result.mjs` — match / none / partial / batch / invalid renderers, lineage timeline
- `src/ui/router.mjs` — pure URL parsing and canonicalization (`/001A2B`, `?q=a,b`)
- `src/ui/format.mjs` — dates, counts, address ranges, colonization (pure, tested)
- `src/ui/history.mjs` — recent lookups in localStorage (max 50)
- `src/ui/theme.mjs` — system-aware dark mode with explicit override
- `src/ui/clipboard.mjs` — copy buttons with insecure-context fallback
- `public/index.html` — indexable shell (intro + FAQ); the app hydrates results on top
- esbuild bundles `app.mjs` + engine + Hyparquet into `dist/assets/app.js` (~73 KB); CSS is bundled into one ~14 KB file

## Page generation & SEO

- Page selection follows the priority policy in [deployment-constraints.md](deployment-constraints.md).
- Each page is a flat `<PREFIX>.html` file; Cloudflare's default `html_handling` serves it at `/<PREFIX>` and 307-redirects `.html`/trailing-slash variants to the canonical URL.
- Page content: unique vendor record (name, block type, range, address count, country), lineage timeline when present, all format conversions, randomization/VM notes, FAQ snippets, canonical link, JSON-LD (`WebPage` + vendor `Organization` where known; `FAQPage` only on pages with genuine Q&A).
- `sitemap.xml` (index + 50k-URL chunks) lists pre-rendered pages initially; `robots.txt` points to it.
- `_redirects` is not used for per-prefix canonicalization (2,100-rule cap); client-side `replaceState` normalizes case and variants instead.
- Long-tail/full-MAC paths return the SPA shell with `200`; the engine renders them after load.
- Pre-rendered pages hydrate without fetching the Parquet data: the app detects `data-prerendered` and only wires copy buttons and history.
- **Measured 2026-09-12:** 58,694 pages generated in 2.6s (429 MB total output); sitemap index + 2 chunks (50,000 and 8,695 URLs; 4.8 MB and 0.9 MB).

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

- [x] 1. Scaffold: `package.json`, `.nvmrc`, `wrangler.jsonc`, directory skeleton.
- [x] 2. Data pipeline (fetch → normalize → Parquet → budget checks) + tests.
- [x] 3. Lookup engine + tests (verified against the live registry).
- [x] 4. UI: token layer, home/search, result (incl. lineage timeline), batch, history, theme toggle.
- [x] 5. Page generator, sitemap/robots, JSON-LD, `_headers`.
- [ ] 6. Deploy via Workers Builds; wire custom domain `mac.jasontally.com`.
- [ ] 7. FAQ/explainer content and final SEO polish.

## Open items

Tracked in [deployment-constraints.md](deployment-constraints.md#open-items): production SPA-fallback verification, crawler rendering of long-tail pages, Workers/Builds setup confirmation, CID page inclusion, and measured build time against the 20-minute timeout.
