// @ts-check
const { test, expect } = require('@playwright/test');

/**
 * Smoke tests for the Pacman level system, fruit mechanic, and multi-island
 * teleport groups. These don't try to play the game — they just verify that
 * each level loads, parses, and exposes the structures the new code relies on.
 *
 * The game starts after clicking #start-btn. To skip the intro sound we pass
 * ?debug=true which makes Game.startGame() jump straight into PLAYING.
 */

const PACMAN_URL = (params) =>
  `/pacman/?debug=true&startcamera=birdseye${params ? '&' + params : ''}`;

async function startPacman(page, params) {
  await page.goto(PACMAN_URL(params));
  await page.waitForFunction(() => !!window.game?.level, null, { timeout: 15_000 });
  await page.click('#start-btn');
}

test.describe('Pacman levels & fruit', () => {
  test('level0 loads with a fruit-spawn tile', async ({ page }) => {
    await startPacman(page, 'level=level0');
    const info = await page.evaluate(() => ({
      width: window.game.level.width,
      height: window.game.level.height,
      fruitSpawn: window.game.level.fruitSpawn,
      dots: window.game.level.dots.length,
      groups: window.game.level.teleportGroups.length
    }));
    expect(info.width).toBe(27);
    expect(info.height).toBe(27);
    expect(info.fruitSpawn).not.toBeNull();
    expect(info.dots).toBeGreaterThan(100);
    expect(info.groups).toBe(1); // single horizontal tunnel pair
  });

  test('multi-island level parses 4-endpoint teleport group', async ({ page }) => {
    await startPacman(page, 'level=level6');
    const info = await page.evaluate(() => {
      const g = window.game.level.teleportGroups[0];
      return {
        groupCount: window.game.level.teleportGroups.length,
        mode: g.mode,
        endpointCount: g.endpoints.length,
        ghostHomes: window.game.level.ghostHome.length
      };
    });
    expect(info.groupCount).toBe(1);
    expect(info.mode).toBe('next');
    expect(info.endpointCount).toBe(4);
    expect(info.ghostHomes).toBeGreaterThanOrEqual(4);
  });

  test('level7 has the harder 3-island layout with distributed ghosts', async ({ page }) => {
    await startPacman(page, 'level=level7');
    const info = await page.evaluate(() => {
      const g = window.game.level.teleportGroups[0];
      // Group ghost-home tiles by island half. Top island sits above the
      // dividing void row (y < 11 in JSON; world-space y is flipped so
      // we read it back from level.ghostHome which holds world-flipped y).
      // For test purposes, just sample the y-spread to confirm ghosts are
      // not all clustered.
      const ys = window.game.level.ghostHome.map((g) => g.y);
      return {
        mode: g.mode,
        endpointCount: g.endpoints.length,
        dots: window.game.level.dots.length,
        ghostCount: window.game.ghosts.length,
        ghostYSpread: Math.max(...ys) - Math.min(...ys)
      };
    });
    expect(info.mode).toBe('next');
    expect(info.endpointCount).toBe(3); // 3 islands
    expect(info.dots).toBeGreaterThan(170); // bigger than level6
    expect(info.ghostCount).toBe(4);
    expect(info.ghostYSpread).toBeGreaterThan(5); // ghosts not all in one island
  });

  test('next-mode teleport actually warps pacman through the cycle', async ({ page }) => {
    await startPacman(page, 'level=level6');
    // Move Pacman directly onto the first teleport endpoint and tick once.
    // The endpoint coordinates are in level-space (Y-flipped from JSON).
    const result = await page.evaluate(() => {
      const game = window.game;
      const grp = game.level.teleportGroups[0];
      const ep0 = grp.endpoints[0];
      const ep1 = grp.endpoints[1];
      const s = game.level.scale;
      game.pacman.position.set(ep0.x * s, ep0.y * s, s / 2);
      game.pacman.lastTeleportTileKey = null;
      game.pacman.checkTeleport();
      return {
        atEp1:
          Math.round(game.pacman.position.x) === Math.round(ep1.x * s) &&
          Math.round(game.pacman.position.y) === Math.round(ep1.y * s),
        ep1
      };
    });
    expect(result.atEp1).toBe(true);
  });

  test('fruit spawns after the dot threshold is crossed', async ({ page }) => {
    await startPacman(page, 'level=level0');
    const spawned = await page.evaluate(async () => {
      const game = window.game;
      // Eat 40% of the dots synchronously to trigger the first fruit spawn.
      const dots = game.level.dots;
      const targetEaten = Math.ceil(dots.length * 0.4);
      let eaten = 0;
      for (const d of dots) {
        if (eaten >= targetEaten) break;
        if (!d.visible) continue;
        d.visible = false;
        eaten++;
      }
      game.maybeSpawnFruit();
      return {
        fruitsSpawned: game.fruitsSpawnedThisLevel,
        hasActive: !!game.activeFruit,
        type: game.activeFruit?.type?.name || null
      };
    });
    expect(spawned.fruitsSpawned).toBeGreaterThanOrEqual(1);
    expect(spawned.hasActive).toBe(true);
    expect(spawned.type).toBeTruthy();
  });

  test('nextLevel advances through LEVEL_ORDER', async ({ page }) => {
    await startPacman(page, 'level=level0');
    const before = await page.evaluate(() => ({
      name: window.game.currentLevelName,
      idx: window.game.levelOrderIndex
    }));
    expect(before.name).toBe('level0');
    expect(before.idx).toBe(0);

    await page.evaluate(async () => {
      await window.game.nextLevel();
    });
    await page.waitForFunction(() => window.game?.currentLevelName === 'level1', null, {
      timeout: 15_000
    });

    const after = await page.evaluate(() => ({
      name: window.game.currentLevelName,
      idx: window.game.levelOrderIndex
    }));
    expect(after.name).toBe('level1');
    expect(after.idx).toBe(1);
  });
});
