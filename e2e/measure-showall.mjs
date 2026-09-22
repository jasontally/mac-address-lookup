/**
 * Measure the cost of a "Show all" reveal, at 1x and 4x CPU throttling.
 * 1. Hub pages (/country/us etc.): rows ship `hidden`; "Show all" removes
 *    every hidden flag at once -> cost is style+layout+paint.
 * 2. SPA partial listing (/00): "Show all" re-renders with limit = total
 *    (measured as the click that finally reaches `total` rows).
 *
 * Usage: node /tmp/opencode/measure-showall.mjs [base-url]
 */
import { chromium } from '@playwright/test';

const BASE = process.argv[2] ?? 'http://localhost:8788';
const browser = await chromium.launch({ channel: 'chrome' });
const out = { hub: {}, partial: {} };

// ---- 1. Hub page full reveal ------------------------------------------------
const hubPages = ['/country/us', '/country/cn', '/vendor/apple-inc'];
for (const path of hubPages) {
  for (const rate of [1, 4]) {
    const ctx = await browser.newContext({ viewport: { width: 360, height: 740 } });
    const page = await ctx.newPage();
    await page.goto(`${BASE}${path}`, { waitUntil: 'load' });
    const client = await ctx.newCDPSession(page);
    await client.send('Emulation.setCPUThrottlingRate', { rate });
    const m = await page.evaluate(async () => {
      const rows = [...document.querySelectorAll('.data-table tbody tr')];
      const hidden = rows.filter((r) => r.hasAttribute('hidden'));
      const shown = rows.length - hidden.length;
      const t0 = performance.now();
      for (const r of hidden) r.removeAttribute('hidden');
      document.querySelector('.data-table').getBoundingClientRect(); // force layout
      const t1 = performance.now();
      await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
      const t2 = performance.now();
      return { total: rows.length, revealed: hidden.length, shownBefore: shown, layout: t1 - t0, paint: t2 - t0 };
    });
    out.hub[`${path}@${rate}`] = m;
    console.log(
      `hub ${path} @CPU x${rate}: total=${m.total} (shown ${m.shownBefore} -> reveal ${m.revealed}) ` +
        `layout=${Math.round(m.layout)}ms paint=${Math.round(m.paint)}ms`,
    );
    await ctx.close();
  }
}

// ---- 2. SPA partial full render --------------------------------------------
// Clicks run in-page (Playwright's actionability check stalls against a
// button that the app re-creates on every render).
{
  const ctx = await browser.newContext({ viewport: { width: 360, height: 740 } });
  const page = await ctx.newPage();
  const client = await ctx.newCDPSession(page);
  const perRate = {};
  let total = 0;
  for (const rate of [1, 4]) {
    await client.send('Emulation.setCPUThrottlingRate', { rate });
    await page.goto(`${BASE}/00`, { waitUntil: 'networkidle' });
    await page.getByRole('button', { name: 'Show more' }).waitFor({ timeout: 30000 });
    if (!total) {
      const heading = await page.locator('.result-card h2').first().textContent();
      total = Number((heading.match(/[\d, ]+/)?.[0] ?? '0').replace(/[^\d]/g, ''));
      console.log(`/00 partial total = ${total}`);
    }
    const clicks = await page.evaluate(async () => {
      const rows = () => document.querySelectorAll('.data-table tbody tr').length;
      const find = () =>
        [...document.querySelectorAll('button')].find((b) => b.textContent.includes('Show more'));
      const seen = [];
      let guard = 0;
      while (find() && guard < 100) {
        guard += 1;
        const before = rows();
        const t1 = performance.now();
        find().click();
        await new Promise((resolve, reject) => {
          const deadline = performance.now() + 120000;
          const tick = () => {
            if (rows() !== before) return resolve();
            if (performance.now() > deadline) return reject(new Error('timeout waiting for rows'));
            requestAnimationFrame(tick);
          };
          tick();
        });
        const t2 = performance.now();
        await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
        seen.push({ rows: rows(), ms: Math.round(t2 - t1), paintMs: Math.round(performance.now() - t1) });
      }
      return seen;
    });
    const final = clicks.at(-1);
    perRate[rate] = {
      clicks: clicks.length,
      finalRows: final.rows,
      finalClickMs: final.ms,
      finalPaintMs: final.paintMs,
      maxPaintMs: Math.max(...clicks.map((c) => c.paintMs)),
      cumulativeMs: clicks.reduce((s, c) => s + c.paintMs, 0),
    };
    console.log(
      `partial /00 @CPU x${rate}: ${clicks.length} clicks to ${final.rows} rows | ` +
        `full render=${final.ms}ms +paint=${final.paintMs}ms | ` +
        `@1000=${clicks.find((c) => c.rows === 1000)?.paintMs}ms ` +
        `@5000=${clicks.find((c) => c.rows === 5000)?.paintMs}ms ` +
        `cumulative=${perRate[rate].cumulativeMs}ms`,
    );
  }
  out.partial['/00'] = { total, ...perRate };
  await ctx.close();
}

await browser.close();
console.log('JSON:', JSON.stringify(out, null, 1));
