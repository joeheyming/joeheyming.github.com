// @ts-check
const { test, expect } = require('@playwright/test');

test.describe('File manager modals (Theme E)', () => {
  test('new-folder dialog: role, aria, Escape and backdrop dismiss', async ({ page }) => {
    await page.goto('/filemanager/index.html');
    await page.waitForFunction(() => typeof window.fileManager?.navigateTo === 'function');

    await page.locator('#btn-new-folder').click();

    const overlay = page.locator('#dialog-overlay');
    const dialog = page.locator('#dialog[role="dialog"]');
    await expect(dialog).toBeVisible();
    await expect(overlay).toHaveAttribute('aria-hidden', 'false');

    await page.keyboard.press('Escape');
    await expect(overlay).toBeHidden();
    await expect(overlay).toHaveAttribute('aria-hidden', 'true');

    await page.locator('#btn-new-folder').click();
    await expect(dialog).toBeVisible();
    await overlay.click({ position: { x: 4, y: 4 } });
    await expect(overlay).toBeHidden();
  });

  test('preview modal: Escape closes and restores aria-hidden', async ({ page }) => {
    await page.goto('/filemanager/index.html');
    await page.waitForFunction(() => typeof window.fileManager?.navigateTo === 'function');

    await page.evaluate(async () => {
      const fs = await FileSystemDB.getInstance();
      const p = `/tmp/fm-preview-e2e-${Date.now()}.txt`;
      await fs.createFile(p, 'hello e2e');
      const parent = p.replace(/\/[^/]+$/, '') || '/';
      await window.fileManager.navigateTo(parent);
      const item = await window.fileManager.fs.getItem(p);
      await window.fileManager.previewFile(item);
    });

    const previewOverlay = page.locator('#preview-overlay');
    const previewBody = page.locator('#preview-content');
    await expect(page.locator('#preview[role="dialog"]')).toBeVisible();
    await expect(previewOverlay).toHaveAttribute('aria-hidden', 'false');
    await expect(previewBody).toHaveAttribute('role', 'region');
    await expect(previewBody).toHaveAttribute('aria-label', 'File contents');
    await expect(previewBody).toHaveClass(/preview-file-text/);
    await expect(previewBody).toContainText('hello e2e');

    await page.keyboard.press('Escape');
    await expect(previewOverlay).toBeHidden();
    await expect(previewOverlay).toHaveAttribute('aria-hidden', 'true');
  });
});
