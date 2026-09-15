/** Summarize Lighthouse JSON outputs: top score-damaging opportunities & diagnostics per page. */
import { readFileSync, existsSync, readdirSync } from 'node:fs';

const dir = process.env.TMPDIR + '/lh-results';
const OPPORTUNITY_AUDITS = [
  'render-blocking-resources', 'unused-javascript', 'modern-image-formats', 'offscreen-images',
  'uses-optimized-images', 'uses-responsive-images', 'uses-text-compression', 'uses-long-cache-ttl',
  'server-response-time', 'redirects', 'unused-css-rules', 'uses-rel-preconnect', 'dom-size',
  'mainthread-work-breakdown', 'bootup-time', 'third-party-summary', 'largest-contentful-paint-element',
  'lcp-lazy-loaded', 'layout-shifts', 'long-tasks',
];

for (const file of readdirSync(dir).filter((f) => f.endsWith('.json')).sort()) {
  const r = JSON.parse(readFileSync(`${dir}/${file}`, 'utf8'));
  const a = r.audits;
  console.log(`\n=== ${file.replace('.json', '')} — perf ${Math.round(r.categories.performance.score * 100)} ===`);
  const scored = Object.entries(OPPORTUNITY_AUDITS)
    .map(([k]) => a[k])
    .filter((x) => x && x.score !== null && x.score < 0.9 && !x.scoreDisplayMode.includes('INFORMATIVE'))
    .sort((x, y) => (x.score ?? 1) - (y.score ?? 1));
  for (const o of scored.slice(0, 5)) {
    const saving = o.details?.overallSavingsMs ? ` (~${Math.round(o.details.overallSavingsMs)}ms)` : '';
    console.log(`  [${(o.score * 100).toFixed(0)}] ${o.id}${saving} — ${o.title}`);
  }
  if (!scored.length) console.log('  no audits below 90');
}
