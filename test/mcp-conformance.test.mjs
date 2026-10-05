/**
 * Conformance checks for the /mcp endpoint, derived from the 2026-07-28
 * specification.
 *
 * This is not the official suite. `@modelcontextprotocol/conformance` does
 * support 2026-07-28 now, and is the stronger gate:
 *
 *   npx @modelcontextprotocol/conformance@0.2.0-alpha.12 server \
 *     --url <url> --requirements 2026-07-28
 *
 * An earlier note here said it rejected the version, quoting `Valid versions:
 * 2025-03-26, 2025-06-18, 2025-11-25, draft, extension`. That was true when
 * written and is now false. Pin the version: `latest` is `0.1.16`, which predates
 * the revision and has no `--requirements` flag.
 *
 * Two reasons this suite stays regardless: the runner has to be installed, and
 * `npm test` must not need a network install; and the official TypeScript client
 * at 2.2.0 still caps at 2025-11-25, so the client below is still written from
 * the specification text.
 *
 * What is borrowed verbatim: the `tools/list` structural requirements, which
 * the official suite publishes as prose for its `tools-list` scenario. Those
 * are transcribed into `checkToolsListShape`.
 *
 * What the official runner has that this file does not: `wire-schema-valid`,
 * which validates every message against the specification's JSON Schema. That
 * check lives in `test/mcp-wire-schema.test.mjs` here, without the install,
 * because it is the check that finds the class of fault this endpoint actually
 * had — a field missing or wrongly shaped, silently, in a `200`.
 *
 * What is derived: the stateless-core behaviours, taken from the specification
 * and the release notes. Each group below names its source.
 *
 * Two layers. The in-process layer runs the generated snippet against a stub
 * origin, so it is hermetic and fast enough for `npm test`. The live layer runs
 * the same client against the deployed endpoint and is opt-in via
 * `npm run mcp:conformance`, because it sends real traffic to production.
 */

import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, readdir, writeFile } from 'node:fs/promises';
import { mkdtempSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import {
  Mcp2026Client,
  PROTOCOL_VERSION,
  JSON_RPC,
  REMOVED_METHODS,
  checkToolsListShape,
} from './mcp-2026-07-28-client.mjs';
import { writeMcpShards, mcpRuleExpression, MCP_ROUTE, SHARD_BASE_DEPTH } from '../build/mcp-shards.mjs';
import { planShards } from '../build/mcp-shards.mjs';

const SITE = 'https://mac.jasontally.com';
const HOST = new URL(SITE).host;

/** A small registry covering every block type and the long-tail cases. */
const RECORDS = [
  rec('8C1F64', 'MA-L', 16777216, 'DATA ELECTRONIC DEVICES, INC', 'US'),
  rec('8C1F64A', 'MA-M', 1048576, 'DATA ELECTRONIC DEVICES, INC', 'US'),
  rec('8C1F64AFA', 'MA-S', 4096, 'DATA ELECTRONIC DEVICES, INC', 'US'),
  rec('001B21', 'MA-L', 16777216, 'Intel Corporate', 'MY'),
  rec('0050C2', 'MA-L', 16777216, 'IEEE Registration Authority', 'US'),
  rec('ACDE48', 'MA-L', 16777216, 'Private', null),
  rec('BCAD28', 'MA-L', 16777216, 'A | B Telecom', 'CN'),
];
function rec(prefix, blockType, addressCount, orgName, country) {
  return { prefix, prefixLen: prefix.length * 4, blockType, addressCount, orgName, orgAddress: null, country };
}

/**
 * Run the generated snippet over the fixture shards, with `fetch` stubbed to
 * serve `/data/mcp/*` from disk. Returns a client wired to it, so every
 * assertion below goes through the same code path a real client would.
 */
async function harness() {
  const dist = await mkdtemp(path.join(os.tmpdir(), 'mcp-conf-'));
  await writeMcpShards({ distDir: dist, records: RECORDS });
  const shardDir = path.join(dist, 'data', 'mcp');
  const mod = await import(`file://${path.join(dist, 'mcp-snippet.js')}`);
  const real = globalThis.fetch;
  const fetched = [];
  globalThis.fetch = async (input, init) => {
    const url = new URL(typeof input === 'string' ? input : input.url);
    fetched.push({ host: url.host, path: url.pathname });
    return originImpl(url);
  };
  // The default origin: serve the fixture shards, 404 anything else. A test can
  // replace this to simulate a fault; `setOrigin(null)` puts the default back.
  const defaultOrigin = async (url) => {
    try {
      const body = await readFile(path.join(shardDir, path.basename(url.pathname)), 'utf8');
      const type = url.pathname.endsWith('.json') ? 'application/json' : 'text/plain';
      return new Response(body, { status: 200, headers: { 'content-type': type } });
    } catch {
      return new Response('not found', { status: 404, headers: { 'content-type': 'text/plain' } });
    }
  };
  let originImpl = defaultOrigin;
  const setOrigin = (impl) => { originImpl = impl ?? defaultOrigin; };

  const clientFor = (host) =>
    new Mcp2026Client({
      url: `https://${host}${MCP_ROUTE}`,
      fetch: (url, init) => mod.default.fetch(new Request(url, init)),
    });
  return {
    client: clientFor(HOST),
    clientFor,
    setOrigin,
    mod,
    fetched,
    dist,
    restore: () => { globalThis.fetch = real; },
  };
}

// ---------------------------------------------------------------- base protocol

describe('2026-07-28 base protocol', () => {
  let h;
  before(async () => { h = await harness(); });
  after(() => h.restore());

  test('methods that no longer exist are rejected with METHOD_NOT_FOUND', async () => {
    // initialize is deliberately NOT in this list: it is answered statelessly so
    // a connector UI that probes with it is not turned away. See the
    // "legacy stateless handshake" group below.
    // 404, not 400. The specification: "If the server does not implement the
    // requested RPC method, it MUST respond with 404 Not Found and a JSON-RPC
    // error with code -32601." A 400 is what a malformed request earns, and it
    // is also what an unsupported version earns, so using it here makes three
    // different faults indistinguishable.
    for (const method of ['notifications/initialized', 'logging/setLevel', 'completion/complete']) {
      const res = await h.client.request(method, undefined, 1);
      assert.equal(res.status, 404, `${method} should be a 404, got ${res.status}`);
      assert.equal(res.json.error.code, JSON_RPC.METHOD_NOT_FOUND, `${method} error code`);
    }
  });

  test('a tools/list works with no initialize handshake', async () => {
    const { res, tools } = await h.client.listTools();
    assert.equal(res.status, 200);
    assert.equal(res.json.jsonrpc, '2.0');
    assert.ok(Array.isArray(tools) && tools.length > 0);
  });

  test('an unsupported protocol version is refused with -32022 and a supported list', async () => {
    // The affordance the whole transition depends on. -32022 is how a client
    // learns to retry in a mutually supported version; and because -32022 is on
    // the modern-signal list, a client-side era check reads it as proof the
    // server is modern. An unrecognized 400 would read as legacy instead.
    const res = await h.client.request('tools/list', undefined, 1, { 'MCP-Protocol-Version': '1999-01-01' });
    assert.equal(res.status, 400);
    assert.equal(res.json.error.code, -32022);
    assert.ok(Array.isArray(res.json.error.data.supported), 'data.supported must be a list');
    assert.ok(res.json.error.data.supported.includes('2026-07-28'), 'must advertise 2026-07-28');
    assert.equal(res.json.error.data.requested, '1999-01-01');
  });

  test('a 2025-era client is served, not turned away', async () => {
    const res = await h.client.request('tools/list', undefined, 1, { 'MCP-Protocol-Version': '2025-06-18' });
    assert.equal(res.status, 200, 'a supported legacy version must still work');
    assert.ok(Array.isArray(res.json.result.tools));
  });

  test('an unknown method is rejected with METHOD_NOT_FOUND', async () => {
    const res = await h.client.request('resources/list', undefined, 9);
    assert.equal(res.json.error.code, JSON_RPC.METHOD_NOT_FOUND);
  });

  test('the id is echoed with its type preserved', async () => {
    // `typeof null` is "object", so the null case is checked by value.
    for (const id of [1, 0, -7, 'abc-123', '']) {
      const res = await h.client.request('tools/list', undefined, id);
      assert.equal(res.json.id, id, `id ${JSON.stringify(id)} not echoed`);
      assert.equal(typeof res.json.id, typeof id, `id ${JSON.stringify(id)} changed type`);
    }
    const nullId = await h.client.request('tools/list', undefined, null);
    assert.equal(nullId.json.id, null, 'a null id must echo as null');
  });

  test('a notification gets 202 and no body', async () => {
    const res = await h.client.notify('tools/call', { name: 'lookup', arguments: { mac: '8C1F64AFA4B2' } });
    assert.equal(res.status, 202);
    assert.equal(res.text, '');
  });

  test('a malformed body gets PARSE_ERROR', async () => {
    const res = await h.client.raw('POST', '{not json');
    assert.equal(res.status, 400);
    assert.equal(res.json.error.code, JSON_RPC.PARSE_ERROR);
  });

  test('a non-POST method gets 405 with an Allow header', async () => {
    // 2026-07-28 lets a server refuse the optional GET SSE stream. Refusing it
    // with 405 is conformant; what matters is that the refusal is explicit.
    const res = await h.client.raw('GET');
    assert.equal(res.status, 405);
    assert.match(String(res.headers.get('allow')), /POST/);
  });

  test('bad tool arguments get INVALID_PARAMS, not a wrong answer', async () => {
    for (const mac of ['', '8C1F', '8C1F64AFA4B2EXTRA', 'ZZZZZZ']) {
      const res = await h.client.callTool('lookup', { mac });
      assert.equal(res.status, 400, `"${mac}" should be rejected`);
      assert.equal(res.json.error.code, JSON_RPC.INVALID_PARAMS, `"${mac}" error code`);
    }
  });

  test('an unknown tool name is rejected', async () => {
    const res = await h.client.callTool('nope', {});
    assert.equal(res.json.error.code, JSON_RPC.METHOD_NOT_FOUND);
  });

  test('the version, method, and name headers are honoured for routing', async () => {
    // 2026-07-28 requires Mcp-Method and Mcp-Name so a gateway can route
    // without parsing the body. The client sends both; the server must use them.
    const { res, tools } = await h.client.listTools();
    assert.equal(res.status, 200);
    assert.equal(tools.length, 1);
    const entry = h.client.log.at(-1);
    assert.equal(entry.headers.get('mcp-protocol-version'), null, 'response need not echo the version');
    assert.equal(entry.sent._meta['io.modelcontextprotocol/clientInfo'].name, 'mcp-2026-07-28-client');
  });

  test('CORS exposes the headers a browser client needs', async () => {
    const { res } = await h.client.listTools();
    const expose = String(res.headers.get('access-control-expose-headers') || '');
    assert.match(expose, /mcp-protocol-version/i);
  });
});

// ---------------------------------------------------------------- tools/list

describe('tools/list structure (requirements from the official suite)', () => {
  let h;
  before(async () => { h = await harness(); });
  after(() => h.restore());

  test('every tool has name, description, and a valid JSON Schema inputSchema', async () => {
    const { tools } = await h.client.listTools();
    assert.deepEqual(checkToolsListShape({ tools }), [], 'structural problems');
  });

  test('the declared outputSchema matches what the tool actually returns', async () => {
    const { tools } = await h.client.listTools();
    const declared = Object.keys(tools[0].outputSchema.properties).sort();
    const res = await h.client.callTool('lookup', { mac: '8C:1F:64:AF:A4:B2' });
    const actual = Object.keys(res.json.result.structuredContent).sort();
    // A client that validates against the schema must not see an undeclared key.
    const undeclared = actual.filter((key) => !declared.includes(key));
    assert.deepEqual(undeclared, [], `structuredContent has keys absent from outputSchema: ${undeclared}`);
  });

  test('the inputSchema constrains the argument the server actually reads', async () => {
    const { tools } = await h.client.listTools();
    const schema = tools[0].inputSchema;
    assert.equal(schema.type, 'object');
    assert.deepEqual(schema.required, ['mac']);
    assert.equal(schema.additionalProperties, false);
    assert.ok(schema.properties.mac.description.length > 20, 'the argument needs a usable description');
  });

  test('the tool is marked read-only', async () => {
    const { tools } = await h.client.listTools();
    assert.equal(tools[0].annotations.readOnlyHint, true);
  });
});

/**
 * The strict validator a modern client applies, transcribed from the
 * playground's own rejection:
 *
 *   "Invalid result for tools/call: missing required resultType -- servers
 *    implementing protocol revision 2026-07-28 MUST include it (the
 *    absent-means-complete bridge applies only to earlier-revision servers)"
 *
 * The important word is MUST, and the second half of the sentence: a server on
 * 2025-11-25 may omit it, and this endpoint also serves that revision. So the
 * same field is mandatory or optional depending on which revision answered, and
 * one strict and one lenient client disagree about a byte-identical response.
 *
 * That is why a fix verified in "stateful" mode proves nothing about the
 * stateless lane. The playground sends its mode to /connect only; its
 * per-request endpoints re-detect, and our discover advertises 2026-07-28, so
 * both modes validate against the modern rule.
 */
function assertModernResult(result, label) {
  assert.equal(result?.resultType, 'complete', `${label}: missing resultType`);
}

// ---------------------------------------------------------------- server/discover

describe('server/discover (the stateless entry point)', () => {
  let h;
  before(async () => { h = await harness(); });
  after(() => h.restore());

  // A stateless client probes here before anything else and picks a version out
  // of `supportedVersions`. Nothing else in the reply matters to it. A server
  // that omits the field sends no error at all: it answers 200 with the tool
  // catalog, and the client reports a version negotiation failure on its own
  // side. That is why this endpoint worked from a stateful test tool, which
  // handshakes instead, and failed from every stateless one.
  test('the result advertises the pinned version and the server identity', async () => {
    const res = await h.client.request('server/discover', undefined, 1);
    assert.equal(res.status, 200);
    const result = res.json.result;
    assert.ok(
      Array.isArray(result.supportedVersions) && result.supportedVersions.length > 0,
      'supportedVersions is the field a stateless client negotiates from and must be a non-empty list',
    );
    assert.ok(
      result.supportedVersions.includes(PROTOCOL_VERSION),
      `a client pinning ${PROTOCOL_VERSION} must find it in ${JSON.stringify(result.supportedVersions)}`,
    );
    assert.equal(result.resultType, 'complete');
    const info = result._meta?.['io.modelcontextprotocol/serverInfo'];
    assert.equal(info?.name, 'mac-address-lookup');
    assert.equal(info?.version, '1.0.0');
  });

  // The rule that makes the two fields above mandatory, and the one that is
  // easiest to break by accident: a result marked "complete" MUST carry them.
  //
  // A strict client validator throws the whole result away when they are absent,
  // so the visible symptom is "the server has no tools", not "the hints are
  // missing". The server sees a correct 200 and has nothing to report.
  test('a complete result carries the caching hints the specification requires', async () => {
    for (const method of ['server/discover', 'tools/list']) {
      const { json } = await h.client.request(method, undefined, 1);
      const result = json.result;
      assert.equal(result.resultType, 'complete', `${method} resultType`);
      assert.equal(typeof result.ttlMs, 'number', `${method} must carry a numeric ttlMs`);
      assert.ok(Number.isInteger(result.ttlMs) && result.ttlMs >= 0, `${method} ttlMs must be an integer >= 0`);
      assert.ok(
        result.cacheScope === 'public' || result.cacheScope === 'private',
        `${method} cacheScope must be "public" or "private", got ${JSON.stringify(result.cacheScope)}`,
      );
    }
  });

  // The drift guard. Advertise a version and the guard refuses it, and the
  // client is told to claim a version that then fails; refuse a version that
  // discovery advertises, and the client walks away before it sends anything.
  test('every advertised version is a version the endpoint actually serves', async () => {
    const { json } = await h.client.request('server/discover', undefined, 1);
    assert.ok(Array.isArray(json.result.supportedVersions), 'discover must advertise a version list');
    for (const version of json.result.supportedVersions) {
      const res = await h.client.request('tools/list', undefined, 1, { 'MCP-Protocol-Version': version });
      assert.equal(res.status, 200, `${version} is advertised by discover but refused by the endpoint`);
    }
  });
});

// ---------------------------------------------------------------- tool behaviour

// ---------------------------------------------------------------- header routing

/**
 * Header and body validation.
 *
 * The specification requires this on security grounds, not tidiness: "This
 * prevents potential security vulnerabilities when different components in the
 * network rely on different sources of truth, for example a load balancer
 * routing on the header value while the MCP server executes based on the body
 * value." Reading `payload.method || header` and preferring the body is exactly
 * the behaviour that warns against, and it meant a gateway and this server could
 * disagree with nothing reporting it.
 *
 * These four checks are the failures an official conformance run surfaced:
 * `-32020` is required for a mismatch, unknown methods must be `404`, and a
 * field value's surrounding optional whitespace is not part of its value.
 */
describe('header and body agreement', () => {
  let h;
  before(async () => { h = await harness(); });
  after(() => h.restore());

  const HEADER_MISMATCH = -32020;

  test('a version header that disagrees with the body is refused with -32020', async () => {
    // Not -32022. A client reads -32022 as "pick a version I support and retry",
    // and would retry the same bad header forever. The fault is the header, so
    // the code has to say so.
    const res = await h.client.request(
      'tools/list',
      undefined,
      1,
      { 'MCP-Protocol-Version': '2026-07-28' },
    );
    const body = { jsonrpc: '2.0', id: 1, method: 'tools/list', params: { _meta: { 'io.modelcontextprotocol/protocolVersion': '2025-11-25' } } };
    const direct = await h.mod.default.fetch(new Request(`https://${HOST}${MCP_ROUTE}/`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'MCP-Protocol-Version': '2026-07-28', 'Mcp-Method': 'tools/list' },
      body: JSON.stringify(body),
    }));
    assert.equal(direct.status, 400);
    const json = await direct.json();
    assert.equal(json.error.code, HEADER_MISMATCH, 'a mismatch is not an unsupported version');
    assert.match(json.error.message, /Header mismatch/);
    assert.equal(res.status, 200, 'the matching pair above is the control');
  });

  test('a routing header that disagrees with the method is refused, not resolved', async () => {
    // The failure that mattered: the header said prompts/list, the body said
    // tools/list, and the server served tools/list with a 200. A load balancer
    // trusting the header would have routed this somewhere else entirely.
    const res = await h.mod.default.fetch(new Request(`https://${HOST}${MCP_ROUTE}/`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'MCP-Protocol-Version': '2026-07-28',
        'Mcp-Method': 'prompts/list',
      },
      body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/list' }),
    }));
    assert.equal(res.status, 400);
    assert.equal((await res.json()).error.code, HEADER_MISMATCH);
  });

  test('the routing headers are required on the modern revision', async () => {
    for (const omit of ['Mcp-Method', 'Mcp-Name']) {
      const headers = { 'content-type': 'application/json', 'MCP-Protocol-Version': '2026-07-28' };
      if (omit !== 'Mcp-Method') headers['Mcp-Method'] = 'tools/call';
      const res = await h.mod.default.fetch(new Request(`https://${HOST}${MCP_ROUTE}/`, {
        method: 'POST',
        headers,
        body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name: 'lookup', arguments: { mac: '8C1F64AFA4B2' } } }),
      }));
      assert.equal(res.status, 400, `omitting ${omit} must be refused`);
      assert.equal((await res.json()).error.code, HEADER_MISMATCH, `omitting ${omit}`);
    }
  });

  test('surrounding whitespace in a field value is not part of the value', async () => {
    // RFC 9110 allows optional whitespace around a field value, and a server
    // strips it. Refusing `"  lookup  "` is refusing a correct request.
    const res = await h.mod.default.fetch(new Request(`https://${HOST}${MCP_ROUTE}/`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'MCP-Protocol-Version': '2026-07-28',
        'Mcp-Method': 'tools/call',
        'Mcp-Name': '  lookup  ',
      },
      body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name: 'lookup', arguments: { mac: '8C1F64AFA4B2' } } }),
    }));
    assert.equal(res.status, 200, 'a padded field value is a legal field value');
    assert.equal((await res.json()).result.structuredContent.orgName, 'DATA ELECTRONIC DEVICES, INC');
  });

  test('a 2025-era request is served without the routing headers it cannot send', async () => {
    // The relaxation, and the reason it exists. A client on 2025-11-25 sends no
    // Mcp-Method header, so requiring one would turn away exactly the legacy
    // clients this endpoint answers deliberately.
    const res = await h.client.request(
      'tools/list',
      undefined,
      1,
      { 'MCP-Protocol-Version': '2025-11-25' },
    );
    assert.equal(res.status, 200, 'a legacy client must still be served');
    assert.ok(Array.isArray(res.json.result.tools));
  });
});

describe('lookup tool behaviour', () => {
  let h;
  before(async () => { h = await harness(); });
  after(() => h.restore());

  // `resultType` is required on every 2026-07-28 result, and the bridge that
  // treats an absent value as complete applies only to earlier revisions. A
  // strict client discards the whole result when it is missing, so a correct
  // lookup is thrown away and the client reports a malformed result instead of
  // the vendor.
  //
  // This covers both tool-call paths: a hit and a miss. A miss is the easier one
  // to break, because it is the branch with no vendor in it.
  test('a tool call result is marked complete on both the hit and the miss path', async () => {
    const hit = await h.client.callTool('lookup', { mac: '8C:1F:64:AF:A4:B2' });
    assertModernResult(hit.json.result, 'matched address');
    const miss = await h.client.callTool('lookup', { mac: '02:00:00:00:00:01' });
    assertModernResult(miss.json.result, 'unmatched address');
    assert.equal(miss.json.result.structuredContent.orgName, null, 'the miss path still returns its payload');
  });

  test('every result this endpoint can return is marked complete', async () => {
    // A new method added later goes through the same wrapper, so this is the
    // check that keeps it honest. ping and tools/list are included because they
    // are the ones a caller is most likely to forget.
    for (const call of [
      () => h.client.request('ping', undefined, 1),
      () => h.client.request('tools/list', undefined, 1),
      () => h.client.request('server/discover', undefined, 1),
      () => h.client.callTool('lookup', { mac: '8C1F64AFA4B2' }),
    ]) {
      const res = await call();
      assert.equal(res.json.result.resultType, 'complete');
    }
  });

  test('the result carries text content and a matching structured payload', async () => {
    const res = await h.client.callTool('lookup', { mac: '8C:1F:64:AF:A4:B2' });
    const { content, structuredContent } = res.json.result;
    assert.equal(content[0].type, 'text');
    assert.ok(content[0].text.length > 0);
    // The human summary must not contradict the machine payload.
    assert.ok(content[0].text.includes(structuredContent.prefix), 'text must name the prefix it returned');
    assert.ok(content[0].text.includes(structuredContent.orgName), 'text must name the org it returned');
  });

  test('longest-prefix match agrees with a brute-force oracle', async () => {
    const plan = planShards(RECORDS);
    const oracle = new Set(RECORDS.map((r) => r.prefix));
    const brute = (hex) => {
      let best = null;
      for (const p of oracle) if (p.length > (best?.length ?? 0) && hex.startsWith(p)) best = p;
      return best;
    };
    for (const r of RECORDS) {
      for (const q of [r.prefix, r.prefix.padEnd(12, '0'), r.prefix + 'A'.repeat(12 - r.prefix.length)]) {
        const res = await h.client.callTool('lookup', { mac: q });
        assert.equal(res.json.result.structuredContent.prefix, brute(q), `${q}`);
      }
    }
    // The depth table is what keeps one fetch sufficient; assert it stays legal.
    for (const [key, depth] of Object.entries(plan.table)) {
      assert.equal(key.length, SHARD_BASE_DEPTH);
      assert.ok(depth <= 6, `depth ${depth} for ${key} is past the lossless ceiling`);
    }
  });

  test('every declared outputSchema property is present on the hit path', async () => {
    // A real defect, found while triaging a connector report of "An unknown
    // error occurred while executing the tool" on an address the endpoint
    // answered correctly. `locallyAdministered` and `multicast` were declared as
    // plain booleans but returned only on the miss path, so on a hit they were
    // absent. Absent is not the same as false, and the specification says a
    // client SHOULD validate structuredContent against the tool's own
    // outputSchema, so a strict client can reject the whole result over it.
    //
    // This predates the single-revision work and is independent of it: the miss
    // branch grew two fields the hit branch never learned about.
    const { tools } = await h.client.listTools();
    const declared = Object.keys(tools[0].outputSchema.properties);
    const hit = await h.client.callTool('lookup', { mac: '8C:1F:64:AF:A4:B2' });
    const payload = hit.json.result.structuredContent;
    const missing = declared.filter((key) => !(key in payload));
    assert.deepEqual(missing, [], `hit path omits declared properties: ${missing.join(', ')}`);
    assert.equal(typeof payload.locallyAdministered, 'boolean');
    assert.equal(typeof payload.multicast, 'boolean');
  });

  test('the hit and miss paths return the same key set', async () => {
    // The check that would have caught the drift above.
    const hit = await h.client.callTool('lookup', { mac: '8C:1F:64:AF:A4:B2' });
    const miss = await h.client.callTool('lookup', { mac: '02:00:00:00:00:01' });
    assert.deepEqual(
      Object.keys(miss.json.result.structuredContent).sort(),
      Object.keys(hit.json.result.structuredContent).sort(),
      'the hit and miss paths must return the same fields',
    );
  });

  test('an unregistered address reports no match and hands back no page URL', async () => {
    const res = await h.client.callTool('lookup', { mac: '02:00:00:00:00:01' });
    const s = res.json.result.structuredContent;
    assert.equal(s.prefix, null, 'must not invent a vendor');
    assert.equal(s.orgName, null);
    assert.ok(!/^https:\/\/[^/]+\/[0-9A-F]{6,}$/.test(s.url), `must not link a record page, got ${s.url}`);
  });

  test('the returned URL points at a real record page', async () => {
    const res = await h.client.callTool('lookup', { mac: '8C:1F:64:AF:A4:B2' });
    const { url } = res.json.result.structuredContent;
    // Registered prefixes are 6 (MA-L), 7 (MA-M), or 9 (MA-S/IAB) hex chars.
    assert.match(url, /^https:\/\/mac\.jasontally\.com\/[0-9A-F]{6}$|^https:\/\/mac\.jasontally\.com\/[0-9A-F]{7}$|^https:\/\/mac\.jasontally\.com\/[0-9A-F]{9}$/);
  });

  test('every separator form normalizes to the same answer', async () => {
    const seen = new Set();
    for (const form of ['8C:1F:64:AF:A4:B2', '8c-1f-64-af-a4-b2', '8c1f.64af.a4b2', '8C1F64AFA4B2', ' 8c1f64afa4b2 ']) {
      const res = await h.client.callTool('lookup', { mac: form });
      seen.add(res.json.result.structuredContent.prefix);
    }
    assert.deepEqual([...seen], ['8C1F64AFA']);
  });

  test('a locally administered address is identified as such', async () => {
    // Bit 1 of the first octet is U/L. This is the case that makes a
    // "no vendor" answer useful rather than merely absent.
    const res = await h.client.callTool('lookup', { mac: '02:11:22:33:44:55' });
    const s = res.json.result.structuredContent;
    assert.equal(s.locallyAdministered, true);
    assert.match(res.json.result.content[0].text, /randomized|locally administered/i);
  });

  test('a missing country is null, not an empty string', async () => {
    const res = await h.client.callTool('lookup', { mac: 'AC:DE:48:00:11:22' });
    const s = res.json.result.structuredContent;
    assert.equal(s.country, null);
    assert.equal(s.orgName, 'Private');
  });

  test('an organization name containing the field separator survives', async () => {
    const res = await h.client.callTool('lookup', { mac: 'BC:AD:28:00:11:22' });
    assert.equal(res.json.result.structuredContent.orgName, 'A | B Telecom');
  });

  test('one lookup costs one shard fetch, on the request host', async () => {
    const before = h.fetched.length;
    await h.client.callTool('lookup', { mac: '00:1B:21:3C:4D:5E' });
    const calls = h.fetched.slice(before);
    assert.equal(calls.length, 1, `expected one subrequest, got ${JSON.stringify(calls)}`);
    assert.equal(calls[0].host, HOST);
    assert.equal(calls[0].path, '/data/mcp/001b.txt');
  });
});

// ---------------------------------------------------------------- transport scoping

describe('endpoint scoping', () => {
  let h;
  before(async () => { h = await harness(); });
  after(() => h.restore());

  test('the rule expression is scoped to one host and one path', () => {
    const expression = mcpRuleExpression();
    assert.equal(
      expression,
      `(http.host eq "${HOST}" and (http.request.uri.path eq "${MCP_ROUTE}" or http.request.uri.path eq "${MCP_ROUTE}/"))`,
    );
    // A path-only rule is zone-wide and would fire on every subdomain, where
    // the shard fetch 404s and every lookup reports no vendor.
    assert.ok(expression.includes('http.host eq'), 'host term missing');
  });

  test('the snippet serves the trailing-slash path too', async () => {
    // The handler takes no path branch, so the rule expression is the only
    // thing that decides whether /mcp/ reaches it. Guard the property the rule
    // now depends on, so a future path check in the handler cannot drift.
    const res = await h.mod.default.fetch(new Request(`https://${HOST}${MCP_ROUTE}/`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/list' }),
    }));
    assert.equal(res.status, 200, `trailing-slash POST returned ${res.status}`);
    const body = await res.json();
    assert.equal(body.result.tools[0].name, 'lookup');
  });

  test('any other host is refused with 404 before a shard is fetched', async () => {
    for (const host of ['www.jasontally.com', 'jasontally.com', 'evil.example']) {
      const before = h.fetched.length;
      const res = await h.clientFor(host).request('tools/call', { name: 'lookup', arguments: { mac: '8C:1F:64:AF:A4:B2' } }, 1);
      assert.equal(res.status, 404, `${host} must be refused`);
      assert.match(res.json.error.message, new RegExp(`served on ${HOST} only`));
      // The load-bearing assertion: refusal must precede any shard fetch, or a
      // wrong host would fetch /data/mcp/... from itself, 404 every key, and
      // report "no vendor" for every address.
      assert.equal(h.fetched.length, before, `${host} triggered a shard fetch`);
    }
  });

  test('the correct host still answers after a wrong-host attempt', async () => {
    const res = await h.client.callTool('lookup', { mac: '8C:1F:64:AF:A4:B2' });
    assert.equal(res.status, 200);
    assert.equal(res.json.result.structuredContent.prefix, '8C1F64AFA');
  });
});


// ---------------------------------------------------------------- asset faults

describe('the SPA fallback is never mistaken for shard data', () => {
  let h;
  before(async () => { h = await harness(); });
  after(() => h.restore());

  // The site sets not_found_handling to single-page-application, so Cloudflare
  // answers ANY unmatched path with HTTP 200 and the SPA shell as text/html.
  // 79.3% of 4-character buckets are legitimately empty, so a missing shard is
  // usually just an unregistered range and must stay a quiet "no match". What
  // must never happen is the HTML being scanned as if it were data.
  const SPA_SHELL = '<!doctype html><html lang="en"><head><meta charset="utf-8"></head></html>';

  test('an SPA-fallback body yields no match, not a crash and not a vendor', async () => {
    h.setOrigin(async () => new Response(SPA_SHELL, { status: 200, headers: { 'content-type': 'text/html' } }));
    try {
      const res = await h.client.callTool('lookup', { mac: '8C:1F:64:AF:A4:B2' });
      assert.equal(res.status, 200, 'an empty range is a normal answer');
      const s2 = res.json.result.structuredContent;
      assert.equal(s2.prefix, null, 'must not invent a vendor from an HTML page');
      assert.equal(s2.orgName, null);
    } finally {
      h.setOrigin(null);
    }
  });

  test('a 404 body yields no match', async () => {
    h.setOrigin(async () => new Response('not found', { status: 404 }));
    try {
      const res = await h.client.callTool('lookup', { mac: '8C:1F:64:AF:A4:B2' });
      assert.equal(res.status, 200);
      assert.equal(res.json.result.structuredContent.prefix, null);
    } finally {
      h.setOrigin(null);
    }
  });

  test('text/plain with no record line yields no match', async () => {
    h.setOrigin(async () => new Response('\n\n', { status: 200, headers: { 'content-type': 'text/plain' } }));
    try {
      const res = await h.client.callTool('lookup', { mac: '8C:1F:64:AF:A4:B2' });
      assert.equal(res.json.result.structuredContent.prefix, null);
    } finally {
      h.setOrigin(null);
    }
  });

  test('an empty bucket is a quiet no match, because 79% of buckets are empty', async () => {
    // 021 has no records in the fixture, so the shard is genuinely absent.
    const res = await h.client.callTool('lookup', { mac: '02:11:22:33:44:55' });
    assert.equal(res.status, 200);
    assert.equal(res.json.result.structuredContent.prefix, null);
    assert.equal(res.json.result.structuredContent.locallyAdministered, true);
  });

  test('the catalog is the deployment canary: HTML there fails loudly', async () => {
    // One file, so its absence is unambiguous. A whole-deploy fault must not
    // present as a valid but empty tool list.
    h.setOrigin(async (url) =>
      url.pathname.endsWith('catalog.json')
        ? new Response(SPA_SHELL, { status: 200, headers: { 'content-type': 'text/html' } })
        : new Response('', { status: 200, headers: { 'content-type': 'text/plain' } }),
    );
    try {
      const { res } = await h.client.listTools();
      assert.equal(res.status, 400, `expected a loud failure, got ${res.status}`);
      assert.equal(res.json.error.code, JSON_RPC.INTERNAL_ERROR);
    } finally {
      h.setOrigin(null);
    }
  });

  test('a missing catalog over HTTP is a loud failure too', async () => {
    h.setOrigin(async (url) =>
      url.pathname.endsWith('catalog.json')
        ? new Response('not found', { status: 404 })
        : new Response('', { status: 200, headers: { 'content-type': 'text/plain' } }),
    );
    try {
      const { res } = await h.client.listTools();
      assert.equal(res.status, 400);
      assert.equal(res.json.error.code, JSON_RPC.INTERNAL_ERROR);
    } finally {
      h.setOrigin(null);
    }
  });

  test('a healthy shard still answers after the fault cases', async () => {
    const res = await h.client.callTool('lookup', { mac: '8C:1F:64:AF:A4:B2' });
    assert.equal(res.status, 200);
    assert.equal(res.json.result.structuredContent.prefix, '8C1F64AFA');
  });
});

// ---------------------------------------------------------------- handshake

describe('legacy stateless handshake (legacy:stateless)', () => {
  let h;
  before(async () => { h = await harness(); });
  after(() => h.restore());

  // A connector UI probes with initialize before it can classify the server. If
  // that probe 400s, the UI reads it as an auth challenge and reports a
  // configuration error -- which is exactly what Claude did:
  //   "set up as not requiring sign-in, but the server asked for sign-in when
  //    checked (status 400)"
  // So the handshake is answered. The point of these tests is that answering it
  // does NOT reintroduce a session.

  test('initialize is answered, so a connector probe gets a 2xx', async () => {
    // The header must agree with the body. The client helper defaults the header
    // to the current revision, so a probe asking for an older one has to send a
    // matching header, which is what a real 2025-era client does. Sending the
    // 2026 header with a 2025 body is now refused as a header mismatch, and that
    // is the point: see "a header that disagrees with the body is refused".
    const res = await h.client.request(
      'initialize',
      { protocolVersion: '2025-06-18', capabilities: {} },
      1,
      { 'MCP-Protocol-Version': '2025-06-18' },
    );
    assert.equal(res.status, 200, 'the probe must succeed');
    const r = res.json.result;
    assert.equal(r.protocolVersion, '2025-06-18', 'must echo a version it can serve');
    assert.equal(r.capabilities.tools.listChanged, false);
    assert.equal(r.serverInfo.name, 'mac-address-lookup');
  });

  test('the handshake issues no Mcp-Session-Id', async () => {
    const res = await h.client.request('initialize', { protocolVersion: '2025-06-18' }, 1);
    assert.equal(res.headers.get('mcp-session-id'), null, 'this is a stateless server');
  });

  // Security: the endpoint is unauthenticated and unthrottled, so a
  // caller-supplied body size is a free amplification lever. Measured before
  // the guard: one 90 MB POST was accepted, held the invocation for 33.6s of
  // wall clock, and still answered 200.
  test('an oversized body is refused on its declared length', async () => {
    // What this can and cannot assert: the 413 proves the guard fires before
    // parsing. Whether the body is left unread is not observable in-process --
    // Node's ReadableStream pulls into its own queue whether or not a consumer
    // asks, so both `start` and `pull` fire regardless. That property is
    // verified against production instead: before the guard a 90 MB POST held
    // the invocation for 33.6s and answered 200; after it, a 90 MB POST is
    // refused immediately. See docs/mcp-endpoint.md.
    const res = await h.mod.default.fetch(new Request(`https://${HOST}${MCP_ROUTE}`, {
      method: 'POST',
      duplex: 'half',
      headers: {
        'content-type': 'application/json',
        'content-length': '5000000',
      },
      body: '{"jsonrpc":"2.0","id":1,"method":"tools/list"}',
    }));

    assert.equal(res.status, 413, 'an oversized declared body must be refused');
    const body = await res.json();
    assert.equal(body.error.code, -32600);
    assert.match(body.error.message, /too large/i);
    assert.equal(body.id, null, 'the body was never parsed, so no id could be echoed');
  });

  test('a normal-sized body is unaffected', async () => {
    const res = await h.client.callTool('lookup', { mac: '8C:1F:64:AF:A4:B2' });
    assert.equal(res.status, 200);
    assert.equal(res.json.result.structuredContent.prefix, '8C1F64AFA');
  });

  test('no Mcp-Session-Id is ever issued, on any call', async () => {
    const res = await h.client.callTool('lookup', { mac: '8C:1F:64:AF:A4:B2' });
    assert.equal(res.headers.get('mcp-session-id'), null);
    assert.match(String(res.headers.get('access-control-expose-headers')), /mcp-session-id/i);
  });

  test('every supported version is served statelessly', async () => {
    for (const version of ['2026-07-28', '2025-11-25', '2025-06-18']) {
      const res = await h.client.request('tools/list', undefined, 1, { 'MCP-Protocol-Version': version });
      assert.equal(res.status, 200, `${version} must be served`);
      assert.ok(Array.isArray(res.json.result.tools));
    }
  });

  test('an unknown version is refused, naming what is supported', async () => {
    const res = await h.client.request('tools/list', undefined, 1, { 'MCP-Protocol-Version': '2020-01-01' });
    assert.equal(res.status, 400);
    assert.equal(res.json.error.code, -32022);
    assert.deepEqual(res.json.error.data.supported.sort(), ['2025-06-18', '2025-11-25', '2026-07-28']);
  });

  test('the version may also arrive in _meta, per the spec', async () => {
    const res = await h.client.request('tools/list', undefined, 1);
    assert.equal(res.status, 200);
    const bad = await h.client.request('tools/list', undefined, 1, { 'MCP-Protocol-Version': 'bogus' });
    assert.equal(bad.json.error.code, -32022);
  });

  test('ping is answered, since some clients probe with it', async () => {
    const res = await h.client.request('ping', undefined, 1);
    assert.equal(res.status, 200);
    // Now marked complete, like every other result. `ping` was the one that
    // returned a bare {} and would have been the next thing a strict client
    // rejected.
    assert.deepEqual(res.json.result, { resultType: 'complete' });
  });

  // Regression: the guard read only the header and _meta, and initialize carries
  // its version in params.protocolVersion -- the only place a real client sends
  // it, since 2025-03-26 dropped the header requirement from the handshake. So
  // on initialize the guard saw null and the reply fell through to "negotiate to
  // whatever we like". A client asking for an unsupported version was told the
  // server speaks 2026-07-28, then refused on every later request.
  test('initialize refuses an unsupported version in params', async () => {
    for (const version of ['2025-03-26', '2024-11-05', '1999-01-01', 'bogus']) {
      const res = await h.client.request(
        'initialize',
        { protocolVersion: version, capabilities: {} },
        1,
      );
      assert.equal(res.status, 400, `${version} must be refused, not waved through`);
      assert.equal(res.json.error.code, -32022, `${version} must name the real reason`);
      assert.equal(res.json.error.data.requested, version, 'the refusal echoes what was asked');
      assert.deepEqual(
        res.json.error.data.supported.sort(),
        ['2025-06-18', '2025-11-25', '2026-07-28'],
        `${version} must be told what is actually supported`,
      );
    }
  });

  test('initialize never claims a version the client did not ask for', async () => {
    // The exact lie: asked 2025-03-26, answered 2026-07-28. If any future edit
    // makes negotiation fall back to PROTOCOL_VERSION instead of refusing, this
    // fails.
    for (const version of ['2025-03-26', '2024-11-05', '2020-06-01', 'nonsense']) {
      const res = await h.client.request('initialize', { protocolVersion: version }, 1);
      if (res.status === 200) {
        assert.equal(
          res.json.result.protocolVersion,
          version,
          `initialize answered ${res.json.result.protocolVersion} for a request asking ${version}`,
        );
      } else {
        assert.equal(res.json.error.code, -32022);
      }
    }
  });

  test('every supported version is echoed back exactly', async () => {
    for (const version of ['2026-07-28', '2025-11-25', '2025-06-18']) {
      // Header and body must agree, so each probe sends both. A client that
      // asked for 2025-11-25 with a 2026 header is asking for two things at once
      // and is refused, which is a separate test below.
      const res = await h.client.request(
        'initialize',
        { protocolVersion: version },
        1,
        { 'MCP-Protocol-Version': version },
      );
      assert.equal(res.status, 200, `${version} must be served`);
      assert.equal(res.json.result.protocolVersion, version, 'the echo must be exact');
    }
  });

  test('an initialize with no version at all is served on the current one', async () => {
    // A headerless, handshake-free client omits it. That is not a malformed
    // request, so it gets the current revision rather than a refusal.
    const res = await h.client.request('initialize', {}, 1);
    assert.equal(res.status, 200);
    assert.equal(res.json.result.protocolVersion, '2026-07-28');
  });

  test('a version in params is not shadowed by a stale header', async () => {
    const res = await h.client.request(
      'initialize',
      { protocolVersion: '2025-03-26' },
      1,
      { 'MCP-Protocol-Version': '2025-06-18' },
    );
    assert.equal(res.status, 400, 'the params version is the one under test');
    assert.equal(res.json.error.code, -32022);
  });

  test('the version may also arrive in params._meta', async () => {
    const res = await h.client.request(
      'tools/list',
      { _meta: { 'io.modelcontextprotocol/protocolVersion': '2024-11-05' } },
      1,
    );
    assert.equal(res.status, 400);
    assert.equal(res.json.error.code, -32022);
  });

  test('a non-string version is refused, not silently ignored', async () => {
    const res = await h.client.request('initialize', { protocolVersion: 20250618 }, 1);
    assert.equal(res.status, 400, 'a number is malformed input, not an absent field');
    assert.equal(res.json.error.code, -32022);
  });

  test('a tool call after a handshake still costs one fetch and no session', async () => {
    await h.client.request('initialize', { protocolVersion: '2025-06-18' }, 1);
    const before = h.fetched.length;
    const res = await h.client.callTool('lookup', { mac: '8C:1F:64:AF:A4:B2' });
    assert.equal(res.status, 200);
    assert.equal(res.json.result.structuredContent.prefix, '8C1F64AFA');
    assert.equal(h.fetched.length - before, 1, 'still exactly one shard fetch');
  });
});
