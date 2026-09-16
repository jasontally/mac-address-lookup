import { cp, mkdir, readdir, readFile, rename, stat, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import path from 'node:path';
import * as esbuild from 'esbuild';
import { buildHelpPage } from './build-help.mjs';

async function hashAsset(filePath) {
  const buffer = await readFile(filePath);
  const hash = createHash('sha256').update(buffer).digest('hex').slice(0, 12);
  const extension = path.extname(filePath);
  const hashedPath = filePath.replace(new RegExp(`${extension}$`), `.${hash}${extension}`);
  await rename(filePath, hashedPath);
  return { name: path.basename(hashedPath), bytes: buffer.byteLength };
}

/**
 * Build the static site shell:
 *  - public/ → dist/ (index.html, _headers, robots.txt, favicon)
 *  - src/ui/app.mjs → dist/assets/app.<hash>.js (bundled with engine + hyparquet)
 *  - src/styles/app.css → dist/assets/app.<hash>.css (imports tokens.css)
 *  - third-party license notice
 *
 * Asset filenames are content-hashed so they can be cached immutably.
 */
export async function buildStatic({ root, distDir }) {
  await mkdir(distDir, { recursive: true });
  await cp(path.join(root, 'public'), distDir, { recursive: true });

  const assetsDir = path.join(distDir, 'assets');
  await mkdir(assetsDir, { recursive: true });

  const appPath = path.join(assetsDir, 'app.js');
  const staticPath = path.join(assetsDir, 'static.js');
  await esbuild.build({
    entryPoints: [
      path.join(root, 'src', 'ui', 'app.mjs'),
      path.join(root, 'src', 'ui', 'static.mjs'),
    ],
    bundle: true,
    format: 'esm',
    minify: true,
    target: ['es2022'],
    splitting: true,
    outdir: assetsDir,
    entryNames: '[name]',
    chunkNames: 'chunk.[hash]',
    legalComments: 'none',
    logLevel: 'silent',
  });

  const cssPath = path.join(assetsDir, 'app.css');
  await esbuild.build({
    entryPoints: [path.join(root, 'src', 'styles', 'app.css')],
    bundle: true,
    minify: true,
    target: ['es2022'],
    outfile: cssPath,
    logLevel: 'silent',
  });

  // Parquet decode worker: self-contained classic worker, no code splitting.
  const workerPath = path.join(assetsDir, 'parquet-worker.js');
  await esbuild.build({
    entryPoints: [path.join(root, 'src', 'engine', 'parquet-worker.mjs')],
    bundle: true,
    format: 'iife',
    minify: true,
    target: ['es2022'],
    outfile: workerPath,
    legalComments: 'none',
    logLevel: 'silent',
  });

  const [app, css, worker, staticBundle] = await Promise.all([
    hashAsset(appPath),
    hashAsset(cssPath),
    hashAsset(workerPath),
    hashAsset(staticPath),
  ]);

  const hyparquetLicense = await readFile(
    path.join(root, 'node_modules', 'hyparquet', 'LICENSE'),
    'utf8',
  );
  await writeFile(
    path.join(assetsDir, 'THIRD-PARTY.txt'),
    `hyparquet — MIT License\nhttps://github.com/hyparam/hyparquet\n\n${hyparquetLicense}\n`,
  );

  // Substitute asset tokens in every root-level HTML file.
  const appToken = `/assets/${app.name}`;
  const cssToken = `/assets/${css.name}`;
  const workerToken = `/assets/${worker.name}`;
  const staticToken = `/assets/${staticBundle.name}`;
  for (const file of await readdir(distDir)) {
    if (!file.endsWith('.html')) continue;
    const htmlPath = path.join(distDir, file);
    let html = await readFile(htmlPath, 'utf8');
    html = html
      .replaceAll('{{APP_CSS}}', cssToken)
      .replaceAll('{{APP_JS}}', appToken)
      .replaceAll('{{STATIC_JS}}', staticToken)
      .replaceAll('{{WORKER_JS}}', workerToken);
    await writeFile(htmlPath, html);
  }

  await buildHelpPage({ distDir });

  const [appStat, cssStat] = await Promise.all([
    stat(path.join(assetsDir, app.name)),
    stat(path.join(assetsDir, css.name)),
  ]);
  return {
    appFile: `/assets/${app.name}`,
    cssFile: `/assets/${css.name}`,
    workerFile: workerToken,
    staticFile: staticToken,
    appBytes: appStat.size,
    cssBytes: cssStat.size,
    staticBytes: staticBundle.bytes,
  };
}
