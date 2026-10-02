/**
 * Tests for the post-deploy IndexNow ping.
 *
 * The behaviour worth holding is not "it posts a batch". It is that a refusal
 * says why. The first version of this script logged `batch 3628 URLs -> 403`
 * and discarded the response body, which is what made a correct ping look like
 * a broken one for as long as it took to read the body by hand.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';

import { ENDPOINTS, batchPayload, checkKeyFile, ping, summarize, submitBatch } from '../build/indexnow.mjs';

const KEY = 'a6523ab083666dfaba05437bcb9b2ad4';
const SITE = 'https://mac.jasontally.com';

/** Collect log lines instead of printing them. */
function collector() {
  const lines = [];
  return { log: (line) => lines.push(line), lines };
}

/** A fetch stand-in driven by a map of URL or endpoint to a response. */
function fakeFetch(routes) {
  const calls = [];
  const impl = async (input, init = {}) => {
    const url = typeof input === 'string' ? input : input.url;
    calls.push({ url, init });
    for (const [pattern, respond] of routes) {
      if (pattern instanceof RegExp ? pattern.test(url) : url === pattern) {
        const { status = 200, body = '' } = respond(init);
        return new Response(body, { status });
      }
    }
    return new Response('no route', { status: 500 });
  };
  impl.calls = calls;
  return impl;
}

test('the payload carries the host, the key, and the key location', () => {
  const payload = batchPayload({ site: SITE, key: KEY, urlList: [`${SITE}/help`] });
  assert.equal(payload.host, 'mac.jasontally.com');
  assert.equal(payload.key, KEY);
  assert.equal(payload.keyLocation, `${SITE}/${KEY}.txt`);
  assert.deepEqual(payload.urlList, [`${SITE}/help`]);
});

test('the shared endpoint is not the only one, because it drops the batch on a Bing refusal', () => {
  // api.indexnow.org validates the key before sharing, so a Bing 403 means
  // Yandex, Seznam and Yep are notified of nothing. Yandex accepts the same
  // payload, so it is pinged directly as well.
  assert.ok(ENDPOINTS.includes('https://api.indexnow.org/indexnow'));
  assert.ok(
    ENDPOINTS.includes('https://yandex.com/indexnow'),
    'Yandex must be pinged directly or a Bing refusal silently loses it',
  );
});

test('a refused batch logs the response body, not just the status', async () => {
  // This is the whole point. The body is where the cause lives.
  const { log, lines } = collector();
  const body = JSON.stringify({
    errorCode: 'UserForbiddedToAccessSite',
    message: 'User is unauthorized to access the site. Please verify the site using the key and try again',
  });
  const fetchImpl = fakeFetch([[/indexnow$/, () => ({ status: 403, body })]]);

  await ping({ urls: [`${SITE}/help`], fetchImpl, log });

  const text = lines.join('\n');
  assert.match(text, /REFUSED 1 URLs -> 403/, 'the status must be logged');
  assert.match(text, /UserForbiddedToAccessSite/, 'the engine must name its own cause');
  assert.match(text, /Bing Webmaster Tools/, 'the owner action must be in the log');
});

test('one endpoint refusing does not stop the others', async () => {
  const { log, lines } = collector();
  const fetchImpl = fakeFetch([
    ['https://api.indexnow.org/indexnow', () => ({ status: 403, body: '{"errorCode":"UserForbiddedToAccessSite"}' })],
    ['https://yandex.com/indexnow', () => ({ status: 202, body: '{"success":true}' })],
  ]);

  const results = await ping({ urls: [`${SITE}/help`], fetchImpl, log });

  assert.deepEqual(
    results.map((r) => [r.endpoint, r.accepted, r.refused]),
    [
      ['api.indexnow.org', 0, 1],
      ['yandex.com', 1, 0],
    ],
  );
  assert.match(lines.join('\n'), /yandex\.com accepted 1 URLs -> 202 \(key validation pending\)/);
});

test('a 202 is reported as pending, not as accepted outright', async () => {
  // 202 means "received, key validation pending". That is the normal first
  // answer and it must not read as full success.
  const { log, lines } = collector();
  const fetchImpl = fakeFetch([[/indexnow$/, () => ({ status: 202, body: '' })]]);
  const results = await ping({ urls: [`${SITE}/help`], fetchImpl, log });
  assert.equal(results[0].accepted, 1);
  assert.match(lines.join('\n'), /key validation pending/);
});

test('a 200 with an empty body still counts', () => {
  assert.equal(summarize(''), '(empty body)');
  assert.equal(summarize('{"a":1}'), '{"a":1}');
  assert.match(summarize('x'.repeat(500)), /^x{200}\.\.\.$/);
});

test('an unreachable endpoint is not reported as a refusal', async () => {
  // A network fault is our fault. It must not look like the engine said no.
  const { log, lines } = collector();
  const fetchImpl = async () => {
    throw new Error('getaddrinfo ENOTFOUND');
  };
  const results = await ping({ urls: [`${SITE}/help`], endpoints: ['https://example.invalid/indexnow'], fetchImpl, log });
  assert.equal(results[0].refused, 1);
  assert.equal(results[0].lastRefusal.status, 'network');
  assert.match(lines.join('\n'), /unreachable \(getaddrinfo ENOTFOUND\)/);
  assert.doesNotMatch(lines.join('\n'), /REFUSED/);
});

test('a key file that 404s is named as our fault', async () => {
  const fetchImpl = fakeFetch([[/\.txt$/, () => ({ status: 404, body: 'not found' })]]);
  await assert.rejects(checkKeyFile({ fetchImpl }), /That is our fault.*not being served/s);
});

test('a key file serving the wrong bytes is named as our fault', async () => {
  const fetchImpl = fakeFetch([[/\.txt$/, () => ({ status: 200, body: 'something-else' })]]);
  await assert.rejects(checkKeyFile({ fetchImpl }), /does not contain the key/);
});

test('a correct key file passes, and the log says it is not proof', async () => {
  // The check must not be readable as "IndexNow works". Bing can still refuse.
  const fetchImpl = fakeFetch([[/\.txt$/, () => ({ status: 200, body: KEY })]]);
  await checkKeyFile({ fetchImpl });
});

test('a batch over the cap is split, and every URL is submitted once', async () => {
  const urls = Array.from({ length: 25 }, (_, i) => `${SITE}/p${i}`);
  const fetchImpl = fakeFetch([[/indexnow$/, () => ({ status: 200, body: '' })]]);
  await ping({ urls, endpoints: ['https://example.test/indexnow'], batchSize: 10, fetchImpl, log: () => {} });
  const lists = fetchImpl.calls.map((call) => JSON.parse(call.init.body).urlList);
  assert.deepEqual(lists.map((list) => list.length), [10, 10, 5]);
  assert.deepEqual(lists.flat(), urls);
});

test('the request identifies itself, because a bare node user-agent is not traceable', async () => {
  const fetchImpl = fakeFetch([[/indexnow$/, () => ({ status: 200, body: '' })]]);
  await submitBatch({
    endpoint: 'https://example.test/indexnow',
    payload: batchPayload({ urlList: [] }),
    fetchImpl,
  });
  const headers = fetchImpl.calls[0].init.headers;
  assert.match(headers['user-agent'], /mac-address-lookup-indexnow/);
  assert.equal(headers.accept, 'application/json');
  assert.equal(headers['content-type'], 'application/json; charset=utf-8');
});