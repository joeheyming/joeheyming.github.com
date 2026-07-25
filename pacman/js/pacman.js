/**
 * Pacman Character
 * 3D model with animated mouth using two hemispheres
 * Based on original Pacman.cpp
 */

import * as THREE from 'three';
import { DIRECTION, KEY_MODE, GAMEPLAY } from './constants.js';

export class Pacman {
  constructor(startX, startY, scale, level) {
    this.startX = startX;
    this.startY = startY;
    this.scale = scale;
    this.level = level;

    // Size (2*scale/5 from original)
    this.radius = (2 * scale) / 5;

    // Position
    this.position = new THREE.Vector3(
      startX * scale,
      startY * scale,
      level.getEntityZ(startX, startY)
    );

    // Movement
    this.moveSpeed = GAMEPLAY.PACMAN_SPEED;
    this.rotateSpeed = GAMEPLAY.PACMAN_ROTATE_SPEED;
    this.facing = new THREE.Vector3(0, -1, 0); // Initially facing down
    this.strafe = new THREE.Vector3(-1, 0, 0); // Perpendicular to facing (left)
    this.yaw = 180; // degrees (facing down)
    this.pitch = 0; // degrees (looking straight ahead, positive = up, negative = down)
    this.keyMode = KEY_MODE.PERP; // Default to classic Pacman controls

    // State
    this._chasing = false; // Power mode (true when power pill active)
    this.chaseTimer = 0;

    // Most-recent teleport destination tile key ("x,y"), used to debounce
    // 'next'-mode multi-island teleports so the player doesn't bounce in a
    // loop when standing on the destination after a jump.
    this.lastTeleportTileKey = null;

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
    this.group.position.copy(this.position);

    // Initial mouth animation
    this.animateMouth(0);
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

    // Handle movement
    this.handleMovement(deltaTime, direction, moveVec);

    // Update group position and rotation
    this.group.position.copy(this.position);
    this.group.rotation.z = (this.yaw * Math.PI) / 180;
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
    const moveAmount = this.moveSpeed * deltaTime;

    if (useVector) {
      this.position.x += moveVec.x * moveAmount;
      this.position.y += moveVec.y * moveAmount;
      // Recover yaw from the world vector. yaw 0 = +Y (north),
      // 90 = -X (west), 180 = -Y (south), 270 = +X (east).
      // facing.x = -sin(yaw), facing.y = cos(yaw) → yaw = atan2(-vx, vy).
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

    if (
      !this.level.canMoveTo(
        this.position.x,
        this.position.y,
        collisionRadius,
        oldPosition.x,
        oldPosition.y
      )
    ) {
      // Full movement blocked - try sliding along walls
      const newX = this.position.x;
      const newY = this.position.y;

      // Try moving only on X axis
      this.position.y = oldPosition.y;
      const canMoveX = this.level.canMoveTo(
        this.position.x,
        this.position.y,
        collisionRadius,
        oldPosition.x,
        oldPosition.y
      );

      // Try moving only on Y axis
      this.position.x = oldPosition.x;
      this.position.y = newY;
      const canMoveY = this.level.canMoveTo(
        this.position.x,
        this.position.y,
        collisionRadius,
        oldPosition.x,
        oldPosition.y
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

    // Handle teleports
    this.checkTeleport();
    this.position.z =
      this.level.getSurfaceZAtWorld(this.position.x, this.position.y) + this.scale / 2;
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

    // Two trigger styles, normalized into `teleportGroups`:
    //   - mode 'pair': edge-walking trigger (original C++ behavior, good for
    //     tunnels through the wall border)
    //   - mode 'next': step-on-tile trigger that cycles through N endpoints
    //     (good for islands where teleports sit on interior tiles)
    const groups = this.level.teleportGroups;
    if (!groups || groups.length === 0) return;

    for (const group of groups) {
      if (group.mode === 'pair' && group.endpoints.length === 2) {
        if (this._tryPairTeleport(group.endpoints, gridX, gridY)) return;
      } else if (group.mode === 'next' && group.endpoints.length >= 2) {
        if (this._tryNextTeleport(group.endpoints, gridX, gridY)) return;
      }
    }
  }

  // Original behavior: walk past one tile's outer edge to teleport to the other.
  _tryPairTeleport(endpoints, gridX, gridY) {
    const [teleport0, teleport1] = endpoints;
    const halfScale = this.level.scale / 2;

    if (gridY === teleport0.y) {
      const teleportWorldX = this.level.gridToWorld(teleport0.x);
      if (this.position.x < teleportWorldX - halfScale + this.radius) {
        this.position.x = this.level.gridToWorld(teleport1.x);
        this.position.y = this.level.gridToWorld(teleport1.y);
        return true;
      }
    }
    if (gridY === teleport1.y) {
      const teleportWorldX = this.level.gridToWorld(teleport1.x);
      if (this.position.x > teleportWorldX + halfScale - this.radius) {
        this.position.x = this.level.gridToWorld(teleport0.x);
        this.position.y = this.level.gridToWorld(teleport0.y);
        return true;
      }
    }
    if (gridX === teleport0.x) {
      const teleportWorldY = this.level.gridToWorld(teleport0.y);
      if (this.position.y > teleportWorldY + halfScale - this.radius) {
        this.position.x = this.level.gridToWorld(teleport1.x);
        this.position.y = this.level.gridToWorld(teleport1.y);
        return true;
      }
    }
    if (gridX === teleport1.x) {
      const teleportWorldY = this.level.gridToWorld(teleport1.y);
      if (this.position.y < teleportWorldY - halfScale + this.radius) {
        this.position.x = this.level.gridToWorld(teleport0.x);
        this.position.y = this.level.gridToWorld(teleport0.y);
        return true;
      }
    }
    return false;
  }

  // Multi-island: stepping centered onto endpoint N sends to endpoint N+1
  // (cycling). Cooldown via `lastTeleportTileKey` avoids re-trigger loops
  // when the player camps on a destination tile.
  _tryNextTeleport(endpoints, gridX, gridY) {
    for (let i = 0; i < endpoints.length; i++) {
      const ep = endpoints[i];
      if (ep.x !== gridX || ep.y !== gridY) continue;

      // Need to be close to the center of the tile to count as "on it"
      const cx = this.level.gridToWorld(ep.x);
      const cy = this.level.gridToWorld(ep.y);
      const dx = this.position.x - cx;
      const dy = this.position.y - cy;
      if (dx * dx + dy * dy > (this.level.scale * 0.35) ** 2) continue;

      const key = `${ep.x},${ep.y}`;
      if (this.lastTeleportTileKey === key) return false;

      const next = endpoints[(i + 1) % endpoints.length];
      this.position.x = this.level.gridToWorld(next.x);
      this.position.y = this.level.gridToWorld(next.y);
      this.lastTeleportTileKey = `${next.x},${next.y}`;
      return true;
    }

    // No endpoint matches → clear the cooldown so the next step-on works
    this.lastTeleportTileKey = null;
    return false;
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
    this.position.set(
      this.startX * this.scale,
      this.startY * this.scale,
      this.level.getEntityZ(this.startX, this.startY)
    );
    this.yaw = 180;
    this.pitch = 0;
    this.facing.set(0, -1, 0);
    this.strafe.set(-1, 0, 0);
    this.mouthAngle = 0;
    this.mouthAnimating = false;
    this.lastTeleportTileKey = null;
    this.animateMouth(0);
    this.group.position.copy(this.position);
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
