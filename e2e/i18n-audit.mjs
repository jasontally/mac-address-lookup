/** Ad-hoc: dump all visible UI text on a page for a given locale, flagging English-looking strings. */
import { chromium } from '@playwright/test';

const BASE = process.env.E2E_BASE_URL ?? 'https://mac.jasontally.com';
const LOCALE = process.argv[2] ?? 'zh-Hans';
const PATHS = process.argv[3] ? process.argv[3].split(',') : ['/001B21AABBCC'];

const browser = await chromium.launch({ channel: 'chrome' });
const page = await (await browser.newContext({ baseURL: BASE })).newPage();

for (const route of PATHS) {
  await page.goto(route);
  await page.evaluate((l) => localStorage.setItem('mal.locale', l), LOCALE);
  await page.reload();
  // Wait until the boot actually applied the locale (lang + picker reflect it)
  await page.waitForFunction(
    (l) => document.documentElement.lang === l &&
      document.querySelector('#locale-picker')?.value === l,
    LOCALE,
    { timeout: 15_000 },
  );

  // Collect visible text nodes + title/placeholder/aria attributes
  const texts = await page.evaluate(() => {
    const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
    const seen = new Set();
    const out = [];
    while (walker.nextNode()) {
      const node = walker.currentNode;
      const text = node.textContent?.replace(/\s+/g, ' ').trim();
      if (!text) continue;
      const el = node.parentElement;
      if (el && (el.closest('script') || el.closest('style'))) continue;
      const style = getComputedStyle(el);
      if (style.display === 'none' || style.visibility === 'hidden') continue;
      const key = text + '|' + (el.className ?? '');
      if (seen.has(key)) continue;
      seen.add(key);
      out.push({ text, tag: el.tagName.toLowerCase(), cls: String(el.className).slice(0, 40) });
    }
    const attrs = [];
    for (const el of document.querySelectorAll('[title],[placeholder],[aria-label]')) {
      for (const a of ['title', 'placeholder', 'aria-label']) {
        const v = el.getAttribute(a);
        if (v && v.trim()) attrs.push({ text: v, attr: a, tag: el.tagName.toLowerCase() });
      }
    }
    return { out, attrs, title: document.title };
  });

  console.log(`\n=== ${route} (${LOCALE}) — title: ${texts.title}`);
  const english = (s) => /^[A-Za-z0-9 .,:%&·—–\-/:()'"“”+×#?]+$/.test(s) && /[A-Za-z]{3,}/.test(s);
  for (const t of texts.out) if (english(t.text)) console.log(`  TEXT  <${t.tag} ${t.cls}> ${t.text}`);
  for (const a of texts.attrs) if (english(a.text)) console.log(`  ATTR ${a.tag}[${a.tag === 'input' ? a.tag === 'input' ? 'placeholder' : a.tag === 'a' ? a.tag : a.tag : a.tag}] ${a.text}`);
}
await browser.close();
