// @ts-check
import { test, expect } from '@playwright/test';

test.describe('Notepad → Posts', () => {
  test('shares note markdown as an editable draft', async ({ page }) => {
    await page.goto('/notepad/');
    await page.waitForFunction(() => typeof window.Quill === 'function');

    await page.evaluate(() => {
      const root = document.querySelector('#editor');
      if (!root) throw new Error('editor missing');
      const quill = window.Quill.find(root);
      if (!quill) throw new Error('quill instance missing');
      quill.setContents([
        { insert: 'Hello from Notepad' },
        { insert: '\n', attributes: { header: 1 } },
        { insert: 'Bold line', attributes: { bold: true } },
        { insert: '\n' }
      ]);
    });

    await page.getByRole('button', { name: 'Make a Post', exact: true }).click();
    await page.waitForURL('**/posts/**');

    await expect(page.locator('.post.draft textarea')).toHaveValue(
      '# Hello from Notepad\n**Bold line**'
    );
    await expect(page.getByRole('button', { name: 'Pin' })).toBeVisible();
  });
});
