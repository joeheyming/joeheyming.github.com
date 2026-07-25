/**
 * Bonus Fruit (classic arcade rules)
 *
 * A fruit is a short-lived collectible that:
 *  - Spawns at the level's fruit-spawn tile after a dot-count threshold
 *  - Stays visible for FRUIT_LIFETIME seconds, then despawns silently
 *  - Awards a level-scaled score when Pacman walks onto it
 *
 * The visual is intentionally cheap: a colored emissive sphere with a small
 * stem and leaf accent. Per-fruit "real" 3D models can come later — this
 * keeps the implementation contained and stay-out-of-the-way.
 */

import * as THREE from 'three';
import { FRUIT_TYPES, GAMEPLAY } from './constants.js';

export class Fruit {
  /**
   * @param {{x:number, y:number}} spawn - grid coords (already Y-flipped)
   * @param {number} scale - world units per tile
   * @param {number} levelIndex - 0-based level index into FRUIT_TYPES
   * @param {number} baseZ - world-space height of the fruit's center
   */
  constructor(spawn, scale, levelIndex, baseZ = scale / 2) {
    this.spawn = spawn;
    this.scale = scale;
    this.type = FRUIT_TYPES[Math.min(levelIndex, FRUIT_TYPES.length - 1)];
    this.baseZ = baseZ;

    this.timer = 0;
    this.lifetime = GAMEPLAY.FRUIT_LIFETIME;
    this.collected = false;
    this.expired = false;

    this.radius = scale * 0.28;
    this.group = new THREE.Group();
    this.group.position.set(spawn.x * scale, spawn.y * scale, this.baseZ);

    this._buildModel();
  }

  _buildModel() {
    // Body — emissive sphere in fruit color
    const body = new THREE.Mesh(
      new THREE.SphereGeometry(this.radius, 16, 12),
      new THREE.MeshStandardMaterial({
        color: this.type.color,
        emissive: this.type.color,
        emissiveIntensity: 0.55,
        roughness: 0.4,
        metalness: 0.1
      })
    );
    body.castShadow = true;
    this.group.add(body);

    // Tiny green leaf so it reads as "fruit" rather than "another ball"
    const leaf = new THREE.Mesh(
      new THREE.SphereGeometry(this.radius * 0.35, 8, 6),
      new THREE.MeshStandardMaterial({ color: 0x44aa33, roughness: 0.6 })
    );
    leaf.position.set(this.radius * 0.4, this.radius * 0.6, this.radius * 0.2);
    leaf.scale.set(1.2, 0.5, 0.6);
    this.group.add(leaf);
  }

  addToScene(scene) {
    scene.add(this.group);
  }

  removeFromScene(scene) {
    scene.remove(this.group);
  }

  /**
   * Tick the fruit and animate (gentle bob + spin).
   * Sets `this.expired` when its lifetime runs out.
   */
  update(deltaTime, elapsedTime) {
    if (this.collected || this.expired) return;

    this.timer += deltaTime;
    if (this.timer >= this.lifetime) {
      this.expired = true;
      this.group.visible = false;
      return;
    }

    // Gentle hover + rotation
    const bob = Math.sin(elapsedTime * 3) * this.scale * 0.06;
    this.group.position.z = this.baseZ + bob;
    this.group.rotation.z = elapsedTime * 1.2;

    // Blink during the final 2 seconds so the player knows it's about to leave
    const timeLeft = this.lifetime - this.timer;
    if (timeLeft < 2) {
      this.group.visible = Math.floor(timeLeft * 6) % 2 === 0;
    }
  }

  /**
   * Returns true if the fruit hasn't been collected/expired and Pacman is
   * within `collectRadius` world units of it.
   */
  isCollectibleAt(worldPos, collectRadius) {
    if (this.collected || this.expired) return false;
    return this.group.position.distanceTo(worldPos) < collectRadius;
  }

  collect() {
    this.collected = true;
    this.group.visible = false;
    return this.type.score;
  }
}
