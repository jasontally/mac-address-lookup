/**
 * The snippet is reviewed as source and uploaded minified.
 *
 * Cloudflare's 32 KB Snippet limit counts the bytes uploaded: a snippet padded
 * with comments to 40 KB source but 8.6 KB minified was rejected by the API with
 * "maximum snippet size of 32.00KB is exceeded". So `npm run mcp:deploy`
 * minifies before sending, and the build guards the minified size. That is only
 * safe if minification changes nothing observable, which is what this file
 * checks.
 *
 * It is the load-bearing assumption behind shipping minified code, so it is
 * asserted rather than assumed. Every method, every error path, and both new
 * guards are run through both forms, and the responses must be byte-identical.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { transform } from 'esbuild';

const SITE = 'https://mac.jasontally.com';
const HOST = new URL(SITE).host;
const U = `https://${HOST}/mcp`;
const V = { 'MCP-Protocol-Version': '2026-07-28' };

/** Load the committed snippet twice: as written, and minified the way deploy does. */
async function bothForms() {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'mcp-minify-'));
  const source = await readFile(new URL('../mcp/snippet.js', import.meta.url), 'utf8');
  const minified = (await transform(source, { loader: 'js', minify: true, target: 'es2022', legalComments: 'none' })).code;
  await writeFile(path.join(dir, 'source.js'), source);
  await writeFile(path.join(dir, 'min.js'), minified);
  return {
    source,
    minified,
    src: await import(`file://${path.join(dir, 'source.js')}`),
    min: await import(`file://${path.join(dir, 'min.js')}`),
  };
}

const R = (method, params) =>
  params ? { jsonrpc: '2.0', id: 1, method, params } : { jsonrpc: '2.0', id: 1, method };

/** One POST, returning status, parsed body, and content type. */
async function post(mod, headers, body) {
  const res = await mod.default.fetch(new Request(U, {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...headers },
    body: JSON.stringify(body),
  }));
  const text = await res.text();
  let json = null;
  try { json = text ? JSON.parse(text) : null; } catch { /* left null so a diff shows the raw text */ }
  return { status: res.status, ct: res.headers.get('content-type'), json };
}

test('the minified snippet answers every method exactly as the source does', async () => {
  const { src, min } = await bothForms();

  const cases = [
    ['tools/list', { ...V, 'Mcp-Method': 'tools/list' }, R('tools/list')],
    ['tools/call, matched', { ...V, 'Mcp-Method': 'tools/call', 'Mcp-Name': 'lookup' }, R('tools/call', { name: 'lookup', arguments: { mac: '8C:1F:64:AF:A4:B2' } })],
    ['tools/call, no match', { ...V, 'Mcp-Method': 'tools/call', 'Mcp-Name': 'lookup' }, R('tools/call', { name: 'lookup', arguments: { mac: '02:00:00:00:00:01' } })],
    ['tools/call, bad argument', { ...V, 'Mcp-Method': 'tools/call', 'Mcp-Name': 'lookup' }, R('tools/call', { name: 'lookup', arguments: { mac: 'nope' } })],
    ['unknown tool', { ...V, 'Mcp-Method': 'tools/call', 'Mcp-Name': 'nope' }, R('tools/call', { name: 'nope', arguments: {} })],
    ['unknown method', { ...V, 'Mcp-Method': 'resources/list' }, R('resources/list')],
    ['header disagrees with body', { ...V, 'Mcp-Method': 'prompts/list' }, R('tools/list')],
    ['unsupported version', { ...V, 'MCP-Protocol-Version': '1999-01-01', 'Mcp-Method': 'tools/list' }, R('tools/list')],
    ['legacy version still served', { 'MCP-Protocol-Version': '2025-06-18' }, R('tools/list')],
    ['id null', { ...V, 'Mcp-Method': 'tools/list' }, { jsonrpc: '2.0', id: null, method: 'tools/list' }],
    ['notification', { ...V, 'Mcp-Method': 'tools/list' }, { jsonrpc: '2.0', method: 'tools/list' }],
    ['initialize probe', { ...V, 'Mcp-Method': 'initialize' }, R('initialize')],
    ['origin refused', { ...V, 'Mcp-Method': 'tools/list', origin: 'http://evil.example' }, R('tools/list')],
    ['origin allowed', { ...V, 'Mcp-Method': 'tools/list', origin: `https://${HOST}` }, R('tools/list')],
  ];

  for (const [label, headers, body] of cases) {
    const a = await post(src, headers, body);
    const b = await post(min, headers, body);
    assert.deepEqual(b, a, `${label}: minified differs from source`);
  }
});

test('the minified snippet answers every non-POST path exactly as the source does', async () => {
  const { src, min } = await bothForms();
  const cases = [
    ['GET wanting a stream', { method: 'GET', headers: { accept: 'text/event-stream' } }],
    ['GET not wanting a stream', { method: 'GET', headers: { accept: 'application/json' } }],
    ['OPTIONS', { method: 'OPTIONS', headers: {} }],
    ['DELETE', { method: 'DELETE', headers: {} }],
    ['PUT', { method: 'PUT', headers: {} }],
  ];
  for (const [label, init] of cases) {
    const a = await src.default.fetch(new Request(U, init));
    const b = await min.default.fetch(new Request(U, init));
    const ta = await a.text();
    const tb = await b.text();
    assert.equal(b.status, a.status, `${label}: status`);
    assert.equal(tb, ta, `${label}: body`);
    assert.equal(b.headers.get('content-type'), a.headers.get('content-type'), `${label}: content-type`);
  }
});

test('the minified upload is what fits the limit, and it is far smaller than the source', async () => {
  const { source, minified } = await bothForms();
  assert.ok(
    Buffer.byteLength(minified) < 32 * 1024,
    `minified must fit 32 KB, got ${Buffer.byteLength(minified)}`,
  );
  // The whole reason the deploy minifies: the commented source does not fit, and
  // it is not supposed to. If this ever inverts, the deploy path is wrong.
  assert.ok(
    Buffer.byteLength(source) > Buffer.byteLength(minified),
    'source must be the larger file; comments are what minification removes',
  );
});