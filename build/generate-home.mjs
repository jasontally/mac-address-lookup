/** Inject generated FAQ content and structured data into the home page. */

import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { renderFaqList, renderFaqSchema } from './faq.mjs';

/**
 * Read public/index.html, substitute the FAQ placeholders, and write
 * dist/index.html. Called after the public directory is copied.
 */
export async function buildHomePage({ root, distDir }) {
  const source = await readFile(path.join(root, 'public', 'index.html'), 'utf8');

  if (!source.includes('{{FAQ_LIST}}') || !source.includes('{{FAQ_SCHEMA}}')) {
    throw new Error('public/index.html is missing FAQ placeholders');
  }

  const html = source
    .replace('{{FAQ_LIST}}', renderFaqList())
    .replace('{{FAQ_SCHEMA}}', renderFaqSchema());

  await writeFile(path.join(distDir, 'index.html'), html);
  return { bytes: Buffer.byteLength(html) };
}
