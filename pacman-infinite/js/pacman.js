/**
 * Pacman Character
 * 3D model with animated mouth using two hemispheres
 * Based on original Pacman.cpp
 */

import * as THREE from 'three';
import { DIRECTION, KEY_MODE, GAMEPLAY, TILE } from './constants.js';

export class Pacman {
  constructor(startX, startY, scale, level) {
    this.startX = startX;
    this.startY = startY;
    this.scale = scale;
    this.level = level;

    // Size (2*scale/5 from original)
    this.radius = (2 * scale) / 5;

    // Position
    this.position = new THREE.Vector3(startX * scale, startY * scale, scale / 2);

    // Movement
    this.moveSpeed = GAMEPLAY.PACMAN_SPEED;
    this.rotateSpeed = GAMEPLAY.PACMAN_ROTATE_SPEED;
    this.facing = new THREE.Vector3(0, -1, 0); // Initially facing down
    this.strafe = new THREE.Vector3(-1, 0, 0); // Perpendicular to facing (left)
    this.yaw = 180; // degrees (facing down)
    this.pitch = 0; // degrees (looking straight ahead, positive = up, negative = down)
    this.keyMode = KEY_MODE.PERP; // Default to classic Pacman controls

    // Phase 2a — terrain + jump state
    this.tileHeight = 0; // integer height of the FLOOR tile we're on
    this.smoothHeight = 0; // float, lerps toward tileHeight for visual smoothing
    this.jumping = false;
    this.jumpT = 0; // 0..1 progress through current jump arc
    this.jumpCooldown = 0; // seconds remaining before another jump is allowed
    this.invulnerable = false; // true mid-jump (sets up Phase 3 ghost interactions)
    this.dead = false; // true while falling/respawning into the void
    this.deathT = 0; // 0..1 progress through fall-into-void animation
    // Hazard tile state (read by game-state._tickMeters + game-hud
    // meters bar; written by _reactToTileUnderFeet every grounded
    // movement step).
    //   _activeMeters:    Set<meterId> currently being drained because
    //                     of the hazard under foot. Today only ever
    //                     contains 'breath' (when standing in WATER).
    //                     game-state checks this per meter and decides
    //                     drain-vs-refill.
    //   _hazardSpeedMul:  speed multiplier contributed by the tile
    //                     under foot, read from `HAZARDS[id].pacman.
    //                     speedMul`. Defaults to 1.0 on safe tiles.
    //                     Applied as a final factor on moveAmount.
    //   _deathCause:      set by die(cause) so game-state's _enterDeath
    //                     can show the right respawn copy.
    this._activeMeters = new Set();
    this._hazardSpeedMul = 1.0;
    this._deathCause = 'void';
    // Classic Pac-Man "killed by ghost" animation: mouth opens wide,
    // then the body spins and shrinks. This is a separate visual from
    // the void fall; we keep the two state machines independent so they
    // don't fight over the group transform.
    this.dying = false;
    this.dyingT = 0; // 0..1 progress through spin/shrink death animation

    // State
    this._chasing = false; // Power mode (true when power pill active)
    this.chaseTimer = 0;

    // Phase 3 — power mode (separate from the legacy `_chasing` field, which
    // is referenced only by the original /pacman/ port). When `powered`,
    // touching a fleeing ghost eats it instead of costing a life.
    this.powered = false;
    this.powerTimer = 0;
    this.powerStartDuration = 0; // cached duration used by the HUD bar denominator
    // Cached "normal" emissive intensity so we can pulse during power mode
    // and restore exactly when it ends.
    this._normalEmissive = 0.2;

    // Tier 5 — sprint (double-tap to dash). Two timers run sequentially:
    //   • sprintTimer  > 0  → ACTIVE: speed × SPRINT_SPEED_MUL, emissive
    //                          pulses cyan. Counts down to 0.
    //   • sprintCooldown > 0 → COOLDOWN: cannot start a new sprint until
    //                          this hits 0. Counts down independently.
    // The two never overlap: the cooldown only starts ticking once the
    // active timer reaches 0. HUD bar uses sprintCooldown as the
    // refill-progress denominator, so its starting value is cached.
    this.sprintTimer = 0;
    this.sprintCooldown = 0;
    this._sprintCooldownStart = 0;

    // Animation
    this.mouthAngle = 0; // Current mouth opening (0-45 degrees)
    this.mouthMaxAngle = GAMEPLAY.PACMAN_MOUTH_MAX_ANGLE;
    this.mouthAnimating = false;
    this.mouthOpening = true;
    this.mouthSpeed = GAMEPLAY.PACMAN_MOUTH_SPEED;

    // Reusable vector to avoid allocations in hot paths
    this._oldPosition = new THREE.Vector3();

    // 3D components
    this.group = new THREE.Group();
    this.topHemisphere = null;
    this.bottomHemisphere = null;
    this.leftEye = null;
    this.rightEye = null;

    // Materials
    this.bodyMaterial = new THREE.MeshStandardMaterial({
      color: 0xffff00,
      roughness: 0.3,
      metalness: 0.1,
      emissive: 0xffff00,
      emissiveIntensity: 0.2
    });

    this.eyeMaterial = new THREE.MeshStandardMaterial({
      color: 0x000000,
      roughness: 0.8
    });

    this.mouthMaterial = new THREE.MeshStandardMaterial({
      color: 0x000000,
      side: THREE.DoubleSide
    });

    this.createModel();
  }

  createModel() {
    // Create hemispheres for body (like original with clip planes)
    // The hemisphere geometry faces +Z by default, we need it to face +Y (forward)
    const sphereGeometry = new THREE.SphereGeometry(
      this.radius,
      32,
      32,
      0,
      Math.PI * 2,
      0,
      Math.PI / 2
    );

    // Create pivot groups for mouth animation
    // This allows us to rotate the hemispheres around X for the chomp
    this.topPivot = new THREE.Group();
    this.bottomPivot = new THREE.Group();

    // Top hemisphere - rotate +90° around X so it faces +Y with mouth opening forward
    this.topHemisphere = new THREE.Mesh(sphereGeometry, this.bodyMaterial);
    this.topHemisphere.rotation.x = Math.PI / 2; // Face forward (+Y)
    this.topHemisphere.castShadow = true;
    this.topPivot.add(this.topHemisphere);

    // Bottom hemisphere - rotate -90° around X so it faces +Y, flipped for bottom half
    this.bottomHemisphere = new THREE.Mesh(sphereGeometry, this.bodyMaterial);
    this.bottomHemisphere.rotation.x = -Math.PI / 2; // Face forward (+Y), flipped
    this.bottomHemisphere.castShadow = true;
    this.bottomPivot.add(this.bottomHemisphere);

    // Create mouth interior (dark disk) - faces +Y
    const mouthGeometry = new THREE.CircleGeometry(this.radius * 0.95, 32);
    this.topMouth = new THREE.Mesh(mouthGeometry, this.mouthMaterial);
    this.topMouth.rotation.x = Math.PI / 2;
    this.topPivot.add(this.topMouth);

    this.bottomMouth = new THREE.Mesh(mouthGeometry, this.mouthMaterial);
    this.bottomMouth.rotation.x = -Math.PI / 2;
    this.bottomPivot.add(this.bottomMouth);

    // Create eyes (like original drawEyes())
    const eyeRadius = this.radius / 5;
    const eyeGeometry = new THREE.SphereGeometry(eyeRadius, 8, 8);

    this.leftEye = new THREE.Mesh(eyeGeometry, this.eyeMaterial);
    this.rightEye = new THREE.Mesh(eyeGeometry, this.eyeMaterial);

    // Position eyes (from original: rotate 30° around Z, 50° around X, translate by radius)
    this.positionEyes();

    // Add all parts to group
    this.group.add(this.topPivot);
    this.group.add(this.bottomPivot);
    this.group.add(this.leftEye);
    this.group.add(this.rightEye);

    // Position the group
    this._syncGroupPosition();

    // Initial mouth animation
    this.animateMouth(0);
  }

  /**
   * Copy the authoritative world position into the render group. All
   * other transform updates (rotation, mouth) compose on top of this.
   *
   * Sunken-hazard "wading in water" is now a real height drop —
   * `tileHeight` itself goes negative when Pacman steps into a water/
   * lava pit (see `pacmanSurfaceHeightAt` in world.js), which flows
   * through `position.z` via the standard surface-height pipeline. The
   * group transform follows position 1:1 with no extra offset.
   */
  _syncGroupPosition() {
    this.group.position.copy(this.position);
  }

  positionEyes() {
    // Eyes positioned like original: rotated and translated to surface
    const eyeDistance = this.radius;
    const eyeAngleZ = (30 * Math.PI) / 180;
    const eyeAngleX = (50 * Math.PI) / 180;

    // Left eye
    const leftPos = new THREE.Vector3(0, eyeDistance, 0);
    leftPos.applyAxisAngle(new THREE.Vector3(1, 0, 0), eyeAngleX);
    leftPos.applyAxisAngle(new THREE.Vector3(0, 0, 1), eyeAngleZ);
    this.leftEye.position.copy(leftPos);

    // Right eye
    const rightPos = new THREE.Vector3(0, eyeDistance, 0);
    rightPos.applyAxisAngle(new THREE.Vector3(1, 0, 0), eyeAngleX);
    rightPos.applyAxisAngle(new THREE.Vector3(0, 0, 1), -eyeAngleZ);
    this.rightEye.position.copy(rightPos);
  }

  animateMouth(mouthAngle) {
    // Rotate pivot groups to create mouth opening
    // Like original: glRotatef(mouthAngle, 1.0, 0.0, 0.0) for top
    // and glRotatef(-mouthAngle, 1.0, 0.0, 0.0) for bottom
    const angleRad = (mouthAngle * Math.PI) / 180;

    // Top pivot rotates up (positive X rotation) to open mouth forward
    this.topPivot.rotation.x = angleRad;
    // Bottom pivot rotates down (negative X rotation) to open mouth forward
    this.bottomPivot.rotation.x = -angleRad;
  }

  addToScene(scene) {
    scene.add(this.group);
  }

  startChomp() {
    this.mouthAnimating = true;
    this.mouthOpening = true;
  }

  update(deltaTime, direction, moveVec = null) {
    // Phase 3: power-mode countdown. Game.js cross-checks pacman.powered
    // when handling ghost collisions; we own the timer here so the chomp
    // animation, lerps, and visual pulse all sit in one place.
    if (this.powered) {
      this.powerTimer -= deltaTime;
      if (this.powerTimer <= 0) {
        this.powerTimer = 0;
        this.powered = false;
        this.bodyMaterial.emissiveIntensity = this._normalEmissive;
        this.bodyMaterial.color.setHex(0xffff00);
        this.bodyMaterial.emissive.setHex(0xffff00);
      } else {
        // Visual feedback: cycle Pacman's body emissive between yellow
        // and white for a "I'm dangerous" tell. Faster pulse near the
        // end of the timer hints that it's about to expire.
        const fast = this.powerTimer < 2 ? 12 : 6;
        const phase = 0.5 + 0.5 * Math.sin(this.powerTimer * fast);
        this.bodyMaterial.emissiveIntensity = 0.4 + 0.6 * phase;
      }
    } else if (this.sprintTimer > 0) {
      // Sprint visual: punchy cyan-tinted emissive flicker so the
      // burst reads as a discrete state, not just "I'm walking but
      // faster". Skipped while powered because the power-mode pulse
      // already owns the body material — the two would fight and
      // degrade both reads.
      const phase = 0.5 + 0.5 * Math.sin(this.sprintTimer * 24);
      this.bodyMaterial.emissiveIntensity = 0.5 + 0.5 * phase;
    } else if (
      this.bodyMaterial.emissiveIntensity !== this._normalEmissive &&
      !this.dead &&
      !this.dying
    ) {
      // Restore baseline emissive after sprint ends so the body
      // doesn't stay over-lit while idle. Power mode owns its own
      // restoration above, so this only runs in the post-sprint
      // window or after any other one-off emissive changes.
      this.bodyMaterial.emissiveIntensity = this._normalEmissive;
    }

    // Tier 5 — sprint timer machine. The active phase counts down to 0,
    // then the cooldown phase begins. `_sprintCooldownStart` snapshots
    // the cooldown duration the moment the cooldown phase starts so the
    // HUD bar can use it as a stable denominator for progress reporting.
    if (this.sprintTimer > 0) {
      this.sprintTimer = Math.max(0, this.sprintTimer - deltaTime);
      if (this.sprintTimer === 0) {
        this.sprintCooldown = GAMEPLAY.SPRINT_COOLDOWN_S;
        this._sprintCooldownStart = GAMEPLAY.SPRINT_COOLDOWN_S;
      }
    } else if (this.sprintCooldown > 0) {
      this.sprintCooldown = Math.max(0, this.sprintCooldown - deltaTime);
    }

    // Update mouth animation (from original animate())
    if (this.mouthAnimating) {
      if (this.mouthOpening) {
        this.mouthAngle += this.mouthSpeed * deltaTime;
        if (this.mouthAngle >= this.mouthMaxAngle) {
          this.mouthAngle = this.mouthMaxAngle;
          this.mouthOpening = false;
        }
      } else {
        this.mouthAngle -= this.mouthSpeed * deltaTime;
        if (this.mouthAngle <= 0) {
          this.mouthAngle = 0;
          this.mouthOpening = true;
          this.mouthAnimating = false;
        }
      }
      this.animateMouth(this.mouthAngle);
    }

    // Classic ghost-kill animation: mouth opens wide, then the body
    // spins and shrinks in place. Runs in parallel to the death state
    // machine in Game (which respawns once dyingT reaches 1).
    if (this.dying) {
      this.dyingT = Math.min(1, this.dyingT + deltaTime / GAMEPLAY.PACMAN_DEATH_ANIM_DURATION);
      const t = this.dyingT;
      // Stay anchored at the spot Pacman was caught — copy position
      // (and keep the hazard sink so a drown-death sphere doesn't pop
      // back up out of the water mid-spin).
      this._syncGroupPosition();
      if (t < 0.4) {
        // Phase 1: mouth opens wide (0 → 170°). No spinning yet.
        this.setMouthAngle((t / 0.4) * 170);
      } else {
        // Phase 2: spin + shrink + flatten while mouth stays wide open.
        const p = (t - 0.4) / 0.6;
        this.setMouthAngle(170);
        const s = Math.max(0.01, 1 - p);
        this.group.scale.set(s, s, Math.max(0.01, s * s));
        // Spin around the up axis (z) — accelerates as the body collapses.
        this.group.rotation.z += deltaTime * (4 + p * 8);
      }
      return;
    }

    // While dead we run the void-fall animation but skip movement/input.
    if (this.dead) {
      this.deathT = Math.min(1, this.deathT + deltaTime / GAMEPLAY.PACMAN_RESPAWN_DELAY);
      // Sink into the void: drop ~3 tiles below the surface we last stood on.
      const sink = this.deathT * this.scale * 3;
      this.position.z = this.smoothHeight * this.scale + this.scale / 2 - sink;
      this._syncGroupPosition();
      this.group.rotation.z = (this.yaw * Math.PI) / 180;
      // Spin Pacman as he falls for cosmetic flair.
      this.group.rotation.x = this.deathT * Math.PI * 2;
      return;
    }

    // Jump bookkeeping.
    if (this.jumping) {
      this.jumpT += deltaTime / GAMEPLAY.PACMAN_JUMP_DURATION;
      if (this.jumpT >= 1) {
        this.jumpT = 0;
        this.jumping = false;
        this.invulnerable = false;
        // Difficulty-scaled jump cooldown. Hard mode (2.4×) makes jumps
        // a precious traversal resource instead of a free panic-evade.
        // The world stores the multiplier on `difficulty`; level==world
        // here for an infinite session.
        const cooldownMul = this.level?.difficulty?.jumpCooldownMul ?? 1.0;
        this.jumpCooldown = GAMEPLAY.PACMAN_JUMP_COOLDOWN * cooldownMul;
        // Resolve landing: snap to the tile beneath us, or die into void.
        this._resolveLanding();
      }
    } else if (this.jumpCooldown > 0) {
      this.jumpCooldown = Math.max(0, this.jumpCooldown - deltaTime);
    }

    // Handle movement (height- and jump-aware).
    this.handleMovement(deltaTime, direction, moveVec);

    // Lerp visual height toward authoritative tileHeight for smooth ramps.
    const targetSmooth = this.tileHeight;
    if (Math.abs(this.smoothHeight - targetSmooth) > 0.001) {
      const step = GAMEPLAY.PACMAN_STEP_LERP_SPEED * deltaTime;
      if (this.smoothHeight < targetSmooth) {
        this.smoothHeight = Math.min(targetSmooth, this.smoothHeight + step);
      } else {
        this.smoothHeight = Math.max(targetSmooth, this.smoothHeight - step);
      }
    } else {
      this.smoothHeight = targetSmooth;
    }

    // Compose final z = surface height + half-radius offset + jump arc.
    // Stepping into water/lava drops `tileHeight` to a negative tile
    // (e.g. -0.5 for a half-tile-deep pool, see
    // `world.pacmanSurfaceHeightAt`); the same `smoothHeight` lerp
    // above eases the dip in/out so wading reads as a step-down
    // rather than a teleport.
    const jumpArc = this.jumping
      ? Math.sin(Math.PI * this.jumpT) * GAMEPLAY.PACMAN_JUMP_HEIGHT * this.scale
      : 0;
    this.position.z = this.smoothHeight * this.scale + this.scale / 2 + jumpArc;

    // Dynamic ghost-pass-through window: invulnerable only while actually
    // airborne by more than half a tile. Previously `invulnerable` was set
    // true for the entire 0.4 s arc the moment a jump started, which let
    // the player chain-jump as a free evade button (≈44 % of total time
    // immune). Now the take-off and landing frames count as vulnerable so
    // the jump becomes a real "leap over a ghost" timing window.
    if (this.jumping) {
      const airHeightTiles = Math.sin(Math.PI * this.jumpT) * GAMEPLAY.PACMAN_JUMP_HEIGHT;
      this.invulnerable = airHeightTiles > 0.5;
    } else {
      this.invulnerable = false;
    }

    // Update group position and rotation
    this._syncGroupPosition();
    this.group.rotation.x = 0;
    this.group.rotation.z = (this.yaw * Math.PI) / 180;
  }

  /**
   * Try to start a jump. Returns true if the jump began this frame.
   * Conditions: not already jumping, not on cooldown, not dead.
   *
   * `invulnerable` is NOT pre-set here anymore — update() drives it from
   * the live arc height each frame so take-off and landing both count as
   * vulnerable (the player has to time a jump OVER a ghost, not just
   * mash-jump for a 0.4 s i-frame burst).
   */
  tryJump() {
    if (this.dead || this.jumping || this.jumpCooldown > 0) return false;
    this.jumping = true;
    this.jumpT = 0;
    return true;
  }

  /**
   * Try to start a sprint. Returns true if sprint began this frame.
   * Conditions: not dead/dying, not already sprinting, not in
   * cooldown. Sprint and jump are independent budgets — sprinting
   * mid-air or jumping mid-sprint is allowed and combines into a
   * "leap" that covers more ground than either alone.
   *
   * Food cost (FOOD_PER_SPRINT) is deducted in game-input.js so the
   * Pacman model stays food-agnostic, mirroring the tryJump split.
   */
  trySprint() {
    if (this.dead || this.dying) return false;
    if (this.sprintTimer > 0 || this.sprintCooldown > 0) return false;
    this.sprintTimer = GAMEPLAY.SPRINT_DURATION_S;
    return true;
  }

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
    // than popping out of the water the moment _loseLife fires. The
    // void-fall branch in update() then drives the further sink-into-
    // the-abyss animation off `smoothHeight`.
    this._activeMeters.clear();
    this._hazardSpeedMul = 1.0;
  }

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
  }

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
    // Likewise sprint state is per-life: a fresh respawn gets a fresh
    // dash budget (no inherited cooldown), but also can't ride out
    // the previous burst's speed window past death.
    this.sprintTimer = 0;
    this.sprintCooldown = 0;
    this._sprintCooldownStart = 0;
    // Clear any hazard state carried over from the previous life — a
    // fresh spawn always lands on a FLOOR tile via randomLoadedFloor,
    // so we start dry, mud-free, and at base speed.
    this._activeMeters.clear();
    this._hazardSpeedMul = 1.0;
  }

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
  }

  /** Force-end power mode (e.g., on respawn or game over). */
  clearPowerMode() {
    if (!this.powered && this.powerTimer === 0) return;
    this.powered = false;
    this.powerTimer = 0;
    this.powerStartDuration = 0;
    this.bodyMaterial.emissiveIntensity = this._normalEmissive;
    this.bodyMaterial.color.setHex(0xffff00);
    this.bodyMaterial.emissive.setHex(0xffff00);
  }

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
      // Landed on VOID.
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
  }

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
  }

  handleMovement(deltaTime, direction, moveVec = null) {
    // `moveVec` (continuous-angle world vector, supplied by Birds-Eye
    // Follow) takes priority over the 4-way `direction` enum. When
    // present we walk Pacman in that exact direction, set yaw to
    // match, and skip the keyMode dispatch — the same wall-slide
    // collision pipeline below handles either path.
    const useVector = moveVec && (moveVec.x !== 0 || moveVec.y !== 0);
    if (!useVector && direction === DIRECTION.NONE) return;

    // Reuse temp vector instead of cloning
    const oldPosition = this._oldPosition.copy(this.position);
    // Sprint multiplies the per-frame movement budget. Applied at this
    // single layer (rather than to `moveSpeed` itself) so the base spec
    // stays untouched and so any future movement code reading
    // `pacman.moveSpeed` still sees the canonical value.
    //
    // Hazard multiplier (`_hazardSpeedMul`, sourced from the HAZARDS
    // registry per-tile) stacks underneath sprint so sprinting through
    // water/mud is still slower than sprinting on floor — but faster
    // than wading at base speed. Sprint > wade in any same-tile
    // comparison, which matches the "dash to escape" intuition (water
    // slows but doesn't strand you).
    const speedMul = this.sprintTimer > 0 ? GAMEPLAY.SPRINT_SPEED_MUL : 1;
    const moveAmount = this.moveSpeed * speedMul * this._hazardSpeedMul * deltaTime;

    if (useVector) {
      this.position.x += moveVec.x * moveAmount;
      this.position.y += moveVec.y * moveAmount;
      // facing.x = -sin(yaw), facing.y = cos(yaw) → invert to recover
      // yaw from the world vector. atan2 returns radians in [-π, π]
      // measured from +X — we need it measured from world +Y (north
      // = yaw 0), with yaw increasing CCW on the screen (90° = west).
      let yawDeg = (Math.atan2(-moveVec.x, moveVec.y) * 180) / Math.PI;
      while (yawDeg < 0) yawDeg += 360;
      while (yawDeg >= 360) yawDeg -= 360;
      this.yaw = yawDeg;
      this.updateVectorsFromYaw();
    } else {
      // Handle movement based on key mode
      switch (this.keyMode) {
        case KEY_MODE.STRAFE:
          // FPS style: W/S = forward/back relative to facing, A/D = strafe
          this.handleStrafeMovement(direction, moveAmount);
          break;
        case KEY_MODE.ROTATE:
          // Rotate mode: L/R rotate, U/D move forward/back
          this.handleRotateMovement(direction, moveAmount, deltaTime);
          break;
        case KEY_MODE.PERP:
        default:
          // Classic Pacman: arrows = world directions
          this.handlePerpMovement(direction, moveAmount);
          break;
      }
    }

    // Start mouth animation when moving
    if (!this.mouthAnimating) {
      this.startChomp();
    }

    // Wall sliding collision detection
    // Try both axes first, then each axis separately to allow sliding along walls
    const collisionRadius = this.radius * 0.4;
    // fromX/fromY power the "unstick" rescue in canMoveTo: if we're
    // already partially clipping a cliff (post-landing edge case), we
    // still want to be able to move AWAY from it.
    const opts = {
      currentHeight: this.tileHeight,
      airborne: this.jumping,
      fromX: oldPosition.x,
      fromY: oldPosition.y
    };

    if (!this.level.canMoveTo(this.position.x, this.position.y, collisionRadius, opts)) {
      // Full movement blocked - try sliding along walls
      const newX = this.position.x;
      const newY = this.position.y;

      // Try moving only on X axis
      this.position.y = oldPosition.y;
      const canMoveX = this.level.canMoveTo(
        this.position.x,
        this.position.y,
        collisionRadius,
        opts
      );

      // Try moving only on Y axis
      this.position.x = oldPosition.x;
      this.position.y = newY;
      const canMoveY = this.level.canMoveTo(
        this.position.x,
        this.position.y,
        collisionRadius,
        opts
      );

      if (canMoveX && !canMoveY) {
        // Can only slide on X axis
        this.position.x = newX;
        this.position.y = oldPosition.y;
      } else if (canMoveY && !canMoveX) {
        // Can only slide on Y axis
        this.position.x = oldPosition.x;
        this.position.y = newY;
      } else if (canMoveX && canMoveY) {
        // Both work - prefer the one with more movement
        const xDist = Math.abs(newX - oldPosition.x);
        const yDist = Math.abs(newY - oldPosition.y);
        if (xDist > yDist) {
          this.position.x = newX;
          this.position.y = oldPosition.y;
        } else {
          this.position.x = oldPosition.x;
          this.position.y = newY;
        }
      } else {
        // Neither works - fully blocked
        this.position.copy(oldPosition);
      }
    }

    // Resolve the tile we landed in. While jumping, this is purely a
    // height bookkeeping step — we don't kill on void/lava mid-arc,
    // only on landing (handled by _resolveLanding when jumpT completes).
    // When airborne we also can't drown / catch fire — flying over a
    // hazard doesn't count as standing on it — so we explicitly clear
    // active meters and reset speed for the mid-jump frames. (Reactivates
    // on landing if the destination is a hazard.)
    if (!this.jumping) {
      const gx = this.level.worldToGrid(this.position.x);
      const gy = this.level.worldToGrid(this.position.y);
      this._reactToTileUnderFeet(gx, gy);
    } else {
      this._activeMeters.clear();
      this._hazardSpeedMul = 1.0;
    }

    // Handle teleports
    this.checkTeleport();
  }

  // KEY_STRAFE: FPS-style movement (forward/back + strafe)
  handleStrafeMovement(direction, moveAmount) {
    switch (direction) {
      case DIRECTION.UP: // Forward
        this.position.x += this.facing.x * moveAmount;
        this.position.y += this.facing.y * moveAmount;
        break;
      case DIRECTION.DOWN: // Backward
        this.position.x -= this.facing.x * moveAmount;
        this.position.y -= this.facing.y * moveAmount;
        break;
      case DIRECTION.LEFT: // Strafe left
        this.position.x -= this.strafe.x * moveAmount;
        this.position.y -= this.strafe.y * moveAmount;
        break;
      case DIRECTION.RIGHT: // Strafe right
        this.position.x += this.strafe.x * moveAmount;
        this.position.y += this.strafe.y * moveAmount;
        break;
    }
  }

  // KEY_ROTATE: L/R rotate, U/D move forward/back
  handleRotateMovement(direction, moveAmount, deltaTime) {
    switch (direction) {
      case DIRECTION.UP: // Forward
        this.position.x += this.facing.x * moveAmount;
        this.position.y += this.facing.y * moveAmount;
        break;
      case DIRECTION.DOWN: // Backward
        this.position.x -= this.facing.x * moveAmount;
        this.position.y -= this.facing.y * moveAmount;
        break;
      case DIRECTION.LEFT: // Rotate left
        this.addYaw(this.rotateSpeed * deltaTime);
        break;
      case DIRECTION.RIGHT: // Rotate right
        this.addYaw(-this.rotateSpeed * deltaTime);
        break;
    }
  }

  // KEY_PERP: Classic Pacman - arrows = world directions
  handlePerpMovement(direction, moveAmount) {
    switch (direction) {
      case DIRECTION.UP:
        this.position.y += moveAmount;
        this.facing.set(0, 1, 0);
        this.yaw = 0;
        break;
      case DIRECTION.DOWN:
        this.position.y -= moveAmount;
        this.facing.set(0, -1, 0);
        this.yaw = 180;
        break;
      case DIRECTION.LEFT:
        this.position.x -= moveAmount;
        this.facing.set(-1, 0, 0);
        this.yaw = 90;
        break;
      case DIRECTION.RIGHT:
        this.position.x += moveAmount;
        this.facing.set(1, 0, 0);
        this.yaw = 270;
        break;
    }
    // Update strafe vector for PERP mode
    this.updateVectorsFromYaw();
  }

  // Update facing and strafe vectors from yaw angle
  updateVectorsFromYaw() {
    const yawRad = (this.yaw * Math.PI) / 180;
    this.facing.x = -Math.sin(yawRad);
    this.facing.y = Math.cos(yawRad);
    this.strafe.x = Math.cos(yawRad);
    this.strafe.y = Math.sin(yawRad);
  }

  // Add to yaw (for mouse look or rotation)
  addYaw(delta) {
    this.yaw += delta;
    // Normalize yaw to 0-360
    while (this.yaw < 0) this.yaw += 360;
    while (this.yaw >= 360) this.yaw -= 360;
    this.updateVectorsFromYaw();
  }

  // Set yaw directly (for mouse look)
  setYaw(newYaw) {
    this.yaw = newYaw;
    while (this.yaw < 0) this.yaw += 360;
    while (this.yaw >= 360) this.yaw -= 360;
    this.updateVectorsFromYaw();
  }

  // Add to pitch (for mouse look up/down)
  addPitch(delta) {
    this.pitch += delta;
    // Clamp pitch to prevent flipping (-89 to 89 degrees)
    this.pitch = Math.max(-89, Math.min(89, this.pitch));
  }

  // Get pitch for camera
  getPitch() {
    return this.pitch;
  }

  // Clamp pitch to a maximum absolute value (used when switching to FPPOV)
  clampPitch(maxAbsValue) {
    this.pitch = Math.max(-maxAbsValue, Math.min(maxAbsValue, this.pitch));
  }

  // Set key mode
  setKeyMode(mode) {
    this.keyMode = mode;
  }

  getKeyMode() {
    return this.keyMode;
  }

  checkTeleport() {
    const gridX = this.level.worldToGrid(this.position.x);
    const gridY = this.level.worldToGrid(this.position.y);

    // Teleports work like the original C++ implementation:
    // - Each teleport pair links two tiles
    // - Walking past the edge of one teleport sends you to the other
    // We check if Pacman has walked past the teleport tile's edge

    if (!this.level.teleports || this.level.teleports.length === 0) return;

    // Iterate through all teleport pairs
    for (const pair of this.level.teleports) {
      if (!Array.isArray(pair) || pair.length !== 2) continue;

      const teleport0 = pair[0];
      const teleport1 = pair[1];

      // Check if walked west past left teleport (teleport0)
      if (gridY === teleport0.y) {
        const teleportWorldX = this.level.gridToWorld(teleport0.x);
        const halfScale = this.level.scale / 2;

        // If Pacman is at or past the left edge of teleport 0, send to teleport 1
        if (this.position.x < teleportWorldX - halfScale + this.radius) {
          this.position.x = this.level.gridToWorld(teleport1.x);
          this.position.y = this.level.gridToWorld(teleport1.y);
          return;
        }
      }

      // Check if walked east past right teleport (teleport1)
      if (gridY === teleport1.y) {
        const teleportWorldX = this.level.gridToWorld(teleport1.x);
        const halfScale = this.level.scale / 2;

        // If Pacman is at or past the right edge of teleport 1, send to teleport 0
        if (this.position.x > teleportWorldX + halfScale - this.radius) {
          this.position.x = this.level.gridToWorld(teleport0.x);
          this.position.y = this.level.gridToWorld(teleport0.y);
          return;
        }
      }

      // Check if walked north past top teleport (teleport0) - vertical teleport
      if (gridX === teleport0.x) {
        const teleportWorldY = this.level.gridToWorld(teleport0.y);
        const halfScale = this.level.scale / 2;

        // If Pacman is at or past the top edge of teleport 0, send to teleport 1
        if (this.position.y > teleportWorldY + halfScale - this.radius) {
          this.position.x = this.level.gridToWorld(teleport1.x);
          this.position.y = this.level.gridToWorld(teleport1.y);
          return;
        }
      }

      // Check if walked south past bottom teleport (teleport1) - vertical teleport
      if (gridX === teleport1.x) {
        const teleportWorldY = this.level.gridToWorld(teleport1.y);
        const halfScale = this.level.scale / 2;

        // If Pacman is at or past the bottom edge of teleport 1, send to teleport 0
        if (this.position.y < teleportWorldY - halfScale + this.radius) {
          this.position.x = this.level.gridToWorld(teleport0.x);
          this.position.y = this.level.gridToWorld(teleport0.y);
          return;
        }
      }
    }
  }

  getPosition() {
    return this.position;
  }

  getFacing() {
    return this.facing;
  }

  getYaw() {
    return this.yaw;
  }

  getMouthAngle() {
    return this.mouthAngle;
  }

  isChasing() {
    return this._chasing;
  }

  setChasing(chasing) {
    this._chasing = chasing;
  }

  reset() {
    // Reset to starting position
    this.position.set(this.startX * this.scale, this.startY * this.scale, this.scale / 2);
    this.yaw = 180;
    this.pitch = 0;
    this.facing.set(0, -1, 0);
    this.strafe.set(-1, 0, 0);
    this.mouthAngle = 0;
    this.mouthAnimating = false;
    this.animateMouth(0);
    this._syncGroupPosition();
    this.group.rotation.z = (this.yaw * Math.PI) / 180;
  }

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
        // Phase 1: Open mouth wide
        const phase1Progress = progress / 0.4;
        // Open mouth to 170 degrees (almost flat)
        this.setMouthAngle(phase1Progress * 170);
      } else {
        // Phase 2: Collapse inward while spinning
        const phase2Progress = (progress - 0.4) / 0.6;

        // Keep mouth wide open
        this.setMouthAngle(170);

        // Shrink pacman
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

  // Set mouth angle directly (for death animation)
  // Uses pivot groups like animateMouth() to preserve hemisphere orientation
  setMouthAngle(degrees) {
    this.mouthAngle = Math.min(180, Math.max(0, degrees));
    const rad = (this.mouthAngle * Math.PI) / 180;
    // Rotate pivot groups, not hemispheres directly (preserves base hemisphere rotation)
    this.topPivot.rotation.x = rad / 2;
    this.bottomPivot.rotation.x = -rad / 2;
  }

  // Make pacman invisible (for first person view)
  setVisible(visible) {
    this.group.visible = visible;
  }

  // Set transparency (for first person view with partial visibility)
  setTransparency(alpha) {
    this.bodyMaterial.transparent = alpha < 1;
    this.bodyMaterial.opacity = alpha;
  }
}
