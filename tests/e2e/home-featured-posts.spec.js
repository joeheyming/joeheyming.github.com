// @ts-check
import { test, expect } from '@playwright/test';

test('Posts is promoted in the home Featured strip', async ({ page }) => {
  await page.goto('/');
  const featured = page.locator('#featured-projects-grid a[href="/posts/"]');
  await expect(featured).toBeVisible();
  await expect(featured).toContainText('Leave a note');
});
