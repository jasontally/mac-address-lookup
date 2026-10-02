/**
 * Post-deploy IndexNow ping (runs in the Cloudflare Workers Build's deploy
 * command: `npx wrangler deploy && node build/indexnow.mjs`).
 *
 * Reads `data/indexnow.json` from the just-deployed site — the list of URLs
 * whose bytes actually changed this build (emitted by finalizePageHashes,
 * build/page-hashes.mjs) — and notifies the IndexNow endpoints. Google does not
 * consume IndexNow; Bing powers DuckDuckGo and other engines.
 *
 * The key file must be deployed at `/{key}.txt` (public/<key>.txt in the
 * repo) — that is the IndexNow ownership-proof convention.
 *
 * ## The response body is the whole diagnostic, so it is logged
 *
 * The previous version logged only the status code and then threw the response
 * away. Bing rejects an unregistered domain with:
 *
 *   403 {"errorCode":"UserForbiddedToAccessSite",
 *        "message":"User is unauthorized to access the site. Please verify the
 *                   site using the key and try again"}
 *
 * `batch 3628 URLs -> 403` does not say that. It reads as a format problem, a
 * rate limit, or a bug in the payload, and each of those sends you to change
 * code that is already correct. Every rejection is now logged with the body, so
 * the next 403 names its own cause.
 *
 * ## Why the live key file is checked, and what that does not prove
 *
 * The key file being correct is necessary but not sufficient. Bing holds the
 * domain/key binding in its own backend, and returns 403 until that binding
 * exists. It is created when Bingbot crawls the key file, or when the owner
 * verifies the domain in Bing Webmaster Tools. Until then the ping is refused
 * however correct this script is.
 *
 * So the check below separates the two failures that both look like "403":
 *
 *   key file wrong or unreachable  -> our fault, and it says so
 *   key file correct, Bing says 403 -> their backend, and it says that too
 *
 * Do not read a passing check as a working ping. See docs/mcp-listing.md, or
 * the IndexNow section of docs/architecture.md, for the owner action.
 *
 * ## Endpoints are independent, so one rejection must not hide the others
 *
 * `api.indexnow.org` fans a submission out to every participating engine, but
 * it validates the key first and rejects the whole batch when the check fails.
 * Nothing is shared, so a Bing refusal also silently loses Yandex, Seznam and
 * Yep. Yandex accepts the identical payload, so it is pinged directly too, and
 * each endpoint is reported on its own.
 *
 * Note the trap this avoids: Yandex answers `202 {"success":true}` for
 * submissions Bing rejects outright. Treating any 2xx as success would report a
 * working IndexNow while Bing had refused every URL.
 *
 * Failures never fail the deploy: content is already live, the ping is
 * advisory. Log and exit 0.
 */

import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const SITE = 'https://mac.jasontally.com';
const KEY = 'a6523ab083666dfaba05437bcb9b2ad4';
const BATCH = 10_000; // IndexNow cap: 10,000 URLs per request

/**
 * Endpoints to notify, in order. The shared one covers most engines; Yandex is
 * added because the shared one drops the whole batch when Bing refuses it.
 */
export const ENDPOINTS = ['https://api.indexnow.org/indexnow', 'https://yandex.com/indexnow'];

/**
 * Node's default User-Agent is the bare string `node`, which is not helpful in
 * an engine's request log. Send a name that identifies this build.
 */
const HEADERS = {
  'content-type': 'application/json; charset=utf-8',
  accept: 'application/json',
  'user-agent': 'mac-address-lookup-indexnow/1.0 (+https://mac.jasontally.com)',
};

/** The request body IndexNow expects for one batch of URLs. */
export function batchPayload({ site = SITE, key = KEY, urlList }) {
  return {
    host: new URL(site).host,
    key,
    keyLocation: `${site}/${key}.txt`,
    urlList,
  };
}

/**
 * Confirm the *deployed* key file answers with the key.
 *
 * The build also checks the copy in `public/`, but that only proves the file
 * exists locally. This proves the zone serves it, which is what an engine
 * fetches. Throws with a message that names this script as the cause.
 *
 * A pass here does not mean a ping will be accepted. See the file header.
 */
export async function checkKeyFile({ site = SITE, key = KEY, fetchImpl = fetch } = {}) {
  const location = `${site}/${key}.txt`;
  const response = await fetchImpl(location, { signal: AbortSignal.timeout(20_000) });
  if (!response.ok) {
    throw new Error(
      `the deployed key file at ${location} returned ${response.status}. ` +
        'That is our fault: the file is not being served, so no engine can verify ownership.',
    );
  }
  const body = (await response.text()).trim();
  if (body !== key) {
    throw new Error(
      `the deployed key file at ${location} does not contain the key. ` +
        'That is our fault: public/<key>.txt and the KEY constant disagree.',
    );
  }
}

/** One POST. Returns the status and the body, so the caller can log both. */
export async function submitBatch({ endpoint, payload, fetchImpl = fetch }) {
  const response = await fetchImpl(endpoint, {
    method: 'POST',
    headers: HEADERS,
    body: JSON.stringify(payload),
    signal: AbortSignal.timeout(30_000),
  });
  // Read the body on both paths. A 2xx body says "key validation pending",
  // which is the normal first answer, and is worth seeing too.
  const body = (await response.text()).trim();
  return { status: response.status, ok: response.ok, body };
}

/** Trim a response body down to something that belongs in a build log. */
export function summarize(body, limit = 200) {
  if (!body) return '(empty body)';
  return body.length > limit ? `${body.slice(0, limit)}...` : body;
}

/**
 * Notify every endpoint, in batches, and report each one separately.
 *
 * Returns a per-endpoint summary so a caller or a test can assert on it. Never
 * throws: a refused ping is advisory.
 */
export async function ping({
  urls,
  site = SITE,
  key = KEY,
  endpoints = ENDPOINTS,
  batchSize = BATCH,
  fetchImpl = fetch,
  log = console.log,
} = {}) {
  const results = [];

  for (const endpoint of endpoints) {
    const host = new URL(endpoint).host;
    let accepted = 0;
    let refused = 0;
    let lastRefusal = null;

    for (let offset = 0; offset < urls.length; offset += batchSize) {
      const urlList = urls.slice(offset, offset + batchSize);
      let attempt;
      try {
        attempt = await submitBatch({ endpoint, payload: batchPayload({ site, key, urlList }), fetchImpl });
      } catch (error) {
        // A network fault is this script's problem, not the engine's, and it
        // must not read like a rejection.
        log(`indexnow: ${host} unreachable (${error.message})`);
        refused += urlList.length;
        lastRefusal = { status: 'network', body: error.message };
        break;
      }
      if (attempt.ok) {
        accepted += urlList.length;
        // 202 means received with key validation still pending, which is the
        // expected first answer. Say so, so it is not read as full success.
        const pending = attempt.status === 202 ? ' (key validation pending)' : '';
        log(`indexnow: ${host} accepted ${urlList.length} URLs -> ${attempt.status}${pending}`);
      } else {
        refused += urlList.length;
        lastRefusal = { status: attempt.status, body: attempt.body };
        log(`indexnow: ${host} REFUSED ${urlList.length} URLs -> ${attempt.status} ${summarize(attempt.body)}`);
      }
    }

    results.push({ endpoint: host, accepted, refused, lastRefusal });
  }

  const refusedSomewhere = results.some((r) => r.refused > 0);
  if (refusedSomewhere) {
    const detail = results
      .filter((r) => r.refused > 0)
      .map((r) => `${r.endpoint} ${r.lastRefusal.status} ${summarize(r.lastRefusal.body, 120)}`)
      .join(' | ');
    log(`indexnow: refused by ${detail}`);
    log(
      'indexnow: a 403 "UserForbiddedToAccessSite" means the engine has no domain/key binding yet. ' +
        'The key file is correct; verify the domain in Bing Webmaster Tools to register it.',
    );
  }
  return results;
}

async function run() {
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
      return;
    }

    // Separate our fault from the engine's before pinging at all.
    await checkKeyFile();

    await ping({ urls });
  } catch (error) {
    console.log(`indexnow: skipped (${error.message}); deploy is unaffected`);
  }
}

if (import.meta.main) await run();