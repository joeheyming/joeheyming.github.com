/**
 * World — streamed infinite Pacman world built out of procedurally-selected
 * Chunks. Mirrors the public API surface of `Level` (the original single-maze
 * game's level class) so Pacman/Camera/Controls don't need to know they're
 * playing in a chunk-streamed world.
 *
 * Public API (used by game.js, pacman.js, camera.js):
 *   - scale, pacmanStart, ghostHome, teleports, dots, powerPills (props)
 *   - load() / addToScene(scene)                              (lifecycle)
 *   - gridToWorld(g), worldToGrid(w), getWorldPosition(x,y)   (coords)
 *   - isWalkable(gx, gy), canMoveTo(wx, wy, r), getNeighbors  (collision/AI)
 *   - allDotsCollected(), resetDots()                         (gameplay)
 *   - getCenter()                                             (camera)
 *   - update(time)                                            (animations)
 *
 * Plus chunk-streaming API specific to this world:
 *   - streamAround(pacmanWorldPos)         — load/unload chunks each frame
 *   - getLoadedChunkCount()
 *   - seed                                  — current world seed
 */

import * as THREE from 'three';
import { TILE, GAMEPLAY, GHOST_STATE } from './constants.js';
import { CHUNK_SIZE, CHUNK_TEMPLATES, generateChunk } from './templates.js';
import { Chunk } from './chunk.js';
import { Ghost, PERSONALITY } from './ghost.js';
import { mulberry32, hashCoords, randomSeed } from './prng.js';

const DEFAULT_RENDER_RADIUS = 2; // chunks: 5x5 grid loaded around player
const DEFAULT_UNLOAD_RADIUS = 3; // sweep boundary

// How many of the closest ghosts get BFS terrain-aware pathing each
// frame. The rest fall back to greedy nearest-neighbour selection. 3 is
// enough to make the immediate threat ring feel smart without paying
// BFS cost for ghosts the player can't even see yet.
const BFS_NEAREST_GHOST_COUNT = 3;

// Active spawn rebalancing: if fewer than this many ghosts sit within
// chase radius of Pacman, the next spawn attempt uses a tightened
// min-spawn-distance (× this multiplier) so the world doesn't get a
// lull just because the previous chasers wandered off.
const NEAR_GHOST_TARGET_FRACTION = 0.4; // 40% of cap should be "near"
const NEAR_SPAWN_DIST_TIGHTEN = 0.5; // tightens minD when we're under target

// Tier 3 — distance-from-origin survival pressure. The further Pacman
// wanders from spawn, the deadlier the world becomes. `farPct` is a
// 0..1 progress scalar (game.js updates it each frame); the *_BOOST
// constants below define how much each system intensifies at full
// progression. All clamped at FAR_CAP_TILES so the curve eventually
// flattens — past that point the world is "fully hard" without going
// into infinity-mode.
const FAR_CAP_TILES = 600;
const FAR_GHOST_SPEED_BOOST = 0.4; // ×1.4 ghost speed at the cap
const FAR_GHOST_COUNT_BOOST = 0.6; // ×1.6 ghost cap at the cap
const FAR_HUNGER_BOOST = 0.6; // ×1.6 hunger drain at the cap
const FAR_DOT_DENSITY_PENALTY = 0.7; // dotKeep × max(0.3, 1 − 0.7·farPct)
const FAR_SCORE_MULT_MAX = 5; // 5× at the cap
const FAR_SCORE_MULT_MIN = 1;

export class World {
  constructor(opts = {}) {
    this.seed = opts.seed != null ? opts.seed >>> 0 : randomSeed();
    this.scale = opts.scale ?? 10;
    this.renderRadius = opts.renderRadius ?? DEFAULT_RENDER_RADIUS;
    this.unloadRadius = opts.unloadRadius ?? DEFAULT_UNLOAD_RADIUS;

    // Set of "cx,cy,lx,ly" keys for dots already collected in a previous
    // session. Restored on every newly-built chunk so reloading a save
    // doesn't repopulate dots Pacman already ate. Game.js mutates this set
    // as new dots are collected so it stays in sync with the live world.
    /** @type {Set<string>} */
    this.eatenDots = opts.eatenDots ?? new Set();

    /** @type {Map<string, Chunk>} */
    this.chunks = new Map();
    /**
     * Live ghosts as a flat pool (Phase 3). Spawning is decoupled from
     * chunk lifetime — ghosts spawn at random walkable tiles around the
     * player, despawn when the player walks too far away, and never sit
     * on top of Pacman. Mirrors a Minecraft-style mob pool.
     * @type {Set<Ghost>}
     */
    this.ghosts = new Set();
    this._ghostSpawnTimer = 0; // counts down to next spawn attempt
    // Difficulty multipliers (live-tunable). Game sets these whenever
    // the player picks a new difficulty so ghost behaviour reacts
    // immediately. Defaults to 1.0 (Normal) until overridden.
    this.difficulty = {
      ghostSpeedMul: 1.0,
      ghostCountMul: 1.0,
      ghostChaseRadiusMul: 1.0,
      dotKeepMul: 1.0,
      // Tier 1 difficulty mults — runtime-synced from DIFFICULTY_PRESETS so
      // ghost.js / pacman.js can react without re-importing constants.
      fleeSpeedMul: GAMEPLAY.GHOST_FLEE_SPEED_MULTIPLIER,
      jumpCooldownMul: 1.0,
      ghostMinSpawnDistMul: 1.0,
      // Used by game-spawn.js when a power pill is eaten; cached here so
      // both Pacman's enterPowerMode and World.scareAllGhosts can read it.
      powerModeDurationS: GAMEPLAY.POWER_MODE_DURATION
    };
    this.scene = null;
    this.assets = null;
    this._lastPlayerChunk = null;
    // Animation clock for shared-asset effects (e.g., power pill pulse).
    this._animTime = 0;
    // Tier 3 — survival/runner identity. Distance-from-origin progress
    // scalar (0..1). Game.js writes this every frame from
    // sqrt(pacman.x² + pacman.y²) clamped to FAR_CAP_TILES. Ghost AI,
    // hunger, dot density, and the score multiplier all read it via the
    // `effective*` helpers below.
    this.farPct = 0;

    // Compat surface — keep field names that game.js / pacman.js expect.
    // Spawn at the centre of chunk (0, 0). All templates guarantee FLOOR at
    // the central cross row/col (lx=8, ly=8), so this is always walkable.
    this.pacmanStart = { x: CHUNK_SIZE / 2, y: CHUNK_SIZE / 2, level: 0 };
    this.ghostHome = [];
    this.teleports = [];
    this.powerPillLocations = [];
    // For an infinite world there's no fixed width/height; expose 0 as a sentinel
    // so anything that did `level.width * scale` for a "level center" gracefully
    // collapses to (0,0). game.js uses world.getCenter() instead.
    this.width = 0;
    this.height = 0;
  }

  /**
   * Mirrors Level.load() — async signature kept for parity, but no I/O happens.
   * Builds the shared materials / dot geometry; actual chunks are streamed in
   * by addToScene() / streamAround().
   */
  async load() {
    this.assets = createSharedAssets(this.scale);
  }

  /**
   * Attach to a Three.js scene and stream in the initial chunks. Pass an
   * explicit world-space origin to seed the first batch around (e.g. a
   * saved Pacman position); defaults to (0, 0, 0).
   */
  addToScene(scene, origin = null) {
    this.scene = scene;
    const o = origin ?? new THREE.Vector3(0, 0, 0);
    this.streamAround(o);
    // Seed a few ghosts immediately so a fresh game isn't empty for the
    // first 10 seconds of spawn-timer warm-up. The pool then maintains
    // itself.
    this._seedInitialGhosts(o);
  }

  /**
   * Spawn an initial batch of ghosts when the world first loads. Uses
   * the same placement rules as the runtime spawn loop, but front-loads
   * the population so a fresh game / continue resume always has a few
   * ghosts visible nearby (without being on top of Pacman).
   */
  _seedInitialGhosts(pacmanPos) {
    // farPct is 0 at boot so the effective cap == base, but read through
    // the helper for symmetry with the runtime spawn loop.
    const targetCap = Math.round(GAMEPLAY.GHOST_TARGET_COUNT * this.effectiveGhostCountMul());
    const target = Math.min(targetCap, 4);
    // Walk colorIdx through 0..3 in order so the initial pool guarantees
    // one of each personality whenever target ≥ 4 — important because
    // Inky's flank target is meaningless without a Blinky reference.
    let nextColorIdx = 0;
    for (let i = 0; i < target * 3; i++) {
      if (this.ghosts.size >= target) break;
      const spawn = this._pickGhostSpawnTile(pacmanPos);
      if (!spawn) continue;
      const colorIdx = nextColorIdx % 4;
      nextColorIdx++;
      const ghost = new Ghost({
        gridX: spawn.gx,
        gridY: spawn.gy,
        colorIdx,
        scale: this.scale,
        world: this
      });
      ghost.addToScene(this.scene);
      this.ghosts.add(ghost);
    }
    this._ghostSpawnTimer = this._randomSpawnInterval();
  }

  // ---------------------------------------------------------------------------
  // Tier 3 — distance-from-origin survival multipliers
  //
  // The base preset values on `this.difficulty` are "what the player
  // picked from the menu". The `effective*` helpers stack the
  // distance-from-origin penalty on top, producing the values the
  // runtime should actually use. Helpers (not direct field reads) keep
  // the formula in one place — every call site that touches a base
  // multiplier should call the matching helper instead.
  // ---------------------------------------------------------------------------

  effectiveGhostSpeedMul() {
    return this.difficulty.ghostSpeedMul * (1 + FAR_GHOST_SPEED_BOOST * this.farPct);
  }

  effectiveGhostCountMul() {
    return this.difficulty.ghostCountMul * (1 + FAR_GHOST_COUNT_BOOST * this.farPct);
  }

  effectiveHungerDrainMul() {
    return this.difficulty.hungerDrainMul * (1 + FAR_HUNGER_BOOST * this.farPct);
  }

  effectiveDotKeepMul() {
    return (
      this.difficulty.dotKeepMul * Math.max(0.3, 1 - FAR_DOT_DENSITY_PENALTY * this.farPct)
    );
  }

  /**
   * Distance-scaled score multiplier (1× near origin → 5× at the cap).
   * Used by game-spawn.js when crediting any score-bearing event so the
   * "press deeper for richer rewards" loop stays consistent across all
   * pickup types.
   */
  scoreMultiplier() {
    return FAR_SCORE_MULT_MIN + (FAR_SCORE_MULT_MAX - FAR_SCORE_MULT_MIN) * this.farPct;
  }

  /**
   * Convenience for HUD: how far Pacman is from spawn, in tile-units.
   * Falls back to 0 if the world hasn't been ticked yet.
   */
  farTilesFromOrigin() {
    return this.farPct * FAR_CAP_TILES;
  }

  /**
   * Distance at which all `far*` penalties max out. Exposed for the HUD
   * (so we can show "X / cap" tile progress) and for game.js (which
   * computes farPct from Pacman's world position each frame).
   */
  getFarCapTiles() {
    return FAR_CAP_TILES;
  }

  /**
   * Update the survival-pressure progress scalar from Pacman's current
   * distance from the world origin (in tile-units). Clamped to [0, 1]
   * so callers don't have to.
   */
  updateFarProgress(distTiles) {
    const cap = FAR_CAP_TILES;
    this.farPct = Math.max(0, Math.min(1, distTiles / cap));
  }

  // ---------------------------------------------------------------------------
  // Coordinate helpers (Level parity)
  // ---------------------------------------------------------------------------

  gridToWorld(gridCoord) {
    return gridCoord * this.scale;
  }

  worldToGrid(worldCoord) {
    return Math.round(worldCoord / this.scale);
  }

  getWorldPosition(gridX, gridY) {
    return new THREE.Vector3(this.gridToWorld(gridX), this.gridToWorld(gridY), this.scale / 2);
  }

  /** Get the centre of the (currently visible) world for camera framing. */
  getCenter() {
    if (!this._lastPlayerChunk) return new THREE.Vector3(0, 0, 0);
    const cx = this._lastPlayerChunk.cx;
    const cy = this._lastPlayerChunk.cy;
    return new THREE.Vector3(
      (cx + 0.5) * CHUNK_SIZE * this.scale - this.scale / 2,
      (cy + 0.5) * CHUNK_SIZE * this.scale - this.scale / 2,
      0
    );
  }

  // ---------------------------------------------------------------------------
  // Tile lookup + collision (Level parity)
  // ---------------------------------------------------------------------------

  /**
   * Tile at a given GLOBAL grid coordinate. Unloaded chunks read as WALL
   * (treated as solid so Pacman can't ghost into ungenerated territory).
   */
  tileAt(globalGridX, globalGridY) {
    const chunk = this._chunkAt(globalGridX, globalGridY);
    if (!chunk) return TILE.WALL;
    const lx = globalGridX - chunk.cx * CHUNK_SIZE;
    const ly = globalGridY - chunk.cy * CHUNK_SIZE;
    return chunk.map[ly][lx];
  }

  /**
   * Height of a tile in tile-units (integer). Returns the *raw* `heights`
   * value for FLOOR/WALL; VOID returns NaN. NB: walls are physically 1 tile
   * taller than this — use `surfaceHeightAt()` for the walkable z height.
   */
  heightAt(globalGridX, globalGridY) {
    const chunk = this._chunkAt(globalGridX, globalGridY);
    if (!chunk) return 0;
    const lx = globalGridX - chunk.cx * CHUNK_SIZE;
    const ly = globalGridY - chunk.cy * CHUNK_SIZE;
    if (chunk.map[ly][lx] === TILE.VOID) return NaN;
    return chunk.heights[ly][lx];
  }

  /**
   * Walkable surface height (in tile-units) of the tile at (gx, gy):
   *   FLOOR(h) → h
   *   WALL(h)  → h + 1   (walls are 1 tile taller than their `heights` value)
   *   VOID     → NaN
   *   unloaded chunk → +Infinity (treated as an impassable tower)
   *
   * This is the function the movement logic uses to decide whether Pacman
   * can step onto a tile. The FLOOR/WALL distinction is otherwise purely
   * cosmetic.
   */
  surfaceHeightAt(globalGridX, globalGridY) {
    const chunk = this._chunkAt(globalGridX, globalGridY);
    if (!chunk) return Infinity;
    const lx = globalGridX - chunk.cx * CHUNK_SIZE;
    const ly = globalGridY - chunk.cy * CHUNK_SIZE;
    const tile = chunk.map[ly][lx];
    if (tile === TILE.VOID) return NaN;
    return chunk.heights[ly][lx] + (tile === TILE.WALL ? 1 : 0);
  }

  isVoid(gridX, gridY) {
    return this.tileAt(gridX, gridY) === TILE.VOID;
  }

  /**
   * Convenience: is the tile at (gx, gy) something Pacman could plausibly
   * stand on (FLOOR or WALL)? This is the new "block-friendly" replacement
   * for the FLOOR-only walkability check.
   */
  isWalkable(gridX, gridY) {
    const t = this.tileAt(gridX, gridY);
    return t === TILE.FLOOR || t === TILE.WALL;
  }

  /**
   * Pick a uniformly-random FLOOR tile from any currently-loaded chunk.
   * Used as the respawn site after death.
   *   @returns {{ gridX: number, gridY: number, height: number } | null}
   */
  randomLoadedFloor() {
    const chunks = [...this.chunks.values()];
    if (chunks.length === 0) return null;
    // Try a bounded number of dart-throws before falling back to a deterministic scan.
    for (let attempt = 0; attempt < 64; attempt++) {
      const chunk = chunks[Math.floor(Math.random() * chunks.length)];
      const lx = Math.floor(Math.random() * CHUNK_SIZE);
      const ly = Math.floor(Math.random() * CHUNK_SIZE);
      if (chunk.map[ly][lx] === TILE.FLOOR) {
        return {
          gridX: chunk.cx * CHUNK_SIZE + lx,
          gridY: chunk.cy * CHUNK_SIZE + ly,
          height: chunk.heights[ly][lx]
        };
      }
    }
    // Fallback: scan deterministically. Every chunk has a FLOOR cross by
    // contract so this always succeeds.
    for (const chunk of chunks) {
      for (let ly = 0; ly < CHUNK_SIZE; ly++) {
        for (let lx = 0; lx < CHUNK_SIZE; lx++) {
          if (chunk.map[ly][lx] === TILE.FLOOR) {
            return {
              gridX: chunk.cx * CHUNK_SIZE + lx,
              gridY: chunk.cy * CHUNK_SIZE + ly,
              height: chunk.heights[ly][lx]
            };
          }
        }
      }
    }
    return null;
  }

  /**
   * AABB collision against any unclimbable cliff near (worldX, worldY).
   *
   * Movement model (Phase 2a, revised):
   *   - All tiles are blocks. Pacman walks on their tops at `surfaceHeight`.
   *   - On the ground, he can transition to an adjacent tile if
   *     |surface_target - surface_current| ≤ STEP_LIMIT (1 tile).
   *   - Tiles whose surface is more than STEP_LIMIT above Pacman act as
   *     *cliffs* — they block his AABB just like the old "walls" did.
   *   - VOID tiles let Pacman slide off the edge (he'll die on landing).
   *   - Airborne movement (mid-jump) ignores cliff AABB up to JUMP_REACH
   *     above his current surface, so he can clear short walls and jump
   *     across short gaps.
   *
   * @param {number} worldX
   * @param {number} worldY
   * @param {number} radius - entity collision radius
   * @param {object} [opts]
   * @param {number} [opts.currentHeight] - entity's current surface height
   * @param {boolean} [opts.airborne] - whether the entity is mid-jump
   */
  canMoveTo(worldX, worldY, radius, opts = {}) {
    const currentHeight = opts.currentHeight ?? 0;
    const airborne = opts.airborne ?? false;
    const fromX = opts.fromX;
    const fromY = opts.fromY;
    const STEP_LIMIT = 1;
    const JUMP_REACH = 1; // matches GAMEPLAY.PACMAN_JUMP_HEIGHT
    const reach = airborne ? STEP_LIMIT + JUMP_REACH : STEP_LIMIT;

    const gx = this.worldToGrid(worldX);
    const gy = this.worldToGrid(worldY);
    const half = this.scale / 2;

    // Cliff AABB: any neighbouring tile whose surface is too far above us
    // physically blocks our motion (we can't walk into a cliff face).
    //
    // BUT: if we're already overlapping a cliff (e.g. just landed from a
    // jump and our bounding circle slightly clips the neighbouring cliff
    // face), we must still allow movement that REDUCES the overlap.
    // Otherwise the player gets stuck — every direction is "blocked" and
    // they can't walk away from the cliff. We use the optional fromX/fromY
    // (the previous frame's position) to detect this case.
    const cells = [
      [gx, gy],
      [gx - 1, gy],
      [gx + 1, gy],
      [gx, gy - 1],
      [gx, gy + 1]
    ];
    for (const [cx, cy] of cells) {
      const surf = this.surfaceHeightAt(cx, cy);
      if (Number.isNaN(surf)) continue; // VOID — handled by Pacman's update
      if (surf - currentHeight <= reach) continue; // climbable, no block
      const wcx = this.gridToWorld(cx);
      const wcy = this.gridToWorld(cy);
      const overlapsNew =
        worldX + radius > wcx - half &&
        worldX - radius < wcx + half &&
        worldY + radius > wcy - half &&
        worldY - radius < wcy + half;
      if (!overlapsNew) continue;
      // Already-overlapping rescue: if we know where we came from and the
      // proposed move pushes us AWAY from this cliff (penetration depth
      // decreases on at least one axis), allow it. This unsticks Pacman
      // after dropping next to a tall mountain or canyon wall.
      if (typeof fromX === 'number' && typeof fromY === 'number') {
        const newPenX = Math.max(0, radius - Math.abs(worldX - wcx) + half);
        const oldPenX = Math.max(0, radius - Math.abs(fromX - wcx) + half);
        const newPenY = Math.max(0, radius - Math.abs(worldY - wcy) + half);
        const oldPenY = Math.max(0, radius - Math.abs(fromY - wcy) + half);
        const newPen = newPenX + newPenY;
        const oldPen = oldPenX + oldPenY;
        if (newPen < oldPen) continue; // moving AWAY from cliff — allow
      }
      return false;
    }

    return true;
  }

  getNeighbors(gridX, gridY) {
    const out = [];
    const dirs = [
      [0, 1],
      [0, -1],
      [1, 0],
      [-1, 0]
    ];
    const here = this.surfaceHeightAt(gridX, gridY);
    for (const [dx, dy] of dirs) {
      const nx = gridX + dx;
      const ny = gridY + dy;
      const surf = this.surfaceHeightAt(nx, ny);
      if (Number.isNaN(surf) || !Number.isFinite(surf)) continue;
      // Only include auto-step-reachable neighbours (|Δsurf| ≤ 1) so future
      // ghost AI doesn't try to climb cliffs it can't reach.
      if (Math.abs(surf - here) > 1) continue;
      out.push({ x: nx, y: ny });
    }
    return out;
  }

  _chunkAt(globalGridX, globalGridY) {
    const cx = Math.floor(globalGridX / CHUNK_SIZE);
    const cy = Math.floor(globalGridY / CHUNK_SIZE);
    return this.chunks.get(chunkKey(cx, cy)) ?? null;
  }

  // ---------------------------------------------------------------------------
  // Streaming
  // ---------------------------------------------------------------------------

  /**
   * Update loaded chunks based on Pacman's current position.
   * Called every frame from game.js. Cheap when Pacman hasn't crossed a
   * chunk boundary since last call — we early-out on the same chunk.
   */
  streamAround(pacmanWorldPos) {
    if (!this.scene) return;
    const cellSize = CHUNK_SIZE * this.scale;
    const pcx = Math.floor(pacmanWorldPos.x / cellSize);
    const pcy = Math.floor(pacmanWorldPos.y / cellSize);

    if (
      this._lastPlayerChunk &&
      this._lastPlayerChunk.cx === pcx &&
      this._lastPlayerChunk.cy === pcy &&
      this.chunks.size > 0
    ) {
      return;
    }
    this._lastPlayerChunk = { cx: pcx, cy: pcy };

    // Load missing chunks within renderRadius.
    for (let dx = -this.renderRadius; dx <= this.renderRadius; dx++) {
      for (let dy = -this.renderRadius; dy <= this.renderRadius; dy++) {
        const cx = pcx + dx;
        const cy = pcy + dy;
        const k = chunkKey(cx, cy);
        if (this.chunks.has(k)) continue;
        const chunk = this._makeChunk(cx, cy);
        chunk.build();
        // Hide dots already eaten in previous sessions before showing the
        // chunk. Cheap when the set is empty; otherwise an O(dots) walk.
        chunk.applyEatenSet(this.eatenDots);
        chunk.addToScene(this.scene);
        this.chunks.set(k, chunk);
      }
    }

    // Unload chunks beyond unloadRadius. Ghosts are no longer tied to
    // chunk lifetime — see _tickGhostSpawning + _cullGhosts in update().
    for (const [k, c] of this.chunks) {
      const dist = Math.max(Math.abs(c.cx - pcx), Math.abs(c.cy - pcy));
      if (dist > this.unloadRadius) {
        c.removeFromScene(this.scene);
        c.dispose();
        this.chunks.delete(k);
      }
    }
  }

  // ---------------------------------------------------------------------------
  // Ghost pool (Phase 3, Minecraft-style)
  //
  // The pool is regulated three ways:
  //   1. _cullGhosts:      despawns ghosts farther than CULL_DIST_TILES from
  //                        the player. Frees memory as the player walks away.
  //   2. _disposeEatenGhosts: clears ghosts whose state machine flagged
  //                        themselves shouldDespawn (eaten + delay).
  //   3. _tickGhostSpawning: with a jittered timer, when below the soft
  //                        target count, picks a random walkable tile in
  //                        a loaded chunk that's outside MIN_SPAWN_DIST
  //                        and inside MAX_SPAWN_DIST tiles of the player,
  //                        and spawns one ghost there.
  // ---------------------------------------------------------------------------

  _disposeEatenGhosts() {
    for (const g of this.ghosts) {
      if (g.shouldDespawn) {
        g.removeFromScene(this.scene);
        g.dispose();
        this.ghosts.delete(g);
      }
    }
  }

  _cullGhosts(pacmanPos) {
    const cullR = GAMEPLAY.GHOST_CULL_DIST_TILES * this.scale;
    const cullR2 = cullR * cullR;
    for (const g of this.ghosts) {
      const dx = g.position.x - pacmanPos.x;
      const dy = g.position.y - pacmanPos.y;
      if (dx * dx + dy * dy > cullR2) {
        g.removeFromScene(this.scene);
        g.dispose();
        this.ghosts.delete(g);
      }
    }
  }

  _tickGhostSpawning(dt, pacmanPos, powerInfo) {
    this._ghostSpawnTimer -= dt;
    if (this._ghostSpawnTimer > 0) return;
    // Re-roll the timer to a random interval. Even if we don't end up
    // spawning this attempt (cap reached, no valid tile), the next
    // attempt is also delayed so we don't churn.
    this._ghostSpawnTimer = this._randomSpawnInterval();
    // Distance-scaled population cap: the deeper Pacman wanders the more
    // ghosts the world will keep alive around him. Capped by the
    // effective helper (base × farPct boost).
    const cap = Math.round(GAMEPLAY.GHOST_TARGET_COUNT * this.effectiveGhostCountMul());
    if (this.ghosts.size >= cap) return;

    // Active spawn rebalancing — count ghosts within chase radius. If we
    // have fewer "near" ghosts than NEAR_GHOST_TARGET_FRACTION of the
    // soft cap, this spawn attempt uses a tightened minimum spawn
    // distance so the new ghost actually arrives near Pacman, not at
    // the spawn-ring horizon. Keeps pressure constant even if a chase
    // pack just despawned (fled / culled by distance).
    const chaseR =
      GAMEPLAY.GHOST_CHASE_RADIUS * this.scale * this.difficulty.ghostChaseRadiusMul;
    const chaseR2 = chaseR * chaseR;
    let nearCount = 0;
    for (const g of this.ghosts) {
      const dx = g.position.x - pacmanPos.x;
      const dy = g.position.y - pacmanPos.y;
      if (dx * dx + dy * dy <= chaseR2) nearCount++;
    }
    const nearTarget = Math.max(1, Math.round(cap * NEAR_GHOST_TARGET_FRACTION));
    const tightenSpawn = nearCount < nearTarget;

    const spawn = this._pickGhostSpawnTile(pacmanPos, { tighten: tightenSpawn });
    if (!spawn) return;

    // Colour: chunk-derived so a given tile in a given world reliably
    // produces the same ghost colour. Adds visual consistency without
    // making spawn TIMES predictable.
    const colorIdx = (hashCoords(this.seed ^ 0xa5a5a5a5, spawn.gx, spawn.gy) >>> 0) % 4;
    const ghost = new Ghost({
      gridX: spawn.gx,
      gridY: spawn.gy,
      colorIdx,
      scale: this.scale,
      world: this
    });
    ghost.addToScene(this.scene);
    this.ghosts.add(ghost);
    // Pacman is mid-power-mode → flip the new ghost straight to FLEE
    // for the remaining duration so it shows up blue, matching the
    // ghosts that were already on the map when the pill was eaten.
    if (powerInfo && powerInfo.powered && powerInfo.powerTimer > 0) {
      ghost.enterFlee(powerInfo.powerTimer);
    }
  }

  _randomSpawnInterval() {
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
  _pickGhostSpawnTile(pacmanPos, opts = {}) {
    const chunkList = Array.from(this.chunks.values());
    if (chunkList.length === 0) return null;
    // Difficulty-scaled minimum spawn distance: Hard pulls the floor in
    // (5 tiles instead of 7) so ghosts can pop in around the corner;
    // Easy pushes it out (9 tiles) so spawns always feel "elsewhere".
    // When opts.tighten is true (active rebalancing — too few ghosts
    // near the player), we further halve the minimum distance for *this
    // attempt only* so the new ghost actually arrives in the chase ring.
    const minDistTiles =
      GAMEPLAY.GHOST_MIN_SPAWN_DIST_TILES *
      (this.difficulty.ghostMinSpawnDistMul ?? 1.0) *
      (opts.tighten ? NEAR_SPAWN_DIST_TIGHTEN : 1.0);
    const minD = minDistTiles * this.scale;
    const maxD = GAMEPLAY.GHOST_MAX_SPAWN_DIST_TILES * this.scale;
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
      const wx = gx * this.scale;
      const wy = gy * this.scale;
      const dx = wx - pacmanPos.x;
      const dy = wy - pacmanPos.y;
      const d2 = dx * dx + dy * dy;
      if (d2 < minD2) continue;
      if (d2 > maxD2) continue;
      // Don't double-up: avoid spawning where another ghost is already
      // standing (rare, but feels janky if it happens).
      let collides = false;
      for (const g of this.ghosts) {
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

  /** Force-clear all ghosts. Used on game-over → menu transitions. */
  clearGhosts() {
    for (const g of this.ghosts) {
      g.removeFromScene(this.scene);
      g.dispose();
    }
    this.ghosts.clear();
    this._ghostSpawnTimer = 0;
  }

  /**
   * Produce a chunk. The first PRNG draw decides whether this slot uses a
   * hand-authored template (the originals tuned to feel iconic) or a
   * procedurally generated one (infinite variety). The mix is biased
   * toward procedural so the world doesn't feel template-repeated, but
   * the curated layouts still appear often enough to anchor the
   * visual identity.
   */
  _makeChunk(cx, cy) {
    const rng = mulberry32(hashCoords(this.seed, cx, cy));
    // Heavily favour procedural now that there's enough biome variety
    // (mountains, valleys, canyons, ridges, …). Keep a small slice of
    // hand-authored templates so the iconic ghost-room / fruit-spawn
    // layouts still surface and the world has familiar landmarks.
    const useProcedural = rng() < 0.85;
    const template = useProcedural
      ? generateChunk(rng)
      : CHUNK_TEMPLATES[Math.floor(rng() * CHUNK_TEMPLATES.length)];
    // Difficulty + distance both scale pellet density: easy/origin gets
    // lots of dots, hard/far chunks are sparse. Base 30% × effective
    // multiplier (which folds farPct into difficulty.dotKeepMul),
    // clamped so even the worst case has SOME dots off the cross
    // corridor.
    const baseKeep = 30;
    const dotKeepPercent = Math.max(
      5,
      Math.min(80, Math.round(baseKeep * this.effectiveDotKeepMul()))
    );
    return new Chunk(cx, cy, template, this.scale, this.assets, { dotKeepPercent });
  }

  getLoadedChunkCount() {
    return this.chunks.size;
  }

  // ---------------------------------------------------------------------------
  // Dots + animation (Level parity)
  // ---------------------------------------------------------------------------

  /** Aggregate view of every dot mesh across all loaded chunks. */
  get dots() {
    const all = [];
    for (const c of this.chunks.values()) {
      for (const d of c.dots) all.push(d);
    }
    return all;
  }

  /** Empty in the MVP — power pills are deferred to a later phase. */
  get powerPills() {
    return [];
  }

  resetDots() {
    for (const c of this.chunks.values()) {
      for (const d of c.dots) {
        d.visible = true;
        d.userData.collected = false;
      }
    }
  }

  /** An infinite world has no win condition. */
  allDotsCollected() {
    return false;
  }

  /** Iterable over all live ghosts. Game.js loops this for collision checks. */
  getGhosts() {
    return this.ghosts;
  }

  /**
   * Frame tick — drives ghost AI, the shared power-pill pulse animation,
   * and the Minecraft-style ghost spawn pool (spawn → cull → eaten
   * cleanup).
   *
   * @param {number} dt - seconds since last frame
   * @param {THREE.Vector3} pacmanPos - current Pacman world position
   * @param {{ powered: boolean, powerTimer: number } | undefined} powerInfo
   *        Optional power-mode state. When `powered === true`, any ghost
   *        spawned this frame is dropped straight into FLEE for the
   *        remaining `powerTimer` seconds — otherwise a new ghost would
   *        appear normal-coloured even though Pacman is still powered.
   */
  update(dt, pacmanPos, powerInfo) {
    this._animTime += dt;
    // Pulse the power-pill emissive intensity. All pills share one
    // material so we only update once per frame regardless of pill count.
    if (this.assets?.pillMaterial) {
      const t = this._animTime * 5; // ~0.8Hz visual pulse
      this.assets.pillMaterial.emissiveIntensity = 0.5 + 0.45 * (0.5 + 0.5 * Math.sin(t));
    }
    if (!pacmanPos) return;

    // Build the per-frame ghost context exactly once. Ghosts read it to
    // resolve personality targets (Pinky needs Pacman's facing, Inky
    // needs Blinky's tile) and to decide whether to run BFS. Computing
    // once-per-frame keeps the inner ghost loop cheap.
    const ctxBase = {
      pacmanGridX: this.worldToGrid(pacmanPos.x),
      pacmanGridY: this.worldToGrid(pacmanPos.y),
      pacmanFacing: powerInfo?.pacmanFacing ?? null,
      ...this._findBlinkyReference()
    };

    // Tag the N closest ghosts with useBfs. They get terrain-aware
    // pathing so they don't bonk into cliffs when chasing through hilly
    // chunks. The rest fall back to greedy.
    const bfsGhosts = this._pickClosestGhosts(pacmanPos, BFS_NEAREST_GHOST_COUNT);

    // Tick AI for every live ghost.
    for (const g of this.ghosts) {
      const useBfs = bfsGhosts.has(g);
      g.update(dt, pacmanPos, { ...ctxBase, useBfs });
    }

    // Pool maintenance — order matters: dispose eaten first so they don't
    // count against the population cap, then cull anyone too far away,
    // then maybe spawn one new ghost to keep the area populated.
    this._disposeEatenGhosts();
    this._cullGhosts(pacmanPos);
    this._tickGhostSpawning(dt, pacmanPos, powerInfo);
  }

  /**
   * Find the closest live red ghost to use as Inky's flank reference.
   * Returns { blinkyGridX, blinkyGridY } or empty object if no Blinky.
   */
  _findBlinkyReference() {
    let best = null;
    let bestKey = Infinity;
    for (const g of this.ghosts) {
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
  _pickClosestGhosts(pacmanPos, n) {
    if (n <= 0 || this.ghosts.size === 0) return new Set();
    const arr = [];
    for (const g of this.ghosts) {
      const dx = g.position.x - pacmanPos.x;
      const dy = g.position.y - pacmanPos.y;
      arr.push({ g, d2: dx * dx + dy * dy });
    }
    arr.sort((a, b) => a.d2 - b.d2);
    const out = new Set();
    for (let i = 0; i < Math.min(n, arr.length); i++) out.add(arr[i].g);
    return out;
  }

  /**
   * Switch every live ghost in WANDER/CHASE to FLEE for `durationS`
   * seconds. Called when Pacman eats a power pill.
   */
  scareAllGhosts(durationS) {
    for (const g of this.ghosts) {
      g.enterFlee(durationS);
    }
  }

  /** Force all FLEE ghosts back to WANDER (used when power mode ends early). */
  unscareAllGhosts() {
    for (const g of this.ghosts) {
      g.exitFlee();
    }
  }
}

function chunkKey(cx, cy) {
  return `${cx},${cy}`;
}

/**
 * Build a procedural canvas texture that looks like a wall of building
 * windows when tiled vertically. Per-pixel window pattern is drawn once
 * at boot and re-used for every wall tile in every chunk.
 *
 * The texture itself is one "building floor" tall — in combination with
 * the per-tile UV V-scaling in chunk.buildWalls(), a 4-tile-tall mountain
 * gets 4 rows of windows stacked, reading as a 4-storey building.
 */
function createBuildingWindowTexture() {
  const SIZE = 128;
  const COLS = 3; // windows across one tile width
  const c = document.createElement('canvas');
  c.width = SIZE;
  c.height = SIZE;
  const ctx = c.getContext('2d');
  // Wall background — dark navy "facade" so the windows pop.
  ctx.fillStyle = '#0e1840';
  ctx.fillRect(0, 0, SIZE, SIZE);
  // Faint mortar / floor-divider line at the top of the tile.
  ctx.fillStyle = 'rgba(0,0,0,0.5)';
  ctx.fillRect(0, 0, SIZE, 4);
  // Vertical column gutters (between windows) for depth.
  ctx.fillStyle = 'rgba(0,0,0,0.35)';
  for (let i = 1; i < COLS; i++) {
    const x = (SIZE / COLS) * i - 1;
    ctx.fillRect(x, 0, 2, SIZE);
  }
  // Window grid. One row per tile-unit, with the windows centered
  // vertically so the texture tiles cleanly when V repeats.
  const cellW = SIZE / COLS;
  const winW = cellW * 0.6;
  const winH = SIZE * 0.55;
  const yStart = SIZE * 0.2;
  for (let i = 0; i < COLS; i++) {
    const x = i * cellW + (cellW - winW) / 2;
    const y = yStart;
    // Pseudo-random lit pattern (deterministic per column index) so it
    // looks like real windows without "every window lit" uniformity.
    const lit = (i * 37 + 11) % 4 < 3;
    if (lit) {
      // Bright warm yellow window with a soft glow halo.
      ctx.fillStyle = 'rgba(255, 220, 110, 0.35)';
      ctx.fillRect(x - 6, y - 6, winW + 12, winH + 12);
      ctx.fillStyle = '#ffe080';
    } else {
      ctx.fillStyle = '#070a18';
    }
    ctx.fillRect(x, y, winW, winH);
    // Window cross-mullions for that "office tower" look.
    ctx.strokeStyle = 'rgba(0,0,0,0.7)';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(x + winW / 2, y);
    ctx.lineTo(x + winW / 2, y + winH);
    ctx.moveTo(x, y + winH / 2);
    ctx.lineTo(x + winW, y + winH / 2);
    ctx.stroke();
  }
  const tex = new THREE.CanvasTexture(c);
  tex.wrapS = THREE.RepeatWrapping;
  tex.wrapT = THREE.RepeatWrapping;
  tex.magFilter = THREE.LinearFilter;
  tex.minFilter = THREE.LinearMipmapLinearFilter;
  tex.anisotropy = 4;
  return tex;
}

/**
 * Create the materials + dot geometry that every chunk shares. Centralising
 * these means we only allocate the GL resources once per world, not per chunk.
 */
function createSharedAssets(scale) {
  // Two wall flavours, picked per-tile in chunk.buildWalls() based on
  // the tile's stack height:
  //   - HOUSES  (short walls, stackUnits ≤ 2): textured with a window
  //     grid → reads as a low-rise village.
  //   - MOUNTAIN (tall walls, stackUnits ≥ 3): plain rocky grey with
  //     no windows → reads as a cliff/peak rather than a giant tower.
  const wallTexture = createBuildingWindowTexture();
  const wallMaterial = new THREE.MeshStandardMaterial({
    color: 0xffffff, // texture provides the colour; keep tint neutral
    roughness: 0.6,
    metalness: 0.05,
    // Emissive map = same texture, so the LIT WINDOWS glow against the
    // dark facade. Modest base intensity — the lit pixels already pop.
    emissive: 0xffffff,
    emissiveIntensity: 0.35,
    map: wallTexture,
    emissiveMap: wallTexture
  });
  // Mountain rock: cool slate-grey with a hint of blue so it harmonises
  // with the rest of the palette (which is mostly blue). High roughness
  // and zero metalness keep it matte — natural stone, not building.
  const mountainMaterial = new THREE.MeshStandardMaterial({
    color: 0x55607a,
    roughness: 0.95,
    metalness: 0.0,
    emissive: 0x111722,
    emissiveIntensity: 0.2
  });

  // Floors: lighter steel-blue, distinct from walls but visibly part of the
  // same family. Was 0x2a2a3a (almost black) which made elevated terrain
  // (e.g. the terraced pyramid) silhouette into the dark sky.
  const floorMaterial = new THREE.MeshStandardMaterial({
    color: 0x6080b0,
    roughness: 0.7,
    metalness: 0.0,
    emissive: 0x182840,
    emissiveIntensity: 0.2
  });

  const dotMaterial = new THREE.MeshStandardMaterial({
    color: 0xffffaa,
    emissive: 0xffff88,
    emissiveIntensity: 0.6,
    roughness: 0.2,
    metalness: 0.3
  });

  // Bump dot radius from 0.08 → 0.13 of a tile so individual pellets read
  // from farther away — important now that they're sparser.
  const dotGeometry = new THREE.SphereGeometry(scale * 0.13, 8, 8);

  // Power pill — clearly distinct from regular dots: ~3× size, magenta,
  // strong emissive that gets pulsed by World.update().
  const pillMaterial = new THREE.MeshStandardMaterial({
    color: 0xff80ff,
    emissive: 0xff40ff,
    emissiveIntensity: 0.7,
    roughness: 0.3,
    metalness: 0.4
  });
  const pillGeometry = new THREE.SphereGeometry(scale * 0.32, 16, 12);

  return {
    wallMaterial,
    mountainMaterial,
    floorMaterial,
    dotMaterial,
    dotGeometry,
    pillMaterial,
    pillGeometry
  };
}
