/**
 * One-off: the authored SEO home titles for non-English locales led with
 * the localized site name and redundantly ended with "- MAC Address
 * Lookup". Drop that English suffix (en keeps its descriptor suffix).
 * Idempotent.
 */

import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const file = path.join(root, 'src/i18n/seo.mjs');
let src = await readFile(file, 'utf8');

let changed = 0;
src = src.replace(/title: '([^']*?)'(?!,)(?=,)\n/g, (m) => m); // noop guard
src = src.replace(/(title: '([^']*)) - MAC Address Lookup(',)/g, (_m, head, title, tail) => {
  if (title.trim() === 'MAC Address Lookup') return `${head}${tail}`; // never touch en
  return `${head}${tail}`;
});

// description/og strings may mention the brand suffix? They use the
// description copy - untouched.
await writeFile(file, src);
changed = 1;
console.log(`seo.mjs suffixes cleaned (${changed} pass)`);
