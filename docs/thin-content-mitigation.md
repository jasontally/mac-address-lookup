# Thin-Content Mitigation Plan

Related docs: [architecture](architecture.md) · [design](design.md) · [README](../README.md)

## Why

The site ships ~58,700 pre-rendered prefix pages from one template; each page's unique
content is a single IEEE registry row. That pattern sits at the boundary of Google's
**scaled content abuse** and **doorway pages** policies. This plan strengthens the
page set in three sequenced steps:

1. **Related links** on every prefix page (internal link graph).
2. **Hub pages** — one per multi-block organization, one per country (consolidation).
3. **Per-page enrichment** — short, computed, prefix-specific context sentences.

Steps run in that order because each builds on the previous one's markup slot, and
each is an independent deploy that can be reverted on its own. `dist/` is rebuilt from
scratch every build, so a revert leaves no stale files.

Guardrails honored throughout (from the project owner, 2026-09-16):

- **Sitemap policy stays provisional** — pre-rendered pages only in `sitemap.xml`;
  monitor Search Console after each step and prune zero-impression URLs from the
  sitemap (never delete pages) if "Crawled — currently not indexed" grows.
- **No FAQ boilerplate** on prefix or hub pages. The home-page FAQ is the only one.
- **Workers paid plan limit is on *all* files** (100,000 per Worker version), not just
  root-level pages — hub pages under `vendor/` and `country/` count against the same
  pool. The 90,000-page + ~2,000 non-page budget must therefore count them as pages.
- Design language per docs/design.md: semantic tokens, neutral surfaces, monospace
  hex, one `h1` per page, no new visual vocabulary. Hub tables reuse the `/recent`
  `.data-table` pattern (dense reference data); the collapsing-table rule stays
  scoped to batch results.

## Measured facts (2026-09-16, from the deployed source cache)

| Measurement | Value |
| --- | --- |
| Registry assignments (all pre-rendered today) | 58,694 |
| Unique organizations (after `normalizeOrgName`) | 33,396 |
| Organizations with ≥ 2 blocks | **3,470** (covering 28,534 assignments, 49% of registry) |
| Organizations with ≥ 3 blocks | 1,411 |
| Largest portfolios (blocks) | Apple 1,553 · Huawei Technologies 1,408 · Cisco 1,252 · Samsung 909 · Intel 667 |
| Org-name slug collisions | 34 total; **4 among multi-block orgs**; 7 orgs slug to empty |
| Countries in the `country` field | **249** (`extractCountry` scans the last 4 address tokens; verified the `… STATE COUNTRY ZIP` tail format resolves correctly); 61 records have none |
| Worst-case hub tables | Apple: 1,553 block rows (~227 KB raw, ~23 KB compressed) · US: 8,879 orgs (~1.3 MB raw, ~130 KB compressed) |
| Dynamic display caps (measured 2026-09-15, `e2e/measure-limits.mjs`) | 500 rows display (23 ms throttled) · 250 batch · 5,000 rows renders in 296 ms at 4× throttle |
| "Show all" full reveal (measured 2026-09-22, `e2e/measure-showall.mjs`) | Partials: `/00`'s 17,394 rows rebuild in 2,242 ms (1×) / 9,414 ms (4×); the hub un-hide measurement (8,885 rows = 4,091 ms at 4×) plus a real-phone <1 s reveal removed the static caps the same day | "(slow)" suffix past 1,500 rows, partial listings only |
| Current non-page files | ~316 of the 2,000 allowance |
| Avg prefix-page size / total output | ~8 KB · ~479 MB |

## Cross-cutting design decisions

- **Org grouping key: `normalizeOrgName`** (build/lineage.mjs) — the same key
  build.mjs already uses for `vendorBlocks` / `vendorAddresses` portfolio stats, so
  hub membership can never disagree with the portfolio numbers shown on result cards.
- **Internal links point only at pre-rendered pages** (step 1). Non-JS crawlers get a
  real HTML page for every link target; the SPA shell is never a link destination.
  Hub tables (step 2) are the one exception: they carry the complete data — all of an
  org's blocks, including non-pre-rendered ones (those hydrate client-side).
- **Aux sections live inside `section#result`**, after the article card. Every
  renderer in src/ui/result.mjs starts with `clear(container)`, so a visitor running a
  new lookup on a pre-rendered page automatically discards the old prefix's related
  links and enrichment — no stale content, no app changes.
- **Hub pages follow the `/recent` page pattern** (`data-static-page="true"`):
  breadcrumb, `h1`, prose lede, `.data-table`, `.section-note`. The app wires only
  chrome (locale, theme, copy) and never routes them, so no `noindex`/canonical JS
  interference. Served at `/vendor/<slug>` and `/country/<code>` by the existing
  `html_handling: auto-trailing-slash` (307s for `.html` and trailing-slash variants,
  same as prefix pages).
- **Routing is untouched.** `parseLookup` rejects multi-segment paths, so `/vendor/*`
  and `/country/*` can never be mistaken for lookup queries; missing hub paths fall
  through to the SPA shell's soft-404 handling (`noindex` + canonical to `/`).
- **i18n:** every new visible label gets a `data-i18n` key in `src/i18n/en.mjs`, with
  `data-i18n-params` JSON attributes for interpolated values (the badge/banner
  pattern). The other 28 locales fall back to English automatically; translations can
  be added in a later pass (the `e2e/i18n-audit.mjs` tool flags what's missing).
  Org names, prefixes, and counts are data and are not translated.
- **Determinism:** link sets, hub membership, and slugs are pure functions of the
  sorted record set, so consecutive builds produce byte-stable output for unchanged
  records.

---

## Step 1 — Related links on prefix pages

**New module** `build/related.mjs` (pure, unit-tested) computing, per selected record:

| Link set | Source | Cap |
| --- | --- | --- |
| Same-org siblings | other selected records sharing the `normalizeOrgName` key | 6 |
| Adjacent prefixes | lexicographic prev/next among selected records | 2 |
| Same-year cohort | selected records with the same `firstSeen` year | 4 |

Rules: targets must be in the selected (pre-rendered) set; deterministic ordering
(prefix sort, then first-seen); the page's own prefix never appears; sections with no
members are omitted entirely (no empty headings); total links ≤ 12 per page.

**Template change** (build/page-template.mjs): a `.result-section` per link group
inside `#result`, after the article card — `<ul>` of links, prefix in the monospace
`code` style, org name in subtle text. No new CSS components; reuse `result-section`
and existing link styles. New i18n keys: `related.title`, `related.sameOrg`,
`related.adjacent`, `related.sameYear`, `related.sameYearPlural`.

**Deliberately excluded:** links to `/vendor/*` hubs. They don't exist yet, and a
58k-page link graph aimed at noindex soft-404s would be worse than no links. Step 2
repoints the same-org group to the hub.

**Budget impact:** ~1–1.5 KB per page → total output ~560–570 MB (under the 800 MB
warning in budget.mjs). No new files; sitemap unchanged.

**Tests:** related-link computation (caps, determinism, self-exclusion, selected-only
targets, empty-group omission); template rendering + escaping of link text; existing
page-template tests extended. **E2E:** run a new lookup on a pre-rendered page and
assert the aux sections are gone (cleared with `#result`).

---

## Step 2 — Organization and country hub pages

**Budget accounting first** (the all-files correction): `countPages` in
build/budget.mjs currently counts only root-level `.html` files, so `vendor/*.html`
would land in the 2,000-file non-page allowance. Rework before generating any hubs:

- `countPages` = root-level prefix pages + `vendor/*.html` + `country/*.html`
  (excluding shells `index.html` / `404.html` as today). The `/country` rollup
  index is root-level `country.html` and counts as a country page, not a prefix.
- Report the three page classes separately in the build log and in
  `checkBudget` stats; the 90,000 page budget covers their sum.
- Update docs/architecture.md capacity tables (below).

**Capacity after this step** (measured counts + hub estimates):

| Item | Files |
| --- | --- |
| Prefix pages | 58,694 |
| Vendor hubs (≥ 2 blocks) | 3,469 (measured, 2026-09-16) |
| Country hubs (all 249 countries) | 249 |
| Former-owner hubs (former orgs with ≥ 2 prefixes) | 345 |
| Static page bundle (help, recent, hubs — no engine/hyparquet) | ~15 KB + shared locale chunks |
| Non-page files (unchanged) | ~330 |
| **Total** | **~62,730 = 63% of the 100,000 platform cap; 70% of the 90,000 page budget** |

Sitemap grows 58,696 → ~62,420 URLs — still two 50k chunks. Hub HTML adds ~9 MB raw
(~8.9 MB across all hubs; every file far under the 20 MiB assertion). Page generation
~2.6 → ~3.0 s; deploy ~5 → ~5.5 min, well inside the 20-minute timeout.

**New module** `build/hubs.mjs` (pure functions + writer):

- **Slugs:** lowercase ASCII slug of the org name (collapse non-alphanumerics,
  80-char cap). Collisions: first org in normalized-name sort order keeps the bare
  slug; later ones get `-2`, `-3` (only 4 collisions exist among multi-block orgs
  today). Empty slugs (7 non-Latin names): `org-<first 8 chars of sha256>`. Slugs are
  stable across builds; a disappearing org freeing a slug is noted as accepted
  (redirects not worth the 2,100-rule `_redirects` cap).
- **Vendor pages** (`/vendor/<slug>`): `h1` org name; lede with computed portfolio facts
  (N blocks, total addresses, first and latest registration dates, registration
  countries); `.data-table` of **all** of the org's blocks — prefix, block type,
  addresses, country, first registered — linking every row to its prefix page
  (**all** blocks, including non-pre-rendered ones; hydration covers those).
  Cross-links: registration-country hubs; a "search this vendor" link to the existing
  `/<org name>` free-text search path; the org's acquired former-owner pages
  (`computeFormerHubs` reverse index, ≤ 10 shown).
- **Country hubs** (`/country/<code>`, lowercase code, name via
  `src/engine/countries.mjs`): `h1` country name; lede (N blocks, total addresses,
  distinct orgs); `.data-table` of **all** orgs registered in that country (name →
  org hub, block count, addresses), sorted by address space. Orgs with a single
  block have no org hub, so their name links the page of that one block instead
  (2026-09-22: every row is a link, and both targets are checked against the
  page-budget selection). The 61 records with no country simply get no country link.
- **Country index** (`/country`, written as root-level `country.html` next to
  the `country/` directory, 2026-09-22): the rollup over all country pages —
  one row per country (linked name, ISO code, organizations, blocks,
  addresses), sorted by address space, totals in the lede (blocks and
  addresses summed; organizations counted distinct, since an org registered in
  two countries appears on both pages). It leads the `country` sitemap scope,
  is the breadcrumb parent of every country page (a `breadcrumbParent` item in
  `renderPage`, so each of the 249 pages links it), and gets a footer
  `Countries` link site-wide. Flat `country.html` (not `country/index.html`)
  keeps the canonical extensionless at `/country`, like `/help` and `/recent`.
- **Former-owner hubs** (`/former/<slug>`): one per organization that no longer
  holds any of its once-registered prefixes (≥ 2 of them; 345 today). The lede
  states the takeaway for each portfolio — e.g. Apple Computer: "Apple, Inc. took
  over all of them" — and the complete table pairs every block with its current
  owner (linked to the vendor hub when one exists). Vendor hubs cross-link the
  former-owner pages they absorbed blocks from; prefix-page lineage timelines link
  former-owner pages for their org names.
- **No display caps on static pages.** Static HTML is the fast path — repetitive
  table rows compress ~10:1 at the edge, so the worst pages stay small on the wire
  (Apple ~23 KB, US ~130 KB) and the complete data is crawlable in one document.
  Totals are stated in the lede ("1,553 blocks"), not as a truncation notice. Every
  row ships visible: the plan's fallback cap (shipped 2026-09-16 — rows past an
  initial 500-row batch `hidden` in the source, revealed by an inline "show more" /
  "show all" script behind a cap note, with a `<noscript>` style hiding the dead
  controls) was removed 2026-09-22, after a real phone revealed all 8,885
  `/country/us` rows in well under a second where the lab's 4× CPU throttle had
  predicted ~4 s (`e2e/measure-showall.mjs` recorded both sides). Hub tables now
  ship no reveal controls, cap note, or inline script; dynamic partial listings
  keep the measured cap and its controls.
- Excluded from hubs: `Private` and empty-org records (consistent with page
  selection). Former-owner pages were out of scope for v1 and shipped on
  2026-09-16 (see above).
- **JSON-LD:** `CollectionPage` + `BreadcrumbList` (Home / Vendors / Org) for org
  hubs, with an `about` `Organization` node (name, address, country) reusing the
  prefix-page pattern; `CollectionPage` + `BreadcrumbList` for country hubs,
  whose breadcrumb gained a middle item (Home / All countries / country) when
  the index shipped; the index page itself is Home / All countries.
  Canonical `https://mac.jasontally.com/vendor/<slug>`.

**Prefix-page updates** (small template diff): the step-1 same-org group gains
"View all N prefixes" → the org hub; the card's org name links to the hub; the
country detail value links to the country hub when one exists; the footer
links the `/country` index.

**Sitemap:** home, `/help`, `/recent`, then hubs, then prefixes — hubs ahead of the
bulk so crawlers reach them early. Passed via the existing `extraUrls` mechanism in
build/build.mjs.

**Docs & agent surfaces:** llms.txt URL scheme (build/agent-files.mjs), the help
page, and the README URL table gain the two namespaces.

**Optional 3-line app change:** wire the lookup form on `data-static-page` pages
(submit navigates to `/<value>`) so hub visitors can paste an address without going
home first.

**Tests:** slug generation (collisions, empty fallback, stability); hub grouping
counts vs portfolio map; full-table rendering (all rows present, deterministic sort,
no truncation notices); sitemap inclusion and ordering; `countPages` counting
directory pages (extend budget.test.mjs); template escaping.

---

## Dynamic display policy (companion to step 2)

Static pages get complete data; dynamic pages keep **measured** limits — the caps
stayed 200 only until `e2e/measure-limits.mjs` re-derived them from real timings
(display 500 at 23 ms throttled; batch 250; 5,000 rows in 296 ms at 4× CPU). Policy:

- **Dynamic caps stay performance-based:** 500 rows per render for partial listings
  and search results. The "showing the first N of M" transparency note stays.
- **Add a "show more" affordance** to dynamic partial listings: the engine caps at
  500 (`listPartials(hex, limit = 500)` returns `matches`, `total`, `truncated`), so
  reveal re-invokes it with a raised limit — a slice over the already-loaded
  registry, never a new fetch. Reveal proceeds in 500-row chunks (each chunk well
  under the measured 23 ms/500-row render cost; 5,000 cumulative rows measure
  296 ms throttled), with the total always visible.
- **Search keeps its engine cap** (`searchRegistry` returns at most 500 matches);
  instead of show-more, vendor-shaped queries gain a link to the complete static hub
  ("View all N prefixes") — the capped dynamic view and the complete static page
  complement each other.
- **Doc sync:** `docs/design.md` still says partials are "capped at 200" — stale
  against the measured 500. Update it to reference the measured caps and this
  static-complete / dynamic-capped split.

This is a client-side change orthogonal to the discoverability steps; ship it with step 2 (same
deploy) or separately — it does not gate steps 1 or 3.

---

## Step 3 — Per-page enrichment

**New module** `build/enrich.mjs` (pure, unit-tested) producing **at most three
short sentences** per prefix page, every one computed from data already on the
record or in the build's in-memory registry — no new data plumbing:

| Fact | Source | Example sentence |
| --- | --- | --- |
| Portfolio position | `vendorBlocks`, `vendorAddresses` (already on every record) | "One of Apple's 1,553 registered blocks; together they span 26.0 billion addresses." |
| Block-size context | `addressCount`, `blockType`, org's other blocks | "A 24-bit MA-L block — 16,777,216 addresses, the largest assignment type." |
| Registration cohort | `firstSeen` vs the org's earliest/latest | "First observed in 1998 — among Apple's oldest registrations." |

Rules: sentences are omitted, not fudged, when the data is missing (no `firstSeen` →
no cohort sentence; single-block org → no portfolio sentence beyond the hub link);
never repeat what the details grid, badges, banners, or lineage already state
(randomization, subdivision, and VM notes stay where they are); wording is factual
about registrations, never about devices (the architecture's device-type caveat).

**Template change:** a `.section-note`-styled context block inside `#result` (before
the related-links sections), i18n keys with `data-i18n-params` interpolation;
English rendered statically like the rest. ~0.5–1 KB per page.

**Explicitly out (guardrail):** no FAQ content on prefix or hub pages; no
generated "about the vendor" prose beyond the computed facts; no per-page FAQPage
schema.

**Tests:** sentence builders (plural forms, omission rules, count formatting via the
existing `formatCount`), template integration.

---

## Monitoring gates (after each step)

1. Deploy the step; wait for a recrawl cycle (sitemap `lastmod` already updates with
   the refresh date).
2. Search Console: index coverage for (a) prefix pages, (b) new hub pages;
   watch "Crawled — currently not indexed" as the thin-content signal.
3. Decision points:
   - After **step 2**: if hubs index promptly and prefix long-tail sits unindexed,
     apply the provisional sitemap policy — trim zero-impression prefixes from the
     sitemap (pages stay live; the client engine still resolves every URL).
   - After **step 3**: if enrichment changes nothing in coverage, stop — do not add
     more generated prose; the guardrail is a ceiling, not a target.
4. Rollback for any step = revert the commit; the next build deletes the files
   (dist is rebuilt from scratch).

## Sequencing rationale

- **1 → 2:** step 1's same-org section is the slot step 2's "View all" hub link
  occupies; doing links first means the day hubs ship, 58k pages already point at
  them. Linking to hubs before they exist would aim the graph at soft-404s — hence
  the strict order.
- **2 → 3:** enrichment sentences reference portfolio and cohort facts that read
  naturally once the hub link ("View all 1,553 prefixes") gives them a destination;
  and step 3 is template-only — zero routing, budget, or sitemap impact, so it can
  also ship last as a safe rollback boundary.
