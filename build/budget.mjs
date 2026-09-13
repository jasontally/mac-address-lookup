import { readdir, stat } from 'node:fs/promises';
import path from 'node:path';

/** Page budget leaves 10% headroom under the 100,000-file paid limit. */
export const DEFAULT_LIMITS = {
  pageBudget: 90_000,
  nonPageAllowance: 2_000,
  maxFileBytes: 20 * 1024 * 1024,
};

/** Recursively list files with sizes, relative to `base`. */
export async function walkDir(dir, base = dir, files = []) {
  let entries;
  try {
    entries = await readdir(dir, { withFileTypes: true });
  } catch {
    return files;
  }
  for (const entry of entries) {
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      await walkDir(fullPath, base, files);
    } else if (entry.isFile()) {
      const info = await stat(fullPath);
      files.push({ path: path.relative(base, fullPath), bytes: info.size });
    }
  }
  return files;
}

/** Count pre-rendered prefix pages (root-level `.html`, excluding shell files). */
export function countPages(files) {
  return files.filter(
    (file) =>
      file.path.endsWith('.html') &&
      !file.path.includes('/') &&
      file.path !== 'index.html' &&
      file.path !== '404.html',
  ).length;
}

/** Assert the build output fits the Workers Static Assets limits. */
export function checkBudget({ files, limits = {} }) {
  const { pageBudget, nonPageAllowance, maxFileBytes } = { ...DEFAULT_LIMITS, ...limits };
  const errors = [];
  const warnings = [];
  const pages = countPages(files);
  const nonPage = files.length - pages;
  const totalBudget = pageBudget + nonPageAllowance;
  const totalBytes = files.reduce((sum, file) => sum + file.bytes, 0);
  const warningBytes = 800 * 1024 * 1024;

  if (files.length > totalBudget) {
    errors.push(
      `Asset count ${files.length} exceeds budget ${totalBudget} (pages ${pages}, other ${nonPage})`,
    );
  } else if (files.length > totalBudget * 0.9) {
    warnings.push(`Asset count ${files.length} is above 90% of budget ${totalBudget}`);
  }

  if (totalBytes > warningBytes) {
    warnings.push(
      `Total output ${formatBytes(totalBytes)} is above 800 MB; deploy upload time may be long`,
    );
  }

  for (const file of files) {
    if (file.bytes > maxFileBytes) {
      errors.push(`Asset ${file.path} is ${file.bytes} bytes, over the ${maxFileBytes} byte limit`);
    }
  }

  return { errors, warnings, stats: { files: files.length, pages, nonPage, totalBytes } };
}

export function formatBytes(bytes) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(2)} MB`;
}
