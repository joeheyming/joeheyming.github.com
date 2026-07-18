// @ts-check
const { test, expect } = require('@playwright/test');

test.describe('Heyming OS desktop icons (Theme E)', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/os/index.html');
    await page.waitForSelector('#os-desktop', { state: 'visible' });
    await page.waitForFunction(() => Boolean(window.heymingOS?.launcher));
    await page.waitForSelector('.desktop-icon[role="button"]', { timeout: 30_000 });
  });

  test('app icons are focusable with label; Enter opens app window', async ({ page }) => {
    const terminalIcon = page.getByRole('button', { name: /^Open Terminal$/ });
    await terminalIcon.focus();
    await expect(terminalIcon).toBeFocused();
    await page.keyboard.press('Enter');
    await expect(page.locator('.os-window')).toBeVisible();
  });

  test('Theme E: drop overlay stays when pointer moves to a desktop icon (dragleave relatedTarget)', async ({
    page
  }) => {
    const stillActive = await page.evaluate(() => {
      const desktop = document.getElementById('os-desktop');
      const child = desktop?.querySelector('.desktop-icon');
      if (!desktop || !child) {
        return false;
      }
      desktop.dispatchEvent(new DragEvent('dragenter', { bubbles: true, cancelable: true }));
      if (!desktop.classList.contains('drop-active')) {
        return false;
      }
      desktop.dispatchEvent(
        new DragEvent('dragleave', { bubbles: true, cancelable: true, relatedTarget: child })
      );
      return desktop.classList.contains('drop-active');
    });
    expect(stillActive).toBe(true);
  });

  test('Theme E: drop overlay clears when leaving desktop (dragleave to outside)', async ({
    page
  }) => {
    const cleared = await page.evaluate(() => {
      const desktop = document.getElementById('os-desktop');
      if (!desktop) {
        return false;
      }
      desktop.dispatchEvent(new DragEvent('dragenter', { bubbles: true, cancelable: true }));
      desktop.dispatchEvent(
        new DragEvent('dragleave', { bubbles: true, cancelable: true, relatedTarget: null })
      );
      return !desktop.classList.contains('drop-active');
    });
    expect(cleared).toBe(true);
  });

  test('rubber-band selection caches geometry and coalesces pointer updates', async ({ page }) => {
    const result = await page.evaluate(async () => {
      const desktop = document.getElementById('os-desktop');
      const desktopController = window.heymingOS.desktop;
      if (!desktop || !desktopController) {
        return null;
      }

      const testIcon = document.createElement('div');
      testIcon.className = 'desktop-icon file-icon';
      testIcon.dataset.path = '/rubber-band-test.txt';
      desktop.appendChild(testIcon);
      desktopController.fileIcons.push(testIcon);

      const fileIcons = desktopController.fileIcons;
      let rectReads = 0;
      for (const icon of fileIcons) {
        icon.getBoundingClientRect = () => {
          rectReads++;
          return {
            left: 10,
            right: 50,
            top: 10,
            bottom: 50,
            width: 40,
            height: 40,
            x: 10,
            y: 10,
            toJSON: () => ({})
          };
        };
      }

      const nativeRequestAnimationFrame = window.requestAnimationFrame.bind(window);
      let scheduledFrames = 0;
      window.requestAnimationFrame = (callback) => {
        scheduledFrames++;
        return nativeRequestAnimationFrame(callback);
      };

      desktop.dispatchEvent(
        new MouseEvent('mousedown', { bubbles: true, button: 0, clientX: 0, clientY: 0 })
      );
      document.dispatchEvent(new MouseEvent('mousemove', { clientX: 20, clientY: 20 }));
      document.dispatchEvent(new MouseEvent('mousemove', { clientX: 40, clientY: 40 }));
      document.dispatchEvent(new MouseEvent('mousemove', { clientX: 60, clientY: 60 }));

      const readsAtDragStart = rectReads;
      const framesForMoves = scheduledFrames;
      await new Promise((resolve) => nativeRequestAnimationFrame(resolve));
      const readsAfterMoveFrame = rectReads;

      window.dispatchEvent(new Event('resize'));
      await new Promise((resolve) => nativeRequestAnimationFrame(resolve));
      const readsAfterResize = rectReads;
      const selectedAfterLatestMove = desktopController.selectedFiles.has(testIcon.dataset.path);

      document.dispatchEvent(new MouseEvent('mouseup'));
      const dragStateCleared =
        desktopController.dragSelectionFrame === null &&
        desktopController.dragSelectionPointer === null &&
        desktopController.dragSelectionIconRects === null;
      window.requestAnimationFrame = nativeRequestAnimationFrame;
      testIcon.remove();
      desktopController.fileIcons = desktopController.fileIcons.filter((icon) => icon !== testIcon);

      return {
        iconCount: fileIcons.length,
        readsAtDragStart,
        framesForMoves,
        readsAfterMoveFrame,
        readsAfterResize,
        selectedAfterLatestMove,
        dragStateCleared
      };
    });

    expect(result).not.toBeNull();
    expect(result.readsAtDragStart).toBe(result.iconCount);
    expect(result.framesForMoves).toBe(1);
    expect(result.readsAfterMoveFrame).toBe(result.iconCount);
    expect(result.readsAfterResize).toBe(result.iconCount * 2);
    expect(result.selectedAfterLatestMove).toBe(true);
    expect(result.dragStateCleared).toBe(true);
  });

  test('Theme E: Quick Look — dialog semantics, Esc hint, focus, Escape closes', async ({
    page
  }) => {
    const testPath = `/home/jheyming/Desktop/ql-e2e-${Date.now()}.txt`;
    const baseName = testPath.split('/').pop();

    await page.evaluate(async (p) => {
      const fs = await FileSystemDB.getInstance();
      const parentDir = p.slice(0, p.lastIndexOf('/'));
      if (!(await fs.getItem('/'))) {
        await fs.createDirectory('/');
      }
      const segments = parentDir.split('/').filter(Boolean);
      let acc = '';
      for (const seg of segments) {
        acc += `/${seg}`;
        if (!(await fs.getItem(acc))) {
          await fs.createDirectory(acc);
        }
      }
      await fs.createFile(p, 'quick look e2e', true);
      await window.heymingOS.desktop.refresh();
    }, testPath);

    const fileIcon = page.locator(`.file-icon[data-path="${testPath}"]`).first();
    await expect(fileIcon).toBeVisible({ timeout: 30_000 });
    // #os-windows stacks above icons; use focus + Space like the Terminal icon test (focus + Enter).
    await fileIcon.focus();
    await page.keyboard.press('Space');

    const dialog = page.getByRole('dialog', { name: baseName }).first();
    await expect(dialog).toBeVisible();
    await expect(dialog).toHaveAttribute('aria-modal', 'true');
    await expect(page.getByRole('button', { name: /close quick look/i })).toBeFocused();
    await expect(page.locator('.quick-look-hint')).toContainText('Esc');
    await expect(page.getByRole('region', { name: /preview/i })).toBeVisible();

    await page.keyboard.press('Escape');
    await expect(page.locator('.quick-look-overlay')).toHaveCount(0);
    await expect(fileIcon).toBeFocused();
  });
});
