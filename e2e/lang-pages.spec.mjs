import { test, expect } from '@playwright/test';

test.describe('Localized home pages (/lang/{locale}/)', () => {
  test('Spanish variant: lang attr, authored title, canonical, hreflang cluster', async ({ page }) => {
    await page.goto('/lang/es/');
    await expect(page.locator('html')).toHaveAttribute('lang', 'es');
    await expect(page).toHaveTitle(/Buscador de direcciones MAC y OUI/);
    expect(await page.locator('link[rel="canonical"]').getAttribute('href')).toBe(
      'https://mac.jasontally.com/lang/es/',
    );
    // English + 30 locales + x-default = 32 declared variants.
    expect(await page.locator('link[rel="alternate"][hreflang]').count()).toBe(32);
    expect(await page.locator('link[rel="alternate"][hreflang="en"]').getAttribute('href')).toBe(
      'https://mac.jasontally.com/',
    );
  });

  test('localized copy is present without JavaScript (bot-rendered)', async ({ browser, baseURL }) => {
    const context = await browser.newContext({ javaScriptEnabled: false, baseURL });
    try {
      const page = await context.newPage();
      await page.goto('/lang/es/');
      const html = await page.content();
      expect(html).toContain('Buscador gratuito y privado de direcciones MAC');
    } finally {
      await context.close();
    }
  });

  test('RTL locales render dir="rtl"', async ({ page }) => {
    await page.goto('/lang/ar/');
    await expect(page.locator('html')).toHaveAttribute('dir', 'rtl');
  });

  test('resolved locale: page default beats browser language, stored choice wins', async ({ browser, baseURL }) => {
    // Fresh visitor with an English browser: the page's declared locale applies.
    const fresh = await browser.newContext({ locale: 'en-US', baseURL });
    try {
      const page = await fresh.newPage();
      await page.goto('/lang/es/');
      await expect(page.locator('html')).toHaveAttribute('lang', 'es');
      await expect(page.locator('#lookup-form button[type=submit]')).toHaveText(/Buscar|Consultar/);
    } finally {
      await fresh.close();
    }
    // A returning visitor's stored manual choice outranks the page URL.
    const returning = await browser.newContext({ locale: 'en-US', baseURL });
    try {
      const page = await returning.newPage();
      await page.addInitScript(() => localStorage.setItem('mal.locale', 'en'));
      await page.goto('/lang/es/');
      await expect(page.locator('html')).toHaveAttribute('lang', 'en');
    } finally {
      await returning.close();
    }
  });

  test('canonical English home declares the same cluster', async ({ page }) => {
    await page.goto('/');
    expect(await page.locator('link[rel="canonical"]').getAttribute('href')).toBe(
      'https://mac.jasontally.com/',
    );
    expect(await page.locator('link[rel="alternate"][hreflang="es"]').getAttribute('href')).toBe(
      'https://mac.jasontally.com/lang/es/',
    );
    expect(await page.locator('link[rel="alternate"][hreflang="x-default"]').getAttribute('href')).toBe(
      'https://mac.jasontally.com/',
    );
  });

  test('the language picker navigates between /lang/ twins', async ({ page }) => {
    await page.goto('/lang/es/');
    await page.selectOption('#locale-picker', 'ja');
    await page.waitForURL('**/lang/ja/');
    await expect(page.locator('html')).toHaveAttribute('lang', 'ja');
  });

  test('sitemap.xml lists the lang set with xhtml alternates', async ({ request }) => {
    const sitemap = await request.get('/sitemap.xml');
    expect(sitemap.status()).toBe(200);
    const text = await sitemap.text();
    expect(text).toContain('xmlns:xhtml');
    expect(text).toContain('https://mac.jasontally.com/lang/ja/');
    expect(text).toContain('<xhtml:link rel="alternate" hreflang="es"');
  });
});
