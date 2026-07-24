// @ts-check
const { test, expect } = require('@playwright/test');

/**
 * @typedef {{
 *   currentLevelName?: string,
 *   level?: { width?: number, height?: number },
 *   ghosts?: unknown[],
 *   state?: string
 * }} PlaytestGame
 */

test.describe('Pac-Man Level Builder', () => {
  test('loads an existing level as an undoable template', async ({ page }) => {
    await page.addInitScript(() => localStorage.removeItem('pacman-builder-draft-v1'));
    await page.goto('/pacman-builder/');

    await page.locator('#templateSelect').selectOption('level6');
    await expect(page.locator('#templateDescription')).toContainText('cycling teleports');
    await page.locator('#loadTemplateButton').click();

    await expect(page.locator('#mapSize')).toHaveText('19 × 19');
    await expect(page.locator('#validationBadge')).toHaveText('Ready');
    await expect(page.locator('.teleport-group')).toContainText('4 endpoints');

    await page.locator('#undoButton').click();
    await expect(page.locator('#mapSize')).toHaveText('11 × 9');
  });

  test('switches instantly between building and an embedded 3D playtest', async ({ page }) => {
    await page.addInitScript(() => localStorage.removeItem('pacman-builder-draft-v1'));
    await page.goto('/pacman-builder/');

    await expect(page.locator('#validationBadge')).toHaveText('Ready');
    await page.locator('.tile-button[data-tile="2"]').click();
    const editedCell = page.locator('.cell[data-x="2"][data-y="2"]');
    await editedCell.click();
    await expect(editedCell).toHaveAttribute('data-tile', '2');

    await page.locator('#playButton').click();
    await expect(page.locator('#playtestOverlay')).toBeVisible();

    const playtest = page.frameLocator('#playtestFrame');
    await expect(playtest.locator('#game-container')).toBeVisible();
    await expect(playtest.locator('#start-screen')).toHaveClass(/hidden/u);
    await expect
      .poll(() =>
        playtest.locator('body').evaluate(() => {
          const game = /** @type {PlaytestGame | undefined} */ (Reflect.get(window, 'game'));
          return {
            name: game?.currentLevelName,
            width: game?.level?.width,
            height: game?.level?.height,
            ghosts: game?.ghosts?.length,
            state: game?.state
          };
        })
      )
      .toEqual({ name: 'custom', width: 11, height: 9, ghosts: 2, state: 'playing' });

    await page.locator('#exitPlaytestButton').click();
    await expect(page.locator('#playtestOverlay')).toBeHidden();
    await expect(editedCell).toHaveAttribute('data-tile', '2');
  });
});
