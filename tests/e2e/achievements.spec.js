// @ts-check
/// <reference path="../../types/globals.d.ts" />
const { test, expect } = require('@playwright/test');

/** @typedef {import('@playwright/test').Page} Page */
/** @typedef {{ name: string, params: Record<string, unknown> }} CapturedEvent */

// Each test gets a fresh browser context, so localStorage starts empty. Do not
// clear it via addInitScript — that re-runs on reload and would erase the
// unlocks these tests are asserting survive a page load.

// Stub `window.gtag` before page scripts run. analytics.js assigns a localhost
// noop, but `trackEvent` still forwards through `gtag('event', …)` when gtag
// exists — the setter no-op keeps our capture in place.
/** @param {Page} page */
async function captureGtag(page) {
  await page.addInitScript(() => {
    const calls = /** @type {unknown[][]} */ ([]);
    const capture = /** @type {(...args: unknown[]) => void} */ ((...args) => calls.push(args));
    Reflect.set(window, '__gtagCalls', calls);
    Object.defineProperty(window, 'gtag', {
      configurable: true,
      get: () => capture,
      set: () => {}
    });
  });
}

/**
 * @param {Page} page
 * @returns {Promise<CapturedEvent[]>}
 */
async function gtagEvents(page) {
  return page.evaluate(() => {
    const calls = /** @type {unknown[][]} */ (Reflect.get(window, '__gtagCalls') || []);
    return calls
      .filter((call) => call[0] === 'event')
      .map((call) => ({
        name: String(call[1]),
        params:
          call[2] && typeof call[2] === 'object'
            ? /** @type {Record<string, unknown>} */ (call[2])
            : {}
      }));
  });
}

/**
 * @param {CapturedEvent[]} events
 * @param {string} name
 */
function achievementEvents(events, name) {
  return events.filter(
    (event) => event.name === name && event.params.event_category === 'Achievements'
  );
}

test('renders the connected catalog and persists an unlocked node', async ({ page }) => {
  await page.goto('/achievements/');
  const nodes = page.locator('[data-achievement-id]');
  await expect(nodes.first()).toBeVisible();
  expect(await nodes.count()).toBeGreaterThanOrEqual(70);

  await page.evaluate(async () => {
    await window.heymingAchievements?.unlock('2048:first-action');
  });
  await expect(page.locator('[data-achievement-id="2048:first-action"]')).toHaveClass(
    /is-unlocked/
  );

  await page.reload();
  await expect(page.locator('[data-achievement-id="2048:first-action"]')).toHaveClass(
    /is-unlocked/
  );
});

test('shows the Minecraft-style toast on desktop only', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 720 });
  await page.goto('/achievements/');
  await page.evaluate(async () => {
    await window.heymingAchievements?.unlock('2048:first-action');
  });

  const toast = page.locator('heyming-achievement-toasts').locator('.toast');
  await expect(toast).toBeVisible();
  await expect(toast).toContainText('Achievement awarded');
});

test('toast links to the achievements page in a new window', async ({ page, context }) => {
  await page.setViewportSize({ width: 1280, height: 720 });
  await page.goto('/2048/');
  await page.evaluate(async () => {
    await window.heymingAchievements?.unlock('2048:first-action');
  });

  const toast = page.locator('heyming-achievement-toasts').locator('.toast');
  await expect(toast).toHaveAttribute('href', '/achievements/');
  await expect(toast).toHaveAttribute('target', '_blank');

  // Hovering must hold the toast open long enough to actually click it.
  await toast.hover();
  await page.waitForTimeout(5000);
  await expect(toast).toBeVisible();

  const [opened] = await Promise.all([context.waitForEvent('page'), toast.click()]);
  await expect(opened).toHaveURL(/\/achievements\/$/);
});

test('records mobile and iframe unlocks without rendering toast chrome', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/achievements/');
  await page.evaluate(async () => {
    await window.heymingAchievements?.unlock('2048:first-action');
  });
  await expect(page.locator('heyming-achievement-toasts')).toHaveCount(0);

  await page.setViewportSize({ width: 1280, height: 720 });
  await page.evaluate(() => {
    const iframe = document.createElement('iframe');
    iframe.src = '/achievements/';
    iframe.id = 'achievement-test-frame';
    document.body.appendChild(iframe);
  });
  const frame = page.frameLocator('#achievement-test-frame');
  await expect(frame.locator('[data-achievement-id]')).not.toHaveCount(0);
  await frame.locator('body').evaluate(async () => {
    await window.heymingAchievements?.unlock('pacman:first-action');
  });
  await expect(frame.locator('heyming-achievement-toasts')).toHaveCount(0);
});

test('emits unlock and toast shown/click events on desktop', async ({ page }) => {
  await captureGtag(page);
  await page.setViewportSize({ width: 1280, height: 720 });
  await page.goto('/2048/');
  await page.evaluate(async () => {
    await window.heymingAchievements?.ready;
    await window.heymingAchievements?.unlock('2048:first-action');
  });

  const toast = page.locator('heyming-achievement-toasts').locator('.toast');
  await expect(toast).toBeVisible();

  const afterShow = achievementEvents(await gtagEvents(page), 'achievement_toast_shown');
  expect(afterShow).toHaveLength(1);
  expect(afterShow[0].params.event_label).toBe('2048:first-action');

  const unlocked = achievementEvents(await gtagEvents(page), 'achievement_unlocked');
  expect(unlocked.map((event) => event.params.event_label)).toContain('2048:first-action');

  await toast.evaluate((el) => el.dispatchEvent(new MouseEvent('click', { bubbles: true })));

  const clicks = achievementEvents(await gtagEvents(page), 'achievement_toast_click');
  expect(clicks).toHaveLength(1);
  expect(clicks[0].params.event_label).toBe('2048:first-action');
});

test('shows hover cards and dedupes node inspection analytics', async ({ page }) => {
  await captureGtag(page);
  await page.goto('/achievements/');
  const nodes = page.locator('[data-achievement-id]');
  await expect(nodes.first()).toBeVisible();
  const total = await nodes.count();

  const viewed = achievementEvents(await gtagEvents(page), 'achievement_tree_viewed');
  expect(viewed).toHaveLength(1);
  expect(viewed[0].params.event_label).toBe(`0/${total}`);
  expect(viewed[0].params.value).toBe(0);

  const first = page.locator('[data-achievement-id="2048:first-action"]');
  const second = page.locator('[data-achievement-id="pacman:first-action"]');
  await expect(first).toHaveCount(1);
  await expect(second).toHaveCount(1);

  await first.hover();
  const hoverCard = page.locator('#achievement-hover-card');
  await expect(hoverCard).toBeVisible();
  await expect(page.locator('#hover-card-title')).not.toBeEmpty();

  // Focusing an already-hovered node must not duplicate its inspection event.
  await first.focus();

  await expect
    .poll(
      async () => achievementEvents(await gtagEvents(page), 'achievement_node_inspected').length
    )
    .toBe(1);
  expect(
    achievementEvents(await gtagEvents(page), 'achievement_node_inspected')[0].params.event_label
  ).toBe('2048:first-action');

  await second.hover();
  await expect
    .poll(
      async () => achievementEvents(await gtagEvents(page), 'achievement_node_inspected').length
    )
    .toBe(2);
  expect(
    achievementEvents(await gtagEvents(page), 'achievement_node_inspected').map(
      (event) => event.params.event_label
    )
  ).toEqual(['2048:first-action', 'pacman:first-action']);

  expect(achievementEvents(await gtagEvents(page), 'achievement_tree_viewed')).toHaveLength(1);
});
