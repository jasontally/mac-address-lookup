/**
 * A minimal MCP client that speaks the 2026-07-28 stateless core.
 *
 * Why this exists rather than `@modelcontextprotocol/client`: the official
 * TypeScript client at 2.2.0 reports `LATEST_PROTOCOL_VERSION` of
 * `2025-11-25` and cannot connect to a 2026-07-28 server at all — it sends
 * `initialize` first and then reports "Not connected".
 *
 * The official conformance runner does support this revision, and is the
 * stronger gate:
 *
 *   npx @modelcontextprotocol/conformance server --url <url> --requirements 2026-07-28
 *
 * Use `--requirements`, not `--spec-version`. An earlier note in this repository
 * said the runner rejected the version, quoting `Valid versions: 2025-03-26,
 * 2025-06-18, 2025-11-25, draft, extension`. That was true when written and is
 * now false: `--requirements` loads the frozen set the revision shipped with.
 *
 * This client stays because the runner needs one installed, and `npm test` must
 * not need a network install. It is written from the specification text, and
 * doubles as executable documentation of what a stateless client actually does:
 * no handshake, no session, one POST per request, identity in headers.
 *
 * Reference: https://modelcontextprotocol.io/specification/2026-07-28/
 */

export const PROTOCOL_VERSION = '2026-07-28';

/** Methods the 2026-07-28 stateless core keeps. Everything else is gone. */
export const KNOWN_METHODS = new Set(['tools/list', 'tools/call', 'server/discover']);

/**
 * Methods that existed before 2026-07-28 and were removed by it. A server that
 * answers any of these is not speaking the stateless core.
 */
export const REMOVED_METHODS = ['initialize', 'notifications/initialized', 'ping', 'logging/setLevel'];

export class Mcp2026Client {
  /**
   * @param {object} options
   * @param {string} options.url           endpoint, e.g. https://host/mcp
   * @param {typeof fetch} [options.fetch]  injected for tests
   * @param {string} [options.clientName]
   * @param {string} [options.clientVersion]
   */
  constructor({ url, fetch: fetchImpl = globalThis.fetch, clientName = 'mcp-2026-07-28-client', clientVersion = '1.0.0' } = {}) {
    if (!url) throw new Error('url is required');
    this.url = url;
    this.fetch = fetchImpl;
    this.clientInfo = { name: clientName, version: clientVersion };
    /** Every request/response pair, for assertions and for debugging a failure. */
    this.log = [];
  }

  /**
   * One JSON-RPC exchange. No handshake, no session header, no SSE.
   *
   * 2026-07-28 moved routing into headers so a gateway can route without
   * reading the body, so a conforming client sends `Mcp-Method` and, for
   * `tools/call`, `Mcp-Name`. `MCP-Protocol-Version` declares the version.
   */
  async request(method, params, id, extraHeaders) {
    const headers = {
      'content-type': 'application/json',
      accept: 'application/json',
      'MCP-Protocol-Version': PROTOCOL_VERSION,
      'Mcp-Method': method,
      ...(extraHeaders || {}),
    };
    if (params && typeof params === 'object' && params.name) headers['Mcp-Name'] = params.name;

    const message = { jsonrpc: '2.0', ...(id === undefined ? {} : { id }), method, ...(params ? { params } : {}) };
    // The spec carries client identity in `_meta` on every request now that
    // there is no initialize exchange to carry it.
    message._meta = { 'io.modelcontextprotocol/clientInfo': this.clientInfo };

    const response = await this.fetch(this.url, { method: 'POST', headers, body: JSON.stringify(message) });
    const text = await response.text();
    const entry = { method, sent: message, status: response.status, headers: response.headers, body: text };
    this.log.push(entry);
    return { status: response.status, headers: response.headers, text, json: safeJson(text) };
  }

  /** `tools/list`, then validate against the shape the official suite requires. */
  async listTools() {
    const res = await this.request('tools/list', undefined, nextId());
    return { res, tools: res.json?.result?.tools };
  }

  /** `tools/call` for one tool. */
  async callTool(name, args, id = nextId()) {
    return this.request('tools/call', { name, arguments: args }, id);
  }

  /** A notification: a request with no `id`. The server must not reply. */
  async notify(method, params) {
    return this.request(method, params, undefined);
  }

  /** A bare HTTP method other than POST, e.g. to check the optional SSE GET. */
  async raw(method, body) {
    const response = await this.fetch(this.url, {
      method,
      headers: { 'MCP-Protocol-Version': PROTOCOL_VERSION, ...(body ? { 'content-type': 'application/json' } : {}) },
      body,
    });
    const text = await response.text();
    return { status: response.status, headers: response.headers, text, json: safeJson(text) };
  }
}

let counter = 0;
export function nextId() {
  counter += 1;
  return counter;
}

function safeJson(text) {
  try {
    return text ? JSON.parse(text) : null;
  } catch {
    return null;
  }
}

/**
 * The structural requirements the official conformance suite states for its
 * `tools-list` scenario, transcribed so they are not quietly forgotten when
 * the suite gains 2026-07-28 support. From
 * `npx @modelcontextprotocol/conformance list --server`:
 *
 *   "Return array of all available tools
 *    Each tool MUST have: name (string), description (string),
 *    inputSchema (valid JSON Schema object)"
 */
export function checkToolsListShape(result) {
  const problems = [];
  if (!result || typeof result !== 'object') return ['result is not an object'];
  if (!Array.isArray(result.tools)) return ['result.tools is not an array'];
  for (const tool of result.tools) {
    for (const [field, check] of [
      ['name', (v) => typeof v === 'string' && v.length > 0],
      ['description', (v) => typeof v === 'string'],
      ['inputSchema', isJsonSchemaObject],
    ]) {
      if (!(field in tool)) problems.push(`tool ${tool.name ?? '<unnamed>'} is missing ${field}`);
      else if (!check(tool[field])) problems.push(`tool ${tool.name} has an invalid ${field}`);
    }
  }
  return problems;
}

function isJsonSchemaObject(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  // A JSON Schema object is not required to carry `type`, but a schema with no
  // keywords at all is not a schema. Require one of the defining keywords.
  return ['type', 'properties', 'items', 'enum', 'const', 'anyOf', 'oneOf', 'allOf', '$ref', 'required'].some(
    (key) => key in value,
  );
}

/** JSON-RPC error codes from the base protocol, for readable assertions. */
export const JSON_RPC = {
  PARSE_ERROR: -32700,
  INVALID_REQUEST: -32600,
  METHOD_NOT_FOUND: -32601,
  INVALID_PARAMS: -32602,
  INTERNAL_ERROR: -32603,
};
