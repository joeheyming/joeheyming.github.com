// @ts-check
//
// End-to-end smoke for the Legend of DOOM runner.
//
// What we ACTUALLY test:
//   1. lifecycle.js loads and exposes `window.LoDLifecycle`
//   2. touch-input.js loads and exposes `window.LoDTouchInput`
//   3. The clean-mode priming path reaches `primed` within 30s
//   4. The hero button transitions from "Preparing..." → "Launch Legend of DOOM"
//   5. `?manual=1` bypass shows the picker UI (and does NOT auto-prime)
//
// What we DON\'T test here:
//   - Actual engine boot (launching → playing). Requires cross-origin
//     isolation, which needs the coi-serviceworker to reload the page
//     and inject COOP/COEP headers. Playwright + http-server handles
//     that correctly but cold-starts are 10-30s, making the test flaky
//     on CI. Covered by the existing /tmp/uzdoom-compat.js harness.
//   - Touch event synthesis / mobile UI. The SwipeController unit tests
//     cover the state machine; the visual layer is hard to assert on
//     desktop Playwright. Manual testing on a real phone covers it.
//   - COI error surfacing. Manual-only; exercising requires deliberately
//     breaking the service worker.

const { test, expect } = require('@playwright/test');

test.describe('Legend of DOOM page', () => {
  test('loads lifecycle + touch-input modules', async ({ page }) => {
    await page.goto('/legend-of-doom/');

    // Wait for deferred scripts to run. lifecycle.js is first in
    // document order so once it\'s on window, coi.js and touch-input.js
    // will be too (they\'re in the same <script defer> batch).
    await page.waitForFunction(() => !!window.LoDLifecycle, null, { timeout: 10_000 });

    const apis = await page.evaluate(() => ({
      lifecycle: typeof window.LoDLifecycle,
      coi: typeof window.LoDCOI,
      touch: typeof window.LoDTouchInput,
      phases: window.LoDLifecycle?.PHASES,
      createSwipe: typeof window.LoDTouchInput?.createSwipeController
    }));

    expect(apis.lifecycle).toBe('object');
    expect(apis.coi).toBe('object');
    expect(apis.touch).toBe('object');
    expect(apis.createSwipe).toBe('function');
    expect(apis.phases).toEqual(['loading', 'primed', 'launching', 'playing', 'exited', 'error']);
  });

  test('clean mode primes to `primed` phase and enables the hero button', async ({ page }) => {
    await page.goto('/legend-of-doom/');

    // The primer fetches the LoD pk3 (~18 MB) and calls primeWith.
    // Network-bound, but local http-server is fast. 30s is generous.
    await page.waitForFunction(
      () => window.LoDLifecycle && window.LoDLifecycle.get() === 'primed',
      null,
      { timeout: 30_000 }
    );

    const phase = await page.evaluate(() => window.LoDLifecycle.get());
    expect(phase).toBe('primed');

    const btn = page.locator('#cleanLaunchBtn');
    await expect(btn).toHaveText('Launch Legend of DOOM');
    await expect(btn).toBeEnabled();

    // Lifecycle history contains the transition we expect.
    const history = await page.evaluate(() => window.LoDLifecycle.history().map((e) => e.phase));
    expect(history).toContain('loading');
    expect(history).toContain('primed');
  });

  test('manual mode (?manual=1) skips priming and shows the picker UI', async ({ page }) => {
    await page.goto('/legend-of-doom/?manual=1');

    // Wait just long enough to be confident no priming is running.
    await page.waitForFunction(() => !!window.LoDLifecycle, null, { timeout: 10_000 });
    await page.waitForTimeout(1000);

    // Body should NOT have the `.clean` class in manual mode.
    const bodyClass = await page.evaluate(() => document.body.className);
    expect(bodyClass).not.toContain('clean');

    // Picker UI is visible: iwad picker + launch button (initially
    // disabled until the user picks something).
    await expect(page.locator('#iwadPicker')).toBeVisible();
    await expect(page.locator('#launchBtn')).toBeVisible();
    await expect(page.locator('#launchBtn')).toBeDisabled();

    // Lifecycle is still `loading` since nothing was primed.
    const phase = await page.evaluate(() => window.LoDLifecycle.get());
    expect(phase).toBe('loading');
  });

  test('UZDoomLoader public API is available after loader script runs', async ({ page }) => {
    await page.goto('/legend-of-doom/');

    // UZDoomLoader is attached by uzdoom-loader.js, which is injected
    // after COI is ready. Allow the full COI dance + script load.
    await page.waitForFunction(() => !!window.UZDoomLoader, null, { timeout: 30_000 });

    const api = await page.evaluate(() => ({
      primeWith: typeof window.UZDoomLoader.primeWith,
      launch: typeof window.UZDoomLoader.launch,
      isPrimed: typeof window.UZDoomLoader.isPrimed,
      state: typeof window.UZDoomLoader.state
    }));

    expect(api.primeWith).toBe('function');
    expect(api.launch).toBe('function');
    expect(api.isPrimed).toBe('function');
    expect(api.state).toBe('function');
  });
});
