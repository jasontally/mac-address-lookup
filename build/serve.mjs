/** Local preview server for dist/ with SPA fallback (mirrors Workers Assets). */

import { createServer } from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('..', import.meta.url));
const distDir = path.join(root, 'dist');
const port = Number(process.env.PORT ?? 8788);

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.parquet': 'application/octet-stream',
  '.svg': 'image/svg+xml',
  '.xml': 'application/xml',
  '.txt': 'text/plain; charset=utf-8',
  '.ico': 'image/x-icon',
};

createServer(async (req, res) => {
  const url = new URL(req.url, `http://localhost:${port}`);
  let filePath = path.join(distDir, decodeURIComponent(url.pathname));

  if (!filePath.startsWith(distDir)) {
    res.writeHead(403, { 'content-type': 'text/plain' }).end('Forbidden');
    return;
  }

  try {
    const info = await stat(filePath);
    if (info.isDirectory()) filePath = path.join(filePath, 'index.html');
  } catch {
    // Mirror Workers Assets html_handling: /001A2B serves 001A2B.html.
    try {
      const htmlPath = `${filePath}.html`;
      await stat(htmlPath);
      filePath = htmlPath;
    } catch {
      filePath = path.join(distDir, 'index.html'); // SPA fallback
    }
  }

  try {
    const data = await readFile(filePath);
    res.writeHead(200, {
      'content-type': MIME[path.extname(filePath)] ?? 'application/octet-stream',
      'cache-control': 'no-cache',
    });
    res.end(data);
  } catch {
    res.writeHead(404, { 'content-type': 'text/plain' }).end('Not found');
  }
}).listen(port, () => {
  console.log(`Serving dist/ at http://localhost:${port}`);
});
