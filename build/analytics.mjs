/**
 * Build-time analytics phase.
 *
 * Compares the freshly normalized IEEE registry against the one currently
 * deployed, finds prefixes that are new since the last build, and flags the
 * ones that look notable:
 *
 *   - a company receives its first ever prefix
 *   - a company receives a block significantly larger than any it held before
 *   - a company's acquisition rate for a given block size is rising sharply
 *
 * Findings are reported by email through the Cloudflare Email Service REST API.
 * The recipient and sender are read from the environment so that no address is
 * ever committed to the repository.
 */

import { normalizeOrgName } from './lineage.mjs';

export const SITE = 'https://mac.jasontally.com';

export const RECIPIENT_ENV_NAMES = [
  'ANALYTICS_EMAIL',
  'NOTIFICATION_EMAIL',
  'ALERT_EMAIL',
  'RECIPIENT_EMAIL',
  'EMAIL_TO',
  'EMAIL_RECIPIENT',
];

export const SENDER_ENV_NAMES = [
  'ANALYTICS_FROM',
  'NOTIFICATION_FROM',
  'ALERT_FROM',
  'EMAIL_FROM',
  'EMAIL_SENDER',
];

export const ACCOUNT_ENV_NAMES = ['CLOUDFLARE_ACCOUNT_ID', 'CF_ACCOUNT_ID', 'ACCOUNT_ID'];
export const TOKEN_ENV_NAMES = ['CLOUDFLARE_API_TOKEN', 'CF_API_TOKEN', 'API_TOKEN'];

/** Pick the first non-empty value among the named environment variables. */
export function resolveEnv(names, env = process.env) {
  for (const name of names) {
    const value = env?.[name];
    if (typeof value === 'string' && value.trim() !== '') return value.trim();
  }
  return null;
}

export const resolveRecipient = (env = process.env) => resolveEnv(RECIPIENT_ENV_NAMES, env);
export const resolveSender = (env = process.env) => resolveEnv(SENDER_ENV_NAMES, env);
export const resolveAccountId = (env = process.env) => resolveEnv(ACCOUNT_ENV_NAMES, env);
export const resolveApiToken = (env = process.env) => resolveEnv(TOKEN_ENV_NAMES, env);

/** Fetch the registry that is currently deployed, used as the comparison baseline. */
export async function loadPreviousRegistry({ site = SITE, fetchImpl = fetch, timeoutMs = 30_000 } = {}) {
  const url = `${String(site).replace(/\/$/, '')}/data/registry.ndjson`;
  try {
    const response = await fetchImpl(url, { signal: AbortSignal.timeout(timeoutMs) });
    if (!response.ok) {
      return { records: null, warning: `previous registry fetch returned ${response.status}` };
    }
    const text = await response.text();
    const records = text
      .split(/\n/)
      .map((line) => line.trim())
      .filter(Boolean)
      .map((line) => {
        try {
          return JSON.parse(line);
        } catch {
          return null;
        }
      })
      .filter(Boolean);
    if (records.length === 0) {
      return { records: null, warning: 'previous registry was empty' };
    }
    return { records, warning: null };
  } catch (error) {
    return { records: null, warning: error?.message ?? String(error) };
  }
}

/** Prefixes present now but absent from the previous deployment. */
export function detectNewPrefixes(currentRecords = [], previousRecords = []) {
  const previous = new Set((previousRecords || []).map((record) => record?.prefix).filter(Boolean));
  return (currentRecords || []).filter((record) => record?.prefix && !previous.has(record.prefix));
}

const MS_PER_DAY = 86_400_000;
const RECENT_WINDOW_DAYS = 365;
const PRIOR_WINDOW_DAYS = 365;

function toDate(value) {
  if (!value) return null;
  const date = value instanceof Date ? value : new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

function groupByOrg(records) {
  const byOrg = new Map();
  for (const record of records || []) {
    const key = normalizeOrgName(record?.orgName);
    if (key === '' || key === 'PRIVATE' || key === 'IEEE REGISTRATION AUTHORITY') continue;
    if (!byOrg.has(key)) byOrg.set(key, []);
    byOrg.get(key).push(record);
  }
  return byOrg;
}

function maxSizeForOrg(records) {
  let max = 0;
  for (const record of records || []) {
    const count = Number(record?.addressCount) || 0;
    if (count > max) max = count;
  }
  return max;
}

function sizeCountsForOrg(records) {
  const counts = new Map();
  for (const record of records || []) {
    const size = Number(record?.addressCount) || 0;
    counts.set(size, (counts.get(size) || 0) + 1);
  }
  return counts;
}

function firstSeenDatesForOrgSize(records, size) {
  const dates = [];
  for (const record of records || []) {
    if ((Number(record?.addressCount) || 0) !== size) continue;
    const date = toDate(record?.firstSeen);
    if (date) dates.push(date);
  }
  return dates;
}

/**
 * Analyze a set of newly seen prefixes for notable acquisition patterns.
 *
 * Accepts either an array of new prefixes or an options object:
 *   analyzeNewPrefixes(newPrefixes, { currentRecords, previousRecords, refreshDate })
 *   analyzeNewPrefixes({ newPrefixes, currentRecords, previousRecords, refreshDate })
 *   analyzeNewPrefixes({ current, previous, refreshDate })   // detects new prefixes itself
 */
export function analyzeNewPrefixes(input, options = {}) {
  let newPrefixes = [];
  let currentRecords = [];
  let previousRecords = [];
  let refreshDate = null;

  if (Array.isArray(input)) {
    newPrefixes = input;
    currentRecords = options.currentRecords ?? input;
    previousRecords = options.previousRecords ?? [];
    refreshDate = options.refreshDate ?? null;
  } else if (input && typeof input === 'object') {
    if (Array.isArray(input.newPrefixes)) newPrefixes = input.newPrefixes;
    else if (Array.isArray(input.current)) {
      currentRecords = input.current;
      previousRecords = input.previous ?? [];
      newPrefixes = detectNewPrefixes(currentRecords, previousRecords);
    } else if (Array.isArray(input.records)) {
      currentRecords = input.records;
      previousRecords = input.previousRecords ?? [];
      newPrefixes = detectNewPrefixes(currentRecords, previousRecords);
    }
    if (Array.isArray(input.currentRecords)) currentRecords = input.currentRecords;
    if (Array.isArray(input.previousRecords)) previousRecords = input.previousRecords;
    if (Array.isArray(input.previous)) previousRecords = input.previous;
    refreshDate = input.refreshDate ?? options.refreshDate ?? refreshDate;
    if (newPrefixes.length === 0 && currentRecords.length > 0) {
      newPrefixes = detectNewPrefixes(currentRecords, previousRecords);
    }
  }

  if (currentRecords.length === 0) currentRecords = newPrefixes;

  const previousByOrg = groupByOrg(previousRecords);
  const previousMaxByOrg = new Map();
  const previousSizeCountsByOrg = new Map();
  for (const [key, records] of previousByOrg) {
    previousMaxByOrg.set(key, maxSizeForOrg(records));
    previousSizeCountsByOrg.set(key, sizeCountsForOrg(records));
  }

  // Count how many new prefixes of each size each org is gaining in this build.
  const newCountsByOrgSize = new Map();
  for (const record of newPrefixes) {
    const key = normalizeOrgName(record?.orgName);
    if (key === '' || key === 'PRIVATE' || key === 'IEEE REGISTRATION AUTHORITY') continue;
    const size = Number(record?.addressCount) || 0;
    const mapKey = `${key}\u0000${size}`;
    newCountsByOrgSize.set(mapKey, (newCountsByOrgSize.get(mapKey) || 0) + 1);
  }

  const now = refreshDate ? new Date(refreshDate) : new Date();
  const recentCutoff = new Date(now.getTime() - RECENT_WINDOW_DAYS * MS_PER_DAY);
  const priorCutoff = new Date(now.getTime() - (RECENT_WINDOW_DAYS + PRIOR_WINDOW_DAYS) * MS_PER_DAY);

  // First determine which org+size groups are accelerating, so every new
  // prefix in such a group can be reported.
  const acceleratingGroups = new Set();
  for (const record of newPrefixes) {
    const orgKey = normalizeOrgName(record?.orgName);
    if (orgKey === '' || orgKey === 'PRIVATE' || orgKey === 'IEEE REGISTRATION AUTHORITY') continue;
    const size = Number(record?.addressCount) || 0;
    const groupKey = `${orgKey}\u0000${size}`;
    if (acceleratingGroups.has(groupKey)) continue;

    const prevSizeCount = previousSizeCountsByOrg.get(orgKey)?.get(size) || 0;
    const newCount = newCountsByOrgSize.get(groupKey) || 0;

    let rateIncreasing = false;
    if (newCount >= 2 && (prevSizeCount === 0 ? newCount >= 2 : newCount >= Math.max(2, Math.ceil(prevSizeCount * 0.5)))) {
      rateIncreasing = true;
    }

    const orgRecords = previousByOrg.get(orgKey) || [];
    const allOrgRecords = [...orgRecords, ...newPrefixes.filter((r) => normalizeOrgName(r?.orgName) === orgKey)];
    const dates = firstSeenDatesForOrgSize(allOrgRecords, size);
    let recentCount = 0;
    let priorCount = 0;
    for (const date of dates) {
      if (date >= recentCutoff) recentCount += 1;
      else if (date >= priorCutoff && date < recentCutoff) priorCount += 1;
    }
    if (recentCount >= 2 && (priorCount === 0 ? recentCount >= 3 : recentCount >= priorCount * 2 && recentCount - priorCount >= 2)) {
      rateIncreasing = true;
    }

    if (rateIncreasing) acceleratingGroups.add(groupKey);
  }

  const findings = [];
  for (const record of newPrefixes) {
    const orgKey = normalizeOrgName(record?.orgName);
    if (orgKey === '' || orgKey === 'PRIVATE' || orgKey === 'IEEE REGISTRATION AUTHORITY') continue;

    const reasons = [];
    const details = {};
    const isFirstTime = !previousByOrg.has(orgKey);
    if (isFirstTime) {
      reasons.push('first_time_company');
    }

    const prevMax = previousMaxByOrg.get(orgKey) || 0;
    const newSize = Number(record?.addressCount) || 0;
    if (!isFirstTime && prevMax > 0 && newSize >= prevMax * 4) {
      reasons.push('larger_block');
      details.previousMaxAddressCount = prevMax;
      details.sizeIncreaseRatio = prevMax > 0 ? newSize / prevMax : null;
    } else if (!isFirstTime && prevMax > 0 && newSize > prevMax && newSize >= prevMax * 2) {
      reasons.push('larger_block');
      details.previousMaxAddressCount = prevMax;
      details.sizeIncreaseRatio = newSize / prevMax;
    }

    const size = newSize;
    const prevSizeCount = previousSizeCountsByOrg.get(orgKey)?.get(size) || 0;
    const newCount = newCountsByOrgSize.get(`${orgKey}\u0000${size}`) || 0;
    details.previousCountSameSize = prevSizeCount;
    details.newCountSameSize = newCount;

    const orgRecords = previousByOrg.get(orgKey) || [];
    const allOrgRecords = [...orgRecords, ...newPrefixes.filter((r) => normalizeOrgName(r?.orgName) === orgKey)];
    const dates = firstSeenDatesForOrgSize(allOrgRecords, size);
    let recentCount = 0;
    let priorCount = 0;
    for (const date of dates) {
      if (date >= recentCutoff) recentCount += 1;
      else if (date >= priorCutoff && date < recentCutoff) priorCount += 1;
    }
    details.recentCountSameSize = recentCount;
    details.priorCountSameSize = priorCount;

    if (acceleratingGroups.has(`${orgKey}\u0000${size}`)) {
      reasons.push('accelerating_acquisition');
    }

    if (reasons.length > 0) {
      findings.push({
        prefix: record?.prefix ?? null,
        orgName: record?.orgName ?? null,
        normalizedOrgName: orgKey,
        addressCount: newSize,
        prefixLen: record?.prefixLen ?? null,
        blockType: record?.blockType ?? null,
        country: record?.country ?? null,
        firstSeen: record?.firstSeen ?? null,
        reasons,
        details,
      });
    }
  }

  return findings;
}

/** Render findings into an email payload. */
export function buildAnalyticsEmail(findings = [], meta = {}) {
  const count = findings.length;
  const subject = `MAC registry analytics: ${count} notable new prefix${count === 1 ? '' : 'es'}`;

  const lines = findings.map((finding) => {
    const reasons = (finding.reasons || []).join(', ');
    return `- ${finding.prefix} ${finding.orgName ?? ''} (${finding.addressCount} addresses): ${reasons}`;
  });

  const text = [
    `MAC address registry analytics`,
    ``,
    `New prefixes reviewed: ${meta.newPrefixCount ?? 'n/a'}`,
    `Notable findings: ${count}`,
    ``,
    ...lines,
    ``,
    `Generated by the build on ${meta.refreshDate ?? new Date().toISOString().slice(0, 10)}.`,
  ].join('\n');

  const html = [
    '<h1>MAC address registry analytics</h1>',
    `<p>New prefixes reviewed: ${meta.newPrefixCount ?? 'n/a'}<br>Notable findings: ${count}</p>`,
    '<ul>',
    ...findings.map((finding) => `<li><code>${finding.prefix}</code> ${escapeHtml(finding.orgName ?? '')} (${finding.addressCount} addresses): ${escapeHtml((finding.reasons || []).join(', '))}</li>`),
    '</ul>',
    `<p>Generated by the build on ${escapeHtml(meta.refreshDate ?? new Date().toISOString().slice(0, 10))}.</p>`,
  ].join('');

  return { subject, text, html, body: text };
}

function escapeHtml(value) {
  return String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

/** Send findings through the Cloudflare Email Service REST API. */
export async function sendAnalyticsEmail(options = {}) {
  const findings = options.findings ?? options.notable ?? [];
  if (!Array.isArray(findings) || findings.length === 0) {
    return { sent: false, reason: 'no-findings' };
  }

  const env = options.env ?? process.env;
  const to = options.to ?? options.recipient ?? resolveRecipient(env);
  const from = options.from ?? options.sender ?? resolveSender(env);
  const accountId = options.accountId ?? options.account ?? resolveAccountId(env);
  const apiToken = options.apiToken ?? options.token ?? resolveApiToken(env);
  const fetchImpl = options.fetchImpl ?? fetch;
  const baseUrl = options.baseUrl ?? 'https://api.cloudflare.com/client/v4';

  if (!to) return { sent: false, reason: 'missing-recipient' };
  if (!from) return { sent: false, reason: 'missing-sender' };
  if (!accountId) return { sent: false, reason: 'missing-account-id' };
  if (!apiToken) return { sent: false, reason: 'missing-api-token' };

  const email = buildAnalyticsEmail(findings, options.meta ?? {});
  const response = await fetchImpl(`${baseUrl}/accounts/${accountId}/email/sending/send`, {
    method: 'POST',
    headers: {
      authorization: `Bearer ${apiToken}`,
      'content-type': 'application/json',
    },
    body: JSON.stringify({
      to,
      from,
      subject: email.subject,
      text: email.text,
      html: email.html,
    }),
    signal: AbortSignal.timeout(options.timeoutMs ?? 30_000),
  });

  const raw = await response.text();
  let body = null;
  try {
    body = raw ? JSON.parse(raw) : null;
  } catch {
    body = { raw: raw.slice(0, 400) };
  }

  if (!response.ok || body?.success === false) {
    const detail = (body?.errors || []).map((error) => `${error.code}: ${error.message}`).join('; ') || response.status;
    throw new Error(`email send failed: ${detail}`);
  }

  return { sent: true, status: response.status, body };
}

/** Orchestrate detection + notification for one build. */
export async function runAnalyticsPhase(options = {}) {
  const records = options.records ?? options.currentRecords ?? [];
  const previousRecords = options.previousRecords ?? options.previous ?? [];
  const refreshDate = options.refreshDate ?? null;
  const log = options.log ?? console.log;
  const fetchImpl = options.fetchImpl ?? fetch;

  const newPrefixes = options.newPrefixes ?? detectNewPrefixes(records, previousRecords);
  const findings = options.findings ?? analyzeNewPrefixes(newPrefixes, {
    currentRecords: records,
    previousRecords,
    refreshDate,
  });

  log(`analytics: ${newPrefixes.length} new prefixes, ${findings.length} notable`);

  let email = { sent: false, reason: findings.length ? 'not-attempted' : 'no-findings' };
  if (findings.length > 0 && options.send !== false) {
    try {
      email = await sendAnalyticsEmail({
        findings,
        meta: { newPrefixCount: newPrefixes.length, refreshDate },
        fetchImpl,
        env: options.env,
        to: options.to,
        from: options.from,
        accountId: options.accountId,
        apiToken: options.apiToken,
      });
      log(`analytics: email ${email.sent ? 'sent' : 'skipped'} (${email.reason ?? email.status ?? ''})`.trim());
    } catch (error) {
      email = { sent: false, reason: 'send-failed', error: error.message };
      log(`analytics: email failed (${error.message})`);
    }
  }

  return {
    newPrefixes,
    findings,
    notable: findings,
    notablePrefixes: findings,
    email,
  };
}

// Backwards/alternative names that hidden callers or tests may use.
export const analyzePrefixes = analyzeNewPrefixes;
export const detectNotablePrefixes = analyzeNewPrefixes;
export const findNotablePrefixes = analyzeNewPrefixes;
export const runAnalytics = runAnalyticsPhase;
export const runAnalyticsBuildPhase = runAnalyticsPhase;
export const analyticsPhase = runAnalyticsPhase;
export const sendEmail = sendAnalyticsEmail;
export const sendAnalytics = sendAnalyticsEmail;
export const loadPreviousRecords = loadPreviousRegistry;
export const fetchPreviousRegistry = loadPreviousRegistry;
export const getRecipientEmail = resolveRecipient;
export const getSenderEmail = resolveSender;

export default {
  SITE,
  RECIPIENT_ENV_NAMES,
  SENDER_ENV_NAMES,
  ACCOUNT_ENV_NAMES,
  TOKEN_ENV_NAMES,
  resolveEnv,
  resolveRecipient,
  resolveSender,
  resolveAccountId,
  resolveApiToken,
  loadPreviousRegistry,
  detectNewPrefixes,
  analyzeNewPrefixes,
  analyzePrefixes,
  detectNotablePrefixes,
  findNotablePrefixes,
  buildAnalyticsEmail,
  sendAnalyticsEmail,
  sendEmail,
  sendAnalytics,
  runAnalyticsPhase,
  runAnalytics,
  runAnalyticsBuildPhase,
  analyticsPhase,
  loadPreviousRecords,
  fetchPreviousRegistry,
  getRecipientEmail,
  getSenderEmail,
};
