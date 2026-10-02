/**
 * Live conformance run against the deployed /mcp endpoint.
 *
 *   npm run mcp:conformance
 *
 * The in-process suite in `test/mcp-conformance.test.mjs` proves the generated
 * snippet behaves. This proves the *deployed* snippet behaves, which is a
 * different thing: it catches a zone running a stale Snippet, a rule that lost
 * its host term, a broken rule, or shards that are not on the edge.
 *
 * It sends real requests to production, so it is not part of `npm test`.
 * Everything it does is read-only and public.
 */

import { Mcp2026Client, JSON_RPC, checkToolsListShape } from './mcp-2026-07-28-client.mjs';
import { mcpRuleExpression, MCP_ROUTE, SITE } from '../build/mcp-shards.mjs';

const HOST = new URL(SITE).host;
const URL_UNDER_TEST = `${SITE}${MCP_ROUTE}`;

const results = [];
let failed = 0;

async function check(name, fn) {
  try {
    await fn();
    results.push({ name, ok: true });
    console.log(`  ok    ${name}`);
  } catch (error) {
    failed += 1;
    results.push({ name, ok: false, error: error.message });
    console.log(`  FAIL  ${name}\n        ${String(error.message).split('\n')[0]}`);
  }
}

const assert = (condition, message) => {
  if (!condition) throw new Error(message);
};
const equal = (actual, expected, label) => {
  const a = JSON.stringify(actual);
  const e = JSON.stringify(expected);
  assert(a === e, `${label}: got ${a}, want ${e}`);
};

const client = new Mcp2026Client({ url: URL_UNDER_TEST, clientName: 'mac-conformance-live', clientVersion: '1.0.0' });

console.log(`live conformance against ${URL_UNDER_TEST}\n`);

// ---------------------------------------------------------- reachability

await check('the endpoint is served, not the SPA fallback', async () => {
  const { res } = await client.listTools();
  equal(res.status, 200, 'status');
  assert(res.json?.jsonrpc === '2.0', `expected JSON-RPC, got ${res.text.slice(0, 120)}`);
});

// ---------------------------------------------------------- base protocol

await check('no initialize handshake is required', async () => {
  const { res, tools } = await client.listTools();
  equal(res.status, 200, 'status');
  assert(Array.isArray(tools) && tools.length > 0, 'tools must be a non-empty array');
});

await check('server/discover names the version a stateless client pins', async () => {
  // The field a modern client negotiates from. If it is absent the server still
  // answers 200, and the client fails its own connection with no server-side
  // error to explain it.
  const res = await client.request('server/discover', undefined, 1);
  equal(res.status, 200, 'status');
  const versions = res.json.result.supportedVersions;
  assert(Array.isArray(versions), `supportedVersions must be a list, got ${JSON.stringify(res.json.result)}`);
  assert(versions.includes('2026-07-28'), `must advertise 2026-07-28, got ${JSON.stringify(versions)}`);
  equal(res.json.result._meta['io.modelcontextprotocol/serverInfo'].name, 'mac-address-lookup', 'serverInfo');
  // `equal` compares JSON, so it cannot assert a type. A check written as
  // `equal(ttlMs, typeof ttlMs)` compares 3600000 to "number" and always fails,
  // which is what this did: the value was correct and the assertion was wrong.
  assert(typeof res.json.result.ttlMs === 'number', `ttlMs must be a number, got ${JSON.stringify(res.json.result.ttlMs)}`);
  assert(Number.isInteger(res.json.result.ttlMs) && res.json.result.ttlMs >= 0, 'ttlMs must be an integer >= 0');
  assert(
    ['public', 'private'].includes(res.json.result.cacheScope),
    `cacheScope must be "public" or "private", got ${JSON.stringify(res.json.result.cacheScope)}`,
  );
});

await check('tools/list carries the caching hints a strict validator requires', async () => {
  // A result marked complete MUST carry ttlMs and cacheScope. A strict client
  // rejects the whole result without them, so the symptom is an empty tool list
  // rather than a complaint about the hints.
  const { res } = await client.listTools();
  equal(res.status, 200, 'status');
  const result = res.json.result;
  assert(typeof result.ttlMs === 'number' && result.ttlMs >= 0, `ttlMs must be a number >= 0, got ${result.ttlMs}`);
  assert(['public', 'private'].includes(result.cacheScope), `cacheScope must be public or private, got ${result.cacheScope}`);
});

await check('initialize is answered, so a connector probe gets a 2xx', async () => {
  // A connector UI probes with initialize before it can classify the server. A
  // 400 here reads as an auth challenge, which is what Claude reported. The
  // handshake is answered statelessly: no session, no Mcp-Session-Id.
  const res = await client.request('initialize', { protocolVersion: '2025-06-18', capabilities: {} }, 1);
  equal(res.status, 200, 'status');
  equal(res.json.result.protocolVersion, '2025-06-18', 'negotiated version');
  equal(res.json.result.capabilities.tools.listChanged, false, 'capabilities');
  equal(res.headers.get('mcp-session-id'), null, 'no session may be issued');
});

await check('an unsupported version is refused with -32022 and a supported list', async () => {
  const res = await client.request('tools/list', undefined, 1, { 'MCP-Protocol-Version': '1999-01-01' });
  equal(res.status, 400, 'status');
  equal(res.json.error.code, -32022, 'error code');
  assert(res.json.error.data.supported.includes('2026-07-28'), 'must advertise 2026-07-28');
});

await check('a 2025-era client is served, not turned away', async () => {
  const res = await client.request('tools/list', undefined, 1, { 'MCP-Protocol-Version': '2025-06-18' });
  equal(res.status, 200, 'status');
  assert(Array.isArray(res.json.result.tools), 'tools must be listed');
});

await check('the id is echoed with its type preserved', async () => {
  for (const id of [1, 'live-string', 999999]) {
    const res = await client.request('tools/list', undefined, id);
    equal(res.json.id, id, 'id');
  }
});

await check('a notification gets 202 and no body', async () => {
  const res = await client.notify('tools/call', { name: 'lookup', arguments: { mac: '8C1F64AFA4B2' } });
  equal(res.status, 202, 'status');
  equal(res.text, '', 'body');
});

await check('GET is refused with 405 and an Allow header', async () => {
  const res = await client.raw('GET');
  equal(res.status, 405, 'status');
  assert(/POST/.test(String(res.headers.get('allow'))), 'Allow must advertise POST');
});

await check('a tool call result carries resultType, as the strict validator requires', async () => {
  // A strict 2026-07-28 client rejects the whole result without this field and
  // reports "missing required resultType". It failed here in BOTH playground
  // modes, because the per-request endpoints re-detect and our discover
  // advertises 2026-07-28, so "stateful" was not testing the lenient path.
  const res = await client.callTool('lookup', { mac: '8C:1F:64:AF:A4:B2' });
  equal(res.status, 200, 'status');
  equal(res.json.result.resultType, 'complete', 'resultType');
  assert(
    typeof res.json.result.structuredContent?.orgName === 'string',
    'the vendor must survive validation, or the fix only moved the error',
  );
});

await check('an unmatched address is also marked complete', async () => {
  // The miss path is the easier one to break: it is the branch with no vendor in
  // it, and a strict client would discard it exactly the same way.
  const res = await client.callTool('lookup', { mac: '02:00:00:00:00:01' });
  equal(res.status, 200, 'status');
  equal(res.json.result.resultType, 'complete', 'resultType');
  equal(res.json.result.structuredContent.orgName, null, 'no vendor, and it says so');
});

await check('bad arguments get INVALID_PARAMS', async () => {
  const res = await client.callTool('lookup', { mac: 'nope' });
  equal(res.json.error.code, JSON_RPC.INVALID_PARAMS, 'error code');
});

// ---------------------------------------------------------- tools/list

await check('tools/list satisfies the official suite structural requirements', async () => {
  const { tools } = await client.listTools();
  const problems = checkToolsListShape({ tools });
  assert(problems.length === 0, `structural problems: ${problems.join('; ')}`);
});

// ---------------------------------------------------------- lookup behaviour

const CASES = [
  ['8C:1F:64:AF:A4:B2', '8C1F64AFA', 'DATA ELECTRONIC DEVICES, INC', 'MA-S'],
  ['00:1B:21:3C:4D:5E', '001B21', 'Intel Corporate', 'MA-L'],
  // 0050C2000 is a real IAB record, and 0050 is one of the three buckets the
  // build carves to depth 6 because its records all share one 6-char prefix.
  // This is the deepest path in the design and the easiest to get wrong.
  ['00:50:C2:00:00:01', '0050C2000', null, 'IAB'],
  ['01:00:5E:00:00:01', null, null, null],
  ['8C1F64', '8C1F64', null, 'MA-L'],
];

for (const [mac, prefix, orgName, blockType] of CASES) {
  await check(`lookup ${mac} resolves to ${prefix ?? 'no match'}`, async () => {
    const res = await client.callTool('lookup', { mac });
    equal(res.status, 200, 'status');
    const s = res.json.result.structuredContent;
    equal(s.prefix, prefix, 'prefix');
    if (blockType) equal(s.blockType, blockType, 'blockType');
    if (orgName) equal(s.orgName, orgName, 'orgName');
    // A match must link a record page; a miss must not link one.
    if (prefix) assert(new RegExp(`^${SITE}/${prefix}$`).test(s.url), `url was ${s.url}`);
    else assert(!new RegExp(`^${SITE}/[0-9A-F]{6,}$`).test(s.url), `a miss must not link a page, got ${s.url}`);
  });
}

await check('a randomized address is explained, not just empty', async () => {
  const res = await client.callTool('lookup', { mac: '02:11:22:33:44:55' });
  const s = res.json.result.structuredContent;
  equal(s.locallyAdministered, true, 'locallyAdministered');
  assert(/randomized|locally administered/i.test(res.json.result.content[0].text), 'text must explain why');
});

await check('every separator form gives the same answer', async () => {
  const seen = new Set();
  for (const form of ['8C:1F:64:AF:A4:B2', '8c-1f-64-af-a4-b2', '8c1f.64af.a4b2', '8C1F64AFA4B2']) {
    const res = await client.callTool('lookup', { mac: form });
    seen.add(res.json.result.structuredContent.prefix);
  }
  equal([...seen], ['8C1F64AFA'], 'distinct prefixes');
});

await check('the deepest registered prefix wins over its parent', async () => {
  // 8C1F64 (MA-L) contains 8C1F64AFA (MA-S). The MA-S must win, or a device
  // inside the small block would be attributed to the wrong organisation.
  const deep = await client.callTool('lookup', { mac: '8C:1F:64:AF:A4:B2' });
  equal(deep.json.result.structuredContent.prefix, '8C1F64AFA', 'nested address');
  const shallow = await client.callTool('lookup', { mac: '8C:1F:64' });
  equal(shallow.json.result.structuredContent.prefix, '8C1F64', 'parent address');
});

// ---------------------------------------------------------- transport scoping

await check('the rule expression is host-scoped, as installed', () => {
  const expression = mcpRuleExpression();
  assert(expression.includes('http.host eq'), `expression lost its host term: ${expression}`);
  assert(expression.includes(`"${HOST}"`), `expression does not name ${HOST}: ${expression}`);
  assert(expression.includes(`"${MCP_ROUTE}"`), `expression does not name ${MCP_ROUTE}: ${expression}`);
});

await check('the trailing-slash path reaches the endpoint, as installed', async () => {
  // Clients disagree on whether to send /mcp or /mcp/. Both must be routed to
  // the snippet. When only /mcp is in the rule, a POST to /mcp/ does not run the
  // snippet at all: it falls through to the assets-only Worker, and Static
  // Assets serves GET and HEAD only, so the POST returns 405 with an empty body.
  // Glama's MCP Inspector Online hit exactly that.
  //
  // Assert on the body, not on a header. The snippet sets no `mcp-protocol-version`
  // response header; that name only appears inside access-control-expose-headers.
  // The body is the sound discriminator, because the one thing the fallbacks
  // cannot produce is a JSON-RPC result carrying the tool: Static Assets answers
  // a POST with 405 and no body, and the SPA fallback answers with HTML.
  const response = await fetch(`${SITE}${MCP_ROUTE}/`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', accept: 'application/json' },
    body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/list' }),
  });
  equal(response.status, 200, 'trailing-slash POST status');
  assert(
    /^application\/json/i.test(response.headers.get('content-type') || ''),
    `trailing-slash POST content-type was ${response.headers.get('content-type')}, ` +
      'which means the SPA fallback answered instead of the snippet',
  );
  const body = await response.json();
  equal(body.id, 1, 'trailing-slash JSON-RPC id');
  equal(body.result?.tools?.[0]?.name, 'lookup', 'trailing-slash tools/list payload');
});

await check('the routed shard is on the edge, as text/plain', async () => {
  // The routed key follows the depth table. 8C1F is carved to depth 6, and
  // '8C1F64AFA'.slice(0, 6) is '8C1F64', so that is the file the snippet reads.
  // Status alone is not a valid check here: the site sets
  // not_found_handling to single-page-application, so a missing path returns 200
  // with the SPA shell. The content type is the real signal.
  const response = await fetch(`${SITE}/data/mcp/8c1f64.txt`, { headers: { accept: 'text/plain' } });
  equal(response.status, 200, 'shard status');
  assert(
    /^text\/plain/i.test(response.headers.get('content-type') || ''),
    `shard content-type was ${response.headers.get('content-type')}, which means the SPA fallback answered`,
  );
  const text = await response.text();
  assert(text.includes('8C1F64AFA|'), 'shard is missing the expected record');
});

await check('an unrouted key returns the SPA shell, not a shard', async () => {
  // Proves the check above is meaningful: the fallback really does answer 200,
  // so a status-only assertion would have passed on a broken deploy.
  const response = await fetch(`${SITE}/data/mcp/8c1f.txt`, { headers: { accept: 'text/plain' } });
  equal(response.status, 200, 'fallback status');
  assert(
    /^text\/html/i.test(response.headers.get('content-type') || ''),
    `expected the SPA shell, got ${response.headers.get('content-type')}`,
  );
});

// ---------------------------------------------------------------- summary

const total = results.length;
console.log(`\n${total - failed}/${total} passed`);
if (failed > 0) {
  console.log('\nfailures:');
  for (const r of results.filter((x) => !x.ok)) console.log(`  - ${r.name}: ${r.error}`);
  process.exit(1);
}
console.log(`\nThe deployed endpoint conforms on every check in this suite.`);
console.log('This suite is derived from the 2026-07-28 spec, not the official');
console.log('conformance runner, which does not yet accept that version. See');
console.log('test/mcp-2026-07-28-client.mjs.');
