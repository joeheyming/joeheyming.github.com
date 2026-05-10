/**
 * Ghost — Phase 3 patrol/chase/flee NPC for Pac-Infinite.
 *
 * Spawning is owned by the World as a Minecraft-style live pool around
 * the player (random tiles outside a safety radius, soft cap, despawn
 * when the player walks far away). A Ghost no longer has a "home chunk"
 * to respawn at — once eaten, it self-marks for despawn and the World's
 * spawn loop will roll a new ghost somewhere else when the population
 * dips below the target count.
 *
 * AI states:
 *   WANDER — random walk; switch to CHASE when Pacman within radius
 *   CHASE  — greedy walk toward Pacman; back to WANDER outside leave-radius
 *   FLEE   — power mode active; greedy walk AWAY from Pacman, slowed
 *   EATEN  — Pacman ate this ghost while it was fleeing; brief delay then
 *            World disposes us
 *
 * Movement is grid-locked — each tile-arrival picks the next neighbor.
 * Movement obeys the same surface-height rules as Pacman (auto-step ±1,
 * no jumping in v1) so ghosts naturally path around cliffs they can't
 * climb.
 *
 * Visual model is the classic Pac-Man ghost: hemisphere head + cylinder
 * body + 6-tentacle wavy bottom + two eyes with pupils. No external
 * assets. Mirrors /pacman/js/ghost.js's createModel() shape.
 */

import * as THREE from 'three';
import { GAMEPLAY, GHOST_STATE } from './constants.js';

// 4 colour variants. Order matches "rgb wheel" feel of the classic
// ghosts (red, pink, cyan, orange) without the personality quirks of
// Blinky/Inky/Pinky/Clyde.
const GHOST_COLORS = [0xff3030, 0xff80c0, 0x40e0ff, 0xffa040];
const FLEE_COLOR = 0x2030c0; // deep blue
const FLEE_BLINK_COLOR = 0xffffff; // near end of power mode, blink white
const EYE_COLOR = 0xffffff;
const PUPIL_COLOR = 0x101040;

// Power-mode tail: when the timer is below this many seconds, blink as a
// classic Pac-Man "power running out" hint.
const FLEE_BLINK_THRESHOLD_S = 2.0;
const FLEE_BLINK_HZ = 6;

// Tentacle count for the wavy bottom — 6 matches the original game.
const TENTACLES = 6;

export class Ghost {
  /**
   * @param {object} opts
   * @param {number} opts.gridX - initial grid X
   * @param {number} opts.gridY - initial grid Y
   * @param {number} opts.colorIdx - 0..3, picks visual variant
   * @param {number} opts.scale - world units per tile (matches World.scale)
   * @param {object} opts.world - World instance (for movement queries)
   */
  constructor({ gridX, gridY, colorIdx, scale, world }) {
    this.scale = scale;
    this.world = world;
    this.colorIdx = ((colorIdx % 4) + 4) % 4;
    this.color = GHOST_COLORS[this.colorIdx];
    // Ghost radius — fits within a tile and matches the visual heft of
    // the original game's ghosts.
    this.radius = scale * 0.35;

    this.state = GHOST_STATE.WANDER;
    /** Set true when Pacman ate us; World's update sweep will dispose us. */
    this.shouldDespawn = false;
    this.despawnTimer = 0;
    this.fleeTimer = 0; // mirrors pacman's powerTimer for blink animation

    // Tile-locked logical position. We always know which tile the ghost
    // *is on* (grid coords) and which tile it's heading to (target). The
    // visual position lerps between them in update().
    this.gridX = gridX;
    this.gridY = gridY;
    this.targetGridX = gridX;
    this.targetGridY = gridY;
    this.surfaceHeight = world.surfaceHeightAt(gridX, gridY);
    if (!Number.isFinite(this.surfaceHeight) || Number.isNaN(this.surfaceHeight)) {
      this.surfaceHeight = 0;
    }
    this.lastDir = null; // last cardinal direction taken, for reverse-bias

    // World-space position (driven by lerp between gridX/Y and targetGridX/Y).
    // Z anchor sits the body so the cylinder bottom is at the surface,
    // not the body centre.
    this.position = new THREE.Vector3(
      gridX * scale,
      gridY * scale,
      this.surfaceHeight * scale + this.radius * 1.2
    );

    this._buildModel();
    this._applyColor(this.color);
    this.group.position.copy(this.position);
  }

  /**
   * Build the classic ghost model: open-ended cylinder body, top
   * hemisphere head, custom wavy bottom with triangular tentacles, two
   * white eyes with dark pupils. Geometry shapes are ported from
   * /pacman/js/ghost.js#createModel.
   */
  _buildModel() {
    const r = this.radius;
    const bodyHeight = r * 1.5;

    this.group = new THREE.Group();

    this.bodyMaterial = new THREE.MeshStandardMaterial({
      color: this.color,
      roughness: 0.4,
      metalness: 0.05,
      emissive: this.color,
      emissiveIntensity: 0.25
    });
    this.eyeMaterial = new THREE.MeshStandardMaterial({
      color: EYE_COLOR,
      roughness: 0.5
    });
    this.pupilMaterial = new THREE.MeshStandardMaterial({
      color: PUPIL_COLOR,
      roughness: 0.8
    });

    // Body: open-ended cylinder rotated so its axis runs along Z (matches
    // the rest of the game's "Z = up" convention).
    const bodyGeo = new THREE.CylinderGeometry(r, r, bodyHeight, 20, 1, true);
    const body = new THREE.Mesh(bodyGeo, this.bodyMaterial);
    body.rotation.x = Math.PI / 2;
    body.position.z = 0;
    body.castShadow = true;
    this.group.add(body);

    // Head: hemisphere (top half of a sphere) sitting on top of the body.
    // SphereGeometry's thetaLength=PI/2 carves out just the top half; the
    // x-axis rotation lays the flat side downward so it caps the cylinder.
    const headGeo = new THREE.SphereGeometry(r, 24, 12, 0, Math.PI * 2, 0, Math.PI / 2);
    const head = new THREE.Mesh(headGeo, this.bodyMaterial);
    head.rotation.x = Math.PI / 2;
    head.position.z = bodyHeight / 2;
    head.castShadow = true;
    this.group.add(head);

    // Wavy bottom: a triangle fan from the body's bottom centre out to
    // 2N alternating high/low points around the rim. Even points sit at
    // the body bottom (cylinder rim), odd points dip below to form
    // tentacle tips. Reading the geometry head-on you see 6 V-shapes.
    const bottomMesh = this._buildWavyBottom(bodyHeight);
    this.group.add(bottomMesh);
    this.bottomMesh = bottomMesh;

    // Eyes — two white spheres with dark pupils on the front of the
    // hemisphere. Forward = -Y (matches the rest of the codebase's
    // "facing forward = -y" convention seen in pacman.js).
    const eyeRadius = r * 0.22;
    const pupilRadius = r * 0.1;
    const eyeGeo = new THREE.SphereGeometry(eyeRadius, 12, 12);
    const pupilGeo = new THREE.SphereGeometry(pupilRadius, 8, 8);
    const eyeZ = bodyHeight / 2 + r * 0.2;
    const eyeOffsetX = r * 0.4;
    const eyeForwardY = -r * 0.55;
    const pupilForwardY = -r * 0.85;

    const leftEye = new THREE.Mesh(eyeGeo, this.eyeMaterial);
    const rightEye = new THREE.Mesh(eyeGeo, this.eyeMaterial);
    leftEye.position.set(-eyeOffsetX, eyeForwardY, eyeZ);
    rightEye.position.set(eyeOffsetX, eyeForwardY, eyeZ);
    const leftPupil = new THREE.Mesh(pupilGeo, this.pupilMaterial);
    const rightPupil = new THREE.Mesh(pupilGeo, this.pupilMaterial);
    leftPupil.position.set(-eyeOffsetX, pupilForwardY, eyeZ);
    rightPupil.position.set(eyeOffsetX, pupilForwardY, eyeZ);
    this.group.add(leftEye, rightEye, leftPupil, rightPupil);
    this.eyes = [leftEye, rightEye, leftPupil, rightPupil];
  }

  /**
   * Build the triangle-fan "wavy bottom" with `TENTACLES` V-shapes around
   * the rim. Vertices alternate between rim height (cylinder bottom) and
   * tip height (one tentacle's-length below) for the zigzag silhouette.
   * Ported from /pacman/js/ghost.js#createWavyBottom.
   */
  _buildWavyBottom(bodyHeight) {
    const r = this.radius;
    const tentacleHeight = r * 0.6;
    const bottomZ = -bodyHeight / 2;

    const vertices = [];
    const indices = [];

    vertices.push(0, 0, bottomZ); // centre vertex (index 0)

    const N = TENTACLES * 2;
    for (let i = 0; i < N; i++) {
      const angle = (i / N) * Math.PI * 2;
      const x = Math.cos(angle) * r;
      const y = Math.sin(angle) * r;
      const z = i % 2 === 0 ? bottomZ : bottomZ - tentacleHeight;
      vertices.push(x, y, z);
    }
    // Connect each pair of adjacent rim vertices to the centre to fan
    // the bottom into N triangles.
    for (let i = 0; i < N; i++) {
      const a = i + 1;
      const b = ((i + 1) % N) + 1;
      indices.push(0, a, b);
    }

    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(vertices), 3));
    geo.setIndex(indices);
    geo.computeVertexNormals();

    const mesh = new THREE.Mesh(geo, this.bodyMaterial);
    mesh.castShadow = true;
    return mesh;
  }

  _applyColor(c) {
    this.bodyMaterial.color.setHex(c);
    this.bodyMaterial.emissive.setHex(c);
  }

  // ---------------------------------------------------------------------------
  // Scene attachment
  // ---------------------------------------------------------------------------

  addToScene(scene) {
    scene.add(this.group);
  }

  removeFromScene(scene) {
    scene.remove(this.group);
  }

  dispose() {
    this.group.traverse((obj) => {
      if (obj.isMesh) {
        obj.geometry?.dispose();
      }
    });
    this.bodyMaterial?.dispose();
    this.eyeMaterial?.dispose();
    this.pupilMaterial?.dispose();
  }

  setVisible(v) {
    this.group.visible = v;
  }

  getPosition() {
    return this.position;
  }

  /** Cheap squared-distance helper (avoids sqrt). */
  _distSqToPacman(pacmanPos) {
    const dx = this.position.x - pacmanPos.x;
    const dy = this.position.y - pacmanPos.y;
    return dx * dx + dy * dy;
  }

  // ---------------------------------------------------------------------------
  // State transitions
  // ---------------------------------------------------------------------------

  enterFlee(durationS) {
    if (this.state === GHOST_STATE.EATEN) return; // eaten ghosts don't get re-scared
    this.state = GHOST_STATE.FLEE;
    this.fleeTimer = durationS;
    this._applyColor(FLEE_COLOR);
    // Hide eyes during flee — they mute back the personality and read
    // immediately as "this one's vulnerable".
    for (const e of this.eyes) e.visible = false;
  }

  exitFlee() {
    if (this.state !== GHOST_STATE.FLEE) return;
    this.state = GHOST_STATE.WANDER;
    this.fleeTimer = 0;
    this._applyColor(this.color);
    for (const e of this.eyes) e.visible = true;
  }

  /** Pacman ate this ghost while it was fleeing. Schedules a despawn. */
  setEaten() {
    this.state = GHOST_STATE.EATEN;
    this.despawnTimer = GAMEPLAY.GHOST_DESPAWN_DELAY;
    this.fleeTimer = 0;
    this.setVisible(false);
  }

  // ---------------------------------------------------------------------------
  // Update — driven from World/Game once per frame
  // ---------------------------------------------------------------------------

  update(dt, pacmanPos) {
    // EATEN: hidden timer; flag for despawn when it expires. World's
    // _cullGhosts() picks us up next sweep.
    if (this.state === GHOST_STATE.EATEN) {
      this.despawnTimer -= dt;
      if (this.despawnTimer <= 0) {
        this.shouldDespawn = true;
      }
      return;
    }

    // FLEE timer countdown — Game also calls exitFlee() when power mode
    // ends, but having the timer here means a ghost spawned mid-power
    // gracefully ends scared too.
    if (this.state === GHOST_STATE.FLEE) {
      this.fleeTimer -= dt;
      if (this.fleeTimer <= 0) {
        this.exitFlee();
      } else if (this.fleeTimer < FLEE_BLINK_THRESHOLD_S) {
        const phase = Math.floor(this.fleeTimer * FLEE_BLINK_HZ * 2) % 2;
        this._applyColor(phase === 0 ? FLEE_COLOR : FLEE_BLINK_COLOR);
      }
    }

    // WANDER ↔ CHASE hysteresis — only allowed when not fleeing.
    // Difficulty scales the chase radii (hard makes ghosts notice you
    // sooner; easy makes them ignore you longer). The leave radius
    // scales with the same multiplier so the hysteresis ratio holds.
    if (this.state === GHOST_STATE.WANDER || this.state === GHOST_STATE.CHASE) {
      const dSq = this._distSqToPacman(pacmanPos);
      const chaseMul = this.world?.difficulty?.ghostChaseRadiusMul ?? 1.0;
      const chaseR = GAMEPLAY.GHOST_CHASE_RADIUS * this.scale * chaseMul;
      const leaveR = GAMEPLAY.GHOST_LEAVE_CHASE_RADIUS * this.scale * chaseMul;
      if (this.state === GHOST_STATE.WANDER && dSq < chaseR * chaseR) {
        this.state = GHOST_STATE.CHASE;
      } else if (this.state === GHOST_STATE.CHASE && dSq > leaveR * leaveR) {
        this.state = GHOST_STATE.WANDER;
      }
    }

    // Tile-step movement.
    const arrived = this._stepTowardTarget(dt);
    if (arrived) {
      this._pickNextTarget(pacmanPos);
    }
  }

  _stepTowardTarget(dt) {
    const speedMul = this.world?.difficulty?.ghostSpeedMul ?? 1.0;
    let speed = GAMEPLAY.GHOST_SPEED * speedMul;
    if (this.state === GHOST_STATE.FLEE) speed *= GAMEPLAY.GHOST_FLEE_SPEED_MULTIPLIER;

    const tx = this.targetGridX * this.scale;
    const ty = this.targetGridY * this.scale;
    const tz = this.world.surfaceHeightAt(this.targetGridX, this.targetGridY);
    // Anchor the body so the cylinder bottom rests on the tile surface.
    const safeTz =
      Number.isFinite(tz) && !Number.isNaN(tz)
        ? tz * this.scale + this.radius * 1.2
        : this.position.z;

    const dx = tx - this.position.x;
    const dy = ty - this.position.y;
    const dz = safeTz - this.position.z;
    const distXY = Math.hypot(dx, dy);

    if (distXY < 0.001) {
      this.position.x = tx;
      this.position.y = ty;
      this.position.z = safeTz;
      this.gridX = this.targetGridX;
      this.gridY = this.targetGridY;
      this.surfaceHeight = Number.isFinite(tz) ? tz : this.surfaceHeight;
      this._refreshTransform();
      return true;
    }

    const stepXY = Math.min(speed * dt, distXY);
    this.position.x += (dx / distXY) * stepXY;
    this.position.y += (dy / distXY) * stepXY;
    const stepZ = Math.sign(dz) * Math.min(Math.abs(dz), speed * dt * 1.5);
    this.position.z += stepZ;

    this._refreshTransform();
    return false;
  }

  _refreshTransform() {
    this.group.position.copy(this.position);
    if (this.lastDir) {
      let yaw = 0;
      switch (this.lastDir) {
        case 'up': yaw = 0; break;
        case 'down': yaw = Math.PI; break;
        case 'left': yaw = Math.PI / 2; break;
        case 'right': yaw = -Math.PI / 2; break;
      }
      this.group.rotation.z = yaw;
    }
  }

  /**
   * Choose the next adjacent tile to move into based on current state.
   * Falls back to staying put if no neighbor is reachable.
   */
  _pickNextTarget(pacmanPos) {
    const neighbors = this._reachableNeighbors();
    if (neighbors.length === 0) {
      this.targetGridX = this.gridX;
      this.targetGridY = this.gridY;
      return;
    }

    const reverseDir = this._reverseOf(this.lastDir);
    let candidates = neighbors.filter((n) => n.dir !== reverseDir);
    if (candidates.length === 0) candidates = neighbors;

    let chosen;
    if (this.state === GHOST_STATE.CHASE) {
      chosen = this._pickGreedy(candidates, pacmanPos, +1);
    } else if (this.state === GHOST_STATE.FLEE) {
      chosen = this._pickGreedy(candidates, pacmanPos, -1);
    } else {
      chosen = candidates[Math.floor(Math.random() * candidates.length)];
    }

    this.targetGridX = chosen.gx;
    this.targetGridY = chosen.gy;
    this.lastDir = chosen.dir;
  }

  /**
   * @param {Array<{gx:number,gy:number,dir:string}>} candidates
   * @param {THREE.Vector3} pacmanPos
   * @param {number} sign +1 = minimize distance (chase), -1 = maximize (flee)
   */
  _pickGreedy(candidates, pacmanPos, sign) {
    let best = candidates[0];
    let bestScore = sign * this._tileDistSqToPacman(best.gx, best.gy, pacmanPos);
    for (let i = 1; i < candidates.length; i++) {
      const c = candidates[i];
      const score = sign * this._tileDistSqToPacman(c.gx, c.gy, pacmanPos);
      if (score < bestScore) {
        best = c;
        bestScore = score;
      }
    }
    return best;
  }

  _tileDistSqToPacman(gx, gy, pacmanPos) {
    const wx = gx * this.scale;
    const wy = gy * this.scale;
    const dx = wx - pacmanPos.x;
    const dy = wy - pacmanPos.y;
    return dx * dx + dy * dy;
  }

  _reachableNeighbors() {
    const dirs = [
      { dir: 'up', dx: 0, dy: -1 },
      { dir: 'down', dx: 0, dy: 1 },
      { dir: 'left', dx: -1, dy: 0 },
      { dir: 'right', dx: 1, dy: 0 }
    ];
    const here = this.surfaceHeight;
    const out = [];
    for (const { dir, dx, dy } of dirs) {
      const gx = this.gridX + dx;
      const gy = this.gridY + dy;
      const surf = this.world.surfaceHeightAt(gx, gy);
      if (Number.isNaN(surf) || !Number.isFinite(surf)) continue;
      // Same auto-step rule as Pacman's grounded movement (|Δh| ≤ 1).
      if (Math.abs(surf - here) > 1) continue;
      out.push({ dir, gx, gy, surf });
    }
    return out;
  }

  _reverseOf(dir) {
    switch (dir) {
      case 'up': return 'down';
      case 'down': return 'up';
      case 'left': return 'right';
      case 'right': return 'left';
      default: return null;
    }
  }
}
