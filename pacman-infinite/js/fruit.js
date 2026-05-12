/**
 * Fruit — Phase 3 timed bonus pickups.
 *
 * Game.js spawns one fruit at a time, every `FRUIT_SPAWN_PERIOD` seconds,
 * at a random nearby walkable tile. The fruit bobs and spins in place,
 * despawns after `FRUIT_LIFETIME`, and gives `SCORE_FRUIT` points when
 * Pacman touches it.
 *
 * Procedural meshes only — no external assets. Each fruit type is a
 * different colour/shape combo so the player gets visual variety even
 * without a texture artist.
 */

import * as THREE from 'three';
import { GAMEPLAY } from './constants.js';

// Fruit family (Tier 4). Each entry carries:
//   - visual identity (colors, scale, twin flag)
//   - scoreValue: base points awarded BEFORE the score multiplier
//   - foodValue: hunger meter delta (negative for skull-fruit — eating it
//     burns calories, which is the entire point of the high-risk pick)
//   - weight: base spawn weight (relative; higher = more common)
//   - minFarTiles: this fruit can ONLY spawn once Pacman has wandered
//     this many tiles from origin. 0 means "always available". Used by
//     world-level weighted picking in game-spawn.js to gate the rare,
//     high-value fruits behind survival pressure.
const FRUIT_TYPES = [
  // cherry — twin red spheres on a brown stem; the everyday pickup
  {
    id: 'cherry',
    bodyColor: 0xff2030,
    stemColor: 0x6a3a1a,
    leafColor: 0x40c040,
    bodyScale: 0.5,
    twin: true,
    scoreValue: 100,
    foodValue: 30,
    weight: 5,
    minFarTiles: 0
  },
  // strawberry — single red sphere with a green leaf
  {
    id: 'strawberry',
    bodyColor: 0xff5060,
    stemColor: 0x6a3a1a,
    leafColor: 0x40c040,
    bodyScale: 0.55,
    twin: false,
    scoreValue: 200,
    foodValue: 35,
    weight: 4,
    minFarTiles: 0
  },
  // orange — single orange sphere; mid-tier reward.
  // Was gated to 50 tiles which meant it almost never showed up in
  // typical play; halved so a casual run starts seeing it within the
  // first chunk or two.
  {
    id: 'orange',
    bodyColor: 0xff9020,
    stemColor: 0x6a3a1a,
    leafColor: 0x40c040,
    bodyScale: 0.55,
    twin: false,
    scoreValue: 300,
    foodValue: 40,
    weight: 3,
    minFarTiles: 25
  },
  // apple — green sphere; the staple long-game fuel source.
  // Was 100 tiles → halved to 50 so the staple appears once you've
  // explored a few chunks rather than waiting for a deep-run trip.
  {
    id: 'apple',
    bodyColor: 0x40d040,
    stemColor: 0x6a3a1a,
    leafColor: 0x60ff60,
    bodyScale: 0.55,
    twin: false,
    scoreValue: 500,
    foodValue: 50,
    weight: 2,
    minFarTiles: 50
  },
  // lemon — sour: big score, modest food. Visible as bright yellow.
  // Was 200 tiles → 120 so a moderately committed run gets the variety.
  {
    id: 'lemon',
    bodyColor: 0xfff040,
    stemColor: 0x6a3a1a,
    leafColor: 0x80c040,
    bodyScale: 0.5,
    twin: false,
    scoreValue: 800,
    foodValue: 25,
    weight: 1.5,
    minFarTiles: 120
  },
  // skull-fruit — purple, high-risk: massive score, NEGATIVE food.
  // Was 300 tiles → 200 so a deep-but-not-record run can encounter
  // the greed test. Still gated enough that it reads as a "deep
  // wandering" reward rather than a beginner trap.
  {
    id: 'skullfruit',
    bodyColor: 0x6020d0,
    stemColor: 0x303040,
    leafColor: 0xa080ff,
    bodyScale: 0.6,
    twin: false,
    scoreValue: 2000,
    foodValue: -30,
    weight: 0.6,
    minFarTiles: 200
  }
];

/**
 * Weighted random pick from FRUIT_TYPES based on Pacman's current
 * distance-from-origin (in tile-units). Fruits whose minFarTiles is
 * above the current distance are excluded entirely. Among the
 * available types we also tilt the weights so the rarer / high-value
 * fruits become MORE likely as you press farther — at the survival
 * cap (FAR_CAP_TILES, ~600 tiles) the skull-fruit/lemon are roughly
 * as likely as the basic cherry.
 *
 * @param {number} farTiles  current distance from origin
 * @param {number} farCap    cap used by the world's farPct (for tilt math)
 * @returns {{ typeIdx: number, type: object }}
 */
export function pickFruitTypeForDistance(farTiles, farCap = 600) {
  const farPct = Math.max(0, Math.min(1, farTiles / farCap));
  const candidates = [];
  for (let i = 0; i < FRUIT_TYPES.length; i++) {
    const t = FRUIT_TYPES[i];
    if (farTiles < (t.minFarTiles ?? 0)) continue;
    // Distance tilt: rarer fruits (lower base weight) gain more from
    // farPct than common ones. (1/weight) × farPct flattens the
    // distribution toward "all roughly equal" at full progression.
    const tilted = t.weight + (1 / Math.max(0.1, t.weight)) * farPct * 4;
    candidates.push({ idx: i, type: t, w: tilted });
  }
  if (candidates.length === 0) return { typeIdx: 0, type: FRUIT_TYPES[0] };
  let total = 0;
  for (const c of candidates) total += c.w;
  let roll = Math.random() * total;
  for (const c of candidates) {
    roll -= c.w;
    if (roll <= 0) return { typeIdx: c.idx, type: c.type };
  }
  const last = candidates[candidates.length - 1];
  return { typeIdx: last.idx, type: last.type };
}

export class Fruit {
  /**
   * @param {object} opts
   * @param {number} opts.gridX
   * @param {number} opts.gridY
   * @param {number} opts.surfaceHeight - tile-units (for z position)
   * @param {number} opts.scale - world units per tile
   * @param {number} [opts.typeIdx] - 0..3, picks visual variant. Random if omitted.
   */
  constructor({ gridX, gridY, surfaceHeight, scale, typeIdx }) {
    this.gridX = gridX;
    this.gridY = gridY;
    this.scale = scale;
    this.surfaceHeight = surfaceHeight;
    this.lifetime = GAMEPLAY.FRUIT_LIFETIME;
    this.elapsed = 0;
    this.expired = false;

    this.typeIdx =
      typeIdx === undefined ? Math.floor(Math.random() * FRUIT_TYPES.length) : typeIdx % FRUIT_TYPES.length;
    this.type = FRUIT_TYPES[this.typeIdx];
    // Surface per-type values on the instance so game-spawn.js can credit
    // the right score / food without re-importing the FRUIT_TYPES table.
    // Falls back to the previous defaults (SCORE_FRUIT / FOOD_PER_FRUIT)
    // for legacy fruits constructed without the new fields.
    this.scoreValue = this.type.scoreValue ?? GAMEPLAY.SCORE_FRUIT;
    this.foodValue = this.type.foodValue ?? GAMEPLAY.FOOD_PER_FRUIT;

    // World-space anchor (centre of bob — visual mesh oscillates above this).
    this.position = new THREE.Vector3(
      gridX * scale,
      gridY * scale,
      surfaceHeight * scale + scale * 0.6
    );

    this._buildModel();
    this.group.position.copy(this.position);
  }

  _buildModel() {
    this.group = new THREE.Group();
    const r = this.scale * this.type.bodyScale * 0.5;

    const bodyMat = new THREE.MeshStandardMaterial({
      color: this.type.bodyColor,
      roughness: 0.4,
      metalness: 0.1,
      // Brighter base emissive (was 0.25) so a fruit reads from across
      // a dim chunk — fruits are rare enough that the player should
      // notice one as soon as it enters the camera frustum. The bob
      // animation in update() pushes intensity even higher on the
      // sine-wave high half.
      emissive: this.type.bodyColor,
      emissiveIntensity: 0.55
    });
    const stemMat = new THREE.MeshStandardMaterial({
      color: this.type.stemColor,
      roughness: 0.9
    });
    const leafMat = new THREE.MeshStandardMaterial({
      color: this.type.leafColor,
      roughness: 0.6,
      emissive: this.type.leafColor,
      emissiveIntensity: 0.1
    });
    this.materials = [bodyMat, stemMat, leafMat];

    const sphere = new THREE.SphereGeometry(r, 14, 12);
    if (this.type.twin) {
      // Two cherries side by side
      const left = new THREE.Mesh(sphere, bodyMat);
      const right = new THREE.Mesh(sphere, bodyMat);
      left.position.x = -r * 0.7;
      right.position.x = r * 0.7;
      left.castShadow = true;
      right.castShadow = true;
      this.group.add(left, right);
    } else {
      const body = new THREE.Mesh(sphere, bodyMat);
      body.castShadow = true;
      this.group.add(body);
    }

    // Stem
    const stemGeo = new THREE.CylinderGeometry(r * 0.08, r * 0.1, r * 0.7, 8);
    const stem = new THREE.Mesh(stemGeo, stemMat);
    stem.rotation.x = Math.PI / 2;
    stem.position.z = r * 0.7;
    this.group.add(stem);

    // Leaf
    const leafGeo = new THREE.SphereGeometry(r * 0.25, 8, 6);
    const leaf = new THREE.Mesh(leafGeo, leafMat);
    leaf.scale.set(1.6, 0.5, 0.6);
    leaf.position.set(r * 0.3, 0, r * 0.95);
    this.group.add(leaf);
  }

  addToScene(scene) {
    scene.add(this.group);
  }

  removeFromScene(scene) {
    scene.remove(this.group);
  }

  dispose() {
    this.group.traverse((obj) => {
      if (obj.isMesh) obj.geometry?.dispose();
    });
    for (const m of this.materials) m.dispose();
  }

  getPosition() {
    return this.position;
  }

  /** Tile coords match — used by Game to deduplicate spawns at same spot. */
  getGridCoords() {
    return { gx: this.gridX, gy: this.gridY };
  }

  /**
   * Tick the fruit's bob/spin animation and lifetime.
   * Returns true once the fruit has expired (Game should despawn it).
   */
  update(dt) {
    if (this.expired) return true;
    this.elapsed += dt;
    if (this.elapsed >= this.lifetime) {
      this.expired = true;
      return true;
    }

    const bob = Math.sin(this.elapsed * 4) * this.scale * 0.08;
    this.group.position.set(this.position.x, this.position.y, this.position.z + bob);
    this.group.rotation.z = this.elapsed * 1.3;

    // Continuous emissive twinkle so the fruit visibly draws attention
    // even from across a chunk. ~1 Hz pulse, swings between 0.45 and
    // 0.85 — never fully dim, so it stays "on the radar" the whole
    // lifetime. The materials are per-fruit (not pooled) so this
    // mutation is safe.
    if (this.materials && this.materials[0]) {
      const e = 0.45 + 0.4 * (0.5 + 0.5 * Math.sin(this.elapsed * 6));
      this.materials[0].emissiveIntensity = e;
    }

    // Last-second-pulse: blink scale slightly during the final 2 seconds
    // so the player sees the fruit is about to disappear.
    const remaining = this.lifetime - this.elapsed;
    if (remaining < 2) {
      const pulse = 1 + Math.sin(this.elapsed * 12) * 0.1;
      this.group.scale.setScalar(pulse);
    }
    return false;
  }

  getTimeRemaining() {
    return Math.max(0, this.lifetime - this.elapsed);
  }
}

export const FRUIT_TYPE_COUNT = FRUIT_TYPES.length;
