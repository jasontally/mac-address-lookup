/**
 * Measure the cost of a partial-listing "Show all" rebuild, at 1x and 4x
 * CPU throttling: SPA partial (/00) "Show all" re-renders with limit = total
 * (measured as the click that finally reaches `total` rows).
 *
 * Static hub tables no longer cap or reveal anything - every row ships
 * visible since 2026-09-22; their pre-removal un-hide costs are recorded in
 * docs/architecture.md ("Full-reveal Show all" row).
 *
 * Usage: node e2e/measure-showall.mjs [base-url]
 */
import { chromium } from '@playwright/test';

const BASE = process.argv[2] ?? 'http://localhost:8788';
const browser = await chromium.launch({ channel: 'chrome' });
const out = { partial: {} };

// SPA partial full render -----------------------------------------------------
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
