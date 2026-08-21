// @ts-check
const { test, expect } = require('@playwright/test');

// Tiles slide between cells with a CSS transition on `transform`. A tile that
// carries a spawn or merge animation must still slide on later moves, which
// means those animations may not own the `transform` property — an animation
// wins over inline styles in the cascade, so a filled keyframe would pin the
// tile in place and make every move a teleport.

/**
 * Force spawns to be deterministic: first empty cell, value 2. `spawnTile`
 * draws the cell first, then the value.
 * @param {import('@playwright/test').Page} page
 * @param {number[]} sequence
 */
async function stubRandom(page, sequence) {
  await page.addInitScript((values) => {
    let i = 0;
    Math.random = () => {
      const v = values[i % values.length];
      i++;
      return v;
    };
  }, sequence);
}

/**
 * Move, then sample the tile one frame later. A transitioned slide has barely
 * started by then; a teleport is already finished.
 * @param {import('@playwright/test').Page} page
 * @param {string} id
 */
async function leftEdgeAfterOneFrame(page, id) {
  return page.evaluate(async (tileId) => {
    const tile = document.querySelector(`.tile[data-id="${tileId}"]`);
    if (!tile) throw new Error(`no tile ${tileId}`);
    const before = tile.getBoundingClientRect().left;

    const ev = new KeyboardEvent('keydown', { key: 'ArrowLeft', code: 'ArrowLeft', bubbles: true });
    document.dispatchEvent(ev);

    await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
    return { before, after: tile.getBoundingClientRect().left };
  }, id);
}

test.describe('2048 tile motion', () => {
  test('a spawned tile still slides on the next move', async ({ page }) => {
    // Cells (0,0) and (1,1): two starting tiles that cannot merge, so a
    // left move is a pure one-cell slide of the tile in row 1.
    await stubRandom(page, [0, 0, 4 / 15, 0]);
    await page.goto('/2048/');
    await expect(page.locator('.tile')).toHaveCount(2);
    // Let the spawn animation finish so only its lingering fill could interfere.
    await page.waitForTimeout(500);

    const { before, after } = await leftEdgeAfterOneFrame(page, '2');

    // Measured off the board background: --cell-size is a calc() and does not
    // parse, but adjacent cells give the same column pitch.
    const cellStep = await page.evaluate(() => {
      const cells = document.querySelectorAll('.cell-bg');
      return cells[1].getBoundingClientRect().left - cells[0].getBoundingClientRect().left;
    });

    // The tile is heading one cell left; a frame in it must still be short of
    // the destination rather than already parked there.
    expect(after).toBeLessThan(before);
    expect(after - (before - cellStep)).toBeGreaterThan(cellStep * 0.15);
  });

  test('a merging tile travels to the tile it merges into', async ({ page }) => {
    // Cells (0,0) and (0,1), both value 2: a left move merges them, so the
    // right-hand tile has to visibly cross into the left-hand cell.
    await stubRandom(page, [0, 0, 0, 0]);
    await page.goto('/2048/');
    await expect(page.locator('.tile')).toHaveCount(2);
    await page.waitForTimeout(500);

    const { before, after } = await leftEdgeAfterOneFrame(page, '2');

    // Sampling mid-slide, so assert on direction of travel only.
    expect(after).toBeLessThan(before - 1);
  });

  test('tile faces stay painted and fill their cell', async ({ page }) => {
    await stubRandom(page, [0, 0, 4 / 15, 0]);
    await page.goto('/2048/');
    const inner = page.locator('.tile[data-id="1"] .tile-inner');

    await expect(inner).toHaveText('2');
    const paint = await inner.evaluate((node) => {
      const styles = getComputedStyle(node);
      const cell = node.parentElement.getBoundingClientRect();
      const face = node.getBoundingClientRect();
      return {
        background: styles.backgroundColor,
        coversCell: Math.abs(face.width - cell.width) < 1 && Math.abs(face.height - cell.height) < 1
      };
    });

    expect(paint.background).not.toBe('rgba(0, 0, 0, 0)');
    expect(paint.coversCell).toBe(true);
  });
});
