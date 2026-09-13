# MAC Address Lookup

Free, fast, **client-side MAC address vendor lookup**. Paste a full or partial MAC address (OUI prefix, MA-M, MA-S, IAB, or CID block) and instantly identify the organization behind it — everything runs in your browser with no backend, and the addresses you look up never leave it.

**[mac.jasontally.com](https://mac.jasontally.com)**

## Features

- **Full or partial lookup** — works with complete 48-bit addresses or just the leading hex digits (`00:1A:2B`, `001A2B3`, `001A2B3C4`)
- **Any format** — colons, hyphens, Cisco dots, spaces, or plain hex; input is normalized automatically
- **Complete IEEE registry coverage** — MA-L, MA-M, MA-S, IAB, and CID assignments, matched with longest-prefix precedence so small blocks resolve to the correct organization
- **Randomized MAC detection** — flags locally administered / privacy-randomized addresses instead of returning a misleading "unknown vendor"
- **VM & hypervisor detection** — recognizes VMware, VirtualBox, Hyper-V, KVM, Docker, Xen, and similar ranges
- **IEEE block details** — assignment type, block size, address range, registered country, and organization details
- **Prefix lineage** — for prefixes that changed hands (acquisitions, renames), a timeline of organizations and when each change was first observed
- **Paste anything** — drop CLI output (`arp -a`, switch tables, logs) into the search box or batch lookup; every full MAC address inside is extracted and looked up, with non-address text ignored
- **Vendor and former-owner search** — type a company name to list its prefixes; names from lineage match too ("Tekelec" finds the prefix that became Oracle), plus country names ("Germany"), registry types, and registration years
- **Batch summary** — compact counts by vendor, randomized addresses, virtual machines, and unregistered prefixes for pasted lists
- **Registration dates and portfolios** — first-registered dates for every prefix, and per-vendor block/address-space totals
- **Format conversions** — see the address in every common notation
- **URL-driven lookups** — no pasting required: `mac.jasontally.com/001A2B` renders the result directly. Batch lookups work the same way.
- **Static & private** — the IEEE dataset loads once in the browser; all searching, processing, and presentation happen locally. The addresses you look up are never sent to a server, and the site sets no cookies.
- **Dark mode** — follows your system preference by default, with a manual toggle
- **History, copy & share** — recent lookups are stored locally; results are copyable and permalinked

## URL-driven lookups

Navigate directly to a result — no form submission needed:

| URL | Result |
| --- | --- |
| `https://mac.jasontally.com/00:1A:2B:3C:4D:5E` | Full address lookup |
| `https://mac.jasontally.com/001A2B` | OUI / MA-L prefix lookup |
| `https://mac.jasontally.com/001A2B3` | MA-M prefix lookup |
| `https://mac.jasontally.com/001A2B3C4` | MA-S prefix lookup |
| `https://mac.jasontally.com/?q=001A2B,001A2B3` | Batch lookup |

The page consumes the address from the URL path or query string and displays the result without any manual input.

## SEO architecture

The site is static where it matters. A build step pre-renders an HTML page for as many registered IEEE prefixes as fit the platform's file budget, prioritizing the largest and most-searched prefixes (see [platform constraints and page budget](docs/architecture.md#capacity--page-budget)). Every pre-rendered page contains real vendor content — no JavaScript required for crawlers. The interactive tool hydrates on top and resolves arbitrary full or partial addresses, including prefixes without a pre-rendered page, via the client-side SPA fallback (assets-only deployment, no server code). Generated pages include canonical URLs, schema.org markup, `sitemap.xml`, and `robots.txt`. Sitemap: `https://mac.jasontally.com/sitemap.xml`.

## Data sources

- IEEE Registration Authority — MA-L, MA-M, MA-S, IAB, and CID CSV registries (current assignments)
- [runZero mac-tracker](https://github.com/runZeroInc/mac-tracker) — historical assignment changes back to ~1998, derived from IEEE snapshots and Wireshark/Ethereal archives (MIT)

## Tech stack

- Static HTML/CSS/JavaScript — no backend at runtime; all lookup work happens in the browser
- Single client bundle built with esbuild (engine + Hyparquet inlined): ~73 KB JS / ~14 KB CSS, gzip-served by Cloudflare
- IEEE dataset stored as [Apache Parquet](https://parquet.apache.org/) and read in-browser with [Hyparquet](https://github.com/hyparam/hyparquet) (pure JS, zero dependencies, range-read capable) — no database or API
- Pre-rendered per-prefix pages generated at build time for SEO
- Deployed on Cloudflare Workers Static Assets (custom domain: `mac.jasontally.com`)
- Architecture, platform constraints, and capacity planning: [`docs/architecture.md`](docs/architecture.md)
- Design language and UX requirements: [`docs/design.md`](docs/design.md)

## Status

All core milestones are complete and the site is live at [mac.jasontally.com](https://mac.jasontally.com): 58,694 pre-rendered prefix pages, a client-side lookup engine, prefix lineage, and a full FAQ.

Possible future work: demand-driven page prioritization from privacy-friendly analytics, reverse vendor search, and device-type hints.

## Development

```bash
npm install
npm run build                  # fetch data, build dist/ (all pages)
npm run build -- --no-pages    # data + assets only, for quick iteration
PAGE_BUDGET=500 npm run build  # limit pre-rendered pages
npm run serve                  # preview dist/ at http://localhost:8788 (SPA fallback)
npm test                       # unit tests
```

## License

[MIT](LICENSE)
