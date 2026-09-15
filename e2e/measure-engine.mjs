/** Engine-side timing: registry decode + lookup() + searchRegistry scaling. */
import { parquetReadObjects } from 'hyparquet';
import { readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { createRegistry } from '../src/engine/registry.mjs';
import { lookup } from '../src/engine/lookup.mjs';
import { searchRegistry } from '../src/engine/search.mjs';

const distData = path.join(process.cwd(), 'dist', 'data');
const registryFile = readdirSync(distData).find((f) => f.startsWith('registry.'));
const searchFile = readdirSync(distData).find((f) => f.startsWith('search.'));
const toArrayBuffer = (buf) => buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength);

const t0 = performance.now();
const buffer = toArrayBuffer(readFileSync(path.join(distData, registryFile)));
const rows = await parquetReadObjects({ file: buffer });
const t1 = performance.now();
console.log(`decode full registry (${registryFile}): ${Math.round(t1 - t0)} ms, ${rows.length} rows`);

const registry = createRegistry(rows);
const t2 = performance.now();
console.log(`createRegistry: ${Math.round(t2 - t1)} ms`);

// lookup() scaling: 2,000 realistic addresses across many shards
const addresses = Array.from({ length: 2000 }, (_, i) =>
  `${(0x10 + (i % 240)).toString(16).padStart(2, '0')}1B21AABBCC`,
);
for (const n of [100, 500, 1000, 2000]) {
  const s = performance.now();
  for (const address of addresses.slice(0, n)) lookup(registry, address);
  console.log(`lookup() x${n}: ${Math.round(performance.now() - s)} ms`);
}

// search scaling over the full registry (exact + fuzzy fallback)
for (const query of ['intel', 'apple', 'zzzzzz', 'intell']) {
  const s = performance.now();
  const outcome = searchRegistry(registry, null, query, { limit: 200 });
  console.log(`search "${query}": ${Math.round(performance.now() - s)} ms, total ${outcome.total}`);
}
