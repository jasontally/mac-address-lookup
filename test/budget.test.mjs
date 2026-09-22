import { strict as assert } from 'node:assert';
import test from 'node:test';
import { checkBudget, countPages, DEFAULT_LIMITS } from '../build/budget.mjs';

const file = (path, bytes = 100) => ({ path, bytes });

test('countPages counts prefix and hub pages by class, excluding shells', () => {
  const counts = countPages([
    file('001A2B.html'),
    file('index.html'),
    file('404.html'),
    file('vendor/apple-inc.html'),
    file('country.html'),
    file('country/us.html'),
    file('former/tekelec.html'),
    file('nested/000001.html'),
    file('data/manifest.json'),
  ]);
  assert.deepEqual(counts, {
    prefixes: 1,
    vendor: 1,
    country: 2,
    former: 1,
    total: 5,
  });
});

test('checkBudget passes small outputs', () => {
  const result = checkBudget({ files: [file('index.html'), file('vendor/apple-inc.html'), file('001A2B.html'), file('data/registry.parquet')] });
  assert.deepEqual(result.errors, []);
  assert.deepEqual(result.stats.pagesByType, { prefixes: 1, vendor: 1, country: 0, former: 0 });
  assert.equal(result.stats.pages, 2);
  assert.equal(result.stats.files, 4);
});

test('checkBudget fails when over the file-count budget', () => {
  const files = Array.from({ length: 11 }, (_, i) => file(`${i.toString(16).padStart(6, '0')}.html`));
  const result = checkBudget({ files, limits: { pageBudget: 8, nonPageAllowance: 2 } });
  assert.equal(result.errors.length, 1);
  assert.match(result.errors[0], /exceeds budget 10/);
});

test('checkBudget fails oversized files', () => {
  const result = checkBudget({
    files: [file('data/huge.parquet', DEFAULT_LIMITS.maxFileBytes + 1)],
  });
  assert.equal(result.errors.length, 1);
  assert.match(result.errors[0], /over the .* byte limit/);
});

test('checkBudget warns above 90% of the file budget', () => {
  const files = Array.from({ length: 10 }, (_, i) => file(`file-${i}`));
  const result = checkBudget({ files, limits: { pageBudget: 8, nonPageAllowance: 2 } });
  assert.equal(result.errors.length, 0);
  assert.equal(result.warnings.length, 1);
});
