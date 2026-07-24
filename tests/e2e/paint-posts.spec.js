// @ts-check
import { test, expect } from '@playwright/test';

test.describe('Paint → Posts', () => {
  test('shares the canvas as a prefilled sticky note', async ({ page }) => {
    await page.goto('/paint/');
    await page.evaluate(() => {
      const layer = document.querySelector('.layer-canvas');
      if (!(layer instanceof HTMLCanvasElement)) throw new Error('layer canvas missing');
      const ctx = layer.getContext('2d');
      if (!ctx) throw new Error('layer context missing');
      ctx.fillStyle = '#000';
      ctx.fillRect(80, 60, 200, 120);
    });

    await page.getByRole('button', { name: 'Make a Post' }).click();
    await page.waitForURL('**/posts/**');

    await expect(page.locator('.post.draft textarea')).toHaveValue(
      'Paint\n\nMade with [Paint](https://joeheyming.github.io/paint/).'
    );
    await expect(page.locator('.post.draft .note-thumb img')).toHaveCount(1);
  });
});
