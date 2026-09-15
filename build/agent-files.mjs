/**
 * Agent- and script-facing static files: /llms.txt, /help.md, and the NDJSON
 * data downloads (/data/registry.ndjson, /data/lineage.ndjson). All are plain
 * files so agents with nothing but curl can use the site; see
 * docs/feature-research.md §AI-friendliness.
 */

import { writeFile, mkdir } from 'node:fs/promises';
import path from 'node:path';
import { FAQ } from './faq.mjs';

const SITE = 'https://mac.jasontally.com';

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
      `- [Lineage download (NDJSON)](${SITE}/${dataFiles.lineage}): ownership-change events with first-observed dates — the only public dataset of its kind`,
    );
  }
  return `# MAC Address Lookup

> Free, private MAC address and OUI vendor lookup. Every prefix page is
> pre-rendered static HTML that reads cleanly without JavaScript. No API
> keys, no auth, no tracking. Run by Jason Tally.

- [Help & documentation](${SITE}/help): how lookup works, block types, finding your own MAC, FAQ
- [Help (Markdown)](${SITE}/help.md): the same documentation as Markdown
- [Latest OUIs](${SITE}/recent): the most recently registered blocks, refreshed every deploy

## URL scheme

- \`/{hex}\` — lookup a MAC address or prefix. 6+ hex characters resolve via
  longest-prefix match across MA-L, MA-M, MA-S, IAB, and CID; a full 12-hex
  address resolves to its vendor. Pages are pre-rendered HTML.
- \`/{vendor-name}\` — free-text search over vendors, former owners, countries,
  block types, prefixes, and registration years. Results are an HTML table.
- \`/{a},{b}\` — batch lookup of comma-separated addresses (up to 100).
- \`/?q={text}\` — legacy query form; redirects to the path scheme.

No JavaScript is required to read any page; results pages for lookups are
fully server-rendered for registered prefixes.

## Data files

- ${SITE}/data/manifest.json — index of the current data files (Parquet + NDJSON)
${dataLines.join('\n')}
- ${SITE}/data/sources-index.json — raw IEEE source files archived per deploy

The registry data is derived from the public IEEE Registration Authority
registries (no restrictions apply). Ownership-history events come from the
runZero mac-tracker dataset (MIT). The site itself ships no ads, no cookies,
and no tracking; lookups run client-side.
`;
}

export function helpMarkdown({ site = SITE } = {}) {
  const faq = FAQ.map(
    (item, index) => `### ${index + 1}. ${item.question}\n\n${item.answer}`,
  ).join('\n\n');
  return `# Help & documentation

Every network interface has a MAC address, and its first three bytes — the
Organizationally Unique Identifier (OUI) — are registered with the IEEE
Registration Authority. This lookup resolves that prefix against the complete
IEEE registries using longest-prefix matching, so small blocks resolve to the
correct organization rather than a generic parent block.

- Vendor and registered organization, with block type and address range
- Randomization detection — modern phones randomize Wi-Fi addresses, which have no vendor
- Virtual-machine prefixes for VMware, VirtualBox, Hyper-V, Parallels, Xen, QEMU/KVM, and Docker
- Prefix lineage — acquisitions and renames, with the dates each change was first observed
- Format conversions: colon, hyphen, Cisco dot, plain hex, EUI-64, and IPv6 link-local

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
| CID | 24 bits (6 hex) | — | Company identifiers, not assigned to network interfaces |

## How to find your own MAC address

- **Windows:** run \`getmac /v\`, or open Settings → Network & internet → Hardware properties.
- **macOS:** open System Settings → Network → Details, or run \`ifconfig en0 | grep ether\`.
- **Linux:** run \`ip link\` and read the \`link/ether\` value.
- **iPhone / Android:** open the Wi-Fi network details. The "private Wi-Fi address" shown there is randomized and will not resolve to a vendor.

## Frequently asked questions

${faq}

## Data sources and accuracy

Current assignments come from the IEEE Registration Authority's MA-L, MA-M,
MA-S, IAB, and CID registries, refreshed on every deploy. Historical changes
come from [runZero mac-tracker](https://github.com/runZeroInc/mac-tracker) (MIT),
which records when an organization name changed in the public data. Those dates
are observation dates, not legal transfer dates, and the registries do not
reassign most prefixes — an acquisition usually leaves the old vendor name on
existing hardware forever.
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

  const lineageNdjson = ndjson(
    lineageEvents.map((event) => ({
      prefix: event.prefix,
      date: event.date ?? null,
      orgName: event.orgName ?? null,
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

  return {
    registryBytes: registryNdjson.length,
    lineageBytes: lineageNdjson.length,
  };
}
