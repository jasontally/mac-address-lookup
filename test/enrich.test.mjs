import { strict as assert } from 'node:assert';
import test from 'node:test';
import { buildEnrichment } from '../build/enrich.mjs';
import { renderPrefixPage } from '../build/page-template.mjs';

const record = (extras = {}) => ({
  prefix: '001B21',
  prefixLen: 24,
  blockType: 'MA-L',
  addressCount: 16_777_216,
  orgName: 'Intel Corporate',
  country: 'MY',
  isPrivate: false,
  firstSeen: '2003-09-08',
  vendorBlocks: 667,
  vendorAddresses: 11_145_382_912,
  ...extras,
});

test('multi-block org gets portfolio and cohort sentences, MA-L gets no size note', () => {
  const sentences = buildEnrichment(record(), { orgFirstSeen: '2003-09-08' });
  const keys = sentences.map((entry) => entry.key);
  assert.deepEqual(keys, ['enrich.portfolio', 'enrich.oldest']);
});

test('non-MA-L blocks add the block-size sentence, CID gets its own note', () => {
  const mam = buildEnrichment(record({ blockType: 'MA-M', vendorBlocks: 3, vendorAddresses: 50_000_000, firstSeen: '2015-01-01' }), { orgFirstSeen: '2003-09-08' });
  assert.ok(mam.some((entry) => entry.key === 'enrich.blockSize' && entry.params.type === 'MA-M'));

  const cid = buildEnrichment(record({ blockType: 'CID', vendorBlocks: 1, vendorAddresses: null }), {});
  assert.deepEqual(cid.map((entry) => entry.key), ['enrich.cid']);
});

test('single-block org and missing data omit instead of padding', () => {
  const solo = buildEnrichment(record({ vendorBlocks: 1, vendorAddresses: null, blockType: 'MA-L' }), {});
  assert.deepEqual(solo, []);

  const noDates = buildEnrichment(record({ firstSeen: null }), { orgFirstSeen: null });
  assert.ok(!noDates.some((entry) => entry.key === 'enrich.oldest'));
});

test('at most three sentences', () => {
  const many = buildEnrichment(
    record({ blockType: 'IAB', firstSeen: '2003-09-08' }),
    { orgFirstSeen: '2003-09-08' },
  );
  assert.ok(many.length <= 3);
});

test('prefix template renders enrichment with static English and raw params', () => {
  const html = renderPrefixPage({
    record: record(),
    enrich: buildEnrichment(record(), { orgFirstSeen: '2003-09-08' }),
    site: 'https://example.test',
  });
  assert.match(html, /One of Intel Corporate&#39;s 667 registered blocks/);
  assert.match(html, /span 11\.1 billion/);
  assert.match(html, /First observed 8 Sep 2003, among Intel Corporate&#39;s oldest registrations\./);
  assert.match(
    html,
    /data-enrich='\[{&quot;key&quot;:&quot;enrich\.portfolio&quot;/,
    'raw params carry in a JSON attribute for the client swap',
  );
});

test('no enrichment renders nothing', () => {
  const html = renderPrefixPage({ record: record(), site: 'https://example.test' });
  assert.ok(!html.includes('data-enrich'));
});
