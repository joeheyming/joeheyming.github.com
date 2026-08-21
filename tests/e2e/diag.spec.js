// @ts-check
const { test, expect } = require('@playwright/test');

// The whole point of /diag/ is to be readable on a device with no developer
// tools, so a silent break there is expensive: you only find out after
// walking to the console. These tests keep the page honest on a browser we
// can actually inspect.

test.describe('/diag/ capability probe', () => {
  test('reports engine capabilities that Chromium is known to have', async ({ page }) => {
    await page.goto('/diag/');

    const engine = page.locator('#engine');
    await expect(engine).not.toHaveText('Probing…');

    // Chromium supports all of these, so a "fail" here means the probe itself
    // is broken rather than the browser lacking the feature.
    for (const label of ['WebAssembly', 'ES modules', 'WebGL 2', 'Pointer Events']) {
      const value = engine.locator(`.k:text-is("${label}") + .v`);
      await expect(value).toHaveClass(/pass/);
    }

    await expect(engine.locator('.k:text-is("WebAssembly") + .v')).toContainText('compiles');
  });

  test('detects a gamepad once one is present', async ({ page }) => {
    await page.addInitScript(() => {
      const pad = {
        index: 0,
        id: 'Fake Pad (STANDARD GAMEPAD)',
        mapping: 'standard',
        connected: true,
        timestamp: 0,
        axes: [0, 0, 0, 0],
        buttons: Array.from({ length: 17 }, () => ({ pressed: false, touched: false, value: 0 }))
      };
      pad.buttons[14].pressed = true; // D-pad left
      navigator.getGamepads = () => [pad];
    });

    await page.goto('/diag/');
    const pads = page.locator('#pads');
    await expect(pads).toContainText('Fake Pad');
    await expect(pads.locator('.k:text-is("  buttons down") + .v')).toHaveText('14');
  });

  test('says so plainly when no gamepad is exposed', async ({ page }) => {
    await page.addInitScript(() => {
      navigator.getGamepads = () => [];
    });

    await page.goto('/diag/');
    await expect(page.locator('#pads')).toContainText('none');
  });

  test('logs input events with the fields we care about', async ({ page }) => {
    await page.goto('/diag/');

    await page.keyboard.press('ArrowUp');
    const log = page.locator('#events');
    await expect(log).toContainText('keydown');
    await expect(log).toContainText('code=ArrowUp');
    await expect(log).toContainText('trusted=true');
  });

  test('test tone reaches a running context and meters real signal', async ({ page }) => {
    await page.goto('/diag/');
    await page.getByRole('button', { name: 'Play test tone' }).click();

    const audio = page.locator('#audio');
    await expect(audio.locator('.k:text-is("Verdict") + .v')).toContainText('producing signal', {
      timeout: 10_000
    });
    await expect(audio.locator('.k:text-is("State after tone") + .v')).toHaveText('running');
    await expect(audio.locator('.k:text-is("Clock advanced") + .v')).toHaveClass(/pass/);
  });
});
