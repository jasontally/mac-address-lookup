import { test, expect } from '@playwright/test';

test.describe('Static pre-rendered pages', () => {
  test('/001B21 shows vendor without fetching Parquet', async ({ page }) => {
    await page.goto('/001B21');
    await expect(page.locator('.vendor')).toHaveText('Intel Corporate');
    const parquetFetched = await page.evaluate(() =>
      performance.getEntriesByType('resource').some((e) => e.name.includes('/data/registry.')),
    );
    expect(parquetFetched).toBe(false);
  });

  test('/000017 renders lineage timeline', async ({ page }) => {
    await page.goto('/000017');
    await expect(page.locator('.timeline li')).toHaveCount(2);
    await expect(page.locator('.timeline li').first()).toContainText('TEKELEC');
    await expect(page.locator('.timeline li').last()).toContainText('Oracle');
  });

  test('/help renders documentation without lookup form', async ({ page }) => {
    await page.goto('/help');
    await expect(page.locator('h1')).toContainText('Help');
    await expect(page.locator('.faq-list details')).toHaveCount(10);
    expect(await page.locator('#lookup-form').count()).toBe(0);
  });
});

test.describe('Dynamic lookups (SPA fallback)', () => {
  test('/001B21AABBCC resolves Intel via sharded data', async ({ page }) => {
    await page.goto('/001B21AABBCC');
    await expect(page.locator('.vendor')).toHaveText('Intel Corporate');
    await expect(page.locator('.mac').first()).toContainText('00:1B:21:AA:BB:CC');
  });

  test('/000017123456 fetches lineage for changed prefix', async ({ page }) => {
    await page.goto('/000017123456');
    await expect(page.locator('.vendor')).toHaveText('Oracle');
    await expect(page.locator('.timeline li').first()).toContainText('TEKELEC');
  });

  test('/001B21AABBCC does not fetch lineage for unchanged prefix', async ({ page }) => {
    await page.goto('/001B21AABBCC');
    await expect(page.locator('.vendor')).toHaveText('Intel Corporate');
    await page.waitForLoadState('networkidle');
    const lineageFetched = await page.evaluate(() =>
      performance.getEntriesByType('resource').some((e) => e.name.includes('/data/lineage.')),
    );
    expect(lineageFetched).toBe(false);
  });

  test('/DEADBEEF0001 shows unregistered prefix with randomized flag', async ({ page }) => {
    await page.goto('/DEADBEEF0001');
    await expect(page.locator('.vendor')).toHaveText('Unregistered prefix');
    await expect(page.locator('.badge--warning').first()).toContainText('randomized');
  });
});

test.describe('Path-based routing', () => {
  test('/apple renders vendor search results', async ({ page }) => {
    await page.goto('/apple');
    await expect(page.locator('.result-card h2')).toContainText('matching prefixes');
    await expect(page.locator('.data-table tbody tr').first()).toContainText('Apple');
  });

  test('/001A2B,005056 renders batch results', async ({ page }) => {
    await page.goto('/001A2B,005056');
    await expect(page.locator('.result-card h2')).toContainText('2');
    await expect(page.locator('.data-table tbody tr')).toHaveCount(2);
  });

  test('batch share URL uses %2C to avoid a redirect round trip', async ({ page }) => {
    await page.goto('/');
    await page.click('#batch summary');
    await page.fill('#batch-input', '00:1A:2B 00:50:56');
    await page.click('#batch-form button[type=submit]');
    await expect(page.locator('.result-card h2')).toContainText('2');
    expect(await page.evaluate(() => location.pathname)).toBe('/001A2B%2C005056');
  });

  test('/?q= canonicalizes to path form', async ({ page }) => {
    await page.goto('/?q=001B21');
    await expect(page.locator('.vendor')).toHaveText('Intel Corporate');
    await expect(page).toHaveURL(/\/001B21$/);
  });
});

test.describe('Locale switching', () => {
  test('picker offers English exactly once and switching to German works', async ({ page }) => {
    await page.goto('/');
    const picker = page.locator('#locale-picker');
    await picker.waitFor();
    const options = await picker.locator('option').allTextContents();
    expect(options.filter((o) => o === 'English')).toHaveLength(1);
    // Switch to German via the picker; the reload must persist the choice
    await picker.selectOption('de');
    await expect(picker).toHaveValue('de', { timeout: 10_000 });
    await page.goto('/001B21AABBCC');
    await expect(page.locator('.format-label').first()).toHaveText('Hexadezimal');
    // Reset to English
    const pickerAfter = page.locator('#locale-picker');
    await pickerAfter.waitFor();
    await pickerAfter.selectOption('en');
  });

  test('German locale persists across navigation', async ({ page }) => {
    await page.goto('/');
    const picker = page.locator('#locale-picker');
    await picker.waitFor();
    await picker.selectOption('de');
    await expect(picker).toHaveValue('de', { timeout: 10_000 });
    await page.goto('/001B21');
    await expect(page.locator('.vendor')).toHaveText('Intel Corporate');
    // Clear the locale back to English for other tests
    await page.evaluate(() => localStorage.setItem('mal.locale', 'en'));
  });
});

test.describe('Error handling', () => {
  test('/00:1G shows invalid input banner', async ({ page }) => {
    await page.goto('/');
    await page.fill('#lookup-input', '00:1G');
    await page.click('.lookup-form button[type="submit"]');
    await expect(page.locator('.banner--danger')).toBeVisible();
  });
});

test.describe('Console health', () => {
  test('no uncaught errors on pre-rendered page', async ({ page }) => {
    const errors = [];
    page.on('pageerror', (error) => errors.push(error.message));
    await page.goto('/001B21');
    await expect(page.locator('.vendor')).toBeVisible();
    expect(errors).toHaveLength(0);
  });

  test('no uncaught errors on dynamic lookup', async ({ page }) => {
    const errors = [];
    page.on('pageerror', (error) => errors.push(error.message));
    await page.goto('/001B21AABBCC');
    await expect(page.locator('.vendor')).toHaveText('Intel Corporate');
    await page.waitForLoadState('networkidle');
    expect(errors).toHaveLength(0);
  });
});
