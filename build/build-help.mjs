/** Build the static help/documentation page (guides, block types, FAQ). */

import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { renderFaqList, renderFaqSchema } from './faq.mjs';

/**
 * Read dist/help.html (copied from public/), substitute the FAQ and asset
 * placeholders, and write it back. Called after assets are built and hashed.
 */
export async function buildHelpPage({ distDir }) {
  const helpPath = path.join(distDir, 'help.html');
  let html = await readFile(helpPath, 'utf8');

  for (const token of ['{{FAQ_LIST}}', '{{FAQ_SCHEMA}}']) {
    if (!html.includes(token)) {
      throw new Error(`help.html is missing the ${token} placeholder`);
    }
  }

  html = html
    .replace('{{FAQ_LIST}}', renderFaqList())
    .replace('{{FAQ_SCHEMA}}', renderFaqSchema());

  await writeFile(helpPath, html);
  return { bytes: Buffer.byteLength(html) };
}
