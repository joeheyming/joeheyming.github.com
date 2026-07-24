// @ts-check
import { test, expect } from '@playwright/test';

test.describe('Programming Wisdom → Posts', () => {
  test('shares the current quote as an editable draft', async ({ page }) => {
    await page.goto('/programming-advice/');

    const quoteEl = page.locator('#advice-text');
    await expect(quoteEl).not.toHaveText('Click for wisdom');
    await expect(page.getByRole('button', { name: 'Make a Post', exact: true })).toBeVisible();

    const quote = (await quoteEl.innerText()).trim();
    const source = (await page.locator('#advice-source').innerText()).replace(/^—\s*/, '').trim();
    expect(quote.length).toBeGreaterThan(0);
    expect(source.length).toBeGreaterThan(0);

    await page.getByRole('button', { name: 'Make a Post', exact: true }).click();
    await page.waitForURL('**/posts/**');

    const draft = page.locator('.post.draft textarea');
    await expect(draft).toBeVisible();
    const value = await draft.inputValue();
    expect(value).toContain(`> ${quote.split('\n')[0]}`);
    expect(value).toContain(source);
    expect(value).toContain('https://joeheyming.github.io/programming-advice/');
  });
});
