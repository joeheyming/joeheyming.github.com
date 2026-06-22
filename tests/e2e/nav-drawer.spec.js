// @ts-check
const { test, expect } = require('@playwright/test');

// Stub `window.gtag` before any page script runs so we can inspect
// what the drawer reports to GA. analytics.js short-circuits its
// data-event capture delegate on localhost, so the drawer always
// fires its events through manual `trackEvent` calls — those still
// land in `gtag`, which our stub captures.
async function captureGtag(page) {
  await page.addInitScript(() => {
    window.__gtagCalls = [];
    Object.defineProperty(window, 'gtag', {
      configurable: true,
      get: () => (...args) => window.__gtagCalls.push(args),
      set: () => {}
    });
  });
}

async function gtagEvents(page) {
  return page.evaluate(() => {
    const calls = window.__gtagCalls || [];
    return calls
      .filter((c) => c[0] === 'event')
      .map((c) => ({ name: c[1], params: c[2] || {} }));
  });
}

test.describe('Nav drawer', () => {
  test('default mode: toggle visible with standard styles on a non-compact page', async ({
    page
  }) => {
    await page.goto('/calculator/');
    const toggle = page.locator('.heyming-nav-toggle');
    await expect(toggle).toBeVisible({ timeout: 10_000 });
    await expect(toggle).toHaveAttribute('aria-expanded', 'false');
    const html = page.locator('html');
    await expect(html).not.toHaveAttribute('data-nav-size');
  });

  test('compact mode: terminal page has data-nav-size="compact" on <html>', async ({ page }) => {
    await page.goto('/terminal/');
    const html = page.locator('html');
    await expect(html).toHaveAttribute('data-nav-size', 'compact', { timeout: 10_000 });
    const toggle = page.locator('.heyming-nav-toggle');
    await expect(toggle).toBeVisible();
  });

  test('compact mode: toggle has reduced opacity', async ({ page }) => {
    await page.goto('/terminal/');
    await page.waitForSelector('.heyming-nav-toggle', { timeout: 10_000 });
    const opacity = await page
      .locator('.heyming-nav-toggle')
      .evaluate((el) => getComputedStyle(el).opacity);
    const val = parseFloat(opacity);
    expect(val).toBeLessThan(1);
    expect(val).toBeGreaterThan(0);
  });

  test('nav_drawer_open fires once with the current page name as label', async ({ page }) => {
    await captureGtag(page);
    await page.goto('/terminal/');
    await page.locator('.heyming-nav-toggle').click();
    await page.waitForSelector('.heyming-nav-drawer.open');

    const events = await gtagEvents(page);
    const opens = events.filter((e) => e.name === 'nav_drawer_open');
    expect(opens).toHaveLength(1);
    expect(opens[0].params.event_category).toBe('Navigation');
    expect(opens[0].params.event_label).toBe('Terminal');
  });

  test('Escape close fires nav_drawer_close with reason="escape"', async ({ page }) => {
    await captureGtag(page);
    await page.goto('/calculator/');
    await page.locator('.heyming-nav-toggle').click();
    await page.waitForSelector('.heyming-nav-drawer.open');
    await page.keyboard.press('Escape');
    await page.waitForFunction(() => !document.querySelector('.heyming-nav-drawer.open'));

    const closes = (await gtagEvents(page)).filter((e) => e.name === 'nav_drawer_close');
    expect(closes).toHaveLength(1);
    expect(closes[0].params.event_label).toBe('escape');
  });

  test('backdrop click fires nav_drawer_close with reason="backdrop"', async ({ page }) => {
    await captureGtag(page);
    await page.goto('/calculator/');
    await page.locator('.heyming-nav-toggle').click();
    await page.waitForSelector('.heyming-nav-drawer.open');
    await page.locator('.heyming-nav-backdrop').click();
    await page.waitForFunction(() => !document.querySelector('.heyming-nav-drawer.open'));

    const closes = (await gtagEvents(page)).filter((e) => e.name === 'nav_drawer_close');
    expect(closes).toHaveLength(1);
    expect(closes[0].params.event_label).toBe('backdrop');
  });

  test('search debounces into a single nav_drawer_search event with result count', async ({
    page
  }) => {
    await captureGtag(page);
    await page.goto('/calculator/');
    await page.locator('.heyming-nav-toggle').click();
    await page.waitForSelector('.heyming-nav-search-input');
    await page.locator('.heyming-nav-search-input').fill('cal');
    // Debounce is 700ms; wait a beat past that.
    await page.waitForTimeout(1000);

    const searches = (await gtagEvents(page)).filter((e) => e.name === 'nav_drawer_search');
    expect(searches).toHaveLength(1);
    expect(searches[0].params.event_category).toBe('Navigation');
    expect(parseInt(searches[0].params.event_label, 10)).toBeGreaterThan(0);
    expect(searches[0].params.value).toBe(3);
  });

  test('not shown on /os/ path', async ({ page }) => {
    await page.goto('/os/');
    await page.waitForTimeout(2000);
    const count = await page.locator('.heyming-nav-toggle').count();
    expect(count).toBe(0);
  });

  test('clicking toggle opens drawer; toggle hides; close button closes it', async ({ page }) => {
    await page.goto('/calculator/');
    const toggle = page.locator('.heyming-nav-toggle');
    const drawer = page.locator('.heyming-nav-drawer');
    await expect(toggle).toBeVisible({ timeout: 10_000 });
    await expect(drawer).not.toHaveClass(/\bopen\b/);

    await toggle.click();
    await expect(drawer).toHaveClass(/\bopen\b/);
    await expect(toggle).toBeHidden();

    await page.locator('.heyming-nav-close').click();
    await expect(drawer).not.toHaveClass(/\bopen\b/);
    await expect(toggle).toBeVisible();
  });

  test('Escape closes the drawer', async ({ page }) => {
    await page.goto('/calculator/');
    await page.locator('.heyming-nav-toggle').click();
    const drawer = page.locator('.heyming-nav-drawer');
    await expect(drawer).toHaveClass(/\bopen\b/);

    await page.keyboard.press('Escape');
    await expect(drawer).not.toHaveClass(/\bopen\b/);
  });

  test('drawer lists Home and Heyming OS shortcuts at the top', async ({ page }) => {
    await page.goto('/calculator/');
    await page.locator('.heyming-nav-toggle').click();

    const home = page.locator('.heyming-nav-system a[href="/"]');
    const os = page.locator('.heyming-nav-system a[href="/os/"]');
    await expect(home).toBeVisible();
    await expect(os).toBeVisible();
  });

  test('current app is highlighted with is-active', async ({ page }) => {
    await page.goto('/calculator/');
    await page.locator('.heyming-nav-toggle').click();
    const active = page.locator('.heyming-nav-item.is-active');
    await expect(active).toHaveAttribute('aria-current', 'page');
    await expect(active).toContainText(/Calculator/i);
  });

  test('ArrowDown from search focuses the first nav item; ArrowUp returns to search', async ({
    page
  }) => {
    await page.goto('/calculator/');
    await page.locator('.heyming-nav-toggle').click();
    const search = page.locator('.heyming-nav-search-input');
    await expect(search).toBeFocused();

    // Wait for the registry-driven sections to populate so the focus
    // ring includes more than just the static system rows.
    await page.waitForSelector('.heyming-nav-sections .heyming-nav-item');

    await page.keyboard.press('ArrowDown');
    const firstItemHref = await page.evaluate(() => {
      const all = document.querySelectorAll(
        '.heyming-nav-system .heyming-nav-item, .heyming-nav-sections .heyming-nav-item'
      );
      return all[0] && all[0].getAttribute('href');
    });
    const focusedHref = await page.evaluate(() => document.activeElement.getAttribute('href'));
    expect(focusedHref).toBe(firstItemHref);

    await page.keyboard.press('ArrowUp');
    await expect(search).toBeFocused();
  });

  test('ArrowDown wraps from the last visible item back to the search input', async ({ page }) => {
    await page.goto('/calculator/');
    await page.locator('.heyming-nav-toggle').click();
    await page.waitForSelector('.heyming-nav-sections .heyming-nav-item');

    await page.evaluate(() => {
      const items = document.querySelectorAll(
        '.heyming-nav-system .heyming-nav-item, .heyming-nav-sections .heyming-nav-item'
      );
      const last = items[items.length - 1];
      last.focus();
    });
    await page.keyboard.press('ArrowDown');
    await expect(page.locator('.heyming-nav-search-input')).toBeFocused();
  });

  test('Home jumps to the first nav item, End to the last', async ({ page }) => {
    await page.goto('/calculator/');
    await page.locator('.heyming-nav-toggle').click();
    await expect(page.locator('.heyming-nav-search-input')).toBeFocused();
    await page.waitForSelector('.heyming-nav-sections .heyming-nav-item');

    await page.keyboard.press('End');
    const endHref = await page.evaluate(() => document.activeElement.getAttribute('href'));
    const lastHref = await page.evaluate(() => {
      const all = document.querySelectorAll(
        '.heyming-nav-system .heyming-nav-item, .heyming-nav-sections .heyming-nav-item'
      );
      return all[all.length - 1].getAttribute('href');
    });
    expect(endHref).toBe(lastHref);

    await page.keyboard.press('Home');
    const homeHref = await page.evaluate(() => document.activeElement.getAttribute('href'));
    const firstHref = await page.evaluate(() => {
      const all = document.querySelectorAll(
        '.heyming-nav-system .heyming-nav-item, .heyming-nav-sections .heyming-nav-item'
      );
      return all[0].getAttribute('href');
    });
    expect(homeHref).toBe(firstHref);
  });

  test('arrow keys skip rows hidden by the search filter', async ({ page }) => {
    await page.goto('/calculator/');
    await page.locator('.heyming-nav-toggle').click();
    await expect(page.locator('.heyming-nav-search-input')).toBeFocused();
    await page.waitForSelector('.heyming-nav-sections .heyming-nav-item');

    // Filter to "calc" so only one or two rows remain (Calculator + maybe Calendar).
    await page.locator('.heyming-nav-search-input').fill('calc');
    await page.waitForTimeout(50);

    await page.keyboard.press('ArrowDown');
    const focusedDisplay = await page.evaluate(() => {
      const el = document.activeElement;
      return el && el.style ? el.style.display : null;
    });
    // Whatever item we landed on must be visible (display !== 'none').
    expect(focusedDisplay).not.toBe('none');
    // And it must be a nav item.
    const focusedClass = await page.evaluate(() => document.activeElement.className);
    expect(focusedClass).toContain('heyming-nav-item');
  });
});
