# MAC Address Lookup

Free, fast, **client-side MAC address vendor lookup**. Paste a full or partial MAC address (OUI prefix, MA-M, MA-S, IAB, or CID block) and instantly identify the organization behind it — everything runs in your browser with no backend. We ask nothing of you: no ads, no cookies, no account, no tracking. The project came out of frustration with lookup pages wrapped in intrusive advertising: identifying a MAC vendor is a small utility, and it should be possible to build and host it for close to nothing.

**[mac.jasontally.com](https://mac.jasontally.com)**

The app does no tracking: there are no ads, no cookies, and every lookup runs in your browser, where the addresses you look up are never processed by a server. Normal requests still reach the host as with any website — a direct link such as `/apple` carries the term in its URL path, and the app fetches its public data files by URL — but the host only serves static files and runs no search code. The site is hosted on Cloudflare, which collects privacy-first, aggregate web analytics (Cloudflare Web Analytics) that use no cookies or client-side state and do not fingerprint individuals.

## Features

- **Full or partial lookup** — works with complete 48-bit addresses or just the leading hex digits (`00:1A:2B`, `001A2B3`, `001A2B3C4`)
- **Any format** — colons, hyphens, Cisco dots, spaces, or plain hex; input is normalized automatically
- **Complete IEEE registry coverage** — MA-L, MA-M, MA-S, IAB, and CID assignments, matched with longest-prefix precedence so small blocks resolve to the correct organization
- **Randomized MAC detection** — flags locally administered / privacy-randomized addresses instead of returning a misleading "unknown vendor"
- **VM & hypervisor detection** — recognizes VMware, VirtualBox, Hyper-V, KVM, Docker, Xen, and similar ranges
- **IEEE block details** — assignment type, block size, address range, registered country, and organization details
- **Prefix lineage** — for prefixes that changed hands (acquisitions, renames), a timeline of organizations and when each change was first observed. Shown only for the exact matched prefix, never inherited from parent or child blocks.
- **Paste anything** — drop CLI output (`arp -a`, switch tables, logs) into the search box; every full MAC address inside is extracted and looked up, with non-address text ignored
- **Vendor and former-owner search** — type a company name to list its prefixes; names from lineage match too ("Tekelec" finds the prefix that became Oracle), plus country names ("Germany"), registry types, and registration years
- **Registration dates and portfolios** — first-registered dates for every prefix, and per-vendor block/address-space totals
- **Format conversions** — see the address in every common notation
- **URL-driven lookups** — no pasting required: `mac.jasontally.com/001A2B` renders the result directly. Batch lookups and vendor searches work the same way.
- **Static & private** — the IEEE dataset loads in the browser; all searching, processing, and presentation happen locally, and the addresses you look up are never processed by a server. The app sets no cookies. The host (Cloudflare) collects privacy-first, cookieless, aggregate web analytics (Cloudflare Web Analytics).
- **Dark mode** — follows your system preference by default, with a manual toggle
- **History, copy & share** — recent lookups are stored locally; results are copyable and permalinked

## URL-driven lookups

Navigate directly to a result — no form submission needed. Everything after `/` is the query (address, prefix, vendor/country/former-owner text):

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
| `https://mac.jasontally.com/country` | Dimension index rollups: `/country`, `/year`, `/region`, `/history`, `/successor` (each is its own table over the corresponding page family) |
| `https://mac.jasontally.com/former/apple-computer` | Former-owner page: what happened to each renamed/reassigned block |
| `https://mac.jasontally.com/?q=001A2B` | Legacy form (canonicalizes to `/001A2B`) |

The page consumes the value from the URL path and displays the result without any manual input.

## Pre-rendered pages

A build step pre-renders a real HTML page for every registered IEEE assignment — each OUI (MA-L), MA-M, MA-S, IAB, and CID prefix — so that people can find the tool when they look up a prefix or a vendor in their own words. Every page contains the vendor record without requiring JavaScript, and the interactive tool hydrates on top to resolve everything else in the browser: full addresses, partial prefixes, batch lists, vendor names, former owners, countries, and registration years. No brand is promoted as part of the app; the title is translated into local words for each language, because an English-only brand name would make it harder to find for everyone else. Generated pages include canonical URLs, schema.org metadata, `sitemap.xml`, and `robots.txt`. Sitemap: `https://mac.jasontally.com/sitemap.xml`.

On top of the prefix pages, the build generates **vendor pages** (`/vendor/<slug>`, every block registered to one organization — roughly 3,500 today), **country pages** (`/country/<code>`, every organization with blocks registered in a country — roughly 130), former-owner pages (`/former/<slug>`, roughly 350), and registry/year/region/history/successor dimension pages (`/registry`, `/year`, `/region`, `/history`, `/successor`), each family behind its own rollup index — **`/vendor`** (every organization with two or more blocks) and **`/country`** (every country) are both in the sitemap. The hub pages are complete static tables with no row caps, plus an internal relational link web: related-prefix sections (same vendor, adjacent prefixes, same registration year) on every prefix page, hub links from prefix pages, org directory links on country pages, and the home page's "MAC address by" nav reaching every rollup index. Rationale and capacity accounting: [`docs/thin-content-mitigation.md`](docs/thin-content-mitigation.md).

## Data sources

- IEEE Registration Authority — MA-L, MA-M, MA-S, IAB, and CID CSV registries (current assignments)
- [runZero mac-tracker](https://github.com/runZeroInc/mac-tracker) — historical assignment changes back to ~1998, derived from IEEE snapshots and Wireshark/Ethereal archives (MIT)

## Using the data from scripts, agents, and LLMs

- `llms.txt` describes the site and data files for AI tools.
- `/.well-known/ai-catalog.json` and `/.well-known/ard.json` are ARD 1.0 catalogs whose single entry describes the MCP server below. Real JSON at those paths also prevents the SPA fallback from serving HTML there.
- **Full download:** `data/registry.ndjson` (~13.6 MB, one JSON object per IEEE assignment) and `data/lineage.ndjson` (ownership-change events). If your client cannot speak MCP, match the longest registered prefix against these yourself.
- **MCP server:** `/mcp` is a stateless [MCP](https://modelcontextprotocol.io) server over Streamable HTTP. No key, no auth, no session, and no handshake required: a current client posts a request directly. It also answers an `initialize` probe statelessly, so a 2025-era client can connect too, and refuses an unsupported protocol version with `-32022` listing what it does speak. One tool, `lookup`, takes a MAC address or OUI prefix and returns the registered organization, block type, address count, country, and a link to the record page in one call. Served by a Cloudflare Snippet (`mcp/snippet.js`, generated by `build/mcp-shards.mjs`); see [docs/mcp-endpoint.md](docs/mcp-endpoint.md).
- **Auth discovery:** `/.well-known/oauth-protected-resource` and `/.well-known/oauth-protected-resource/mcp` return RFC 9728 metadata naming no authorization server, because the endpoint is public and no token is ever presented.
- **Directory and registry listings:** `server.json` at the repository root is the document the official MCP Registry publishes, and `/.well-known/mcp/server-card.json` is the same document at the path clients probe for pre-connection discovery (SEP-1649). `test/mcp-listing.test.mjs` keeps the two copies identical. Where the server can be listed, what each place checks, and the steps that need the account holder: [`docs/mcp-listing.md`](docs/mcp-listing.md).
- **Load and correctness testing:** `npm run mcp:load` drives the live endpoint with a real request mix and validates every response against a brute-force oracle built from `registry.ndjson`, so a fast wrong answer counts as a failure. See [docs/mcp-endpoint.md](docs/mcp-endpoint.md) → *Load and correctness testing*.

## Tech stack

- Static HTML/CSS/JavaScript — no backend at runtime; all lookup work happens in the browser
- Single client bundle built with esbuild (engine + Hyparquet inlined): ~91 KB JS / ~18 KB CSS, gzip-served by Cloudflare
- IEEE dataset stored as [Apache Parquet](https://parquet.apache.org/) and read in-browser with [Hyparquet](https://github.com/hyparam/hyparquet) (pure JS, zero dependencies) — sharded by prefix so a lookup fetches a few KB instead of the full registry; no database or API
- Pre-rendered prefix pages generated at build time so people can find the tool when they look up a prefix or a vendor — vendors, countries, former owners, and other registration dimensions get the same treatment (see above)
- Deployed on Cloudflare Workers Static Assets (custom domain: `mac.jasontally.com`)
- Architecture, platform constraints, and capacity planning: [`docs/architecture.md`](docs/architecture.md)
- Design language and UX requirements: [`docs/design.md`](docs/design.md)

## License

[MIT](LICENSE)
