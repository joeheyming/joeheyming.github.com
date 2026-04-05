// @ts-check
const { test, expect } = require('@playwright/test');

test.describe('File manager empty states (Theme E)', () => {
  test('empty subfolder shows inline hint and parent row', async ({ page }) => {
    await page.goto('/filemanager/index.html');
    await page.waitForFunction(() => typeof window.fileManager?.navigateTo === 'function');

    const dir = await page.evaluate(async () => {
      const fs = await FileSystemDB.getInstance();
      const path = `/tmp/empty-e2e-${Date.now()}`;
      await fs.createDirectory(path);
      return path;
    });

    await page.evaluate(async (path) => {
      await window.fileManager.navigateTo(path);
    }, dir);

    await expect(page.locator('.empty-folder-hint')).toBeVisible();
    await expect(page.locator('.empty-folder-hint')).toContainText('No files or folders here');
    await expect(page.locator('#file-list .parent-item')).toBeVisible();
    await expect(page.locator('#item-count')).toContainText('1 item');
  });
});
