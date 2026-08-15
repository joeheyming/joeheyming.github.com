/**
 * Composer smoke: score renders, tempo chip + bars controls exist, place selects.
 */
import { test, expect } from '@playwright/test';

test.describe('composer smoke', () => {
  test('loads score chrome and places a note', async ({ page }) => {
    await page.goto('/play/composer/', { waitUntil: 'load', timeout: 20_000 });
    await expect(page.locator('#score')).toBeVisible();
    await expect(page.locator('#bpm-face')).toBeVisible();
    await expect(page.locator('#bars-plus')).toBeVisible();
    await expect(page.locator('#bars-minus')).toBeVisible();

    const svg = page.locator('#score');
    const box = await svg.boundingBox();
    expect(box).toBeTruthy();

    // Click roughly mid-treble staff to place/select
    await page.mouse.click(box.x + box.width * 0.35, box.y + box.height * 0.28);
    await page.waitForTimeout(200);

    const selected = page.locator('#score .note.is-selected, #score .rest.is-selected');
    await expect(selected.first()).toBeVisible({ timeout: 3000 });
  });

  test('bars plus increases measure count', async ({ page }) => {
    await page.goto('/play/composer/', { waitUntil: 'load', timeout: 20_000 });
    const input = page.locator('#measures');
    const before = Number(await input.inputValue());
    await page.locator('#bars-plus').click();
    await expect(input).toHaveValue(String(Math.min(16, before + 1)));
  });
});
