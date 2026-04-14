// @ts-check
const { test, expect } = require('@playwright/test');

test.describe('Back button', () => {
  test('default mode: visible with standard styles on a non-compact page', async ({ page }) => {
    await page.goto('/calculator/');
    const btn = page.locator('.back-to-portfolio');
    await expect(btn).toBeVisible({ timeout: 10_000 });
    await expect(btn).toHaveText(/Back/);
    await expect(btn).toHaveAttribute('href', '/');
    const html = page.locator('html');
    await expect(html).not.toHaveAttribute('data-back-size');
  });

  test('compact mode: terminal page has data-back-size="compact" on <html>', async ({ page }) => {
    await page.goto('/terminal/');
    const html = page.locator('html');
    await expect(html).toHaveAttribute('data-back-size', 'compact', { timeout: 10_000 });
    const btn = page.locator('.back-to-portfolio');
    await expect(btn).toBeVisible();
  });

  test('compact mode: back button has reduced opacity', async ({ page }) => {
    await page.goto('/terminal/');
    await page.waitForSelector('.back-to-portfolio', { timeout: 10_000 });
    const opacity = await page.locator('.back-to-portfolio').evaluate(
      (el) => getComputedStyle(el).opacity
    );
    const val = parseFloat(opacity);
    expect(val).toBeLessThan(1);
    expect(val).toBeGreaterThan(0);
  });

  test('page name label derived from URL path', async ({ page }) => {
    await page.goto('/terminal/');
    await page.waitForSelector('.back-to-portfolio', { timeout: 10_000 });
    const label = await page.locator('.back-to-portfolio').getAttribute('data-event-label');
    expect(label).toBe('Terminal');
  });

  test('not shown on /os/ path', async ({ page }) => {
    await page.goto('/os/');
    await page.waitForTimeout(2000);
    const count = await page.locator('.back-to-portfolio').count();
    expect(count).toBe(0);
  });
});
