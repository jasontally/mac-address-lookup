import { strict as assert } from 'node:assert';
import test from 'node:test';
import { sitemapUrlSelection } from '../build/generate-pages.mjs';

const core = ['https://example.test/', 'https://example.test/help'];
const lang = ['https://example.test/lang/es/'];
const hubs = ['https://example.test/vendor/intel', 'https://example.test/former/apple-computer'];
const countries = ['https://example.test/country/us', 'https://example.test/country/hk'];
const rollups = ['https://example.test/country', 'https://example.test/vendor'];
const prefixes = ['https://example.test/001A2B', 'https://example.test/8C1F64AFA'];

const select = (scope) =>
  sitemapUrlSelection({
    scope,
    coreUrls: core,
    langUrls: lang,
    rollupUrls: rollups,
    hubUrls: hubs,
    countryUrls: countries,
    prefixUrls: prefixes,
  });

test('sitemap scopes compose cumulatively: core ⊂ country ⊂ hubs ⊂ all', () => {
  assert.deepEqual(select('core'), [...core, ...lang]);
  assert.deepEqual(select('country'), [...core, ...lang, ...rollups, ...countries]);
  assert.deepEqual(select('hubs'), [...core, ...lang, ...rollups, ...hubs, ...countries]);
  assert.deepEqual(select('all'), [...core, ...lang, ...rollups, ...hubs, ...countries, ...prefixes]);
});

test('the country scope carries both rollup indexes and country hubs only', () => {
  const urls = select('country');
  assert.deepEqual(
    urls.filter((url) => url.endsWith('/vendor') || url.endsWith('/country')),
    rollups,
    'the /country and /vendor rollups lead the set',
  );
  assert.ok(urls.some((url) => url.includes('/country/')));
  assert.ok(
    !urls.some((url) => url.includes('/vendor/') || url.includes('/former/')),
    'no vendor/former detail rows yet - those join the hubs scope',
  );
  assert.ok(!urls.some((url) => /\/[0-9A-F]{6,12}$/.test(url)), 'no prefix pages');
});

test('unknown scopes throw instead of silently shipping an empty sitemap', () => {
  assert.throws(() => sitemapUrlSelection({ scope: 'everything' }), /Unknown sitemap scope/);
});

test('empty inputs stay valid for every scope', () => {
  assert.deepEqual(sitemapUrlSelection({ scope: 'all' }), []);
  assert.deepEqual(sitemapUrlSelection({ scope: 'core', coreUrls: core }), core);
  assert.deepEqual(sitemapUrlSelection({ scope: 'country', coreUrls: core }), core);
  assert.deepEqual(sitemapUrlSelection({ scope: 'hubs', coreUrls: core }), core);
});
