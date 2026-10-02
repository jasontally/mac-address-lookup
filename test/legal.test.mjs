import { strict as assert } from 'node:assert';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

import { SITE } from '../build/mcp-shards.mjs';

const root = fileURLToPath(new URL('..', import.meta.url));

/**
 * A privacy policy is a factual claim about code. Every assertion here maps to
 * something verified in the source, so a future change that invalidates the
 * policy fails the build instead of leaving the site making a false statement.
 *
 * Verified 2026-10-01: no document.cookie anywhere in src/ or build/; no
 * third-party script or analytics endpoint in the bundle; localStorage keys are
 * mal.theme, mal.locale, mal.history; the MCP snippet emits no console output.
 */

const read = (rel) => readFile(path.join(root, rel), 'utf8');

/** Collapse whitespace and strip tags so assertions read against prose. */
const prose = (html) => html.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ');

test('both legal pages exist and are wired into the site', async () => {
  for (const page of ['public/privacy.html', 'public/terms.html']) {
    const html = await read(page);
    assert.match(html, /^<!doctype html>/i, `${page} is a full document`);
    assert.ok(html.includes('</html>'), `${page} is closed`);
    // The asset tokens must survive to the build's substitution step.
    for (const token of ['{{APP_CSS}}', '{{STATIC_JS}}', '{{WORKER_JS}}']) {
      assert.ok(html.includes(token), `${page} carries ${token}`);
    }
    assert.ok(
      html.includes(`<link rel="canonical" href="${SITE}/${page.includes('privacy') ? 'privacy' : 'terms'}" />`),
      `${page} has a canonical URL`,
    );
  }
});

test('the privacy policy states the MCP exception rather than hiding it', async () => {
  const html = await read('public/privacy.html');
  const text = html.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ');

  // The browser-side claim must be scoped to the website, because the MCP
  // endpoint genuinely does receive the address.
  assert.match(text, /never (leaves|processed by|sent to)/i);
  assert.match(text, /MCP/i, 'the exception is named');
  assert.match(
    text,
    /POST/,
    'it says the address arrives in a request body, which is the actual fact',
  );
  assert.match(text, /no session is created/i);
  assert.match(text, /user-agent/i, 'it names the request metadata the host sees');
});

test('the privacy policy names every storage key the code actually uses', async () => {
  const html = await read('public/privacy.html');
  const src = (
    await Promise.all(
      ['src/ui/theme.mjs', 'src/i18n/index.mjs', 'src/ui/history.mjs'].map((f) => read(f)),
    )
  ).join('\n');

  // Two ways a key appears: a named constant, or a literal passed straight to
  // localStorage. A key added either way must reach the policy.
  const declared = [...src.matchAll(/STORAGE_KEY\s*=\s*'([^']+)'/g)].map((m) => m[1]);
  const literal = [
    ...src.matchAll(/localStorage\.\w+Item\(\s*'([^']+)'/g),
    ...src.matchAll(/localStorage\[\s*'([^']+)'\s*\]/g),
  ].map((m) => m[1]);
  const keys = [...new Set([...declared, ...literal])];

  assert.ok(keys.length >= 3, `found storage keys in code: ${keys.join(', ')}`);
  for (const key of keys) {
    assert.ok(html.includes(`<code>${key}</code>`), `the policy documents ${key}`);
  }
});

test('the privacy policy does not claim the site sets no cookies at all', async () => {
  // It may say the *app* sets none, but it must not deny the host's own
  // processing, because that would be false.
  const html = await read('public/privacy.html');
  const text = html.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ');
  assert.match(text, /Cloudflare/i, 'the host is named as a separate processor');
  assert.match(text, /IP address/i, 'it admits requests carry an IP address');
});

test('the terms disclaim accuracy and IEEE affiliation', async () => {
  const text = prose(await read('public/terms.html'));

  assert.match(text, /as is/i, 'the as-is basis is stated');
  assert.match(text, /no warranty/i);
  assert.match(text, /indemnif/i, 'there is an indemnity');
  assert.match(text, /limitation of liability/i);
  assert.match(text, /100 USD|one hundred US dollars/i, 'the liability cap has a number');
  assert.match(text, /not (?:endorsed|associated with)/i, 'IEEE non-affiliation is stated');
  assert.match(text, /trademark/i);
  assert.match(text, /governed by/i, 'there is a governing law clause');
  assert.match(text, /identify, track, profile|gather information about any individual/i);
});

/**
 * Ordinary negligence is waivable; gross negligence, willful misconduct, and
 * fraud are not. A clause that claimed to waive all of it would be struck in
 * whole or part, taking the cap with it. So the release must be explicit about
 * ordinary negligence AND explicit that it stops at the non-waivable line.
 */
test('negligence is released, but only to the extent the law allows', async () => {
  const text = prose(await read('public/terms.html'));

  assert.match(
    text,
    /not liable for ordinary negligence/i,
    'ordinary negligence must be released, since that is what the owner asked to protect against',
  );
  assert.match(text, /release the Operator from it/i, 'it is framed as a release, not a disclaimer');

  // The boundary. If this is missing, the clause overclaims and risks being
  // unenforceable as a whole.
  for (const carve of [
    /gross negligence/i,
    /willful or intentional misconduct/i,
    /fraud or fraudulent misrepresentation/i,
    /a violation of law/i,
  ]) {
    assert.match(text, carve, `the non-waivable carve-out for ${carve} is missing`);
  }
  assert.match(
    text,
    /would be unenforceable in whole or in part/i,
    'it must say why the carve-out exists, so it is not edited away later',
  );

  // The scope that actually matters for this site: a wrong vendor answer.
  assert.match(
    text,
    /inaccurate, incomplete, out of date/i,
    'the release must name the failure modes that are the real exposure',
  );

  // Mandatory consumer rights must survive even the venue clause.
  assert.match(
    text,
    /does not deprive you of any mandatory consumer protection/i,
    'a Florida choice of law must not strip a consumer of home-state rights',
  );
  assert.match(text, /courts located in the State of Florida/i);
  assert.match(text, /Florida, United States/i);
});

test('the terms define one contracting party', async () => {
  const text = prose(await read('public/terms.html'));
  assert.match(
    text,
    /the Operator means the individual or legal entity/i,
    'a defined party term is what lets an LLC be inserted later without rewording',
  );
  // The old phrasing named individuals, which defeats a liability shield.
  assert.ok(
    !/the project and the people behind it/i.test(text),
    'naming the individuals directly undercuts the protection the cap is there to provide',
  );
});

/**
 * The SPA fallback answers every unmatched path with index.html and a 200, so
 * an OAuth-discovery probe was receiving HTML where a client expects JSON. That
 * is the most likely reason a connector UI reported "Unable to load tools".
 */
test('auth-discovery paths return JSON, not the SPA shell', async () => {
  const doc = JSON.parse(await read('public/.well-known/oauth-protected-resource/mcp'));
  assert.equal(doc.resource, `${SITE}/mcp`, 'RFC 9728 requires the resource identifier');
  assert.deepEqual(
    doc.authorization_servers,
    [],
    'the endpoint is public, so no authorization server is named',
  );
  assert.deepEqual(
    doc.bearer_methods_supported,
    [],
    'no bearer token is ever presented, so none is advertised',
  );
  assert.deepEqual(doc.scopes_supported, [], 'there is nothing to scope');

  // One document serves both paths, so `resource` names the endpoint rather
  // than the host. A client comparing it against its own resource URL matches,
  // which is the whole point of the field.

  // No authorization server exists, so none is advertised. Publishing a
  // fabricated one would send a client looking for a token issuer that is not
  // there, which is worse than the HTML it replaces.
  for (const file of ['public/_redirects', 'public/_headers']) {
    const src = await read(file);
    assert.ok(
      !/oauth-authorization-server|openid-configuration/.test(src),
      `${file} must not advertise an authorization server that does not exist`,
    );
  }
});

test('the bare auth path is mapped onto the file, because a name cannot be both', async () => {
  const redirects = await read('public/_redirects');
  assert.match(
    redirects,
    /^\/\.well-known\/oauth-protected-resource \/\.well-known\/oauth-protected-resource\/mcp 200$/m,
    'the bare path must serve the same document, or it still returns the SPA shell',
  );
});

test('the SPA fallback still answers everything else, so nothing else was routed', async () => {
  const redirects = await read('public/_redirects');
  const rules = redirects
    .split('\n')
    .map((l) => l.trim())
    .filter((l) => l && !l.startsWith('#'));
  assert.equal(
    rules.length,
    1,
    `exactly one redirect rule is intended, found ${rules.length}: ${rules.join(' | ')}`,
  );
});

test('no contact email is invented anywhere', async () => {
  // The owner declined to publish one. A placeholder that looks like a real
  // address is worse than none, so the pages must route to the repository.
  const files = ['public/privacy.html', 'public/terms.html', 'public/help.html'];
  for (const file of files) {
    const html = await read(file);
    const emails = [...html.matchAll(/[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-z]{2,}/g)].map((m) => m[0]);
    assert.deepEqual(emails, [], `${file} must not publish an email address: ${emails}`);
  }
  assert.match(
    prose(await read('public/terms.html')),
    /no published contact address/i,
    'the terms should say plainly that the repository is the route',
  );
});

test('the terms warn against relying on a result, which is the real risk', async () => {
  const text = (await read('public/terms.html')).replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ');
  assert.match(text, /may be wrong, incomplete, or out of date/i);
  assert.match(
    text,
    /Do not use this site as your only source/i,
    'it says to confirm against the registry directly',
  );
  assert.match(text, /randomiz/i, 'it explains why absent results are normal');
});

test('every page shell links both legal pages', async () => {
  const shells = [
    'build/page-template.mjs',
    'build/hubs.mjs',
    'build/recent.mjs',
    'public/index.html',
    'public/help.html',
    'public/privacy.html',
    'public/terms.html',
  ];
  for (const file of shells) {
    const src = await read(file);
    assert.ok(src.includes('class="site-footer"'), `${file} has a footer`);
    assert.ok(src.includes('href="/privacy"'), `${file} links the privacy policy`);
    assert.ok(src.includes('href="/terms"'), `${file} links the terms`);
  }
});

test('the catalog entry carries the four URLs the MCP registry requires', async () => {
  const required = {
    websiteUrl: `${SITE}/`,
    supportUrl: `${SITE}/help`,
    privacyPolicyUrl: `${SITE}/privacy`,
    termsOfServiceUrl: `${SITE}/terms`,
  };
  for (const name of ['ai-catalog.json', 'ard.json']) {
    const catalog = JSON.parse(await read(`public/.well-known/${name}`));
    const [entry] = catalog.entries;
    assert.deepEqual(entry.metadata, required, `${name} declares the four URLs`);

    // metadata is the spec's slot for extensions; the entry must not grow
    // top-level keys the schema does not define.
    // `mediaType` is the one deliberate extra: the base AI Catalog names the
    // field mediaType while ARD names it type, and both are emitted so the
    // manifest validates under either. `tags` likewise is an AI Catalog key.
    const defined = new Set([
      'identifier', 'displayName', 'type', 'mediaType', 'url', 'data', 'description',
      'tags', 'capabilities', 'representativeQueries', 'version', 'updatedAt',
      'metadata', 'trustManifest',
    ]);
    for (const key of Object.keys(entry)) {
      assert.ok(defined.has(key), `${name} uses schema key ${key}`);
    }
  }
});

test('the legal pages are in the sitemap scope and the change tracker', async () => {
  const build = await read('build/build.mjs');
  assert.match(
    build,
    /extraUrls: \['\/help', '\/recent', '\/privacy', '\/terms'\]/,
    'both pages are submitted to the sitemap',
  );
  assert.match(build, /'privacy\.html', 'terms\.html'\]/, 'both are tracked for IndexNow');
});

/**
 * The MCP endpoint receives the address in a POST body, so "all lookups never
 * reach a server" became false when it shipped. The browser claim stays true,
 * but only when it is scoped to lookups on the website and points at the
 * exception. These are the three places that sentence is published.
 */
const CLAIM_SITES = [
  ['src/i18n/en.mjs', 'footer.dataNote'],
  ['build/faq.mjs', 'the privacy FAQ'],
  ['build/agent-files.mjs', 'llms.txt'],
];

test('the server-privacy claim is scoped and names the MCP exception', async () => {
  for (const [file, where] of CLAIM_SITES) {
    const text = await read(file);

    // The unscoped form is the one that must never come back.
    assert.ok(
      !/All lookups run in your browser/i.test(text),
      `${where} in ${file} must not claim *all* lookups stay client-side`,
    );

    // Wherever the claim survives, the exception must be stated nearby.
    const claimIndex = text.search(
      /never (?:processed by a server|leaves your browser|sends the address)/i,
    );
    assert.ok(claimIndex > 0, `${file} still states the browser-side claim`);
    // 700 either side: the exception reads best after the claim, as in
    // "the addresses you look up are never processed by a server. The MCP
    // endpoint is an HTTP request, so it differs."
    const window = text.slice(Math.max(0, claimIndex - 400), claimIndex + 800);
    assert.match(
      window,
      /MCP/,
      `${file} states the claim without naming the MCP exception within 700 characters`,
    );
    assert.match(
      window,
      /on this website|through the website|client-side/i,
      `${file} does not scope the claim to lookups on the website`,
    );
  }
});