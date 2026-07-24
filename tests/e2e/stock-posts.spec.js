// @ts-check
import { test, expect } from '@playwright/test';

test.describe('Stock Ticker → Posts', () => {
  test('shares the current chart as an editable draft', async ({ page }) => {
    await page.addInitScript(() => {
      const chartResponse = {
        chart: {
          result: [
            {
              meta: {
                symbol: 'AAPL',
                shortName: 'Apple',
                currency: 'USD',
                regularMarketPrice: 215,
                chartPreviousClose: 210
              },
              timestamp: [1753200000, 1753286400, 1753372800],
              indicators: {
                quote: [
                  {
                    open: [209, 211, 213],
                    high: [212, 214, 217],
                    low: [208, 210, 212],
                    close: [211, 213, 215],
                    volume: [100, 120, 140]
                  }
                ],
                adjclose: [{ adjclose: [211, 213, 215] }]
              }
            }
          ],
          error: null
        }
      };
      const mockProxy = {
        fetchJson: async () => chartResponse
      };
      Object.defineProperty(window, 'proxyService', {
        configurable: true,
        get: () => mockProxy,
        set: () => {}
      });
    });

    await page.goto('/stock/?list=AAPL&range=3mo');
    const postButton = page.getByRole('button', { name: 'Make a Post', exact: true });
    await expect(postButton).toBeVisible();
    await expect(page.locator('.quote-tile')).toContainText('AAPL');

    await postButton.click();
    await page.waitForURL('**/posts/**');

    await expect(page.locator('.post.draft textarea')).toHaveValue(
      'AAPL · 3M chart\n\nMade with [Stock Ticker](/stock/)'
    );
    await expect(page.locator('.post.draft .note-thumb img')).toHaveCount(1);
  });
});
