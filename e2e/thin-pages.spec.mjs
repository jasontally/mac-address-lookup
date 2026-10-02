import { test, expect } from '@playwright/test';

/** Row totals drift a few rows per registry refresh; the lede states them. */
const totalFromLede = async (page, pattern) => {
  const lede = await page.locator('.lede').textContent();
  return Number(pattern.exec(lede)[1].replace(/,/g, ''));
};

test.describe('Vendor and country hub pages', () => {
  test('/vendor/apple-inc serves the complete static table — no row caps', async ({ page }) => {
    await page.goto('/vendor/apple-inc');
    await expect(page.locator('h1')).toContainText('Apple, Inc. MAC address blocks');
    expect(await page.locator('link[rel="canonical"]').getAttribute('href')).toBe('https://mac.jasontally.com/vendor/apple-inc');
    // Complete data: >1,500 blocks ship visible in one document — no cap
    // note, no hidden rows, no controls.
    const total = await totalFromLede(page, /carries ([\d,]+) blocks/);
    expect(total).toBeGreaterThan(1500);
    await expect(page.locator('.data-table tbody tr')).toHaveCount(total, { timeout: 15_000 });
    await expect(page.locator('.data-table tbody tr[hidden]')).toHaveCount(0);
    await expect(page.locator('.data-table tfoot')).toHaveCount(0);
    await expect(page.locator('#hub-rows-note')).toHaveCount(0);
    expect(await page.locator('.hub-countries a[href="/country/us"]').count()).toBe(1);
    await expect(page.locator('#lookup-form')).toHaveCount(1);
  });

  test('very large tables ship every row visible with no reveal controls', async ({ page }) => {
    await page.goto('/country/us');
    // The lede states the org total; the same count renders the rows.
    const total = await totalFromLede(page, /across ([\d,]+) organizations/);
    expect(total).toBeGreaterThan(8000);
    await expect(page.locator('.data-table tbody tr')).toHaveCount(total, { timeout: 20_000 });
    // No cap machinery at any size: nothing hidden, no controls, no note.
    await expect(page.locator('.data-table tbody tr[hidden]')).toHaveCount(0);
    await expect(page.locator('.data-table tfoot')).toHaveCount(0);
    await expect(page.locator('#hub-rows-note')).toHaveCount(0);
    await expect(page.getByRole('button', { name: 'Show more' })).toHaveCount(0);
    // Addresses cells carry the desktop one-line class.
    await expect(page.locator('.data-table td.num').first()).toHaveCount(1);
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
    // Row counts drift a few orgs per data refresh; the lede states the total.
    const total = await totalFromLede(page, /across ([\d,]+) organizations/);
    expect(total).toBeGreaterThan(8000);
    await expect(page.locator('.data-table tbody tr')).toHaveCount(total, { timeout: 20_000 });
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

  test('/former/apple-computer explains the full takeover', async ({ page }) => {
    await page.goto('/former/apple-computer');
    await expect(page.locator('h1')).toContainText('Former Apple Computer MAC address blocks');
    await expect(page.locator('.lede')).toContainText('took over all of them');
    const ownerLinks = page.locator('.data-table tbody tr a[href="/vendor/apple-inc"]');
    await expect(ownerLinks.first()).toHaveText('Apple, Inc.');
    // The domestic search path stays intact.
    await expect(page.locator('a[href^="/form"]')).toHaveCount(0);
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

    // Show all sits beside it in the table's last line, labelled slow because
    // this query matches ~17,000 prefixes (a 9 s rebuild at 4x CPU). Dynamic
    // partials keep their cap; static hubs do not.
    const heading = await page.locator('.result-card h2').first().textContent();
    const total = Number(/\d[\d,]*/.exec(heading)[0].replace(/\D/g, ''));
    expect(total).toBeGreaterThan(1500);
    await expect(page.locator('.data-table tfoot td.hub-expand')).toHaveCount(1);
    await page.getByRole('button', { name: 'Show all' }).click();
    await expect(page.locator('.data-table tbody tr')).toHaveCount(total, { timeout: 25_000 });
    await expect(page.locator('.data-table tfoot')).toHaveCount(0);
    await expect(page.locator('.result-card .section-note')).not.toContainText('showing the first');
  });
});

test.describe('Vendor index', () => {
  test('/vendor ships every organization row and leads the sitemap', async ({ page, request }) => {
    await page.goto('/vendor');
    await expect(page.locator('h1')).toContainText('MAC address blocks by vendor');
    expect(await page.locator('link[rel="canonical"]').getAttribute('href')).toBe('https://mac.jasontally.com/vendor');
    // The lede states the organization total; the same count renders the rows.
    const total = await totalFromLede(page, /registered to ([\d,]+) organizations/);
    expect(total).toBeGreaterThan(3000);
    await expect(page.locator('.data-table tbody tr')).toHaveCount(total, { timeout: 20_000 });
    await expect(page.locator('.data-table tbody tr[hidden]')).toHaveCount(0);
    await expect(page.locator('.data-table tfoot')).toHaveCount(0);
    // The first row links a real vendor page.
    const firstHref = await page.locator('.data-table tbody tr td.org a').first().getAttribute('href');
    expect(firstHref.startsWith('/vendor/')).toBe(true);
    // The index is in the sitemap now; vendor hub detail pages stay out of it
    // until the `hubs` scope ships.
    const sitemap = await request.get('/sitemap.xml');
    expect(sitemap.status()).toBe(200);
    const xml = await sitemap.text();
    expect(xml).toContain('<loc>https://mac.jasontally.com/vendor</loc>');
    expect(xml).not.toContain('/vendor/apple-inc');
    // The home page carries a Vendors link (hub nav since 0455415).
    await page.goto('/');
    await expect(page.locator('a[href="/vendor"]').first()).toBeVisible();
  });
});
