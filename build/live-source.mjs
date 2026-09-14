/** Resolve and fetch the raw source copies deployed with the live site. */

import { fetchWithRetry } from './fetch-with-retry.mjs';
import { DEFAULT_SITE } from './source-files.mjs';

export async function liveSourceIndex({ fetchImpl = fetch, baseUrl = DEFAULT_SITE } = {}) {
  const response = await fetchWithRetry(`${baseUrl}/data/sources-index.json`, {
    fetchImpl,
    attempts: 3,
    timeoutMs: 30_000,
  });
  return response.json();
}

/**
 * Fetch the deployed raw copy of a logical source file (for example `oui.csv`
 * or `macs.json`) through the live site's content-hashed path.
 */
export async function fetchLiveSource(
  file,
  { fetchImpl = fetch, baseUrl = DEFAULT_SITE, attempts = 3, timeoutMs = 60_000 } = {},
) {
  const index = await liveSourceIndex({ fetchImpl, baseUrl });
  const entry = (index.files ?? []).find((item) => item.file === file);
  if (!entry) throw new Error(`Live source index has no entry for ${file}`);
  const response = await fetchWithRetry(`${baseUrl}/${entry.path}`, {
    fetchImpl,
    attempts,
    timeoutMs,
  });
  return response.text();
}
