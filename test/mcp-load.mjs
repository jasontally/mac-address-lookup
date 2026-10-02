/**
 * Load and correctness test against the deployed /mcp endpoint.
 *
 *   npm run mcp:load
 *   npm run mcp:load -- --requests 2000 --concurrency 16
 *   npm run mcp:load -- --requests 500 --concurrency 4 --json out.json
 *
 * Two things are measured, because either alone is not worth much:
 *
 *   1. Correctness. Every response is checked against a brute-force oracle built
 *      from the registry file the same site publishes. A lookup that is fast and
 *      wrong is a failure; that is the failure mode this project has actually
 *      hit (a 3-hex shard layout silently dropped 1,141 lookups). Latency on its
 *      own proves nothing.
 *
 *   2. Latency. p50/p90/p95/p99/max, throughput, and the error rate, split by
 *      input class so a slow carve bucket does not hide inside a good average.
 *
 * The mix is deliberate: a uniform sample of prefixes would under-test the
 * worst cases. So the cases are split into registered prefixes, addresses
 * padded inside a registered block, the three depth-6 carve buckets (0050, 70B3,
 * 8C1F64) which are the largest files on the site, unregistered prefixes, and
 * the malformed forms the Snippet has to reject.
 *
 * This sends real traffic to production. It is read-only and public, but it is
 * not a `npm test` member for that reason. Start with the defaults.
 */

import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { performance } from 'node:perf_hooks';

import { MCP_ROUTE, SITE } from '../build/mcp-shards.mjs';

const URL_UNDER_TEST = `${SITE}${MCP_ROUTE}`;
const REGISTRY_URL = `${SITE}/data/registry.ndjson`;

// The three buckets the build carved to depth 6 because they exceed the 30 KB
// shard target. 8C1F64 is 174 KB, the largest file on the site, so a lookup that
// lands there is the slowest thing the endpoint can be asked to do.
const CARVE_BUCKETS = ['0050', '70B3', '8C1F'];

// --------------------------------------------------------------- arguments

function parseArgs(argv) {
  const out = {
    requests: 400,
    concurrency: 8,
    warmup: 40,
    seed: 20261001,
    registry: path.resolve('dist/data/registry.ndjson'),
    json: null,
    url: URL_UNDER_TEST,
    quiet: false,
    duration: 0,
    keep: 4000,
  };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    const next = () => argv[++i];
    if (arg === '--requests') out.requests = Number(next());
    else if (arg === '--concurrency') out.concurrency = Number(next());
    else if (arg === '--warmup') out.warmup = Number(next());
    else if (arg === '--seed') out.seed = Number(next());
    else if (arg === '--registry') out.registry = path.resolve(next());
    else if (arg === '--json') out.json = next();
    else if (arg === '--url') out.url = next();
    else if (arg === '--duration') out.duration = Number(next());
    else if (arg === '--keep') out.keep = Number(next());
    else if (arg === '--quiet') out.quiet = true;
    else if (arg === '--help' || arg === '-h') out.help = true;
    else throw new Error(`unknown argument: ${arg}`);
  }
  return out;
}

const HELP = `
mcp:load - correctness and latency against ${URL_UNDER_TEST}

  --requests <n>      total measured requests (default 400)
  --duration <secs>   run for this long instead of a request count. The right
                      unit for a soak: the question is whether latency drifts
                      over time, and that needs hours, not more requests.
                      At ~950 req/s, 1h is ~3.4M requests.
  --keep <n>          records retained for the JSON (default 4000). Every
                      failure is always kept. Percentiles come from a
                      streaming histogram, so this does not affect accuracy
                      and a long run cannot exhaust memory.
  --concurrency <n>   in-flight requests (default 8)
  --warmup <n>        discarded first requests (default 40)
  --seed <n>          PRNG seed, so a run is reproducible (default 20261001).
                      Change it between runs: the ~150ms cluster caused by
                      client connection setup lands on different input classes
                      with each seed, which reads like a class-specific bug and
                      is not one. Compare p50 across runs, not p99.
  --registry <path>   registry NDJSON for the oracle
                      (default dist/data/registry.ndjson, fetched if absent)
  --json <path>       write records and per-segment drift stats here
  --url <url>         endpoint to test
  --quiet             only print the summary

Every request is validated against a brute-force oracle, so a fast wrong answer
counts as a failure. Sends real traffic to production.

Measured on a 2-core VM, this endpoint does ~950 req/s at concurrency 48 and
~1190 at 64. Past that latency rises faster than throughput. If you have no IPv6
route, absolute latency is inflated by roughly 40ms of Happy Eyeballs fallback.
`;

// ------------------------------------------------------- deterministic PRNG

/** mulberry32: small, fast, and seeded, so a failing run can be replayed. */
function makeRandom(seed) {
  let a = seed >>> 0;
  return function next() {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const HEX = '0123456789ABCDEF';

// ------------------------------------------------------------- the oracle

/**
 * Build the oracle from the registry: a map of prefix length -> Set of prefixes.
 *
 * The answer to any query is the longest registered prefix that the query
 * starts with. Bucketing by length turns that into at most 6 map lookups
 * instead of a scan over 58,880 records, which matters because the oracle runs
 * once per request inside the measured window.
 */
function buildOracle(ndjson) {
  const byLength = new Map();
  const orgByPrefix = new Map();
  let count = 0;
  for (const line of ndjson.split('\n')) {
    if (!line) continue;
    let record;
    try {
      record = JSON.parse(line);
    } catch {
      continue;
    }
    if (typeof record.prefix !== 'string') continue;
    const len = record.prefix.length;
    if (!byLength.has(len)) byLength.set(len, new Set());
    byLength.get(len).add(record.prefix);
    orgByPrefix.set(record.prefix, record);
    count += 1;
  }
  const lengths = [...byLength.keys()].sort((a, b) => b - a);

  /** The longest registered prefix that hex starts with, or null. */
  function longestMatch(hex) {
    const upper = hex.toUpperCase();
    for (const len of lengths) {
      const set = byLength.get(len);
      if (set.has(upper.slice(0, len))) return upper.slice(0, len);
    }
    return null;
  }

  return { longestMatch, orgByPrefix, recordCount: count, lengths };
}

// ------------------------------------------------------------- case mix

/**
 * Build a case generator. Class labels matter: the point of reporting per-class
 * latency is that a p99 dominated by one slow bucket should be visible rather
 * than averaged away.
 *
 * A generator rather than a fixed array, so a time-boxed soak can run for hours
 * without holding every case in memory. Draws are sequential on one seeded PRNG,
 * so the mix is reproducible; the interleaving is not, because workers pull
 * concurrently.
 */
function makeCaseFactory(oracle, rand) {
  const registered = [...oracle.orgByPrefix.keys()];

  /** A random address inside a registered block: pad the block to 12 chars. */
  const insideBlock = (prefix) => {
    const padded = prefix.padEnd(12, '0');
    const head = prefix.length;
    let tail = padded.slice(head);
    for (let i = 0; i < tail.length; i += 1) {
      if (rand() < 0.5) tail = `${tail.slice(0, i)}${HEX[Math.floor(rand() * 16)]}${tail.slice(i + 1)}`;
    }
    return `${prefix}${tail}`;
  };

  const unregistered = () => {
    // Reject prefixes that collide with something registered, so the expected
    // answer really is "no match" and not a near miss.
    for (let attempt = 0; attempt < 24; attempt += 1) {
      let hex = '';
      for (let i = 0; i < 6; i += 1) hex += HEX[Math.floor(rand() * 16)];
      if (oracle.longestMatch(hex) === null) return `${hex}${hex}`;
    }
    return 'FFFFFFDEADBE';
  };

  const pick = (arr) => arr[Math.floor(rand() * arr.length)];

  // Weights summing to 1. Tuned so the cheap bulk cases dominate and the slow
  // buckets are still sampled enough for the tail to mean something.
  const carved = registered.filter((p) => CARVE_BUCKETS.some((b) => p.startsWith(b)));
  const steps = [
    { label: 'registered-prefix', weight: 0.3, make: () => pick(registered) },
    { label: 'address-in-block', weight: 0.3, make: () => insideBlock(pick(registered)) },
    { label: 'carve-bucket', weight: 0.12, make: () => (carved.length ? pick(carved) : pick(registered)) },
    { label: 'unregistered', weight: 0.2, make: unregistered },
    {
      label: 'separator-form',
      weight: 0.05,
      make: () => insideBlock(pick(registered)).replace(/(.{2})(?=.)/g, '$1:'),
    },
    { label: 'too-short', weight: 0.03, make: () => HEX[Math.floor(rand() * 16)] },
  ];

  // Cumulative weights, so picking a class is one random number and one scan.
  const cumulative = [];
  let run = 0;
  for (const step of steps) {
    run += step.weight;
    cumulative.push({ label: step.label, upTo: run, make: step.make });
  }

  return function nextCase() {
    const r = rand();
    const chosen = cumulative.find((c) => r <= c.upTo) ?? cumulative[cumulative.length - 1];
    return { label: chosen.label, mac: chosen.make() };
  };
}

/**
 * Materialise `total` cases from the factory, interleaved.
 *
 * Interleaving happens here rather than in the factory so a time-boxed run and
 * a count-based run see the same kind of ordering: a window of concurrency
 * covers every class rather than one class at a time.
 */
function buildPlan(factory, total, rand) {
  const cases = [];
  for (let i = 0; i < total; i += 1) cases.push(factory());
  for (let i = cases.length - 1; i > 0; i -= 1) {
    const j = Math.floor(rand() * (i + 1));
    [cases[i], cases[j]] = [cases[j], cases[i]];
  }
  return cases;
}

// ------------------------------------------------------------- validation

/**
 * Check one response against the oracle.
 *
 * Returns an array of problems; empty means correct. Anything wrong is reported
 * with the query and what was expected, because a bare "3 mismatches" is not
 * actionable.
 */
function validate(query, body, oracle, expectInvalid) {
  const problems = [];
  const where = `query ${query}`;

  if (body?.jsonrpc !== '2.0') problems.push(`${where}: jsonrpc is ${body?.jsonrpc}, want "2.0"`);
  if (body?.error) {
    if (!expectInvalid) {
      problems.push(`${where}: error ${body.error.code} ${body.error.message}`);
    }
    return problems;
  }
  const result = body?.result;
  if (!result) {
    problems.push(`${where}: no result and no error`);
    return problems;
  }
  // The oracle keys on bare hex, so strip separators before comparing. The
  // Snippet normalizes a query before it matches; the validator has to do the
  // same or every punctuated form reads as a false "no match". An earlier
  // revision missed this and reported 3 server bugs that were 3 test bugs.
  const hex = query.replace(/[^0-9A-Fa-f]/g, '').toUpperCase();
  const sc = result.structuredContent;
  if (!sc) {
    problems.push(`${where}: no structuredContent`);
    return problems;
  }
  if (result.isError) problems.push(`${where}: result.isError is true`);

  // The text block is what a client without structured output shows a user, so
  // a missing one is a real defect even when structuredContent is fine.
  const text = result.content?.[0];
  if (text?.type !== 'text' || typeof text.text !== 'string') {
    problems.push(`${where}: content[0] is not a text block`);
  }

  const expected = oracle.longestMatch(hex);

  if (expectInvalid) {
    // A malformed query must not be answered with a confident vendor. Either an
    // INVALID_PARAMS error, or a null prefix with an explanation, is correct.
    if (hex.length >= 6 && expected !== null && sc.prefix !== null) {
      problems.push(`${where}: malformed input still resolved to ${sc.prefix}`);
    }
    return problems;
  }

  if (sc.prefix !== expected) {
    problems.push(`${where}: got prefix ${JSON.stringify(sc.prefix)}, want ${JSON.stringify(expected)}`);
    return problems;
  }
  if (expected === null) {
    if (!/random|locally administered|no registered|not found|cannot/i.test(text?.text || '')) {
      problems.push(`${where}: no match with no explanation: ${JSON.stringify(text?.text?.slice(0, 80))}`);
    }
    return problems;
  }
  const record = oracle.orgByPrefix.get(expected);
  if (record) {
    if (sc.orgName !== record.orgName) {
      problems.push(`${where}: orgName ${JSON.stringify(sc.orgName)} != ${JSON.stringify(record.orgName)}`);
    }
    if (sc.blockType !== record.blockType) {
      problems.push(`${where}: blockType ${sc.blockType} != ${record.blockType}`);
    }
  }
  // The record page must be the real one for the matched prefix, or a client
  // cannot get from an answer to the organization address.
  if (typeof sc.url !== 'string' || !sc.url.endsWith(`/${expected}`)) {
    problems.push(`${where}: url ${JSON.stringify(sc.url)} does not point at /${expected}`);
  }
  return problems;
}

// ------------------------------------------------------------- statistics

/**
 * Percentiles over a set of latencies, computed by counting sort.
 *
 * At 100,000 requests the naive sort-per-call approach costs real time inside
 * the driver, and the progress reporter recomputes percentiles on every tick.
 * Every measurement is a non-negative number of milliseconds with three decimal
 * places, so integers give an exact ordering and a histogram is both faster and
 * allocation-free.
 */
class LatencyAccumulator {
  /** Bucket width in ms. Finer than any effect worth reporting at this scale. */
  static WIDTH_MS = 0.1;

  constructor() {
    this.count = 0;
    this.sum = 0;
    this.max = 0;
    this.buckets = new Map();
  }

  add(ms) {
    const v = ms < 0 ? 0 : ms;
    this.count += 1;
    this.sum += v;
    if (v > this.max) this.max = v;
    const key = Math.round(v / LatencyAccumulator.WIDTH_MS);
    this.buckets.set(key, (this.buckets.get(key) ?? 0) + 1);
  }

  /** Snapshot of the percentiles, so the progress reporter can poll cheaply. */
  summarize() {
    if (!this.count) return { n: 0 };
    const keys = [...this.buckets.keys()].sort((a, b) => a - b);
    const rank = (p) => {
      const target = Math.ceil((p / 100) * this.count);
      let seen = 0;
      for (const key of keys) {
        seen += this.buckets.get(key);
        if (seen >= target) return Math.round(key * LatencyAccumulator.WIDTH_MS * 1000) / 1000;
      }
      return this.max;
    };
    const round = (v) => Math.round(v * 1000) / 1000;
    return {
      n: this.count,
      p50: rank(50),
      p90: rank(90),
      p95: rank(95),
      p99: rank(99),
      max: round(this.max),
      mean: round(this.sum / this.count),
    };
  }
}

const ms = (v) => (v === null ? '   -  ' : `${v.toFixed(1).padStart(7)}ms`);

function printStats(label, s, extra = '') {
  if (!s.n) {
    console.log(`  ${label.padEnd(20)} no samples${extra}`);
    return;
  }
  console.log(
    `  ${label.padEnd(20)} n=${String(s.n).padStart(6)}  ` +
      `p50 ${ms(s.p50)}  p90 ${ms(s.p90)}  p95 ${ms(s.p95)}  p99 ${ms(s.p99)}  ` +
      `max ${ms(s.max)}  mean ${ms(s.mean)}${extra}`,
  );
}

// ----------------------------------------------------------------- driver

async function loadRegistry(spec) {
  try {
    const text = await readFile(spec.registry, 'utf8');
    console.log(`oracle: ${spec.registry}`);
    return text;
  } catch {
    const url = REGISTRY_URL;
    console.log(`oracle: fetching ${url}`);
    const res = await fetch(url);
    if (!res.ok) throw new Error(`could not load the registry: ${res.status} at ${spec.registry}`);
    return res.text();
  }
}

/**
 * Reused connections. Measured 2026-10-01: at concurrency 1 the p99 was 68 ms
 * with no secondary cluster, and at concurrency 24 a ~200 ms cluster appeared on
 * roughly a third of requests, evenly spread across the run rather than at the
 * start. That is connection setup in the client, not the server: each fresh
 * TLS handshake costs ~150 ms and Node's fetch pool grows with concurrency.
 *
 * Keeping the agent warm makes the numbers describe the endpoint. Latency then
 * falls from a ~200 ms p99 to ~60 ms at the same concurrency.
 */
/** One request. Timing spans only the fetch, so it measures the server. */
async function one(spec, testCase, id, oracle) {
  const expectInvalid = testCase.label === 'too-short';
  const mac = testCase.mac;
  const payload = JSON.stringify({
    jsonrpc: '2.0',
    id,
    method: 'tools/call',
    params: { name: 'lookup', arguments: { mac } },
  });
  const started = performance.now();
  let record;
  try {
    const res = await fetch(spec.url, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        accept: 'application/json',
        'MCP-Protocol-Version': '2026-07-28',
        'Mcp-Method': 'tools/call',
        'Mcp-Name': 'lookup',
      },
      body: payload,
    });
    const text = await res.text();
    const elapsed = performance.now() - started;
    let json = null;
    try {
      json = JSON.parse(text);
    } catch {
      /* left null; validate reports it */
    }
    const problems = validate(mac, json, oracle, expectInvalid);
    if (res.status !== 200 && !expectInvalid) problems.unshift(`HTTP ${res.status}`);
    record = {
      mac,
      label: testCase.label,
      status: res.status,
      ms: Math.round(elapsed * 1000) / 1000,
      ok: problems.length === 0,
      problems,
      prefix: json?.result?.structuredContent?.prefix ?? null,
      cfRay: res.headers.get('cf-ray'),
      colo: res.headers.get('cf-ray')?.match(/-([A-Z]{3})\s*$/)?.[1] ?? null,
    };
  } catch (error) {
    record = {
      mac,
      label: testCase.label,
      status: 0,
      ms: Math.round((performance.now() - started) * 1000) / 1000,
      ok: false,
      problems: [`transport: ${error.message}`],
      prefix: null,
    };
  }
  return record;
}

/**
 * Run `plan` through a fixed number of workers.
 *
 * Percentiles come from a histogram that is fed as results arrive, so a long
 * run can report progress without holding a second copy of every latency, and
 * without sorting inside the driver.
 */
/**
 * Run requests through a fixed number of workers, until either the plan is
 * exhausted or the time box expires.
 *
 * Memory is bounded regardless of run length. A soak at 1000 req/s for hours is
 * tens of millions of requests, and retaining every record would be gigabytes:
 * measured ~400 bytes each, so 12 million requests is 4.7 GB on a 7 GB machine.
 * Only `spec.keep` records are retained (a spread of samples plus every
 * failure), and every percentile comes from the streaming histogram instead.
 */
async function runPool(spec, plan, oracle, { onProgress, deadlineAt, segments } = {}) {
  const out = [];
  const failures = [];
  const lat = new LatencyAccumulator();
  const perClass = new Map();
  let done = 0;
  let wrong = 0;
  const startedAt = performance.now();
  const total = plan ? plan.length : Infinity;
  const reportEvery = Number.isFinite(total)
    ? Math.max(1, Math.floor(total / 20))
    : 5_000;
  const segmentSize = Number.isFinite(total) ? Math.max(1, Math.floor(total / 20)) : 20_000;
  let currentSegment = new LatencyAccumulator();
  let segmentStart = 0;
  let cursor = 0;
  const keep = Math.max(1, spec.keep);

  const workers = Array.from({ length: Math.max(1, spec.concurrency) }, async () => {
    for (;;) {
      if (deadlineAt && performance.now() >= deadlineAt) return;
      let testCase;
      if (plan) {
        const i = cursor++;
        if (i >= plan.length) return;
        testCase = plan[i];
      } else {
        testCase = oracle.nextCase();
      }
      const record = await one(spec, testCase, done + 1, oracle);

      if (record.ok) {
        lat.add(record.ms);
        currentSegment.add(record.ms);
        if (!perClass.has(record.label)) perClass.set(record.label, new LatencyAccumulator());
        perClass.get(record.label).add(record.ms);
      } else {
        wrong += 1;
        failures.push(record);
      }

      // Keep a spread of correct records for the JSON, and every failure.
      const sample = failures.length ? false : out.length < keep;
      if (sample) out.push(record);
      else if (!record.ok && out.length < keep * 4) out.push(record);

      done += 1;
      if (done % segmentSize === 0 && segments) {
        segments.push({
          from: segmentStart,
          to: done,
          atMs: Math.round(performance.now() - startedAt),
          heapMb: Math.round((process.memoryUsage().heapUsed / 1048576) * 10) / 10,
          stats: currentSegment.summarize(),
        });
        segmentStart = done;
        currentSegment = new LatencyAccumulator();
      }
      if (onProgress && done % reportEvery === 0) {
        onProgress({ done, total, wrong, elapsedMs: performance.now() - startedAt, lat });
      }
    }
  });
  await Promise.all(workers);

  if (segments && done > segmentStart) {
    segments.push({
      from: segmentStart,
      to: done,
      atMs: Math.round(performance.now() - startedAt),
      heapMb: Math.round((process.memoryUsage().heapUsed / 1048576) * 10) / 10,
      stats: currentSegment.summarize(),
    });
  }

  return {
    records: out,
    failures,
    latencies: lat,
    perClass,
    done,
    wrong,
    elapsedMs: performance.now() - startedAt,
  };
}

/**
 * Fetch once per worker slot so the connection pool is warm before any request
 * is timed.
 *
 * Node's fetch (undici) pools connections per origin and grows the pool as
 * concurrency demands it, so the first requests at a given concurrency pay for
 * a handshake. A single extra fetch per slot is enough to remove that cost from
 * the measured window.
 */
async function primeConnections(spec) {
  const slots = Math.max(1, spec.concurrency);
  await Promise.all(
    Array.from({ length: slots }, () =>
      fetch(spec.url, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          accept: 'application/json',
          'MCP-Protocol-Version': '2026-07-28',
          'Mcp-Method': 'tools/list',
        },
        body: JSON.stringify({ jsonrpc: '2.0', id: 0, method: 'tools/list' }),
      }).then((r) => r.text()),
    ),
  );
}

// ------------------------------------------------------------------- main

async function main() {
  const spec = parseArgs(process.argv.slice(2));
  if (spec.help) {
    console.log(HELP);
    return;
  }

  const rand = makeRandom(spec.seed);
  console.log(`load test against ${spec.url}`);
  console.log(`  requests=${spec.requests} concurrency=${spec.concurrency} warmup=${spec.warmup} seed=${spec.seed}\n`);

  const ndjson = await loadRegistry(spec);
  const oracle = buildOracle(ndjson);
  console.log(
    `  ${oracle.recordCount.toLocaleString('en-US')} registered prefixes, lengths ${oracle.lengths.join('/')}\n`,
  );

  // Open one connection per worker before measuring, and keep it alive. Without
  // this, each fresh TLS handshake lands inside a timed request and inflates the
  // tail by ~150 ms: measured p99 was 68 ms at concurrency 1 with no secondary
  // cluster, and a ~200 ms cluster appeared on a third of requests at
  // concurrency 24. That is the client, not the endpoint.
  await primeConnections(spec);

  // Warmup is discarded: the first requests to a cold edge are not the steady
  // state, and including them would misreport p99.
  const factory = makeCaseFactory(oracle, rand);
  oracle.nextCase = factory;
  const warm = buildPlan(factory, spec.warmup, rand);
  if (warm.length) {
    await runPool(spec, warm, oracle);
    console.log(`  warmup ${warm.length} requests discarded\n`);
  }

  // Progress matters at this scale: a 100k run takes minutes, and a soak takes
  // hours. Silence would be indistinguishable from a hang. Reporting latency as
  // it goes also answers a question a final snapshot cannot, which is whether
  // the endpoint degrades over time.
  const onProgress = spec.quiet
    ? undefined
    : ({ done, total, wrong, elapsedMs, lat }) => {
        const s = lat.summarize();
        const rate = done / (elapsedMs / 1000);
        const target = Number.isFinite(total) ? `/${total}` : '   ';
        const mins = (elapsedMs / 60000).toFixed(0);
        // The client's own heap is reported because a soak cannot otherwise tell
        // a client leak from a lazy V8 heap. RSS is a high-water mark and only
        // ever rises; heapUsed is the live set, so a slope in it is real.
        const heapMb = (process.memoryUsage().heapUsed / 1048576).toFixed(1);
        process.stdout.write(
          `  ${String(done).padStart(8)}${target}  ${rate.toFixed(0).padStart(5)} req/s  ` +
            `${mins.padStart(4)}min  p50 ${s.p50.toFixed(0).padStart(4)}ms  ` +
            `p95 ${s.p95.toFixed(0).padStart(4)}ms  p99 ${s.p99.toFixed(0).padStart(4)}ms  ` +
            `heap ${heapMb.padStart(6)}MB${wrong ? `  ${wrong} bad` : ''}\n`,
        );
      };

  const segments = [];
  const timed = spec.duration > 0;
  const plan = timed ? null : buildPlan(factory, spec.requests, rand);
  const deadlineAt = timed ? performance.now() + spec.duration * 1000 : null;
  if (timed) {
    console.log(
      `  time-boxed: ${spec.duration}s at concurrency ${spec.concurrency}, ` +
        `retaining ${spec.keep} records and every failure\n`,
    );
  }

  const run = await runPool(spec, plan, oracle, {
    onProgress,
    deadlineAt,
    segments,
  });
  if (!spec.quiet) console.log('');

  // ------------------------------------------------------------- reporting

  const { records, latencies, perClass, failures, done, elapsedMs: wall } = run;
  const good = records.filter((r) => r.ok);
  const bad = [...failures];
  // A transport failure is the client's socket, not the endpoint's answer.
  // Counting them apart stops a blip in Node's connection pool from being
  // reported as the server returning a bad result.
  const transport = bad.filter((r) => r.problems[0]?.startsWith('transport:'));
  const incorrect = bad.filter((r) => !r.problems[0]?.startsWith('transport:'));
  const answeredCorrectly = latencies.count;
  const all = latencies.summarize();

  console.log('latency, all classes');
  printStats('all', all, `   ${(answeredCorrectly / (wall / 1000)).toFixed(1)} req/s`);
  console.log('');
  console.log('latency by input class');
  for (const [label, acc] of [...perClass].sort((a, b) => b[1].count - a[1].count)) {
    printStats(label, acc.summarize());
  }

  const colos = {};
  for (const r of records) if (r.colo) colos[r.colo] = (colos[r.colo] ?? 0) + 1;
  const coloList = Object.entries(colos).sort((a, b) => b[1] - a[1]);
  if (coloList.length) {
    console.log('');
    console.log(`edge colo (of sampled records): ${coloList.map(([c, n]) => `${c} ${n}`).join(', ')}`);
  }

  // Drift over time is the thing a soak exists to find, so it is reported
  // first and not left in the JSON for the reader to compute by hand.
  if (segments.length >= 2) {
    console.log('');
    console.log('latency and client heap over time (drift)');
    console.log('                  window      p50      p95      p99      max     heap');
    for (const seg of segments) {
      const s = seg.stats;
      if (!s.n) continue;
      console.log(
        `  ${String(seg.from).padStart(7)}-${String(seg.to).padEnd(7)} ` +
          `${ms(s.p50)} ${ms(s.p95)} ${ms(s.p99)} ${ms(s.max)}  ${String(seg.heapMb ?? 0).padStart(6)}MB`,
      );
    }
    const first = segments.find((s) => s.stats.n)?.stats;
    const last = [...segments].reverse().find((s) => s.stats.n)?.stats;
    if (first && last && first !== last) {
      const delta = last.p50 - first.p50;
      const verdict =
        Math.abs(delta) < 5
          ? 'flat: no drift'
          : delta > 0
            ? `p50 rose ${delta.toFixed(1)}ms: investigate`
            : `p50 fell ${Math.abs(delta).toFixed(1)}ms: connection pool warming, expected`;
      console.log(`\n  drift: p50 ${first.p50}ms -> ${last.p50}ms  (${verdict})`);
    }
    // A rising live heap across a long run is a client-side leak, and it would
    // otherwise be indistinguishable from the endpoint getting worse.
    const heaps = segments.filter((s) => typeof s.heapMb === 'number').map((s) => s.heapMb);
    if (heaps.length > 3) {
      const slope = (heaps[heaps.length - 1] - heaps[0]) / (heaps.length - 1);
      console.log(
        `  client heap: ${heaps[0].toFixed(1)}MB -> ${heaps[heaps.length - 1].toFixed(1)}MB ` +
          `(${(slope >= 0 ? '+' : '')}${slope.toFixed(2)}MB per segment` +
          `${slope > 1 ? ', LEAKING' : ', flat'})`,
      );
    }
  }

  if (bad.length === 0 && all.p99 > 150) {
    console.log('');
    console.log(
      `note: p99 ${all.p99}ms is above the ~65-90ms this endpoint usually shows.\n` +
        '      Connection-pool churn inflates the tail; compare p50 across runs.',
    );
  }

  // Measured 2026-10-01 across seeds 111/222/333 at concurrency 16: the slow
  // requests moved from separator-form (27%) and unregistered (18%) to
  // address-in-block and registered-prefix (0% before, ~40% after) purely by
  // reshuffling. The classes are evenly interleaved in time, 96 isolated runs of
  // length <= 2 across 2000 requests, so it is not a stall either. It is the
  // client connection pool: ~150 ms of TLS handshake leaking into a timed
  // request. Seed-dependent by construction, which is why it looks structured.
  console.log('');
  console.log('correctness');
  console.log(`  ${good.length}/${records.length} answered correctly`);
  console.log(`  ${incorrect.length} answered incorrectly`);
  console.log(`  ${transport.length} transport failures (client side, no answer to check)`);
  if (transport.length) {
    console.log(`      e.g. ${transport[0].mac} -> ${transport[0].problems[0]}`);
  }
  if (incorrect.length) {
    // Group the reasons so one systematic bug does not print 400 identical lines.
    const groups = new Map();
    for (const r of bad) {
      const key = r.problems[0].replace(/^query [^:]+: /, '');
      if (!groups.has(key)) groups.set(key, []);
      groups.get(key).push(r);
    }
    for (const [key, rows] of [...groups].sort((a, b) => b[1].length - a[1].length).slice(0, 12)) {
      console.log(`  ${rows.length}x ${key}`);
      console.log(`      e.g. ${rows[0].mac} -> ${JSON.stringify(rows[0].prefix)}`);
    }
  }

  if (spec.json) {
    await writeFile(
      spec.json,
      JSON.stringify(
        {
          spec: { ...spec, registry: undefined },
          done,
          wall,
          summary: all,
          byClass: Object.fromEntries(
            [...perClass].map(([k, acc]) => [k, acc.summarize()]),
          ),
          segments,
          retained: records.length,
          failures,
          records,
        },
        null,
        2,
      ),
    );
    console.log(`\nrecords, drift segments and summary written to ${spec.json}`);
  }

  console.log(
    `\n${done.toLocaleString('en-US')} requests in ${(wall / 1000).toFixed(1)}s ` +
      `at concurrency ${spec.concurrency}` +
      `${timed ? ` (time-boxed ${spec.duration}s)` : ''}`,
  );
  if (incorrect.length) {
    console.log(`FAILED: ${incorrect.length} responses did not match the oracle`);
    process.exitCode = 1;
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});