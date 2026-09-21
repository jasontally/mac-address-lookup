import { strict as assert } from 'node:assert';
import test from 'node:test';
import {
  createPageTracker,
  distPathToUrl,
  finalizePageHashes,
  sha1Hex,
  urlToDistPath,
} from '../build/page-hashes.mjs';
import { renderUrlSet, writeSitemaps } from '../build/generate-sitemaps.mjs';
import { mkdirSync, rmSync } from 'node:fs';
import path from 'node:path';

test('distPathToUrl maps every deployed layout to its canonical URL', () => {
  assert.equal(distPathToUrl('index.html'), '/');
  assert.equal(distPathToUrl('help.html'), '/help');
  assert.equal(distPathToUrl('recent.html'), '/recent');
  assert.equal(distPathToUrl('vendor/apple-inc.html'), '/vendor/apple-inc');
  assert.equal(distPathToUrl('country/us.html'), '/country/us');
  assert.equal(distPathToUrl('lang/ja/index.html'), '/lang/ja/');
  assert.equal(distPathToUrl('data/page-hashes.json'), null);
  assert.equal(distPathToUrl('lang/index.html'), null);
});

test('urlToDistPath is the inverse of distPathToUrl', () => {
  for (const url of ['/', '/help', '/recent', '/lang/ja/', '/vendor/apple-inc', '/001B21', '/country/us']) {
    assert.equal(distPathToUrl(urlToDistPath(url)), url);
  }
});

test('tracker keeps the prior lastmod for unchanged pages and re-dates changed or new ones', () => {
  const previous = {
    schemaVersion: 1,
    refreshDate: '2026-09-01',
    pages: {
      'https://example.test/same': { h: sha1Hex('<html>same</html>'), m: '2026-08-15' },
      'https://example.test/changed': { h: 'oldhash', m: '2026-08-15' },
    },
  };
  const tracker = createPageTracker({ previous, refreshDate: '2026-09-22' });
  tracker.record('https://example.test/same', '<html>same</html>');
  tracker.record('https://example.test/changed', '<html>different</html>');
  tracker.record('https://example.test/new', '<html>new</html>');

  assert.equal(tracker.lastmodFor('https://example.test/same'), '2026-08-15');
  assert.equal(tracker.lastmodFor('https://example.test/changed'), '2026-09-22');
  assert.equal(tracker.lastmodFor('https://example.test/different'), '2026-09-22');
  assert.equal(tracker.lastmodFor('https://example.test/new'), '2026-09-22');
  assert.equal(tracker.lastmodFor('https://example.test/changed2'), '2026-09-22');
});

test('finalizePageHashes writes sorted deterministic JSON and drops pages that are gone', async () => {
  const previous = {
    schemaVersion: 1,
    refreshDate: '2026-09-01',
    pages: {
      'https://example.test/gone': { h: 'x', m: '2026-09-01' },
      'https://example.test/stays': { h: sha1Hex('stays'), m: '2026-09-01' },
    },
  };
  const tracker = createPageTracker({ previous, refreshDate: '2026-09-22' });
  tracker.record('https://example.test/z-prefix', 'z');
  tracker.record('https://example.test/stays', 'stays');

  const outDir = path.join('.tmp-page-hashes-test');
  mkdirSync(path.join(outDir, 'data'), { recursive: true });
  const { urls } = await finalizePageHashes({
    tracker,
    previous,
    refreshDate: '2026-09-22',
    outDir,
  });
  const manifest = JSON.parse(await (await import('node:fs/promises')).readFile(path.join(outDir, 'data/page-hashes.json'), 'utf8'));
  assert.equal(urls, 2);
  assert.equal(manifest.pages['https://example.test/gone'], undefined);
  assert.equal(manifest.pages['https://example.test/stays'].m, '2026-09-01');
  assert.equal(manifest.pages['https://example.test/z-prefix'].m, '2026-09-22');
  rmSync(outDir, { recursive: true, force: true });
});

test('renderUrlSet prefers each entry lastmod over the global fallback', () => {
  const xml = renderUrlSet(
    [
      'https://example.test/',
      { loc: 'https://example.test/recent', lastmod: '2026-09-18' },
      { loc: 'https://example.test/home', alternates: [['en', 'https://example.test/']] },
    ],
    { lastmod: '2026-08-01' },
  );
  assert.match(xml, /<loc>https:\/\/example\.test\/<\/loc>\n    <lastmod>2026-08-01<\/lastmod>/);
  assert.match(xml, /<loc>https:\/\/example\.test\/recent<\/loc>\n    <lastmod>2026-09-18<\/lastmod>/);
  assert.match(xml, /<loc>https:\/\/example\.test\/home<\/loc>\n    <lastmod>2026-08-01<\/lastmod>/);
  assert.doesNotMatch(xml, /<lastmod>—</);
});

test('writeSitemaps resolves per-URL lastmod through lastmodFor tracker resolution', async () => {
  const outDir = path.join('.tmp-sitemaps');
  mkdirSync(outDir, { recursive: true });
  await writeSitemaps({
    urls: ['https://example.test/', 'https://example.test/recent'],
    site: 'https://example.test',
    outDir,
    lastmod: '2026-08-01',
    lastmodFor: (url) => (url.endsWith('/recent') ? '2026-09-18' : undefined),
  });
  const xml = await import('node:fs/promises').then((m) =>
    m.readFile(path.join(outDir, 'sitemap.xml'), 'utf8'),
  );
  assert.match(xml, /<loc>https:\/\/example\.test\/<\/loc>\n    <lastmod>2026-08-01<\/lastmod>/);
  assert.match(xml, /<loc>https:\/\/example\.test\/recent<\/loc>\n    <lastmod>2026-09-18<\/lastmod>/);
  rmSync(outDir, { recursive: true, force: true });
});
