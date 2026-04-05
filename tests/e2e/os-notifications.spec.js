// @ts-check
const { test, expect } = require('@playwright/test');

test.describe('Heyming OS notifications (Theme E)', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/os/index.html');
    await page.waitForSelector('#os-taskbar', { state: 'visible' });
    await page.waitForFunction(() => Boolean(window.heymingOS?.notifications));
  });

  test('notification region stacks multiple toasts vertically', async ({ page }) => {
    const region = page.locator('#os-notification-region');
    await expect(region).toBeAttached();

    await page.evaluate(() => {
      window.heymingOS.notifications.system('e2e stack toast A');
      window.heymingOS.notifications.info('e2e stack toast B');
    });

    const a = page.getByText('e2e stack toast A', { exact: true });
    const b = page.getByText('e2e stack toast B', { exact: true });
    await expect(a).toBeVisible();
    await expect(b).toBeVisible();

    await expect(a).toHaveAttribute('role', 'status');
    await expect(region.locator('.notification')).toHaveCount(2);

    const boxA = await a.boundingBox();
    const boxB = await b.boundingBox();
    expect(boxA && boxB).toBeTruthy();
    expect(boxB.y).toBeGreaterThanOrEqual(boxA.y + boxA.height - 2);
  });
});
