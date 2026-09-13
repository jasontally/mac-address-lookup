import { cp, mkdir, readFile, stat, writeFile } from 'node:fs/promises';
import path from 'node:path';
import * as esbuild from 'esbuild';

/**
 * Build the static site shell:
 *  - public/ → dist/ (index.html, _headers, robots.txt, favicon)
 *  - src/ui/app.mjs → dist/assets/app.js (bundled with engine + hyparquet)
 *  - src/styles/app.css → dist/assets/app.css (imports tokens.css)
 *  - third-party license notice
 */
export async function buildStatic({ root, distDir }) {
  await mkdir(distDir, { recursive: true });
  await cp(path.join(root, 'public'), distDir, { recursive: true });

  const assetsDir = path.join(distDir, 'assets');
  await mkdir(assetsDir, { recursive: true });

  const appPath = path.join(assetsDir, 'app.js');
  await esbuild.build({
    entryPoints: [path.join(root, 'src', 'ui', 'app.mjs')],
    bundle: true,
    format: 'esm',
    minify: true,
    target: ['es2022'],
    outfile: appPath,
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

  const hyparquetLicense = await readFile(
    path.join(root, 'node_modules', 'hyparquet', 'LICENSE'),
    'utf8',
  );
  await writeFile(
    path.join(assetsDir, 'THIRD-PARTY.txt'),
    `hyparquet — MIT License\nhttps://github.com/hyparam/hyparquet\n\n${hyparquetLicense}\n`,
  );

  const [app, css] = await Promise.all([stat(appPath), stat(cssPath)]);
  return { appBytes: app.size, cssBytes: css.size };
}
