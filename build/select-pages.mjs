/**
 * Page-budget selection for pre-rendered prefix pages.
 *
 * Priority follows docs/deployment-constraints.md: block type first
 * (MA-L → MA-M → CID → IAB → MA-S), then vendor demand, with private or
 * empty organizations deprioritized. Ties break on prefix for determinism.
 */

/** Relative demand weight per IEEE registry. */
const TYPE_WEIGHT = {
  'MA-L': 3,
  'MA-M': 2,
  CID: 1.5,
  IAB: 1,
  'MA-S': 0.8,
};

export function vendorBoost(orgName, vendorPriority = {}) {
  const name = String(orgName ?? '').toLowerCase();
  if (name === '') return 0;
  let boost = 0;
  for (const [keyword, weight] of Object.entries(vendorPriority)) {
    if (name.includes(keyword)) boost = Math.max(boost, weight);
  }
  return boost;
}

export function scoreRecord(record, vendorPriority = {}) {
  let score = TYPE_WEIGHT[record.blockType] ?? 0.5;
  if (record.isPrivate || !record.orgName) score -= 1;
  score += vendorBoost(record.orgName, vendorPriority);
  return score;
}

/**
 * Select which records get a pre-rendered page. Returns selected and dropped
 * records, both sorted by prefix, plus per-type counts for reporting.
 */
export function selectPages(records, { pageBudget = 90_000, vendorPriority = {} } = {}) {
  const scored = records.map((record) => ({
    record,
    score: scoreRecord(record, vendorPriority),
  }));

  scored.sort((a, b) => {
    if (b.score !== a.score) return b.score - a.score;
    return a.record.prefix < b.record.prefix ? -1 : 1;
  });

  const selected = scored.slice(0, pageBudget).map((entry) => entry.record);
  const dropped = scored.slice(pageBudget).map((entry) => entry.record);
  selected.sort((a, b) => (a.prefix < b.prefix ? -1 : a.prefix > b.prefix ? 1 : 0));
  dropped.sort((a, b) => (a.prefix < b.prefix ? -1 : a.prefix > b.prefix ? 1 : 0));

  const countByType = (list) =>
    list.reduce((counts, record) => {
      counts[record.blockType] = (counts[record.blockType] ?? 0) + 1;
      return counts;
    }, {});

  return {
    selected,
    dropped,
    selectedByType: countByType(selected),
    droppedByType: countByType(dropped),
  };
}
