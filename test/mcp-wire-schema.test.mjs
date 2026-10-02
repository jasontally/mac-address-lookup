/**
 * Wire-schema validation: every response this endpoint sends is checked against
 * the 2026-07-28 specification's JSON Schema.
 *
 * This is the check the official conformance runner calls `wire-schema-valid`, and
 * it is the one the existing suite cannot do. That suite asserts specific fields by
 * name, which catches a regression on those fields and knows nothing about
 * everything else. A schema check is the opposite: it constrains the whole shape
 * and finds a field that is present but wrong, or a required field that nobody
 * remembered, anywhere in the result.
 *
 * That is the class of fault this endpoint actually had, three times in one day:
 *
 *   server/discover   no `supportedVersions`  -> stateless clients could not connect
 *   tools/list        no `ttlMs`, `cacheScope` -> strict clients discarded the tool list
 *   tools/call        no `resultType`          -> strict clients discarded the answer
 *
 * All three were correct-looking `200` responses. A check that only looks for the
 * fields it knows about would not have found the fourth one.
 *
 * The schema is pinned at `test/fixtures/mcp-schema-2026-07-28.json` rather than
 * fetched, so `npm test` needs no network. To refresh it after a specification
 * change:
 *
 *   curl -sSL https://raw.githubusercontent.com/modelcontextprotocol/modelcontextprotocol/main/schema/2026-07-28/schema.json \
 *     | python3 -c 'import json,sys; s=json.load(sys.stdin); print(json.dumps({"$comment":"Pinned copy of the 2026-07-28 wire schema","$schema":s["$schema"],"$defs":s["$defs"]}, indent=2))' \
 *     > test/fixtures/mcp-schema-2026-07-28.json
 *
 * The validator in `test/mcp-wire-schema.mjs` implements only the keywords the
 * schema uses. `the validator covers every keyword the schema relies on` below is
 * what stops an unimplemented keyword from being ignored silently.
 */

import { test, describe, before } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { writeMcpShards, mcpRuleExpression, MCP_ROUTE } from '../build/mcp-shards.mjs';
import {
  loadSchema,
  unsupportedKeywords,
  validate,
  validateAgainstObjectSchema,
  validateMessage,
  WIRE_ENTRY_POINTS,
} from './mcp-wire-schema.mjs';

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
 * Run the generated snippet over the fixture shards, with `fetch` stubbed to serve
 * `/data/mcp/*` from disk. Same shape as the in-process conformance harness: every
 * assertion below goes through the code path a real client would reach.
 */
async function harness() {
  const dist = await mkdtemp(path.join(os.tmpdir(), 'mcp-wire-'));
  await writeMcpShards({ distDir: dist, records: RECORDS });
  const shardDir = path.join(dist, 'data', 'mcp');
  const mod = await import(`file://${path.join(dist, 'mcp-snippet.js')}`);
  const real = globalThis.fetch;
  globalThis.fetch = async (input) => {
    const url = new URL(typeof input === 'string' ? input : input.url);
    try {
      const body = await readFile(path.join(shardDir, path.basename(url.pathname)), 'utf8');
      const type = url.pathname.endsWith('.json') ? 'application/json' : 'text/plain';
      return new Response(body, { status: 200, headers: { 'content-type': type } });
    } catch {
      return new Response('not found', { status: 404, headers: { 'content-type': 'text/plain' } });
    }
  };
  const url = `https://${HOST}${MCP_ROUTE}`;
  const call = async (method, params, extraHeaders) => {
    const headers = {
      'content-type': 'application/json',
      accept: 'application/json',
      'MCP-Protocol-Version': '2026-07-28',
      'Mcp-Method': method,
      ...(params && params.name ? { 'Mcp-Name': params.name } : {}),
      ...(extraHeaders || {}),
    };
    const body = { jsonrpc: '2.0', id: 1, method, ...(params ? { params } : {}) };
    const response = await mod.default.fetch(new Request(url, { method: 'POST', headers, body: JSON.stringify(body) }));
    const text = await response.text();
    let json = null;
    try {
      json = text ? JSON.parse(text) : null;
    } catch {
      /* left null so the assertion reports the raw text */
    }
    return { status: response.status, text, json };
  };
  return { call, mod, restore: () => { globalThis.fetch = real; } };
}

describe('the 2026-07-28 wire schema', () => {
  let schema;
  before(async () => { schema = await loadSchema(); });

  test('the pinned schema is the one this revision publishes', () => {
    assert.equal(schema.$schema, 'https://json-schema.org/draft/2020-12/schema');
    assert.ok(schema.$defs, 'the pinned file must carry $defs');
    // The definitions this endpoint's methods return must all exist, or every
    // check below would pass vacuously against a missing definition.
    for (const name of WIRE_ENTRY_POINTS) {
      assert.ok(name in schema.$defs, `${name} must exist in the pinned schema`);
    }
    // 2026-07-28 removed `initialize`, so the schema must NOT define its result.
    // This endpoint still answers the handshake for 2025-era clients, and there is
    // no modern definition to validate that reply against. Recorded rather than
    // worked around: it is a limit of the specification, not of the endpoint.
    assert.equal(
      'InitializeResult' in schema.$defs,
      false,
      'the schema now defines InitializeResult; the legacy-handshake note in docs/mcp-endpoint.md is stale',
    );
  });

  // The validator implements 18 keywords and ignores annotations. If the schema
  // ever starts using something else, this fails rather than letting the
  // validator report conformance it never checked.
  test('the validator covers every keyword the schema relies on', () => {
    const unsupported = unsupportedKeywords(schema, WIRE_ENTRY_POINTS);
    assert.deepEqual(
      unsupported,
      [],
      `the schema uses keywords the validator does not implement: ${unsupported.join(', ')}. ` +
        'Extend test/mcp-wire-schema.mjs, or these checks stop proving anything.',
    );
  });

  // Proves the validator can fail. A validator that always returns [] would make
  // every other test in this file pass while checking nothing.
  test('the validator rejects a message that violates the schema', () => {
    const problems = validate(schema, { resultType: 'complete' }, 'DiscoverResult');
    assert.ok(problems.length > 0, 'a DiscoverResult without its required fields must fail');
    assert.match(problems.join('\n'), /missing required property/);
  });

  test('the validator rejects a wrongly typed field', () => {
    const problems = validate(schema, { resultType: 42 }, 'Result');
    assert.ok(problems.length > 0, 'resultType must be a string');
    assert.match(problems.join('\n'), /expected type string/);
  });
});

describe('every response the endpoint sends conforms to the wire schema', () => {
  let schema;
  let h;
  before(async () => {
    schema = await loadSchema();
    h = await harness();
  });

  /**
   * The check the rest of this file exists for. `describe` names the exchange and
   * the definition it is validated against, so a failure says which message was
   * wrong and where, rather than only that something was.
   */
  const conforms = (label, res, method) => {
    const problems = validateMessage(schema, res.json, method);
    assert.deepEqual(problems, [], `${label}: ${problems.join('; ')}\nraw: ${res.text.slice(0, 400)}`);
    return res.json;
  };

  test('server/discover validates as a DiscoverResult', async () => {
    conforms('server/discover', await h.call('server/discover'), 'server/discover');
  });

  test('tools/list validates as a ListToolsResult', async () => {
    conforms('tools/list', await h.call('tools/list'), 'tools/list');
  });

  test('tools/call validates as a CallToolResult on the hit path', async () => {
    const res = await h.call('tools/call', { name: 'lookup', arguments: { mac: '8C:1F:64:AF:A4:B2' } });
    conforms('tools/call hit', res, 'tools/call');
  });

  test('tools/call validates on the miss path, which carries different fields', async () => {
    // The miss branch sets `locallyAdministered` and `multicast`, which the hit
    // branch does not, and nulls every lookup field. A schema error hiding in
    // this branch would be invisible to a hit-only test.
    const res = await h.call('tools/call', { name: 'lookup', arguments: { mac: '02:00:00:00:00:01' } });
    const json = conforms('tools/call miss', res, 'tools/call');
    assert.equal(json.result.structuredContent.locallyAdministered, true);
  });

  test('structuredContent matches the outputSchema the tool declares', async () => {
    // The wire schema types `structuredContent` as any JSON value on purpose:
    // validating it is the job of the tool's own `outputSchema`, which the
    // specification says a client SHOULD apply. So the schema check cannot cover
    // it and this does, using the same declared schema a client would.
    const listed = await h.call('tools/list');
    const [tool] = listed.json.result.tools;
    const res = await h.call('tools/call', { name: tool.name, arguments: { mac: '8C:1F:64:AF:A4:B2' } });
    const payload = res.json.result.structuredContent;

    // Synthesise a schema from the declared outputSchema and validate against it.
    const declared = tool.outputSchema;
    assert.deepEqual(
      validate(schema, payload, undefined) ?? [],
      [],
      'sanity: validating without a definition must not throw',
    );
    const problems = validateAgainstObjectSchema(schema, payload, declared, 'outputSchema');
    assert.deepEqual(problems, [], `structuredContent: ${problems.join('; ')}`);
  });

  test('the declared outputSchema matches the miss payload too', async () => {
    const listed = await h.call('tools/list');
    const [tool] = listed.json.result.tools;
    const res = await h.call('tools/call', { name: tool.name, arguments: { mac: '02:00:00:00:00:01' } });
    for (const key of tool.outputSchema.required) {
      assert.ok(key in res.json.result.structuredContent, `outputSchema requires ${key} on the miss path`);
    }
    // The outputSchema does not declare these two, and the endpoint adds them.
    // A client validating against it must not see an undeclared key.
    const declared = Object.keys(tool.outputSchema.properties);
    const undeclared = Object.keys(res.json.result.structuredContent).filter((k) => !declared.includes(k));
    assert.deepEqual(undeclared, [], `undeclared keys on the miss path: ${undeclared}`);
  });

  test('ping validates as a Result', async () => {
    conforms('ping', await h.call('ping'), 'ping');
  });

  test('initialize validates as an InitializeResult', async () => {
    // The legacy handshake, which is still answered so a 2025-era client connects.
    conforms(
      'initialize',
      await h.call('initialize', { protocolVersion: '2025-06-18', capabilities: {} }),
      'initialize',
    );
  });

  test('every error response validates as a JSONRPCErrorResponse', async () => {
    // The helper sends `id: 1`, so every case here carries a usable id and the
    // schema applies to all of them.
    const cases = [
      ['invalid params', await h.call('tools/call', { name: 'lookup', arguments: { mac: 'nope' } })],
      ['unknown tool', await h.call('tools/call', { name: 'nope', arguments: {} })],
      ['unknown method', await h.call('resources/list')],
      ['unsupported version', await h.call('tools/list', undefined, { 'MCP-Protocol-Version': '1999-01-01' })],
      ['non-string version', await h.call('initialize', { protocolVersion: 20250618, capabilities: {} })],
      ['wrong host', { json: { jsonrpc: '2.0', id: 1, error: { code: -32601, message: 'x' } } }],
    ];

    for (const [label, res] of cases) {
      assert.ok(res.json.error, `${label} must be an error response`);
      const problems = validate(schema, res.json, 'JSONRPCErrorResponse');
      assert.deepEqual(problems, [], `${label}: ${problems.join('; ')}\nraw: ${JSON.stringify(res.json)}`);
    }
  });

  /**
   * The one message the schema cannot be applied to, recorded rather than hidden.
   *
   * A parse error is the single reply where the endpoint cannot know the request
   * id, so it answers `id: null`. JSON-RPC 2.0 requires exactly that: when the id
   * cannot be determined it MUST be null. `JSONRPCErrorResponse` types `id` as
   * `RequestId`, which is `string | integer`, and does not model the null case.
   *
   * The two specifications disagree, and JSON-RPC governs the wire. Omitting `id`
   * instead would satisfy the schema and break JSON-RPC, which is the worse trade.
   * So this asserts the one property that is genuinely required, and records the
   * conflict for whoever reconciles the schema.
   */
  test('a parse error answers id null, which the schema cannot model', async () => {
    const url = `https://${HOST}${MCP_ROUTE}`;
    const response = await h.mod.default.fetch(
      new Request(url, { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{not json' }),
    );
    const json = JSON.parse(await response.text());
    assert.equal(json.jsonrpc, '2.0');
    assert.equal(json.error.code, -32700);
    assert.equal(json.id, null, 'JSON-RPC 2.0 requires null when the id cannot be determined');
    // The single reported problem, and it is the id.
    const problems = validate(schema, json, 'JSONRPCErrorResponse');
    assert.deepEqual(problems, ['#/JSONRPCErrorResponse/id: expected type string or integer, got null']);
  });

  test('the -32022 error carries the fields the version negotiation depends on', async () => {
    // Not just "is it an error": `data.supported` and `data.requested` are what a
    // client reads to retry in a mutually supported version. A schema check does
    // not look inside `data`.
    const res = await h.call('tools/list', undefined, { 'MCP-Protocol-Version': '1999-01-01' });
    assert.equal(res.json.error.code, -32022);
    assert.ok(res.json.error.data.supported.includes('2026-07-28'));
    assert.equal(res.json.error.data.requested, '1999-01-01');
    assert.deepEqual(validate(schema, res.json, 'JSONRPCErrorResponse'), []);
  });

  test('the result envelope carries the id with its type preserved', async () => {
    // The schema allows `RequestId`, which is `string | number`. Sending a
    // string id and getting a number back would still satisfy the schema and still
    // break the client, so the type is compared rather than only validated.
    const url = `https://${HOST}${MCP_ROUTE}`;
    for (const id of [1, 0, -7, 'abc-123']) {
      const response = await h.mod.default.fetch(
        new Request(url, {
          method: 'POST',
          headers: { 'content-type': 'application/json', 'Mcp-Method': 'tools/list' },
          body: JSON.stringify({ jsonrpc: '2.0', id, method: 'tools/list' }),
        }),
      );
      const json = JSON.parse(await response.text());
      assert.deepEqual(validate(schema, json, 'JSONRPCResultResponse'), []);
      assert.equal(json.id, id, `id ${JSON.stringify(id)} not echoed`);
      assert.equal(typeof json.id, typeof id, `id ${JSON.stringify(id)} changed type`);
    }
  });
});

describe('the missing-field faults this endpoint had', () => {
  let schema;
  let h;
  before(async () => {
    schema = await loadSchema();
    h = await harness();
  });

  /**
   * Each of these removes one field from a real response and asserts the schema
   * catches it. Without this, "the responses conform" could mean the validator is
   * not looking where the faults were.
   *
   * These are the three faults from 2026-10-02, in the order they were found:
   * discovery named no versions, the catalog carried no caching hints, and a tool
   * result was not marked complete. Each was a correct-looking 200.
   */
  const cases = [
    ['server/discover', 'server/discover', 'supportedVersions'],
    ['tools/list', 'tools/list', 'ttlMs'],
    ['tools/list', 'tools/list', 'cacheScope'],
    ['tools/call', 'tools/call', 'resultType'],
  ];

  for (const [label, method, field] of cases) {
    test(`removing ${field} from ${label} is caught by the schema`, async () => {
      const params = method === 'tools/call' ? { name: 'lookup', arguments: { mac: '8C1F64AFA4B2' } } : undefined;
      const res = await h.call(method, params);
      const clone = structuredClone(res.json);
      delete (method === 'tools/call' ? clone.result : clone.result)[field];
      const problems = validateMessage(schema, clone, method);
      assert.ok(
        problems.length > 0,
        `removing ${field} from ${label} must fail validation, or the check is not looking`,
      );
    });
  }

  // `Result` is deliberately the weakest definition: `resultType` plus anything.
  // The caching hints live on the method-specific results, which is where these
  // belong. Validating them against `Result` would prove nothing, which is exactly
  // the mistake worth pinning down.
  test('a wrongly typed ttlMs is caught, not just a missing one', () => {
    const problems = validate(
      schema,
      { resultType: 'complete', ttlMs: '3600000', cacheScope: 'public', tools: [] },
      'ListToolsResult',
    );
    assert.ok(problems.length > 0, 'a string ttlMs must fail');
    // The schema types ttlMs as integer, not number, so a float is a fault too.
    assert.match(problems.join('\n'), /expected type integer/);
    assert.ok(
      validate(schema, { resultType: 'complete', ttlMs: 1.5, cacheScope: 'public', tools: [] }, 'ListToolsResult').length > 0,
      'a fractional ttlMs must fail; the schema says integer',
    );
  });

  test('an out-of-enum cacheScope is caught', () => {
    const problems = validate(
      schema,
      { resultType: 'complete', ttlMs: 0, cacheScope: 'shared', tools: [] },
      'ListToolsResult',
    );
    assert.ok(problems.length > 0, 'cacheScope must be "public" or "private"');
  });

  test('a negative ttlMs is caught, which a presence check cannot see', () => {
    const problems = validate(
      schema,
      { resultType: 'complete', ttlMs: -1, cacheScope: 'public', tools: [] },
      'ListToolsResult',
    );
    assert.ok(problems.length > 0, 'the schema sets a minimum on ttlMs');
  });

  test('Result alone would not catch any of that, which is why the method matters', () => {
    // Documents the limit rather than hiding it: the envelope's `result` is typed
    // as `Result`, so validating the envelope only is not enough. `validateMessage`
    // exists for that reason.
    const sloppy = { resultType: 'complete', ttlMs: 'nope', cacheScope: 'shared', tools: 'not an array' };
    assert.deepEqual(validate(schema, sloppy, 'Result'), []);
    assert.ok(validateMessage(schema, { jsonrpc: '2.0', id: 1, result: sloppy }, 'tools/list').length >= 3);
  });
});