/**
 * Check that the committed MCP Snippet matches what the build would emit.
 *
 * `mcp/snippet.js` is a committed, generated artifact. It exists so the exact
 * bytes running on the zone are reviewable, diffable, and revertible in git,
 * and so a drift between the Snippet and the shards is caught in the build
 * rather than in production.
 *
 * The drift that matters is the shard route table, which the Snippet carries
 * inlined. Workers Builds redeploys the shards on every push, including the
 * daily `data/refresh.txt` bump, but it cannot reinstall a Snippet: the
 * Snippets product has no wrangler command. So a registry change that moves a
 * cluster in or out of the table would ship fresh shards against a stale
 * Snippet, and every lookup in that range would report no vendor. That is a
 * silent wrong answer, which is the one failure mode this whole design is
 * built to avoid.
 */

import { readFile, writeFile, mkdir } from 'node:fs/promises';
import path from 'node:path';

/** Where the committed copy lives, relative to the repo root. */
export const SNIPPET_PATH = 'mcp/snippet.js';

/** Read the committed Snippet, or null when it is not there yet. */
export async function readCommittedSnippet(root) {
  try {
    return await readFile(path.join(root, SNIPPET_PATH), 'utf8');
  } catch (error) {
    if (error.code === 'ENOENT') return null;
    throw error;
  }
}

/**
 * Compare the freshly generated Snippet with the committed one.
 *
 * Returns `{ status, reason, bytes }`. `status` is one of:
 *   'current'   identical; nothing to do
 *   'absent'    no committed copy yet; first-time setup
 *   'stale'     the committed copy differs; the zone may be running old code
 */
export async function checkSnippet({ root, generated, bytes }) {
  const committed = await readCommittedSnippet(root);
  if (committed === null) {
    return { status: 'absent', reason: `${SNIPPET_PATH} does not exist yet`, bytes };
  }
  if (committed === generated) {
    return { status: 'current', reason: `${SNIPPET_PATH} matches the build`, bytes };
  }
  return {
    status: 'stale',
    reason:
      `${SNIPPET_PATH} differs from the build. The zone may be running an older ` +
      'MCP Snippet, whose inlined shard route table no longer matches the shards ' +
      'being deployed. Every lookup in a moved range would report no vendor.',
    bytes,
  };
}

/** Write the generated Snippet to the committed path. */
export async function acceptSnippet({ root, generated }) {
  const target = path.join(root, SNIPPET_PATH);
  await mkdir(path.dirname(target), { recursive: true });
  await writeFile(target, generated);
  return target;
}
