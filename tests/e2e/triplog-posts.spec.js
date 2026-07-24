// @ts-check
import { test, expect } from '@playwright/test';

/**
 * Seed a completed trip and a short route into IndexedDB.
 * @param {import('@playwright/test').Page} page
 * @param {{ id: string, name: string, startedAt: string }} trip
 */
async function seedCompletedTrip(page, trip) {
  await page.evaluate(async (record) => {
    await new Promise((resolve, reject) => {
      const req = indexedDB.open('triplog', 1);
      req.onerror = () => reject(req.error);
      req.onupgradeneeded = () => {
        const db = req.result;
        if (!db.objectStoreNames.contains('trips')) {
          const trips = db.createObjectStore('trips', { keyPath: 'id' });
          trips.createIndex('by_startedAt', 'startedAt', { unique: false });
        }
        if (!db.objectStoreNames.contains('points')) {
          const points = db.createObjectStore('points', { keyPath: 'pk', autoIncrement: true });
          points.createIndex('by_trip', 'tripId', { unique: false });
        }
      };
      req.onsuccess = () => {
        const db = req.result;
        const tx = db.transaction(['trips', 'points'], 'readwrite');
        tx.objectStore('trips').put({
          id: record.id,
          name: record.name,
          startedAt: record.startedAt,
          endedAt: record.startedAt,
          durationSec: 1694,
          elapsedSec: 1802,
          distanceMeters: 5230,
          pointCount: 2,
          elevationGainM: 42,
          activity: 'run',
          status: 'complete'
        });
        const points = tx.objectStore('points');
        points.add({
          tripId: record.id,
          t: Date.parse(record.startedAt),
          lat: 37.7749,
          lon: -122.4194,
          altitude: 10
        });
        points.add({
          tripId: record.id,
          t: Date.parse(record.startedAt) + 60_000,
          lat: 37.7755,
          lon: -122.418,
          altitude: 12
        });
        tx.oncomplete = () => resolve(undefined);
        tx.onerror = () => reject(tx.error);
      };
    });
  }, trip);
}

test.describe('Trip Log → Posts', () => {
  test('shares a privacy-safe trip summary as an editable draft', async ({ page }) => {
    await page.goto('/triplog/');
    await expect(page.locator('#app-main')).toBeVisible({ timeout: 30_000 });
    await expect(page.getByRole('button', { name: 'Refresh' })).toBeVisible();

    const trip = {
      id: 'e2e-trip-post-1',
      name: 'Morning Run',
      startedAt: '2026-07-24T16:00:00.000Z'
    };
    await seedCompletedTrip(page, trip);
    await page.getByRole('button', { name: 'Refresh' }).click();

    await expect(page.getByRole('button', { name: 'Morning Run' })).toBeVisible();
    await page.getByRole('button', { name: 'Morning Run' }).click();

    const postButton = page.getByRole('button', { name: 'Make a Post', exact: true });
    await expect(postButton).toBeVisible();
    await expect(postButton).toBeEnabled();

    await postButton.click();
    await page.waitForURL('**/posts/**');

    const draft = page.locator('.post.draft textarea');
    await expect(draft).toBeVisible();
    const value = await draft.inputValue();

    expect(value).toContain('## Morning Run');
    expect(value).toContain('🏃 Run');
    expect(value).toMatch(/\*\*Distance:\*\* 5\.23 km/);
    expect(value).toMatch(/\*\*Moving time:\*\* 28:14/);
    expect(value).toMatch(/\*\*Elapsed:\*\* 30:02/);
    expect(value).toMatch(/\*\*Avg pace:\*\*/);
    expect(value).toMatch(/\*\*Elevation gain:\*\* 42 m/);
    expect(value).toContain('https://joeheyming.github.io/triplog/');

    // Privacy: no GPS coordinates or route geometry in the shared draft.
    expect(value).not.toMatch(/-?\d+\.\d{4,}\s*,\s*-?\d+\.\d{4,}/);
    expect(value).not.toMatch(/\blat(itude)?\b/i);
    expect(value).not.toMatch(/\blon(gitude)?\b/i);
    expect(value).not.toMatch(/\bpolyline\b/i);
    expect(value).not.toMatch(/\broute\b/i);
  });

  test('optionally includes the visible map as an image', async ({ page }) => {
    await page.goto('/triplog/');
    await expect(page.locator('#app-main')).toBeVisible({ timeout: 30_000 });
    const trip = {
      id: 'e2e-trip-post-map',
      name: 'Map Run',
      startedAt: '2026-07-24T17:00:00.000Z'
    };
    await seedCompletedTrip(page, trip);
    await page.getByRole('button', { name: 'Refresh' }).click();
    await page.getByRole('button', { name: 'Map Run' }).click();

    await page.evaluate(() => {
      /** @type {Window & {
       *   html2canvas: (element: HTMLElement) => Promise<HTMLCanvasElement>
       * }} */ (/** @type {unknown} */ (window)).html2canvas = async () => {
        const canvas = document.createElement('canvas');
        canvas.width = 320;
        canvas.height = 180;
        const ctx = canvas.getContext('2d');
        if (!ctx) throw new Error('canvas unavailable');
        ctx.fillStyle = '#dbeafe';
        ctx.fillRect(0, 0, canvas.width, canvas.height);
        ctx.strokeStyle = '#1a73e8';
        ctx.lineWidth = 8;
        ctx.beginPath();
        ctx.moveTo(20, 150);
        ctx.lineTo(160, 40);
        ctx.lineTo(300, 120);
        ctx.stroke();
        return canvas;
      };
    });

    const includeMap = page.getByRole('checkbox', { name: 'Include map' });
    await expect(includeMap).toBeEnabled();
    await includeMap.check();
    await page.getByRole('button', { name: 'Make a Post', exact: true }).click();
    await page.waitForURL('**/posts/**');

    await expect(page.locator('.post.draft textarea')).toHaveValue(/## Map Run/);
    await expect(page.locator('.post.draft .note-thumb img')).toHaveCount(1);
  });
});
