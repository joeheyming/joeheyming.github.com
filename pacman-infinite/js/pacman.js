/**
 * Pacman Character
 * 3D model with animated mouth using two hemispheres.
 * Movement and life-cycle methods live in `./pacman-movement.js` and
 * `./pacman-life.js` and are mixed into the prototype at the bottom.
 */

import * as THREE from 'three';
import { KEY_MODE, GAMEPLAY } from './constants.js';
import { movementMethods } from './pacman-movement.js';
import { lifeMethods } from './pacman-life.js';

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
    // then the body spins and shrinks. Independent state machine from
    // the void fall so they don't fight over the group transform.
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
    this.topHemisphere.rotation.x = Math.PI / 2;
    this.topHemisphere.castShadow = true;
    this.topPivot.add(this.topHemisphere);

    // Bottom hemisphere - rotate -90° around X so it faces +Y, flipped for bottom half
    this.bottomHemisphere = new THREE.Mesh(sphereGeometry, this.bodyMaterial);
    this.bottomHemisphere.rotation.x = -Math.PI / 2;
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
   * Sunken-hazard "wading in water" is a real height drop —
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

    const leftPos = new THREE.Vector3(0, eyeDistance, 0);
    leftPos.applyAxisAngle(new THREE.Vector3(1, 0, 0), eyeAngleX);
    leftPos.applyAxisAngle(new THREE.Vector3(0, 0, 1), eyeAngleZ);
    this.leftEye.position.copy(leftPos);

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

    // Handle movement (height- and jump-aware). See ./pacman-movement.js.
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

    this._syncGroupPosition();
    this.group.rotation.x = 0;
    this.group.rotation.z = (this.yaw * Math.PI) / 180;
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

  // Set mouth angle directly (used by death animations).
  // Uses pivot groups like animateMouth() to preserve hemisphere orientation.
  setMouthAngle(degrees) {
    this.mouthAngle = Math.min(180, Math.max(0, degrees));
    const rad = (this.mouthAngle * Math.PI) / 180;
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

// Mix in the methods that live in sibling files. They use `this` like
// regular class methods, but live separately so this file stays focused
// on the model + per-frame update orchestration.
Object.assign(Pacman.prototype, movementMethods, lifeMethods);
