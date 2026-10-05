# MCP comparanda: small JavaScript and TypeScript MCP servers

Why `mcp/snippet.js` is hand-rolled rather than built on an SDK, what the
smallest public alternatives actually cost, and which patterns from them are
worth copying. Every size here was measured, not estimated.

All comparator sizes were measured on **2026-10-02** and drift — `five9-mcp`
moved by 10 bytes during this work. Re-measure before quoting any of it.

Related docs: [MCP endpoint](mcp-endpoint.md) · [architecture](architecture.md) ·
[MCP listing](mcp-listing.md) · [README](../README.md)

## What we are benchmarking against

`mcp/snippet.js` has to fit a Cloudflare Snippet: **32 KB package, 5 ms
execution, 2 MB memory, 2–3 subrequests**. The build enforces the package limit
on the raw generated source at `build/build.mjs:450`.

| Measurement | Bytes |
| --- | --- |
| Committed and deployed source, comments included | 26,279 |
| Same file with comments stripped | 13,521 |
| Minified (esbuild, ES2022) | **7,711** |
| Minified and gzipped | 3,057 |

So the deployed artifact is **7.7 KB minified**, zero dependencies, and the
source file is **80% of the 32 KB ceiling**. The 32 KB budget is what forces the
design: it is not possible to fit an SDK here.

**Measured cost of dual-era support.** Serving `2026-07-28` alone was tried on
2026-10-04 and gave 6,643 bytes minified, about 1 KB less, almost all of it in
conditional routing rules and a second lenient path through the version guard.
It was rolled back: one connector still could not complete a tool call, and
without its request headers the cause was not diagnosable from the server side.
The saving is real but it is not worth an endpoint nobody can call. Re-measure
before quoting a figure here; it has now moved three times.

## Why no SDK can fit

The floor is the package, not the app code.

| Package | Published `dist` | Direct dependencies |
| --- | --- | --- |
| `@modelcontextprotocol/sdk` 1.32.0 | 4,362 KB (2,159 KB ESM) | 17 — `ajv`, `zod`, `cors`, `hono`, `jose`, `express`, `raw-body`, `cross-spawn`, `eventsource`, `content-type`, `pkce-challenge`, … |
| `@modelcontextprotocol/server` 2.3.0 | 6,317 KB | 2 — `zod`, `@modelcontextprotocol/core` |
| `agents` 0.26.0 | 7,269 KB | 11 |

Cloudflare's own smallest example, `agents/examples/mcp-server/src/index.ts`, is
**740 bytes / 33 lines** of application code. It reads as if it were smaller than
this snippet. It is not: it is 740 bytes *on top of* a 6.3 MB package. Those two
numbers are the whole argument, and they are why the SDK cannot appear inside a
Snippet.

## Public comparators

Measured from the repository trees, not from the READMEs.

| Server | Runtime | Transport | Deps | Protocol layer | Protocol |
| --- | --- | --- | --- | --- | --- |
| **This project** | JS, Cloudflare Snippet | Streamable HTTP, stateless | **none** | 7,711 B minified | 2026-07-28, 2025-11-25, 2025-06-18 |
| [`outboundani/five9-mcp`](https://github.com/outboundani/five9-mcp) | JS, Cloudflare Worker | Streamable HTTP, stateless | **none** (`dependencies` absent) | **7,194 B / 172 lines** | 2025-06-18, 2025-03-26, 2024-11-05 |
| [`outboundani/genesys-mcp`](https://github.com/outboundani/genesys-mcp) | JS, Cloudflare Worker | Streamable HTTP, stateless | none | **7,507 B / 179 lines** | same family |
| [`firasd/mcpclock`](https://github.com/firasd/mcpclock) | TS, Cloudflare Worker | stateless via `agents/mcp` | `agents`, SDK, `zod` | 35,480 B / 1,036 lines | SDK |
| [`cloudflare/agents`](https://github.com/cloudflare/agents) `examples/mcp-server` | TS, Worker | `createMcpHandler` | SDK v2, `zod` | 740 B / 33 lines | SDK v2 |
| `cloudflare/agents` `handler-stateless.ts` | TS | stateless handler | — | 10,281 B / 309 lines | — |
| [`Yrobot/cloudflare-search`](https://github.com/Yrobot/cloudflare-search) | JS | **stdio**, not HTTP | SDK | 5,232 B / 205 lines | SDK |
| [`knowingly-ai/time-mcp`](https://github.com/knowingly-ai/time-mcp) | JS, Worker | **not MCP** | none | 2,468 B / 91 lines | none |

Two results worth stating plainly.

**`time-mcp-worker.js` is not an MCP server**, despite the repository name. It
reads `body.timezone` off a plain JSON POST and returns an object. It is 2.4 KB
because it does no protocol work. It is the floor of a *non*-MCP HTTP handler,
not a target.

**`outboundani/*-mcp` is the only genuine peer found.** Five servers in that
family (five9, genesys, twilio, amazon-connect, cxone) are zero-dependency,
hand-rolled JSON-RPC on Cloudflare Workers, with a ~7 KB protocol layer and the
tool bodies in separate files. Same platform, same transport, same "no SDK"
decision, same shape. Five independent copies of that decision is meaningful
evidence that the shape is a repeatable pattern and not a one-off.

## What to learn from the peer

Things `five9-mcp` does that this snippet does not:

| Pattern | Theirs | Ours | Verdict |
| --- | --- | --- | --- |
| JSON-RPC array bodies (batch) | `Promise.all` over the array, 202 if every entry was a notification | rejected with `-32600` | **Ours is correct.** The 2026-07-28 schema types a body as `JSONRPCRequest \| JSONRPCNotification \| JSONRPCResponse` — a union of single messages, with no array variant, and 2025-06-18 has no batch type either. Batch support is their extension. Separately, one batch entry costs one subrequest, so a batch could not be served within the 2–3 subrequest Snippet budget anyway. |
| Notification test | `id === undefined \|\| id === null` | missing `id` member only | **Ours is stricter and correct.** JSON-RPC 2.0 defines a notification as a request *without* an `id` member; `id: null` is a valid request id. |
| CORS | applied by mutating the response after the fact, so every path gets it | a `headers()` helper passed into each constructor | Equivalent. Theirs is fewer lines; ours is one place to change. |
| `access-control-max-age` | 86400 | absent | Minor. Only affects preflight caching. |
| `capabilities.tools` | `{}` | `{ listChanged: false }` | Ours is more precise and matches the `tools/list` contract we advertise. |
| `isError` on success | sent explicitly | omitted (defaults false) | Equivalent. |

Things worth borrowing: nothing structural. The one candidate was batching, and
the spec settled it.

Things we have that no comparator has, all from faults this project actually hit:

- **`-32022` with `data.supported`.** `five9-mcp` negotiates silently downward —
  `initialize` echoes the requested version if known, otherwise
  `PROTOCOL_VERSIONS[0]`. That is the "waved through at the door, turned away
  at the counter" failure recorded in [mcp-endpoint.md](mcp-endpoint.md), and it
  is the default in most SDK servers too.
- **`server/discover`** carrying `supportedVersions`, `resultType`, `ttlMs`, and
  `cacheScope`. No comparator serves it at all.
- **A `Host` guard**, because a Snippet rule is zone-wide and the zone has other
  subdomains.
- **A `Content-Length` cap checked before the body is read**, from the
  amplification finding in the security review.
- **A content-type check before a shard body is trusted**, because
  `not_found_handling: "single-page-application"` answers every unmatched path
  with 200 and HTML.
- **`structuredContent` alongside the text block.**

`five9-mcp` has none of these, and is exposed to all four failure modes: a
spoofed `Host`, an unbounded body, and an HTML body parsed as shard data.

## How to use this going forward

- **The architecture is validated, not novel.** A second project reached the same
  conclusion independently, on the same platform, with the same transport. That
  is the strongest available evidence short of a benchmark.
- **The size claim to defend is the minified one**, 7,711 bytes. Quote that, not
  the 26,279-byte source file, when comparing against a 32 KB ceiling.
- **The peer is at 7,194 bytes of protocol layer while also serving 73 tools.**
  One tool at 7,711 bytes minified is not a fat implementation; the comment
  density is what makes the source file look large. Note the peer is now the
  *smaller* number on this measure, so do not oversell the comparison.
- **Re-check the SDK floor if the 32 KB Snippet limit ever changes.** A worker
  route has no 32 KB limit and no subrequest cap of 2, and the SDK becomes
  affordable the moment either moves. See the fallback note in
  [mcp-endpoint.md](mcp-endpoint.md).
- **Do not add a second tool without re-measuring.** The guard is at
  `build/build.mjs:450` and fires on the raw source, so it trips at roughly half
  the ceiling before the real limit is reached.

## Reproducing the numbers

```sh
# our snippet, minified
node -e 'const e=require("esbuild"),f=require("fs");e.build({stdin:{contents:f.readFileSync("mcp/snippet.js","utf8"),loader:"js"},minify:true,write:false,format:"esm",target:"es2022"}).then(r=>console.log(r.outputFiles[0].contents.length))'

# a comparator's protocol layer
curl -sSL https://raw.githubusercontent.com/outboundani/five9-mcp/HEAD/src/index.js | wc -c

# confirm the peer really is dependency-free (no dependencies key at all)
curl -sSL https://raw.githubusercontent.com/outboundani/five9-mcp/HEAD/package.json \
  | python3 -c 'import json,sys; d=json.load(sys.stdin); print(d.get("dependencies"), d.get("devDependencies"))'

# published package sizes
npm view @modelcontextprotocol/server@2.3.0 dist.unpackedSize dist.fileCount

# the 2026-07-28 body type: a union of single messages, no array variant
curl -sSL https://raw.githubusercontent.com/modelcontextprotocol/modelcontextprotocol/main/schema/2026-07-28/schema.ts \
  | sed -n '26,27p'
```

Sizes drift. Re-measure before quoting any of this in a decision.