// @ts-check
//
// End-to-end smoke for the unified DOOM runner at /doom/.
//
// What we ACTUALLY test:
//   1. lifecycle.js loads and exposes `window.UZDoomLifecycle`
//   2. touch-input.js loads and exposes `window.UZDoomTouchInput`
//   3. The default URL shows the three-card flavor picker (body.picker-mode)
//   4. `?flavor=legend` auto-primes Freedoom + the Legend-of-DOOM pk3 and
//      the hero reads "Launch Legend of DOOM"
//   5. `?flavor=freedoom` auto-primes bundled Freedoom and the hero
//      reads "Launch Freedoom"
//   6. `?flavor=classic` sets the page title and body class (the actual
//      doom.wad fetch hits a remote CDN — body class + branding only)
//   7. `?manual=1` shows the full picker UI (and does NOT auto-prime)
//   8. The inline picker dropdown lists 3 flavors + a Manual option,
//      and Manual navigates to ?manual=1
//
// What we DON'T test here:
//   - Actual engine boot (launching → playing). Requires cross-origin
//     isolation, which needs the coi-serviceworker to reload the page
//     and inject COOP/COEP headers. Cold-starts are 10-30s, making the
//     test flaky on CI.
//   - Touch event synthesis / mobile UI. The SwipeController unit tests
//     cover the state machine; the visual layer is hard to assert on
//     desktop Playwright. Manual testing on a real phone covers it.
//   - COI error surfacing. Manual-only; exercising requires deliberately
//     breaking the service worker.

const { test, expect } = require('@playwright/test');

test.describe('DOOM page (unified)', () => {
  test('loads lifecycle + touch-input modules', async ({ page }) => {
    await page.goto('/doom/');

    // Wait for deferred scripts to run. lifecycle.js is first in
    // document order so once it's on window, coi.js and touch-input.js
    // will be too (they're in the same <script defer> batch).
    await page.waitForFunction(() => !!window.UZDoomLifecycle, null, { timeout: 10_000 });

    const apis = await page.evaluate(() => ({
      lifecycle: typeof window.UZDoomLifecycle,
      coi: typeof window.UZDoomCOI,
      touch: typeof window.UZDoomTouchInput,
      phases: window.UZDoomLifecycle?.PHASES,
      createSwipe: typeof window.UZDoomTouchInput?.createSwipeController
    }));

    expect(apis.lifecycle).toBe('object');
    expect(apis.coi).toBe('object');
    expect(apis.touch).toBe('object');
    expect(apis.createSwipe).toBe('function');
    expect(apis.phases).toEqual(['loading', 'primed', 'launching', 'playing', 'exited', 'error']);
  });

  test('default URL shows flavor picker (body.picker-mode)', async ({ page }) => {
    await page.goto('/doom/');

    await page.waitForFunction(() => !!window.UZDoomLifecycle, null, { timeout: 10_000 });

    const bodyClass = await page.evaluate(() => document.body.className);
    expect(bodyClass).toContain('picker-mode');
    expect(bodyClass).not.toContain('clean');

    // All three flavor cards are present in the DOM.
    await expect(page.locator('.flavor-card[data-flavor="classic"]')).toBeVisible();
    await expect(page.locator('.flavor-card[data-flavor="freedoom"]')).toBeVisible();
    await expect(page.locator('.flavor-card[data-flavor="legend"]')).toBeVisible();

    // Hero (single Launch button) is hidden in picker mode.
    await expect(page.locator('#cleanHero')).toBeHidden();

    // Inline picker switcher IS visible in picker mode (it replaces the
    // old "Use custom IWAD / mods…" link).
    await expect(page.locator('#flavorPickerSwitcher')).toBeVisible();
  });

  test('?flavor=legend auto-primes and the hero button reads "Launch Legend of DOOM"', async ({
    page
  }) => {
    await page.goto('/doom/?flavor=legend');

    const bodyClass = await page.evaluate(() => document.body.className);
    expect(bodyClass).toContain('clean');
    expect(bodyClass).toContain('flavor-legend');

    // The primer fetches the LoD pk3 (~8 MB) and calls primeWith.
    await page.waitForFunction(
      () => window.UZDoomLifecycle && window.UZDoomLifecycle.get() === 'primed',
      null,
      { timeout: 30_000 }
    );

    const btn = page.locator('#cleanLaunchBtn');
    await expect(btn).toHaveText('Launch Legend of DOOM');
    await expect(btn).toBeEnabled();

    // Regression guard for the "inline switcher leaks into clean mode"
    // bug seen on mobile: in ?flavor=NAME mode the inline picker
    // dropdown must NOT be visible (only the hero + Launch button is).
    await expect(page.locator('#flavorPickerSwitcher')).toBeHidden();
  });

  test('?flavor=freedoom auto-primes with no mods and hero reads "Launch Freedoom"', async ({
    page
  }) => {
    await page.goto('/doom/?flavor=freedoom');

    const bodyClass = await page.evaluate(() => document.body.className);
    expect(bodyClass).toContain('clean');
    expect(bodyClass).toContain('flavor-freedoom');

    await page.waitForFunction(
      () => window.UZDoomLifecycle && window.UZDoomLifecycle.get() === 'primed',
      null,
      { timeout: 30_000 }
    );

    const btn = page.locator('#cleanLaunchBtn');
    await expect(btn).toHaveText('Launch Freedoom');
    await expect(btn).toBeEnabled();
  });

  test('?flavor=classic body class is set (skip prime — depends on remote CDN)', async ({
    page
  }) => {
    await page.goto('/doom/?flavor=classic');

    const bodyClass = await page.evaluate(() => document.body.className);
    expect(bodyClass).toContain('clean');
    expect(bodyClass).toContain('flavor-classic');

    // The classic flavor fetches doom.wad from the Netlify CDN. We
    // don't gate the test on `primed` because hitting the live CDN
    // from CI would be flaky; the non-network plumbing (body class,
    // FLAVORS map, branding) is what we exercise here.
    await page.waitForFunction(() => document.title.indexOf('Classic DOOM') !== -1, null, {
      timeout: 10_000
    });
  });

  test('manual mode (?manual=1) skips priming and shows the picker UI', async ({ page }) => {
    await page.goto('/doom/?manual=1');

    await page.waitForFunction(() => !!window.UZDoomLifecycle, null, { timeout: 10_000 });
    await page.waitForTimeout(1000);

    const bodyClass = await page.evaluate(() => document.body.className);
    expect(bodyClass).not.toContain('clean');
    expect(bodyClass).not.toContain('picker-mode');

    await expect(page.locator('#iwadPicker')).toBeVisible();
    await expect(page.locator('#launchBtn')).toBeVisible();
    await expect(page.locator('#launchBtn')).toBeDisabled();

    const phase = await page.evaluate(() => window.UZDoomLifecycle.get());
    expect(phase).toBe('loading');

    // Inline picker switcher is hidden in manual mode too — it only
    // surfaces in picker mode (default URL).
    await expect(page.locator('#flavorPickerSwitcher')).toBeHidden();
  });

  test('flavor switcher: hidden until playing, menu shows three flavors with active item disabled', async ({
    page
  }) => {
    await page.goto('/doom/?flavor=freedoom');

    // Switcher exists in the DOM and starts hidden.
    const switcher = page.locator('#flavorSwitcher');
    await expect(switcher).toBeHidden();

    // Force lifecycle to `playing` so we can assert the reveal logic
    // without depending on the wasm engine actually drawing a frame
    // (which needs COI service-worker dance and is slow on CI).
    await page.waitForFunction(() => !!window.UZDoomLifecycle, null, { timeout: 10_000 });
    await page.evaluate(() => {
      // Walk the lifecycle through valid transitions: loading → primed
      // → launching → playing. Skipping a state is rejected by the FSM.
      window.UZDoomLifecycle.markPrimed({ iwad: 'test' });
      window.UZDoomLifecycle.markLaunching();
      window.UZDoomLifecycle.markPlaying();
      // Loader normally hides the boot overlay on its own playing-path;
      // we never actually launched the engine here, so do it manually
      // so the overlay doesn't intercept clicks on the switcher.
      const b = document.getElementById('boot');
      if (b) b.classList.add('hidden');
    });

    await expect(switcher).toBeVisible();

    // Open the menu and check items.
    await page.locator('#flavorSwitchBtn').click();
    const menu = page.locator('#flavorSwitchMenu');
    await expect(menu).toBeVisible();
    await expect(menu.locator('button[data-switch="classic"]')).toBeEnabled();
    await expect(menu.locator('button[data-switch="legend"]')).toBeEnabled();
    // The active flavor is freedoom — it should be the one disabled.
    await expect(menu.locator('button[data-switch="freedoom"]')).toBeDisabled();
    await expect(menu.locator('button[data-switch="freedoom"]')).toHaveAttribute(
      'data-active',
      'true'
    );
  });

  test('inline picker dropdown: lists three flavors + Manual, Manual navigates to ?manual=1', async ({
    page
  }) => {
    await page.goto('/doom/');

    await page.waitForFunction(() => !!window.UZDoomLifecycle, null, { timeout: 10_000 });

    // Inline switcher is visible on the picker page.
    const inline = page.locator('#flavorPickerSwitcher');
    await expect(inline).toBeVisible();

    // Open it.
    await inline.locator('.flavor-switch-btn').click();
    const menu = inline.locator('.flavor-switch-menu');
    await expect(menu).toBeVisible();

    // Three flavors + Manual.
    await expect(menu.locator('button[data-switch="classic"]')).toBeVisible();
    await expect(menu.locator('button[data-switch="freedoom"]')).toBeVisible();
    await expect(menu.locator('button[data-switch="legend"]')).toBeVisible();
    await expect(menu.locator('button[data-switch="manual"]')).toBeVisible();

    // Click Manual → page reloads with ?manual=1; the manual UI takes
    // over (no picker-mode body class, full picker visible).
    await menu.locator('button[data-switch="manual"]').click();
    await page.waitForURL(/manual=1/);
    await page.waitForFunction(() => !!window.UZDoomLifecycle, null, { timeout: 10_000 });
    const bodyClass = await page.evaluate(() => document.body.className);
    expect(bodyClass).not.toContain('picker-mode');
    expect(bodyClass).not.toContain('clean');
    await expect(page.locator('#iwadPicker')).toBeVisible();
  });

  test('UZDoomLoader public API is available after loader script runs', async ({ page }) => {
    await page.goto('/doom/?flavor=legend');

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
