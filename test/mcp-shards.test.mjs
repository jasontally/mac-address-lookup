import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readdir, readFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import {
  MCP_ROUTE,
  MCP_SHARD_PATH,
  mcpRuleExpression,
  SHARD_BASE_DEPTH,
  SHARD_HARD_MAX_BYTES,
  SHARD_MIN_PREFIX_LENGTH,
  SHARD_MAX_DEPTH,
  SHARD_TARGET_BYTES,
  SHARD_MAX_OVERSIZE,
  planShards,
  shardStats,
  methodCatalog,
  renderSnippet,
  writeMcpShards,
} from '../build/mcp-shards.mjs';

/**
 * A small stand-in for the real registry. It reproduces the two shapes that
 * broke earlier designs: a dense cluster under one 6-hex block (so a 3-hex
 * bucket blows the cap and must be carved), and MA-M blocks sitting inside an
 * MA-L block.
 */
function makeRecords() {
  const records = [];
  for (let i = 0; i < 400; i += 1) {
    records.push({
      prefix: `0050C2${i.toString(16).padStart(3, '0').toUpperCase()}`,
      prefixLen: 36,
      blockType: 'IAB',
      addressCount: 4096,
      orgName: `IAB Holder ${i}`,
      orgAddress: 'somewhere US',
      country: 'US',
      isPrivate: false,
    });
  }
  records.push({
    prefix: '0050C2',
    prefixLen: 24,
    blockType: 'MA-L',
    addressCount: 16777216,
    orgName: 'IEEE Registration Authority',
    orgAddress: 'Piscataway NJ US',
    country: 'US',
    isPrivate: false,
  });
  records.push({
    prefix: '8C1F64',
    prefixLen: 24,
    blockType: 'MA-L',
    addressCount: 16777216,
    orgName: 'DATA ELECTRONIC DEVICES, INC',
    orgAddress: 'Salem NH US',
    country: 'US',
    isPrivate: false,
  });
  records.push({
    prefix: '8C1F64A',
    prefixLen: 28,
    blockType: 'MA-M',
    addressCount: 1048576,
    orgName: 'Child Of Eight C One F Sixty Four',
    orgAddress: 'Salem NH US',
    country: 'US',
    isPrivate: false,
  });
  records.push({
    prefix: '8C1F64AFA',
    prefixLen: 36,
    blockType: 'MA-S',
    addressCount: 4096,
    orgName: 'DATA ELECTRONIC DEVICES, INC',
    orgAddress: 'Salem NH US',
    country: 'US',
    isPrivate: false,
  });
  records.push({
    prefix: 'ACDE48',
    prefixLen: 24,
    blockType: 'MA-L',
    addressCount: 16777216,
    orgName: 'Private',
    orgAddress: null,
    country: null,
    isPrivate: true,
  });
  // An org name containing the field separator must survive the round trip.
  records.push({
    prefix: 'BCAD28',
    prefixLen: 24,
    blockType: 'MA-L',
    addressCount: 16777216,
    orgName: 'A | B Telecom',
    orgAddress: 'Hangzhou CN',
    country: 'CN',
    isPrivate: false,
  });
  return records;
}

const records = makeRecords();

/** Resolve a MAC the way the generated snippet does: one fetch, depth table. */
function route(hex, files, table = {}) {
  const depth = table[hex.slice(0, SHARD_BASE_DEPTH)] || SHARD_BASE_DEPTH;
  const keys = [hex.slice(0, depth).toLowerCase()];
  const bodies = keys.map((key) => files.get(key));
  let best = null;
  let bestPrefix = '';
  for (const text of bodies) {
    if (!text) continue;
    for (const line of text.split('\n')) {
      const stop = line.indexOf('|');
      if (stop === -1) continue;
      const prefix = line.slice(0, stop);
      if (prefix.length <= bestPrefix.length || !hex.startsWith(prefix)) continue;
      bestPrefix = prefix;
      best = line;
    }
  }
  return { keys, match: best, prefix: best === null ? null : bestPrefix };
}

/** Independent brute-force oracle over every registered prefix. */
function bruteForce(hex, all) {
  let best = null;
  for (const record of all) {
    if (record.prefix.length > (best?.length ?? 0) && hex.startsWith(record.prefix)) best = record.prefix;
  }
  return best;
}

async function writeFixture(input = records) {
  const dist = await mkdtemp(path.join(os.tmpdir(), 'mcp-shards-'));
  const stats = await writeMcpShards({ distDir: dist, records: input });
  const dir = path.join(dist, MCP_SHARD_PATH.replace(/^\//, ''));
  const files = new Map();
  for (const name of await readdir(dir)) {
    files.set(name.replace(/\.(txt|json)$/, ''), await readFile(path.join(dir, name), 'utf8'));
  }
  return { dist, dir, files, table: stats.table, stats };
}

test('every lookup matches a brute-force oracle', async () => {
  const { files, table } = await writeFixture();
  const queries = [
    '8C1F64AFA4B2', '8C1F64AF', '8C1F64A', '8C1F64', '0050C2000', '0050C2',
    '0050C2FFF', 'ACDE48', 'ACDE48001122', 'BCAD28', 'BCAD28001122', 'FFFFFF', 'FFFFFF123456',
  ];
  for (const record of records) {
    queries.push(record.prefix.padEnd(12, '0'));
    queries.push(record.prefix + 'A'.repeat(12 - record.prefix.length));
  }
  for (const raw of queries) {
    const hex = raw.replace(/[\s:.-]/g, '').toUpperCase();
    const got = route(hex, files, table).prefix;
    const want = bruteForce(hex, records);
    assert.equal(got, want, `${raw}: got ${got}, want ${want}`);
  }
});

test('separators, case, and dotted form all normalize to the same answer', async () => {
  const { files, table } = await writeFixture();
  const forms = ['8C:1F:64:AF:A4:B2', '8c-1f-64-af-a4-b2', '8c1f.64af.a4b2', '8C1F64AFA4B2', ' 8c1f64afa4b2 '];
  const seen = forms.map((form) => route(form.replace(/[\s:.-]/g, '').toUpperCase(), files, table).prefix);
  for (const value of seen) assert.equal(value, '8C1F64AFA');
});

test('a full address inside an MA-S block does not fall back to its MA-L parent', async () => {
  const { files, table } = await writeFixture();
  assert.equal(route('8C1F64AFA4B2', files, table).prefix, '8C1F64AFA');
  // A 6-hex query is too short to match the 9-hex block, so the parent wins.
  assert.equal(route('8C1F64', files, table).prefix, '8C1F64');
});

test('an MA-M block shares its shard with the parent MA-L block', async () => {
  const { files, table } = await writeFixture();
  const body = files.get('8c1f');
  // At depth 4 every record under 8C1F lands in one file: the MA-L block, the
  // MA-M block inside it, and the MA-S block inside that.
  assert.ok(body.includes('8C1F64|MA-L|'), 'MA-L in the depth-4 file');
  assert.ok(body.includes('8C1F64A|MA-M|'), 'MA-M in the same depth-4 file');
  assert.ok(body.includes('8C1F64AFA|MA-S|'), 'MA-S in the same depth-4 file');
  assert.equal(route('8C1F64A1B2C3D', files, table).prefix, '8C1F64A');
});

test('a 7-hex record with no registered MA-L parent still gets a fetchable file', async () => {
  const orphan = [
    { prefix: 'DEADBE', prefixLen: 28, blockType: 'MA-M', addressCount: 1048576, orgName: 'Orphan MA-M', orgAddress: null, country: null, isPrivate: false },
  ];
  const plan = planShards(orphan);
  const files = new Map(plan.shards.map((shard) => [shard.key, shard.text]));
  assert.ok(files.has('dead'), 'expected a file keyed by the depth-4 bucket');
  assert.equal(route('DEADBEEF1234', files, plan.table).prefix, 'DEADBE');
});

test('a record with no country uses the placeholder, not an empty field', async () => {
  const { files, table } = await writeFixture();
  assert.equal(files.get('acde').split('\n')[0], 'ACDE48|MA-L|16777216|-|Private');
});

test('an org name containing the separator round-trips', async () => {
  const { files, table } = await writeFixture();
  const match = route('BCAD28001122', files, table);
  assert.equal(match.prefix, 'BCAD28');
  const fields = [];
  let rest = match.match;
  for (let i = 0; i < 4; i += 1) {
    const at = rest.indexOf('|');
    fields.push(rest.slice(0, at));
    rest = rest.slice(at + 1);
  }
  fields.push(rest);
  assert.deepEqual(fields, ['BCAD28', 'MA-L', '16777216', 'CN', 'A | B Telecom']);
});

test('an unregistered address resolves to no match rather than a guess', async () => {
  const { files, table } = await writeFixture();
  for (const hex of ['FFFFFF123456', 'ABCDEF', '123456', 'FFFFFFFFFFFF']) {
    assert.equal(route(hex, files, table).prefix, bruteForce(hex, records));
    assert.equal(route(hex, files, table).prefix, null);
  }
});

test('every lookup costs exactly one shard fetch', async () => {
  const { files, table } = await writeFixture();
  for (const q of ['8C1F64', '8C1F64A', '8C1F64AFA', '8C1F64AFA4B2', '0050C2000001', 'ACDE48']) {
    assert.equal(route(q, files, table).keys.length, 1, `${q} should need one file`);
  }
});

test('no routed depth exceeds the shortest registered prefix', () => {
  const { table } = planShards(records);
  for (const [key, depth] of Object.entries(table)) {
    assert.ok(key.length === SHARD_BASE_DEPTH, `override key ${key} should be base depth`);
    assert.ok(
      depth <= SHARD_MIN_PREFIX_LENGTH,
      `depth ${depth} for ${key} exceeds the lossless ceiling ${SHARD_MIN_PREFIX_LENGTH}`,
    );
  }
  assert.equal(SHARD_MAX_DEPTH, SHARD_MIN_PREFIX_LENGTH);
});

test('planShards refuses a depth past the lossless ceiling', () => {
  assert.throws(() => planShards(records, { maxDepth: SHARD_MIN_PREFIX_LENGTH + 1 }), /lossless ceiling/);
});

test('shards stay under the hard ceiling and the file count under the asset limit', () => {
  const stats = shardStats(planShards(records));
  assert.ok(stats.maxBytes <= SHARD_HARD_MAX_BYTES, 'largest shard must clear the snippet memory budget');
  assert.ok(stats.files < 100_000);
  // The fixture's dense cluster is one file, well inside the allowed oversize count.
  assert.ok(stats.overTarget <= SHARD_MAX_OVERSIZE);
  assert.ok(stats.medianBytes < SHARD_TARGET_BYTES);
});

test('the tool catalog declares one lookup tool with an address argument', () => {
  const catalog = methodCatalog();
  assert.equal(catalog.tools.length, 1);
  const [tool] = catalog.tools;
  assert.equal(tool.name, 'lookup');
  assert.deepEqual(Object.keys(tool.inputSchema.properties), ['mac']);
  assert.deepEqual(tool.inputSchema.required, ['mac']);
  assert.equal(tool.annotations.readOnlyHint, true);
});

test('the rule expression scopes by host as well as path', () => {
  const expression = mcpRuleExpression();
  assert.equal(
    expression,
    '(http.host eq "mac.jasontally.com" and (http.request.uri.path eq "/mcp" or http.request.uri.path eq "/mcp/"))',
  );
  // A path-only expression is zone-wide and would fire on every subdomain.
  assert.ok(expression.includes('http.host eq'), 'host term must be present');
  assert.ok(expression.includes('http.request.uri.path eq'), 'path term must be present');
});

test('the rule expression accepts the trailing-slash path', () => {
  // Clients normalise the trailing slash inconsistently. When the rule matches
  // only '/mcp', a POST to '/mcp/' skips the snippet and lands on the
  // assets-only Worker, which serves GET and HEAD only and answers 405 with an
  // empty body. That is what Glama's MCP Inspector Online hit.
  const expression = mcpRuleExpression();
  assert.ok(
    expression.includes('http.request.uri.path eq "/mcp"'),
    'the bare route must still match',
  );
  assert.ok(
    expression.includes('http.request.uri.path eq "/mcp/"'),
    'the trailing-slash route must also match, or the snippet never runs for those clients',
  );
});

test('the rule expression follows the site and route it is given', () => {
  assert.equal(
    mcpRuleExpression({ site: 'https://other.example', route: '/rpc' }),
    '(http.host eq "other.example" and (http.request.uri.path eq "/rpc" or http.request.uri.path eq "/rpc/"))',
  );
});

test('the snippet, the rule expression, and the host guard agree', async () => {
  const { dist } = await writeFixture();
  const source = await readFile(path.join(dist, 'mcp-snippet.js'), 'utf8');
  const expression = mcpRuleExpression();
  // The header tells the operator exactly what to paste...
  assert.ok(source.includes(expression), 'header must carry the exact rule expression');
  // ...the runtime constant agrees with it...
  assert.ok(source.includes('const HOST = "mac.jasontally.com";'), 'HOST constant must match');
  // ...and the guard is actually there.
  assert.match(source, /new URL\(request\.url\)\.host !== HOST/);
  assert.match(source, /served on ' \+ HOST \+ ' only/);
});

test('the generated snippet is an ES module that fits the snippet limit', async () => {
  const { dist } = await writeFixture();
  const source = await readFile(path.join(dist, 'mcp-snippet.js'), 'utf8');
  assert.ok(Buffer.byteLength(source) < 32 * 1024, 'snippet must fit the 32 KB package limit');
  assert.match(source, /export default \{/);
  assert.ok(source.includes(mcpRuleExpression()));
  // The method guard is what stops a same-zone subrequest re-entering the handler.
  assert.match(source, /request\.method !== 'POST'/);
  // A JSON-RPC notification carries no id and gets no body.
  assert.match(source, /Object\.hasOwn\(payload, 'id'\)/);
});

/**
 * The tool catalog must not sit behind the shard cache TTL.
 *
 * The shards are keyed by prefix, so a file name never changes when its content
 * does, and a 24-hour TTL is a fair trade for them. `catalog.json` is in the
 * same directory and is not that: it carries the tool description and the
 * advertised protocol versions, and it changes whenever the generator changes.
 *
 * A 24-hour TTL on it leaves each edge location serving the copy it cached, so
 * after a deploy one location can answer `server/discover` with the new
 * `supportedVersions` and another with none at all. The endpoint then passes in
 * one test and fails in another, with no server-side error to explain it.
 *
 * Note also that Cloudflare joins two values when two matching rules set the
 * same header, so adding a narrower rule for the catalog alongside the wildcard
 * would produce `no-store, public, max-age=86400` and keep the TTL. The wildcard
 * has to stop matching the catalog instead.
 */
test('the shard cache TTL does not cover the tool catalog', async () => {
  const headers = await readFile(path.join(import.meta.dirname, '..', 'public', '_headers'), 'utf8');
  const blocks = headers
    .split(/\n(?=\S)/)
    .map((block) => block.split('\n').filter((line) => !line.trimStart().startsWith('#')))
    .filter((lines) => lines.length > 1)
    .map((lines) => ({
      pattern: lines[0].trim(),
      cacheControl: lines.slice(1).find((line) => /^cache-control:/i.test(line.trim())) || '',
    }));

  const matches = (pattern, url) =>
    pattern.includes('*')
      ? new RegExp('^' + pattern.replace(/[.]/g, '\\.').replace(/\*/g, '[^/]*') + '$').test(url)
      : pattern === url;

  const cached = blocks.filter((block) => /max-age=(\d{4,})/.test(block.cacheControl));
  const catalog = '/data/mcp/catalog.json';
  const covering = cached.filter((block) => matches(block.pattern, catalog));

  assert.deepEqual(
    covering.map((block) => block.pattern),
    [],
    `${catalog} must not match a long-TTL rule; the edge would serve a stale catalog after a deploy`,
  );

  // The shards must keep their TTL. Without this the rule above could be
  // deleted and the test would still pass.
  const shard = '/data/mcp/8c1f64.txt';
  assert.ok(
    cached.some((block) => matches(block.pattern, shard)),
    'the .txt shards are still cached; they are the reason this rule exists',
  );
});

test('the generated snippet has no null-length crash in the match loop', async () => {
  const { dist } = await writeFixture();
  const source = await readFile(path.join(dist, 'mcp-snippet.js'), 'utf8');
  // longestMatch seeds its accumulator with a string, not null.
  assert.match(source, /let bestPrefix = '';/);
  assert.doesNotMatch(source, /bestPrefix\.length[^;]*null/);
});

/**
 * Run the generated snippet against the fixture shards.
 *
 * `fetch` is replaced with a stub that serves `/data/mcp/*` from disk and 404s
 * everything else, which is what the real zone would do. That makes a
 * wrong-host fetch observable instead of silently turning into "no vendor".
 * Returns a `call(host, body)` helper, a log of every fetch the snippet made,
 * and a `restore` the caller must run.
 */
async function runSnippet(dist) {
  const mod = await import(`file://${path.join(dist, 'mcp-snippet.js')}`);
  const shardDir = path.join(dist, 'data', 'mcp');
  const real = globalThis.fetch;
  const fetched = [];
  globalThis.fetch = async (input, init) => {
    const url = new URL(typeof input === 'string' ? input : input.url);
    fetched.push({ host: url.host, path: url.pathname });
    if (url.pathname.startsWith('/data/mcp/')) {
      try {
        return new Response(await readFile(path.join(shardDir, path.basename(url.pathname)), 'utf8'), {
          status: 200,
        });
      } catch {
        return new Response('not found', { status: 404 });
      }
    }
    return new Response('not found', { status: 404 });
  };
  return {
    fetched,
    call: (host, body) =>
      mod.default.fetch(
        new Request(`https://${host}/mcp`, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify(body),
        }),
      ),
    restore: () => {
      globalThis.fetch = real;
    },
  };
}

const LOOKUP = {
  jsonrpc: '2.0',
  id: 1,
  method: 'tools/call',
  params: { name: 'lookup', arguments: { mac: '8C:1F:64:AF:A4:B2' } },
};

test('the host guard refuses a lookup on any other hostname', async () => {
  const { dist } = await writeFixture();
  const snippet = await runSnippet(dist);
  try {
    for (const host of ['www.jasontally.com', 'mcp.jasontally.com', 'jasontally.com']) {
      const wrong = await snippet.call(host, LOOKUP);
      assert.equal(wrong.status, 404, `${host} must be refused`);
      assert.match(await wrong.clone().text(), /served on mac\.jasontally\.com only/);
    }
    // Refused before any shard fetch, so a wrong-host 404 can never turn into a
    // "no vendor" answer.
    assert.deepEqual(snippet.fetched, [], 'a wrong host must not trigger a shard fetch');

    const ok = await snippet.call('mac.jasontally.com', LOOKUP);
    assert.equal(ok.status, 200);
    const body = await ok.json();
    assert.equal(body.id, 1);
    assert.equal(body.result.structuredContent.prefix, '8C1F64AFA');
    assert.equal(body.result.structuredContent.url, 'https://mac.jasontally.com/8C1F64AFA');
    // One fetch, and it stays on the request host.
    assert.equal(snippet.fetched.length, 1);
    assert.equal(snippet.fetched[0].path, '/data/mcp/8c1f.txt');
  } finally {
    snippet.restore();
  }
});

test('the shard fetch resolves against the live request host', async () => {
  const { dist } = await writeFixture();
  const snippet = await runSnippet(dist);
  try {
    await snippet.call('mac.jasontally.com', {
      ...LOOKUP,
      params: { name: 'lookup', arguments: { mac: 'AC:DE:48:00:11:22' } },
    });
  } finally {
    snippet.restore();
  }
  assert.deepEqual(snippet.fetched, [{ host: 'mac.jasontally.com', path: '/data/mcp/acde.txt' }]);
});

test('a notification still gets 202 on the right host', async () => {
  const { dist } = await writeFixture();
  const snippet = await runSnippet(dist);
  try {
    const res = await snippet.call('mac.jasontally.com', {
      jsonrpc: '2.0',
      method: 'tools/call',
      params: { name: 'lookup', arguments: { mac: '8C:1F:64:AF:A4:B2' } },
    });
    assert.equal(res.status, 202);
    assert.equal(res.body, null);
  } finally {
    snippet.restore();
  }
});
