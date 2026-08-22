// @ts-check
const { test, expect } = require('@playwright/test');

const METADATA = {
  d1: 'archive.org',
  dir: '/download/pack-roms-nintendo-64-eu-us-jap',
  files: [{ name: 'Test Game (USA).z64', size: '8388608' }]
};

async function openMockCollection(page) {
  await page.route('https://archive.org/metadata/**', (route) =>
    route.fulfill({
      contentType: 'application/json',
      body: JSON.stringify(METADATA)
    })
  );
  await page.route('https://cdn.emulatorjs.org/**', (route) =>
    route.fulfill({ contentType: 'application/javascript', body: '' })
  );

  await page.goto('/emulator/n64/');
  await page.getByRole('button', { name: 'Browse N64 ROM Collection' }).click();
  await expect(page.getByText('Test Game (USA)', { exact: true })).toBeVisible();
}

test.describe('N64 emulator suite', () => {
  test('routes to the N64 core and supports direct play or download', async ({ page }) => {
    await page.route('https://archive.org/download/**', (route) =>
      route.fulfill({
        contentType: 'application/octet-stream',
        body: Buffer.alloc(256, 1)
      })
    );

    await openMockCollection(page);

    await expect(page.locator('#romFileInput')).toHaveAttribute(
      'accept',
      '.z64,.n64,.v64,.zip,.7z'
    );
    await expect(page.getByRole('link', { name: 'Download instead' })).toHaveAttribute(
      'href',
      /Test%20Game%20\(USA\)\.z64$/
    );

    await page.getByRole('button', { name: 'Play in browser' }).click();
    await expect(page.locator('#game-container')).toHaveClass(/visible/);
    await expect.poll(() => page.evaluate(() => window.EJS_core)).toBe('n64');
    await expect.poll(() => page.evaluate(() => window.EJS_gameName)).toBe('Test Game (USA).z64');
  });

  test('offers Archive download and local loading after a proxy failure', async ({ page }) => {
    await openMockCollection(page);
    await page.evaluate(() => {
      window.proxyService.fetchBinaryWithProxy = async () => {
        throw new Error('mock proxy timeout');
      };
    });

    await page.getByRole('button', { name: 'Play in browser' }).click();

    await expect(page.getByText('Failed to load Test Game (USA).')).toBeVisible();
    await expect(page.getByRole('link', { name: 'Download instead' })).toHaveAttribute(
      'href',
      /Test%20Game%20\(USA\)\.z64$/
    );
    await expect(page.getByRole('button', { name: 'Load saved ROM' })).toBeVisible();
  });
});
