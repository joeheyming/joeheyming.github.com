// @ts-check
const { test, expect } = require('@playwright/test');

test.describe('Heyming OS desktop context menu (Theme E)', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/os/index.html');
    await page.waitForSelector('#os-desktop');
    await page.waitForFunction(() => Boolean(window.heymingOS?.contextMenu));
  });

  test('desktop menu has role menu; ArrowDown focuses second item; Escape closes', async ({
    page
  }) => {
    await page.locator('#os-desktop').evaluate((el) => {
      const r = el.getBoundingClientRect();
      const x = r.left + Math.min(80, r.width - 20);
      const y = r.top + Math.min(80, r.height - 20);
      el.dispatchEvent(
        new MouseEvent('contextmenu', {
          bubbles: true,
          cancelable: true,
          clientX: x,
          clientY: y,
          view: window
        })
      );
    });

    const menu = page.locator('#desktop-context-menu');
    await expect(menu).toBeVisible();
    await expect(menu).toHaveAttribute('role', 'menu');
    await expect(menu).toHaveAttribute('aria-hidden', 'false');

    await page.keyboard.press('ArrowDown');
    const secondFocused = await page.evaluate(() => {
      const items = document.querySelectorAll('#desktop-context-menu [role="menuitem"]');
      return items.length >= 2 && document.activeElement === items[1];
    });
    expect(secondFocused).toBe(true);

    await page.keyboard.press('Escape');
    await expect(menu).toHaveClass(/hidden/);
    await expect(menu).toHaveAttribute('aria-hidden', 'true');
  });
});

test.describe('File manager context menu (Theme E)', () => {
  test('menu has role menu; Escape closes', async ({ page }) => {
    await page.goto('/filemanager/index.html');
    await page.waitForFunction(() => typeof window.fileManager?.navigateTo === 'function');

    const dir = await page.evaluate(async () => {
      const fs = await FileSystemDB.getInstance();
      const path = `/tmp/cm-e2e-${Date.now()}`;
      await fs.createDirectory(path);
      await fs.createFile(`${path}/note.txt`, 'x');
      return path;
    });

    await page.evaluate((p) => window.fileManager.navigateTo(p), dir);

    await page.getByText('note.txt', { exact: true }).click({ button: 'right' });

    const menu = page.locator('#context-menu');
    await expect(menu).toBeVisible();
    await expect(menu).toHaveAttribute('role', 'menu');
    await expect(menu).toHaveAttribute('aria-hidden', 'false');

    await page.keyboard.press('Escape');
    await expect(menu).toHaveClass(/hidden/);
    await expect(menu).toHaveAttribute('aria-hidden', 'true');
  });
});
