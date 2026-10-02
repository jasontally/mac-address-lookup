/**
 * Regenerate public/og-card.png — the 1200x630 social/og:image card used by
 * og:image and twitter:card on every page (head, build/page-template.mjs,
 * build/hubs.mjs, build/recent.mjs). Monochrome, matching the design tokens
 * in src/styles/tokens.css. Run: node build/make-og-card.mjs
 */

import { chromium } from '@playwright/test';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { readFile, writeFile, rm } from 'node:fs/promises';

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const outPath = path.join(root, 'public', 'og-card.png');

const html = `<!doctype html>
<html>
<head>
<meta charset="utf-8" />
<style>
  * { margin: 0; padding: 0; box-sizing: border-box; }
  body {
    width: 1200px; height: 630px;
    background: #fbfbfb;
    color: #161616;
    font-family: -apple-system, "Helvetica Neue", Arial, sans-serif;
    display: flex;
  }
  .frame {
    flex: 1;
    margin: 40px;
    border: 1px solid #dcdcdc;
    padding: 56px 64px;
    display: flex;
    flex-direction: column;
    justify-content: space-between;
  }
  .wordmark {
    font-size: 26px;
    letter-spacing: 0.04em;
    color: #161616;
  }
  .wordmark span { color: #6f6f6f; }
  .main { display: flex; align-items: center; gap: 48px; }
  .octets {
    font-family: ui-monospace, "SF Mono", Menlo, Consolas, monospace;
    font-size: 84px;
    font-weight: 600;
    letter-spacing: -0.02em;
    color: #161616;
    background: #efefef;
    border: 1px solid #d2d2d2;
    padding: 26px 32px;
    border-radius: 16px;
    white-space: nowrap;
  }
  .copy { flex: 1; }
  .copy h2 {
    font-size: 38px;
    font-weight: 650;
    color: #161616;
    line-height: 1.25;
    max-width: 520px;
  }
  .copy p {
    margin-top: 14px;
    font-size: 23px;
    color: #6f6f6f;
    line-height: 1.4;
    max-width: 520px;
  }
  .footer {
    display: flex;
    justify-content: space-between;
    align-items: baseline;
    border-top: 1px solid #dcdcdc;
    padding-top: 22px;
    font-size: 22px;
    color: #6f6f6f;
  }
  .footer strong { font-weight: 600; color: #161616; }
</style>
</head>
<body>
  <div class="frame">
    <div class="wordmark"><strong>MAC Address Lookup</strong> <span>· free &amp; private</span></div>
    <div class="main">
      <div class="octets">00:1A:2B</div>
      <div class="copy">
        <h2>Identify the vendor behind any MAC address or OUI prefix</h2>
        <p>IEEE block details, randomization and VM detection, and prefix lineage. All in your browser, with no tracking.</p>
      </div>
    </div>
    <div class="footer">
      <strong>mac.jasontally.com</strong>
      <span>Complete IEEE registry</span>
    </div>
  </div>
</body>
</html>`;

const browser = await chromium.launch({
  // The local Playwright browser revision can lag the package; fall back to
  // any cached headless shell if the pinned one is missing.
  executablePath:
    process.env.OG_CARD_CHROME ??
    `${process.env.HOME}/Library/Caches/ms-playwright/chromium_headless_shell-*/chrome-headless-shell-mac-arm64/chrome-headless-shell`,
});
const page = await browser.newPage({ viewport: { width: 1200, height: 630 }, deviceScaleFactor: 1 });
await page.setContent(html);
// Screenshot to a temp file and rewrite the bytes through Node's own file IO:
// Chromium-written files can stall Node's fs.cp later in the build pipeline.
const tempPath = path.join(root, 'public', 'og-card.tmp.png');
await page.screenshot({ path: tempPath });
await writeFile(outPath, await readFile(tempPath));
await rm(tempPath);
await browser.close();
console.log(`og-card written: ${outPath}`);
