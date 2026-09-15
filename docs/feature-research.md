# Feature research: competing tools, community asks, and AI access

Research only — no changes proposed as ready to build. This surveys what
similar tools offer, what users ask for that nobody ships, and how the site
could serve AI agents. Each item notes feasibility under this project's
constraints (static assets only, no backend, privacy-preserving, file-count
budget ~59k of a 100k/version cap).

## Tools surveyed

| Tool | Type | Standout features |
| --- | --- | --- |
| macvendors.com | Web + API | Free plain-text API (1k req/day), multi-format parsing |
| maclookup.app | Web + API | IEEE + Wireshark manufacturer DB, "latest OUIs" feed, DB download, API |
| nlink-jp/mac-lookup | CLI + **MCP server** | Longest-prefix, "OUI subdivided" honesty, grep-style exit codes, local cache TTL |
| Choate Labs MAC Vendor Lookup | iOS app | On-device OCR of device labels, batch camera sweep, notes/tags/favorites, App Intents |
| maclookup.py PWA | Web (PWA) | Service-worker offline cache, IndexedDB persistence, fuzzy vendor search (top 50), manual refresh button |
| Tembrica | Web | Random MAC generator, CSV export of batch results |
| Elysia Tools | Web | Reverse search grouped by company, up to 500 results per query |
| frzifus/vlookup | CLI | ARP scanning (out of web scope), custom/local DB override |
| ouimap | CLI | Wireshark DB auto-update cadence |
| ssid.ai | Web + MCP | Randomized-MAC detection with confidence, router default-login directory |
| Huginn-Muninn | Dataset | DHCP/Satori fingerprint ↔ device cross-reference (11.3M records) |
| fingerbank (Progress) | Commercial | DHCP/TCP fingerprint → device model |

## Features we already have that most lack

Worth stating plainly: lineage (ownership history with first-observed dates),
vendor portfolio view, randomization/VM/hypervisor detection, batch with
extraction from pasted CLI output, longest-prefix matching across all five
registries, pre-rendered crawlable pages, i18n, no-ads/no-tracking. None of
the surveyed web tools show ownership history; that remains the differentiator.

## Gap analysis

### 1. Export and reuse (batch is half-done)
Batch lookup renders a table but offers **no export**. Tembrica and Choate both
export CSV; scripts/audits want CSV/JSON/TSV. Cheap: a "Download CSV" button on
the batch card (Blob + object URL, client-side). Also "Copy all as JSON" for
piping into other tools. No data-source changes needed.

### 2. Data downloads (API-shaped files, not an API)
maclookup.app and macvendors monetize an API; our constraint forbids a live
endpoint, but **static files can serve one**:
- We already publish raw IEEE sources at `/data/sources/` and hashed Parquet
  registries — but discoverability is near zero.
- A `/data/registry.ndjson` (one JSON object per assignment, ~15 MB) would let
  scripted agents/CLI tools `curl` and `grep`/`jq` the whole registry without
  understanding Parquet. Pre-generated on deploy; zero runtime cost.
- Lineage export (CSV/NDJSON of ownership-change events) is the **unique
  dataset** — no other public tool redistributes it.
- Full per-prefix JSON API (`/api/001B21.json`) would ~double the file count
  and blow the version cap — not feasible; NDJSON download is the substitute.

### 3. "Latest OUIs" feed
maclookup.app leads with a recently-registered table. Our pipeline knows
`firstSeen` per prefix (lineage) — a pre-rendered `/recent` page listing
newest blocks per deploy is one more static page and a natural "what's new"
surface. Low effort, nice recurring-visit hook.

### 4. PWA / offline lookup
maclookup.py's PWA caches the app shell + registry in a service worker and
IndexedDB, then refreshes in the background. Our dynamic lookups already fetch
only small shards; a service worker caching the shell + previously-fetched
shards would make repeat visits work offline. Moderate effort; interacts with
the existing hashed-asset caching strategy. Optional "installable PWA"
manifest for app-icon use.

### 5. Random MAC generator
Tembrica ships a generator (count, unicast/multicast, real-vendor prefix or
fully random, format). It's a testing/dev utility that pairs naturally with
the existing format converters. Small, client-side only. Also useful for
demoing the randomized-address detection.

### 6. Fuzzy vendor search
Our search is substring/token-based; maclookup.py scores
exact-substring + token + subsequence and returns top 50. Typos ("Appel",
"Intell") currently fail ours. A small deterministic fuzzy layer (no
fuzzy-matching library needed for 58k names) is contained to
`src/engine/search.mjs`.

### 7. "OUI subdivided" honesty
~429 MA-L rows are held by the IEEE Registration Authority itself for
subdivision; a lookup that lands on one shows "IEEE Registration Authority"
as if it were a vendor. mac-lookup reports *OUI subdivided — vendor lookup
does not apply*. We should classify those rows distinctly (probably a badge,
not a vendor name). Small engine/UX fix, meaningfully better accuracy.

### 8. Inventory workflow (notes, tags, favorites, grouping)
Choate targets network engineers: searchable history with notes, favorites,
grouping by site/closet/job. Our history is a plain localStorage list. A
middle step (persistent favorites + notes on history entries, still
localStorage, still private) fits the project's no-backend model. Larger
effort; only worth it if inventory-style use is a goal.

### 9. Camera/OCR capture
Choate reads MACs from device labels via on-device OCR and sweeps racks.
Web equivalent: `getUserMedia` + a barcode/OCR library — heavy dependency for
a vanilla-JS project, and our privacy stance complicates shipping any OCR
bundle (even on-device). Park unless demand appears.

### 10. Adjacent datasets
- **Wireshark manufacturer DB** as a secondary source — **assessed 2026-09-15 and
  closed: adds nothing.** A full overlap check against the deployed registry
  (58,257 manuf rows at 24/28/36-bit widths) found **0 prefixes missing** from
  the IEEE-derived data; there is nothing to gap-fill and IEEE remains
  authoritative on names. No pipeline integration needed.
- **Router default-login directory** (ssid.ai) — adjacent, off-mission,
  privacy-reputation risk. Skip.
- **DHCP/Satori fingerprints** (Huginn-Muninn, fingerbank) — needs captured
  traffic; not a website feature. Could inform help-page content only.

## AI-friendliness

The premise "AIs don't have browsers" is mostly right, but the practically
important fact is different: **agents don't need a browser for this site —
they need to know the URL scheme and that plain `GET` works.** Every prefix
page is fully pre-rendered static HTML (no JS required), and the SPA paths
degrade to the same static shell. That is already closer to agent-usable
than most competitor sites; what's missing is *discovery and documentation*:

1. **`/llms.txt`** (spec v2, llmstxt.org; adopted by thousands of sites,
   generated by major doc platforms, audited by Lighthouse's agentic checks).
   A tiny file stating: URL patterns (`/{hex}` for MACs/prefixes,
   `/{vendor-name}` for search, `/{a},{b}` for batch), that pages are
   pre-rendered HTML readable without JavaScript, that no auth/keys exist,
   data licensing, and links to `/help`, the data files, and lineage notes.
   Static file; ~20 lines. Highest value-per-effort on this list.

2. **Markdown alternate for `/help`** — spec v2: `rel="alternate"
   type="text/markdown"` pointing at `help.md`, plus `rel="describedby"`
   for the llms.txt. One generated file (`help.html.md`), trivially
   produced by the build from the FAQ data.

3. **robots.txt AI-crawler directives** — the current robots.txt has no
   per-bot entries. A policy decision (default: allow GPTBot/ClaudeBot/
   PerplexityBot etc., or block training-only bots) expressed in robots.txt
   is the actual enforcement layer agents honor today. Independent of llms.txt.

4. **NDJSON registry download** (from §2) — the file an AI-with-shell would
   actually use for bulk questions ("which prefixes did Apple register since
   2020") instead of fetching pages.

5. **MCP server** — several competitors ship one (nlink-jp, NetMCP,
   pipeworx). It's a separate artifact, not a website feature; our engine is
   plain ES modules so a thin MCP wrapper over the same Parquet loader is
   plausible later. Not required for AI use: any agent that can `curl` can
   use the site once llms.txt explains the scheme.

6. **Per-prefix `.md` files** — would double file count and blow the cap;
   not feasible. The HTML pages already parse cleanly as text, which the
   llms.txt should say explicitly.

## Priorities if acted on later

Status after the 2026-09-15 execution pass (batches 1–3):

| # | Feature | Status |
| --- | --- | --- |
| 1 | `/llms.txt` + `/help.md` + rel links | **Shipped** (build-generated; robots.txt AI-crawler policy documented) |
| 2 | Batch export (CSV/JSON) | **Shipped** (client-side Blob + clipboard) |
| 3 | "OUI subdivided" classification | **Shipped** (badge on 435 IEEE-held MA-L pages) |
| 4 | `/data/registry.ndjson` download | **Shipped** (+ `/data/lineage.ndjson` — the unique lineage dataset) |
| 5 | Latest-OUIs page | **Shipped** (`/recent`, sitemapped, footer-linked) |
| 6 | Fuzzy vendor search | **Shipped** (deterministic typo fallback in searchRegistry) |
| 7 | Random MAC generator | **Shipped** (Random chip in the Try section; generates + looks up) |
| 8 | PWA/service-worker offline | Not started (medium; interacts with hashed-asset caching) |
| 9 | Notes/tags/favorites | Parked (large; only for inventory-oriented use) |
| 10 | Wireshark manuf as 2nd source | **Closed — no-op** (0 prefixes missing from IEEE data) |

## Note on the Lighthouse matrix run

Resolved 2026-09-14: the search path's 22.3 s LCP was fixed with a lean
search index (`/data/search.*.parquet`, 1.12 MB vs the 3.01 MB registry) plus
Web-Worker Parquet decoding. Mobile `/apple` is now LCP 10.6 s, TBT 0 ms,
perf 68 with every audit ≥ 90; all other page types measure 95–99 on mobile.
