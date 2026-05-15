/**
 * Pacman life-cycle mixin.
 *
 * Owns the discrete state transitions: jumping, sprinting, dying, respawn,
 * power mode, and the per-tile reaction (lethal hazards / meter drains /
 * speed multipliers). Mixed into `Pacman.prototype` so every method here
 * can keep using the same `this` as the rest of the class.
 */

import { GAMEPLAY, TILE } from './constants.js';

export const lifeMethods = {
  /**
   * Try to start a jump. Returns true if the jump began this frame.
   * Conditions: not already jumping, not on cooldown, not dead.
   *
   * `invulnerable` is NOT pre-set here — update() drives it from the live
   * arc height each frame so take-off and landing both count as
   * vulnerable (the player has to time a jump OVER a ghost, not just
   * mash-jump for a 0.4 s i-frame burst).
   */
  tryJump() {
    if (this.dead || this.jumping || this.jumpCooldown > 0) return false;
    this.jumping = true;
    this.jumpT = 0;
    return true;
  },

  /**
   * Try to start a sprint. Returns true if sprint began this frame.
   * Conditions: not dead/dying, not already sprinting, not in cooldown.
   * Sprint and jump are independent budgets — sprinting mid-air or
   * jumping mid-sprint is allowed and combines into a "leap" that
   * covers more ground than either alone.
   *
   * Food cost (FOOD_PER_SPRINT) is deducted in game-input.js so the
   * Pacman model stays food-agnostic, mirroring the tryJump split.
   */
  trySprint() {
    if (this.dead || this.dying) return false;
    if (this.sprintTimer > 0 || this.sprintCooldown > 0) return false;
    this.sprintTimer = GAMEPLAY.SPRINT_DURATION_S;
    return true;
  },

  /**
   * Mark Pacman as dead — triggers fall animation. Game watches `dead` and
   * runs the respawn timer. The optional `cause` is stored on Pacman so
   * game-state._enterDeath can pick the right respawn-overlay copy (void
   * fall vs lava vs drowning all share this animation path but want
   * different flavour text).
   */
  die(cause = 'void') {
    if (this.dead) return;
    this.dead = true;
    this.deathT = 0;
    this.jumping = false;
    this.invulnerable = false;
    this._deathCause = cause;
    // Stop hazard effects so the meters HUD isn't draining a dead Pacman.
    // Pacman's `tileHeight` (and therefore `position.z`) stays at the
    // sunken value while the death animation plays — a drown-death
    // sphere should remain submerged through the spin/shrink rather
    // than popping out of the water the moment _loseLife fires.
    this._activeMeters.clear();
    this._hazardSpeedMul = 1.0;
  },

  /**
   * Killed by a ghost — triggers the classic spin/shrink animation.
   * Game watches `dying` to gate respawn timing. Ignored if already
   * mid-death so a chained collision frame can't restart the animation.
   */
  dieByGhost() {
    if (this.dying || this.dead) return;
    this.dying = true;
    this.dyingT = 0;
    this.jumping = false;
    this.invulnerable = false;
  },

  /**
   * Restore Pacman to a fresh living state at the given grid position +
   * tile height. Called by Game after the respawn timer fires.
   */
  respawnAt(gridX, gridY, height) {
    this.dead = false;
    this.deathT = 0;
    this.dying = false;
    this.dyingT = 0;
    this.jumping = false;
    this.jumpT = 0;
    this.jumpCooldown = 0;
    this.invulnerable = false;
    this.tileHeight = height;
    this.smoothHeight = height;
    this.position.set(gridX * this.scale, gridY * this.scale, height * this.scale + this.scale / 2);
    this._syncGroupPosition();
    // Reset the spin/shrink/flatten transforms left over from the ghost
    // death animation so Pacman doesn't respawn tiny + sideways.
    this.group.scale.set(1, 1, 1);
    this.group.rotation.x = 0;
    this.group.rotation.z = (this.yaw * Math.PI) / 180;
    this.setMouthAngle(0);
    // Power mode does NOT survive respawn — getting caught (or falling
    // in the void) ends the buff.
    this.clearPowerMode();
    // Sprint state is per-life: a fresh respawn gets a fresh dash budget
    // (no inherited cooldown), but also can't ride out the previous
    // burst's speed window past death.
    this.sprintTimer = 0;
    this.sprintCooldown = 0;
    this._sprintCooldownStart = 0;
    // Clear any hazard state carried over from the previous life — a
    // fresh spawn always lands on a FLOOR tile via randomLoadedFloor,
    // so we start dry, mud-free, and at base speed.
    this._activeMeters.clear();
    this._hazardSpeedMul = 1.0;
  },

  /**
   * Enter power mode for `durationS` seconds. Pacman's body emissive
   * starts pulsing in update() and ghost collisions become "eat ghost"
   * instead of "lose a life". Subsequent calls during an active power
   * mode reset the timer to the new duration (eating a second pill
   * mid-power refreshes the window).
   */
  enterPowerMode(durationS) {
    this.powered = true;
    this.powerTimer = durationS;
    // Cache the start-of-window duration so the HUD bar fills correctly
    // regardless of difficulty (Easy 10 s ≠ Normal 8 s ≠ Hard 5 s — the
    // bar used to always divide by the GAMEPLAY constant).
    this.powerStartDuration = durationS;
  },

  /** Force-end power mode (e.g., on respawn or game over). */
  clearPowerMode() {
    if (!this.powered && this.powerTimer === 0) return;
    this.powered = false;
    this.powerTimer = 0;
    this.powerStartDuration = 0;
    this.bodyMaterial.emissiveIntensity = this._normalEmissive;
    this.bodyMaterial.color.setHex(0xffff00);
    this.bodyMaterial.emissive.setHex(0xffff00);
  },

  /**
   * Resolve the tile under Pacman after a jump arc completes.
   *
   * Lands cleanly if (a) the tile has a walkable surface (FLOOR or WALL
   * or a non-lava hazard) and (b) the surface is within reach of his
   * pre-jump height (auto-step + jump apex). Otherwise he falls — VOID
   * or overshooting too tall a tower are both fatal. Landing on lava is
   * also fatal (same animation path as a void fall, different cause).
   */
  _resolveLanding() {
    if (!this.level) return;
    const gx = this.level.worldToGrid(this.position.x);
    const gy = this.level.worldToGrid(this.position.y);
    const surf = this.level.surfaceHeightAt(gx, gy);
    if (Number.isNaN(surf)) {
      this.die('void');
      return;
    }
    const reach = 1 + GAMEPLAY.PACMAN_JUMP_HEIGHT; // auto-step (1) + jump (1)
    // Reach check uses the floor-edge surface (`surfaceHeightAt`) so
    // landing on top of a water pit's edge counts as the floor-level
    // step (the pacman-specific drop is applied in
    // `_reactToTileUnderFeet` after the reach gate passes).
    if (surf - this.tileHeight > reach) {
      // Tile is taller than our combined step+jump reach — bonk and fall.
      this.die('void');
      return;
    }
    this.tileHeight = surf;
    // Defer hazard reactions (lava death / water-wade entry) to the
    // shared helper used by grounded movement so jump landings and
    // walking land in the same state machine. That helper resets
    // tileHeight to the pacman-specific (sunken) height for hazards.
    this._reactToTileUnderFeet(gx, gy);
  },

  /**
   * React to whatever tile Pacman is now standing on. Called from
   * `handleMovement` when grounded and from `_resolveLanding` after a
   * jump.
   *
   * Two cases:
   *   1. VOID (no surface) → die('void').
   *   2. Any tile with a HAZARDS spec → apply spec.pacman:
   *        - `lethal: true`   → die(spec.deathCause) and bail.
   *        - `drainMeter: id` → add `id` to _activeMeters so the meter
   *          ticker in game-state drains it; remove all other meters
   *          (only one active hazard at a time).
   *        - `speedMul`       → set `_hazardSpeedMul` (defaults to 1).
   *   3. Anything else (FLOOR, WALL) → clear active meters, reset speed.
   *
   * Always updates `tileHeight` last so the next-frame movement code
   * has the right surface to compare against.
   *
   * Registry-driven: adding a new hazard with a new speed/lethal/meter
   * combo doesn't require code changes here — just a HAZARDS entry.
   */
  _reactToTileUnderFeet(gx, gy) {
    if (!this.level) return;
    const tile = this.level.tileAt(gx, gy);
    if (tile === TILE.VOID) {
      this.die('void');
      return;
    }
    const haz = this.level.hazardAt(gx, gy);
    if (haz) {
      const p = haz.pacman || {};
      if (p.lethal) {
        this.die(p.deathCause || haz.id);
        return;
      }
      this._activeMeters.clear();
      if (p.drainMeter) this._activeMeters.add(p.drainMeter);
      this._hazardSpeedMul = p.speedMul ?? 1.0;
    } else {
      this._activeMeters.clear();
      this._hazardSpeedMul = 1.0;
    }
    // Use Pacman's per-actor surface so hazards with `pacmanSink > 0`
    // (water, lava) physically drop him into the pit. The standard
    // `smoothHeight` lerp in update() eases the descent so it reads
    // as a step-down. Ghosts continue to read `surfaceHeightAt` and
    // float at the floor-edge level — the asymmetry is the point.
    this.tileHeight = this.level.pacmanSurfaceHeightAt(gx, gy);
  },

  // Death animation (from original deathAnimation())
  // Classic Pac-Man death: mouth opens wide, then collapses inward
  playDeathAnimation(callback) {
    const duration = 1500; // ms - total animation time
    const startTime = Date.now();

    // Phase 1: Mouth opens wide (0 to 0.4)
    // Phase 2: Pac-Man collapses/shrinks while spinning (0.4 to 1.0)

    const animate = () => {
      const elapsed = Date.now() - startTime;
      const progress = Math.min(elapsed / duration, 1);

      if (progress < 0.4) {
        const phase1Progress = progress / 0.4;
        // Open mouth to 170 degrees (almost flat)
        this.setMouthAngle(phase1Progress * 170);
      } else {
        // Phase 2: Collapse inward while spinning
        const phase2Progress = (progress - 0.4) / 0.6;

        this.setMouthAngle(170);

        const shrinkScale = 1 - phase2Progress;
        this.group.scale.setScalar(Math.max(0.01, shrinkScale));

        // Spin faster as it collapses
        this.group.rotation.z += 0.15 * (1 + phase2Progress * 2);

        // Flatten (squish in Z)
        this.group.scale.z = Math.max(0.01, shrinkScale * shrinkScale);
      }

      if (progress < 1) {
        requestAnimationFrame(animate);
      } else {
        // Reset for next life
        this.group.scale.set(1, 1, 1);
        this.group.rotation.z = 0;
        this.setMouthAngle(0);
        if (callback) callback();
      }
    };

    animate();
  }
};
