/**
 * Agent- and script-facing static files: /llms.txt, /help.md, and the NDJSON
 * data downloads (/data/registry.ndjson, /data/lineage.ndjson). All are plain
 * files so agents with nothing but curl can use the site; see
 * the agent-access research notes, now folded into docs/architecture.md.
 */

import { readFile, writeFile, mkdir } from 'node:fs/promises';
import path from 'node:path';
import { FAQ } from './faq.mjs';

/** Public origin. Exported so the build can assert mcp-shards.mjs agrees. */
export const SITE = 'https://mac.jasontally.com';

/** One JSON object per line, no trailing newline ambiguity. */
function ndjson(rows) {
  return rows.map((row) => JSON.stringify(row)).join('\n') + '\n';
}

export function llmsTxt({ dataFiles = {} } = {}) {
  const dataLines = [];
  if (dataFiles.registry) {
    dataLines.push(
      `- [Registry download (NDJSON)](${SITE}/${dataFiles.registry}): one JSON object per IEEE assignment (~${dataFiles.registryMb} MB)`,
    );
  }
  if (dataFiles.lineage) {
    dataLines.push(
      `- [Lineage download (NDJSON)](${SITE}/${dataFiles.lineage}): ownership-change events with first-observed dates, the only public dataset of its kind`,
    );
  }
  return `# MAC Address Lookup

> Free, private MAC address and OUI vendor lookup. Every prefix page is
> pre-rendered static HTML that reads cleanly without JavaScript. No API
> keys, no auth. The app itself does no tracking: lookups you make on this
> website run client-side and the addresses you enter are never processed
> by a server (normal requests still reach the host — a direct link like
> /apple carries its URL path). The app sets no cookies. The MCP endpoint
> below is the one exception: it is an HTTP request, so a submitted
> address is visible to the host. The host (Cloudflare) collects
> privacy-first, cookieless, aggregate web analytics.
> Run by Jason Tally.
>
> Privacy policy: ${SITE}/privacy — terms of service: ${SITE}/terms
> — AI assistant usage: ${SITE}/help#mcp

- [Help & documentation](${SITE}/help): how lookup works, block types, finding your own MAC, FAQ
- [Help (Plain text)](${SITE}/help.txt): the same documentation as plain text, for tools that
  refuse the markdown media type, it is valid Markdown either way
- [Help (Markdown)](${SITE}/help.md): the same documentation as Markdown
- [Latest OUIs](${SITE}/recent): the most recently registered blocks, refreshed every deploy
- Interface available in 31 languages (30 translations plus English; switcher on
  every page; Urdu, Arabic, and Persian render right-to-left; each language
  also has a pre-rendered home page under \`${SITE}/lang/{locale}/\`, declared
  cross-locale with \`hreflang\` alternates on all variants)

## URL scheme

- \`/{hex}\` - lookup a MAC address or prefix. 6+ hex characters resolve via
  longest-prefix match across MA-L, MA-M, MA-S, IAB, and CID; a full 12-hex
  address resolves to its vendor. Pages are pre-rendered HTML.
- \`/vendor\` - pre-rendered vendor index: every organization with two or more
  registered blocks, with block and address-space totals, each row linking
  the organization's page.
- \`/vendor/{slug}\` - pre-rendered provider page: every MAC block registered
  to one organization (vendors with two or more blocks), as a complete table.
- \`/country\` - pre-rendered country index: every country with at least one
  registered block, with organization, block, and address-space totals, each
  row linking the country's page.
- \`/country/{code}\` - pre-rendered country page: every organization with
  blocks registered in that country, with block counts and address space.
- \`/former/{name}\` - pre-rendered former-owner page: organizations that no
  longer hold any of their once-registered prefixes, with what happened to
  each block (transfers, renames, full acquisitions).
- \`/registry\` and \`/registry/{type}\` - pre-rendered registry-type pages for
  MA-L, MA-M, MA-S, IAB, and CID.
- \`/year\` and \`/year/{year}\` - pre-rendered cohorts by first-observed year.
- \`/region\` and \`/region/{region}\` - pre-rendered continental rollups of
  current registration countries.
- \`/history\` and \`/history/{year}\` - observed ownership changes by year.
- \`/history/country\` and \`/history/country/{code}\` - historical country
  views of ownership-change records.
- \`/successor\` and \`/successor/{slug}\` - current owners of transferred
  prefixes and the former owners they absorbed.
- \`/{vendor-name}\` - free-text search over vendors, former owners, countries,
  block types, prefixes, and registration years. Results are an HTML table.
- \`/?q={text}\` - legacy query form; redirects to the path scheme.
- \`/mcp\` - stateless MCP server over Streamable HTTP, one \`lookup\` tool; see below.

No JavaScript is required to read any page; results pages for lookups are
fully pre-rendered for registered prefixes.

## Data files

- ${SITE}/data/manifest.json - index of the current data files (Parquet + NDJSON)
${dataLines.join('\n')}
- ${SITE}/data/sources-index.json - raw IEEE source files archived per deploy

## MCP server

${SITE}/mcp is a [MCP](https://modelcontextprotocol.io) server over Streamable
HTTP. It exposes one tool, \`lookup\`, which resolves a MAC address or OUI prefix
to its registered organization by longest-prefix match.

**No API key, no auth, no session, and no handshake required.** The 2026-07-28
specification removed the \`initialize\` handshake, so a current client posts a
request directly. The endpoint also answers an \`initialize\` probe
statelessly — no session is created and no \`Mcp-Session-Id\` is ever issued — so
a 2025-era client can connect too, and a request naming an unsupported protocol
version is refused with \`-32022\` and the list of versions served.

A GET that sends \`Accept: text/event-stream\` is answered with an SSE stream, for
clients that still probe the old transport; that stream carries no events, and
any other GET gets \`405\`.

Add \`${SITE}/mcp\` to your client, or read a tool catalog first:

    {"jsonrpc":"2.0","id":1,"method":"tools/list"}

Then resolve one address:

    POST ${SITE}/mcp
    Content-Type: application/json

    {"jsonrpc":"2.0","id":1,"method":"tools/call",
     "params":{"name":"lookup","arguments":{"mac":"8C:1F:64:AF:A4:B2"}}}

The reply carries the matched prefix, block type, address count, organization
name, registration country, and a link to the record page, which is where the
organization address lives. This is the recommended way for an agent to use this
site: it returns one resolved answer per call, and never makes the agent read a
data file. The machine-readable catalog is at
\`${SITE}/.well-known/ai-catalog.json\`.

The registry is also split into small \`text/plain\` shards under
\`${SITE}/data/mcp/\`, but they are a cache for the server rather than an
interface. Each file is one 4-character hex bucket, so a single fetch covers
every registered prefix a query could match. Prefer the MCP endpoint.

The registry data is derived from the public IEEE Registration Authority
registries (no restrictions apply). Ownership-history events come from the
runZero mac-tracker dataset (MIT). The app itself ships no ads and no
cookies and does no tracking. Lookups run client-side: a lookup you make
through the website never sends the address to a server. The MCP endpoint
is the one exception, because it is an HTTP request — a submitted
address is visible to the host, no session is created, and nothing is
linked to anything else. The host (Cloudflare) collects privacy-first,
cookieless, aggregate web analytics.

The privacy policy is at ${SITE}/privacy and the terms of service are at
${SITE}/terms. Both state that results can be wrong or out of date, that
the site is not affiliated with IEEE, and that results must not be used
to identify or profile any individual.
`;
}

export function helpMarkdown({ site = SITE } = {}) {
  const faq = FAQ.map(
    (item, index) => `### ${index + 1}. ${item.question}\n\n${item.answer}`,
  ).join('\n\n');
  return `# Help & documentation

Every network interface has a MAC address, and its first three bytes (the
Organizationally Unique Identifier, OUI) are registered with the IEEE
Registration Authority. This lookup resolves that prefix against the complete
IEEE registries using longest-prefix matching, so small blocks resolve to the
correct organization rather than a generic parent block.

- Vendor and registered organization, with block type and address range
- Randomization detection: modern phones randomize Wi-Fi addresses, which have no vendor
- Virtual-machine prefixes for VMware, VirtualBox, Hyper-V, Parallels, Xen, QEMU/KVM, and Docker
- Prefix lineage: acquisitions and renames, with the dates each change was first observed
- Format conversions: colon, hyphen, Cisco dot, plain hex, EUI-64, and IPv6 link-local

The interface runs in 31 languages (English plus 30 translations; Urdu,
Arabic, and Persian render right-to-left): switch it with the language picker, or
open a pre-rendered localized home page at \`${site}/lang/{locale}/\` (for
example [Spanish](${site}/lang/es/) or [Japanese](${site}/lang/ja/)); the
lookup itself, results pages, and downloadable data are language-neutral.
This document and the prefix/hub pages are English.

## How MAC address lookup works

A MAC address is 48 bits, usually written as six hex pairs such as \`00:1B:21:3C:4D:5E\`.
The IEEE assigns the leading bits to organizations as registered blocks: MA-L blocks
are 24 bits, MA-M blocks are 28 bits, and MA-S and IAB blocks are 36 bits. A lookup
tries the longest registered prefix first, so a device inside an MA-S block is
attributed to the company that holds that block, not the parent MA-L. The first
octet also carries two flag bits: the I/G bit marks multicast addresses, and the
U/L bit marks locally administered addresses such as randomized privacy addresses
and virtual machines.

## MAC address block types

| Registry | Prefix length | Addresses per block | Typical use |
| --- | --- | --- | --- |
| MA-L | 24 bits (6 hex) | 16,777,216 | Classic OUI; the vast majority of network hardware |
| MA-M | 28 bits (7 hex) | 1,048,576 | Mid-size allocations, common for newer vendors |
| MA-S | 36 bits (9 hex) | 4,096 | Small allocations; IoT modules and niche hardware |
| IAB | 36 bits (9 hex) | 4,096 | Legacy Individual Address Blocks from reserved ranges |
| CID | 24 bits (6 hex) | - | Company identifiers, not assigned to network interfaces |

## How to find your own MAC address

- **Windows:** run \`getmac /v\`, or open Settings → Network & internet → Hardware properties.
- **macOS:** open System Settings → Network → Details, or run \`ifconfig en0 | grep ether\`.
- **Linux:** run \`ip link\` and read the \`link/ether\` value.
- **iPhone / Android:** open the Wi-Fi network details. The "private Wi-Fi address" shown there is randomized and will not resolve to a vendor.

## Vendors, countries, and former owners

Besides prefix pages, the site pre-renders reference pages organized by the
registration itself, each with its complete table:

- **Vendor index** (\`${site}/vendor\`): every organization with two or more
  registered blocks, with block and address-space totals per organization,
  sorted by address space; each row links that organization's page.
- **Vendor pages** (\`${site}/vendor/{slug}\`): every MAC block registered to one
  organization, with block types, address space, countries, and registration dates.
- **Country index** (\`${site}/country\`): every country with at least one
  registered MAC address block, with organization, block, and address totals
  per country, sorted by address space; each row links that country's page.
- **Country pages** (\`${site}/country/{code}\`): every organization with blocks
  registered in that country, sorted by address space.
- **Former-owner pages** (\`${site}/former/{name}\`): organizations that no longer
  hold any of the prefixes once registered to them, showing what happened to each
  block, including acquisitions where one new owner took over all of them
  (for example [Apple Computer](${site}/former/apple-computer), whose blocks are
  now registered to Apple, Inc.).
- **Registry, year, region, history, and successor pages**: additional
  dimensions with complete tables at \`${site}/registry\`, \`${site}/year\`,
  \`${site}/region\`, \`${site}/history\`, and \`${site}/successor\`; each
  index links its own detail pages.

## Frequently asked questions

${faq}

## Data sources and accuracy

Current assignments come from the IEEE Registration Authority's MA-L, MA-M,
MA-S, IAB, and CID registries, refreshed on every deploy. Historical changes
come from [runZero mac-tracker](https://github.com/runZeroInc/mac-tracker) (MIT),
which records when an organization name changed in the public data. Those dates
are observation dates, not legal transfer dates, and the registries do not
reassign most prefixes. An acquisition usually leaves the old vendor name on
existing hardware forever.

## Using the data programmatically

Two datasets are downloadable as machine-readable files: one JSON object per
line, no keys or auth required:

- [registry.ndjson](${site}/data/registry.ndjson) - every IEEE assignment
  (prefix, block type, organization, address, country, first-observed date).
  ~13.6 MB.
- [lineage.ndjson](${site}/data/lineage.ndjson) - every ownership-change event
  with its first-observed date and historical registration country.

For a single lookup you do not need the full registry. The fastest route is the
MCP server, which resolves one address per call and returns the answer directly:

- [${site}/mcp](${site}/mcp) - stateless [MCP](https://modelcontextprotocol.io) server
  over Streamable HTTP. No key, no auth, no session, no \`initialize\` handshake.
  One tool, \`lookup\`, that takes a MAC address or OUI prefix and returns the
  registered organization, block type, address count, country, and a link to
  the record page. Send \`{"method":"tools/list"}\` for the schema, then:

      curl -sS ${site}/mcp -H 'content-type: application/json' \\
        -d '{"jsonrpc":"2.0","id":1,"method":"tools/call",
             "params":{"name":"lookup","arguments":{"mac":"8C:1F:64:AF:A4:B2"}}}'

If your client cannot speak MCP, use the NDJSON downloads linked above and
match the longest registered prefix yourself. The \`${site}/data/mcp/\` shards are
an internal cache for the \`/mcp\` endpoint and are not a supported interface:
most of them are keyed by the first 4 hex characters, but three dense ranges are
keyed by 6, and that routing table is not published. A client guessing file names
will get the site shell instead of a shard.

The most recent registrations are listed on the
[Latest OUIs](${site}/recent) page, refreshed on every deploy.
`;
}

/**
 * Write the agent-facing files into dist/.
 * `records` are normalized registry rows; `lineageEvents` are
 * { prefix, date, orgName, seq } ownership-change events.
 */
export async function writeAgentFiles({ distDir, records, lineageEvents = [] } = {}) {
  await mkdir(path.join(distDir, 'data'), { recursive: true });

  const registryNdjson = ndjson(
    records.map((record) => ({
      prefix: record.prefix,
      prefixLen: record.prefixLen,
      blockType: record.blockType,
      addressCount: record.addressCount,
      orgName: record.orgName,
      orgAddress: record.orgAddress || null,
      country: record.country || null,
      isPrivate: record.isPrivate ?? false,
      firstSeen: record.firstSeen ?? null,
    })),
  );
  await writeFile(path.join(distDir, 'data', 'registry.ndjson'), registryNdjson);

  // The old per-prefix .txt shard surface (variable-length trie keys plus an
  // index.txt) is gone. It asked a model to run two longest-prefix searches
  // over free text, which models do unreliably. build/mcp-shards.mjs now emits
  // the MCP lookup shards instead, and the edge snippet does the matching.

  const lineageNdjson = ndjson(
    lineageEvents.map((event) => ({
      prefix: event.prefix,
      date: event.date ?? null,
      orgName: event.orgName ?? null,
      country: event.country ?? null,
      seq: event.seq ?? null,
    })),
  );
  await writeFile(path.join(distDir, 'data', 'lineage.ndjson'), lineageNdjson);

  await writeFile(
    path.join(distDir, 'llms.txt'),
    llmsTxt({
      dataFiles: {
        registry: 'data/registry.ndjson',
        registryMb: Math.round((registryNdjson.length / 1_048_576) * 10) / 10,
        lineage: 'data/lineage.ndjson',
      },
    }),
  );
  await writeFile(path.join(distDir, 'help.md'), helpMarkdown());
  await writeFile(path.join(distDir, 'help.txt'), helpMarkdown());

  return {
    registryBytes: registryNdjson.length,
    lineageBytes: lineageNdjson.length,
  };
}
