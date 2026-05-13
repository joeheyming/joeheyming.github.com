/**
 * Ghost-pool helpers for the streamed Pacman world.
 *
 * Mirrors the Minecraft-style mob pool described in world.js — spawning
 * is decoupled from chunk lifetime, ghosts spawn at random walkable
 * tiles around the player, despawn when the player walks too far away,
 * and never sit on top of Pacman.
 *
 * All exports take the `world` instance as their first argument and
 * mutate `world.ghosts` / `world._ghostSpawnTimer` directly. world.js
 * calls them from its constructor, addToScene, and update lifecycle —
 * the pool's three-step regulation (dispose-eaten → cull-far → spawn)
 * still runs from World.update() in the original order.
 */

import { GAMEPLAY, GHOST_STATE, TILE } from './constants.js';
import { CHUNK_SIZE } from './templates.js';
import { Ghost, PERSONALITY } from './ghost.js';
import { hashCoords } from './prng.js';
import { NEAR_GHOST_TARGET_FRACTION, NEAR_SPAWN_DIST_TIGHTEN } from './world-constants.js';

/**
 * Spawn an initial batch of ghosts when the world first loads. Uses
 * the same placement rules as the runtime spawn loop, but front-loads
 * the population so a fresh game / continue resume always has a few
 * ghosts visible nearby (without being on top of Pacman).
 */
export function seedInitialGhosts(world, pacmanPos) {
  // farPct is 0 at boot so the effective cap == base, but read through
  // the helper for symmetry with the runtime spawn loop.
  const targetCap = Math.round(GAMEPLAY.GHOST_TARGET_COUNT * world.effectiveGhostCountMul());
  const target = Math.min(targetCap, 4);
  // Walk colorIdx through 0..3 in order so the initial pool guarantees
  // one of each personality whenever target ≥ 4 — important because
  // Inky's flank target is meaningless without a Blinky reference.
  let nextColorIdx = 0;
  for (let i = 0; i < target * 3; i++) {
    if (world.ghosts.size >= target) break;
    const spawn = pickGhostSpawnTile(world, pacmanPos);
    if (!spawn) continue;
    const colorIdx = nextColorIdx % 4;
    nextColorIdx++;
    const ghost = new Ghost({
      gridX: spawn.gx,
      gridY: spawn.gy,
      colorIdx,
      scale: world.scale,
      world
    });
    ghost.addToScene(world.scene);
    world.ghosts.add(ghost);
  }
  world._ghostSpawnTimer = randomSpawnInterval();
}

export function disposeEatenGhosts(world) {
  for (const g of world.ghosts) {
    if (g.shouldDespawn) {
      g.removeFromScene(world.scene);
      g.dispose();
      world.ghosts.delete(g);
    }
  }
}

export function cullGhosts(world, pacmanPos) {
  const cullR = GAMEPLAY.GHOST_CULL_DIST_TILES * world.scale;
  const cullR2 = cullR * cullR;
  for (const g of world.ghosts) {
    const dx = g.position.x - pacmanPos.x;
    const dy = g.position.y - pacmanPos.y;
    if (dx * dx + dy * dy > cullR2) {
      g.removeFromScene(world.scene);
      g.dispose();
      world.ghosts.delete(g);
    }
  }
}

export function tickGhostSpawning(world, dt, pacmanPos, powerInfo) {
  world._ghostSpawnTimer -= dt;
  if (world._ghostSpawnTimer > 0) return;
  // Re-roll the timer to a random interval. Even if we don't end up
  // spawning this attempt (cap reached, no valid tile), the next
  // attempt is also delayed so we don't churn.
  world._ghostSpawnTimer = randomSpawnInterval();
  // Distance-scaled population cap: the deeper Pacman wanders the more
  // ghosts the world will keep alive around him. Capped by the
  // effective helper (base × farPct boost).
  const cap = Math.round(GAMEPLAY.GHOST_TARGET_COUNT * world.effectiveGhostCountMul());
  if (world.ghosts.size >= cap) return;

  // Active spawn rebalancing — count ghosts within chase radius. If we
  // have fewer "near" ghosts than NEAR_GHOST_TARGET_FRACTION of the
  // soft cap, this spawn attempt uses a tightened minimum spawn
  // distance so the new ghost actually arrives near Pacman, not at
  // the spawn-ring horizon. Keeps pressure constant even if a chase
  // pack just despawned (fled / culled by distance).
  const chaseR =
    GAMEPLAY.GHOST_CHASE_RADIUS * world.scale * world.difficulty.ghostChaseRadiusMul;
  const chaseR2 = chaseR * chaseR;
  let nearCount = 0;
  for (const g of world.ghosts) {
    const dx = g.position.x - pacmanPos.x;
    const dy = g.position.y - pacmanPos.y;
    if (dx * dx + dy * dy <= chaseR2) nearCount++;
  }
  const nearTarget = Math.max(1, Math.round(cap * NEAR_GHOST_TARGET_FRACTION));
  const tightenSpawn = nearCount < nearTarget;

  const spawn = pickGhostSpawnTile(world, pacmanPos, { tighten: tightenSpawn });
  if (!spawn) return;

  // Colour: chunk-derived so a given tile in a given world reliably
  // produces the same ghost colour. Adds visual consistency without
  // making spawn TIMES predictable.
  const colorIdx = (hashCoords(world.seed ^ 0xa5a5a5a5, spawn.gx, spawn.gy) >>> 0) % 4;
  const ghost = new Ghost({
    gridX: spawn.gx,
    gridY: spawn.gy,
    colorIdx,
    scale: world.scale,
    world
  });
  ghost.addToScene(world.scene);
  world.ghosts.add(ghost);
  // Pacman is mid-power-mode → flip the new ghost straight to FLEE
  // for the remaining duration so it shows up blue, matching the
  // ghosts that were already on the map when the pill was eaten.
  if (powerInfo && powerInfo.powered && powerInfo.powerTimer > 0) {
    ghost.enterFlee(powerInfo.powerTimer);
  }
}

function randomSpawnInterval() {
  const lo = GAMEPLAY.GHOST_SPAWN_INTERVAL_MIN;
  const hi = GAMEPLAY.GHOST_SPAWN_INTERVAL_MAX;
  return lo + Math.random() * (hi - lo);
}

/**
 * Pick a tile to spawn a ghost on. Constraints:
 *   - In a currently-loaded chunk
 *   - Walkable (FLOOR or WALL — the ghost AI handles surface heights)
 *   - Not within GHOST_MIN_SPAWN_DIST_TILES of Pacman (so spawns feel
 *     "elsewhere", not in your face)
 *   - Within GHOST_MAX_SPAWN_DIST_TILES of Pacman (avoids spawning in
 *     a corner of a chunk we don't actually look at)
 *
 * Returns null after a few attempts; the spawn timer will retry next
 * tick. Probabilistic, not exhaustive — spawning eventually happens
 * naturally as the player moves.
 */
export function pickGhostSpawnTile(world, pacmanPos, opts = {}) {
  const chunkList = Array.from(world.chunks.values());
  if (chunkList.length === 0) return null;
  // Difficulty-scaled minimum spawn distance: Hard pulls the floor in
  // (5 tiles instead of 7) so ghosts can pop in around the corner;
  // Easy pushes it out (9 tiles) so spawns always feel "elsewhere".
  // When opts.tighten is true (active rebalancing — too few ghosts
  // near the player), we further halve the minimum distance for *this
  // attempt only* so the new ghost actually arrives in the chase ring.
  const minDistTiles =
    GAMEPLAY.GHOST_MIN_SPAWN_DIST_TILES *
    (world.difficulty.ghostMinSpawnDistMul ?? 1.0) *
    (opts.tighten ? NEAR_SPAWN_DIST_TIGHTEN : 1.0);
  const minD = minDistTiles * world.scale;
  const maxD = GAMEPLAY.GHOST_MAX_SPAWN_DIST_TILES * world.scale;
  const minD2 = minD * minD;
  const maxD2 = maxD * maxD;

  for (let attempt = 0; attempt < 24; attempt++) {
    const chunk = chunkList[Math.floor(Math.random() * chunkList.length)];
    const lx = Math.floor(Math.random() * CHUNK_SIZE);
    const ly = Math.floor(Math.random() * CHUNK_SIZE);
    const tile = chunk.map[ly][lx];
    if (tile !== TILE.FLOOR) continue; // ghosts spawn on the ground, not on top of walls
    const gx = chunk.cx * CHUNK_SIZE + lx;
    const gy = chunk.cy * CHUNK_SIZE + ly;
    const wx = gx * world.scale;
    const wy = gy * world.scale;
    const dx = wx - pacmanPos.x;
    const dy = wy - pacmanPos.y;
    const d2 = dx * dx + dy * dy;
    if (d2 < minD2) continue;
    if (d2 > maxD2) continue;
    // Don't double-up: avoid spawning where another ghost is already
    // standing (rare, but feels janky if it happens).
    let collides = false;
    for (const g of world.ghosts) {
      if (g.gridX === gx && g.gridY === gy) {
        collides = true;
        break;
      }
    }
    if (collides) continue;
    return { gx, gy };
  }
  return null;
}

/**
 * Find the closest live red ghost to use as Inky's flank reference.
 * Returns { blinkyGridX, blinkyGridY } or empty object if no Blinky.
 */
export function findBlinkyReference(ghosts) {
  let best = null;
  let bestKey = Infinity;
  for (const g of ghosts) {
    if (g.personality !== PERSONALITY.BLINKY) continue;
    if (g.state === GHOST_STATE.EATEN) continue;
    // Lower gx+gy is arbitrary but deterministic — gives a stable pick
    // when multiple Blinkys exist (rare, but possible with the spawn pool).
    const key = g.gridX * 100000 + g.gridY;
    if (key < bestKey) {
      bestKey = key;
      best = g;
    }
  }
  if (!best) return {};
  return { blinkyGridX: best.gridX, blinkyGridY: best.gridY };
}

/**
 * Return a Set of the up-to-N ghosts closest to Pacman. Used to flag
 * which ghosts get BFS pathing this frame (cheap subset, expensive
 * brain). Squared-distance keeps the comparison branch-free.
 */
export function pickClosestGhosts(ghosts, pacmanPos, n) {
  if (n <= 0 || ghosts.size === 0) return new Set();
  const arr = [];
  for (const g of ghosts) {
    const dx = g.position.x - pacmanPos.x;
    const dy = g.position.y - pacmanPos.y;
    arr.push({ g, d2: dx * dx + dy * dy });
  }
  arr.sort((a, b) => a.d2 - b.d2);
  const out = new Set();
  for (let i = 0; i < Math.min(n, arr.length); i++) out.add(arr[i].g);
  return out;
}
