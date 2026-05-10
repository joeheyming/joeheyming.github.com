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

const FRUIT_TYPES = [
  // cherry — twin red spheres on a brown stem
  {
    id: 'cherry',
    bodyColor: 0xff2030,
    stemColor: 0x6a3a1a,
    leafColor: 0x40c040,
    bodyScale: 0.5,
    twin: true
  },
  // strawberry — single red sphere with a green leaf
  {
    id: 'strawberry',
    bodyColor: 0xff5060,
    stemColor: 0x6a3a1a,
    leafColor: 0x40c040,
    bodyScale: 0.55,
    twin: false
  },
  // orange — single orange sphere
  {
    id: 'orange',
    bodyColor: 0xff9020,
    stemColor: 0x6a3a1a,
    leafColor: 0x40c040,
    bodyScale: 0.55,
    twin: false
  },
  // apple — green sphere
  {
    id: 'apple',
    bodyColor: 0x40d040,
    stemColor: 0x6a3a1a,
    leafColor: 0x60ff60,
    bodyScale: 0.55,
    twin: false
  }
];

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
      emissive: this.type.bodyColor,
      emissiveIntensity: 0.25
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
