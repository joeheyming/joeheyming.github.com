// @ts-check
//
// Controller → arrow-key bridge (`/gamepad-keys.js`).
//
// Playwright can't attach a real gamepad, so these tests stub
// `navigator.getGamepads` and fire `gamepadconnected` — the same shape the
// bridge polls in production. What we assert:
//
//   1. A held D-pad button produces a `keydown` with both `code`/`key` and
//      the legacy `keyCode`, so old and new listeners both work.
//   2. Releasing the button produces exactly one `keyup`.
//   3. A single press does NOT spam repeats (discrete games get one move).
//   4. Left-stick deflection past the deadzone maps to arrows too.
//   5. The real /2048/ board responds to a synthesized D-pad press.

const { test, expect } = require('@playwright/test');

/**
 * Install a fake gamepad whose button/axis state the test can drive.
 * Must run before the bridge's first poll, hence addInitScript.
 */
async function installFakeGamepad(page) {
  await page.addInitScript(() => {
    const state = {
      buttons: new Array(16).fill(false),
      axes: [0, 0, 0, 0]
    };
    // @ts-ignore test-only handle
    window.__pad = state;
    navigator.getGamepads = () => [
      {
        id: 'Fake Pad (STANDARD GAMEPAD)',
        index: 0,
        connected: true,
        mapping: 'standard',
        timestamp: performance.now(),
        buttons: state.buttons.map((pressed) => ({
          pressed,
          touched: pressed,
          value: pressed ? 1 : 0
        })),
        axes: state.axes.slice(),
        hapticActuators: [],
        vibrationActuator: null
      }
    ];
  });
}

/** Record keyboard events the page receives from the bridge. */
async function recordKeys(page) {
  await page.evaluate(() => {
    // @ts-ignore test-only handle
    window.__keys = [];
    for (const type of ['keydown', 'keyup']) {
      document.addEventListener(type, (event) => {
        const ke = /** @type {KeyboardEvent} */ (event);
        // @ts-ignore test-only handle
        window.__keys.push({
          type: ke.type,
          code: ke.code,
          key: ke.key,
          keyCode: ke.keyCode,
          trusted: ke.isTrusted
        });
      });
    }
  });
}

async function setPad(page, mutate) {
  await page.evaluate(mutate);
  // Bridge polls on requestAnimationFrame; a couple of frames is plenty.
  await page.evaluate(
    () =>
      new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => resolve())))
  );
}

test.describe('gamepad-keys bridge', () => {
  test.beforeEach(async ({ page }) => {
    await installFakeGamepad(page);
  });

  test('D-pad press and release emit one keydown and one keyup', async ({ page }) => {
    await page.goto('/2048/');
    await page.waitForFunction(() => !!window.gamepadKeys);
    await recordKeys(page);

    // Button 12 is D-pad up in the standard mapping.
    await setPad(page, () => {
      window.__pad.buttons[12] = true;
      window.dispatchEvent(new Event('gamepadconnected'));
    });

    await setPad(page, () => {
      window.__pad.buttons[12] = false;
    });

    const keys = await page.evaluate(() => window.__keys);
    const ups = keys.filter((k) => k.code === 'ArrowUp');

    expect(ups.filter((k) => k.type === 'keydown').length).toBe(1);
    expect(ups.filter((k) => k.type === 'keyup').length).toBe(1);
    expect(ups[0].key).toBe('ArrowUp');
    expect(ups[0].keyCode).toBe(38);
    // Synthesized events can't be trusted events; that's expected.
    expect(ups[0].trusted).toBe(false);
  });

  test('a brief press does not auto-repeat', async ({ page }) => {
    await page.goto('/2048/');
    await page.waitForFunction(() => !!window.gamepadKeys);
    await recordKeys(page);

    await setPad(page, () => {
      window.__pad.buttons[13] = true;
      window.dispatchEvent(new Event('gamepadconnected'));
    });
    // Well under the 420ms repeat delay.
    await page.waitForTimeout(200);
    await setPad(page, () => {
      window.__pad.buttons[13] = false;
    });

    const downs = await page.evaluate(() =>
      window.__keys.filter((k) => k.type === 'keydown' && k.code === 'ArrowDown')
    );
    expect(downs.length).toBe(1);
  });

  test('left stick past the deadzone maps to arrows', async ({ page }) => {
    await page.goto('/2048/');
    await page.waitForFunction(() => !!window.gamepadKeys);
    await recordKeys(page);

    await setPad(page, () => {
      window.__pad.axes[0] = -0.9;
      window.dispatchEvent(new Event('gamepadconnected'));
    });

    const left = await page.evaluate(() =>
      window.__keys.filter((k) => k.type === 'keydown' && k.code === 'ArrowLeft')
    );
    expect(left.length).toBeGreaterThanOrEqual(1);
  });

  test('a deflection inside the deadzone is ignored', async ({ page }) => {
    await page.goto('/2048/');
    await page.waitForFunction(() => !!window.gamepadKeys);
    await recordKeys(page);

    await setPad(page, () => {
      window.__pad.axes[1] = 0.3;
      window.dispatchEvent(new Event('gamepadconnected'));
    });

    const keys = await page.evaluate(() => window.__keys);
    expect(keys.length).toBe(0);
  });

  test('2048 merges a seeded row from a D-pad press', async ({ page }) => {
    // Seed a board where "left" has exactly one outcome: the two 2s in the
    // top row merge into a 4, so score goes 0 -> 4. Without a seed the start
    // position is random and a move can legitimately be a no-op.
    await page.addInitScript(() => {
      const empty = () => [null, null, null, null];
      localStorage.setItem(
        'g2048.state.v1',
        JSON.stringify({
          grid: [
            [{ id: 1, value: 2, row: 0, col: 0 }, { id: 2, value: 2, row: 0, col: 1 }, null, null],
            empty(),
            empty(),
            empty()
          ],
          score: 0,
          won: false,
          continueAfterWin: false,
          nextTileId: 3
        })
      );
    });

    await page.goto('/2048/');
    await page.waitForFunction(() => !!window.gamepadKeys);
    await expect(page.locator('#score')).toHaveText('0');

    await setPad(page, () => {
      window.__pad.buttons[14] = true; // D-pad left
      window.dispatchEvent(new Event('gamepadconnected'));
    });
    await setPad(page, () => {
      window.__pad.buttons[14] = false;
    });

    // The merge is the proof the synthesized ArrowLeft reached the game.
    await expect(page.locator('#score')).toHaveText('4');
    await expect(page.locator('.tiles .tile', { hasText: /^4$/ })).toHaveCount(1);
  });
});
