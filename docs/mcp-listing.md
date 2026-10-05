# Listing the MCP server in directories and registries

`/mcp` is a public, unauthenticated MCP server over Streamable HTTP. This
document is the runbook for getting it listed everywhere that matters, in the
order that makes each step easier than the last.

It covers two things: what the repository already ships for this purpose, and
the steps that only the account holder can do. No step needs a payment method.
Several directories sell a faster review as an extra; every one of them also
has a free path, except mcp.so, where the free path is reported by users and not
confirmed by their own pages.

Read `docs/mcp-endpoint.md` first for how the endpoint itself works and why it
answers the way it does. Several checkers below behave differently because of
those choices.

## What is being listed

| Item | Value |
| --- | --- |
| Endpoint | `https://mac.jasontally.com/mcp` |
| Transport | Streamable HTTP. No SSE endpoint, and none is planned |
| Tools | One: `lookup` |
| Authentication | None. No key, no OAuth, no token, no cookie |
| Session | None. No `Mcp-Session-Id` is ever issued |
| Namespace | `com.jasontally.mac/mcp` |
| Source | <https://github.com/jasontally/mac-address-lookup> (MIT) |
| Product page | <https://mac.jasontally.com> |
| Documentation | <https://mac.jasontally.com/help> |
| Icon | `https://mac.jasontally.com/favicon.svg` |

For a client that reads a configuration file:

```json
{ "mcpServers": { "mac-lookup": { "url": "https://mac.jasontally.com/mcp" } } }
```

## What the repository already carries

These files exist so a checker that reads metadata does not have to guess. They
are committed, so they survive every deploy.

| File | Purpose |
| --- | --- |
| `server.json` | The document the official MCP Registry publishes. Remote-only: `remotes`, no `packages` |
| `public/.well-known/mcp/server-card.json` | The same document at the path clients probe for pre-connection discovery (SEP-1649) |
| `public/.well-known/ai-catalog.json` | ARD 1.0 AI Catalog declaring the MCP server |
| `public/.well-known/ard.json` | The same catalog under the ARD name |
| `public/.well-known/oauth-protected-resource/mcp` | RFC 9728 metadata naming no authorization server, because the endpoint needs none |
| `llms.txt`, `help.md`, `help.txt` | Prose description and the data downloads, for clients that cannot speak MCP |
| `server.json` test | `test/mcp-listing.test.mjs` keeps the two copies identical and asserts the fields the registry schema requires |

Check them all at once:

```sh
node --test test/mcp-listing.test.mjs
curl -sS https://mac.jasontally.com/.well-known/mcp/server-card.json
```

The card is a byte-for-byte copy of `server.json`. If you change one, copy it to
the other. The test fails if they drift, because a registry that names one
endpoint and a discovery card that names another is worse than either alone.

## Order of work

Step 2 is done. The rest, in order:

| # | Destination | Cost | Needs the account holder |
| --- | --- | --- | --- |
| 1 | Official MCP Registry | Free | Yes: one DNS record, one CLI login |
| 3 | `punkpeye/awesome-remote-mcp-servers` | Free | Yes: a GitHub account, and star the list first |
| 4 | Docker MCP Catalog | Free | Yes: a fork and a PR |
| 5 | Anthropic connectors directory | Free on a paid Claude plan | Yes: an organization admin |
| 6 | OpenAI ChatGPT app directory | Free | Yes: a verified organization |
| 7 | GitHub MCP gallery | Free | Yes: a discussion request |
| 8 | Smithery, mcp.so, mcpservers.org, MCPMarket, MCP.Directory, LobeHub | Free or freemium | Yes: an account on each |
| 9 | `soxoj/awesome-osint-mcp-servers` | Free | Yes, and last of all |

Step 1 goes first because the other directories ingest from it. Step 3 needs the
Glama badge from step 2, which is done. Step 9 goes last, and on its own: the
maintainer of that list asks that one list is not opened at the same time as
others, because identical pull requests across many lists read as growth
hacking.

## Step 1: the official MCP Registry

<https://registry.modelcontextprotocol.io> is the canonical index. Several
directories below ingest from it, so this one submission is the one with the
widest reach.

Free. No payment. The registry is in preview, so breaking changes and data
resets are still possible.

### What is already done

`server.json` at the repository root is the published document. It declares the
namespace, the version, the repository, the icon, and the one remote endpoint.

### Why the namespace names the subdomain

The name is `com.jasontally.mac/mcp`: the reverse DNS form of the host that
answers, `mac.jasontally.com`. The registry lets DNS proof of a domain grant the
domain and all its subdomains, so proving `jasontally.com` covers this name.

The subdomain form is a deliberate choice. It ties the identity to the host that
actually serves the endpoint, and it puts later ownership proofs, such as the
Glama claim file, on this site rather than on the apex domain.

The registry is the only remaining step that needs DNS. Glama is done. Smithery
verification also uses a DNS TXT record, and it is the only other one, so DNS
work appears twice in this document and nowhere else.

### Prove the domain

Install the publisher CLI. The binary move needs root, so run this step
yourself:

```sh
curl -L "https://github.com/modelcontextprotocol/registry/releases/latest/download/mcp-publisher_$(uname -s | tr '[:upper:]' '[:lower:]')_$(uname -m | sed 's/x86_64/amd64/;s/aarch64/arm64/').tar.gz" | tar xz mcp-publisher && sudo mv mcp-publisher /usr/local/bin/
```

On macOS the system `openssl` is LibreSSL, which cannot generate an Ed25519
key. Use OpenSSL 3 for this step (`brew install openssl@3`), or use the ECDSA
P-384 route below, which LibreSSL supports.

```sh
openssl genpkey -algorithm Ed25519 -out /tmp/mcp-registry-key.pem
PUBLIC_KEY="$(openssl pkey -in /tmp/mcp-registry-key.pem -pubout -outform DER | tail -c 32 | base64)"
echo "jasontally.com. IN TXT \"v=MCPv1; k=ed25519; p=${PUBLIC_KEY}\""
```

Add that TXT record in the Cloudflare dashboard for `jasontally.com`. Two rules
that catch almost everyone:

- Put the record at the **apex**, so the Name field is `@`. Registry
  authentication follows SPF placement, not DKIM placement. A record under a
  selector such as `_mcp.jasontally.com` is never read, and the login fails with
  a signature error that looks like a key problem.
- Remove an older record for the same domain when you rotate the key. A stale
  record is tried first and fails.

Wait for propagation, then check it:

```sh
dig +short TXT jasontally.com | grep 'v=MCPv1'
```

Log in, validate, publish:

```sh
mcp-publisher login dns --domain jasontally.com \
  --private-key "$(openssl pkey -in /tmp/mcp-registry-key.pem -noout -text | grep -A3 'priv:' | tail -n +2 | tr -d ' :\n')"

mcp-publisher validate          # reports every problem at once
mcp-publisher publish
```

For ECDSA P-384 instead, generate with `openssl genpkey -algorithm EC
-pkeyopt ec_paramgen_curve:secp384r1`, and pass `--algorithm ecdsap384` to
`login`. Without that flag the key is rejected as a wrong seed length.

### Verify

```sh
curl -sS "https://registry.modelcontextprotocol.io/v0.1/servers?search=com.jasontally.mac%2Fmcp"
curl -sS "https://registry.modelcontextprotocol.io/v0.1/servers/com.jasontally.mac%2Fmcp/versions/latest"
```

### What cannot be changed later

- The namespace is permanent. There is no rename and no delete; an entry that
  must go is marked `deprecated` or `deleted`.
- Metadata is immutable. A change means a new version string. Use a semantic
  version, and use a prerelease such as `1.0.0-1` when only metadata changed.
- Version ranges are rejected. `^1.0.0` and `1.x` fail; `1.0.0` and `2026.10.02`
  pass.

### Automating it

The registry also publishes from GitHub Actions using GitHub OIDC, for the
`io.github.*` namespaces. A DNS-verified domain cannot use that path, so the
CLI stays the route for this server. See
<https://modelcontextprotocol.io/registry/github-actions>.

## Step 2: Glama, as a connector

<https://glama.ai> scores and health-checks every server it lists. Two parts:
add the connector, then claim it.

Free. A claim is not required to be listed, but an unclaimed listing cannot be
edited and carries no health signal.

### Add the connector

Sign in, open the connectors page, choose **Add MCP Server → Connector**, and
give it:

- Name: `MAC Address Lookup`
- Description: the sentence from `server.json`, or the longer one from
  `llms.txt`
- URL: `https://mac.jasontally.com/mcp`, HTTPS, `streamable-http`
- Test credentials: leave empty. The server needs none, and Glama accepts a
  no-auth connector

Glama runs `tools/list`, `resources/list` and `prompts/list` against the
endpoint and scores what comes back.

### Claim the listing

Claiming proves you control the endpoint. It does not move or proxy anything.
One verification covers every connector under the identity you verify.

For a connector linked to an official registry domain namespace, Glama verifies
the domain the namespace names, which here is `mac.jasontally.com`. Use the HTTP
proof: it needs no DNS change, and the file belongs in this repository.

```sh
# 1. Sign in to Glama, start "Claim ownership" on the connector listing, and
#    copy the token Glama shows you.
# 2. Add the file below at public/.well-known/glama.json
{
  "$schema": "https://glama.ai/mcp/schemas/connector.json",
  "claim": "glama_claim_..."
}
```

```sh
# 3. Deploy, then press Check on the listing page.
curl -sS https://mac.jasontally.com/.well-known/glama.json
```

The file must be public, served over HTTPS, and must not redirect to another
host. Never put an email address or any session token in it.

Glama states the rule for a two-label namespace. If it asks for
`jasontally.com` instead of `mac.jasontally.com`, take the TXT record it shows
at `_glama-claim` instead. Both are one record on a domain you control, so
neither route needs anything from a third party.

Glama keeps syncing name, description, and URL from the registry. Turn on **Use
Glama listing details as the source of truth** only if you intend to edit those
fields on Glama.

## Step 3: punkpeye/awesome-remote-mcp-servers

<https://github.com/punkpeye/awesome-remote-mcp-servers> is the list for
hosted servers. Its sibling list, `awesome-mcp-servers`, now refuses remote
entries by scope, so do not file there.

Free. Merge time on recent pull requests is same day. Two rules that are easy to
miss:

- Star the repository before you open the pull request. Pull requests from an
  account that has not starred it are not merged.
- The entry needs a Glama connector badge, so step 2 comes first.

Entry format, from that list's CONTRIBUTING:

```markdown
- [MAC Address Lookup](https://mac.jasontally.com) `https://mac.jasontally.com/mcp`
  [![MAC Address Lookup MCP connector](https://glama.ai/mcp/connectors/<namespace>/<name>/badges/score.svg)](https://glama.ai/mcp/connectors/<namespace>/<name>)
  🔓 - Resolve a MAC address or OUI prefix to its registered organization in the IEEE MA-L, MA-M, MA-S, IAB, and CID registries.
```

Take `<namespace>/<name>` from the Glama connector URL, which is the path on the
listing page. The API returns it as one string, with a Glama API key:

```sh
curl -sS "https://glama.ai/api/mcp/v1/connectors?query=mac.jasontally.com" \
  -H "Authorization: Bearer $GLAMA_API_KEY"
```

Place the entry alphabetically inside its category. Adding a category when
nothing fits is allowed. The description ends with a period.

The marker `🔓` means no authentication, and the workflow checks it rather than
trusting it: it POSTs `initialize` and reads the marker from the response. This
server answers with HTTP 200 and a `result`, so the check produces `🔓`.

## Step 4: Docker MCP Catalog

<https://github.com/docker/mcp-registry> is the catalog Docker Desktop and
Docker Agent read. Free. Every pull request needs a review from the Docker team.

A remote entry needs no Dockerfile and no image. Fork the repository and add
`servers/mac-address-lookup/` with three files:

`servers/mac-address-lookup/server.yaml`

```yaml
name: mac-address-lookup
type: remote
meta:
  category: security
  tags:
    - network
    - mac-address
    - oui
    - ieee
    - remote
about:
  title: MAC Address Lookup
  description: Find the organization behind a MAC address or OUI prefix in the IEEE MA-L, MA-M, MA-S, IAB, and CID registries.
  icon: https://mac.jasontally.com/favicon.svg
remote:
  transport_type: streamable-http
  url: https://mac.jasontally.com/mcp
```

`servers/mac-address-lookup/tools.json`

```json
[]
```

`servers/mac-address-lookup/readme.md`

```markdown
Docs: https://mac.jasontally.com/help
```

Notes:

- Omit the `oauth` block and `dynamic.tools`. That is what the
  cloudflare-docs entry, which also has no auth, does.
- `security` and `search` are both categories the catalog already uses. Pick the
  one that fits the listing you want; a lookup of registered hardware is closer
  to `security`.
- Continuous integration fetches the tool list from the URL and checks the icon
  is reachable, so both must answer.

## Step 5: Anthropic connectors directory

<https://claude.ai/directory/manage> → **Submit new** → **MCP connector**.
Guide: <https://claude.com/docs/connectors/building/submission>.

Free on any paid Claude plan. Anthropic scans a submission for policy and
publishes it as a Community connector without further action from you. No domain
proof is required here; that rule applies to the open registry, not this
directory.

The submission form asks for the items the repository already has:

| Field | Value |
| --- | --- |
| Server URL | `https://mac.jasontally.com/mcp` |
| Authentication | No authentication, public data |
| Documentation URL | `https://mac.jasontally.com/help` |
| Privacy policy URL | `https://mac.jasontally.com/privacy` |
| Terms URL | `https://mac.jasontally.com/terms` |
| Support contact | An address that a person reads |
| Icon | `https://mac.jasontally.com/favicon.svg` |

The `lookup` tool already carries a `title` and `readOnlyHint`, so the tool
requirements are met. The form also asks for test credentials. Leave them empty
and say why in the form: the endpoint has no accounts and no per-user data.

## Step 6: OpenAI ChatGPT app directory

<https://developers.openai.com/plugins/deploy/submission>. Free. Requires a
verified organization and the Owner role in it.

Requirements this server already meets:

- A publicly reachable MCP server on a real domain. No local or test endpoint.
- Every tool sets `readOnlyHint`, `openWorldHint`, and `destructiveHint`
  explicitly. Missing or null hints are submission blockers, and `lookup` sets
  all three.
- Auth is optional. Select none.

You must supply the app name, logo, description, company, privacy policy URL,
test prompts with their responses, and localization information. The platform's
**Scan Tools** step reads the endpoint and imports the tool list, so the answers
in the form must match what the tool really returns.

The platform also asks for a content security policy that allows the exact
domains you fetch from, because the submission contains an app.

## Step 7: GitHub MCP gallery

<https://github.com/mcp> mirrors official registry entries. There is no form.
Onboarding is manual curation, so ask in a discussion at
<https://github.com/github/github-mcp-server/discussions/categories/q-a> and
give the evidence:

```markdown
## Request
Please onboard the MAC Address Lookup MCP server for use with GitHub MCP
discovery/catalog surfaces.

## Server ID
`com.jasontally.mac/mcp`

## Registry Evidence
The server is active in the official MCP Registry:

    curl -sS "https://registry.modelcontextprotocol.io/v0/servers/com.jasontally.mac%2Fmcp/versions/latest"

Expected fields: `server.name` `com.jasontally.mac/mcp`, `server.title`
"MAC Address Lookup", `server.version` "1.0.0", `server.repository.url`
"https://github.com/jasontally/mac-address-lookup", remote endpoint
"https://mac.jasontally.com/mcp".

## Source Code
- Repository: https://github.com/jasontally/mac-address-lookup

## Notes
Public, unauthenticated, read-only. Streamable HTTP, no sessions. One tool,
`lookup`.
```

This route is undocumented. Treat it as a request, not a process, and expect no
answer within a week. Republishing the registry entry changes nothing here.

## Step 8: the form directories

Each of these takes an account and a form. None requires a payment method on the
free path, with the one uncertainty noted for mcp.so.

### Smithery

<https://smithery.ai/new>, or the CLI. The package is `smithery` and the command
is `smithery`:

```sh
npx -y smithery@latest auth login
npx -y smithery@latest mcp publish "https://mac.jasontally.com/mcp" -n jasontally/mac-address-lookup
```

Free on the Hobby tier. Smithery connects to the endpoint and reads the tool
list itself, so a server that is down cannot be listed at all. It scans with the
user agent `SmitheryBot/1.0 (+https://smithery.ai)`, which this zone answers
normally today.

Two risks. Bot Fight Mode on the Cloudflare zone, if it is ever turned on, is
not bypassable by a WAF rule on the free plan, so check the zone settings before
publishing.

Smithery also offers a static server card at `/.well-known/mcp/server-card.json`
for servers its scanner cannot read, such as one behind an auth wall. It expects
the SDK shape, with `serverInfo`, `tools`, `resources`, and `prompts`. The card
on this site is the registry shape, with `name`, `version`, and `remotes`, so it
does not fill that fallback and is not meant to. The automatic scan reads a
public server without help, so nothing is needed here.

### Verification on Smithery

After publishing, open the server page, choose **Settings → Verification**, and
complete the checklist. It has two parts, and both are work on resources you
control:

- Add the TXT value Smithery shows, on the host the server is served from. Keep
  the existing TXT values on that name.
- Add a backlink to the Smithery listing in the repository README. The canonical
  form is `https://smithery.ai/servers/<namespace>/<slug>`, lower case, which for
  the name below is `https://smithery.ai/servers/jasontally/mac-address-lookup`.

This badge is optional. It marks a verified listing; it is not a condition of
being listed.

### mcp.so

<https://mcp.so/submit?type=remote-server> has a tab for a remote endpoint, so
pick that one rather than the tab that asks for a GitHub repository. Free review
is offered next to a $39 instant option; the free path is reported to work with
the paid option left unticked, but this is not confirmed by their own pages.
Submission requires signing in. Turnaround on the free path is not stated.

### mcpservers.org

<https://mcpservers.org/submit>. The form has a free option at $0 with review
inside two weeks, and a $39 option with a 24-hour turnaround. Tick the box that
says the server supports remote connections, and fill the official registry name
field with `com.jasontally.mac/mcp` once step 1 is done.

### MCPMarket

<https://mcpmarket.com/submit>, remote tab. Free queue is $0 with an average
four to six week wait. A $29 one-time payment shortens it to 24 hours and adds a
badge. The free path is slow but real.

### MCP.Directory

<https://mcp.directory/submit>. Free, no payment step. The form has no URL
field: it asks for a GitHub repository and detects the tools by analyzing the
implementation. This repository is public and the tool catalog is in
`build/mcp-shards.mjs`, so detection has something to read, but a static site is
not what it expects. It also ingests the official registry on its own, so step 1
may produce the listing without the form.

### LobeHub marketplace

No form. A CLI publishes it:

```sh
npx -y @lobehub/market-cli login
npx -y @lobehub/market-cli github connect
npx -y @lobehub/market-cli plugin init --url https://mac.jasontally.com/mcp --dir .
npx -y @lobehub/market-cli plugin publish https://github.com/jasontally/mac-address-lookup --dir .
```

Free. Two browser sign-ins. Guide: <https://market.lobehub.com/s/publish-mcp>.

One risk, and it is the only real compatibility question in this document. The
`init` step runs a full handshake: `initialize`, `tools/list`,
`resources/list`, `resources/templates/list`, and `prompts/list`. This server
answers the last three with JSON-RPC error `-32601`, which is correct for a
tools-only server, but it is not confirmed that the CLI tolerates it. Run
`plugin init` first. If it fails on those three, that is the cause, and the
fix is a deliberate change to the endpoint rather than a different submission.

## Step 9: soxoj/awesome-osint-mcp-servers

<https://github.com/soxoj/awesome-osint-mcp-servers> is small and active, and
its maintainer hand-runs an `initialize` handshake against any hosted endpoint,
which this server passes.

Entry format:

```markdown
- 🆓 [MAC Address Lookup](https://mac.jasontally.com) — Resolve a MAC address or OUI prefix to its registered organization in the IEEE registries. Free, no key, no auth. MCP: https://mac.jasontally.com/mcp
```

There is a `## Network Scanning` section. Submit this one on its own, a few days
after the others, because the list asks that identical pull requests are not
opened across many lists at the same time.

## Do not spend time on these

| Destination | Why not |
| --- | --- |
| PulseMCP | <https://www.pulsemcp.com/submit> states submissions are paused and points at the official registry |
| `punkpeye/awesome-mcp-servers` | Scope now excludes remote-only servers |
| `jaw9c/awesome-remote-mcp-servers` | CONTRIBUTING requires OAuth 2.0. Recent pull requests closed unmerged |
| `appcypher/awesome-mcp-servers` | Archived, pull requests disabled |
| `YuzeHao2023/Awesome-MCP-Servers`, `ever-works/awesome-mcp-servers` | Latest pull requests closed unmerged |
| `tensorchord/Awesome-MCP`, `w5tech-labs/awesome-mcp-servers` | Do not exist, 404 |
| LibHunt | A repository tracker, not an MCP directory. Ranks by mentions elsewhere, so a new repository scores near zero |
| Any $39 or $69 tier | The free path exists for every entry in this document |

## Behaviours that can make a checker fail

These are correct. They are listed so a failure can be recognized instead of
debugged.

| Behaviour | Why it is correct | What to do if a checker objects |
| --- | --- | --- |
| A POST with an `Origin` header from another site returns `403` | The specification requires servers to validate `Origin` to prevent DNS rebinding, and nothing upstream does it for us — Cloudflare implements that inside its `agents` SDK wrapper, which this endpoint does not use. A request with **no** `Origin` is served normally, so curl and non-browser clients are unaffected | Do not strip the check. If a checker objects, it is a browser-origin policy question, not a bug |
| `GET /mcp` returns 405 | A GET that does not ask for `text/event-stream` is not a stream request, and the 405 is what stops a same-zone subrequest from re-entering the handler. A GET that *does* ask for a stream is served one, as a compatibility shim: the specification says a single-revision server SHOULD answer 405, and `SHOULD` is not `MUST`. See [mcp-endpoint.md](mcp-endpoint.md#get-is-served-as-a-stream-for-old-transport-probes) | Do not remove the 405. It is the re-entry guard |
| `resources/list` and `prompts/list` return `-32601` | The server exposes tools only, and method-not-found is the correct answer | Change the endpoint on purpose if a client cannot cope. Do not work around it per directory |
| No `MCP-Protocol-Version` response header | The header is optional, and this snippet does not send one. The name appears only inside `access-control-expose-headers` | Read the body instead. A JSON-RPC result carrying the tool is something no fallback produces |
| `initialize` creates no session | Statelessness is the design. No session, no `Mcp-Session-Id`, one subrequest per call | None |
| Unknown paths return HTML with a 200 | `wrangler.jsonc` sets `not_found_handling: single-page-application`. Every real well-known path has a real file, which is why the card, the catalogs, and the RFC 9728 document are committed files rather than routes | Add a file for any path a checker reads |
| The listing gives no installable package | The endpoint is a hosted service with no npm or PyPI artifact, which the registry accepts as a remote-only entry | None. Do not publish an empty package to satisfy a form that assumes one |

## Verify the whole list

```sh
# The endpoint is a working tools-only server
curl -sS https://mac.jasontally.com/mcp -H 'content-type: application/json' \
  -d '{"jsonrpc":"2.0","id":1,"method":"tools/list"}' | head -c 200

# A real lookup
curl -sS https://mac.jasontally.com/mcp -H 'content-type: application/json' \
  -d '{"jsonrpc":"2.0","id":1,"method":"tools/call",
       "params":{"name":"lookup","arguments":{"mac":"8C:1F:64:AF:A4:B2"}}}'

# The discovery documents
curl -sS https://mac.jasontally.com/.well-known/mcp/server-card.json
curl -sS https://mac.jasontally.com/.well-known/ai-catalog.json
curl -sS https://mac.jasontally.com/.well-known/oauth-protected-resource/mcp

# The registry, after step 1
curl -sS "https://registry.modelcontextprotocol.io/v0.1/servers?search=com.jasontally.mac%2Fmcp"
```