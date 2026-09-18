/**
 * One-off merge for build/hub-i18n/<locale>.json translations into
 * src/i18n/locales/<locale>.mjs (the translation subagent only touches
 * the JSON; this script owns the module edits):
 *   1. Validates every locale file: exact en key set, per-key placeholder
 *     multiset identical to English, no suspicious raw markup.
 *   2. Appends missing keys to the locale table (before the closing brace);
 *      keys already present are skipped.
 *   3. node --check each touched module, restoring the original on failure.
 * Usage: node build/merge-hub-i18n.mjs [--dry]
 */

import { readFile, readdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const exec = promisify(execFile);
const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const dry = process.argv.includes('--dry');

const { en } = await import(path.join(root, 'src/i18n/en.mjs'));
const hubKeys = Object.keys(en).filter((key) => key.startsWith('hub.'));
if (hubKeys.length < 10) {
  console.error(`Only ${hubKeys.length} hub.* keys found in en.mjs — check the source`);
  process.exitCode = 1;
  process.exit(1);
}
const hubKeySet = new Set(hubKeys);

const placeholders = (value) =>
  [...String(value).matchAll(/\{[A-Za-z][A-Za-z0-9]*\}/g)].map((m) => m[0]).sort().join(',');
const enPlaceholders = new Map(hubKeys.map((key) => [key, placeholders(en[key])]));

const dir = path.join(root, 'build/hub-i18n');
const files = (await readdir(dir)).filter((f) => f.endsWith('.json'));
const localeCodes = files.map((f) => path.basename(f, '.json'));

let failures = 0;
for (const locale of localeCodes) {
  const values = JSON.parse(await readFile(path.join(dir, `${locale}.json`), 'utf8'));
  const modulePath = path.join(root, 'src/i18n/locales', `${locale}.mjs`);
  const module = await readFile(modulePath, 'utf8');
  const problems = [];
  for (const key of hubKeys) {
    if (typeof values[key] !== 'string') {
      problems.push(`missing ${key}`);
      continue;
    }
    if (placeholders(values[key]) !== enPlaceholders.get(key)) {
      problems.push(
        `${key} placeholders ${placeholders(values[key]) || '(none)'} != en ${enPlaceholders.get(key)}`,
      );
    }
    if (values[key] !== values[key].trim()) problems.push(`${key} leading/trailing whitespace`);
    if (/[<>]|https?:/.test(values[key])) problems.push(`${key} suspicious raw markup`);
  }
  for (const key of Object.keys(values)) {
    if (!hubKeySet.has(key)) problems.push(`unexpected key ${key}`);
  }
  if (problems.length > 0) {
    console.error(`✖ ${locale} (${problems.length} problem(s)):`);
    for (const problem of problems) console.error('   ' + problem);
    failures += 1;
    continue;
  }
  if (dry) {
    console.log(`✓ ${locale} (valid; dry run, no writes)`);
    continue;
  }
  let updated = module;
  let added = 0;
  for (const key of hubKeys) {
    if (module.includes(`"${key}"`)) continue; // already merged
    const entry = `  "${key}": ${JSON.stringify(values[key])},\n`;
    const closing = updated.lastIndexOf('};');
    updated = updated.slice(0, closing) + entry + updated.slice(closing);
    added += 1;
  }
  await writeFile(modulePath, updated);
  try {
    await exec('node', ['--check', modulePath]);
    console.log(`✓ ${locale} +${added}`);
  } catch (error) {
    console.error(`✖ ${locale} failed syntax check:\n${error.message}`);
    failures += 1;
    await writeFile(modulePath, module); // restore on failure
  }
}
if (failures > 0) {
  console.error(`${failures} locale file(s) with problems — fix the JSON files and re-run`);
  process.exitCode = 1;
}
