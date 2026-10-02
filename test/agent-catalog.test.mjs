import { strict as assert } from 'node:assert';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

import { MCP_ROUTE, MCP_SHARD_PATH, SITE } from '../build/mcp-shards.mjs';

const root = fileURLToPath(new URL('..', import.meta.url));

const CATALOGS = ['ai-catalog.json', 'ard.json'];

/** Read both manifests; they carry the same single entry by design. */
async function catalogs() {
  const out = [];
  for (const name of CATALOGS) {
    const file = path.join(root, 'public', '.well-known', name);
    out.push([name, JSON.parse(await readFile(file, 'utf8'))]);
  }
  return out;
}

test('ARD manifests declare the MCP server', async () => {
  for (const [name, catalog] of await catalogs()) {
    assert.equal(catalog.specVersion, '1.0', `${name} uses ARD catalog version 1.0`);
    assert.equal(catalog.host.displayName, 'MAC Address Lookup');
    assert.equal(catalog.host.documentationUrl, `${SITE}/help`);
    assert.equal(catalog.entries.length, 1, `${name} advertises the MCP server`);

    const [entry] = catalog.entries;

    // The AI Catalog schema requires exactly one of `url` / `data`.
    assert.equal(entry.url, `${SITE}${MCP_ROUTE}`, `${name} points at the live endpoint`);
    assert.equal(entry.data, undefined, `${name} does not inline the entry`);

    // ARD calls the media type `type`; the base AI Catalog calls it `mediaType`.
    // They diverged, so both are emitted with the same value.
    assert.equal(entry.type, 'application/mcp-server-card+json');
    assert.equal(entry.mediaType, entry.type, `${name} agrees on the media type`);

    assert.match(entry.identifier, /^urn:air:[^:]+:/, `${name} uses a URN identifier`);
    assert.ok(entry.description.length > 80, `${name} describes the entry`);
  }
});

test('both manifests describe the same artifact under one identifier', async () => {
  // The two files are alternate spellings of one catalog for the same host,
  // so a client may read either and must arrive at the same entry.
  const [, a] = (await catalogs())[0];
  const [, b] = (await catalogs())[1];
  const [aEntry] = a.entries;
  const [bEntry] = b.entries;

  assert.equal(
    aEntry.identifier,
    bEntry.identifier,
    'the two manifests must not invent two identities for one server',
  );
  assert.equal(aEntry.url, bEntry.url);
  assert.equal(aEntry.description, bEntry.description);
  assert.equal(aEntry.capabilities.length, bEntry.capabilities.length);
  assert.deepEqual(aEntry.representativeQueries, bEntry.representativeQueries);
});

test('representativeQueries are what a registry matches intent against', async () => {
  for (const [name, catalog] of await catalogs()) {
    const [entry] = catalog.entries;
    const queries = entry.representativeQueries;
    assert.ok(Array.isArray(queries), `${name} lists representativeQueries`);
    assert.ok(
      queries.length >= 2 && queries.length <= 5,
      `${name} keeps 2 to 5 representativeQueries, has ${queries.length}`,
    );
    for (const q of queries) {
      assert.equal(typeof q, 'string');
      assert.ok(q.length > 10 && !q.includes('\n'), `${name} query reads as a sentence`);
    }
    // They must read as questions a person would type, not as field names.
    assert.ok(
      queries.some((q) => q.includes(' ')),
      `${name} queries are prose`,
    );
  }
});

test('every page head points at the catalog', async () => {
  const href = '/.well-known/ai-catalog.json';
  const pattern = new RegExp(`<link rel="ai-catalog" href="${href.replace(/[./]/g, '\\$&')}"`);
  for (const file of HEAD_SOURCES) {
    const src = await readFile(path.join(root, file), 'utf8');
    assert.match(src, pattern, `${file} points at the catalog`);
  }
});

/**
 * robots.txt carries only directives Google's parser recognises.
 *
 * ARD's spec does list an `Agentmap` entry-source directive, and it was here
 * until 2026-10-01. PageSpeed Insights rejects it: "Unknown directive", two
 * errors, and robots.txt validity is a scored SEO check, so the file that is
 * meant to help discovery was costing a point instead. RFC 9309 tells parsers
 * to ignore unknown directives, so it never broke crawling — it only ever
 * cost points. The <link rel="ai-catalog"> head tag carries the same pointer
 * with no downside.
 */
test('robots.txt uses only directives the search parser accepts', async () => {
  const robots = await readFile(path.join(root, 'public', 'robots.txt'), 'utf8');

  // Google's documented set. Anything outside it is reported as an error.
  const KNOWN = new Set([
    'user-agent',
    'allow',
    'disallow',
    'crawl-delay',
    'sitemap',
    'clean-param',
    'host',
    'noindex',
  ]);

  const directives = [];
  robots.split('\n').forEach((line, i) => {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) return;
    const name = trimmed.split(':')[0].trim().toLowerCase();
    directives.push({ name, line: i + 1, text: trimmed });
  });

  const unknown = directives.filter((d) => !KNOWN.has(d.name));
  assert.deepEqual(
    unknown,
    [],
    `robots.txt has directives Google's validator rejects: ${unknown
      .map((d) => `line ${d.line} "${d.text}"`)
      .join(', ')}`,
  );

  // The directive must stay gone. This is a regression guard, not a style rule.
  assert.ok(!/^\s*agentmap:/im.test(robots), 'no Agentmap directive remains');

  // Crawl policy must survive the removal.
  assert.ok(/^user-agent: \*$/im.test(robots), 'the default group is still present');
  assert.ok(/^sitemap: https:\/\/mac\.jasontally\.com\/sitemap\.xml$/im.test(robots));
  for (const bot of ['GPTBot', 'ClaudeBot', 'PerplexityBot', 'Google-Extended']) {
    assert.ok(robots.includes(`User-agent: ${bot}`), `${bot} is still welcomed explicitly`);
  }
});

// The footer is written out in four places, not one. A link added to one copy
// leaves the other pages without it, which is how this link would have shipped
// on 4,364 pages while the tests still passed.
const FOOTER_SOURCES = [
  'build/page-template.mjs',
  'build/hubs.mjs',
  'build/recent.mjs',
  'public/index.html',
  'public/help.html',
];

// Every hand-written document shell. The build copies these verbatim, so a
// missing <link rel="ai-catalog"> here is a missing link on every page.
const HEAD_SOURCES = [
  'build/page-template.mjs',
  'build/hubs.mjs',
  'build/recent.mjs',
  'public/index.html',
  'public/help.html',
];

test('every copy of the footer carries the MCP link', async () => {
  for (const file of FOOTER_SOURCES) {
    const src = await readFile(path.join(root, file), 'utf8');
    assert.ok(src.includes('class="site-footer"'), `${file} really is a footer`);
    assert.match(
      src,
      /href="\/help#mcp"/,
      `${file} has the MCP link, so every page type gets it`,
    );
  }
});

test('the footer link resolves to instructions, not to the POST-only endpoint', async () => {
  // GET /mcp answers 405 by design, so a footer link must not point there.
  for (const file of FOOTER_SOURCES) {
    const src = await readFile(path.join(root, file), 'utf8');
    assert.match(
      src,
      /href="\/help#mcp"/,
      `${file} links the footer to the help section`,
    );
    assert.match(src, /data-i18n="footer\.mcp"/, `${file} marks the link for translation`);
    assert.doesNotMatch(
      src,
      /href="\/mcp"/,
      `${file} does not link a browser GET at the endpoint`,
    );
  }

  const en = await readFile(path.join(root, 'src', 'i18n', 'en.mjs'), 'utf8');
  assert.match(
    en,
    /'footer\.mcp':\s*'Connect via stateless MCP'/,
    'the English string matches the chosen link text',
  );
});

test('the help page documents the endpoint under the footer anchor', async () => {
  const help = await readFile(path.join(root, 'public', 'help.html'), 'utf8');
  const anchor = help.indexOf('id="mcp"');
  assert.ok(anchor > 0, 'the help page has an #mcp section');
  const section = help.slice(anchor, help.indexOf('</section>', anchor));
  assert.match(section, /POST \/mcp/, 'it shows the request');
  assert.ok(section.includes('/.well-known/ai-catalog.json'), 'it links the catalog');
  assert.ok(section.includes('/llms.txt'), 'it links the plain-text summary');
  // The shard directory is an implementation detail of the Snippet. An agent
  // must not be pointed at raw data files, so it must not appear here.
  assert.ok(
    !section.includes(MCP_SHARD_PATH),
    'the shard directory stays out of the human documentation',
  );
});

test('llms.txt describes the endpoint without claiming a handshake is required', async () => {
  const { llmsTxt } = await import('../build/agent-files.mjs');
  const text = llmsTxt();

  assert.match(text, /^## MCP server$/m, 'llms.txt has an MCP section');
  assert.ok(
    text.includes(`${SITE}${MCP_ROUTE}`),
    'llms.txt names the endpoint',
  );
  assert.ok(
    text.includes(`${SITE}/.well-known/ai-catalog.json`),
    'llms.txt points at the machine-readable catalog',
  );
  // "no handshake" must read as "not required"; a 2025-era client is served.
  assert.match(text, /no handshake required/i);
  assert.doesNotMatch(
    text,
    /no session, no `initialize` handshake/i,
    'the old phrasing implied the handshake was unsupported',
  );
  assert.match(text, /-32022/, 'llms.txt documents the version refusal');
});

/**
 * help.md once taught agents to read the raw shard files and do the
 * longest-prefix match themselves. That is the exact failure the MCP endpoint
 * was built to remove: docs/architecture.md records that the retired
 * data/registry/{key}.txt surface "asked the *model* to run two longest-prefix
 * searches over free text" and "models did that unreliably".
 *
 * It was also not followable. Three dense ranges are keyed by 6 hex characters
 * and the routing table is published nowhere, so the documented 4-character
 * guess fetched a nonexistent file and got the SPA shell with a 200.
 */
test('help.md points at /mcp and does not teach the retired shard algorithm', async () => {
  const { helpMarkdown, llmsTxt } = await import('../build/agent-files.mjs');
  const help = helpMarkdown();
  const llms = llmsTxt();
  const flat = (s) => s.replace(/`/g, '').replace(/\s+/g, ' ');

  // The instruction to do the matching by hand must be gone.
  assert.ok(
    !/take the longest line whose prefix starts/i.test(help),
    'help.md must not tell a client to run the longest-prefix match itself',
  );
  assert.ok(
    !/registry is also split into small/i.test(help),
    'help.md must not present the shard cache as an interface',
  );

  // A non-MCP client still needs a route, so the replacement must name one.
  assert.match(help, /cannot speak MCP/i, 'it still addresses clients without MCP');
  assert.match(help, /NDJSON/i, 'and points at the downloadable dataset instead');
  assert.match(help, /not a supported interface/i, 'and says the shards are internal');

  // The two agent-facing documents must not disagree.
  assert.match(llms, /cache for the server rather than an\s+interface/i);
  assert.match(help, /internal cache/i);

  // The carve warning is the part that stops a client guessing a filename.
  // Asserted against flattened text: the passage wraps across newlines, which
  // a naive regex misses.
  assert.match(
    flat(help),
    /keyed by 6/,
    'help.md must warn that dense ranges are keyed by 6 hex characters, not 4',
  );
  assert.match(
    flat(help),
    /routing table is not published/,
    'and that a client cannot derive the correct filename',
  );
});