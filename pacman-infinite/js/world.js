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
import { TILE, HAZARD_TILES, GAMEPLAY } from './constants.js';
import { HAZARD_BY_CODE } from './world-config.js';
import { CHUNK_SIZE, CHUNK_TEMPLATES, generateChunk } from './templates.js';
import { Chunk } from './chunk.js';
import { mulberry32, hashCoords, randomSeed } from './prng.js';
import {
  DEFAULT_RENDER_RADIUS,
  DEFAULT_UNLOAD_RADIUS,
  BFS_NEAREST_GHOST_COUNT,
  FAR_CAP_TILES,
  FAR_GHOST_SPEED_BOOST,
  FAR_GHOST_COUNT_BOOST,
  FAR_HUNGER_BOOST,
  FAR_DOT_DENSITY_PENALTY,
  FAR_SCORE_MULT_MAX,
  FAR_SCORE_MULT_MIN
} from './world-constants.js';
import { chunkKey, createSharedAssets } from './world-assets.js';
import {
  seedInitialGhosts,
  disposeEatenGhosts,
  cullGhosts,
  tickGhostSpawning,
  findBlinkyReference,
  pickClosestGhosts
} from './world-ghost-pool.js';

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
      crossDotKeepMul: 1.0,
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

  _seedInitialGhosts(pacmanPos) {
    seedInitialGhosts(this, pacmanPos);
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
   * Probability that a hazard-bearing biome (lake/lava/swamp/…) is
   * accepted when rolling a new chunk. Stacks the base preset
   * (`difficulty.hazardDensityMul`) on top of farPct so deep chunks
   * lean more hazardous regardless of preset. Clamped above 0 so easy
   * mode still sees occasional hazards on a long run.
   */
  effectiveHazardDensityMul() {
    const base = this.difficulty.hazardDensityMul ?? 1.0;
    return base * (1 + 0.5 * this.farPct);
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
   *   WATER(h) → h       (top edge of the pit — see `pacmanSurfaceHeightAt`
   *                       for the lower height Pacman actually stands at)
   *   LAVA(h)  → h       (Pacman can step on it then dies; ghosts blocked)
   *   MUD(h)   → h       (slow but otherwise walkable)
   *   VOID     → NaN
   *   unloaded chunk → +Infinity (treated as an impassable tower)
   *
   * This is the **floor-edge** height. Cliff/AABB checks (`canMoveTo`),
   * ghost movement (`_reachableNeighbors`, `_bfsNextStepToward`), dot
   * placement, and fruit hover all read this — they want to treat the
   * top edge of a water pit as the surface so ghosts float over water,
   * floors next to a pit don't bonk the wading Pacman with a cliff
   * face, and so on.
   *
   * For the height **Pacman actually stands at** (which sinks below the
   * floor edge for water/lava — that's the "fall into" terrain) use
   * `pacmanSurfaceHeightAt`.
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

  /**
   * Surface height **for Pacman specifically**. Identical to
   * `surfaceHeightAt` for FLOOR/WALL, but for hazards with
   * `HAZARDS[id].pacmanSink > 0` (today: water + lava) the result
   * drops by `pacmanSink` tiles so Pacman physically falls into the
   * pit instead of skating across the top.
   *
   * The auto-step (|Δh| ≤ 1) handles dropping in / climbing out
   * automatically: a 0.5-deep pool is a 0.5-tile step in either
   * direction. Climbing onto a tall wall **from** a pit (Δh = 1.5)
   * still requires a jump — wading slows your escape, which matches
   * the "water is a real terrain hazard" intuition.
   *
   * Ghosts deliberately do NOT use this — their movement still reads
   * `surfaceHeightAt` so they keep floating at floor level over water
   * (matches the asymmetric-hazard design where Pacman wades and
   * ghosts skim).
   */
  pacmanSurfaceHeightAt(globalGridX, globalGridY) {
    const chunk = this._chunkAt(globalGridX, globalGridY);
    if (!chunk) return Infinity;
    const lx = globalGridX - chunk.cx * CHUNK_SIZE;
    const ly = globalGridY - chunk.cy * CHUNK_SIZE;
    const tile = chunk.map[ly][lx];
    if (tile === TILE.VOID) return NaN;
    if (tile === TILE.WALL) return chunk.heights[ly][lx] + 1;
    const haz = HAZARD_BY_CODE.get(tile);
    const sink = haz?.pacmanSink ?? 0;
    return chunk.heights[ly][lx] - sink;
  }

  /**
   * The hazard kind at (gx, gy) — returns the HAZARDS registry SPEC for
   * the tile (full object with `id`, `pacman`, `ghost`, `material` …),
   * or null if the tile is benign. Cheap (one tileAt + Map.get).
   *
   * Callers used to receive a raw tile-code number here. They now get
   * the spec; use `.id` for the hazard kind name or `.tileCode` for the
   * raw number. Returning the spec means consumers don't need a second
   * lookup to read effects.
   */
  hazardAt(globalGridX, globalGridY) {
    const t = this.tileAt(globalGridX, globalGridY);
    return HAZARD_BY_CODE.get(t) ?? null;
  }

  /**
   * Can a ghost legally occupy this tile? Mirrors the
   * `surfaceHeightAt`-finite-and-not-NaN rule but additionally blocks
   * any hazard tagged `ghost.blocked: true` in the HAZARDS registry
   * (lava today; any future "fire pit" / "ghost ward" trivially slots
   * in). Non-blocked hazards (water/mud) remain passable — water
   * because ghosts float over it, mud because the slowdown is the
   * mechanic.
   *
   * Both `ghost._reachableNeighbors` and the bounded BFS use this so
   * the two pathing paths agree on what counts as "ghost territory".
   */
  isGhostPassable(globalGridX, globalGridY) {
    const surf = this.surfaceHeightAt(globalGridX, globalGridY);
    if (Number.isNaN(surf) || !Number.isFinite(surf)) return false;
    const t = this.tileAt(globalGridX, globalGridY);
    const haz = HAZARD_BY_CODE.get(t);
    if (haz?.ghost?.blocked) return false;
    return true;
  }

  isVoid(gridX, gridY) {
    return this.tileAt(gridX, gridY) === TILE.VOID;
  }

  /**
   * Convenience: is the tile at (gx, gy) something Pacman could plausibly
   * stand on (FLOOR or WALL)? This is the new "block-friendly" replacement
   * for the FLOOR-only walkability check. Hazards are deliberately NOT
   * included here — callers wanting "Pacman can be here without dying"
   * should use `tileAt(...) === TILE.FLOOR` or `!HAZARD_TILES.has(...)`
   * explicitly, since the hazard semantics vary (lava kills, mud slows).
   */
  isWalkable(gridX, gridY) {
    const t = this.tileAt(gridX, gridY);
    return t === TILE.FLOOR || t === TILE.WALL;
  }

  /**
   * Pick a uniformly-random FLOOR tile from any currently-loaded chunk.
   * Used as the respawn site after death and as the candidate pool for
   * fruit spawns. Hazards are deliberately filtered out (no respawning
   * inside a lava lake, no fruit hovering over water — both would feel
   * unfair). The fallback scan always succeeds because every chunk's
   * central cross row/col is guaranteed-FLOOR by `buildTemplate`.
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
  //   1. cullGhosts:        despawns ghosts farther than CULL_DIST_TILES from
  //                         the player. Frees memory as the player walks away.
  //   2. disposeEatenGhosts: clears ghosts whose state machine flagged
  //                         themselves shouldDespawn (eaten + delay).
  //   3. tickGhostSpawning: with a jittered timer, when below the soft
  //                         target count, picks a random walkable tile in
  //                         a loaded chunk that's outside MIN_SPAWN_DIST
  //                         and inside MAX_SPAWN_DIST tiles of the player,
  //                         and spawns one ghost there.
  //
  // The pool helpers themselves live in `./world-ghost-pool.js`; update()
  // and addToScene() call them directly with `this` as the first argument.
  // ---------------------------------------------------------------------------

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
    // (mountains, valleys, canyons, ridges, hazardous lakes, …). Keep a
    // small slice of hand-authored templates so the iconic
    // ghost-room / fruit-spawn layouts still surface and the world has
    // familiar landmarks.
    const useProcedural = rng() < 0.85;
    // Distance from origin used to gate hazard biomes — same shape as
    // FRUIT_TYPES.minFarTiles. Chebyshev because chunks tile in a grid
    // and "how far the chunk's nearest corner is" is what we care about
    // for streaming.
    const chunkFarTiles = Math.max(Math.abs(cx), Math.abs(cy)) * CHUNK_SIZE;
    const template = useProcedural
      ? generateChunk(rng, {
          farTiles: chunkFarTiles,
          hazardMul: this.effectiveHazardDensityMul()
        })
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
    // Cross-corridor decimation: a separate knob from off-cross density
    // because the cross used to be guaranteed-100% on every difficulty,
    // which made Hard's overall dot count not actually feel sparse to
    // a player walking the corridor between chunks. Hard's preset sets
    // this to 0.5 → ~50% of cross tiles dotted (still recognizable as
    // a trail; no longer a free meal). Easy/Normal stay at 1.0.
    const crossKeepMul = this.difficulty.crossDotKeepMul ?? 1.0;
    const crossDotKeepPercent = Math.max(
      10,
      Math.min(100, Math.round(100 * crossKeepMul))
    );
    return new Chunk(cx, cy, template, this.scale, this.assets, {
      dotKeepPercent,
      crossDotKeepPercent
    });
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
      ...findBlinkyReference(this.ghosts)
    };

    // Tag the N closest ghosts with useBfs. They get terrain-aware
    // pathing so they don't bonk into cliffs when chasing through hilly
    // chunks. The rest fall back to greedy.
    const bfsGhosts = pickClosestGhosts(this.ghosts, pacmanPos, BFS_NEAREST_GHOST_COUNT);

    // Tick AI for every live ghost.
    for (const g of this.ghosts) {
      const useBfs = bfsGhosts.has(g);
      g.update(dt, pacmanPos, { ...ctxBase, useBfs });
    }

    // Pool maintenance — order matters: dispose eaten first so they don't
    // count against the population cap, then cull anyone too far away,
    // then maybe spawn one new ghost to keep the area populated.
    disposeEatenGhosts(this);
    cullGhosts(this, pacmanPos);
    tickGhostSpawning(this, dt, pacmanPos, powerInfo);
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
