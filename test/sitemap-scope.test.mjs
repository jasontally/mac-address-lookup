import { strict as assert } from 'node:assert';
import test from 'node:test';
import { sitemapUrlSelection } from '../build/generate-pages.mjs';

const core = ['https://example.test/', 'https://example.test/help'];
const hubs = ['https://example.test/vendor/intel', 'https://example.test/country/us'];
const prefixes = ['https://example.test/001A2B', 'https://example.test/8C1F64AFA'];

test('sitemap scopes compose cumulatively: core ⊂ hubs ⊂ all', () => {
  assert.deepEqual(sitemapUrlSelection({ scope: 'core', coreUrls: core, hubUrls: hubs, prefixUrls: prefixes }), core);
  assert.deepEqual(
    sitemapUrlSelection({ scope: 'hubs', coreUrls: core, hubUrls: hubs, prefixUrls: prefixes }),
    [...core, ...hubs],
  );
  assert.deepEqual(
    sitemapUrlSelection({ scope: 'all', coreUrls: core, hubUrls: hubs, prefixUrls: prefixes }),
    [...core, ...hubs, ...prefixes],
  );
});

test('unknown scopes throw instead of silently shipping an empty sitemap', () => {
  assert.throws(() => sitemapUrlSelection({ scope: 'everything' }), /Unknown sitemap scope/);
});

test('empty inputs stay valid for every scope', () => {
  assert.deepEqual(sitemapUrlSelection({ scope: 'all' }), []);
  assert.deepEqual(sitemapUrlSelection({ scope: 'hubs', coreUrls: core }), core);
});
