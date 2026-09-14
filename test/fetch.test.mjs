import { strict as assert } from 'node:assert';
import test from 'node:test';
import { fetchWithRetry } from '../build/fetch-with-retry.mjs';

const response = (status, body = 'ok') => ({
  ok: status >= 200 && status < 300,
  status,
  statusText: '',
  text: async () => body,
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
