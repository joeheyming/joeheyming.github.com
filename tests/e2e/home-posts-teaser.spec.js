// @ts-check
import { test, expect } from '@playwright/test';

test.describe('Home posts teaser', () => {
  test('hero links to the posts board', async ({ page }) => {
    await page.goto('/');
    await expect(page.getByRole('link', { name: 'Posts board' })).toHaveAttribute(
      'href',
      '/posts/'
    );
  });

  test('shows latest note when the feed responds', async ({ page }) => {
    const response = {
      table: {
        cols: ['Timestamp', 'Text', 'Attachment', 'Name', 'Metadata', 'Honeypot'].map((label) => ({
          label
        })),
        rows: [
          {
            c: [
              { v: 'Date(2026,7,8,17,6,0)' },
              { v: 'Home teaser smoke note from the corkboard' },
              { v: '' },
              { v: 'Kilroy' },
              {
                v: JSON.stringify({
                  id: 'post-home-teaser',
                  action: 'post',
                  x: 0.4,
                  y: 0.4
                })
              },
              { v: '' }
            ]
          }
        ]
      }
    };
    await page.route('https://docs.google.com/spreadsheets/**', async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'text/javascript',
        body: `google.visualization.Query.setResponse(${JSON.stringify(response)});`
      });
    });

    await page.goto('/');
    const teaser = page.locator('#posts-teaser');
    await expect(teaser).toBeVisible();
    await expect(teaser.getByText('Latest note')).toBeVisible();
    await expect(teaser.getByText('Home teaser smoke note from the corkboard')).toBeVisible();
    await expect(page.getByRole('link', { name: 'View note' })).toHaveAttribute(
      'href',
      '/posts/?post=post-home-teaser'
    );
    await expect(page.getByRole('link', { name: 'Open board' })).toHaveAttribute('href', '/posts/');
  });
});
