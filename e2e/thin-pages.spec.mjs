import { test, expect } from '@playwright/test';

test.describe('Vendor and country hub pages', () => {
  test('/vendor/apple-inc serves the complete static table — no row caps', async ({ page }) => {
    await page.goto('/vendor/apple-inc');
    await expect(page.locator('h1')).toContainText('Apple, Inc. MAC address blocks');
    expect(await page.locator('link[rel="canonical"]').getAttribute('href')).toBe('https://mac.jasontally.com/vendor/apple-inc');
    // Complete data: >1,500 blocks ship in one document (1,553 registered today).
    await expect(page.locator('.data-table tbody tr')).toHaveCount(1553, { timeout: 15_000 });
    expect(await page.locator('.hub-countries a[href="/country/us"]').count()).toBe(1);
    await expect(page.locator('#lookup-form')).toHaveCount(1);
  });

  test('/vendor/qualcomm-inc renders a mid-size hub with static chrome', async ({ page }) => {
    await page.goto('/vendor/qualcomm-inc');
    await expect(page.locator('h1')).toContainText('MAC address blocks');
    expect(await page.locator('body[data-static-page="true"]').count()).toBe(1);
    await expect(page.locator('.data-table tbody a[href="/00A0C6"]').first()).toContainText('00:A0:C6');
  });

  test('/country/us renders every org, sorted by address space', async ({ page }) => {
    await page.goto('/country/us');
    await expect(page.locator('h1')).toContainText('United States MAC address blocks');
    await expect(page.locator('.data-table tbody tr')).toHaveCount(8881, { timeout: 20_000 });
    // Hub-linked orgs appear in the table (biggest portfolios first).
    await expect(
      page.locator('.data-table tbody tr').first().locator('a[href^="/vendor/"]'),
    ).toHaveCount(1);
  });

  test('missing hubs fall through to the SPA soft 404 (noindex)', async ({ page }) => {
    await page.goto('/vendor/acme');
    await page.waitForLoadState('networkidle');
    expect(await page.locator('meta[name="robots"][content*="noindex"]').count()).toBeGreaterThan(0);
  });
});

test.describe('Prefix-page enrichment and related links', () => {
  test('/001B21 carries related sections, portfolio line, and context note', async ({ page }) => {
    await page.goto('/001B21');
    await expect(page.locator('[data-related="sameOrg"]')).toHaveCount(1);
    await expect(page.locator('[data-related="sameOrg"] a[href="/vendor/intel-corporate"]')).toHaveCount(1);
    const enrich = await page.locator('[data-enrich]').first().textContent();
    expect(enrich).toContain("One of Intel Corporate's 667 registered blocks");
    // Country detail links to the country hub.
    expect(await page.locator('a[href="/country/my"]').count()).toBeGreaterThan(0);
  });

  test('related links clear when a new lookup runs', async ({ page }) => {
    await page.goto('/001B21');
    await page.fill('#lookup-input', 'FACADE000001');
    await page.click('#lookup-form button[type=submit]');
    await expect(page.locator('.vendor')).toHaveText('Unregistered prefix');
    expect(await page.locator('[data-related]').count()).toBe(0);
  });
});

test.describe('Dynamic hub affordances', () => {
  test('/apple search links the complete static hub', async ({ page }) => {
    await page.goto('/apple');
    await expect(page.locator('.result-card h2')).toContainText('matching prefixes');
    const hubLink = page.locator('.summary-line a[href="/vendor/apple-inc"]');
    await expect(hubLink).toHaveCount(1);
    expect(await hubLink.textContent()).toContain('View all prefixes');
  });

  test('/00 partial offers show-more and doubles the rows', async ({ page }) => {
    await page.goto('/00');
    await expect(page.locator('.result-card h2')).toContainText('matching prefixes');
    await page.waitForLoadState('networkidle');
    const before = await page.locator('.data-table tbody tr').count();
    expect(before).toBe(500);
    await page.getByRole('button', { name: 'Show more' }).click();
    await expect(page.locator('.data-table tbody tr')).toHaveCount(1000, { timeout: 10_000 });
  });
});
