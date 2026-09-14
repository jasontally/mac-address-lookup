import { strict as assert } from 'node:assert';
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { fetchWithRetry } from '../build/fetch-with-retry.mjs';
import { fetchRegistries } from '../build/fetch-registries.mjs';
import { fetchLiveSource } from '../build/live-source.mjs';

const response = (status, body = 'ok') => ({
  ok: status >= 200 && status < 300,
  status,
  statusText: '',
  text: async () => body,
});

const jsonResponse = (body) => ({
  ok: true,
  status: 200,
  statusText: '',
  json: async () => body,
  text: async () => JSON.stringify(body),
});

test('fetchWithRetry succeeds after transient failures', async () => {
  let calls = 0;
  const fetchImpl = async () => {
    calls += 1;
    if (calls < 3) throw new Error('connect timeout');
    return response(200, 'data');
  };
  const result = await fetchWithRetry('https://example.test/x', {
    fetchImpl,
    attempts: 4,
    baseDelayMs: 1,
  });
  assert.equal(await result.text(), 'data');
  assert.equal(calls, 3);
});

test('fetchWithRetry retries server errors and gives up after the attempts', async () => {
  let calls = 0;
  const fetchImpl = async () => {
    calls += 1;
    return response(503);
  };
  await assert.rejects(
    () => fetchWithRetry('https://example.test/x', { fetchImpl, attempts: 3, baseDelayMs: 1 }),
    /after 3 attempts: HTTP 503/,
  );
  assert.equal(calls, 3);
});

test('fetchWithRetry fails fast on client errors', async () => {
  let calls = 0;
  const fetchImpl = async () => {
    calls += 1;
    return response(404);
  };
  await assert.rejects(
    () => fetchWithRetry('https://example.test/x', { fetchImpl, attempts: 3, baseDelayMs: 1 }),
    /HTTP 404/,
  );
  assert.equal(calls, 1);
});

test('fetchRegistries falls back to the live raw cache when upstream fails', async () => {
  const cacheDir = await mkdtemp(path.join(tmpdir(), 'registry-fallback-'));
  const calls = [];
  const index = {
    files: ['oui.csv', 'mam.csv', 'oui36.csv', 'iab.csv', 'cid.csv'].map((file) => ({
      file,
      path: `data/sources/${file.replace('.csv', '')}.abc123.csv`,
      sha256: 'x',
      bytes: 1,
    })),
  };
  const fetchImpl = async (url) => {
    calls.push(url);
    if (url.startsWith('https://standards-oui.ieee.org')) throw new Error('blocked');
    if (url.endsWith('/data/sources-index.json')) return jsonResponse(index);
    if (url.includes('/data/sources/')) {
      return response(200, 'Registry,Assignment,Organization Name,Organization Address\nMA-L,001A2B,Vendor,X');
    }
    throw new Error(`unexpected ${url}`);
  };

  const results = await fetchRegistries({
    cacheDir,
    force: true,
    fetchImpl,
    fallbackBaseUrl: 'https://live.test',
    attempts: 2,
    baseDelayMs: 1,
    timeoutMs: 5_000,
  });

  assert.equal(results.length, 5);
  assert.ok(results.every((result) => result.fromFallback));
  assert.ok(calls.some((url) => url.endsWith('/data/sources-index.json')));
  assert.ok(calls.some((url) => url.includes('/data/sources/oui.abc123.csv')));
});

test('fetchLiveSource resolves hashed paths through the live index', async () => {
  const index = {
    files: [{ file: 'oui.csv', path: 'data/sources/oui.abc123.csv', sha256: 'x', bytes: 1 }],
  };
  const fetchImpl = async (url) => {
    if (url.endsWith('/data/sources-index.json')) return jsonResponse(index);
    if (url.endsWith('/data/sources/oui.abc123.csv')) return response(200, 'csv-data');
    throw new Error(`unexpected ${url}`);
  };

  const text = await fetchLiveSource('oui.csv', { fetchImpl, baseUrl: 'https://live.test' });
  assert.equal(text, 'csv-data');
  await assert.rejects(
    () => fetchLiveSource('missing.csv', { fetchImpl, baseUrl: 'https://live.test' }),
    /no entry/,
  );
});
