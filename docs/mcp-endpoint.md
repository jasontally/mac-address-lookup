# MCP endpoint: `/mcp`

`/mcp` is a stateless [MCP](https://modelcontextprotocol.io) server over
Streamable HTTP. One tool, `lookup`. No key, no auth, no session, and under the
2026-07-28 specification no `initialize` handshake and no `Mcp-Session-Id`
header.

This document covers the one thing the build cannot do for you: the Snippet that
serves the endpoint. The shards and the Snippet source are both build output.

For the other side of the endpoint, the metadata it is listed under and the
directories and registries it can appear in, see
[docs/mcp-listing.md](mcp-listing.md).

## How the two halves fit

| Piece | Built by | Published by | Cost |
|---|---|---|---|
| `dist/data/mcp/**` — 13,816 shard files | `build/mcp-shards.mjs` | **automatic** — `wrangler deploy` in Workers Builds | Free, unlimited |
| `mcp/snippet.js` — the edge handler, committed | `build/mcp-shards.mjs` | **manual** — `npm run mcp:deploy` | Included in the plan |
| The zone Snippet rule | same script | **manual** — same command | Included in the plan |

## What the pipeline does and does not do

Deploys are Cloudflare **Workers Builds**, not GitHub Actions. A push to `main`
runs `npm run build`, then `npx wrangler deploy && node build/indexnow.mjs`, both
configured in the Cloudflare dashboard. The only GitHub Action is
`data-refresh.yml`, which commits a `data/refresh.txt` bump when an upstream
source changes; that commit also reaches Workers Builds.

**Automatic on every push:** the shards. `build/build.mjs` calls
`writeMcpShards`, so `dist/data/mcp/` is rebuilt and uploaded with everything
else. Nothing to do.

**Manual:** the Snippet. Workers Builds runs `wrangler deploy`, which deploys
the Worker; the Snippets product has no wrangler command. The Snippet is a
separate, hand-installed file on the zone.

That asymmetry is the one real operational risk in this design, and the build
guards it. The Snippet carries the shard route table inlined (`const DEPTH`),
so a registry change that moves a cluster in or out of the table would publish
fresh shards against a Snippet that routes to the wrong file. Every lookup in
the moved range would report no vendor — a silent wrong answer, with no error
and no failed request.

So the generated Snippet is committed to `mcp/snippet.js` and diffed on every
build. A mismatch **fails the build**, which stops the Workers Builds deploy
before the shards go out:

```
Error: MCP Snippet is out of date: mcp/snippet.js differs from the build. The zone
may be running an older MCP Snippet, whose inlined shard route table no longer
matches the shards being deployed. Every lookup in a moved range would report no
vendor.
  The fresh file is already at dist/mcp-snippet.js. Fix:
    npm run mcp:accept
    git add mcp/snippet.js && git commit -m "chore: update MCP snippet"
  Then install the same bytes on the zone (docs/mcp-endpoint.md step 3).
```

The fix is two commands. The build writes `dist/mcp-snippet.js` *before* the
check throws, so `npm run mcp:accept` has the fresh bytes even though the build
exited non-zero. Committing `mcp/snippet.js` alongside the data change also puts
the deployed bytes under code review, which a `dist/` artifact alone would not.

Practically: the daily refresh bot can now fail the site's deploy if the IEEE
registry grows a new dense cluster. That is intentional. A loud build failure
that takes a minute to fix is cheaper than silently wrong vendor answers.

`wrangler.jsonc` does **not** set `run_worker_first`. That is deliberate: the
Worker script must never run for an asset hit, or every lookup is billed at
$0.30 per million. The Snippet runs on the rules path, before the origin, so it
can rewrite the request without the Worker script being involved.

## Prerequisites

Node 24. The project declares `engines.node >= 24` and `.nvmrc` pins 24;
Wrangler requires 22 or newer.

```sh
node --version    # must print v24.x
```

If it does not, install a version manager and Node 24 before continuing. Then:

```sh
npm install
npm run build
```

The build prints the shard summary and writes `dist/mcp-snippet.js`:

```
  mcp shards: 13816 files under /data/mcp (2.64 MB, median 0.09 KB, p99 0.94 KB, max 174 KB), depth table 3 entries (28 B), snippet 7.9 KB -> mcp-snippet.js
  note: 3 shard(s) over 30 KB, carved to depth 6 from base 4: {"0050":6,"70B3":6,"8C1F":6}
Budget OK: 77418 files, 63214 pages, 864.85 MB total
```

It also fails the build if the file count passes 100,000, if the snippet passes
32 KB, if the `MCP_SITE` constant has drifted from the site origin, or if more
than 3 shards exceed 30 KB. Those 3 are the IAB and MA-S clusters under
`0050C2`, `70B3D`, and `8C1F64`: thousands of records that all share one
6-character prefix, so no prefix key can split them further. A 174 KB scan
measures 0.42 ms against the snippet's 5 ms budget.

**The shard count is shared with the rest of the site.** The 100,000-file limit
applies per Worker version, and the main site already ships 63,214 pages. At
depth 4 the MCP surface adds 13,816, for 77,418 total. Depth is the lever: a
per-prefix layout would be 52,281 files and would not fit. If the main page
count ever grows past about 75,000, drop `SHARD_BASE_DEPTH` to 3 in
`build/mcp-shards.mjs` (1,182 files, still lossless) before considering a second
Worker.

## Step 1: authenticate

Both routes below work. The first is the usual one.

### Wrangler (recommended)

```sh
npx wrangler login
```

This opens a browser, you approve the request, and Wrangler stores an OAuth
token in `~/.config/.wrangler/`. Confirm it with:

```sh
npx wrangler whoami
```

You need **Edit** permission on the zone, or a token with
`Zone:Edit` plus `Account:Read`. For a headless machine, or if the browser
approval is inconvenient, use an API token instead:

```sh
export CLOUDFLARE_API_TOKEN='<token from dash.cloudflare.com/profile/api-tokens>'
npx wrangler whoami
```

Token template: **Edit zone** permissions, scoped to the one zone.

### The `cf` CLI

If you have it installed, it is equivalent and reuses the same OAuth flow:

```sh
cf login
cf auth whoami
```

Use whichever you prefer. The commands below work with either, because both read
the same credentials.

## Step 2: publish the shards

```sh
npx wrangler deploy
```

This uploads `dist/` including the 13,816 shard files. Check one:

```sh
curl -sS https://mac.jasontally.com/data/mcp/8c1f.txt
```

Expect the whole `8C1F` range in one file: `8C1F64|MA-L|16777216|US|DATA
ELECTRONIC DEVICES, INC`, the MA-M block inside it, and the MA-S block inside
that. The snippet takes the longest match, which is why `8C1F64AFA4B2` resolves
to `8C1F64AFA` and not to its parent `8C1F64`.

## Step 3: install the Snippet

This is the one step the pipeline cannot do. Workers Builds runs
`npx wrangler deploy`, wrangler has no `snippets` subcommand, and Snippets is a
zone-level Rules resource rather than a Worker artifact.

```sh
export CLOUDFLARE_API_TOKEN='<token>'
export CLOUDFLARE_ZONE_ID='<zone id>'
npm run mcp:deploy -- --dry-run   # show the plan
npm run mcp:deploy
```

`build/deploy-mcp-snippet.mjs` does it with Node's built-in `fetch`, no
dependencies. It reads the committed `mcp/snippet.js` and imports
`mcpRuleExpression()`, so the rule, the snippet's header comment, and the
snippet's `HOST` guard cannot drift. It is idempotent: it uploads the code,
and only replaces the rule list when the live one differs.

### The token

`npx wrangler login` is not enough. Its OAuth token carries `zone (read)` plus
the `workers*` scopes and fails on the Snippets API:

```
GET /zones/{id}/snippets
-> {"success":false,"errors":[{"code":10000,"message":"Authentication error"}]}
```

The Snippets API accepts only `Snippets Write` and `Snippets Read`. Create a
token at <https://dash.cloudflare.com/profile/api-tokens> with those two
permissions, scoped to the `jasontally.com` zone. Nothing more.

### Two API details the docs do not mention

Both of these cost a round trip during the first install, and the script now
encodes the answer:

- **`snippet_name` accepts only `a-z`, `0-9`, and `_`.** `mcp-lookup` is
  rejected with *"snippet_name can only contain the characters a-z,0-9, and
  _"*. The installed snippet is therefore `mcp_lookup`.
- **A rule defaults to `enabled: false`** when the field is omitted from the
  PUT body, and a disabled rule matches nothing. The rule installs and reports
  success while the endpoint stays dead. `enabled: true` must be sent
  explicitly. The script verifies the field on read-back.

The upload is `multipart/form-data` with a `metadata` part naming the entry
point plus the module file:

```
PUT /zones/{zone_id}/snippets/{snippet_name}
  metadata:  {"main_module":"snippet.js"}
  snippet.js: <the file>
```

`PUT /zones/{zone_id}/snippets/snippet_rules` replaces the entire ordered rule
list. There is no `/snippet_rules` path at the zone root; the prefix is
required. The list is a zone singleton, so a second snippet goes into the same
`rules` array.

### Cloudflare's own `cf` CLI

`cf` (<https://blog.cloudflare.com/cloudflare-cf-cli-launch/>) is generated from
the OpenAPI schema and covers 3,000+ operations, so it does have these routes:
`cf snippets update`, `cf snippets rules update`, and `cf snippets rules list`.
It is a good fit for this in principle, and `cf snippets update --dry-run`
prints the exact request it would send. It did not work with the token above,
because `cf auth whoami` validates the credential against `GET /user`:

```
{"authenticated": true, "authSource": "CLOUDFLARE_API_TOKEN environment variable",
 "tokenValid": false, "accounts": []}
```

The same token gets 403 on `/user` and 200 on `/zones`, and `cf` then returns an
empty list rather than an error. Adding `User Read` to the token would likely
resolve it. Until then `npm run mcp:deploy` is the path.

## Step 4: verify

After the first deploy, `npm run mcp:deploy` again should report `rules   unchanged`.
That is the check that the zone matches the repo.

```sh
# catalog
curl -sS https://mac.jasontally.com/mcp \
  -H 'content-type: application/json' \
  -d '{"jsonrpc":"2.0","id":1,"method":"tools/list"}'

# a full address
curl -sS https://mac.jasontally.com/mcp \
  -H 'content-type: application/json' \
  -d '{"jsonrpc":"2.0","id":1,"method":"tools/call",
       "params":{"name":"lookup","arguments":{"mac":"8C:1F:64:AF:A4:B2"}}}'
```

The second call should report prefix `8C1F64AFA`, MA-S, DATA ELECTRONIC DEVICES,
INC, and the URL `https://mac.jasontally.com/8C1F64AFA`. The record page carries
the organization address, which the shard omits.

A randomized address should report no prefix and explain why, with no URL:

```sh
curl -sS https://mac.jasontally.com/mcp -H 'content-type: application/json' \
  -d '{"jsonrpc":"2.0","id":2,"method":"tools/call",
       "params":{"name":"lookup","arguments":{"mac":"02:00:00:00:00:01"}}}'
```

## Testing it

Three layers, in increasing cost and decreasing speed.

**1. Unit and in-process conformance** — `npm test`. `test/mcp-shards.test.mjs`
checks the shard layout against a brute-force oracle; `test/mcp-conformance.test.mjs`
runs the generated snippet through a spec-derived conformance suite. Fast and
hermetic.

**2. Live conformance** — `npm run mcp:conformance`. The same client against
the deployed endpoint. It catches things the in-process layer cannot: a zone
running a stale Snippet, a rule that lost its host term, shards that never
reached the edge. Sends real requests, so it is not part of `npm test`.

**3. Load and correctness** — `npm run mcp:load`. See below.

**4. The official conformance runner applies now, and is the strongest gate
available.** `@modelcontextprotocol/conformance` supports this revision:

```
npx @modelcontextprotocol/conformance list --server --requirements 2026-07-28
npx @modelcontextprotocol/conformance server --url https://mac.jasontally.com/mcp \
  --requirements 2026-07-28
```

**This corrects an earlier note in this document**, which said the runner
rejected the version. That was true when written and is now false:

```
Unknown spec version: 2026-07-28
Valid versions: 2025-03-26, 2025-06-18, 2025-11-25, draft, extension
```

`--requirements` is the flag to use, not `--spec-version`. It loads the frozen
requirement set the revision shipped with, rather than whatever the suite has
accumulated since, so the result answers "does this conform to 2026-07-28"
rather than "does this pass today's suite".

`requirements/2026-07-28.yaml` names 38 required server scenarios, anchored to
`@modelcontextprotocol/conformance@0.2.0-alpha.10`. Read that as coverage
before treating it as a pass/fail gate:

| Group | Required | This endpoint |
| --- | --- | --- |
| `tools-list`, `tools-call-simple-text`, `tools-call-error` | 3 | implemented, and covered locally |
| `tools-call-image`, `-audio`, `-embedded-resource`, `-mixed-content`, `-with-progress` | 5 | absent: the one tool returns text and structured content only |
| `resources-list`, `-read-text`, `-read-binary`, `-templates-read`, `sep-2164-resource-not-found` | 5 | absent: no resources are declared |
| `prompts-list`, `-get-simple`, `-get-with-args`, `-get-embedded-resource`, `-get-with-image` | 5 | absent: no prompts are declared |
| `server-stateless`, `server-sse-multiple-streams`, `dns-rebinding-protection`, `completion-complete`, `caching` | 5 | the ones that test this design |
| `input-required-result-*` | 15 | absent: multi-round-trip elicitation and sampling |

Twenty of the 38 are for capabilities a single-tool lookup server does not
implement, and an absent capability is a correct answer rather than a defect.
The five in the transport row are the ones worth reading the report for.
`dns-rebinding-protection` in particular: it checks `Origin` validation, which
this snippet does not perform. That is a real gap to decide on, not a pass.

**The check this suite has that the local tests do not** is
`wire-schema-valid`, which validates every message the implementation sends
against the specification's JSON Schema for the negotiated version. Every fault
this endpoint had in 2026-10 was a field missing or wrongly shaped, and a schema
check finds that class of fault by construction. The local suite asserts those
same fields by name, which catches a regression but not an unexpected shape.
`checkToolsListShape` remains, transcribed from the runner's published prose for
the `tools-list` scenario, so the structural requirement is enforced in `npm test`
with no network.

### Wire-schema validation, without the install

`test/mcp-wire-schema.test.mjs` does the runner's `wire-schema-valid` check locally.
Every response the endpoint sends is validated against the pinned 2026-07-28 wire
schema, then against the definition for its own method.

The schema is pinned at `test/fixtures/mcp-schema-2026-07-28.json` rather than
fetched, so `npm test` needs no network. `test/mcp-wire-schema.mjs` implements
the 18 keywords the schema actually uses and ignores annotations. One check
fails if a future schema uses anything else, so an unimplemented keyword cannot
let a validation pass silently.

**Why the envelope alone is not enough.** `JSONRPCResultResponse.result` is typed
as `Result`, which requires only `resultType` and permits anything else. A
malformed tool result passes the envelope and fails `CallToolResult`. Both are
checked, because the method-specific definition is the one that constrains the
payload.

**Two faults it found on the first run, which the named-field checks could not:**

1. The `outputSchema` did not declare `locallyAdministered` or `multicast`, which
   the miss path returns. The specification says a client SHOULD validate a
   structured result against `outputSchema`, so a strict client would reject an
   unregistered address — the one case a client hits most often. The hit-path test
   could not see it, because those fields only appear on a miss.
2. The schema types `ttlMs` as `integer`, not `number`. A float is a fault the
   specification cares about and a `typeof` check does not.

**One message the schema cannot model.** A parse error answers `id: null`, which
JSON-RPC 2.0 requires when the id cannot be determined. `JSONRPCErrorResponse`
types `id` as `string | integer` and does not model that case. The two
specifications disagree and JSON-RPC governs the wire, so the endpoint keeps the
null and the test records the conflict rather than satisfying the schema by
omitting the field.

### Load and correctness testing

`npm run mcp:load` drives the **deployed** endpoint and validates **every**
response against a brute-force oracle built from `registry.ndjson`. Correctness
is the point: a fast wrong answer counts as a failure. Silent wrong answers are
the failure this design has actually produced twice — a 3-hex shard layout that
dropped 1,141 lookups, and a path-only rule that fired zone-wide — so a latency
number on its own is not evidence of anything.

```
npm run mcp:load                                              # 400 requests, c=8
npm run mcp:load -- --requests 100000 --concurrency 24
npm run mcp:load -- --duration 3600 --concurrency 48 --json soak.json
```

| Flag | Meaning |
| --- | --- |
| `--requests <n>` | total measured requests |
| `--duration <secs>` | run for a fixed time instead. The right unit for a soak: the question is whether latency *drifts*, and that needs hours, not more requests |
| `--concurrency <n>` | in-flight requests |
| `--keep <n>` | records retained for the JSON. Every failure is always kept, and all percentiles come from a streaming histogram, so retention does not affect accuracy or memory |
| `--seed <n>` | PRNG seed. Vary it between runs — see the tail note below |
| `--registry <path>` | registry NDJSON for the oracle. Defaults to `dist/data/registry.ndjson`, fetched if absent |
| `--json <path>` | records, per-segment drift, and per-class latency |
| `--url <url>` | point it at a local server to test a shard-layout change before deploying |

**The request mix is deliberate, not uniform.** A uniform prefix sample barely
touches the slow cases. It splits across registered prefixes, addresses padded
inside a block, the three depth-6 carve buckets (the largest files on the
site), unregistered prefixes checked against the registry so they really are
absent, punctuated separator forms, and malformed input that must not resolve to
a vendor. Latency is reported per class so one slow bucket cannot hide inside an
average.

**Verify the checker before trusting it.** Tampering with the oracle's input is
how you know the validator can fail: corrupting org names across a fifth of the
registry, and separately shortening a tenth of the prefixes, both produce
reported mismatches.

### Measured throughput, and what it is worth

From one 2-core machine, one region, one edge colo:

| Concurrency | req/s | p50 | p99 | Client CPU |
| --- | --- | --- | --- | --- |
| 32 | ~730 | 41 ms | 83 ms | 0.8 core |
| 48 | ~950 | 44 ms | 105 ms | 1.0 core |
| 64 | ~1,190 | 48 ms | 103 ms | 1.1 core |
| 128 | ~1,400 | 83 ms | 156 ms | 1.2 core |

Throughput past concurrency 64 buys latency far faster than it buys requests.
Four client processes reached ~1,700 req/s on the same two cores, so **the
client, not the endpoint, is the ceiling** — more cores move the queueing knee,
they do not remove it.

Three caveats, each of which has cost a wrong conclusion:

- **The p99 tail is a client artifact.** A ~150 ms cluster appears on part of
  any long run and vanishes at concurrency 1. It is connection setup, and the
  seed decides which input class it lands on — so a single run can make it look
  like a class-specific bug. Compare **p50 across runs**, never a single p99.
- **Absolute latency is inflated without IPv6.** This machine has no IPv6 route
  but the host publishes AAAA records, so Node's Happy Eyeballs races an
  address that cannot complete. That is worth roughly 40 ms on every request.
- **Execution time is invisible from outside.** `p50 42 ms` is network round
  trip, not compute. The Snippet's own budget is measured separately, below.

A one-hour soak at concurrency 48 sustained ~1,050 req/s with p50 flat across
189 segments, no drift, and no wrong answers. That covers one vantage point and
one region. It is **not** evidence about multi-region behaviour or about
sustained multi-hour load, and it says nothing at all about the trillions-of-
requests case — at ~1,000 req/s that is thousands of years of wall clock. The
argument for that scale is the design, not the measurement: one subrequest per
lookup, no session, static assets.

### Which clients can actually talk to this

Checked, not assumed:

### Adding it to Claude

There is no documented `claude://` deep link for MCP connectors. In Claude.ai:
**Settings → Connectors → Add custom connector**, paste
`https://mac.jasontally.com/mcp`, then set **No sign in** and **Streamable
HTTP**. Do not pick SSE — that selects the deprecated HTTP+SSE transport, which
this endpoint does not speak.

For clients that take a config file, the equivalent is:

```json
{ "mcpServers": { "mac-lookup": { "url": "https://mac.jasontally.com/mcp" } } }
```

A connector UI probes the endpoint with `initialize` before it can classify the
server. Two failures are worth knowing, because both look like configuration
problems and are not:

- **`405` then "couldn't check the server"** — correct behaviour. 2026-07-28
  removed the standalone GET stream, and a server with none MUST answer GET with
  405. Continue past it.
- **"set up as not requiring sign-in, but the server asked for sign-in (status
  400)"** — a `400` during the auth check being read as an auth challenge. It
  was caused by refusing `initialize`. See the handshake note below.

### The handshake is answered, statelessly

`initialize` is answered, and `2025-06-18`, `2025-11-25` and `2026-07-28` are
all served. This is `legacy: "stateless"` — the reference SDK's mode, and
Cloudflare's default — and it does **not** reintroduce sessions: no session is
created, no `Mcp-Session-Id` is ever issued, and every request is still one
subrequest. Set `LEGACY_HANDSHAKE` to `false` in `build/mcp-shards.mjs` for a
strict 2026-07-28-only endpoint that answers `initialize` with `-32022`.

An unknown protocol version is refused with `-32022 UnsupportedProtocolVersion`
and `data.supported`, which is the affordance the transition depends on: the
client picks a mutually supported version and retries in place. It also matters
for era detection, because a client-side check treats `-32022` as proof the
server is modern, while an unrecognised `400` is the signal for a *legacy*
server. Answering `-32601` to `initialize` therefore made a modern server look
like a legacy one and sent clients down a fallback that cannot work.

### `server/discover` must name the versions, and the failure is silent

A stateless client probes with `server/discover` before it sends anything else,
and it reads the server's supported versions out of the reply. The spec calls
that field `supportedVersions`; a client that pins one version and does not find
it has nothing to negotiate against and reports a version negotiation failure.

The endpoint served the tool catalog for `server/discover`, and the catalog had no
`supportedVersions`. So the endpoint answered `200` with a perfectly good tool
list, and the client failed on its own side. Nothing in the logs pointed at the
server. The tell was the client: a **legacy** client never reads the field, it
handshakes and takes the version from the initialize reply, so the same endpoint
connected from a stateful test tool and failed from every stateless one. This is
the shape of most 2026-07-28 bugs here: the legacy lane works, so the endpoint
looks healthy.

The catalog is now the union of both result shapes. It carries `resultType`,
`supportedVersions`, and `_meta['io.modelcontextprotocol/serverInfo']` for the
modern client, alongside the top-level identity fields a 2025-era client reads.
`MCP_SUPPORTED_VERSIONS` in `build/mcp-shards.mjs` is the single source for both
the snippet's request guard and the advertised list, because a version the guard
refuses is a version a client is told to claim, and one test asserts they agree.

### Marking a result "complete" makes the caching hints mandatory

`resultType: "complete"` is not decoration. The specification says servers **MUST**
include caching hints on results that carry it, and names the fields: `ttlMs`, an
integer in milliseconds, and `cacheScope`, `"public"` or `"private"`. The rule
covers `server/discover` and every list call.

A strict client validator throws away the **whole** result when they are missing.
So the symptom is not "the hints are absent" but **"this server has no tools"**:
the tool list arrived and was discarded with the rest. Nothing on the server
points at the cause, because the response is a correct `200` with a good tool
list in it.

That is how the fix for the missing `supportedVersions` introduced the next fault.
The connection then succeeded, the client asked for the tool list, and came back
with nothing. A third-party playground, reached through its own HTTP API, named
both fields exactly:

```
Invalid result for tools/list: expected number, received undefined   path: ttlMs
Invalid option: expected one of "public"|"private"                     path: cacheScope
```

The tool catalog is identical for every caller and is rewritten only by a build,
so it carries `ttlMs: 3600000` and `cacheScope: "public"`. `resources/read` is the
case that wants `"private"`.

**`resultType` is required on every result, including a tool call.** 2026-07-28
requires it, and the bridge that treats an absent value as complete applies only
to servers on an earlier revision. A strict client throws the **whole** result
away when it is missing, so the symptom is a rejected result rather than a
missing field:

```
Invalid result for tools/call: missing required resultType — servers implementing
protocol revision 2026-07-28 MUST include it (the absent-means-complete bridge
applies only to earlier-revision servers)
```

The lookup was correct and got discarded anyway. The server sees a `200` with a
good vendor in it.

**It is set in `rpcResult`, not at the call sites.** Two bugs in a row came from
adding a field in one place and forgetting the others: `supportedVersions` was
missing from the catalog, and `resultType` was missing from the tool result.
Marking it inside the one function every result passes through means a new method
cannot ship without it. An explicit `resultType` still wins, so an interim result
such as `input_required` is not overridden.

**Testing the stateless lane only.** This one failed in **both** playground
modes, which is the trap. The playground sends its mode choice to `/connect`
alone; its per-request endpoints have no mode flag and re-detect each time. Our
`server/discover` advertises `2026-07-28`, so detection resolves to the strict
modern rule in either mode. "Stateful works" therefore proved nothing, because
stateful was validating against the same strict rule and passing only by luck on
a different method. Test the strict lane first.

**Where the version is read from, and the bug this exposed.** The guard checks
three places, in this order: `params.protocolVersion`, then the
`MCP-Protocol-Version` header, then `_meta` (both under `params` and at the top
level). Order matters. `initialize` puts its version in `params.protocolVersion`,
and that is the only place a real client sends it, because 2025-03-26 removed the
header requirement from the handshake. An earlier version read only the header and
top-level `_meta`, so on `initialize` the guard saw `null` and was skipped, and
`initialize` fell through to a branch that substituted the current version for
anything unrecognised. A client asking for `2025-03-26` or `2024-11-05` received
`200` and was told the server speaks `2026-07-28`; it then sent its own version on
every later request, where the header guard *did* apply and refused it. Waved
through the door, turned away at the counter, with nothing to learn why.

`initialize` now echoes the validated version and has no fallback branch. An
absent version still gets the current one, since a headerless handshake-free
client omits it deliberately. A non-string version is coerced so it is refused
rather than mistaken for an absent field.

| Client | 2026-07-28 | Evidence |
|---|---|---|
| `@modelcontextprotocol/client` 2.2.0 | **Handshake only** | `LATEST_PROTOCOL_VERSION` is `2025-11-25` and it needs `initialize`; it cannot use the header-routed stateless path |
| `agents` (Cloudflare) 0.24.0 | Claimed yes | Cannot run outside workerd — imports use the `cloudflare:` scheme |
| Python `mcp` 2.2.0 | **Handshake only** | Same generation as the TS SDK, same ceiling |
| **Claude.ai** | **Yes** | Netlify: "supported today in Claude.ai and Claude Managed Agents"; Claude Code was "coming soon" at the time of writing |

So for a genuine model round trip, **Claude.ai** is the one to use. A 2025-era
client can still complete the handshake and call tools; it just cannot use the
header-routed stateless path, which 2026-07-28 clients get without any handshake
at all.

`test/mcp-2026-07-28-client.mjs` is therefore a minimal client written from the
specification, and doubles as executable documentation of what a stateless
client does: no handshake, no session, one POST per request, identity in
headers.

### One behaviour worth knowing

`wrangler.jsonc` sets `not_found_handling: "single-page-application"`, so
Cloudflare answers **any** unmatched path with HTTP 200 and the SPA shell as
`text/html`. A missing shard therefore looks like a successful response. The
snippet checks the content type before reading a shard, so the shell is never
scanned as data.

It does *not* treat a missing shard as an error, because 79.3% of the 65,536
possible 4-character buckets have no records, so an empty shard and a missing
one are indistinguishable and empty is the common case. Raising an error would
turn most unregistered lookups into 5xx. The whole-deploy case is caught by
`catalog.json` instead: one file, so if it will not load, nothing was deployed
and both `tools/list` and `server/discover` fail loudly rather than reporting an
empty tool list.

**`catalog.json` must not inherit the shard cache TTL.** The shard rule in
`public/_headers` is `/data/mcp/*.txt`, scoped to the extension on purpose. The
catalog lives in the same directory and is not like a shard: its name never
changes, but its content changes whenever the generator does, and it carries the
advertised protocol versions.

Under a 24-hour TTL, each edge location keeps serving the copy it cached. After a
deploy that fixes the catalog, one location answers `server/discover` with the
new `supportedVersions` and another answers with none, so the endpoint passes in
one place and still fails to negotiate in another, with no error from the server.
That is the shape to recognise: a fix that is deployed, works in one test, and
still fails elsewhere. `catalog.json` now falls through to the platform default,
`public, max-age=0, must-revalidate`, so the edge revalidates on every request.

Note for anyone narrowing the rule instead of widening it: Cloudflare **joins**
the values when two matching rules set the same header. A `no-store` rule for the
catalog placed next to the old wildcard would have produced
`no-store, public, max-age=86400`, which keeps the TTL and reads as nonsense. The
wildcard has to stop matching the catalog. `test/mcp-shards.test.mjs` holds this
property, and also holds that the shards keep their TTL.

## Security review (2026-10-01)

Adversarial pass over the deployed Snippet, before rotating the deployment
token. Findings, in the order they matter.

### The endpoint is unauthenticated, so caller-controlled input is the whole threat model

There is no key, no session, and no per-caller identity, so the only inputs an
attacker has are the request host, the JSON body, and the query string. Each
was tested directly against production.

| Attack | Result |
| --- | --- |
| **SSRF: subrequest redirected off-origin** | Not possible. The shard URL is built from a **hardcoded** `SHARD_PATH` plus a key that is pure hex, so the only variable part is 4–6 hex characters. Separately, Cloudflare documents that Snippets `fetch()` *can* reach external domains, so the host guard matters: a spoofed `Host` of `evil.com`, `mac.jasontally.com.evil.com`, `localhost`, or `169.254.169.254` is rejected with `403` before the Snippet runs, and the handler's own host check is a second line of defence |
| **Path traversal in the shard key** | Not possible. `mac` is validated against `^[0-9A-F]+$` after stripping separators, 6–12 characters. `../../etc/passwd`, `..%2f..`, `AAAA/../BBBB`, and `0000.txt` are all rejected with `-32602` before any fetch |
| **Prototype pollution** | Not possible. `__proto__` and `constructor` fail hex validation |
| **JSON injection via `id`** | Not possible. Every response is built with `JSON.stringify`; an `id` of `</script><script>alert(1)</script>` comes back correctly escaped inside a JSON string |
| **HTML injection via registry data** | No tag characters exist in any of the ~59,000 registry org names (verified across every shard). 178 contain an apostrophe or quote and 16 contain entities such as `&amp;` — harmless in a JSON-encoded text block. **This is a property of the current data, not a guarantee**: a future registry entry containing `<` would flow through unchanged |
| **Resource exhaustion via body size** | **Found and fixed.** See below |

### The finding: an oversized body was parsed before anything checked it

The handler called `request.json()` with no size check. A legitimate lookup is
~110 bytes, so the endpoint was willing to parse a body 800,000 times larger,
unauthenticated and unthrottled.

The cost is real and is CPU, not wall clock. Measured `JSON.parse` cost:

| Body | Parse cost | Against the 5 ms snippet budget |
| --- | --- | --- |
| 5 MB | 5.2 ms | 104% |
| 20 MB | 19.1 ms | 382% |
| 90 MB | 83.3 ms | 1,667% |

A single request could exceed the snippet's entire execution budget several
times over, and it was repeatable concurrently with no credentials.

**Correcting an earlier measurement of mine.** I first reported this as "a 90 MB
POST held the invocation for 33.6 seconds". That was wrong. A 90 MB POST to a
path with **no Snippet at all** returns `405` in 31.7 seconds, so essentially all
of that was my own uplink, not the server working. Isolating it: at 2, 5, and 10
MB the guarded endpoint runs within +0.02 to +0.06 s of a pure upload. The
severity is the CPU table above, not the wall clock.

**The fix** refuses the request on its declared `Content-Length`, before the body
is read, with `413` and JSON-RPC `-32600`. Threshold is 4,096 bytes — roughly 40x
the largest legitimate request. Verified live: 5, 50, and 90 MB bodies are now
refused, and a normal lookup is unaffected.

One honest limitation: the guard reads `Content-Length`, so a chunked request
that declares no length reaches the platform body cap instead. That is not a
free bypass — streaming the bytes costs the caller bandwidth and the server
receiving them either way — but the early rejection does not apply. Guarding that
case would mean reading the body incrementally, which is not worth the snippet
budget.

### What is deliberately not defended

- **No rate limiting.** Any caller may use the endpoint as a free MAC-lookup
  oracle. That is the cost argument, not an oversight, but it does mean the
  endpoint is abusable at volume.
- **CORS is `*`.** Any page may call it from a browser. Safe only because there
  is no credential, no cookie, and no per-user data to expose.
- **Registry data is served verbatim.** The Snippet does no sanitising of org
  names. A client that renders tool output as HTML is relying on the registry
  containing no markup.

## Limits you are working inside

| Limit | Value | Headroom |
|---|---|---|
| Snippet execution | 5 ms | Worst measured scan is 0.42 ms, on the largest carve shard. Comfortable |
| Snippet memory | 2 MB | The snippet holds one response body at a time; the largest shard is a fraction of this |
| Snippet package | 32 KB | About half used. It grew roughly 2x when version negotiation was fixed, so treat the remainder as spendable and re-check after any snippet change |
| Snippet subrequests | **2 on Pro, 3 Business, 5 Enterprise** | **One used per request.** The catalog fetch (`tools/list`) and the shard fetch (`tools/call`) are on mutually exclusive paths, so they never add up |
| Snippets per zone | 0 Free / 25 Pro / 50 Business / 300 Enterprise | One used |
| Static asset files | 100,000 hard limit | Roughly three-quarters used, shared with the whole site. The build asserts against it |
| Static asset requests | unlimited, free | This is the whole cost argument |

The 32 KB package limit is why this endpoint is hand-rolled. No MCP SDK fits in
it, and the smallest public zero-dependency MCP servers on the same platform sit
around 7 KB of protocol layer. Measured sizes, the SDK floor, and the patterns
worth copying: [mcp-comparanda.md](mcp-comparanda.md).

### The plan cliff, which is the one that matters

**Snippets do not exist on the Free plan.** The availability table is
`Free: No`, with **0** snippets and **0** subrequests allowed. If this zone were
ever moved to Free, `/mcp` would not degrade — it would stop existing, with no
code change, no test failure, and nothing in the build to catch it.

Nothing in the repository can detect this today. The deployment token is scoped
to `Snippets Read/Write`, which cannot read a zone's plan, so **there is no
automated guard**. If this endpoint is load-bearing, the cheapest protection is
a deployment step or CI check that fails when the zone plan is Free or when the
zone reports zero Snippets enabled. It needs a token with Zone Read, which is a
token-scope change, not a code change.

## Things that will bite you

**A GET to `/mcp` returns 405, on purpose.** The method guard is what stops a
same-zone subrequest from re-entering the handler. Do not remove it in the hope
of satisfying a client that dislikes the 405; the 2026-07-28 specification lets a
server refuse the optional GET stream, and clients that fail on it are the bug.

**Tell the two 405s apart, because one of them is a routing failure.** The
snippet's own 405 carries `access-control-allow-origin: *`, `allow: POST,
OPTIONS`, and a JSON-RPC body. A 405 with an **empty body and no headers** did not
come from the snippet at all: the rule did not match, the request fell through to
the assets-only Worker, and Static Assets answered because it serves GET and
HEAD only. In the Cloudflare HTTP log that shows up as `originResponseStatus: 0`
with a non-zero `edgeResponseStatus` — no invocation, so there are no Worker logs
to read and no request body to find. Read `clientRequestPath` first; it names the
path the rule failed on. This is what a `POST /mcp/` looked like: the rule matched
`/mcp` exactly, and every client that normalises a trailing slash got the routing
405 instead of the endpoint. Both paths are in the rule now.

**Do not look for an `mcp-protocol-version` response header.** The snippet does
not send one. That name appears only inside `access-control-expose-headers` and
`access-control-allow-headers`, so a test that checks for the bare header fails
even on a healthy response. Use the body: a JSON-RPC result carrying the tool is
something neither fallback can produce.

**Never deepen the shard key past 6 hex characters.** The base is 4 and the
deepest override is 6, which is the shortest registered prefix (MA-L). Go
deeper and a 6-character record is keyed by itself, lands in a different file,
and the lookup silently returns no match instead of an error. `planShards`
throws on a `maxDepth` above 6, but nothing stops you from raising
`SHARD_BASE_DEPTH`; read the file header in `build/mcp-shards.mjs` first.

**The Snippet and the shards must come from the same build.** The 28-byte depth
table is compiled into the Snippet, so a stale Snippet against fresh shards can
produce a miss that looks like "no vendor". Redeploy the Snippet whenever the
shard layout changes. The layout only changes if the registry gains a new dense
cluster, which the build warns about.

**A second Worker is the fallback, not the first choice.** Routes do allow a
second Worker on the same hostname with a more specific pattern, and
`mac.jasontally.com/data/mcp/*` does beat `mac.jasontally.com/*`. Two cautions
if you ever take that path. A Worker *with a script* is billed $0.30 per million
requests, so metering every lookup defeats the purpose; an *assets-only* Worker
on a Custom Domain subdomain stays free. And a same-zone `fetch()` cannot target
a Route, only a Custom Domain, so the Snippet could not reach an assets Worker
attached by Route. The trigger for moving is the main page count approaching
75,000, not the current shard count.

**`data/mcp/**` is a cache, not an interface.** It is documented in `llms.txt` for
clients that cannot speak MCP, but an agent that reads it directly has to do the
longest-prefix match itself, which is the failure mode this endpoint exists to
remove. Keep the MCP server first in `llms.txt` and the shards second. They are.

## Rolling back

The endpoint is additive. To retire it: delete the Snippet, then rebuild and
deploy to drop the shards. `llms.txt`, `help.md`, and `help.txt` are generated,
so re-run the build before publishing if you want the docs to match.
