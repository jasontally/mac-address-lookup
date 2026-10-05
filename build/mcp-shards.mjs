/**
 * MCP lookup shards for the stateless MCP endpoint.
 *
 * The agent-facing `.txt` surface (variable-length trie keys plus an
 * `index.txt`) needed a model to run two longest-prefix searches over free
 * text: pick the longest key in the index, then pick the longest row in the
 * shard. Models are bad at that. The MCP endpoint removes the step instead of
 * simplifying it: the model calls one `lookup` tool, and the edge snippet
 * normalizes the address and does the longest-prefix match in code.
 *
 * Layout. A MAC is 48 bits, and the IEEE registries only ever register
 * assignments of 6, 7, or 9 hex characters, so a query's candidate prefixes are
 * only its own first 6, 7, and 9 characters. That has one strong consequence:
 *
 *   Splitting a bucket at depth d is lossless if and only if d <= 6.
 *
 * A record of length L is keyed by its first min(L, d) characters, and the
 * snippet fetches the query's first d characters. Those agree exactly when
 * L >= d, so as long as d is no deeper than the shortest registered prefix
 * (6, MA-L), one fetch is guaranteed to carry every candidate. Going deeper
 * than 6 silently drops the 6-character parents, which is why the planner
 * treats 6 as a ceiling rather than a target.
 *
 * The build uses depth 4 as the base. Depth 4 gives 13,816 files, which fits the
 * main project's file budget, and it needs one subrequest instead of the two a
 * per-prefix layout costs. Three dense clusters (the IAB and MA-S blocks under
 * 0050C2, 70B3D, and 8C1F64) hold thousands of records that all share one
 * 6-character prefix, so no prefix key splits them below ~174 KB. They are
 * carved to depth 6, which is the most the ceiling allows, and a 28-byte depth
 * table inlined in the snippet routes to them. The other 99% of files are
 * under 1 KB.
 *
 * Shard lines are pipe-delimited with the organization name last, so the
 * snippet splits a line with four `indexOf` calls and never calls
 * `JSON.parse` on shard data. The organization address stays out of the shards;
 * the record page carries it, and the snippet links that page.
 */

import { mkdir, writeFile, rm, stat } from 'node:fs/promises';
import path from 'node:path';

/** Public origin. Also used to build record page URLs; must match agent-files.mjs. */
export const SITE = 'https://mac.jasontally.com';

/** Path the snippet serves MCP on. Must not collide with an asset route. */
export const MCP_ROUTE = '/mcp';

/**
 * Protocol versions the endpoint serves, newest first.
 *
 * 2026-07-28 is the only modern revision, so it is the one a stateless client
 * pins. The two 2025 dates are legacy handshake revisions, served by the same
 * one-fetch handler.
 *
 * The list is declared here, not inside the snippet, because it is published in
 * two places that must agree: the guard the snippet runs on every request, and
 * `supportedVersions` in the `server/discover` result. A modern client reads
 * discover first and then claims one of the versions it names, so advertising a
 * version the guard refuses is a dead end, and advertising too few hides a
 * version the endpoint does serve.
 */
export const MCP_PROTOCOL_VERSION = '2026-07-28';
export const MCP_SUPPORTED_VERSIONS = [MCP_PROTOCOL_VERSION, '2025-11-25', '2025-06-18'];

/**
 * How long a client may treat the tool catalog as fresh, in milliseconds.
 *
 * One hour. The catalog only changes when the build deploys, and it is 3 KB, so
 * a client that re-fetches hourly pays nothing. A shorter value would also work;
 * a longer one would keep a changed tool list alive in client caches for longer
 * than the deploy that changed it deserves.
 */
const CATALOG_TTL_MS = 60 * 60 * 1000;

/**
 * The exact Snippet rule expression this module expects to be installed.
 *
 * Scoping by host is not optional. A Snippet rule is zone-wide, so a bare
 * `http.request.uri.path eq "/mcp"` fires on every subdomain in the zone. The
 * snippet resolves its shard fetch against the incoming request's own host, so
 * on the wrong hostname it would look for `/data/mcp/...` on a host that does
 * not serve them, get 404 for every key, and answer "no vendor" for every
 * address. That is a silent wrong answer, so the rule must name the host.
 *
 * `http.host` is the right field: the Cloudflare docs note it holds the `Host`
 * header from the original client request and is not rewritten by Origin Rules.
 *
 * Both `${route}` and `${route}/` must match, because clients normalise the
 * trailing slash and not all of them agree. An exact `eq "/mcp"` misses the
 * `/mcp/` form, and the failure is silent and confusing: the Snippet never runs,
 * the assets-only Worker answers instead, and Workers Static Assets serves only
 * GET and HEAD, so the POST comes back `405` with an empty body and no MCP
 * headers. Glama's MCP Inspector Online does exactly this. Do not "simplify"
 * this back to one path. A redirect is not a fix either: the Streamable HTTP
 * transport must not depend on a client re-POSTing after a 307.
 *
 * Exported so the build, the generated snippet's header comment, and
 * `build/deploy-mcp-snippet.mjs` all render the same string. Do not retype it.
 */
export function mcpRuleExpression({ site = SITE, route = MCP_ROUTE } = {}) {
  const host = new URL(site).host;
  const pathTerm = `(http.request.uri.path eq "${route}" or http.request.uri.path eq "${route}/")`;
  return `(http.host eq "${host}" and ${pathTerm})`;
}

/** Absolute path, inside the site, holding the shard files. */
export const MCP_SHARD_PATH = '/data/mcp';

/**
 * Shortest registered prefix, in hex characters. MA-L is 6; MA-M, MA-S, and IAB
 * assign 7 and 9. This is the ceiling on shard depth: see the losslessness
 * argument in the file header.
 */
export const SHARD_MIN_PREFIX_LENGTH = 6;

/** Base shard key length, in hex characters. */
export const SHARD_BASE_DEPTH = 4;

/**
 * Deepest key the planner will carve. Equal to the lossless ceiling on purpose:
 * a `maxDepth` above `SHARD_MIN_PREFIX_LENGTH` would be correct-looking and
 * wrong, so `planShards` refuses it.
 */
export const SHARD_MAX_DEPTH = SHARD_MIN_PREFIX_LENGTH;

/**
 * Target size for one shard, in bytes. 30 KB keeps a shard readable by a small
 * model context, for the clients that cannot speak MCP and read shards directly.
 */
export const SHARD_TARGET_BYTES = 30 * 1024;

/**
 * Hard ceiling on one shard. Three files exceed the target and cannot be split
 * further by prefix. They must stay clear of the snippet's 2 MB memory and 5 ms
 * budgets; a 174 KB scan measures 0.42 ms.
 */
export const SHARD_HARD_MAX_BYTES = 256 * 1024;

/**
 * How many files may exceed the target. Each is a dense cluster whose records
 * share one 6-character prefix, so the count only grows if the registry adds
 * whole new clusters. The build fails if it grows unexpectedly.
 */
export const SHARD_MAX_OVERSIZE = 3;

/** Placeholder for a record with no registration country. */
const NO_COUNTRY = '-';

/**
 * One shard line: `prefix|blockType|addressCount|country|orgName`.
 *
 * The organization name is last and unescaped on purpose. It is the only free
 * text field, and a reader that takes the remainder of the line after the
 * fourth separator handles a name containing a pipe without escaping.
 */
function shardLine(record) {
  return `${record.prefix}|${record.blockType}|${record.addressCount}|${record.country || NO_COUNTRY}|${record.orgName}`;
}

/** Render rows as shard text. */
function shardText(rows) {
  return rows.length === 0 ? '' : `${rows.map(shardLine).join('\n')}\n`;
}

/** Group records by the first `depth` hex characters of their prefix. */
function groupByPrefix(rows, depth) {
  const groups = new Map();
  for (const record of rows) {
    const key = record.prefix.slice(0, depth);
    let list = groups.get(key);
    if (!list) {
      list = [];
      groups.set(key, list);
    }
    list.push(record);
  }
  return groups;
}

/** Largest rendered group, in bytes. Drives the depth decision. */
function largestGroupBytes(groups) {
  let largest = 0;
  for (const rows of groups.values()) {
    const size = shardText(rows).length;
    if (size > largest) largest = size;
  }
  return largest;
}

/**
 * Plan the shard layout.
 *
 * Every base bucket starts at `SHARD_BASE_DEPTH` and deepens one character at a
 * time until its largest sub-file fits `targetBytes`, never past `maxDepth`.
 * Returns the file list and the base-key to depth table the snippet needs in
 * order to route in one fetch.
 */
export function planShards(
  records,
  { baseDepth = SHARD_BASE_DEPTH, targetBytes = SHARD_TARGET_BYTES, maxDepth = SHARD_MAX_DEPTH } = {},
) {
  if (maxDepth > SHARD_MIN_PREFIX_LENGTH) {
    throw new Error(
      `maxDepth ${maxDepth} is past the lossless ceiling ${SHARD_MIN_PREFIX_LENGTH}; ` +
        'a deeper key silently drops the 6-character MA-L parents',
    );
  }

  const buckets = groupByPrefix(records, baseDepth);
  const table = {};
  const shards = [];

  for (const key of [...buckets.keys()].sort()) {
    const rows = buckets.get(key);
    let depth = baseDepth;
    let groups = groupByPrefix(rows, depth);
    while (largestGroupBytes(groups) > targetBytes && depth < maxDepth) {
      depth += 1;
      groups = groupByPrefix(rows, depth);
    }
    if (depth !== baseDepth) table[key] = depth;
    for (const subKey of [...groups.keys()].sort()) {
      const group = groups.get(subKey);
      shards.push({ key: subKey.toLowerCase(), depth, rows: group.length, text: shardText(group) });
    }
  }

  return { table, shards };
}

/** Summarize a plan for the build log and for tests. */
export function shardStats({ shards, table }, { targetBytes = SHARD_TARGET_BYTES } = {}) {
  const sizes = shards.map((shard) => Buffer.byteLength(shard.text)).sort((a, b) => a - b);
  const at = (q) => sizes[Math.min(sizes.length - 1, Math.floor(sizes.length * q))];
  return {
    files: shards.length,
    overrides: Object.keys(table).length,
    tableBytes: Buffer.byteLength(JSON.stringify(table)),
    minBytes: sizes[0] ?? 0,
    medianBytes: at(0.5),
    p99Bytes: at(0.99),
    maxBytes: sizes.at(-1) ?? 0,
    totalBytes: sizes.reduce((a, b) => a + b, 0),
    overTarget: sizes.filter((size) => size > targetBytes).length,
  };
}

/**
 * The pre-generated tool catalog the snippet serves for `tools/list` and
 * `server/discover`. One object serves both calls: the endpoint is public and
 * read-only, so the extra fields are harmless and save a second file.
 *
 * It has to be the union of the two result shapes, not just the tool list.
 * `server/discover` returns a `DiscoverResult`, and the one field a stateless
 * client cannot do without is `supportedVersions`. A legacy client never looks
 * at it: it handshakes, and reads the version from the initialize reply. So the
 * endpoint connected fine from a stateful test tool while every stateless tool
 * failed to negotiate, with no error from the server to explain it.
 */
export function methodCatalog({ site = SITE } = {}) {
  const inputSchema = {
    type: 'object',
    properties: {
      mac: {
        type: 'string',
        description:
          'MAC address or OUI prefix, 6 to 12 hex characters. Accepts colon, hyphen, Cisco dot, or plain hex, for example 8C:1F:64:AF:A4:B2 or 8C1F64.',
      },
    },
    required: ['mac'],
    additionalProperties: false,
  };
  const tool = {
    name: 'lookup',
    title: 'Look up a MAC address or OUI prefix',
    description:
      'Resolve a MAC address or OUI prefix to its registered organization using longest-prefix match across the MA-L, MA-M, MA-S, IAB, and CID registries. Reports the block type, address count, registration country, and a link to the full record page. Randomized and locally administered addresses usually have no registered organization.',
    inputSchema,
    outputSchema: {
      type: 'object',
      properties: {
        query: { type: 'string', description: 'The normalized query, colon-separated.' },
        prefix: { type: ['string', 'null'], description: 'Longest registered prefix that matched.' },
        blockType: { type: ['string', 'null'], description: 'MA-L, MA-M, MA-S, IAB, or CID.' },
        addressCount: { type: ['number', 'null'], description: 'Addresses in the matched block.' },
        orgName: { type: ['string', 'null'], description: 'Registered organization name.' },
        country: { type: ['string', 'null'], description: 'ISO 3166-1 alpha-2 registration country.' },
        // The bit pattern marks the address locally administered, which usually means a randomized or virtual-machine address.
        locallyAdministered: {
          type: 'boolean',
          description: 'The bit pattern marks the address locally administered, which usually means a randomized or virtual-machine address.',
        },
        multicast: {
          type: 'boolean',
          description: 'The bit pattern marks the address a multicast group.',
        },
        url: { type: 'string', description: `Record page on ${site}.` },
      },
      required: ['query', 'prefix', 'url'],
    },
    annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
  };
  // The identity fields sit at the top level as well, because a 2025-era
  // client reads them from an initialize result, and this one object answers
  // both.
  const serverInfo = { name: 'mac-address-lookup', title: 'MAC Address Lookup', version: '1.0.0' };
  return {
    resultType: 'complete',
    // A result marked "complete" MUST carry caching hints. The specification
    // says so directly: servers MUST include `ttlMs` and `cacheScope` on
    // results with `resultType: "complete"` from server/discover and every
    // list call. Marking the result complete is what makes them mandatory, so
    // these two lines are not optional extras.
    //
    // A strict client validator rejects the WHOLE result when they are missing,
    // so the symptom is not "the hints are absent" but "the server has no
    // tools": the tool list it did receive was thrown away with the rest. That
    // is what happened here, and it is silent on the server, because the
    // response is a perfectly good 200.
    ttlMs: CATALOG_TTL_MS,
    // The tool list is the same for every caller, so a shared cache may hold
    // it. `resources/read` is the case that wants "private".
    cacheScope: 'public',
    // The DiscoverResult field a stateless client reads to pick a version. A
    // client that pins 2026-07-28 and finds no `supportedVersions` has nothing
    // to negotiate against and reports a version negotiation failure, so this
    // field is what makes the endpoint connectable without a handshake.
    supportedVersions: MCP_SUPPORTED_VERSIONS,
    name: serverInfo.name,
    title: serverInfo.title,
    version: serverInfo.version,
    websiteUrl: site,
    instructions: `Public, read-only MAC address and OUI lookup derived from the IEEE Registration Authority registries. Call lookup once per address. The record page at the returned url carries the organization address, the block range, and ownership history. See ${site}/help for block types and how to read your own MAC address.`,
    capabilities: { tools: { listChanged: false } },
    tools: [tool],
    // Where the modern spec puts the identity. A legacy client reads the fields
    // above; a modern client reads this.
    _meta: { 'io.modelcontextprotocol/serverInfo': serverInfo },
  };
}

/**
 * Render the edge snippet.
 *
 * The build emits this file so the snippet is reviewable in the repo and stays
 * reproducible from the same data as the shards. There is no routing table to
 * inline, because the shard keys fall out of the query.
 */
export function renderSnippet(
  table,
  { site = SITE, route = MCP_ROUTE, shardPath = MCP_SHARD_PATH, baseDepth = SHARD_BASE_DEPTH } = {},
) {
  const expression = mcpRuleExpression({ site, route });
  return `/**
 * Stateless MCP endpoint for ${site}
 *
 * GENERATED by build/mcp-shards.mjs. Do not edit by hand; edit the generator
 * and rebuild. Deploy this file as a Cloudflare Snippet on the zone with a rule
 * whose filter expression is exactly:
 *
 *   ${expression}
 *
 * The host is in the expression on purpose. A Snippet rule is zone-wide, so a
 * path-only rule also fires on every other subdomain, where the shard fetch
 * below would 404 and every lookup would report no vendor. The HOST check in
 * the handler is the second line of defence for the same mistake.
 *
 * One tool, \`lookup\`. The model never reads a shard and never picks a key:
 * this snippet normalizes the address, fetches the one shard that can hold the
 * answer, and does the longest-prefix match in code. One subrequest per lookup.
 *
 * No depth in DEPTH exceeds ${SHARD_MIN_PREFIX_LENGTH}, the shortest registered prefix, so a single
 * fetch always carries every candidate prefix. Do not deepen it: a deeper key
 * drops the 6-character MA-L parents and the lookup silently returns no match.
 *
 * Snippet limits: 5 ms execution, 2 MB memory, 32 KB package. No bindings, no
 * storage, no logs.
 */

// Base shard key length in hex characters, and how much deeper the build had to
// carve the dense ranges. Keys are uppercase, matching the normalized query.
const BASE_DEPTH = ${baseDepth};
const DEPTH = ${JSON.stringify(table)};

const HOST = ${JSON.stringify(new URL(site).host)};
const SITE = ${JSON.stringify(site)};
const SHARD_PATH = ${JSON.stringify(shardPath)};
const CATALOG = SHARD_PATH + '/catalog.json';
const HEX = /^[0-9A-F]+$/;
const NO_COUNTRY = ${JSON.stringify(NO_COUNTRY)};

function headers(extra) {
  return Object.assign(
    {
      'content-type': 'application/json; charset=utf-8',
      'access-control-allow-origin': '*',
      'access-control-allow-methods': 'POST, GET, OPTIONS',
      'access-control-allow-headers':
        'content-type, accept, authorization, mcp-protocol-version, mcp-method, mcp-name, mcp-session-id',
      'access-control-expose-headers': 'mcp-protocol-version, mcp-session-id',
      'cache-control': 'no-store',
    },
    extra || {},
  );
}

/**
 * Wrap a result and mark it complete.
 *
 * This lives inside the snippet template literal, so backticks have to be
 * escaped here or they close the template early. The emitted snippet carries
 * plain backticks.
 *
 * 2026-07-28 requires \`resultType\` on every result, and the defaulting bridge
 * that treats an absent value as complete applies only to servers on earlier
 * revisions. A strict client therefore rejects the whole result when it is
 * missing, which for a tool call means the answer is discarded even though the
 * lookup was right.
 *
 * It is set here, in the one function every result goes through, rather than at
 * each call site. That is deliberate: the two bugs in a row came from adding a
 * field at some call sites and forgetting the others. A new method cannot ship a
 * result without it.
 *
 * An explicit \`resultType\` still wins, so a caller that returns an interim
 * result such as \`input_required\` is not overridden.
 */
function rpcResult(id, result) {
  const marked = result && typeof result === 'object' && 'resultType' in result
    ? result
    : { resultType: 'complete', ...result };
  return new Response(JSON.stringify({ jsonrpc: '2.0', id: id === undefined ? null : id, result: marked }), {
    status: 200,
    headers: headers(),
  });
}

function rpcError(id, code, message, status) {
  return new Response(
    JSON.stringify({ jsonrpc: '2.0', id: id === undefined ? null : id, error: { code, message } }),
    { status: status || 400, headers: headers() },
  );
}

/**
 * Answer a GET with an SSE stream that opens and immediately closes.
 *
 * Why this exists. 2026-07-28 removed the standalone GET stream, and the
 * specification says a server that serves only this revision SHOULD answer such
 * a request with 405. SHOULD is not MUST (RFC 2119 section 3), and no MUST
 * forbids the stream, so serving it is permitted. It is served here because a
 * connector that probes the old transport treats a 405 as a fatal error rather
 * than as the era signal it is: one such client discovered the tool list over
 * POST, then failed at call time on "MCP SSE probe returned 405".
 *
 * The one thing this must never do is send an \`endpoint\` event. The
 * specification's own detection algorithm says a client that receives one
 * concludes the server runs the old HTTP+SSE transport and uses that transport
 * for all later communication -- which is worse than the 405, because the old
 * transport POSTs without the modern routing headers and this server refuses
 * them with -32602. A comment line carries no event, so a conforming client
 * waits for \`endpoint\`, never sees it, and stays on the modern path.
 *
 * A comment is the correct payload and not a placeholder: per the SSE
 * specification, a line beginning with a colon carries no event data, and
 * clients must ignore such lines rather than treat them as malformed.
 *
 * \`X-Accel-Buffering: no\` is what the specification asks for on an SSE response.
 *
 * Cost. One response with no subrequest and no allocation beyond the headers. The
 * stream closes immediately rather than being held open, because a Snippet has a
 * 5 ms budget and this endpoint has no server-initiated messages to deliver, so
 * an open stream would occupy an invocation to send nothing.
 *
 * Ceiling. This satisfies a client that probes and checks the status. A client
 * that requires a *long-lived* stream and sends on it is not supported; that
 * would need the retired transport rebuilt properly, in a budget that cannot
 * hold an open connection.
 */
function sseProbe() {
  return new Response(':ok\\n\\n', {
    status: 200,
    headers: headers({
      'content-type': 'text/event-stream; charset=utf-8',
      'cache-control': 'no-store',
      'x-accel-buffering': 'no',
    }),
  });
}

/** Uppercase hex to colon-separated octets. Mirrors src/ui/format.mjs. */
function colonize(hex) {
  return hex.match(/.{1,2}/g).join(':');
}

/** Take the first \`count\` pipe-separated fields; the remainder is the org name. */
function splitLine(line, count) {
  const fields = [];
  let rest = line;
  for (let i = 0; i < count; i += 1) {
    const at = rest.indexOf('|');
    if (at === -1) {
      fields.push(rest);
      rest = '';
      continue;
    }
    fields.push(rest.slice(0, at));
    rest = rest.slice(at + 1);
  }
  fields.push(rest);
  return fields;
}

/** Fetch one shard or the catalog. GET, so the zone rule cannot re-enter. */
function pull(url) {
  return fetch(new Request(url.toString(), { method: 'GET', headers: { accept: 'application/json, text/plain' } }));
}

/**
 * Read a shard body, or return null when there is nothing to read.
 *
 * The site sets \`not_found_handling: "single-page-application"\`, so Cloudflare
 * answers *any* unmatched path with HTTP 200 and the SPA shell as text/html. A
 * \`response.ok\` test is therefore not enough: scanning the SPA shell for
 * pipe-delimited lines finds nothing, and an unguarded scan would read an HTML
 * page as an empty shard. So require the content type, then a record line.
 *
 * Null is NOT treated as a deployment fault, because an empty bucket and a
 * missing bucket are indistinguishable from here, and empty buckets are the
 * common case: 13,571 of the 65,536 possible 4-character keys have records, so
 * 79.3% of them are empty. Raising an error instead would turn most
 * unregistered lookups into 5xx. A null shard means "no registered prefix in
 * this range", which is the honest reading.
 *
 * The whole-deploy case is caught by the catalog instead, which is a single
 * file: if catalog.json will not load, nothing was deployed, and
 * tools/list fails loudly instead of reporting an empty tool list.
 */
async function readShard(response) {
  if (!response.ok) return null;
  if (!/^text\\/plain/i.test(response.headers.get('content-type') || '')) return null;
  const text = await response.text();
  return text.indexOf('|') === -1 ? null : text;
}

/** Longest registered prefix of \`hex\` in one shard body. */
function longestMatch(hex, text) {
  let best = null;
  let bestPrefix = '';
  if (!text) return null;
  for (const line of text.split('\\n')) {
    const stop = line.indexOf('|');
    if (stop === -1) continue;
    const prefix = line.slice(0, stop);
    if (prefix.length <= bestPrefix.length || !hex.startsWith(prefix)) continue;
    bestPrefix = prefix;
    best = line;
  }
  return best === null ? null : { prefix: bestPrefix, line: best };
}

async function lookup(request, payload, id) {
  const args = (payload.params && payload.params.arguments) || {};
  const raw = args.mac;
  // Mirrors src/engine/input.mjs: strip separators, uppercase, 6-12 hex only.
  const hex = String(raw === undefined || raw === null ? '' : raw)
    .replace(/[\\s:.-]/g, '')
    .toUpperCase();
  if (hex.length < ${SHARD_MIN_PREFIX_LENGTH}) {
    return rpcError(id, -32602, 'Invalid argument "mac": need at least ${SHARD_MIN_PREFIX_LENGTH} hex characters.');
  }
  if (hex.length > 12) {
    return rpcError(id, -32602, 'Invalid argument "mac": at most 12 hex characters.');
  }
  if (!HEX.test(hex)) {
    return rpcError(id, -32602, 'Invalid argument "mac": not hexadecimal.');
  }

  // One shard holds every candidate prefix, because the routed depth never
  // exceeds the shortest registered prefix.
  const depth = DEPTH[hex.slice(0, BASE_DEPTH)] || BASE_DEPTH;
  const key = hex.slice(0, depth).toLowerCase();
  const body = await readShard(await pull(new URL(SHARD_PATH + '/' + key + '.txt', request.url)));
  const match = longestMatch(hex, body ?? '');

  const query = colonize(hex);
  const first = parseInt(hex.slice(0, 2), 16);
  const local = (first & 0b10) === 2;
  const multicast = (first & 0b1) === 1;

  if (match === null) {
    const why = local
      ? 'no registered prefix covers it; this address is locally administered, which usually means a randomized or virtual-machine address'
      : 'no registered prefix covers it';
    return rpcResult(id, {
      content: [{ type: 'text', text: query + ' - ' + why + '. Randomized addresses have no vendor. See ' + SITE + '/help for block types.' }],
      structuredContent: {
        query,
        prefix: null,
        blockType: null,
        addressCount: null,
        orgName: null,
        country: null,
        locallyAdministered: local,
        multicast,
        url: SITE + '/help',
      },
    });
  }

  const { prefix, line } = match;
  const fields = splitLine(line, 4);
  const blockType = fields[1];
  const addressCount = Number(fields[2]);
  const country = fields[3] === NO_COUNTRY ? null : fields[3];
  const orgName = fields[4];
  const page = SITE + '/' + prefix;

  return rpcResult(id, {
    content: [
      {
        type: 'text',
        text:
          query + ' is inside ' + prefix + ', an ' + blockType + ' block of ' +
          addressCount.toLocaleString('en-US') + ' addresses' +
          (country ? ' registered in ' + country : '') + ', held by ' + orgName +
          '. Full record, including the organization address: ' + page,
      },
    ],
    structuredContent: { query, prefix, blockType, addressCount, orgName, country, locallyAdministered: local, multicast, url: page },
  });
}

/**
 * Protocol version this server speaks, and the only one it speaks.
 *
 * ${MCP_PROTOCOL_VERSION} only. There is no legacy lane, so the version has to be stated
 * rather than negotiated down.
 */
const PROTOCOL_VERSION = '${MCP_PROTOCOL_VERSION}';

/**
 * Versions this endpoint can serve statelessly. Each is a *request* contract,
 * not a session contract: the same one-fetch handler serves all of them, and
 * none of them gets a Mcp-Session-Id. The handshake is accepted so a client
 * whose connection flow probes with initialize is not turned away.
 */
const LEGACY_HANDSHAKE = true;
const SUPPORTED_VERSIONS = ${JSON.stringify(MCP_SUPPORTED_VERSIONS)};

/**
 * HTTP status for a method this server does not implement.
 *
 * The specification is unambiguous: "If the server does not implement the
 * requested RPC method, it MUST respond with 404 Not Found and a JSON-RPC error
 * with code -32601." A 400 is what a malformed request earns, and it is also
 * what an unsupported protocol version earns, so using it for an unknown method
 * makes three different faults indistinguishable to a client deciding whether
 * to fix the request, change version, or give up.
 */
const METHOD_NOT_FOUND_STATUS = 404;

/**
 * Error code for a header that disagrees with the body.
 *
 * Reserved by the specification for exactly this: "The HTTP headers do not match
 * the corresponding values in the request body, or required headers are
 * missing/malformed."
 */
const HEADER_MISMATCH = -32020;

/** Read a header, trimming the optional whitespace RFC 9110 allows around a field value. */
function headerValue(request, name) {
  const raw = request.headers.get(name);
  return raw === null ? null : raw.trim();
}

/**
 * Decode a header value that uses the Base64 sentinel, per Value Encoding.
 *
 * A name with surrounding spaces is not a legal plain field value, so a
 * conforming client sends the sentinel form instead. Comparing the encoded
 * form against the body value would report a mismatch on a correct request,
 * which is the one failure mode header validation must not have. Tool names
 * here are ASCII, so there is nothing else to handle.
 */
function decodeHeaderValue(value) {
  if (value === null) return null;
  if (value.startsWith('=?base64?') && value.endsWith('?=')) {
    const encoded = value.slice(9, -2);
    try {
      return atob(encoded);
    } catch {
      return value;
    }
  }
  return value;
}
/**
 * Largest request body the endpoint will read.
 *
 * A tools/call is ~110 bytes and tools/list is ~30, so this is generous by two
 * orders of magnitude while keeping the worst case small enough to parse inside
 * the snippet memory budget. See the guard at the parse site.
 */
const MAX_BODY_BYTES = 4096;
const SERVER_NAME = 'mac-address-lookup';
const SERVER_TITLE = 'MAC Address Lookup';
const SERVER_VERSION = '1.0.0';
const SERVER_INSTRUCTIONS =
  'Public, read-only MAC address and OUI lookup derived from the IEEE Registration ' +
  'Authority registries. Call lookup once per address. The record page at the ' +
  'returned url carries the organization address, the block range, and ownership ' +
  'history.';

/**
 * Reject a request that names a protocol version we do not speak.
 *
 * This is the affordance the transition depends on, and returning -32601
 * instead quietly breaks it. A client that prefers another modern revision is
 * supposed to receive UnsupportedProtocolVersionError (-32022) listing what the
 * server does support, select a mutually supported version, and retry in place.
 * A client-side era check treats -32022 as proof the server is modern; an
 * unrecognized 400 is the signal for a *legacy* server. So -32601 makes a modern
 * server look like a legacy one, and sends the client down a fallback path that
 * cannot work.
 */
function versionError(id, requested) {
  return new Response(
    JSON.stringify({
      jsonrpc: '2.0',
      id: id === undefined ? null : id,
      error: {
        code: -32022,
        message:
          'Unsupported protocol version' +
          (requested ? ': ' + requested : '') +
          '. This server accepts ' + SUPPORTED_VERSIONS.join(', ') + '.',
        data: { supported: SUPPORTED_VERSIONS, ...(requested ? { requested } : {}) },
      },
    }),
    { status: 400, headers: headers() },
  );
}

/**
 * The protocol version a request claims, from any of the places it can appear.
 *
 * The order matters and the bug it caused is worth recording. initialize
 * carries its version in params.protocolVersion. That is the only place a real
 * client ever sends it, because 2025-03-26 removed the header requirement from
 * the handshake. An earlier version of this function read only the header and
 * _meta, so on initialize it returned null, the guard was skipped, and the reply
 * fell through to "negotiate to whatever we like". A client asking for
 * 2024-11-05 was told the server speaks 2026-07-28, then refused on every later
 * request, having been waved through at the door.
 *
 * params.protocolVersion is therefore read first, so a stale header cannot
 * shadow the version under test.
 */
function claimedVersion(request, payload) {
  const params = payload && payload.params;
  if (params && typeof params === 'object') {
    const inParams = params.protocolVersion;
    if (typeof inParams === 'string' && inParams) return inParams.trim();
    // A non-string version is a malformed request, not an absent one. Coerce it
    // so it is refused rather than silently treated as not supplied.
    if (typeof inParams === 'number') return String(inParams);
    // _meta lives under params, not at the top level. Check both.
    const meta = params._meta;
    if (meta && typeof meta === 'object') {
      const key = 'io.modelcontextprotocol/protocolVersion';
      if (typeof meta[key] === 'string') return meta[key].trim();
    }
  }
  const fromHeader = headerValue(request, 'mcp-protocol-version');
  if (fromHeader) return fromHeader;
  const topMeta = payload && payload._meta;
  if (topMeta && typeof topMeta === 'object') {
    const key = 'io.modelcontextprotocol/protocolVersion';
    if (typeof topMeta[key] === 'string') return topMeta[key].trim();
  }
  return null;
}

/**
 * The version the body claims, ignoring the header entirely.
 *
 * Needed to compare the two. The header is not a fallback here; the point is to
 * detect when they disagree, so it must not be able to supply the value.
 */
function bodyVersion(payload) {
  const params = payload && payload.params;
  if (params && typeof params === 'object') {
    if (typeof params.protocolVersion === 'string' && params.protocolVersion) {
      return params.protocolVersion.trim();
    }
    const meta = params._meta;
    if (meta && typeof meta === 'object') {
      const key = 'io.modelcontextprotocol/protocolVersion';
      if (typeof meta[key] === 'string') return meta[key].trim();
    }
  }
  const topMeta = payload && payload._meta;
  if (topMeta && typeof topMeta === 'object') {
    const key = 'io.modelcontextprotocol/protocolVersion';
    if (typeof topMeta[key] === 'string') return topMeta[key].trim();
  }
  return null;
}

/**
 * Reject a request whose routing headers disagree with its body.
 *
 * The specification requires this on every request that carries a body, and the
 * reason is a security property rather than tidiness: "This prevents potential
 * security vulnerabilities when different components in the network rely on
 * different sources of truth, for example a load balancer routing on the header
 * value while the MCP server executes based on the body value."
 *
 * Reading \`payload.method || header\` and preferring the body is exactly the
 * behaviour that note warns about. It also has a practical cost that a
 * conformance run made visible: with no validation, a request whose header says
 * \`prompts/list\` and whose body says \`tools/list\` was served, so a gateway that
 * routed on the header and this server that executed the body disagreed and
 * nothing said so.
 *
 * Only enforced for the modern revision. A 2025-era client sends no
 * \`Mcp-Method\` header at all, and requiring one would turn away the clients this
 * endpoint answers deliberately. See \`isModern\` below.
 */
function headerMismatch(id, message) {
  return rpcError(id, HEADER_MISMATCH, message, 400);
}

function routingError(request, payload, id) {
  const fromHeader = headerValue(request, 'mcp-protocol-version');
  const fromBody = bodyVersion(payload);
  if (fromHeader !== null && fromBody !== null && fromHeader !== fromBody) {
    return headerMismatch(
      id,
      'Header mismatch: the MCP-Protocol-Version header says ' + fromHeader +
        ' but the request body says ' + fromBody + '.',
    );
  }

  // The claim that decides which rules apply. Null means the request named no
  // version at all, which is a 2025-era request, and is served leniently.
  const claimed = claimedVersion(request, payload);
  if (claimed === null || claimed !== PROTOCOL_VERSION) return null;

  const methodHeader = headerValue(request, 'Mcp-Method');
  const bodyMethod = typeof payload.method === 'string' ? payload.method : null;
  if (methodHeader === null) {
    return headerMismatch(id, 'Header mismatch: the Mcp-Method header is required on this protocol revision and was absent.');
  }
  if (bodyMethod !== null && methodHeader !== bodyMethod) {
    return headerMismatch(
      id,
      'Header mismatch: the Mcp-Method header says ' + methodHeader +
        ' but the request body says ' + bodyMethod + '.',
    );
  }

  // Mcp-Name is required for tools/call, and must agree with params.name.
  const nameHeader = decodeHeaderValue(headerValue(request, 'Mcp-Name'));
  const params = payload.params;
  const bodyName = params && typeof params === 'object' && typeof params.name === 'string' ? params.name : null;
  if (bodyMethod === 'tools/call') {
    if (nameHeader === null) {
      return headerMismatch(id, 'Header mismatch: the Mcp-Name header is required on tools/call and was absent.');
    }
    if (bodyName !== null && nameHeader !== bodyName) {
      return headerMismatch(
        id,
        'Header mismatch: the Mcp-Name header says ' + nameHeader +
          ' but the request body says ' + bodyName + '.',
      );
    }
  }
  return null;
}

export default {
  async fetch(request) {
    // Origin validation, first thing. MUST: "Servers MUST validate the Origin
    // header on all incoming connections to prevent DNS rebinding attacks. If
    // the Origin header is present and invalid, servers MUST respond with HTTP
    // 403 Forbidden."
    //
    // Nothing upstream does this. It is not edge behaviour: Cloudflare implements
    // it inside \`createMcpHandler\`, the \`agents\` SDK wrapper, which this
    // endpoint does not use. Verified -- before this, \`Origin:
    // http://evil.example\` returned 200 with a cf-ray and a real tool list, so
    // the request reached this code.
    //
    // Conditional on the header being PRESENT. No Origin means no browser, and
    // curl and every non-browser MCP client send none; refusing those would
    // break them for a hole that does not apply. A present Origin must be http
    // or https on this host, which admits this site's own pages and refuses a
    // rebound one. That also refuses \`null\`, which a sandboxed iframe sends.
    const origin = headerValue(request, 'origin');
    if (origin !== null) {
      let allowed = false;
      try {
        const parsed = new URL(origin);
        allowed = (parsed.protocol === 'https:' || parsed.protocol === 'http:') && parsed.host === HOST;
      } catch {
        allowed = false;
      }
      if (!allowed) {
        return new Response(
          JSON.stringify({ jsonrpc: '2.0', id: null, error: { code: -32600, message: 'Forbidden: this Origin is not allowed on ' + HOST + '.' } }),
          { status: 403, headers: headers() },
        );
      }
    }

    // Second line of defence behind the rule expression. A Snippet rule is
    // zone-wide, so a path-only rule reaches every subdomain. Refusing here
    // turns that misconfiguration into a loud 404 instead of a lookup that
    // fetches shards from the wrong host, 404s every key, and reports no
    // vendor for every address.
    if (new URL(request.url).host !== HOST) {
      return new Response(
        JSON.stringify({
          jsonrpc: '2.0',
          id: null,
          error: { code: -32601, message: 'Not found: this MCP endpoint is served on ' + HOST + ' only.' },
        }),
        { status: 404, headers: headers() },
      );
    }
    if (request.method === 'OPTIONS') {
      return new Response(null, { status: 204, headers: headers() });
    }
    // The zone rule already filters on POST. This guard is what stops a
    // same-zone subrequest from re-entering the handler, and what answers DELETE
    // and every other method.
    //
    // GET is the one exception: see \`sseProbe()\` for why it is served rather
    // than refused. It is gated on the Accept header so that only a real
    // streaming probe gets the stream. A bare GET with no Accept, and the
    // shard fetch below, keep getting 405 -- which is what stops a subrequest
    // from re-entering the handler.
    if (request.method === 'GET') {
      const accept = headerValue(request, 'accept') || '';
      return /text\\/event-stream/i.test(accept)
        ? sseProbe()
        : new Response(
          JSON.stringify({ jsonrpc: '2.0', id: null, error: { code: -32600, message: 'This endpoint accepts POST only.' } }),
          { status: 405, headers: headers({ allow: 'POST, GET, OPTIONS' }) },
        );
    }
    if (request.method !== 'POST') {
      return new Response(
        JSON.stringify({ jsonrpc: '2.0', id: null, error: { code: -32600, message: 'This endpoint accepts POST only.' } }),
        { status: 405, headers: headers({ allow: 'POST, GET, OPTIONS' }) },
      );
    }

    // Reject an oversized body on the declared length, before reading it.
    //
    // This endpoint is unauthenticated and unthrottled, so a caller-supplied
    // body size is a free amplification lever. Measured before this guard: a
    // single 90 MB POST was accepted, occupied the invocation for 33.6 seconds
    // of wall clock, and still returned 200. A legitimate lookup is ~110 bytes,
    // so that is roughly 600,000x amplification from one request, repeatable
    // concurrently and without credentials.
    //
    // The check is on Content-Length so it costs nothing: the body is never
    // read, so a hostile client never gets the invocation to spend. A chunked
    // request with no declared length still reaches the platform body limit,
    // but it cannot be used to skip this check cheaply, because streaming a
    // large body costs the caller bandwidth and the server time either way.
    const declared = Number(request.headers.get('content-length'));
    if (Number.isFinite(declared) && declared > MAX_BODY_BYTES) {
      return rpcError(null, -32600, 'Request body too large: the limit is ' + MAX_BODY_BYTES + ' bytes.', 413);
    }

    let payload;
    try {
      payload = await request.json();
    } catch {
      return rpcError(null, -32700, 'Parse error: the body is not JSON.');
    }
    if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
      return rpcError(null, -32600, 'Invalid request: the body is not a JSON-RPC object.');
    }

    // JSON-RPC notification: no id, so no response body.
    if (!Object.hasOwn(payload, 'id')) {
      return new Response(null, { status: 202, headers: headers() });
    }
    const id = payload.id;

    // An id of null is not a request, and all three revisions served here say so
    // in the same words: "Requests MUST include a string or integer ID. Unlike
    // base JSON-RPC, the ID MUST NOT be null." Checked on 2026-07-28,
    // 2025-11-25 and 2025-06-18, so this is not a newer rule.
    //
    // It matters because the response echoes the id: an explicit null used to
    // return 200 with \`"id": null\`, a success response to a message that cannot
    // exist. The *error* below also carries \`id: null\`, which is correct --
    // JSON-RPC 2.0 requires null when the id cannot be determined.
    if (id === null || (typeof id !== 'string' && typeof id !== 'number')) {
      return rpcError(null, -32600, 'Invalid request: the id must be a string or an integer, not null.');
    }

    // Reject only a version we genuinely cannot serve. Anything in the
    // supported set is served statelessly, so a 2025-era client is not turned
    // away at the door.
    const claimed = claimedVersion(request, payload);
    if (claimed !== null && !SUPPORTED_VERSIONS.includes(claimed)) {
      return versionError(id, claimed);
    }

    // The version header and the body must agree, and the routing headers must
    // match the body. Checked after the version guard so an unsupported version
    // is still reported as such: a client picking a version this server does not
    // serve needs the supported list, not a lecture about its headers.
    const routing = routingError(request, payload, id);
    if (routing) return routing;

    // Routing is validated above, so the body is authoritative and the header is
    // a convenience for the body-less case only. For a 2025-era request there is
    // no header to read, so this is the body's own value either way.
    const method = payload.method || headerValue(request, 'Mcp-Method') || '';
    const toolName = (payload.params && payload.params.name) || headerValue(request, 'Mcp-Name') || '';

    if (method === 'initialize') {
      // 2026-07-28 removed the handshake, but a connector UI still probes with
      // it. Refusing it costs a 400, and a 400 during the auth check reads as
      // "this server wants sign-in" -- Claude reports that as a configuration
      // error, when the real problem is that the server is too strict.
      //
      // So answer it, statelessly. This is the reference SDK's legacy:stateless
      // mode and Cloudflare's default: accept the handshake, then serve every
      // later request independently. No session is created and no
      // Mcp-Session-Id is ever issued, so the one-fetch, session-free design is
      // unchanged. Set LEGACY_HANDSHAKE to false for a 2026-07-28-only endpoint.
      if (!LEGACY_HANDSHAKE) {
        return versionError(id, claimed);
      }
      // asked is already validated by the guard above: claimedVersion reads
      // params.protocolVersion, so an unsupported version never reaches here.
      // A client that omits it entirely gets the current revision, which is
      // what the pre-header handshake did.
      const asked = claimed === null ? PROTOCOL_VERSION : claimed;
      return rpcResult(id, {
        protocolVersion: asked,
        capabilities: { tools: { listChanged: false } },
        serverInfo: { name: SERVER_NAME, title: SERVER_TITLE, version: SERVER_VERSION },
        ...(asked === PROTOCOL_VERSION ? {} : { instructions: SERVER_INSTRUCTIONS }),
      });
    }

    if (method === 'ping') {
      return rpcResult(id, {});
    }

    if (method === 'tools/list' || method === 'server/discover') {
      const response = await pull(new URL(CATALOG, request.url));
      if (!response.ok) return rpcError(id, -32603, 'Tool catalog is unavailable.');
      // The SPA fallback answers a missing asset with 200 and HTML, so guard the
      // content type before parsing rather than letting json() throw.
      if (!/^application\\/json/i.test(response.headers.get('content-type') || '')) {
        return rpcError(id, -32603, 'Tool catalog is unavailable: the path did not return JSON.');
      }
      return rpcResult(id, await response.json());
    }
    if (method === 'tools/call') {
      if (toolName !== 'lookup') {
        return rpcError(id, -32601, 'Unknown tool "' + toolName + '". This server exposes only "lookup".');
      }
      return lookup(request, payload, id);
    }
    // 404, not 400: the request was well formed and the method is not implemented.
    // A 400 here would read as "your request is malformed" and send a client
    // looking at its own request rather than at the server's method set.
    return rpcError(
      id,
      -32601,
      'Unknown method "' + method + '". This server exposes tools/list and tools/call.',
      METHOD_NOT_FOUND_STATUS,
    );
  },
};
`;
}

/**
 * Write the shard files, the tool catalog, and the generated snippet.
 *
 * Returns the plan stats plus the emitted snippet size, which the build asserts
 * against the 32 KB snippet limit.
 */
export async function writeMcpShards({ distDir, records, site = SITE, route = MCP_ROUTE } = {}) {
  const plan = planShards(records);
  const shardDir = path.join(distDir, MCP_SHARD_PATH.replace(/^\//, ''));
  await rm(shardDir, { recursive: true, force: true });
  await mkdir(shardDir, { recursive: true });

  for (const shard of plan.shards) {
    await writeFile(path.join(shardDir, `${shard.key}.txt`), shard.text);
  }
  await writeFile(path.join(shardDir, 'catalog.json'), `${JSON.stringify(methodCatalog({ site }), null, 2)}\n`);

  const snippet = renderSnippet(plan.table, { site, route });
  await mkdir(distDir, { recursive: true });
  await writeFile(path.join(distDir, 'mcp-snippet.js'), snippet);

  return {
    ...shardStats(plan),
    catalogBytes: (await stat(path.join(shardDir, 'catalog.json'))).size,
    snippetBytes: Buffer.byteLength(snippet),
    snippetPath: 'mcp-snippet.js',
    table: plan.table,
  };
}
