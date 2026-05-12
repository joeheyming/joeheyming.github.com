import { Fruit } from './fruit.js';
import { GHOST_STATE, GAMEPLAY, TILE } from './constants.js';
import { CHUNK_SIZE } from './templates.js';
import { eatenKey } from './save.js';

export const gameSpawn = {
  checkDotCollection() {
    const pacmanPos = this.pacman.getPosition();
    const collectRadius = this.pacman.radius * GAMEPLAY.COLLISION_RADIUS_MULTIPLIER;
    // World.dots is a getter that aggregates across loaded chunks; we only
    // walk it on each frame for the MVP. With ~25 chunks * ~150 dots = ~3700
    // dots max, this is fine. If perf becomes an issue we can spatial-index
    // by chunk.
    const allDots = this.world.dots;
    for (const dot of allDots) {
      if (!dot.visible) continue;
      if (dot.position.distanceTo(pacmanPos) < collectRadius) {
        dot.visible = false;
        // Persist the eat. The Set is shared with World.eatenDots so any
        // chunk loaded later will already know to hide this dot.
        this._eatenDots.add(eatenKey(dot.cx, dot.cy, dot.lx, dot.ly));

        if (dot.isPowerPill) {
          this.score += GAMEPLAY.SCORE_POWER_PILL;
          this._addFood(GAMEPLAY.FOOD_PER_POWER_PILL);
          this.audioManager.playPowerPill?.();
          this.pacman.startChomp();
          // Enter power mode — refreshes the timer if already powered.
          this.pacman.enterPowerMode(GAMEPLAY.POWER_MODE_DURATION);
          // Reset the ghost-eat combo at the start of every power window
          // so a fresh pill always pays out 200 → 400 → 800 → 1600.
          this._powerChainCount = 0;
          // Scare every live ghost.
          this.world.scareAllGhosts(GAMEPLAY.POWER_MODE_DURATION);
        } else {
          this.score += GAMEPLAY.SCORE_DOT;
          this._addFood(GAMEPLAY.FOOD_PER_DOT);
          this.audioManager.playChomp();
          this.pacman.startChomp();
        }
      }
    }
  },

  // ---------------------------------------------------------------------------
  // Phase 3 — ghosts, fruit, lives, game over
  // ---------------------------------------------------------------------------

  /**
   * Pacman vs all ghosts. Behaviour depends on Pacman's power state and
   * each ghost's state:
   *   - Powered + ghost.FLEE → eat ghost, score combo, ghost respawns home
   *   - Otherwise → lose a life (unless we're mid-jump, mid-respawn-grace,
   *     or the ghost is currently EATEN/invisible)
   */
  _checkGhostCollisions() {
    if (!this.world || !this.pacman) return;
    if (this.pacman.dead) return;
    if (this.pacman.invulnerable) return; // mid-jump grace
    if (this._postRespawnGrace > 0) return;

    const pacmanPos = this.pacman.position;
    // Collision radius generous enough to land hits at typical play speeds
    // without making ghosts feel "magnetic" — about 60% of a tile.
    const collisionR = this.world.scale * 0.6;
    const collisionR2 = collisionR * collisionR;

    for (const ghost of this.world.getGhosts()) {
      if (ghost.state === GHOST_STATE.EATEN) continue;
      const dx = ghost.position.x - pacmanPos.x;
      const dy = ghost.position.y - pacmanPos.y;
      const dz = ghost.position.z - pacmanPos.z;
      // Allow a generous z tolerance (1.5 tiles) — a ghost on a low
      // plateau can still grab Pacman walking past on the ground tile.
      if (Math.abs(dz) > this.world.scale * 1.5) continue;
      if (dx * dx + dy * dy > collisionR2) continue;

      if (this.pacman.powered && ghost.state === GHOST_STATE.FLEE) {
        this._eatGhost(ghost);
      } else {
        this._loseLife('ghost');
        return; // a single life-loss frame should consume any further hits
      }
    }
  },

  _eatGhost(ghost) {
    const points = GAMEPLAY.SCORE_GHOST_BASE * (1 << Math.min(this._powerChainCount, 3));
    this.score += points;
    this._powerChainCount++;
    // "Ghost is gnarly food" — score reward, but a hunger penalty.
    // Routed through _addFood so a starving player chomping a ghost
    // can bottom out and trigger a starvation-death (rare edge case
    // that's still preferable to a silent inconsistency).
    this._addFood(-GAMEPLAY.FOOD_GHOST_PENALTY);
    this.audioManager.playGhostEaten?.();
    ghost.setEaten();
  },

  /**
   * Pick a random spawn delay for the next fruit. Difficulty stretches
   * (or compresses) the window so easy gets fruit faster than hard.
   */
  _rollFruitInterval() {
    const mul = this._diff().fruitSpawnPeriodMul;
    const lo = GAMEPLAY.FRUIT_SPAWN_PERIOD_MIN * mul;
    const hi = GAMEPLAY.FRUIT_SPAWN_PERIOD_MAX * mul;
    return lo + Math.random() * (hi - lo);
  },

  /**
   * Fruit lifecycle:
   *   - When no fruit is active, the spawn timer counts down. When it
   *     hits zero, we attempt to spawn one fruit at a random nearby
   *     walkable tile (outside FRUIT_SPAWN_MIN_DIST_TILES of Pacman).
   *   - The active fruit ticks its bob animation, self-destructs after
   *     FRUIT_LIFETIME, and gives SCORE_FRUIT on collision.
   *   - The interval is re-rolled each spawn so timing feels organic.
   *   - If Pacman walks far away from the fruit, it auto-despawns to
   *     avoid keeping mesh memory around for an unreachable bonus.
   */
  _tickFruit() {
    if (this._activeFruit) {
      const expired = this._activeFruit.update(this.deltaTime);
      const pacmanPos = this.pacman.position;
      const dx = this._activeFruit.position.x - pacmanPos.x;
      const dy = this._activeFruit.position.y - pacmanPos.y;
      const dz = this._activeFruit.position.z - pacmanPos.z;
      const dXY2 = dx * dx + dy * dy;
      const r = this.world.scale * 0.7;
      if (dXY2 < r * r && Math.abs(dz) < this.world.scale * 1.2) {
        this.score += GAMEPLAY.SCORE_FRUIT;
        // Fruit is the strongest food source in the game (intentional —
        // it's rare, time-limited, and the user wanted "fruit is better").
        this._addFood(GAMEPLAY.FOOD_PER_FRUIT);
        this.audioManager.playFruitEaten?.();
        this._despawnFruit();
        return;
      }
      // Too-far cull: if Pacman walked off two chunks away from the
      // fruit, treat it as gone. Keeps memory bounded if the player
      // never approaches.
      const cullR = GAMEPLAY.FRUIT_SPAWN_MAX_DIST * CHUNK_SIZE * this.world.scale * 1.5;
      if (dXY2 > cullR * cullR || expired) {
        this._despawnFruit();
        // Skip-ahead the timer so the next attempt happens soon-ish.
        this._fruitSpawnTimer = Math.min(this._fruitSpawnTimer, 5);
      }
      return;
    }

    this._fruitSpawnTimer -= this.deltaTime;
    if (this._fruitSpawnTimer <= 0) {
      this._spawnFruit();
      // Always reset the timer so a failed spawn (no valid tile)
      // doesn't churn every frame.
      this._fruitSpawnTimer = this._rollFruitInterval();
    }
  },

  /**
   * Pick a random walkable FLOOR tile near Pacman (outside the safety
   * radius) and instantiate a Fruit there. Tries up to 12 random tiles
   * before giving up; spawning failures simply roll the timer again.
   */
  _spawnFruit() {
    if (!this.world || !this.pacman) return;
    const spawn = this._pickFruitSpawnTile();
    if (!spawn) return;
    this._activeFruit = new Fruit({
      gridX: spawn.gx,
      gridY: spawn.gy,
      surfaceHeight: spawn.h,
      scale: this.world.scale
    });
    this._activeFruit.addToScene(this.scene);
  },

  _pickFruitSpawnTile() {
    const pcx = Math.floor(this.world.worldToGrid(this.pacman.position.x) / CHUNK_SIZE);
    const pcy = Math.floor(this.world.worldToGrid(this.pacman.position.y) / CHUNK_SIZE);
    const maxDist = GAMEPLAY.FRUIT_SPAWN_MAX_DIST;
    const minD = GAMEPLAY.FRUIT_SPAWN_MIN_DIST_TILES * this.world.scale;
    const minD2 = minD * minD;
    for (let attempt = 0; attempt < 16; attempt++) {
      const dx = Math.floor(Math.random() * (2 * maxDist + 1)) - maxDist;
      const dy = Math.floor(Math.random() * (2 * maxDist + 1)) - maxDist;
      const cx = pcx + dx;
      const cy = pcy + dy;
      const lx = Math.floor(Math.random() * CHUNK_SIZE);
      const ly = Math.floor(Math.random() * CHUNK_SIZE);
      const gx = cx * CHUNK_SIZE + lx;
      const gy = cy * CHUNK_SIZE + ly;
      const surf = this.world.surfaceHeightAt(gx, gy);
      if (!Number.isFinite(surf) || Number.isNaN(surf)) continue;
      const ppx = this.pacman.position.x;
      const ppy = this.pacman.position.y;
      const wx = gx * this.world.scale;
      const wy = gy * this.world.scale;
      if ((wx - ppx) * (wx - ppx) + (wy - ppy) * (wy - ppy) < minD2) continue;
      // Confirm tile type is FLOOR specifically (not WALL — those are
      // climbable but a fruit perched on top can be hard to reach).
      const tile = this._tileAtGlobal(gx, gy);
      if (tile !== TILE.FLOOR) continue;
      return { gx, gy, h: surf };
    }
    return null;
  },

  /** Look up the tile-type at a global grid coord. Returns null if unloaded. */
  _tileAtGlobal(gx, gy) {
    const cx = Math.floor(gx / CHUNK_SIZE);
    const cy = Math.floor(gy / CHUNK_SIZE);
    const k = `${cx},${cy}`;
    const chunk = this.world.chunks.get(k);
    if (!chunk) return null;
    const lx = gx - cx * CHUNK_SIZE;
    const ly = gy - cy * CHUNK_SIZE;
    return chunk.map[ly][lx];
  },

  _despawnFruit() {
    if (!this._activeFruit) return;
    this._activeFruit.removeFromScene(this.scene);
    this._activeFruit.dispose();
    this._activeFruit = null;
  }
};
