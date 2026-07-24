// @ts-check
import { test, expect } from '@playwright/test';

test.describe('Say It → Posts', () => {
  test('shares the whiteboard as a prefilled sticky note', async ({ page }) => {
    await page.goto('/sayit/');
    await page.evaluate(() => {
      const canvas = document.getElementById('drawingCanvas');
      if (!(canvas instanceof HTMLCanvasElement)) throw new Error('drawing canvas missing');
      const ctx = canvas.getContext('2d');
      if (!ctx) throw new Error('drawing context missing');
      ctx.fillStyle = '#000';
      ctx.fillRect(120, 100, 300, 80);
      const recognized = document.getElementById('parsedContent');
      if (recognized) recognized.textContent = 'Hello from the whiteboard';
    });

    await page.getByRole('button', { name: 'Make a post with my whiteboard drawing' }).click();
    await page.waitForURL('**/posts/**');

    await expect(page.locator('.post.draft textarea')).toHaveValue(
      'Hello from the whiteboard\n\n— Whiteboard message from [Say It](/sayit/)'
    );
    await expect(page.locator('.post.draft .note-thumb img')).toHaveCount(1);
  });
});
