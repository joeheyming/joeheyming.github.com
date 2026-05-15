/**
 * Pacman movement mixin.
 *
 * Owns the per-frame translation pipeline (key-mode dispatch, wall-slide
 * collision, tile-reaction, teleport wrap-around) plus the yaw/pitch
 * accessors. Mixed into `Pacman.prototype` at import time so every method
 * here keeps using the same `this` as the rest of the class.
 */

import { DIRECTION, KEY_MODE, GAMEPLAY } from './constants.js';

export const movementMethods = {
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
      switch (this.keyMode) {
        case KEY_MODE.STRAFE:
          this.handleStrafeMovement(direction, moveAmount);
          break;
        case KEY_MODE.ROTATE:
          this.handleRotateMovement(direction, moveAmount, deltaTime);
          break;
        case KEY_MODE.PERP:
        default:
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
      const newX = this.position.x;
      const newY = this.position.y;

      this.position.y = oldPosition.y;
      const canMoveX = this.level.canMoveTo(
        this.position.x,
        this.position.y,
        collisionRadius,
        opts
      );

      this.position.x = oldPosition.x;
      this.position.y = newY;
      const canMoveY = this.level.canMoveTo(
        this.position.x,
        this.position.y,
        collisionRadius,
        opts
      );

      if (canMoveX && !canMoveY) {
        this.position.x = newX;
        this.position.y = oldPosition.y;
      } else if (canMoveY && !canMoveX) {
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

    this.checkTeleport();
  },

  // KEY_STRAFE: FPS-style movement (forward/back + strafe)
  handleStrafeMovement(direction, moveAmount) {
    switch (direction) {
      case DIRECTION.UP:
        this.position.x += this.facing.x * moveAmount;
        this.position.y += this.facing.y * moveAmount;
        break;
      case DIRECTION.DOWN:
        this.position.x -= this.facing.x * moveAmount;
        this.position.y -= this.facing.y * moveAmount;
        break;
      case DIRECTION.LEFT:
        this.position.x -= this.strafe.x * moveAmount;
        this.position.y -= this.strafe.y * moveAmount;
        break;
      case DIRECTION.RIGHT:
        this.position.x += this.strafe.x * moveAmount;
        this.position.y += this.strafe.y * moveAmount;
        break;
    }
  },

  // KEY_ROTATE: L/R rotate, U/D move forward/back
  handleRotateMovement(direction, moveAmount, deltaTime) {
    switch (direction) {
      case DIRECTION.UP:
        this.position.x += this.facing.x * moveAmount;
        this.position.y += this.facing.y * moveAmount;
        break;
      case DIRECTION.DOWN:
        this.position.x -= this.facing.x * moveAmount;
        this.position.y -= this.facing.y * moveAmount;
        break;
      case DIRECTION.LEFT:
        this.addYaw(this.rotateSpeed * deltaTime);
        break;
      case DIRECTION.RIGHT:
        this.addYaw(-this.rotateSpeed * deltaTime);
        break;
    }
  },

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
    this.updateVectorsFromYaw();
  },

  updateVectorsFromYaw() {
    const yawRad = (this.yaw * Math.PI) / 180;
    this.facing.x = -Math.sin(yawRad);
    this.facing.y = Math.cos(yawRad);
    this.strafe.x = Math.cos(yawRad);
    this.strafe.y = Math.sin(yawRad);
  },

  addYaw(delta) {
    this.yaw += delta;
    while (this.yaw < 0) this.yaw += 360;
    while (this.yaw >= 360) this.yaw -= 360;
    this.updateVectorsFromYaw();
  },

  setYaw(newYaw) {
    this.yaw = newYaw;
    while (this.yaw < 0) this.yaw += 360;
    while (this.yaw >= 360) this.yaw -= 360;
    this.updateVectorsFromYaw();
  },

  addPitch(delta) {
    this.pitch += delta;
    // Clamp pitch to prevent flipping (-89 to 89 degrees)
    this.pitch = Math.max(-89, Math.min(89, this.pitch));
  },

  getPitch() {
    return this.pitch;
  },

  // Clamp pitch to a maximum absolute value (used when switching to FPPOV)
  clampPitch(maxAbsValue) {
    this.pitch = Math.max(-maxAbsValue, Math.min(maxAbsValue, this.pitch));
  },

  setKeyMode(mode) {
    this.keyMode = mode;
  },

  getKeyMode() {
    return this.keyMode;
  },

  checkTeleport() {
    const gridX = this.level.worldToGrid(this.position.x);
    const gridY = this.level.worldToGrid(this.position.y);

    // Teleports work like the original C++ implementation:
    // - Each teleport pair links two tiles
    // - Walking past the edge of one teleport sends you to the other
    // We check if Pacman has walked past the teleport tile's edge.
    if (!this.level.teleports || this.level.teleports.length === 0) return;

    for (const pair of this.level.teleports) {
      if (!Array.isArray(pair) || pair.length !== 2) continue;

      const teleport0 = pair[0];
      const teleport1 = pair[1];

      // Walked west past left teleport (teleport0)
      if (gridY === teleport0.y) {
        const teleportWorldX = this.level.gridToWorld(teleport0.x);
        const halfScale = this.level.scale / 2;
        if (this.position.x < teleportWorldX - halfScale + this.radius) {
          this.position.x = this.level.gridToWorld(teleport1.x);
          this.position.y = this.level.gridToWorld(teleport1.y);
          return;
        }
      }

      // Walked east past right teleport (teleport1)
      if (gridY === teleport1.y) {
        const teleportWorldX = this.level.gridToWorld(teleport1.x);
        const halfScale = this.level.scale / 2;
        if (this.position.x > teleportWorldX + halfScale - this.radius) {
          this.position.x = this.level.gridToWorld(teleport0.x);
          this.position.y = this.level.gridToWorld(teleport0.y);
          return;
        }
      }

      // Walked north past top teleport (teleport0) - vertical teleport
      if (gridX === teleport0.x) {
        const teleportWorldY = this.level.gridToWorld(teleport0.y);
        const halfScale = this.level.scale / 2;
        if (this.position.y > teleportWorldY + halfScale - this.radius) {
          this.position.x = this.level.gridToWorld(teleport1.x);
          this.position.y = this.level.gridToWorld(teleport1.y);
          return;
        }
      }

      // Walked south past bottom teleport (teleport1) - vertical teleport
      if (gridX === teleport1.x) {
        const teleportWorldY = this.level.gridToWorld(teleport1.y);
        const halfScale = this.level.scale / 2;
        if (this.position.y < teleportWorldY - halfScale + this.radius) {
          this.position.x = this.level.gridToWorld(teleport0.x);
          this.position.y = this.level.gridToWorld(teleport0.y);
          return;
        }
      }
    }
  }
};
