import { strict as assert } from 'node:assert';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

import { MCP_ROUTE, SITE } from '../build/mcp-shards.mjs';

const root = fileURLToPath(new URL('..', import.meta.url));

/**
 * server.json is the metadata the official MCP Registry publishes.
 * public/.well-known/mcp/server-card.json is the same document at the path
 * clients probe for pre-connection discovery (SEP-1649). One server, one
 * document, two consumers: a client that reads either one finds the same
 * endpoint, and a future edit cannot change one without the other.
 */
const SERVER_JSON = path.join(root, 'server.json');
const CARD_JSON = path.join(root, 'public', '.well-known', 'mcp', 'server-card.json');

async function readJson(file) {
  return JSON.parse(await readFile(file, 'utf8'));
}

test('the discovery card and the registry document are one document', async () => {
  assert.deepEqual(await readJson(CARD_JSON), await readJson(SERVER_JSON));
});

test('server.json carries the fields the registry schema requires', async () => {
  const server = await readJson(SERVER_JSON);

  // The schema pattern: a reverse-DNS namespace, a slash, a name.
  assert.match(server.name, /^[a-zA-Z0-9.-]+\/[a-zA-Z0-9._-]+$/);

  // The schema caps the description at 100 characters. It is what a directory
  // shows in a search result, so it has to carry the whole idea in one line.
  assert.ok(server.description.length >= 1 && server.description.length <= 100);

  // Version strings are immutable once published. It needs a value now.
  assert.match(server.version, /^\d+\.\d+\.\d+$/);

  assert.equal(server.repository.source, 'github');
  assert.equal(server.repository.url, 'https://github.com/jasontally/mac-address-lookup');

  // A remote-only server: one transport, no package to install.
  assert.equal(server.packages, undefined, 'the server is remote-only');
  assert.equal(server.remotes.length, 1);
  assert.equal(server.remotes[0].type, 'streamable-http');
  assert.equal(server.remotes[0].url, `${SITE}${MCP_ROUTE}`);

  // No credentials. A header here would put a key in a public document.
  assert.equal(server.remotes[0].headers, undefined, 'the endpoint needs no headers');
});

test('the namespace is the reverse DNS form of the host that serves the endpoint', async () => {
  const server = await readJson(SERVER_JSON);
  const host = new URL(SITE).hostname;
  const namespace = `${host.split('.').reverse().join('.')}/${server.name.split('/')[1]}`;

  // The registry proves a domain with a TXT record at the apex of that domain,
  // so a namespace that names a subdomain is a deliberate choice, not a slip:
  // it ties the proof to the host that actually answers, and it lets a claim
  // file sit on this site instead of the apex domain.
  assert.equal(server.name, namespace);
  assert.ok(host.split('.').length > 2, `the namespace names the subdomain ${host}`);
});