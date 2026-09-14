/** Deploy raw source copies with the site and describe them with hashes. */

import { createHash } from 'node:crypto';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';

export function sha256(text) {
  return createHash('sha256').update(text).digest('hex');
}

/** Combined hash over sorted `file:sha256` lines, used for change detection. */
export function sourceHashOf(files) {
  const hash = createHash('sha256');
  for (const entry of [...files].sort((a, b) => (a.file < b.file ? -1 : a.file > b.file ? 1 : 0))) {
    hash.update(`${entry.file}:${entry.sha256}\n`);
  }
  return hash.digest('hex');
}

/** Compare freshly fetched source hashes against the last deployed manifest. */
export function compareSources(current, previous) {
  const previousMap = new Map((previous?.files ?? []).map((file) => [file.file, file.sha256]));
  const changed = [];
  for (const file of current) {
    if (previousMap.get(file.file) !== file.sha256) changed.push(file.file);
  }
  for (const file of previousMap.keys()) {
    if (!current.some((entry) => entry.file === file)) changed.push(file);
  }
  return { changed: changed.length > 0, changedFiles: changed };
}

/** Weekly runs skip no-op rebuilds; monthly runs redeploy for freshness. */
export function shouldRefresh({ changed, refreshDate, now = new Date() }) {
  if (changed) return { refresh: true, reason: 'sources-changed' };
  const month = now.toISOString().slice(0, 7);
  if (!refreshDate || refreshDate.slice(0, 7) !== month) {
    return { refresh: true, reason: 'monthly-seo' };
  }
  return { refresh: false, reason: 'no-change' };
}

/**
 * Write the raw sources to `data/sources/` plus a manifest with per-file and
 * combined hashes. The deployed copy is both an emergency cache for builds and
 * the baseline for the weekly change-detection workflow.
 */
export async function writeSourceCache(entries, { outDir }) {
  const dir = path.join(outDir, 'sources');
  await mkdir(dir, { recursive: true });

  const files = [];
  let bytes = 0;
  for (const entry of entries) {
    const text = entry.text ?? '';
    const info = { file: entry.file, bytes: Buffer.byteLength(text), sha256: sha256(text) };
    await writeFile(path.join(dir, entry.file), text);
    files.push(info);
    bytes += info.bytes;
  }

  const manifest = {
    generatedAt: new Date().toISOString(),
    sourceHash: sourceHashOf(files),
    files,
  };
  await writeFile(path.join(dir, 'sources.json'), `${JSON.stringify(manifest, null, 2)}\n`);

  return { dir: 'data/sources', sourceHash: manifest.sourceHash, files, bytes };
}
