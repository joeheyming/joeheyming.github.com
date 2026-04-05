// @ts-check
const { test, expect } = require('@playwright/test');

test.describe('File manager list view (Theme E)', () => {
  test('list view shows column header and aligns meta columns', async ({ page }) => {
    await page.goto('/filemanager/index.html');
    await page.waitForFunction(() => typeof window.fileManager?.toggleView === 'function');

    const toolbar = page.locator('#toolbar');
    await expect(toolbar).toHaveAttribute('role', 'toolbar');

    const statusBar = page.locator('#status-bar');
    await expect(statusBar).toHaveAttribute('role', 'status');
    await expect(statusBar).toHaveAttribute('aria-live', 'polite');
    await expect(statusBar).toHaveAttribute('aria-label', 'Current folder summary');
    await expect(page.locator('#selected-info')).toHaveAttribute('aria-hidden', 'true');

    const viewToggle = page.locator('#btn-view-toggle');
    await expect(viewToggle).toHaveAttribute('aria-pressed', 'false');
    await expect(viewToggle).toHaveAttribute('aria-label', 'Grid view');

    await page.evaluate(() => {
      window.fileManager.toggleView();
    });

    await expect(viewToggle).toHaveAttribute('aria-pressed', 'true');
    await expect(viewToggle).toHaveAttribute('aria-label', 'List view');

    const header = page.locator('.file-list-header');
    await expect(header).toBeVisible();
    await expect(header).toContainText('Name');
    await expect(header).toContainText('Size');
    await expect(header).toContainText('Modified');

    await expect(page.locator('#file-list.list-view')).toBeVisible();
  });

  test('path breadcrumb is a nav with aria-current on the active folder', async ({ page }) => {
    await page.goto('/filemanager/index.html');
    await page.waitForFunction(() => typeof window.fileManager?.navigateTo === 'function');

    const pathBar = page.locator('#path-bar');
    await expect(pathBar).toHaveJSProperty('tagName', 'NAV');

    await page.evaluate(async () => {
      await window.fileManager.navigateTo('/');
    });

    const atRoot = page.locator('#current-path .breadcrumb-segment[aria-current="page"]');
    await expect(atRoot).toHaveCount(1);
    await expect(atRoot).toHaveAttribute('data-path', '/');

    await page.evaluate(async () => {
      await window.fileManager.navigateTo('/tmp');
    });

    const crumbs = page.locator('#current-path .breadcrumb-segment');
    await expect(crumbs).toHaveCount(2);
    await expect(
      page.locator('#current-path .breadcrumb-segment[aria-current="page"]')
    ).toHaveCount(1);
    await expect(page.locator('#current-path .breadcrumb-segment.active')).toHaveCount(1);
    const current = page.locator('#current-path .breadcrumb-segment[aria-current="page"]');
    await expect(current).toHaveAttribute('data-path', '/tmp');
    await expect(current).toHaveText('tmp');

    const homeCrumb = page.locator('#current-path .breadcrumb-segment[data-path="/"]').first();
    await expect(homeCrumb).toHaveAttribute('role', 'button');
    await expect(homeCrumb).toHaveAttribute('tabindex', '0');
  });

  test('grid view selection ring has outline offset (incl. parent .. row)', async ({ page }) => {
    await page.goto('/filemanager/index.html');
    await page.waitForFunction(() => typeof window.fileManager?.navigateWithArrows === 'function');
    await page.waitForSelector('.file-item');

    const viewToggle = page.locator('#btn-view-toggle');
    await expect(viewToggle).toHaveAttribute('aria-pressed', 'false');
    await expect(page.locator('#file-list.grid-view')).toBeVisible();

    const outline = await page.evaluate(async () => {
      await window.fileManager.navigateWithArrows('ArrowDown', false);
      const el = document.querySelector('.file-item.selected');
      if (!el) return null;
      const s = getComputedStyle(el);
      return { width: s.outlineWidth, offset: s.outlineOffset };
    });
    expect(outline).not.toBeNull();
    expect(outline.width).toBe('2px');
    expect(outline.offset).toBe('2px');
  });
});
