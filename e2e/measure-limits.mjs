/**
 * Performance measurements for the app's display/input limits.
 * 1. DOM table render cost vs row count (the cost behind the search,
 *    partial, and batch display caps), at 1x and 4x CPU throttling.
 * 2. Shard-fetch+decode crossover vs the full registry (MAX_SHARDS=24).
 * 3. Batch lookup end-to-end time vs batch size through the real UI.
 *
 * Usage: node e2e/measure-limits.mjs [production-url]
 */
import { chromium } from '@playwright/test';
import { writeFileSync } from 'node:fs';

const BASE = process.argv[2] ?? 'https://mac.jasontally.com';
const results = { tableRender: {}, shardCrossover: [], batch: {} };

const browser = await chromium.launch({ channel: 'chrome' });

// ---- 1. Table render scaling ------------------------------------------------
{
  const page = await (await browser.newContext()).newPage();
  await page.goto(`${BASE}/help`); // same CSS, no data fetches
  const client = await page.context().newCDPSession(page);
  const sizes = [50, 100, 200, 500, 1000, 2000, 5000];

  for (const rate of [1, 4]) {
    await client.send('Emulation.setCPUThrottlingRate', { rate });
    results.tableRender[rate] = {};
    for (const n of sizes) {
      const ms = await page.evaluate((rows) => {
        const container = document.createElement('div');
        container.innerHTML =
          '<div class="table-wrap"><table class="data-table stack-table"><thead><tr>' +
          '<th>A</th><th>B</th><th>C</th></tr></thead><tbody></tbody></table></div>';
        const tbody = container.querySelector('tbody');
        const t0 = performance.now();
        for (let i = 0; i < rows; i += 1) {
          const tr = document.createElement('tr');
          const td1 = document.createElement('td');
          td1.className = 'mono';
          const btn = document.createElement('button');
          btn.type = 'button';
          btn.className = 'prefix-button';
          btn.textContent = `00:1B:${(i % 256).toString(16).padStart(2, '0')}`;
          td1.append(btn);
          const td2 = document.createElement('td');
          td2.textContent = 'MA-L';
          const td3 = document.createElement('td');
          td3.className = 'org';
          td3.textContent = 'Intel Corporate, Systems Division';
          tr.append(td1, td2, td3);
          tbody.append(tr);
        }
        const t1 = performance.now();
        container.style.position = 'absolute';
        document.body.append(container);
        container.querySelector('table').getBoundingClientRect(); // force layout
        const t2 = performance.now();
        container.remove();
        return t2 - t0;
      }, n);
      results.tableRender[rate][n] = Math.round(ms);
    }
    console.log(`table render ms @CPU x${rate}:`, JSON.stringify(results.tableRender[rate]));
  }
  await client.send('Emulation.setCPUThrottlingRate', { rate: 1 });
}

// ---- 2. Shard crossover: k parallel shard fetch+decode vs full registry -----
{
  const page = await (await browser.newContext()).newPage();
  await page.goto(`${BASE}/001B21`);
  const data = await page.evaluate(async () => {
    const manifest = await (await fetch('/data/manifest.json', { cache: 'reload' })).json();
    const shardKeys = Object.keys(manifest.shards).sort();
    const decodeViaWorker = (buffer) =>
      new Promise((resolve, reject) => {
        const worker = new Worker(window.__malWorker, { name: 'measure-decode' });
        const id = 1;
        worker.onmessage = (event) => {
          if (event.data?.id !== id) return;
          worker.terminate();
          if (event.data.error) reject(new Error(event.data.error));
          else resolve(event.data.rows);
        };
        worker.onerror = () => { worker.terminate(); reject(new Error('worker failed')); };
        worker.postMessage({ id, buffer });
      });

    const measure = async (urls) => {
      const t0 = performance.now();
      const buffers = await Promise.all(urls.map((u) => fetch(u, { cache: 'reload' }).then((r) => r.arrayBuffer())));
      const t1 = performance.now();
      const rows = await Promise.all(buffers.map((b) => decodeViaWorker(b)));
      const t2 = performance.now();
      return { fetchMs: t1 - t0, decodeMs: t2 - t1, totalMs: t2 - t0 };
    };

    const out = { shards: {}, registry: null };
    for (const k of [1, 2, 4, 8, 16, 24]) {
      const urls = Object.values(manifest.shards).slice(0, k).map((f) => `/${f}`);
      const trials = [];
      for (let i = 0; i < 2; i += 1) trials.push(await measure(urls));
      const total = trials.map((t) => t.totalMs);
      out.shards[k] = {
        fetchMs: Math.round(trials.reduce((s, t) => s + t.fetchMs, 0) / trials.length),
        decodeMs: Math.round(trials.reduce((s, t) => s + t.decodeMs, 0) / trials.length),
        totalMs: Math.round(Math.min(...total)),
        perTrial: total.map((t) => Math.round(t)),
      };
      console.log(`shards k=${k}: fetch ${out.shards[k].fetchMs}ms, decode ${out.shards[k].decodeMs}ms, total ${out.shards[k].totalMs}ms`);
    }
    const t0 = performance.now();
    const reg = await fetch(`/${manifest.data.file}`, { cache: 'reload' }).then((r) => r.arrayBuffer());
    const t1 = performance.now();
    await decodeViaWorker(reg);
    const t2 = performance.now();
    out.registry = { bytes: reg.byteLength, fetchMs: Math.round(t1 - t0), decodeMs: Math.round(t2 - t1), totalMs: Math.round(t2 - t0) };
    console.log(`registry: fetch ${out.registry.fetchMs}ms, decode ${out.registry.decodeMs}ms, total ${out.registry.totalMs}ms`);
    return out;
  });
  results.shardCrossover = data;
}

// ---- 3. Batch end-to-end vs batch size -------------------------------------
{
  // 100 distinct, shard-diverse addresses (a spread-out batch is the real case)
  const addresses = (n) =>
    Array.from({ length: n }, (_, i) => {
      // spread across 16 first-octet prefixes so shards vary widely
      const octets = [(0x10 + (i % 240)).toString(16).padStart(2, '0'), '1B', '21', 'AA', 'BB', 'CC'];
      return octets.join('');
    }).slice(0, n);

  const page = await (await browser.newContext()).newPage();
  for (const n of [10, 25, 50, 100]) {
    const list = addresses(n).join(',');
    const t0 = Date.now();
    await page.goto(`${BASE}/${list}`);
    await page.locator('#result .result-card:not([aria-busy]) .data-table tbody tr').first().waitFor({ timeout: 30000 });
    const elapsed = Date.now() - t0;
    const registryFetched = await page.evaluate(() =>
      performance.getEntriesByType('resource').some((e) => e.name.includes('/data/registry.')),
    );
    results.batch[n] = { ms: elapsed, registryFallback: registryFetched };
    console.log(`batch n=${n}: ${elapsed}ms, registry fallback: ${registryFetched}`);
    if (registryFetched) break; // every larger batch behaves the same once the full registry loads
  }
}

await browser.close();
writeFileSync(process.env.TMPDIR + '/limit-measurements.json', JSON.stringify(results, null, 1));
console.log('saved to $TMPDIR/limit-measurements.json');
