/** Run Lighthouse across URL archetypes and summarize. Usage: node e2e/lighthouse-matrix.mjs [mobile|desktop|all] */
import { execFileSync } from 'node:child_process';
import { mkdirSync, existsSync, readFileSync, writeFileSync, readdirSync } from 'node:fs';
import path from 'node:path';

const BASE = 'https://mac.jasontally.com';
const OUT = process.env.TMPDIR + '/lh-results';
mkdirSync(OUT, { recursive: true });

const PAGES = [
  ['home', '/'],
  ['help', '/help'],
  ['prefix', '/001B21'],
  ['fullmac', '/001B21AABBCC'],
  ['search', '/apple'],
  ['batch', '/001A2B,005056'],
  // New page types from the thin-content plan (worst cases included).
  ['vendor-hub', '/vendor/qualcomm-inc'],
  ['vendor-hub-big', '/vendor/apple-inc'],
  ['country-hub', '/country/us'],
];

const which = process.argv[2] ?? 'all';
for (const form of which === 'all' ? ['mobile', 'desktop'] : [which]) {
  for (const [slug, route] of PAGES) {
    const file = path.join(OUT, `${form}-${slug}.json`);
    if (existsSync(file) && process.env.REUSE === '1') continue;
    console.log(`running ${form} ${slug} …`);
    const args = [
      '--yes', 'lighthouse', BASE + route,
      '--preset=perf', `--form-factor=${form}`,
      ...(form === 'desktop' ? ['--screenEmulation.mobile=false', '--screenEmulation.width=1350', '--screenEmulation.height=940'] : []),
      '--quiet', '--chrome-flags=--headless',
      '--output=json', `--output-path=${file}`,
    ];
    execFileSync('npx', args, { stdio: ['ignore', 'ignore', 'inherit'] });
    console.log(`  ${form} ${slug} done`);
  }
}

const OPPORTUNITIES = [
  'render-blocking-resources', 'unused-javascript', 'modern-image-formats', 'offscreen-images',
  'uses-text-compression', 'uses-long-cache-ttl', 'server-response-time', 'redirects',
  'unused-css-rules', 'uses-rel-preconnect', 'dom-size', 'mainthread-work-breakdown',
  'bootup-time', 'third-party-summary', 'layout-shifts', 'long-tasks', 'lcp-lazy-loaded',
];

const rows = [];
for (const form of ['mobile', 'desktop']) {
  for (const [slug] of PAGES) {
    const file = path.join(OUT, `${form}-${slug}.json`);
    if (!existsSync(file)) continue;
    const r = JSON.parse(readFileSync(file, 'utf8'));
    const a = r.audits;
    rows.push({
      form, page: slug,
      perf: Math.round(r.categories.performance.score * 100),
      FCP: a['first-contentful-paint'].displayValue,
      LCP: a['largest-contentful-paint'].displayValue,
      TBT: a['total-blocking-time'].displayValue,
      CLS: a['cumulative-layout-shift'].displayValue,
      SI: a['speed-index'].displayValue,
    });
  }
}
console.table(rows);

for (const file of readdirSync(OUT).filter((f) => f.endsWith('.json')).sort()) {
  const r = JSON.parse(readFileSync(path.join(OUT, file), 'utf8'));
  const a = r.audits;
  const bad = OPPORTUNITIES
    .map((k) => a[k])
    .filter((x) => x && x.score !== null && x.score < 0.9)
    .sort((x, y) => (x.score ?? 1) - (y.score ?? 1));
  console.log(`\n=== ${file.replace('.json', '')} — perf ${Math.round(r.categories.performance.score * 100)} ===`);
  for (const o of bad.slice(0, 6)) {
    const saving = o.details?.overallSavingsMs ? ` ~${Math.round(o.details.overallSavingsMs)}ms` : '';
    console.log(`  [${(o.score * 100).toFixed(0)}] ${o.id}${saving} — ${o.title}`);
  }
  if (!bad.length) console.log('  all audits >= 90');
}
