/**
 * Tests for the zone-wide Snippet rule list merge.
 *
 * `PUT snippet_rules` replaces the whole list, and this zone also runs the
 * `icanhazip` snippet from another project. These tests exist so that a future
 * change to the merge cannot quietly start deleting other people's rules again.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mergeSnippetRule, rulesMatch } from '../build/snippet-rules.mjs';

const OUR = {
  snippet_name: 'mcp_lookup',
  expression: '(http.host eq "mac.jasontally.com" and (http.request.uri.path eq "/mcp" or http.request.uri.path eq "/mcp/"))',
  description: 'Serve the stateless MCP lookup endpoint at /mcp and /mcp/',
  enabled: true,
};

/** A rule as the API returns it: the writable fields plus read-only ones. */
function observedRule(snippet_name, expression) {
  return {
    id: `id-${snippet_name}`,
    description: `rule for ${snippet_name}`,
    enabled: true,
    last_updated: '2026-10-01T23:44:44.87655Z',
    expression,
    snippet_name,
  };
}

const FOREIGN = observedRule('icanhazip', '(http.host in {"ip.jasontally.com" "city.jasontally.com"})');

test('a foreign rule on the zone survives the merge', () => {
  const observed = [observedRule('mcp_lookup', '(http.host eq "mac.jasontally.com" and http.request.uri.path eq "/mcp")'), FOREIGN];
  const merged = mergeSnippetRule(observed, OUR);
  assert.deepEqual(
    merged.map((r) => r.snippet_name),
    ['mcp_lookup', 'icanhazip'],
    'the foreign rule must still be in the list we PUT',
  );
});

test('the foreign rule keeps its expression, description, and enabled flag', () => {
  const merged = mergeSnippetRule([FOREIGN], OUR);
  const kept = merged.find((r) => r.snippet_name === 'icanhazip');
  assert.equal(kept.expression, FOREIGN.expression);
  assert.equal(kept.description, FOREIGN.description);
  assert.equal(kept.enabled, true);
});

test('read-only fields are stripped from the rules we send back', () => {
  const merged = mergeSnippetRule([FOREIGN], OUR);
  for (const rule of merged) {
    assert.equal(rule.id, undefined, 'id is read-only and must not be sent');
    assert.equal(rule.last_updated, undefined, 'last_updated is read-only and must not be sent');
  }
});

test('our rule keeps its position so the list does not reorder', () => {
  const first = observedRule('mcp_lookup', 'old');
  const merged = mergeSnippetRule([first, FOREIGN], OUR);
  assert.equal(merged[0].snippet_name, 'mcp_lookup', 'position must be preserved');
  assert.equal(merged[0].expression, OUR.expression, 'but the expression must be the new one');
});

test('on an empty zone the list is just our rule', () => {
  assert.deepEqual(mergeSnippetRule([], OUR), [OUR]);
  assert.deepEqual(mergeSnippetRule(null, OUR), [OUR]);
});

test('on a zone with only foreign rules we append and keep them all', () => {
  const other = observedRule('somebody_elses_snippet', '(http.host eq "x.example")');
  const merged = mergeSnippetRule([other, FOREIGN], OUR);
  assert.deepEqual(
    merged.map((r) => r.snippet_name),
    ['somebody_elses_snippet', 'icanhazip', 'mcp_lookup'],
  );
});

test('a duplicate stale copy of our own rule collapses to one', () => {
  const merged = mergeSnippetRule([observedRule('mcp_lookup', 'old'), observedRule('mcp_lookup', 'older'), FOREIGN], OUR);
  const ours = merged.filter((r) => r.snippet_name === 'mcp_lookup');
  assert.equal(ours.length, 1, 'one rule per snippet');
  assert.equal(ours[0].expression, OUR.expression);
});

test('rulesMatch ignores read-only fields, so a live list reads as current', () => {
  // This is the real zone state: read-only keys present, our fields matching.
  const observed = [{ ...OUR, id: 'abc', last_updated: '2026-10-01T22:36:20.292202Z' }];
  assert.ok(rulesMatch(mergeSnippetRule(observed, OUR), observed), 'must not force a pointless PUT');
});

test('rulesMatch is false when our expression is stale', () => {
  const observed = [{ ...OUR, expression: '(http.host eq "mac.jasontally.com" and http.request.uri.path eq "/mcp")' }];
  assert.equal(rulesMatch(mergeSnippetRule(observed, OUR), observed), false);
});

test('rulesMatch is false when a foreign rule would be dropped', () => {
  // The exact bug: sending a 1-rule list for a zone that has 2 must never read
  // as "already current", because acting on that would delete icanhazip.
  const observed = [observedRule('mcp_lookup', 'old'), FOREIGN];
  const oursOnly = [OUR];
  assert.equal(rulesMatch(oursOnly, observed), false, 'a shortened list must not pass');
});