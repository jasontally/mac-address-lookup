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

/**
 * Count pre-rendered pages by class: root-level prefix `<PREFIX>.html` files
 * plus hub pages under `vendor/` and `country/`. Shell files (`index.html`)
 * are not pages. The Workers limit is on all files; directory pages count as
 * pages against the page budget, not the non-page allowance.
 */
export function countPages(files) {
  const counts = { prefixes: 0, vendor: 0, country: 0 };
  for (const { path } of files) {
    if (!path.endsWith('.html')) continue;
    if (path.startsWith('vendor/')) counts.vendor += 1;
    else if (path.startsWith('country/')) counts.country += 1;
    else if (!path.includes('/') && path !== 'index.html' && path !== '404.html') {
      counts.prefixes += 1;
    }
  }
  return { ...counts, total: counts.prefixes + counts.vendor + counts.country };
}

/** Assert the build output fits the Workers Static Assets limits. */
export function checkBudget({ files, limits = {} }) {
  const { pageBudget, nonPageAllowance, maxFileBytes } = { ...DEFAULT_LIMITS, ...limits };
  const errors = [];
  const warnings = [];
  const pageCounts = countPages(files);
  const nonPage = files.length - pageCounts.total;
  const totalBudget = pageBudget + nonPageAllowance;
  const totalBytes = files.reduce((sum, file) => sum + file.bytes, 0);
  const warningBytes = 800 * 1024 * 1024;

  if (files.length > totalBudget) {
    errors.push(
      `Asset count ${files.length} exceeds budget ${totalBudget} (pages ${pageCounts.total}, other ${nonPage})`,
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

  return {
    errors,
    warnings,
    stats: {
      files: files.length,
      pages: pageCounts.total,
      pagesByType: { prefixes: pageCounts.prefixes, vendor: pageCounts.vendor, country: pageCounts.country },
      nonPage,
      totalBytes,
    },
  };
}

export function formatBytes(bytes) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(2)} MB`;
}
