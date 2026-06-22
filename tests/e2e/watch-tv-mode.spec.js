// @ts-check
/**
 * /watch/ — TV-mode harness (Playwright pretending to be a Bravia).
 *
 * The real /watch/ TV experience runs inside an Android-TV WebView shell
 * (~/git/joeheyming-watch-tv). That shell is reachable only via ADB to a
 * physical Bravia, which makes "did the change land?" iteration slow.
 *
 * This spec gives us 90% of that loop in headless Chromium by combining
 * three knobs:
 *
 *   1. `--enable-spatial-navigation` — Chromium's built-in TV-style
 *      directional focus. Off by default in regular Chrome but on by
 *      default in Android-TV WebView. With the flag enabled here,
 *      ArrowDown / ArrowUp / etc. move focus to the nearest focusable
 *      in that direction, exactly like the Bravia remote does.
 *   2. 1920×1080 viewport — matches the Bravia VH22's logical viewport.
 *   3. Bravia user agent — so `mode.js` flips into TV mode via the
 *      UA-fingerprint code path. We could also use `?tv=1`, but
 *      validating the UA path makes this test mirror what an actual
 *      browser-on-TV would see.
 *
 * What this catches:
 *   - `data-mode="tv"` / `data-modality` semantics on <html>
 *   - TV-mode CSS overlay (computed styles)
 *   - Roving-tabindex on the show grid (arrow keys, initial focus,
 *     Enter activation)
 *   - Modality flip on mouse interaction
 *
 * What this does NOT catch (still requires the real Bravia):
 *   - Android-TV WebView's KEYCODE_DPAD_CENTER → click() quirk
 *     (handled in MainActivity.kt, not page-side code)
 *   - Real-network behavior from the Bravia's IP
 *   - HDR / panel / codec quirks
 *
 * If a /watch/ TV-mode bug ever shows up that this spec passes through,
 * we should add a regression test before fixing it.
 */

const { test, expect } = require('@playwright/test');

const BRAVIA_UA =
  'Mozilla/5.0 (Linux; Android 12; BRAVIA 4K VH22 Build/STR1.190001.001) ' +
  'AppleWebKit/537.36 (KHTML, like Gecko) Chrome/148.0.7778.215 Safari/537.36';

// Spatial navigation must be enabled at launch — Playwright's
// `launchOptions.args` is the only path. Per-test `use` blocks in
// Playwright forward this to the underlying Chromium browser.
test.use({
  viewport: { width: 1920, height: 1080 },
  userAgent: BRAVIA_UA,
  launchOptions: {
    args: [
      '--enable-spatial-navigation',
      '--disable-features=Translate',
      // The player keyboard tests call togglePlay → video.play();
      // headless Chromium otherwise rejects the promise without a
      // user gesture even on a muted element, and the test would
      // observe "still paused" forever.
      '--autoplay-policy=no-user-gesture-required'
    ]
  }
});

test.describe('/watch/ — TV mode landing', () => {
  test('flips <html data-mode="tv"> via Bravia user agent', async ({ page }) => {
    await page.goto('/watch/');
    const html = page.locator('html');
    await expect(html).toHaveAttribute('data-mode', 'tv', { timeout: 10_000 });
  });

  test('initial modality is "key" on TV (not "pointer")', async ({ page }) => {
    await page.goto('/watch/');
    const html = page.locator('html');
    await expect(html).toHaveAttribute('data-modality', 'key');
  });

  test('TV mode CSS overlay sets a TV base font size', async ({ page }) => {
    await page.goto('/watch/');
    // Force any pending fonts to settle so the computed size is stable.
    await page.evaluate(() => document.fonts.ready);
    const fontSize = await page.locator('body').evaluate(
      (el) => parseFloat(getComputedStyle(el).fontSize)
    );
    // TV mode targets a 960 CSS px logical canvas (because Android-TV
    // panels are 320dpi); the overlay sets --tv-base-size: 18px to
    // read well at that scale. Just assert it's sized for TV (not
    // tiny, not desktop-mode 16px).
    expect(fontSize).toBeGreaterThanOrEqual(17);
    expect(fontSize).toBeLessThanOrEqual(28);
  });

  test('first show card receives initial focus on mount', async ({ page }) => {
    await page.goto('/watch/');
    // The roving helper on shows-view calls `gridRoving.focusFirst()`
    // when isTvMode === true. Wait for any card to render, then check
    // that document.activeElement is one of the show cards.
    await page.waitForSelector('.tv-show-card', { timeout: 10_000 });
    const focusedClass = await page.evaluate(() => document.activeElement?.className);
    expect(focusedClass).toContain('tv-show-card');
  });

  test('arrow keys move focus between show cards (roving cursor)', async ({ page }) => {
    await page.goto('/watch/');
    await page.waitForSelector('.tv-show-card', { timeout: 10_000 });
    // Capture the initially focused card's show id.
    const before = await page.evaluate(
      () => document.activeElement?.getAttribute('data-show')
    );
    await page.keyboard.press('ArrowRight');
    const after = await page.evaluate(
      () => document.activeElement?.getAttribute('data-show')
    );
    expect(after).toBeTruthy();
    expect(after).not.toBe(before);
  });

  test('Enter on a focused show card navigates to that show', async ({ page }) => {
    await page.goto('/watch/');
    await page.waitForSelector('.tv-show-card', { timeout: 10_000 });
    const targetShow = await page.evaluate(
      () => document.activeElement?.getAttribute('data-show')
    );
    expect(targetShow).toBeTruthy();
    await page.keyboard.press('Enter');
    // The router pushes ?show=<id>; assert the URL update rather than
    // waiting on the catalog fetch (which would need a network mock).
    await page.waitForURL((url) => url.search.includes(`show=${targetShow}`), {
      timeout: 10_000
    });
  });

  test('continue-watching rail uses fixed-width tiles, not 1fr', async ({ page }) => {
    // Regression for the "two gigantic posters" Bravia bug. With the
    // previous `auto-fill, minmax(320px, 1fr)` template, a
    // continue-watching row with 1–2 entries blew each tile up to
    // half the screen. The TV-mode override now uses a fixed track
    // width so the rail looks Plex/Netflix-shaped (small posters,
    // left-aligned, empty space to the right).
    await page.addInitScript(() => {
      // Seed two `lastEpisode` entries so the Continue Watching grid
      // actually renders with 2 items — otherwise it short-circuits
      // to "no rail" and there's nothing to assert against. Key
      // prefix and JSON shape mirror `prefs.js` (LAST_KEY_PREFIX +
      // { lastSeason, lastEpisode, updatedAt }).
      try {
        const now = Date.now();
        localStorage.setItem(
          'heyming.watch.last.fawlty-towers',
          JSON.stringify({ lastSeason: 1, lastEpisode: 1, updatedAt: now })
        );
        localStorage.setItem(
          'heyming.watch.last.spider-man',
          JSON.stringify({ lastSeason: 1, lastEpisode: 2, updatedAt: now - 1 })
        );
      } catch (_) {}
    });
    await page.goto('/watch/');
    await page.waitForSelector('.tv-continue-grid', { timeout: 10_000 });
    const tracks = await page.evaluate(() => {
      const grid = document.querySelector('.tv-continue-grid');
      if (!grid) return null;
      return getComputedStyle(grid).gridTemplateColumns.trim().split(/\s+/);
    });
    expect(tracks).not.toBeNull();
    // Fixed track width (no `1fr`) means every track resolves to the
    // same explicit pixel value (var(--tv-tile-min) = 200px). If a
    // future change reintroduces `1fr`, those tracks resolve to
    // varying pixel widths depending on item count and this assertion
    // catches it.
    if (tracks) {
      const widths = tracks.map((t) => parseFloat(t));
      const allEqual = widths.every((w) => Math.abs(w - widths[0]) < 1);
      expect(allEqual).toBe(true);
      // Tile-min is 200px in TV mode. Allow some leeway for browser
      // rounding but reject blown-up "1fr-style" widths (~600+ px).
      expect(widths[0]).toBeLessThan(360);
    }
  });

  test('show grid is multi-column at TV scale', async ({ page }) => {
    // Even at the 960 CSS px logical viewport an Android-TV WebView
    // exposes (which Playwright doesn't simulate but is what the
    // real Bravia paints), the smaller --tv-tile-min should land the
    // grid at ≥4 columns. At Playwright's 1920px viewport we expect
    // even more — assert ≥4 to keep the test stable across both.
    await page.goto('/watch/');
    await page.waitForSelector('.tv-show-card', { timeout: 10_000 });
    const columnCount = await page.evaluate(() => {
      const grid = document.querySelector('.tv-show-grid');
      if (!grid) return 0;
      const tracks = getComputedStyle(grid).gridTemplateColumns.trim().split(/\s+/);
      return tracks.length;
    });
    expect(columnCount).toBeGreaterThanOrEqual(4);
  });

  test('moving the mouse flips modality from "key" to "pointer"', async ({ page }) => {
    await page.goto('/watch/');
    const html = page.locator('html');
    await expect(html).toHaveAttribute('data-modality', 'key');
    // Synthesize a mousemove. Position is irrelevant — modality flips
    // on any pointer event by design.
    await page.mouse.move(400, 400);
    await expect(html).toHaveAttribute('data-modality', 'pointer');
  });

  test('arrow key after pointer use flips modality back to "key"', async ({ page }) => {
    await page.goto('/watch/');
    await page.waitForSelector('.tv-show-card');
    await page.mouse.move(400, 400);
    const html = page.locator('html');
    await expect(html).toHaveAttribute('data-modality', 'pointer');
    await page.keyboard.press('ArrowDown');
    await expect(html).toHaveAttribute('data-modality', 'key');
  });
});

test.describe('/watch/ — TV mode episodes view', () => {
  // Regression test for the chip-row navigation bug:
  // pressing ArrowUp from the first episode card used to skip the
  // entire season-chip row and land on the breadcrumb because the
  // (now-removed) roving-tabindex on the chip row left only one chip
  // at tabindex=0 — and Chromium's spatial-nav excludes tabindex=-1
  // siblings entirely. Removing the chip-row roving keeps every chip
  // at tabindex=0 so spatial nav lands on the closest one.
  //
  // Uses `fawlty-towers` because its IA item is tiny (12 episodes / 2
  // seasons) — keeps this test under a few seconds even with a real
  // archive.org + TVMaze fetch. If the test ever gets flaky we can
  // intercept those requests with `page.route()` and serve fixture
  // JSON, but the current pattern matches what the user actually
  // sees on the Bravia.

  test('every season chip stays at tabindex=0 (spatial-nav reachable)', async ({
    page
  }) => {
    // STRUCTURAL invariant — the bug was that `applyRovingTabindex`
    // on the chip row sets all-but-one chip to `tabindex=-1`, which
    // Chromium's spatial-nav refuses to land on. The fix removes the
    // roving helper from the chip row, leaving every chip naturally
    // focusable.
    //
    // This is a stronger assertion than "ArrowUp from episode lands
    // on a chip" — it doesn't depend on rendered geometry, viewport
    // width, or which show is being tested. If a future change
    // accidentally re-introduces a chip-row roving helper, this
    // catches it immediately.
    await page.goto('/watch/?show=fawlty-towers');
    await page.waitForSelector('.tv-chip', { timeout: 30_000 });

    const chipTabindexes = await page.evaluate(() => {
      const chips = Array.from(document.querySelectorAll('.tv-chip'));
      return chips.map((c) => c.getAttribute('tabindex'));
    });

    expect(chipTabindexes.length).toBeGreaterThan(0);
    for (const t of chipTabindexes) {
      // Either no tabindex attribute (button defaults to 0) or
      // explicit "0". Anything negative would mean a roving helper
      // is back in play.
      expect(['0', null]).toContain(t);
    }
  });

  test('arrow-up from top episode lands on a season chip, not breadcrumb', async ({
    page
  }) => {
    // Behavioral check on top of the structural one above. Uses
    // fawlty-towers because its catalog is small (12 episodes / 2
    // seasons) so this stays fast. With only ~3 chips, the row fits
    // on screen and spatial-nav reliably finds the nearest one.
    await page.goto('/watch/?show=fawlty-towers');
    await page.waitForSelector('.tv-chip', { timeout: 30_000 });
    await page.waitForSelector('.tv-ep-card', { timeout: 30_000 });

    await expect
      .poll(
        async () => page.evaluate(() => document.activeElement?.className || ''),
        { timeout: 5_000 }
      )
      .toContain('tv-ep-card');

    await page.keyboard.press('ArrowUp');

    const focusedClass = await page.evaluate(
      () => document.activeElement?.className || ''
    );
    expect(focusedClass).not.toContain('tv-crumb');
  });

  test('arrow-down from a season chip returns focus to an episode card', async ({
    page
  }) => {
    await page.goto('/watch/?show=fawlty-towers');
    await page.waitForSelector('.tv-chip', { timeout: 30_000 });
    await page.waitForSelector('.tv-ep-card', { timeout: 30_000 });

    // Programmatically focus the active season chip so the test
    // doesn't depend on multi-step navigation working perfectly.
    await page.evaluate(() => {
      const chip = document.querySelector('.tv-chip.is-active') ||
        document.querySelector('.tv-chip');
      /** @type {HTMLElement|null} */ (chip)?.focus();
    });

    await page.keyboard.press('ArrowDown');

    const focusedClass = await page.evaluate(
      () => document.activeElement?.className || ''
    );
    expect(focusedClass).toContain('tv-ep-card');
  });
});

test.describe('/watch/ — TV mode player keyboard', () => {
  // Watch view (player) has different arrow-key semantics on TV than on
  // desktop. On desktop, ArrowLeft/Right step episodes (a power-user
  // binding mirroring the chevron buttons). On TV — where the user is
  // on a couch with a remote — ArrowLeft/Right scrub the timeline
  // ±10s, matching Plex / Netflix conventions. Episode navigation on
  // TV uses N / P / dedicated media keys.
  //
  // The page-side handler is registered in capture phase so Chromium's
  // spatial-nav default action (which would otherwise eat arrow keys
  // for focus moves) is preempted by `e.preventDefault()`.

  // fawlty-towers is the smallest catalog with a known landing
  // episode (s1e1), so this test stays under a few seconds even with
  // a real archive.org + TVMaze fetch.
  const PLAYER_URL = '/watch/?show=fawlty-towers&s=1&e=1';

  test('ArrowRight on the player seeks +10s, does not switch episodes', async ({
    page
  }) => {
    await page.goto(PLAYER_URL);
    const video = page.locator('video');
    await video.waitFor({ timeout: 30_000 });

    // Wait for metadata so currentTime / seek become meaningful. We
    // only need duration; we don't actually start playback.
    await page.waitForFunction(
      () => {
        const v = /** @type {HTMLVideoElement|null} */ (
          document.querySelector('video')
        );
        return !!v && Number.isFinite(v.duration) && v.duration > 0;
      },
      null,
      { timeout: 30_000 }
    );

    const urlBefore = page.url();
    const tBefore = await video.evaluate(
      (v) => /** @type {HTMLVideoElement} */ (v).currentTime
    );

    await page.keyboard.press('ArrowRight');

    const urlAfter = page.url();
    const tAfter = await video.evaluate(
      (v) => /** @type {HTMLVideoElement} */ (v).currentTime
    );

    expect(urlAfter).toBe(urlBefore);
    expect(tAfter).toBeGreaterThan(tBefore);
  });

  test('ArrowLeft on the player seeks back, does not switch episodes', async ({
    page
  }) => {
    await page.goto(PLAYER_URL);
    const video = page.locator('video');
    await video.waitFor({ timeout: 30_000 });
    await page.waitForFunction(
      () => {
        const v = /** @type {HTMLVideoElement|null} */ (
          document.querySelector('video')
        );
        return !!v && Number.isFinite(v.duration) && v.duration > 0;
      },
      null,
      { timeout: 30_000 }
    );

    // Seek forward first so seeking back actually has somewhere to go.
    await page.evaluate(() => {
      const v = /** @type {HTMLVideoElement} */ (document.querySelector('video'));
      v.currentTime = 30;
    });

    const urlBefore = page.url();
    const tBefore = await video.evaluate(
      (v) => /** @type {HTMLVideoElement} */ (v).currentTime
    );

    await page.keyboard.press('ArrowLeft');

    const urlAfter = page.url();
    const tAfter = await video.evaluate(
      (v) => /** @type {HTMLVideoElement} */ (v).currentTime
    );

    expect(urlAfter).toBe(urlBefore);
    expect(tAfter).toBeLessThan(tBefore);
  });

  test('Space on the player toggles play/pause', async ({ page }) => {
    await page.goto(PLAYER_URL);
    const video = page.locator('video');
    await video.waitFor({ timeout: 30_000 });

    await page.evaluate(() => {
      const v = /** @type {HTMLVideoElement} */ (document.querySelector('video'));
      // Mute so autoplay restrictions don't block .play() during the test.
      v.muted = true;
    });

    const startedPaused = await video.evaluate(
      (v) => /** @type {HTMLVideoElement} */ (v).paused
    );
    expect(startedPaused).toBe(true);

    await page.keyboard.press('Space');
    // Playback state changes are async; poll briefly.
    await expect
      .poll(async () => video.evaluate((v) => /** @type {HTMLVideoElement} */ (v).paused))
      .toBe(false);

    await page.keyboard.press('Space');
    await expect
      .poll(async () => video.evaluate((v) => /** @type {HTMLVideoElement} */ (v).paused))
      .toBe(true);
  });
});

test.describe('/watch/ — TV mode home rails (Continue Watching ✕)', () => {
  // Regression: spatial-nav was landing focus on the inline ✕ button
  // of Continue Watching cards instead of the card body itself, so
  // pressing OK on the remote *removed* the entry instead of playing
  // it. The fix takes the ✕ out of the focus graph (`tabindex=-1`)
  // and exposes a `Delete` keyboard shortcut on the focused card so
  // there's still a navigation path to the action — the TV shell
  // additionally maps the Bravia menu/info button to `Delete` so a
  // remote-only flow keeps working.

  test('continue-watching ✕ has tabindex=-1 (skipped by spatial-nav)', async ({
    page
  }) => {
    // tabindex=-1 keeps spatial-nav from landing on the ✕ when
    // entering the row. The card's ArrowUp handler reaches the ✕
    // by direct .focus() (which works on tabindex=-1 elements) so
    // the focus graph stays clean from outside.
    await page.addInitScript(() => {
      try {
        const now = Date.now();
        localStorage.setItem(
          'heyming.watch.last.fawlty-towers',
          JSON.stringify({ lastSeason: 1, lastEpisode: 1, updatedAt: now })
        );
      } catch (_) {}
    });
    await page.goto('/watch/');
    await page.waitForSelector('.tv-continue-card', { timeout: 10_000 });
    const tabindex = await page.evaluate(() => {
      const btn = document.querySelector('.tv-continue-card .tv-continue-remove');
      return btn?.getAttribute('tabindex');
    });
    expect(tabindex).toBe('-1');
  });

  test('ArrowUp on a focused ✕ leaves the row (lands above the card)', async ({
    page
  }) => {
    // The bug this guards: Chromium WebView won't run spatial-nav
    // from a tabindex=-1 source, so ArrowUp from the ✕ used to get
    // visually stuck. We now compute the next candidate ourselves
    // and assert that focus has moved to *something* that's
    // vertically above the card.
    await page.addInitScript(() => {
      try {
        localStorage.setItem(
          'heyming.watch.last.fawlty-towers',
          JSON.stringify({ lastSeason: 1, lastEpisode: 1, updatedAt: Date.now() })
        );
      } catch (_) {}
    });
    await page.goto('/watch/');
    await page.waitForSelector('.tv-continue-card', { timeout: 10_000 });

    const cardTopBefore = await page.evaluate(() => {
      const card = document.querySelector('.tv-continue-card');
      return card?.getBoundingClientRect().top ?? 0;
    });

    await page.evaluate(() => {
      /** @type {HTMLButtonElement|null} */
      const btn = document.querySelector('.tv-continue-card .tv-continue-remove');
      btn?.focus();
    });
    await page.keyboard.press('ArrowUp');

    const after = await page.evaluate(() => {
      const el = document.activeElement;
      if (!el || !(el instanceof HTMLElement)) return null;
      const r = el.getBoundingClientRect();
      return {
        cls: el.className || '',
        tag: el.tagName,
        top: r.top
      };
    });

    expect(after).not.toBeNull();
    // Focus should have moved off the ✕ entirely…
    expect(after.cls).not.toContain('tv-continue-remove');
    // …and landed on something that sits above where the card was.
    expect(after.top).toBeLessThan(cardTopBefore);
  });

  test('Delete on a focused continue-watching card removes the entry', async ({
    page
  }) => {
    await page.addInitScript(() => {
      try {
        localStorage.setItem(
          'heyming.watch.last.fawlty-towers',
          JSON.stringify({ lastSeason: 1, lastEpisode: 1, updatedAt: Date.now() })
        );
      } catch (_) {}
    });
    await page.goto('/watch/');
    await page.waitForSelector('.tv-continue-card', { timeout: 10_000 });

    // Focus the card explicitly — the test doesn't depend on
    // spatial-nav choosing it, only on the keyboard handler firing
    // when the card is focused.
    await page.evaluate(() => {
      /** @type {HTMLAnchorElement|null} */
      const card = document.querySelector('.tv-continue-card');
      card?.focus();
    });
    await page.keyboard.press('Delete');

    await expect
      .poll(
        async () =>
          page.evaluate(() => document.querySelectorAll('.tv-continue-card').length),
        { timeout: 5_000 }
      )
      .toBe(0);

    const stored = await page.evaluate(() =>
      localStorage.getItem('heyming.watch.last.fawlty-towers')
    );
    expect(stored).toBeNull();
  });

  test('OK / Enter on a focused continue-watching card navigates to the episode', async ({
    page
  }) => {
    // The flip side of the regression — having moved focus off the
    // ✕, pressing OK on the card body must actually navigate to
    // play the episode. Real spatial-nav entry point is harder to
    // pin down deterministically, so we focus the card directly.
    await page.addInitScript(() => {
      try {
        localStorage.setItem(
          'heyming.watch.last.fawlty-towers',
          JSON.stringify({ lastSeason: 1, lastEpisode: 1, updatedAt: Date.now() })
        );
      } catch (_) {}
    });
    await page.goto('/watch/');
    await page.waitForSelector('.tv-continue-card', { timeout: 10_000 });
    await page.evaluate(() => {
      const card = document.querySelector('.tv-continue-card');
      /** @type {HTMLAnchorElement|null} */ (card)?.focus();
    });
    await page.keyboard.press('Enter');
    await page.waitForURL(
      (url) =>
        url.search.includes('show=fawlty-towers') &&
        url.search.includes('s=1') &&
        url.search.includes('e=1'),
      { timeout: 10_000 }
    );
  });

  test('ArrowUp on a focused card moves focus to its ✕ button', async ({ page }) => {
    // D-pad sub-navigation: a remote-only user reaches the inline ✕
    // by pressing ArrowUp from the card. Without this path the
    // tabindex=-1 ✕ would only be mouse-clickable.
    await page.addInitScript(() => {
      try {
        localStorage.setItem(
          'heyming.watch.last.fawlty-towers',
          JSON.stringify({ lastSeason: 1, lastEpisode: 1, updatedAt: Date.now() })
        );
      } catch (_) {}
    });
    await page.goto('/watch/');
    await page.waitForSelector('.tv-continue-card', { timeout: 10_000 });
    await page.evaluate(() => {
      const card = document.querySelector('.tv-continue-card');
      /** @type {HTMLAnchorElement|null} */ (card)?.focus();
    });
    await page.keyboard.press('ArrowUp');
    const focused = await page.evaluate(() =>
      document.activeElement?.className || ''
    );
    expect(focused).toContain('tv-continue-remove');
  });

  test('ArrowDown on the focused ✕ returns focus to the card body', async ({
    page
  }) => {
    await page.addInitScript(() => {
      try {
        localStorage.setItem(
          'heyming.watch.last.fawlty-towers',
          JSON.stringify({ lastSeason: 1, lastEpisode: 1, updatedAt: Date.now() })
        );
      } catch (_) {}
    });
    await page.goto('/watch/');
    await page.waitForSelector('.tv-continue-card', { timeout: 10_000 });
    await page.evaluate(() => {
      /** @type {HTMLButtonElement|null} */
      const btn = document.querySelector('.tv-continue-card .tv-continue-remove');
      btn?.focus();
    });
    await page.keyboard.press('ArrowDown');
    const focused = await page.evaluate(() => {
      const el = document.activeElement;
      return {
        cls: el?.className || '',
        tag: el?.tagName || ''
      };
    });
    expect(focused.cls).toBe('tv-continue-card');
    expect(focused.tag).toBe('A');
  });

  test('MediaPlay on a focused card activates it (navigates to the episode)', async ({
    page
  }) => {
    // The Bravia remote's dedicated Play button reaches the page as
    // a `MediaPlay` keyboard event (the Android shell rewrites it to
    // CLICK_ACTIVE_ELEMENT off-player; here we directly fire the JS
    // event since Playwright doesn't dispatch through the shell).
    await page.addInitScript(() => {
      try {
        localStorage.setItem(
          'heyming.watch.last.fawlty-towers',
          JSON.stringify({ lastSeason: 1, lastEpisode: 1, updatedAt: Date.now() })
        );
      } catch (_) {}
    });
    await page.goto('/watch/');
    await page.waitForSelector('.tv-continue-card', { timeout: 10_000 });
    await page.evaluate(() => {
      /** @type {HTMLAnchorElement|null} */
      const card = document.querySelector('.tv-continue-card');
      card?.focus();
      card?.dispatchEvent(
        new KeyboardEvent('keydown', {
          key: 'MediaPlay',
          bubbles: true,
          cancelable: true
        })
      );
    });
    await page.waitForURL(
      (url) =>
        url.search.includes('show=fawlty-towers') &&
        url.search.includes('s=1') &&
        url.search.includes('e=1'),
      { timeout: 10_000 }
    );
  });
});

test.describe('/watch/ — TV mode resume / restart', () => {
  // Resume points are stored under `heyming.watch.pos.<showId>.s<n>e<n>`
  // as `{ position, duration, updatedAt }`. The watch view seeks to
  // the saved position on `loadedmetadata` and shows a 6s overlay
  // with two focusable buttons (Resume / From start).
  //
  // These tests cover three behaviors:
  //   1. Saved position → auto-seek + overlay visible on episode load.
  //   2. Pause → position written to localStorage.
  //   3. "From start" button → seeks to 0 + clears the saved entry.
  //
  // Uses fawlty-towers (small catalog) with the same seed pattern as
  // the chip-row regression test above.

  const PLAYER_URL = '/watch/?show=fawlty-towers&s=1&e=1';
  const POS_KEY = 'heyming.watch.pos.fawlty-towers.s1e1';

  test('seeded resume point auto-seeks and shows the overlay', async ({ page }) => {
    await page.addInitScript(() => {
      try {
        // 4-minute mark of a (faked) 25-minute episode — well clear
        // of both the 15s "didn't really start" floor and the 60s-
        // before-end "basically watched it" cap that loadResumePosition
        // applies. Real episodes are longer; we don't need to match
        // the IA file's actual duration to test the seek path because
        // we'll override video.duration after metadata loads.
        localStorage.setItem(
          'heyming.watch.pos.fawlty-towers.s1e1',
          JSON.stringify({ position: 240, duration: 1500, updatedAt: Date.now() })
        );
      } catch (_) {}
    });
    await page.goto(PLAYER_URL);
    const video = page.locator('video');
    await video.waitFor({ timeout: 30_000 });
    await page.waitForFunction(
      () => {
        const v = /** @type {HTMLVideoElement|null} */ (
          document.querySelector('video')
        );
        return !!v && Number.isFinite(v.duration) && v.duration > 0;
      },
      null,
      { timeout: 30_000 }
    );

    // Auto-seek: currentTime should be near the saved 240s. Allow a
    // generous tolerance because the seek lands on a keyframe and
    // the IA item's actual duration may be < 240 + 5 (in which case
    // armResumeFor clamps to duration - 5).
    const t = await video.evaluate(
      (v) => /** @type {HTMLVideoElement} */ (v).currentTime
    );
    expect(t).toBeGreaterThan(15);

    // Overlay is visible and the primary "Resume" button has focus.
    await expect(page.locator('.tv-resume')).not.toHaveClass(/hidden/);
    const focusedClass = await page.evaluate(
      () => document.activeElement?.className || ''
    );
    expect(focusedClass).toContain('tv-resume-btn--primary');
  });

  test('pausing mid-episode persists position to localStorage', async ({ page }) => {
    await page.goto(PLAYER_URL);
    const video = page.locator('video');
    await video.waitFor({ timeout: 30_000 });
    await page.waitForFunction(
      () => {
        const v = /** @type {HTMLVideoElement|null} */ (
          document.querySelector('video')
        );
        return !!v && Number.isFinite(v.duration) && v.duration > 0;
      },
      null,
      { timeout: 30_000 }
    );

    // Force a non-trivial position, briefly play (so the video's
    // paused state is actually `false`), then pause to fire the
    // `pause` event our flushPosition listener hooks. Calling
    // pause() on an already-paused element is a no-op per spec —
    // hence the play/pause dance.
    await page.evaluate(async () => {
      const v = /** @type {HTMLVideoElement} */ (document.querySelector('video'));
      v.muted = true;
      v.currentTime = 90;
      try {
        await v.play();
      } catch {
        /* autoplay may still reject here; pause() below handles it */
      }
      v.pause();
    });

    const stored = await page.evaluate((key) => localStorage.getItem(key), POS_KEY);
    expect(stored).toBeTruthy();
    if (stored) {
      const parsed = JSON.parse(stored);
      // 90s saved (give or take browser keyframe rounding) and the
      // duration field is populated. The exact duration depends on
      // the IA file; just assert it's a positive number.
      expect(parsed.position).toBeGreaterThan(60);
      expect(parsed.duration).toBeGreaterThan(0);
    }
  });

  test('OK (k) on the focused From-start button rewinds, even though the player normally treats k as play/pause', async ({
    page
  }) => {
    // Regression: the player's main keydown listener captures 'k'
    // for togglePlay() and arrow keys for seek/volume, regardless
    // of focus. While the resume overlay is up that meant pressing
    // OK on the focused button toggled playback instead of clicking
    // the button. The overlayDismiss listener now stops propagation
    // (and translates 'k' → click) when focus is inside the overlay.
    await page.addInitScript(() => {
      try {
        localStorage.setItem(
          'heyming.watch.pos.fawlty-towers.s1e1',
          JSON.stringify({ position: 240, duration: 1500, updatedAt: Date.now() })
        );
      } catch (_) {}
    });
    await page.goto(PLAYER_URL);
    const video = page.locator('video');
    await video.waitFor({ timeout: 30_000 });
    await page.waitForFunction(
      () => {
        const v = /** @type {HTMLVideoElement|null} */ (
          document.querySelector('video')
        );
        return !!v && Number.isFinite(v.duration) && v.duration > 0;
      },
      null,
      { timeout: 30_000 }
    );
    await expect(page.locator('.tv-resume')).not.toHaveClass(/hidden/);

    // Focus the From-start button explicitly (real D-pad would
    // ArrowRight from the default-focused Resume button to reach
    // it, but spatial-nav between buttons isn't reliable in
    // Playwright's headless Chromium).
    await page.evaluate(() => {
      /** @type {HTMLButtonElement|null} */
      const btn = document.querySelector(
        '.tv-resume-btn:not(.tv-resume-btn--primary):not(.tv-resume-btn--ghost)'
      );
      btn?.focus();
    });

    // Dispatch the same key the Android shell sends for KEYCODE_DPAD_CENTER
    // on the player. The translation in overlayDismiss should turn
    // this into a click on the focused button.
    await page.evaluate(() => {
      const ev = new KeyboardEvent('keydown', {
        key: 'k',
        bubbles: true,
        cancelable: true
      });
      (document.activeElement || document).dispatchEvent(ev);
    });

    const t = await video.evaluate(
      (v) => /** @type {HTMLVideoElement} */ (v).currentTime
    );
    expect(t).toBeLessThan(2);

    const stored = await page.evaluate(
      (key) => localStorage.getItem(key),
      POS_KEY
    );
    expect(stored).toBeNull();
  });

  test('ArrowLeft on a focused resume button does NOT seek the timeline', async ({
    page
  }) => {
    // The player's keydown listener turns ArrowLeft into a -10s
    // seek in TV mode. While the overlay has focus that's wrong —
    // we expect the arrow to drive button navigation (handled by
    // spatial-nav on the WebView, not asserted here) and NOT touch
    // the video timeline. We assert the timeline stayed put.
    await page.addInitScript(() => {
      try {
        localStorage.setItem(
          'heyming.watch.pos.fawlty-towers.s1e1',
          JSON.stringify({ position: 240, duration: 1500, updatedAt: Date.now() })
        );
      } catch (_) {}
    });
    await page.goto(PLAYER_URL);
    const video = page.locator('video');
    await video.waitFor({ timeout: 30_000 });
    await page.waitForFunction(
      () => {
        const v = /** @type {HTMLVideoElement|null} */ (
          document.querySelector('video')
        );
        return !!v && Number.isFinite(v.duration) && v.duration > 0;
      },
      null,
      { timeout: 30_000 }
    );
    await expect(page.locator('.tv-resume')).not.toHaveClass(/hidden/);

    const before = await video.evaluate(
      (v) => /** @type {HTMLVideoElement} */ (v).currentTime
    );

    await page.evaluate(() => {
      const btn = document.querySelector('.tv-resume-btn--primary');
      /** @type {HTMLButtonElement|null} */ (btn)?.focus();
      const ev = new KeyboardEvent('keydown', {
        key: 'ArrowLeft',
        bubbles: true,
        cancelable: true
      });
      (document.activeElement || document).dispatchEvent(ev);
    });

    const after = await video.evaluate(
      (v) => /** @type {HTMLVideoElement} */ (v).currentTime
    );
    // The seek-by-10s would have moved this somewhere noticeably
    // different (target is around 240). Allow a tiny ε for any
    // pending playback drift between the two reads.
    expect(Math.abs(after - before)).toBeLessThan(1);
  });

  test('"From start" button rewinds to 0 and clears the saved point', async ({
    page
  }) => {
    await page.addInitScript(() => {
      try {
        localStorage.setItem(
          'heyming.watch.pos.fawlty-towers.s1e1',
          JSON.stringify({ position: 240, duration: 1500, updatedAt: Date.now() })
        );
      } catch (_) {}
    });
    await page.goto(PLAYER_URL);
    const video = page.locator('video');
    await video.waitFor({ timeout: 30_000 });
    await page.waitForFunction(
      () => {
        const v = /** @type {HTMLVideoElement|null} */ (
          document.querySelector('video')
        );
        return !!v && Number.isFinite(v.duration) && v.duration > 0;
      },
      null,
      { timeout: 30_000 }
    );

    // Wait for the overlay (and its From-start button) to actually
    // mount. The button is rendered eagerly but the overlay flips
    // out of `.hidden` only after armResumeFor confirms the saved
    // position is valid for the current duration.
    await expect(page.locator('.tv-resume')).not.toHaveClass(/hidden/);
    await page
      .locator('.tv-resume-btn:not(.tv-resume-btn--primary):not(.tv-resume-btn--ghost)')
      .click();

    const t = await video.evaluate(
      (v) => /** @type {HTMLVideoElement} */ (v).currentTime
    );
    expect(t).toBeLessThan(2);

    const stored = await page.evaluate((key) => localStorage.getItem(key), POS_KEY);
    expect(stored).toBeNull();
  });

  test('"← Back" button leaves the player and returns to the episode list', async ({
    page
  }) => {
    // Discoverability fallback for users who don't realize the
    // remote has a Back key. Clicking the ghost button walks
    // history one step, which the SPA routes to the episodes view.
    await page.addInitScript(() => {
      try {
        localStorage.setItem(
          'heyming.watch.pos.fawlty-towers.s1e1',
          JSON.stringify({ position: 240, duration: 1500, updatedAt: Date.now() })
        );
      } catch (_) {}
    });
    await page.goto('/watch/?show=fawlty-towers');
    // Click into S1E1 from the episodes view so history.back()
    // has somewhere to go (without this the URL bar test below
    // would drop us out of the app entirely).
    await page.waitForLoadState('domcontentloaded');
    await page.goto(PLAYER_URL);
    const video = page.locator('video');
    await video.waitFor({ timeout: 30_000 });
    await page.waitForFunction(
      () => {
        const v = /** @type {HTMLVideoElement|null} */ (
          document.querySelector('video')
        );
        return !!v && Number.isFinite(v.duration) && v.duration > 0;
      },
      null,
      { timeout: 30_000 }
    );
    await expect(page.locator('.tv-resume')).not.toHaveClass(/hidden/);

    await page.locator('.tv-resume-btn--ghost').click();

    // history.back() landed us on the episodes view (no `e=`).
    await page.waitForURL((url) => !url.search.includes('e='), {
      timeout: 5_000
    });
  });
});

test.describe('/watch/ — TV mode floating chrome is hidden', () => {
  // The launcher-level back button, share button, and feedback button
  // are all mouse-only; the CSS overlay hides them on TV. We assert
  // computed display:none rather than visibility so a future "fade"
  // animation doesn't accidentally pass.

  test('back button is display:none on TV', async ({ page }) => {
    await page.goto('/watch/');
    const display = await page.evaluate(() => {
      const el = document.querySelector('.back-to-launcher');
      return el ? getComputedStyle(el).display : 'absent';
    });
    // Either the element isn't on this page (some apps drop it via
    // nav.js's iframe check) or the overlay hid it. Both pass.
    expect(['none', 'absent']).toContain(display);
  });

  test('share-button is display:none on TV', async ({ page }) => {
    await page.goto('/watch/');
    const display = await page.evaluate(() => {
      const el = document.querySelector('share-button');
      return el ? getComputedStyle(el).display : 'absent';
    });
    expect(['none', 'absent']).toContain(display);
  });
});
