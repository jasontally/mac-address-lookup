/** Fetch with retries and a per-attempt timeout, for flaky build environments. */

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

function isRetryableStatus(status) {
  return status === 408 || status === 429 || status >= 500;
}

/**
 * Fetch a URL, retrying transient network failures and server errors.
 * Client errors (except 408/429) fail immediately.
 */
export async function fetchWithRetry(
  url,
  { fetchImpl = fetch, attempts = 3, timeoutMs = 30_000, baseDelayMs = 2_000, headers = {} } = {},
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

  throw new Error(
    `Failed to fetch ${url} after ${attempts} attempts: ${lastError?.message ?? lastError}`,
  );
}
