/**
 * Record the generated MCP Snippet as the committed copy.
 *
 * Run after a build that reported the Snippet as stale or absent. The build
 * writes `dist/mcp-snippet.js` before the drift check throws, so the file is
 * already on disk even though the build exited non-zero. This copies it to
 * `mcp/snippet.js` and prints the next step, which is to install the same bytes
 * on the zone and commit them together.
 */

import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { acceptSnippet, SNIPPET_PATH } from './mcp-snippet-check.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const generatedPath = path.join(root, 'dist', 'mcp-snippet.js');

let generated;
try {
  generated = await readFile(generatedPath, 'utf8');
} catch (error) {
  if (error.code === 'ENOENT') {
    console.error(`No generated snippet at dist/mcp-snippet.js. Run \`npm run build\` first.`);
    process.exit(1);
  }
  throw error;
}

const target = await acceptSnippet({ root, generated });
const table = generated.match(/^const DEPTH = (.*);$/m)?.[1] ?? '(none)';
console.log(`Wrote ${path.relative(root, target)} (${Buffer.byteLength(generated)} bytes)`);
console.log(`  route table: ${table}`);
console.log('  Next: install this file on the zone (docs/mcp-endpoint.md step 3), then');
console.log('        git add ' + SNIPPET_PATH + ' && git commit -m "chore: update MCP snippet"');
