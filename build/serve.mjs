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
  '.md': 'text/plain; charset=utf-8', // mirrors the _headers override on production
  '.ico': 'image/x-icon',
};

createServer(async (req, res) => {
  const url = new URL(req.url, `http://localhost:${port}`);
  let filePath = path.join(distDir, decodeURIComponent(url.pathname));

  if (!filePath.startsWith(distDir)) {
    res.writeHead(403, { 'content-type': 'text/plain' }).end('Forbidden');
    return;
  }

  const exists = async (candidate) => {
    try {
      await stat(candidate);
      return candidate;
    } catch {
      return null;
    }
  };

  // Workers Assets 307s a trailing slash onto the flat .html URL
  // (/country/ -> /country, /001A2B/ -> /001A2B); mirror it locally.
  if (url.pathname.endsWith('/')) {
    const flat = path.join(distDir, url.pathname.replace(/^\/|\/+$/g, ''));
    if (url.pathname !== '/' && (await exists(`${flat}.html`))) {
      res.writeHead(307, { location: url.pathname.replace(/\/+$/, '') }).end();
      return;
    }
  }

  let info = null;
  try {
    info = await stat(filePath);
  } catch {
    info = null;
  }

  if (info?.isDirectory()) {
    // Mirror Workers Assets: a directory serves its index.html; without one
    // the .html twin of the path still matches (/country -> country.html).
    const index = await exists(path.join(filePath, 'index.html'));
    filePath = index ?? (await exists(`${filePath}.html`)) ?? path.join(distDir, 'index.html');
  } else if (!info) {
    // Mirror Workers Assets html_handling: /001A2B serves 001A2B.html.
    filePath = (await exists(`${filePath}.html`)) ?? path.join(distDir, 'index.html'); // SPA fallback
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
