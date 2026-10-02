/** Ad-hoc production sweep: every supported locale must still resolve lookups. */
import { chromium } from '@playwright/test';

const BASE = process.env.E2E_BASE_URL ?? 'https://mac.jasontally.com';
const LOCALES = [
  'en', 'de', 'es', 'fr', 'pt', 'zh-Hans', 'zh-Hant', 'hi', 'bn', 'mr',
  'ur', 'gu', 'pa', 'ta', 'te', 'kn', 'ml', 'ru', 'ja', 'ko',
  'tr', 'vi', 'it', 'ar', 'sw', 'id', 'ha', 'pl', 'fa', 'uk', 'nl',
];
const RTL = new Set(['ur', 'ar', 'fa']);

const browser = await chromium.launch({ channel: 'chrome' });
const context = await browser.newContext({ baseURL: BASE });
const page = await context.newPage();

let failures = 0;
for (const locale of LOCALES) {
  const errors = [];
  page.removeAllListeners('pageerror');
  page.on('pageerror', (error) => errors.push(error.message));
  try {
    await page.goto('/001B21AABBCC');
    await page.evaluate((l) => localStorage.setItem('mal.locale', l), locale);
    await page.reload();
    const vendor = page
      .locator('.vendor')
      .filter({ hasText: 'Intel Corporate' });
    await vendor.waitFor({ timeout: 15_000 });
    const text = (await vendor.textContent())?.trim();
    const dir = await page.evaluate(() => document.documentElement.dir);
    const dirOk = RTL.has(locale) ? dir === 'rtl' : true;
    if (text !== 'Intel Corporate' || errors.length || !dirOk) {
      failures++;
      console.log(`✗ ${locale}: vendor="${text}" dir=${dir} errors=${errors.join(' | ') || 'none'}`);
    } else {
      // Confirm the locale table actually resolved (not just English fallback everywhere)
      const formatLabel = (await page.locator('.format-label').first().textContent())?.trim();
      const fallback = formatLabel === 'Plain hex' && locale !== 'en';
      console.log(`${fallback ? '~' : '✓'} ${locale}${fallback ? ` (fallback: "${formatLabel}")` : ''}`);
    }
  } catch (error) {
    failures++;
    console.log(`✗ ${locale}: ${error.message.split('\n')[0]}`);
  }
}
await browser.close();
console.log(failures === 0 ? `ALL ${LOCALES.length} LOCALES PASS` : `${failures} LOCALE FAILURES`);
process.exit(failures === 0 ? 0 : 1);
