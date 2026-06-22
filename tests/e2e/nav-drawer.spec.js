// @ts-check
const { test, expect } = require('@playwright/test');

test.describe('Nav drawer', () => {
  test('default mode: toggle visible with standard styles on a non-compact page', async ({
    page
  }) => {
    await page.goto('/calculator/');
    const toggle = page.locator('.heyming-nav-toggle');
    await expect(toggle).toBeVisible({ timeout: 10_000 });
    await expect(toggle).toHaveAttribute('aria-expanded', 'false');
    const html = page.locator('html');
    await expect(html).not.toHaveAttribute('data-nav-size');
  });

  test('compact mode: terminal page has data-nav-size="compact" on <html>', async ({ page }) => {
    await page.goto('/terminal/');
    const html = page.locator('html');
    await expect(html).toHaveAttribute('data-nav-size', 'compact', { timeout: 10_000 });
    const toggle = page.locator('.heyming-nav-toggle');
    await expect(toggle).toBeVisible();
  });

  test('compact mode: toggle has reduced opacity', async ({ page }) => {
    await page.goto('/terminal/');
    await page.waitForSelector('.heyming-nav-toggle', { timeout: 10_000 });
    const opacity = await page
      .locator('.heyming-nav-toggle')
      .evaluate((el) => getComputedStyle(el).opacity);
    const val = parseFloat(opacity);
    expect(val).toBeLessThan(1);
    expect(val).toBeGreaterThan(0);
  });

  test('page name label derived from URL path', async ({ page }) => {
    await page.goto('/terminal/');
    await page.waitForSelector('.heyming-nav-toggle', { timeout: 10_000 });
    const label = await page.locator('.heyming-nav-toggle').getAttribute('data-event-label');
    expect(label).toBe('Terminal');
  });

  test('not shown on /os/ path', async ({ page }) => {
    await page.goto('/os/');
    await page.waitForTimeout(2000);
    const count = await page.locator('.heyming-nav-toggle').count();
    expect(count).toBe(0);
  });

  test('clicking toggle opens drawer; toggle hides; close button closes it', async ({ page }) => {
    await page.goto('/calculator/');
    const toggle = page.locator('.heyming-nav-toggle');
    const drawer = page.locator('.heyming-nav-drawer');
    await expect(toggle).toBeVisible({ timeout: 10_000 });
    await expect(drawer).not.toHaveClass(/\bopen\b/);

    await toggle.click();
    await expect(drawer).toHaveClass(/\bopen\b/);
    await expect(toggle).toBeHidden();

    await page.locator('.heyming-nav-close').click();
    await expect(drawer).not.toHaveClass(/\bopen\b/);
    await expect(toggle).toBeVisible();
  });

  test('Escape closes the drawer', async ({ page }) => {
    await page.goto('/calculator/');
    await page.locator('.heyming-nav-toggle').click();
    const drawer = page.locator('.heyming-nav-drawer');
    await expect(drawer).toHaveClass(/\bopen\b/);

    await page.keyboard.press('Escape');
    await expect(drawer).not.toHaveClass(/\bopen\b/);
  });

  test('drawer lists Home and Heyming OS shortcuts at the top', async ({ page }) => {
    await page.goto('/calculator/');
    await page.locator('.heyming-nav-toggle').click();

    const home = page.locator('.heyming-nav-system a[href="/"]');
    const os = page.locator('.heyming-nav-system a[href="/os/"]');
    await expect(home).toBeVisible();
    await expect(os).toBeVisible();
  });

  test('current app is highlighted with is-active', async ({ page }) => {
    await page.goto('/calculator/');
    await page.locator('.heyming-nav-toggle').click();
    const active = page.locator('.heyming-nav-item.is-active');
    await expect(active).toHaveAttribute('aria-current', 'page');
    await expect(active).toContainText(/Calculator/i);
  });
});
