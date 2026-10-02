/** The raw source files the site deploys as a cache and diffs against. */

import { LINEAGE_SOURCE } from './fetch-lineage.mjs';
import { REGISTRIES } from './registries.mjs';

/** Canonical site used for fallback fetches and change detection. */
export const DEFAULT_SITE = 'https://mac.jasontally.com';

export const SOURCE_FILES = [
  ...REGISTRIES.map((registry) => ({
    file: registry.cacheFile,
    url: registry.url,
    name: registry.name,
  })),
  { file: 'macs.json', url: LINEAGE_SOURCE.url, name: LINEAGE_SOURCE.name },
];
