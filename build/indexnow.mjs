/**
 * Post-deploy IndexNow ping (runs in the Cloudflare Workers Build's deploy
 * command: `npx wrangler deploy && node build/indexnow.mjs`).
 *
 * Reads `data/indexnow.json` from the just-deployed site — the list of URLs
 * whose bytes actually changed this build (emitted by finalizePageHashes,
 * build/page-hashes.mjs) — and notifies the shared IndexNow endpoint
 * (api.indexnow.org routes to Bing, Yandex, Seznam, Yep). Google does not
 * consume IndexNow; Bing powers DuckDuckGo and other engines.
 *
 * The key file must be deployed at `/{key}.txt` (public/<key>.txt in the
 * repo) — that is the IndexNow ownership-proof convention.
 *
 * Failures never fail the deploy: content is already live, the ping is
 * advisory. Log and exit 0.
 */

import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const SITE = 'https://mac.jasontally.com';
const KEY = 'a6523ab083666dfaba05437bcb9b2ad4';
const ENDPOINT = 'https://api.indexnow.org/indexnow';
const BATCH = 10_000; // IndexNow cap: 10,000 URLs per request

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));

try {
  const localKey = (await readFile(path.join(root, 'public', `${KEY}.txt`), 'utf8')).trim();
  if (localKey !== KEY) throw new Error('key file does not match the KEY constant');

  const response = await fetch(`${SITE}/data/indexnow.json`, {
    signal: AbortSignal.timeout(30_000),
  });
  if (!response.ok) throw new Error(`indexnow.json fetch returned ${response.status}`);
  const { urls } = await response.json();

  if (!Array.isArray(urls) || urls.length === 0) {
    console.log('indexnow: no changed URLs, nothing to ping');
  } else {
    let submitted = 0;
    for (let offset = 0; offset < urls.length; offset += BATCH) {
      const urlList = urls.slice(offset, offset + BATCH);
      const result = await fetch(ENDPOINT, {
        method: 'POST',
        headers: { 'content-type': 'application/json; charset=utf-8' },
        body: JSON.stringify({
          host: new URL(SITE).host,
          key: KEY,
          keyLocation: `${SITE}/${KEY}.txt`,
          urlList,
        }),
        signal: AbortSignal.timeout(30_000),
      });
      // 200/202 = accepted; 400/403/422 usually means key or format trouble.
      console.log(`indexnow: batch ${urlList.length} URLs -> ${result.status}`);
      if (!result.ok) throw new Error(`IndexNow rejected the batch with ${result.status}`);
      submitted += urlList.length;
    }
    console.log(`indexnow: notified ${submitted.toLocaleString('en-US')} changed URLs`);
  }
} catch (error) {
  console.log(`indexnow: skipped (${error.message}); deploy is unaffected`);
}
