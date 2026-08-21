// @ts-check
const { test, expect } = require('@playwright/test');

// Engines disagree about which field of a key event carries the arrow. The
// PS5 system browser sends its D-pad as key events, and older WebKit builds
// commonly report arrows as the legacy `Up`/`Left` names with an empty
// `code`, or set nothing but the deprecated `keyCode`. 2048 has to move on
// all of those shapes, not just the modern `code`.

/**
 * Seed a board where "left" has exactly one outcome: 2+2 merge, score 0 → 4.
 * @param {import('@playwright/test').Page} page
 */
async function seedMergeableBoard(page) {
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
}

/**
 * Dispatch a keydown shaped exactly as given — `keyCode` has to be attached
 * after construction because KeyboardEvent's constructor ignores it.
 * @param {import('@playwright/test').Page} page
 * @param {{ key?: string, code?: string, keyCode?: number }} fields
 */
async function dispatchKey(page, fields) {
  const { key = '', code = '', keyCode = 0 } = fields;
  await page.evaluate(
    (input) => {
      const ev = new KeyboardEvent('keydown', {
        key: input.key,
        code: input.code,
        bubbles: true,
        cancelable: true
      });
      Object.defineProperty(ev, 'keyCode', { value: input.keyCode });
      Object.defineProperty(ev, 'which', { value: input.keyCode });
      document.dispatchEvent(ev);
    },
    { key, code, keyCode }
  );
}

test.describe('2048 arrow-key resolution across engines', () => {
  test.beforeEach(async ({ page }) => {
    await seedMergeableBoard(page);
    await page.goto('/2048/');
    await expect(page.locator('#score')).toHaveText('0');
  });

  test('modern code field still moves', async ({ page }) => {
    await dispatchKey(page, { key: 'ArrowLeft', code: 'ArrowLeft', keyCode: 37 });
    await expect(page.locator('#score')).toHaveText('4');
  });

  test('legacy key name with an empty code moves', async ({ page }) => {
    await dispatchKey(page, { key: 'Left', code: '', keyCode: 37 });
    await expect(page.locator('#score')).toHaveText('4');
  });

  test('keyCode alone moves', async ({ page }) => {
    await dispatchKey(page, { key: '', code: '', keyCode: 37 });
    await expect(page.locator('#score')).toHaveText('4');
  });

  test('key field holding the standard name moves', async ({ page }) => {
    await dispatchKey(page, { key: 'ArrowLeft', code: '', keyCode: 0 });
    await expect(page.locator('#score')).toHaveText('4');
  });

  test('a bare letter resolves to its WASD binding', async ({ page }) => {
    await dispatchKey(page, { key: 'a', code: '', keyCode: 65 });
    await expect(page.locator('#score')).toHaveText('4');
  });

  test('an unrelated key does not move the board', async ({ page }) => {
    await dispatchKey(page, { key: 'q', code: 'KeyQ', keyCode: 81 });
    await expect(page.locator('#score')).toHaveText('0');
  });
});
