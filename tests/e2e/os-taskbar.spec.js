// @ts-check
const { test, expect } = require('@playwright/test');

test.describe('Heyming OS landmarks (Theme E)', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/os/index.html');
    await page.waitForSelector('#os-taskbar', { state: 'visible' });
    await page.waitForFunction(() => Boolean(window.heymingOS?.launcher));
  });

  test('skip link targets main desktop; Enter moves focus to desktop surface', async ({ page }) => {
    const skip = page.locator('.os-skip-link');
    await expect(skip).toHaveAttribute('href', '/os/index.html#os-desktop');

    const desktop = page.locator('#os-desktop');
    await expect(desktop).toHaveAttribute('role', 'main');
    await expect(desktop).toHaveAttribute('aria-label', 'Desktop');
    await expect(desktop).toHaveAttribute('tabindex', '-1');

    await skip.focus();
    await page.keyboard.press('Enter');
    await expect(desktop).toBeFocused();
  });
});

test.describe('Heyming OS taskbar + launcher (Theme E)', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/os/index.html');
    await page.waitForSelector('#os-taskbar', { state: 'visible' });
    await page.waitForFunction(() => Boolean(window.heymingOS?.launcher));
  });

  test('launcher is a dialog with keyboard hints and aria-expanded toggles', async ({ page }) => {
    const launcherBtn = page.locator('#app-launcher');
    const menu = page.locator('#app-launcher-menu');

    await expect(menu).toBeHidden();
    await expect(menu).toHaveAttribute('aria-hidden', 'true');

    await expect(launcherBtn).toHaveAttribute('aria-expanded', 'false');

    await launcherBtn.click();
    await expect(menu).toBeVisible();
    await expect(menu).toHaveAttribute('aria-hidden', 'false');
    await expect(menu).toHaveAttribute('role', 'dialog');
    await expect(menu).toHaveAttribute('aria-modal', 'true');
    await expect(launcherBtn).toHaveAttribute('aria-expanded', 'true');

    await expect(page.locator('.launcher-footer')).toContainText('Esc');
    await expect(page.locator('.launcher-footer')).toContainText('Enter');
    await expect(page.locator('.launcher-footer')).toContainText('Meta toggles menu');

    await page.keyboard.press('Escape');
    await expect(menu).toHaveClass(/hidden/);
    await expect(launcherBtn).toHaveAttribute('aria-expanded', 'false');
  });

  test('taskbar clock is a time control with seconds toggle (Theme E)', async ({ page }) => {
    const clock = page.locator('#taskbar-clock');
    const tag = await clock.evaluate((el) => el.tagName.toLowerCase());
    expect(tag).toBe('time');
    await expect(clock).toHaveAttribute('role', 'button');
    await expect(clock).toHaveAttribute('datetime', /^\d{4}-\d{2}-\d{2}T/);
    await expect(clock).toHaveAttribute('aria-pressed', 'false');
    await clock.click();
    await expect(clock).toHaveAttribute('aria-pressed', 'true');
    await clock.click();
    await expect(clock).toHaveAttribute('aria-pressed', 'false');
    await clock.focus();
    await page.keyboard.press(' ');
    await expect(clock).toHaveAttribute('aria-pressed', 'true');
    await expect(page.locator('#system-info')).toHaveAttribute('role', 'status');
  });
});

test.describe('Heyming OS window chrome (Theme E)', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/os/index.html');
    await page.waitForSelector('#os-taskbar', { state: 'visible' });
    await page.waitForFunction(() => Boolean(window.heymingOS?.launcher));
  });

  test('inactive window loses active class; title bar click refocuses', async ({ page }) => {
    const launcherBtn = page.locator('#app-launcher');

    const openLauncher = async () => {
      await launcherBtn.click();
      await page.waitForSelector('#app-launcher-menu:not(.hidden)', { state: 'visible' });
    };

    await openLauncher();
    await page
      .locator('#app-launcher-menu')
      .getByRole('button', { name: /^🔢 Calculator$/i })
      .click();

    await openLauncher();
    await page
      .locator('#app-launcher-menu')
      .getByRole('button', { name: /^📝 Notepad$/i })
      .click();

    await expect(page.locator('#window-2')).toHaveClass(/active/);
    await expect(page.locator('#window-1')).not.toHaveClass(/active/);

    await page.locator('#window-1 .os-window-titlebar').click();
    await expect(page.locator('#window-1')).toHaveClass(/active/);
    await expect(page.locator('#window-2')).not.toHaveClass(/active/);
  });

  test('long window title truncates with ellipsis; title attribute shows full text (Theme E)', async ({
    page
  }) => {
    const longTitle = 'W'.repeat(200);
    const windowId = await page.evaluate((t) => {
      const wm = window.heymingOS.windowManager;
      const w = wm.createWindow(t, '<div style="padding:4px;font-size:12px;">stub</div>', 400, 300);
      return w.id;
    }, longTitle);

    const titleEl = page.locator(`#window-${windowId} .os-window-title`);
    await expect(titleEl).toHaveAttribute('title', longTitle);
    const truncated = await titleEl.evaluate((el) => el.scrollWidth > el.clientWidth);
    expect(truncated).toBe(true);
  });

  test('iframe app shell uses dark chrome matching window body (Theme E)', async ({ page }) => {
    await page.locator('#app-launcher').click();
    await page.waitForSelector('#app-launcher-menu:not(.hidden)', { state: 'visible' });
    await page
      .locator('#app-launcher-menu')
      .getByRole('button', { name: /^💻 Terminal$/i })
      .click();

    await expect(page.locator('#window-1')).toBeVisible();
    const shell = page.locator('#window-1 .iframe-content');
    await expect(shell).toBeVisible();
    const bg = await shell.evaluate((el) => getComputedStyle(el).backgroundColor);
    expect(bg).toMatch(/rgb\(26,\s*32,\s*44\)/);
  });

  test('Terminal iframe sets terminal-embed-os + hides share dock (Theme G)', async ({ page }) => {
    await page.locator('#app-launcher').click();
    await page.waitForSelector('#app-launcher-menu:not(.hidden)', { state: 'visible' });
    await page
      .locator('#app-launcher-menu')
      .getByRole('button', { name: /^💻 Terminal$/i })
      .click();

    const frame = page.frameLocator('#window-1 iframe');
    await expect(frame.locator('html')).toHaveClass(/terminal-embed-os/);
    await expect(frame.locator('#terminal-share-dock')).toBeHidden();
    await expect(frame.locator('#terminal-container')).toHaveAttribute(
      'aria-label',
      'jsh terminal (Heyming OS window)'
    );
    await expect(frame.locator('#terminal-scroll')).toHaveAttribute(
      'aria-label',
      'Terminal session in this window'
    );
  });
});

test.describe('Heyming OS shutdown dialog (Theme E)', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/os/index.html');
    await page.waitForSelector('#os-taskbar', { state: 'visible' });
    await page.waitForFunction(() => Boolean(window.heymingOS?.launcher));
  });

  test('dialog role, initial focus on Cancel, focus returns after dismiss', async ({ page }) => {
    const shutdownBtn = page.locator('#os-close');
    const dialog = page.locator('#shutdown-dialog');

    await shutdownBtn.focus();
    await shutdownBtn.click();

    await expect(dialog).toBeVisible();
    await expect(dialog).toHaveAttribute('role', 'dialog');
    await expect(dialog).toHaveAttribute('aria-modal', 'true');
    await expect(dialog).toHaveAttribute('aria-labelledby', 'shutdown-dialog-title');
    await expect(dialog).toHaveAttribute('aria-describedby', 'shutdown-dialog-desc');
    await expect(dialog).toHaveAttribute('aria-hidden', 'false');

    await expect(page.locator('#shutdown-cancel')).toBeFocused();

    await page.locator('#shutdown-cancel').click();
    await expect(dialog).toHaveClass(/hidden/);
    await expect(dialog).toHaveAttribute('aria-hidden', 'true');
    await expect(shutdownBtn).toBeFocused();
  });

  test('Escape closes shutdown dialog', async ({ page }) => {
    await page.locator('#os-close').click();
    await expect(page.locator('#shutdown-dialog')).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(page.locator('#shutdown-dialog')).toHaveClass(/hidden/);
  });

  test('Tab cycles between Cancel and Shutdown', async ({ page }) => {
    await page.locator('#os-close').click();
    await expect(page.locator('#shutdown-cancel')).toBeFocused();
    await page.keyboard.press('Tab');
    await expect(page.locator('#shutdown-confirm')).toBeFocused();
    await page.keyboard.press('Tab');
    await expect(page.locator('#shutdown-cancel')).toBeFocused();
  });
});
