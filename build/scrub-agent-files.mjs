/**
 * One-off: scrub the em dashes from the shipped agent-facing copy in
 * build/agent-files.mjs (/llms.txt, /help.md, /help.txt). Each occurrence
 * gets the separator chosen for its role:
 *   - definition/annotation after a path or label: " - "
 *   - consequence/spec introduced by a clause: ":" or "," or a split sentence
 *   - parenthetical remark: "(...)"
 *   - empty-value table cell: "-"
 */

import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const exec = promisify(execFile);
const here = path.dirname(fileURLToPath(import.meta.url));
const file = path.join(here, 'agent-files.mjs');
let s = await readFile(file, 'utf8');
const before = s;

const reps = [
  // llms.txt lineage bullet: consequence clause to comma
  ['first-observed dates — the only public dataset', 'first-observed dates, the only public dataset'],
  // help.txt bullet tail to comma
  ['refuse the markdown media type — it is valid Markdown either way', 'refuse the markdown media type, it is valid Markdown either way'],
  // URL-scheme bullets: definition separator to " - "
  ['- \\`/{hex}\\` — lookup a MAC address', '- \\`/{hex}\\` - lookup a MAC address'],
  ['- \\`/vendor/{slug}\\` — pre-rendered provider', '- \\`/vendor/{slug}\\` - pre-rendered provider'],
  ['- \\`/country/{code}\\` — pre-rendered country', '- \\`/country/{code}\\` - pre-rendered country'],
  ['- \\`/former/{name}\\` — pre-rendered former-owner', '- \\`/former/{name}\\` - pre-rendered former-owner'],
  ['- \\`/{vendor-name}\\` — free-text search', '- \\`/{vendor-name}\\` - free-text search'],
  ['- \\`/{a},{b}\\` — batch lookup', '- \\`/{a},{b}\\` - batch lookup'],
  ['- \\`/?q={text}\\` — legacy query', '- \\`/?q={text}\\` - legacy query'],
  // Data-file bullets to " - "
  ['manifest.json — index', 'manifest.json - index'],
  ['index.txt — a machine-readable', 'index.txt - a machine-readable'],
  ['{key}.txt\\` — one JSON object per line', '{key}.txt\\` - one JSON object per line'],
  ['sources-index.json — raw', 'sources-index.json - raw'],
  // llms.txt prose: OUI parenthetical
  ['its first three bytes — the\nOrganizationally Unique Identifier (OUI) — are registered', 'its first three bytes (the\nOrganizationally Unique Identifier, OUI) are registered'],
  // help.md feature bullets to colon
  ['- Randomization detection — modern phones', '- Randomization detection: modern phones'],
  ['- Prefix lineage — acquisitions', '- Prefix lineage: acquisitions'],
  ['The interface runs in 31 languages — switch it', 'The interface runs in 31 languages: switch it'],
  // help.md hub bullets: "**Vendor pages** — `url`: ..." to label (url): form
  ['- **Vendor pages** — \\`${site}/vendor/{slug}\\`: every', '- **Vendor pages** (\\`${site}/vendor/{slug}\\`): every'],
  ['- **Country pages** — \\`${site}/country/{code}\\`: every', '- **Country pages** (\\`${site}/country/{code}\\`): every'],
  ['- **Former-owner pages** — \\`${site}/former/{name}\\`: organizations', '- **Former-owner pages** (\\`${site}/former/{name}\\`): organizations'],
  // help.md former-owner prose tail to comma
  ['what happened to each\n  block — including acquisitions', 'what happened to each\n  block, including acquisitions'],
  // help.md "registries do not reassign" sentence to period split
  ['the registries do not\nreassign most prefixes — an acquisition usually leaves', 'the registries do not\nreassign most prefixes. An acquisition usually leaves'],
  // help.md data-programmatically lead-in to colon
  ['downloadable as machine-readable files — one JSON object per\nline', 'downloadable as machine-readable files: one JSON object per\nline'],
  // download bullets to colon
  ['registry.ndjson](${site}/data/registry.ndjson) — every IEEE assignment', 'registry.ndjson)(${site}/data/registry.ndjson) - every IEEE assignment'],
  ['lineage.ndjson)(${site}/data/lineage.ndjson) — every ownership-change event', 'lineage.ndjson)(${site}/data/lineage.ndjson) - every ownership-change event'],
  // shard walkthrough: em dashes to parentheses / colon / comma
  ['a prefix of that hex —\n   here \\`8c1f64af\\` — and fetch', 'a prefix of that hex\n   (here \\`8c1f64af\\`) and fetch'],
  ['is \\`8C1F64AFA\\` — an MA-S block of 4,096 addresses registered to\n   DATA ELECTRONIC DEVICES, INC — not its parent MA-L \\`8C1F64\\`.', 'is \\`8C1F64AFA\\`: an MA-S block of 4,096 addresses registered to\n   DATA ELECTRONIC DEVICES, INC, not its parent MA-L \\`8C1F64\\`.'],
  // llms lineage bullet body tail
  ['ownership-change events with first-observed dates', 'ownership-change events with first-observed dates'],
];

for (const [a, b] of reps) {
  if (a === b) continue;
  if (!s.includes(a)) {
    console.error(`pattern not found: ${JSON.stringify(a.slice(0, 60))}`);
  }
  s = s.split(a).join(b);
}

// comment: "13+ MB — over some tools' content-size limits"
s = s.split('is 13+ MB — over some tools\' content-size').join('is 13+ MB, over some tools\' content-size');

await writeFile(file, s);
await exec(process.execPath, ['--check', file]);
const left = s.match(/—/g)?.length ?? 0;
console.log(`remaining em dashes in agent-files.mjs: ${left}`);
