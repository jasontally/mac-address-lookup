/** Fetch with retries and a per-attempt timeout, for flaky build environments. */

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

function isRetryableStatus(status) {
  return status === 408 || status === 429 || status >= 500;
}

/**
 * Fetch a URL, retrying transient network failures and server errors.
 * Client errors (except 408/429) fail immediately.
 *
 * If all upstream attempts fail and a `fallback` function is provided, it runs
 * once as a last resort; its result is returned as a synthetic 200 response
 * ({ text, json }) so callers can treat it uniformly. Without a fallback, or if
 * the fallback itself fails, the error from the upstream attempts is thrown.
 */
export async function fetchWithRetry(
  url,
  { fetchImpl = fetch, attempts = 3, timeoutMs = 30_000, baseDelayMs = 2_000, headers = {} } = {},
  { fallback = null, label = null } = {},
) {
  let lastError = null;
  for (let attempt = 1; attempt <= attempts; attempt++) {
    let response;
    try {
      response = await fetchImpl(url, {
        headers,
        signal: AbortSignal.timeout(timeoutMs),
      });
    } catch (error) {
      lastError =
        error?.name === 'AbortError' || error?.name === 'TimeoutError'
          ? new Error(`timed out after ${timeoutMs}ms`)
          : error;
      if (attempt < attempts) await sleep(baseDelayMs * attempt);
      continue;
    }

    if (response.ok) return response;

    lastError = new Error(`HTTP ${response.status} ${response.statusText}`);
    if (!isRetryableStatus(response.status)) {
      throw new Error(`Failed to fetch ${url}: ${lastError.message}`);
    }
    if (attempt < attempts) await sleep(baseDelayMs * attempt);
  }

  return fallbackResponse({ url, fallback, label, lastError, attempts });
}

async function fallbackResponse({ url, fallback, label, lastError, attempts }) {
  const detail = (lastError?.message ?? String(lastError)).trim();
  const cause = `Failed to fetch ${url} after ${attempts} attempts: ${detail}`;
  if (fallback) {
    try {
      const text = await fallback();
      if (label) console.warn(`warning: ${label} upstream failed; using the live cache copy`);
      return {
        ok: true,
        status: 200,
        statusText: 'OK (fallback)',
        text: async () => text,
        json: async () => JSON.parse(text),
      };
    } catch (fallbackError) {
      throw new Error(`${cause} (and the fallback also failed)`, { cause: fallbackError });
    }
  }
  throw new Error(cause, { cause: lastError });
}
