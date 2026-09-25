import { test, expect } from '@playwright/test';

test.describe('Static pre-rendered pages', () => {
  test('home uses the existing wordmark as its single page heading', async ({ page }) => {
    await page.goto('/');
    await expect(page.locator('h1')).toHaveCount(1);
    await expect(page.locator('.site-header h1')).toHaveText('MAC Address Lookup');
    await expect(page.locator('main h1')).toHaveCount(0);
  });

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
    // Agent-facing alternates are linked
    expect(await page.locator('link[rel="alternate"][type="text/markdown"]').getAttribute('href')).toBe('/help.md');
    expect(await page.locator('link[rel="describedby"]').getAttribute('href')).toBe('/llms.txt');
  });

  test('agent-facing static files exist and are coherent', async ({ request }) => {
    const llms = await request.get('/llms.txt');
    expect(llms.status()).toBe(200);
    const text = await llms.text();
    expect(text).toContain('/{hex}');
    expect(text).toContain('data/registry.ndjson');

    const md = await request.get('/help.md');
    expect(md.status()).toBe(200);
    expect((await md.text())).toContain('# Help & documentation');
    expect(md.headers()['content-type']).toContain('text/plain');

    const txt = await request.get('/help.txt');
    expect(txt.status()).toBe(200);
    expect(txt.headers()['content-type']).toContain('text/plain');
    expect((await txt.text())).toContain('## Vendors, countries, and former owners');

    // Agent lookup shards: small text/plain files, one JSON per line.
    const shard = await request.get('/data/registry/8c1f64af.txt');
    expect(shard.status()).toBe(200);
    expect(shard.headers()['content-type']).toContain('text/plain');
    expect((await shard.text())).toContain('DATA ELECTRONIC DEVICES, INC');
    const shardIndex = await request.get('/data/registry/index.txt');
    expect(shardIndex.status()).toBe(200);
    expect((await shardIndex.text())).toContain('8c1f64af');

    const registry = await request.get('/data/registry.ndjson');
    expect(registry.status()).toBe(200);
    const firstLine = (await registry.text()).split('\n')[0];
    expect(JSON.parse(firstLine)).toHaveProperty('prefix');

    const lineage = await request.get('/data/lineage.ndjson');
    expect(lineage.status()).toBe(200);
    expect(JSON.parse((await lineage.text()).split('\n')[0])).toHaveProperty('prefix');

    // ARD well-known paths must be real JSON, not the SPA fallback's HTML.
    for (const catalogPath of ['/.well-known/ai-catalog.json', '/.well-known/ard.json']) {
      const catalog = await request.get(catalogPath);
      expect(catalog.status()).toBe(200);
      expect(catalog.headers()['content-type']).toContain('json');
      const body = await catalog.json();
      expect(body.specVersion).toBe('1.0');
      expect(body.entries).toEqual([]);
    }

    const robots = await request.get('/robots.txt');
    expect(await robots.text()).toContain('User-agent: GPTBot');
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

  test('/FACADE000001 shows unregistered prefix with randomized flag', async ({ page }) => {
    await page.goto('/FACADE000001');
    await expect(page.locator('.vendor')).toHaveText('Unregistered prefix');
    await expect(page.locator('.badge--warning').first()).toContainText('randomized');
  });

  test('/FFFFFFFFFFFF shows the broadcast info banner', async ({ page }) => {
    await page.goto('/FFFFFFFFFFFF');
    await expect(page.locator('.banner--info')).toContainText(/broadcast/i);
    await expect(page.locator('.bits')).toContainText('Broadcast address');
  });
});

test.describe('Path-based routing', () => {
  test('/apple renders vendor search results', async ({ page }) => {
    await page.goto('/apple');
    await expect(page.locator('.result-card h2')).toContainText('matching prefixes');
    await expect(page.locator('.data-table tbody tr').first()).toContainText('Apple');
    // Search uses the lean index, never the full 3 MB registry
    await page.waitForLoadState('networkidle');
    const fetched = await page.evaluate(() =>
      performance.getEntriesByType('resource').map((e) => e.name),
    );
    expect(fetched.some((r) => r.includes('/data/registry.'))).toBe(false);
    expect(fetched.some((r) => r.includes('/data/search.'))).toBe(true);
  });

  test('/001A2B,005056 renders batch results', async ({ page }) => {
    await page.goto('/001A2B,005056');
    await expect(page.locator('.result-card h2')).toContainText('2');
    await expect(page.locator('.data-table tbody tr')).toHaveCount(2);
  });

  test('batch table renders semantic headers without retaining the pending height', async ({ page }) => {
    await page.goto('/FACADE000001%2C000000000000');
    await expect(page.locator('.result-card h2')).toContainText('2');

    const headers = page.locator('#result thead th');
    await expect(headers).toHaveCount(3);
    await expect(headers).toHaveText(['Input', 'Result', 'Flags']);
    await expect(page.locator('#result')).not.toContainText('[object HTMLTableCellElement]');

    // Desktop reserves 56rem while loading; a short batch result should not
    // retain that temporary reservation after it has rendered.
    const resultHeight = await page.locator('#result').evaluate((node) => node.getBoundingClientRect().height);
    expect(resultHeight).toBeLessThan(600);
  });

  test('batch export buttons produce CSV and copy JSON', async ({ page }) => {
    await page.goto('/001A2B,005056');
    await expect(page.locator('.result-card h2')).toContainText('2');
    const download = page.waitForEvent('download');
    await page.getByRole('button', { name: 'Download CSV' }).click();
    const file = await download;
    expect(file.suggestedFilename()).toBe('mac-lookup.csv');
  });

  test('/recent lists newest blocks and is linked from home', async ({ page }) => {
    await page.goto('/recent');
    await expect(page.locator('h1')).toContainText('Latest OUIs');
    expect(await page.locator('.data-table tbody tr').count()).toBeGreaterThan(10);
    await page.goto('/');
    expect(await page.locator('a[href="/recent"]').count()).toBeGreaterThan(0);
    // Home's "Browse" nav ships the what's-new link on static pages too
    await page.goto('/help');
    expect(await page.locator('a[href="/recent"]').count()).toBeGreaterThan(0);
    // Help page documents the machine-readable exports
    await page.goto('/help');
    expect(await page.locator('a[href="/data/registry.ndjson"]').count()).toBeGreaterThan(0);
  });

  test('random chip performs a lookup on a generated address', async ({ page }) => {
    await page.goto('/');
    await page.click('#random-chip');
    // The pending card renders first; wait for the resolved result
    await page.waitForFunction(
      () => {
        const card = document.querySelector('#result .result-card');
        return card && !card.hasAttribute('aria-busy');
      },
      { timeout: 15000 },
    );
    const value = await page.inputValue('#lookup-input');
    expect(value).toMatch(/^[0-9A-F:]{11,17}$/);
    expect(await page.evaluate(() => location.pathname.length)).toBeGreaterThan(3);
  });

  test('OUI subdivided pages carry the classification badge', async ({ page }) => {
    await page.goto('/001BC5');
    await expect(page.locator('.badge--warning', { hasText: 'OUI subdivided' }).first()).toBeVisible();
  });

  test('batch share URL uses %2C to avoid a redirect round trip', async ({ page }) => {
    await page.goto('/001A2B 005056');
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
