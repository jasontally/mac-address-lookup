/**
 * Pure helpers for editing one entry in the zone-wide Snippet rule list.
 *
 * `PUT /zones/{id}/snippets/snippet_rules` REPLACES the entire list. It is not a
 * per-rule PATCH. So a script that sends only its own rule deletes every other
 * rule on the zone. The zone is shared: `jasontally.com` also runs the
 * `icanhazip` snippet, whose rule covers 69 subdomains. Deploying the MCP
 * endpoint from a script that sent a single-rule list would have removed it.
 *
 * These helpers keep the other rules byte-for-byte and replace only our entry,
 * in place, so the list keeps its order and length unless it really changed.
 */

/** The only fields the rule list API accepts. `id` and `last_updated` are read-only. */
const WRITABLE = ['snippet_name', 'expression', 'description', 'enabled'];

/**
 * Reduce a rule from the observed list to the fields we may send back.
 * A key the API did not return stays absent rather than becoming `null`.
 */
function writable(rule) {
  const out = {};
  for (const key of WRITABLE) {
    if (rule[key] !== undefined) out[key] = rule[key];
  }
  return out;
}

/**
 * The full list to PUT: every observed rule except ours, plus ours.
 *
 * Our rule keeps its original position when it is already on the zone, so a
 * redeploy does not reorder the list. When we are not installed yet we append,
 * which puts us last. That is safe only because our expression and the other
 * snippets' expressions are disjoint; if two snippets could match the same
 * request, order would matter and the caller needs to decide placement.
 *
 * Any duplicate rules for our snippet collapse to the single rule we send, since
 * sending one of them unchanged would leave a stale second copy.
 */
export function mergeSnippetRule(observed, ours) {
  const list = Array.isArray(observed) ? observed : [];
  const index = list.findIndex((rule) => rule.snippet_name === ours.snippet_name);
  const others = list.filter((rule) => rule.snippet_name !== ours.snippet_name).map(writable);
  if (index === -1) return [...others, { ...ours }];
  return [...others.slice(0, index), { ...ours }, ...others.slice(index)];
}

/**
 * True when the observed list already equals what we want.
 *
 * Compares only the writable fields, and ignores position, so a rule that the
 * API stored with extra keys does not read as a change. `enabled` is compared
 * strictly because Cloudflare defaults a rule to disabled when the key is
 * omitted, and a disabled rule matches nothing.
 */
export function rulesMatch(desired, observed) {
  if (!Array.isArray(observed) || desired.length !== observed.length) return false;
  return desired.every((want, i) => {
    const got = writable(observed[i] || {});
    return WRITABLE.every((key) => got[key] === want[key]);
  });
}