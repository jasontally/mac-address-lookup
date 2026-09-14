/** Inject generated FAQ content and structured data into the home page. */

import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { renderFaqList, renderFaqSchema } from './faq.mjs';

/**
 * Read public/index.html, substitute the FAQ and asset placeholders, and write
 * dist/index.html. Called after the public directory is copied.
 */export async function buildHomePage({
  root,
  distDir,
  assets = { appFile: '/assets/app.js', cssFile: '/assets/app.css' },
}) {
  const source = await readFile(path.join(root, 'public', 'index.html'), 'utf8');

  for (const token of ['{{FAQ_LIST}}', '{{FAQ_SCHEMA}}', '{{APP_JS}}', '{{APP_CSS}}']) {
    if (!source.includes(token)) {
      throw new Error(`public/index.html is missing the ${token} placeholder`);
    }
  }

  const html = source
    .replace('{{FAQ_LIST}}', renderFaqList())
    .replace('{{FAQ_SCHEMA}}', renderFaqSchema())
    .replace('{{APP_JS}}', assets.appFile)
    .replace('{{APP_CSS}}', assets.cssFile);

  await writeFile(path.join(distDir, 'index.html'), html);
  return { bytes: Buffer.byteLength(html) };
}
