// @ts-check
const { test, expect } = require('@playwright/test');

const METADATA = {
  d1: 'archive.org',
  dir: '/download/pack-roms-nintendo-64-eu-us-jap',
  files: [{ name: 'Test Game (USA).z64', size: '8388608' }]
};

/**
 * Serve the ROM binary. archive.org's item CDN never allows a direct
 * cross-origin fetch, so `loadRom` goes straight through a CORS proxy — the
 * request URL is a proxy prefix with the archive.org URL percent-encoded
 * inside it. Match either form so the mock survives a change of proxy order.
 *
 * @param {import('@playwright/test').Page} page
 */
async function mockRomDownload(page) {
  await page.route(
    (url) => /archive\.org(\/|%2F)download/i.test(url.href),
    (route) =>
      route.fulfill({
        contentType: 'application/octet-stream',
        body: Buffer.alloc(256, 1)
      })
  );
}

/**
 * @param {import('@playwright/test').Page} page
 */
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
    await mockRomDownload(page);
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
    await expect
      .poll(() =>
        page.evaluate(() => /** @type {Window & { EJS_core?: string }} */ (window).EJS_core)
      )
      .toBe('n64');
    await expect
      .poll(() =>
        page.evaluate(() => /** @type {Window & { EJS_gameName?: string }} */ (window).EJS_gameName)
      )
      .toBe('Test Game (USA).z64');
  });

  test('offers Archive download and local loading after a proxy failure', async ({ page }) => {
    await openMockCollection(page);
    await page.evaluate(() => {
      const appWindow =
        /** @type {Window & { proxyService: { fetchBinaryWithProxy: () => Promise<never> } }} */ (
          /** @type {unknown} */ (window)
        );
      appWindow.proxyService.fetchBinaryWithProxy = async () => {
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

  test('cancels a stalled ROM download and restores the game list', async ({ page }) => {
    await openMockCollection(page);
    await page.evaluate(() => {
      const appWindow =
        /** @type {Window & { proxyService: { fetchBinaryWithProxy: (url: string, options: { signal?: AbortSignal }) => Promise<never> } }} */ (
          /** @type {unknown} */ (window)
        );
      appWindow.proxyService.fetchBinaryWithProxy = async (_url, options) =>
        new Promise((_resolve, reject) => {
          options.signal?.addEventListener('abort', () => {
            reject(new DOMException('cancelled', 'AbortError'));
          });
        });
    });

    await page.getByRole('button', { name: 'Play in browser' }).click();
    await page.getByRole('button', { name: 'Cancel — back to game list' }).click();

    await expect(page.getByText('Test Game (USA)', { exact: true })).toBeVisible();
    await expect(page.getByText('Failed to load Test Game (USA).')).toHaveCount(0);
  });

  test('offers a game-list escape while the emulator core loads', async ({ page }) => {
    await mockRomDownload(page);
    await openMockCollection(page);

    await page.getByRole('button', { name: 'Play in browser' }).click();
    await page.getByRole('button', { name: 'Cancel loading / Game list' }).click();

    await expect(page.getByRole('button', { name: 'Browse N64 ROM Collection' })).toBeVisible();
    await expect(page.locator('#game-container')).not.toHaveClass(/visible/);
  });
});

test('PS1 also offers best-effort play and local download', async ({ page }) => {
  await page.route('https://archive.org/metadata/**', (route) =>
    route.fulfill({
      contentType: 'application/json',
      body: JSON.stringify({
        d1: 'archive.org',
        dir: '/download/CuratedPSXRedumpCHDs',
        files: [{ name: 'Test Disc.chd', size: '419430400' }]
      })
    })
  );
  await page.goto('/emulator/ps1/');
  await page.getByRole('button', { name: 'Browse PS1 Disc Collection' }).click();
  await expect(page.getByText('Test Disc', { exact: true })).toBeVisible();

  await expect(page.getByRole('button', { name: 'Play in browser' })).toBeVisible();
  await expect(page.getByRole('link', { name: 'Download instead' })).toHaveAttribute(
    'href',
    /CuratedPSXRedumpCHDs\/Test%20Disc\.chd$/
  );

  await page.evaluate(() => {
    const appWindow =
      /** @type {Window & { proxyService: { fetchBinaryWithProxy: () => Promise<never> } }} */ (
        /** @type {unknown} */ (window)
      );
    appWindow.proxyService.fetchBinaryWithProxy = async () => {
      throw new Error('mock proxy timeout');
    };
  });
  await page.getByRole('button', { name: 'Play in browser' }).click();
  await expect(page.getByText('Failed to load Test Disc.')).toBeVisible();
});
