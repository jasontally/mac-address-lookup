/**
 * Install the /mcp Snippet on the zone.
 *
 * Workers Builds cannot do this. The configured deploy command is
 * `npx wrangler deploy && node build/indexnow.mjs`, wrangler has no `snippets`
 * subcommand, and Snippets is a zone-level Rules resource rather than a Worker
 * artifact. So this script owns that one step.
 *
 * It reads `mcp/snippet.js` — the committed, drift-checked artifact that
 * `npm run mcp:accept` writes and `build.mjs` verifies — so the code on the zone
 * is the code under review. The rule expression comes from `mcpRuleExpression()`
 * in the same module the build uses, so the rule, the snippet's own header
 * comment, and the snippet's `HOST` guard cannot drift.
 *
 * The artifact is reviewed as source and uploaded minified. Cloudflare's 32 KB
 * Snippet limit counts raw source: a snippet padded with comments to 40 KB raw
 * but 8.6 KB minified was rejected with "maximum snippet size of 32.00KB is
 * exceeded". So the limit applies to the bytes sent, and the fix is to send fewer
 * of them rather than to write fewer comments. The source keeps its comments,
 * which is what makes it reviewable.
 *
 * Minification is behaviour-preserving here and that is asserted, not assumed:
 * `test/minify-behaviour.mjs` runs both forms through every method, every error
 * path, and the Origin and id guards, and requires byte-identical responses.
 *
 *   CLOUDFLARE_API_TOKEN=... CLOUDFLARE_ZONE_ID=... node build/deploy-mcp-snippet.mjs [--dry-run]
 *
 * The token needs `Snippets Write` and `Snippets Read` on the zone. The
 * wrangler OAuth token from `npx wrangler login` is not sufficient: it carries
 * `zone (read)` and the workers scopes, and gets `Authentication error`
 * (code 10000) on GET /zones/{id}/snippets.
 *
 * Endpoints, confirmed against the API schema:
 *   PUT /zones/{zone_id}/snippets/{snippet_name}   create or update, multipart
 *   GET /zones/{zone_id}/snippets                   list
 *   GET /zones/{zone_id}/snippets/snippet_rules     the ordered rule list
 *   PUT /zones/{zone_id}/snippets/snippet_rules     replace the rule list
 */

import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { mcpRuleExpression, SITE } from './mcp-shards.mjs';
import { mergeSnippetRule, rulesMatch } from './snippet-rules.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

/**
 * Snippet name on the zone. Stable: it is the identity the rule references.
 * The API accepts only a-z, 0-9, and underscore here, so this cannot be
 * `mcp-lookup`; Cloudflare rejects a hyphen with
 * "snippet_name can only contain the characters a-z,0-9, and _".
 */
const SNIPPET_NAME = 'mcp_lookup';
const SNIPPET_FILE = path.join(root, 'mcp', 'snippet.js');

/** File name inside the multipart upload; also the entry point named in metadata. */
const MODULE_FILE = 'snippet.js';
const API = 'https://api.cloudflare.com/client/v4';

const argv = process.argv.slice(2);
const dryRun = argv.includes('--dry-run');
/**
 * Read `--name value` from argv.
 *
 * This was `args.value('--zone')` on a `Set`, which has no such method, so every
 * invocation without `CLOUDFLARE_ZONE_ID` died on a TypeError before printing its
 * own "not set" message. Found while testing that a bad token fails loudly: the
 * missing-token path never reached its own error. A `Set` only answers `has`, so
 * the lookup is written out here.
 */
function flagValue(name) {
  const at = argv.indexOf(name);
  return at === -1 || at === argv.length - 1 ? null : argv[at + 1];
}
const token = process.env.CLOUDFLARE_API_TOKEN;
const zoneId = process.env.CLOUDFLARE_ZONE_ID ?? flagValue('--zone');

if (!token) {
  console.error('CLOUDFLARE_API_TOKEN is not set.');
  console.error('  Needs Snippets Read + Snippets Write, scoped to the zone.');
  process.exit(1);
}
if (!zoneId) {
  console.error('CLOUDFLARE_ZONE_ID is not set. Find it in the dashboard, Zone Overview.');
  process.exit(1);
}

async function api(route, init = {}) {
  const response = await fetch(`${API}${route}`, {
    ...init,
    headers: { authorization: `Bearer ${token}`, ...(init.headers || {}) },
  });
  const text = await response.text();
  let body = null;
  try {
    body = text ? JSON.parse(text) : null;
  } catch {
    body = { raw: text.slice(0, 400) };
  }
  if (!response.ok || body?.success === false) {
    const detail = (body?.errors || []).map((e) => `${e.code}: ${e.message}`).join('; ') || response.status;
    throw new Error(`${init.method || 'GET'} ${route} -> ${response.status} ${detail}`);
  }
  return body?.result;
}

const snippetRoute = (id) => `/zones/${id}/snippets/${encodeURIComponent(SNIPPET_NAME)}`;
const rulesRoute = (id) => `/zones/${id}/snippets/snippet_rules`;

// Review the source, upload the minified form. See the header: the 32 KB limit
// counts raw source, so this is what keeps the commented, reviewable artifact
// deployable. `legalComments: 'none'` because there are no legal comments to keep
// and the file must be reproducible byte-for-byte from the committed source.
const source = await readFile(SNIPPET_FILE, 'utf8');
const { transform } = await import('esbuild');
const code = (await transform(source, { loader: 'js', minify: true, target: 'es2022', legalComments: 'none' })).code;
const expression = mcpRuleExpression();

// The rule DESCRIPTION is the only place we can record which build is installed,
// because the API will not hand back snippet code to compare against. Without it
// there is no way to tell a zone running last week's snippet from one running
// this week's, short of uploading. That matters if this script is wired into
// Workers Builds, where it would run on every push: a stale zone would otherwise
// look identical to a current one.
//
// Workers Builds injects `WORKERS_CI_BUILD_UUID` into every build; see the "Default
// variables" table in its configuration docs. `CF_BUILD_ID` is not a thing, and
// an invented name would have silently fallen back to the timestamp in CI, which
// is the one place a real identifier was wanted. Locally there is no build, so
// the timestamp stands in, which is still enough to tell two manual deploys apart.
const buildId = process.env.WORKERS_CI_BUILD_UUID || new Date().toISOString().slice(0, 19) + 'Z';
const description = `Serve the stateless MCP lookup endpoint at /mcp and /mcp/ (${buildId})`;

const ourRule = {
  snippet_name: SNIPPET_NAME,
  expression,
  description,
  enabled: true,
};

const observed = await api(rulesRoute(zoneId)).catch((error) => {
  // A zone that never had a rule list 404s, which means "no rules" rather than
  // a failure. Anything else is real.
  if (/\b404\b/.test(error.message)) return null;
  throw error;
});

// The PUT below replaces the WHOLE list, and this zone is shared. The rule list
// also carries `icanhazip`, which belongs to another project and covers 69
// subdomains of jasontally.com. Sending a single-rule list would delete it, so
// merge into whatever is installed instead of replacing the list.
const desiredRules = mergeSnippetRule(observed, ourRule);
const foreign = (Array.isArray(observed) ? observed : []).filter(
  (rule) => rule.snippet_name !== SNIPPET_NAME,
);

const needsCode = !dryRun;
const needsRules = !rulesMatch(desiredRules, observed);

// Both numbers, because they answer different questions and the limit is on the
// uploaded one. Source is what is reviewed; minified is what Cloudflare counts.
console.log(
  `snippet  ${SNIPPET_NAME}  ${(code.length / 1024).toFixed(1)} KB uploaded (minified) ` +
    `from ${(source.length / 1024).toFixed(1)} KB of reviewed source in ${path.relative(root, SNIPPET_FILE)}`,
);
console.log(`rule     ${expression}`);
console.log(`zone     ${zoneId} (${SITE})`);
console.log(`current  ${observed ? `${observed.length} rule(s)` : 'no rule list'}`);
console.log(`keeping  ${foreign.length} rule(s) owned by others: ${foreign.map((r) => r.snippet_name).join(', ') || 'none'}`);
// What is installed, so a stale zone is visible in the log rather than silent.
const installed = (observed || []).find((rule) => rule.snippet_name === SNIPPET_NAME);
console.log(`stamp    ${installed ? installed.description : '(no rule for this snippet)'}`);
console.log(`build    ${buildId}`);
console.log(`plan     upload code: ${dryRun ? 'skipped (--dry-run)' : 'yes'} | rules: ${needsRules ? 'update' : 'already current'}`);

if (dryRun) {
  console.log('\n--dry-run: nothing was sent.');
  process.exit(0);
}

if (needsCode) {
  const form = new FormData();
  // The API requires a `metadata` part alongside the module, and names the
  // entry point in it. `main_module` is the wire key (the SDK maps camelCase
  // `mainModule` to it).
  form.set('metadata', JSON.stringify({ main_module: MODULE_FILE }));
  form.set(MODULE_FILE, new Blob([code], { type: 'text/javascript' }), MODULE_FILE);
  const result = await api(snippetRoute(zoneId), { method: 'PUT', body: form });
  console.log(`\nuploaded  snippet_name=${result?.snippet_name} modified_on=${result?.modified_on ?? 'n/a'}`);
}

if (needsRules) {
  const result = await api(rulesRoute(zoneId), {
    method: 'PUT',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ rules: desiredRules }),
  });
  const count = Array.isArray(result) ? result.length : 'n/a';
  console.log(`rules     replaced with ${count} rule(s)`);
} else {
  console.log('rules     unchanged');
}

const finalRules = await api(rulesRoute(zoneId));

// Read the list back and prove every foreign rule survived. A PUT that drops
// another project's rule is silent: it returns 200 with the shortened list. This
// is the only place that failure would become visible.
const survivors = (Array.isArray(finalRules) ? finalRules : []).filter(
  (rule) => rule.snippet_name !== SNIPPET_NAME,
);
const lost = foreign.filter((was) => !survivors.some((now) => now.snippet_name === was.snippet_name));
if (lost.length > 0) {
  console.error(
    `\nABORT: the PUT removed rule(s) owned by another project: ${lost.map((r) => r.snippet_name).join(', ')}.\n` +
      '       Restore them from build/deploy-mcp-snippet.mjs or the API before anything else.',
  );
  process.exit(1);
}
console.log(`\nverify    ${finalRules.length} rule(s); ${survivors.length} foreign rule(s) intact: ${survivors.map((r) => r.snippet_name).join(', ') || 'none'}`);
console.log('\nNext: curl -sS https://mac.jasontally.com/mcp -H \'content-type: application/json\' \\');
console.log("  -d '{\"jsonrpc\":\"2.0\",\"id\":1,\"method\":\"tools/list\"}'");
