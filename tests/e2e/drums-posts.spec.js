// @ts-check
import { test, expect } from '@playwright/test';

async function recordShortLoop(page) {
  await page.getByRole('button', { name: 'Rec', exact: true }).click();
  await page.getByRole('button', { name: 'Snare (Q)' }).click();
  await page.waitForTimeout(275);
  await page.getByRole('button', { name: 'Rec', exact: true }).click();
}

test.describe('Drums → Posts', () => {
  test.beforeEach(async ({ page }) => {
    await page.addInitScript(() => {
      class MockMediaRecorder {
        static isTypeSupported(type) {
          return type.startsWith('audio/webm');
        }

        constructor(_stream, options = {}) {
          this.mimeType = options.mimeType || 'audio/webm';
          this.state = 'inactive';
          this.ondataavailable = null;
          this.onerror = null;
          this.onstop = null;
        }

        start() {
          this.state = 'recording';
        }

        stop() {
          this.state = 'inactive';
          this.ondataavailable?.({
            data: new Blob(['recorded drum loop'], { type: this.mimeType })
          });
          this.onstop?.();
        }
      }

      Object.defineProperty(window, 'MediaRecorder', {
        configurable: true,
        value: MockMediaRecorder
      });
    });
    await page.goto('/play/drums/');
  });

  test('enables Make a Post only for a non-empty loop', async ({ page }) => {
    const postButton = page.getByRole('button', { name: 'Make a Post', exact: true });
    await expect(postButton).toBeVisible();
    await expect(postButton).toBeDisabled();

    await recordShortLoop(page);
    await expect(postButton).toBeEnabled();

    await page.getByRole('button', { name: 'Clear', exact: true }).click();
    await expect(postButton).toBeDisabled();
  });

  test('opens an editable Posts draft with rendered loop audio', async ({ page }) => {
    await recordShortLoop(page);
    await page.getByRole('button', { name: 'Make a Post', exact: true }).click();
    await page.waitForURL('**/posts/**');

    const draft = page.locator('.post.draft textarea');
    await expect(draft).toBeVisible();
    await expect(draft).toHaveValue('🥁 Drum loop\n\nMade with [Drums](/play/drums/)');
    await expect(page.locator('.note-thumb audio[controls]')).toHaveCount(1);
  });
});
