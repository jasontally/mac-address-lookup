# MAC Address Lookup

Free, fast, **client-side MAC address vendor lookup**. Paste a full or partial MAC address (OUI prefix, MA-M, MA-S, IAB, or CID block) and instantly identify the organization behind it — everything runs in your browser with no backend, and the addresses you look up are never processed by a server.

**[mac.jasontally.com](https://mac.jasontally.com)**

The app does no tracking: there are no ads, no cookies, and every lookup runs in your browser, where the addresses you look up are never processed by a server. Normal requests still reach the host as with any website — a direct link such as `/apple` carries the term in its URL path, and the app fetches its public data files by URL — but the host only serves static files and runs no search code. The site is hosted on Cloudflare, which collects privacy-first, aggregate web analytics (Cloudflare Web Analytics) that use no cookies or client-side state and do not fingerprint individuals. Similar lookup pages are often wrapped in intrusive advertising, which is what prompted this project: identifying a MAC vendor is a small utility, and it should be possible to build and host it for close to nothing.

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
- **URL-driven lookups** — no pasting required: `mac.jasontally.com/001A2B` renders the result directly. Batch lookups and vendor searches work the same way.
- **Static & private** — the IEEE dataset loads in the browser; all searching, processing, and presentation happen locally, and the addresses you look up are never processed by a server. The app sets no cookies. The host (Cloudflare) collects privacy-first, cookieless, aggregate web analytics (Cloudflare Web Analytics).
- **Dark mode** — follows your system preference by default, with a manual toggle
- **History, copy & share** — recent lookups are stored locally; results are copyable and permalinked

## URL-driven lookups

Navigate directly to a result — no form submission needed. Everything after `/` is the query (address, prefix, batch list, or vendor/country/former-owner text):

| URL | Result |
| --- | --- |
| `https://mac.jasontally.com/001A2B` | OUI / prefix lookup |
| `https://mac.jasontally.com/001B213C4D5E` | Full address lookup |
| `https://mac.jasontally.com/001A2B,005056` | Batch lookup (comma-separated, cap 250) |
| `https://mac.jasontally.com/apple` | Vendor search |
| `https://mac.jasontally.com/tekelec` | Former-owner search |
| `https://mac.jasontally.com/vendor` | Vendor index: every organization with two or more registered blocks |
| `https://mac.jasontally.com/vendor/apple-inc` | Vendor page: every block registered to one organization |
| `https://mac.jasontally.com/country/us` | Country page: every organization with registered blocks |
| `https://mac.jasontally.com/former/apple-computer` | Former-owner page: what happened to each renamed/reassigned block |
| `https://mac.jasontally.com/?q=001A2B` | Legacy form (canonicalizes to `/001A2B`) |

The page consumes the value from the URL path and displays the result without any manual input.

## Pre-rendered pages

A build step pre-renders a real HTML page for every registered IEEE assignment — each OUI (MA-L), MA-M, MA-S, IAB, and CID prefix — so that people can find the tool when they look up a prefix or a vendor in their own words. No brand is promoted as part of the app (and the title is translated into local words for each language) because an English-only brand name would make it harder to find for everyone else. Every page contains the vendor record without requiring JavaScript, and the interactive tool hydrates on top to resolve everything else in the browser: full addresses, partial prefixes, batch lists, vendor names, former owners, countries, and registration years. Generated pages include canonical URLs, schema.org metadata, `sitemap.xml`, and `robots.txt`. Sitemap: `https://mac.jasontally.com/sitemap.xml`.

On top of the prefix pages, the build generates **vendor pages** (`/vendor/<slug>`, every block registered to one organization — 3,469 today) and **country pages** (`/country/<code>`, every organization with blocks registered in a country — 127), each family behind a rollup index — **`/vendor`** (every organization with two or more blocks) and **`/country`** (every country), both in the sitemap. The hub pages are complete static tables with no row caps, plus an internal relational link web: related-prefix sections (same vendor, adjacent prefixes, same registration year) on every prefix page, hub links from prefix pages, and org directory links on country pages. Rationale and capacity accounting: [`docs/thin-content-mitigation.md`](docs/thin-content-mitigation.md).

## Data sources

- IEEE Registration Authority — MA-L, MA-M, MA-S, IAB, and CID CSV registries (current assignments)
- [runZero mac-tracker](https://github.com/runZeroInc/mac-tracker) — historical assignment changes back to ~1998, derived from IEEE snapshots and Wireshark/Ethereal archives (MIT)

## Using the data from scripts, agents, and LLMs

- `llms.txt` describes the site and data files for AI tools.
- **Full download:** `data/registry.ndjson` (~13.5 MB, one JSON object per IEEE assignment) and `data/lineage.ndjson` (ownership-change events).
- **Small lookups without the full registry:** the same registry rows served as small `text/plain` trie shards at `data/registry/{key}.txt` (1–30 KB each, one JSON per line), indexed with row counts at `data/registry/index.txt`. Resolve a MAC by finding the longest shard key that is a prefix of its hex, fetching that shard, then longest-prefix matching within it. Example: `8C:1F:64:AF:A4:B2` → `data/registry/8c1f64af.txt` → row `8C1F64AFA` (MA-S, DATA ELECTRONIC DEVICES, INC) instead of its parent MA-L `8C1F64`. See [help.md](public/help.html) → *Using the data programmatically*.

## Tech stack

- Static HTML/CSS/JavaScript — no backend at runtime; all lookup work happens in the browser
- Single client bundle built with esbuild (engine + Hyparquet inlined): ~88 KB JS / ~15 KB CSS, gzip-served by Cloudflare
- IEEE dataset stored as [Apache Parquet](https://parquet.apache.org/) and read in-browser with [Hyparquet](https://github.com/hyparam/hyparquet) (pure JS, zero dependencies) — sharded by prefix so a lookup fetches a few KB instead of the full registry; no database or API
- Pre-rendered prefix pages generated at build time so people can find the tool when they look up a prefix or a vendor
- Deployed on Cloudflare Workers Static Assets (custom domain: `mac.jasontally.com`)
- Architecture, platform constraints, and capacity planning: [`docs/architecture.md`](docs/architecture.md)
- Design language and UX requirements: [`docs/design.md`](docs/design.md)

## License

[MIT](LICENSE)
