/**
 * Ghost Character
 * 3D model with hemisphere head, cylinder body, and wavy tentacles.
 * Targeting and turn choice live in ghost-ai.js and follow the arcade:
 * Blinky chases Pac-Man's tile, Pinky aims four ahead, Inky flanks
 * through Blinky, Clyde breaks for his corner inside eight tiles.
 * A shared scatter/chase clock reverses every ghost when the wave changes.
 */

import * as THREE from 'three';
import { GHOST_STATE, GHOST_TYPE, GAMEPLAY, ANIMATION } from './constants.js';
import {
  cardinalFromFacing,
  chooseNextTile,
  findGridPath,
  patrolTarget,
  scatterCorner
} from './ghost-ai.js';

export class Ghost {
  constructor(startX, startY, scale, level, color = 0xff0000) {
    this.startX = startX;
    this.startY = startY;
    this.scale = scale;
    this.level = level;
    this.color = color;

    // Determine ghost type/personality based on color
    this.ghostType = this.getGhostType(color);

    // Size
    this.radius = scale / 2.5;

    // Position
    this.position = new THREE.Vector3(
      startX * scale,
      startY * scale,
      level.getEntityZ(startX, startY)
    );

    // Home position for respawning
    this.homePosition = this.position.clone();

    // Scatter corner sits just outside the maze so the ghost circles it.
    this.scatterTarget = this.getScatterCorner();

    // Movement
    this.moveSpeed = GAMEPLAY.GHOST_SPEED;
    this.homeSpeed = GAMEPLAY.GHOST_HOME_SPEED;
    this.facing = new THREE.Vector3(0, 1, 0);
    this.yaw = 0;
    this.lastDirection = null; // Track last movement direction
    this.forceReverse = false;

    // Pathfinding
    this.path = [];
    this.currentTarget = null;
    this.lastGridPos = { x: startX, y: startY };

    // State
    this.state = GHOST_STATE.SCATTER;
    this.scared = false;
    this.dead = false;
    this.exitingHome = false; // True when ghost is leaving ghost home after respawn
    this.scaredTimer = 0;
    this.scaredBlinkTimer = 0;

    // Shared with the other ghosts via Game's GhostModeClock.
    // 'scatter' until the first chase wave.
    this.patrolMode = 'scatter';
    this.elroyStage = 0;
    // True while a power pill is active. A ghost walking out of the
    // house stays its normal color until it clears the door.
    this.frightActive = false;

    // Multi-island teleport cooldown — see Pacman.lastTeleportTileKey
    this.lastTeleportTileKey = null;

    // Reference to other ghosts (for Inky's behavior)
    this.blinkyRef = null;

    // Reusable vectors to avoid allocations in hot paths
    this._tempDirection = new THREE.Vector3();
    this._tempPupilDir = new THREE.Vector3();

    // 3D components
    this.group = new THREE.Group();
    this.headMesh = null;
    this.bodyMesh = null;
    this.leftEye = null;
    this.rightEye = null;
    this.leftPupil = null;
    this.rightPupil = null;

    // Materials
    this.bodyMaterial = new THREE.MeshStandardMaterial({
      color: this.color,
      roughness: 0.3,
      metalness: 0.1,
      transparent: true,
      opacity: 1
    });

    this.scaredMaterial = new THREE.MeshStandardMaterial({
      color: 0x0000ff,
      roughness: 0.3,
      metalness: 0.1,
      emissive: 0x0000aa,
      emissiveIntensity: 0.3,
      transparent: true,
      opacity: 1
    });

    this.eyeWhiteMaterial = new THREE.MeshStandardMaterial({
      color: 0xffffff,
      roughness: 0.5
    });

    this.pupilMaterial = new THREE.MeshStandardMaterial({
      color: 0x000000,
      roughness: 0.8
    });

    this.createModel();
  }

  createModel() {
    // Body (cylinder) - from original drawBody()
    const bodyHeight = this.radius * 1.5;
    const bodyGeometry = new THREE.CylinderGeometry(
      this.radius, // top radius
      this.radius, // bottom radius
      bodyHeight,
      20,
      1,
      true // open ended - we'll add custom wavy bottom
    );
    this.bodyMesh = new THREE.Mesh(bodyGeometry, this.bodyMaterial);
    this.bodyMesh.rotation.x = Math.PI / 2;
    this.bodyMesh.position.z = 0; // Center the body
    this.bodyMesh.castShadow = true;

    // Head (hemisphere) - sits on top of cylinder
    // Use SphereGeometry with limited phi to create hemisphere
    const headGeometry = new THREE.SphereGeometry(
      this.radius,
      30,
      15,
      0, // phiStart
      Math.PI * 2, // phiLength (full circle)
      0, // thetaStart (top)
      Math.PI / 2 // thetaLength (half sphere - top hemisphere only)
    );
    this.headMesh = new THREE.Mesh(headGeometry, this.bodyMaterial);
    // Rotate so flat side faces down (sits on cylinder)
    this.headMesh.rotation.x = Math.PI / 2;
    // Position hemisphere on top of cylinder
    this.headMesh.position.z = bodyHeight / 2;
    this.headMesh.castShadow = true;

    // Wavy bottom with triangular tentacles (classic ghost look)
    this.bottomMesh = this.createWavyBottom(bodyHeight);

    // Eyes - from original drawEyes()
    this.createEyes();

    // Add all parts to group
    this.group.add(this.headMesh);
    this.group.add(this.bodyMesh);
    this.group.add(this.bottomMesh);
    this.group.add(this.leftEye);
    this.group.add(this.rightEye);
    this.group.add(this.leftPupil);
    this.group.add(this.rightPupil);

    // Position the group
    this.group.position.copy(this.position);
  }

  createWavyBottom(bodyHeight) {
    // Create wavy bottom with triangular tentacles
    const numTentacles = 6;
    const tentacleHeight = this.radius * 0.6;
    const bottomZ = -bodyHeight / 2;

    // Create custom geometry using vertices and faces
    const vertices = [];
    const indices = [];

    // Center point
    vertices.push(0, 0, bottomZ);

    // Create zigzag pattern around the edge
    for (let i = 0; i < numTentacles * 2; i++) {
      const angle = (i / (numTentacles * 2)) * Math.PI * 2;
      const x = Math.cos(angle) * this.radius;
      const y = Math.sin(angle) * this.radius;

      // Alternate between high (cylinder edge) and low (tentacle tip)
      const z = i % 2 === 0 ? bottomZ : bottomZ - tentacleHeight;

      vertices.push(x, y, z);
    }

    // Create triangular faces connecting center to edge
    for (let i = 0; i < numTentacles * 2; i++) {
      const next = (i % (numTentacles * 2)) + 1;
      const nextNext = ((i + 1) % (numTentacles * 2)) + 1;

      // Triangle from center to two adjacent edge points
      indices.push(0, i + 1, nextNext);
    }

    // Also create side faces for the tentacles (so they're not flat)
    for (let i = 0; i < numTentacles * 2; i += 2) {
      const tipIdx = i + 2; // Tentacle tip (lower point)
      const leftIdx = i + 1; // Left edge of tentacle
      const rightIdx = ((i + 2) % (numTentacles * 2)) + 1; // Right edge

      if (tipIdx <= numTentacles * 2) {
        // This creates depth on the tentacles
      }
    }

    // Create BufferGeometry
    const geometry = new THREE.BufferGeometry();
    const vertexArray = new Float32Array(vertices);
    geometry.setAttribute('position', new THREE.BufferAttribute(vertexArray, 3));
    geometry.setIndex(indices);
    geometry.computeVertexNormals();

    const mesh = new THREE.Mesh(geometry, this.bodyMaterial);
    mesh.castShadow = true;

    return mesh;
  }

  // Determine ghost personality based on color
  getGhostType(color) {
    switch (color) {
      case GHOST_TYPE.BLINKY:
        return 'blinky';
      case GHOST_TYPE.PINKY:
        return 'pinky';
      case GHOST_TYPE.INKY:
        return 'inky';
      case GHOST_TYPE.CLYDE:
        return 'clyde';
      default:
        return 'blinky';
    }
  }

  // Each ghost has a different scatter corner, just outside the maze.
  getScatterCorner() {
    const width = this.level.width || 23;
    const height = this.level.height || 22;
    return scatterCorner(this.ghostType, width, height);
  }

  // Set reference to Blinky (needed for Inky's behavior)
  setBlinkyRef(blinky) {
    this.blinkyRef = blinky;
  }

  createEyes() {
    const bodyHeight = this.radius * 1.5;
    const eyeZ = bodyHeight / 2 + this.radius * 0.3; // Position on the hemisphere

    const eyeRadius = 1;
    const pupilRadius = 0.5;
    const eyeGeometry = new THREE.SphereGeometry(eyeRadius, 8, 8);
    const pupilGeometry = new THREE.SphereGeometry(pupilRadius, 6, 6);

    // Left eye - on the front of the hemisphere
    this.leftEye = new THREE.Mesh(eyeGeometry, this.eyeWhiteMaterial);
    this.leftEye.position.set(-this.radius * 0.35, this.radius * 0.7, eyeZ);

    // Right eye
    this.rightEye = new THREE.Mesh(eyeGeometry, this.eyeWhiteMaterial);
    this.rightEye.position.set(this.radius * 0.35, this.radius * 0.7, eyeZ);

    // Pupils
    this.leftPupil = new THREE.Mesh(pupilGeometry, this.pupilMaterial);
    this.leftPupil.position.set(-this.radius * 0.35, this.radius * 0.9, eyeZ);

    this.rightPupil = new THREE.Mesh(pupilGeometry, this.pupilMaterial);
    this.rightPupil.position.set(this.radius * 0.35, this.radius * 0.9, eyeZ);

    // Store eyeZ for pupil updates
    this.eyeZ = eyeZ;
  }

  addToScene(scene) {
    scene.add(this.group);
  }

  setScared(scared) {
    if (this.dead) return;
    // Still in the house: stay normal until the exit step turns them.
    if (scared && this.exitingHome) return;

    this.scared = scared;
    this.scaredMaterial.color.setHex(0x0000ff);
    if (scared) {
      this.state = GHOST_STATE.SCARED;
      // Entering frightened reverses every ghost in the halls.
      this.reverseDirection();
    } else {
      this.state = this.patrolMode === 'chase' ? GHOST_STATE.CHASE : GHOST_STATE.SCATTER;
    }

    // Change material
    const material = scared ? this.scaredMaterial : this.bodyMaterial;
    this.headMesh.material = material;
    this.bodyMesh.material = material;
    this.bottomMesh.material = material;

    // Update eyes visibility
    this.leftEye.visible = !scared;
    this.rightEye.visible = !scared;
    this.leftPupil.visible = !scared;
    this.rightPupil.visible = !scared;
  }

  /**
   * Called every frame with the shared scatter/chase wave. A change
   * reverses ghosts that are out in the maze. Frightened and eaten
   * ghosts keep the new mode for when they resume, without turning.
   */
  setPatrolMode(mode) {
    if (mode === this.patrolMode) return;
    this.patrolMode = mode;
    if (this.scared || this.dead || this.exitingHome) return;
    this.state = mode === 'chase' ? GHOST_STATE.CHASE : GHOST_STATE.SCATTER;
    this.reverseDirection();
  }

  /**
   * Turn around immediately. Used when scatter and chase swap, and
   * when a power pill starts. Eyes returning home and ghosts still
   * walking out of the house do not reverse.
   */
  reverseDirection() {
    if (this.dead || this.exitingHome) return;
    if (!this.lastDirection) {
      this.path = [];
      return;
    }

    const gx = this.level.worldToGrid(this.position.x);
    const gy = this.level.worldToGrid(this.position.y);
    const backX = gx - this.lastDirection.x;
    const backY = gy - this.lastDirection.y;
    if (this.level.canTraverse(gx, gy, backX, backY)) {
      this.lastDirection = { x: -this.lastDirection.x, y: -this.lastDirection.y };
      this.path = [{ x: backX, y: backY }];
      this.forceReverse = false;
      return;
    }

    this.forceReverse = true;
    this.path = [];
  }

  currentSpeed() {
    if (this.scared) return GAMEPLAY.GHOST_FRIGHTENED_SPEED;
    if (this.ghostType === 'blinky' && this.elroyStage === 2) return GAMEPLAY.GHOST_ELROY2_SPEED;
    if (this.ghostType === 'blinky' && this.elroyStage === 1) return GAMEPLAY.GHOST_ELROY1_SPEED;
    return this.moveSpeed;
  }

  isScared() {
    return this.scared && !this.dead;
  }

  die() {
    this.dead = true;
    this.state = GHOST_STATE.DEAD;
    this.scared = false;
    this.path = []; // Clear existing path
    this.lastDirection = null; // Allow backtracking when returning home

    // Hide body, show only eyes
    this.headMesh.visible = false;
    this.bodyMesh.visible = false;
    this.bottomMesh.visible = false;
    this.leftEye.visible = true;
    this.rightEye.visible = true;
    this.leftPupil.visible = true;
    this.rightPupil.visible = true;

    // Make eyes larger and brighter when dead (floating eyes effect)
    this.leftEye.scale.setScalar(1.5);
    this.rightEye.scale.setScalar(1.5);
    this.leftPupil.scale.setScalar(1.5);
    this.rightPupil.scale.setScalar(1.5);

    // Generate path home
    this.generatePathHome();
  }

  isDead() {
    return this.dead;
  }

  respawn() {
    this.dead = false;
    this.scared = false;
    this.state = GHOST_STATE.HOME; // Start in home state to exit
    this.path = [];
    this.exitingHome = true; // Flag to handle exiting ghost home

    // Show body again
    this.headMesh.visible = true;
    this.bodyMesh.visible = true;
    this.bottomMesh.visible = true;

    // Reset material
    this.headMesh.material = this.bodyMaterial;
    this.bodyMesh.material = this.bodyMaterial;
    this.bottomMesh.material = this.bodyMaterial;

    // Reset eye scale (was enlarged when dead)
    this.leftEye.scale.setScalar(1);
    this.rightEye.scale.setScalar(1);
    this.leftPupil.scale.setScalar(1);
    this.rightPupil.scale.setScalar(1);

    // Generate path to exit ghost home
    this.generateExitHomePath();
  }

  // Generate path to exit the ghost home area
  generateExitHomePath() {
    const startX = this.level.worldToGrid(this.position.x);
    const startY = this.level.worldToGrid(this.position.y);

    // Find the exit from ghost home by looking in all directions for a floor tile
    let exitX = startX;
    let exitY = startY;
    let centerX = startX;

    // First, find the center tile that has a floor exit nearby
    for (let x = startX - 2; x <= startX + 2; x++) {
      if (x >= 0 && x < this.level.width) {
        const tile = this.level.map[startY]?.[x];
        if (tile === 3) {
          // Check all 4 directions for a floor tile exit
          for (const dir of [
            { dx: 0, dy: 1 },
            { dx: 0, dy: -1 },
            { dx: 1, dy: 0 },
            { dx: -1, dy: 0 }
          ]) {
            const testY = startY + dir.dy;
            const testX = x + dir.dx;
            if (testX >= 0 && testX < this.level.width && testY >= 0 && testY < this.level.height) {
              const adjacentTile = this.level.map[testY]?.[testX];
              if (adjacentTile === 1) {
                // Found exit!
                centerX = x;
                exitX = testX;
                exitY = testY;
                break;
              }
            }
          }
        }
        if (exitY !== startY || exitX !== startX) break;
      }
    }

    // Build path: first go to center column, then to exit
    this.path = [];

    // Path to center first if not already there
    if (startX !== centerX) {
      this.path.push({ x: centerX, y: startY });
    }

    // Then path to exit
    if (exitX !== centerX || exitY !== startY) {
      this.path.push({ x: exitX, y: exitY });
    }
  }

  update(deltaTime, pacmanPos, pacmanFacing) {
    // Update scared blinking
    if (this.scared && !this.dead) {
      this.scaredBlinkTimer += deltaTime;
      if (this.scaredBlinkTimer > ANIMATION.SCARED_BLINK_INTERVAL) {
        this.scaredBlinkTimer = 0;
        // Toggle between blue and white when scared is about to end
        const isBlue = this.scaredMaterial.color.getHex() === 0x0000ff;
        this.scaredMaterial.color.setHex(isBlue ? 0xffffff : 0x0000ff);
      }
    }

    // Handle movement based on state
    if (this.dead) {
      // Check if close enough to home to respawn (within 1.5 tiles)
      const homeGridX = Math.round(this.homePosition.x / this.scale);
      const homeGridY = Math.round(this.homePosition.y / this.scale);
      const currentGridX = this.level.worldToGrid(this.position.x);
      const currentGridY = this.level.worldToGrid(this.position.y);

      const distToHome = Math.sqrt(
        Math.pow(currentGridX - homeGridX, 2) + Math.pow(currentGridY - homeGridY, 2)
      );

      // Respawn if within 1.5 tiles of home
      if (distToHome <= 1.5) {
        // Snap to home position and respawn
        this.position.x = this.homePosition.x;
        this.position.y = this.homePosition.y;
        this.respawn();
        return;
      }

      // Keep generating path to home if needed
      if (this.path.length === 0) {
        this.generatePathHome();
      }

      this.moveAlongPath(deltaTime, this.homeSpeed);
    } else if (this.exitingHome) {
      // Ghost is exiting the home area after respawning
      if (this.path.length === 0) {
        // Finished exiting home. A pill that is still active turns the
        // ghost blue as it comes through the door, without a reverse.
        this.exitingHome = false;
        this.lastDirection = null;
        if (this.frightActive) {
          this.setScared(true);
        } else {
          this.state = this.patrolMode === 'chase' ? GHOST_STATE.CHASE : GHOST_STATE.SCATTER;
        }
      } else {
        this.moveAlongPath(deltaTime, this.moveSpeed);
      }
    } else {
      // Decide the next tile once the previous step is finished.
      if (this.path.length === 0) {
        this.generateDecisionPath(pacmanPos, pacmanFacing);
      }

      this.moveAlongPath(deltaTime, this.currentSpeed());
    }

    // Living ghosts warp by walking off a tunnel edge. Eyes follow the
    // home path instead, which already includes tunnel hops.
    if (!this.dead) {
      this.checkTeleport();
    }
    this.position.z =
      this.level.getSurfaceZAtWorld(this.position.x, this.position.y) + this.scale / 2;

    // Update visual position
    this.group.position.copy(this.position);
    this.group.rotation.z = (this.yaw * Math.PI) / 180;

    // Update pupil direction to look at pacman
    this.updatePupilDirection(pacmanPos);
  }

  /**
   * Teleport check for ghosts.
   *
   * Pair mode (legacy tunnels): trigger when the ghost crosses the outer
   * edge of either endpoint tile, mirroring Pacman's logic.
   *
   * Next mode (multi-island): trigger when the ghost is centered on any
   * endpoint tile and cycle to the next endpoint. A small cooldown prevents
   * re-trigger loops when the ghost camps on the destination tile.
   */
  checkTeleport() {
    const groups = this.level.teleportGroups;
    if (!groups || groups.length === 0) return;

    const gridX = this.level.worldToGrid(this.position.x);
    const gridY = this.level.worldToGrid(this.position.y);
    const halfScale = this.level.scale / 2;

    for (const group of groups) {
      if (group.mode === 'pair' && group.endpoints.length === 2) {
        const [a, b] = group.endpoints;
        if (
          gridY === a.y &&
          this.position.x < this.level.gridToWorld(a.x) - halfScale + this.radius
        ) {
          this.position.x = this.level.gridToWorld(b.x);
          this.position.y = this.level.gridToWorld(b.y);
          this.path = [];
          return;
        }
        if (
          gridY === b.y &&
          this.position.x > this.level.gridToWorld(b.x) + halfScale - this.radius
        ) {
          this.position.x = this.level.gridToWorld(a.x);
          this.position.y = this.level.gridToWorld(a.y);
          this.path = [];
          return;
        }
        if (
          gridX === a.x &&
          this.position.y > this.level.gridToWorld(a.y) + halfScale - this.radius
        ) {
          this.position.x = this.level.gridToWorld(b.x);
          this.position.y = this.level.gridToWorld(b.y);
          this.path = [];
          return;
        }
        if (
          gridX === b.x &&
          this.position.y < this.level.gridToWorld(b.y) - halfScale + this.radius
        ) {
          this.position.x = this.level.gridToWorld(a.x);
          this.position.y = this.level.gridToWorld(a.y);
          this.path = [];
          return;
        }
      } else if (group.mode === 'next' && group.endpoints.length >= 2) {
        for (let i = 0; i < group.endpoints.length; i++) {
          const ep = group.endpoints[i];
          if (ep.x !== gridX || ep.y !== gridY) continue;

          const cx = this.level.gridToWorld(ep.x);
          const cy = this.level.gridToWorld(ep.y);
          const dx = this.position.x - cx;
          const dy = this.position.y - cy;
          if (dx * dx + dy * dy > (this.level.scale * 0.35) ** 2) continue;

          const key = `${ep.x},${ep.y}`;
          if (this.lastTeleportTileKey === key) break;

          const next = group.endpoints[(i + 1) % group.endpoints.length];
          this.position.x = this.level.gridToWorld(next.x);
          this.position.y = this.level.gridToWorld(next.y);
          this.lastTeleportTileKey = `${next.x},${next.y}`;
          this.path = [];
          return;
        }
      }
    }
    this.lastTeleportTileKey = null;
  }

  updatePupilDirection(pacmanPos) {
    if (!this.leftPupil.visible) return;

    // Calculate direction to pacman (reuse temp vector)
    const direction = this._tempPupilDir.subVectors(pacmanPos, this.position).normalize();

    // Offset pupils in that direction
    const pupilOffset = 0.3;
    this.leftPupil.position.set(
      -this.radius * 0.35 + direction.x * pupilOffset,
      this.radius * 0.7 + direction.y * pupilOffset,
      this.eyeZ + 0.2
    );
    this.rightPupil.position.set(
      this.radius * 0.35 + direction.x * pupilOffset,
      this.radius * 0.7 + direction.y * pupilOffset,
      this.eyeZ + 0.2
    );
  }

  moveAlongPath(deltaTime, speed) {
    if (this.path.length === 0) return;

    const target = this.path[this.path.length - 1];
    const targetWorld = this.level.getWorldPosition(target.x, target.y);

    // A home path can hop a tunnel. Walking that hop in a straight line
    // would cut through walls, so land on the far tile directly.
    const hereX = this.level.worldToGrid(this.position.x);
    const hereY = this.level.worldToGrid(this.position.y);
    if (Math.abs(target.x - hereX) + Math.abs(target.y - hereY) > 1) {
      this.position.x = targetWorld.x;
      this.position.y = targetWorld.y;
      this.path.pop();
      this.lastDirection = null;
      return;
    }

    // Calculate direction to target (reuse temp vector)
    const direction = this._tempDirection.subVectors(targetWorld, this.position);
    const distance = direction.length();

    if (distance < 1) {
      // Reached target, remove from path
      this.path.pop();
      return;
    }

    // Normalize and apply speed
    direction.normalize();
    const moveAmount = speed * deltaTime;

    // Update position
    this.position.x += direction.x * Math.min(moveAmount, distance);
    this.position.y += direction.y * Math.min(moveAmount, distance);

    // Update facing direction and yaw
    this.facing.copy(direction);
    if (Math.abs(direction.x) > Math.abs(direction.y)) {
      this.yaw = direction.x > 0 ? 270 : 90;
    } else {
      this.yaw = direction.y > 0 ? 0 : 180;
    }
  }

  // Full route home. One greedy step gets stuck in a dead-end that
  // points at the house: the eyes walk in, bounce out, and walk back in.
  generatePathHome() {
    const startX = this.level.worldToGrid(this.position.x);
    const startY = this.level.worldToGrid(this.position.y);
    const goalX = Math.round(this.homePosition.x / this.scale);
    const goalY = Math.round(this.homePosition.y / this.scale);
    const steps = findGridPath({ x: startX, y: startY }, { x: goalX, y: goalY }, (x, y) =>
      this.homeNeighbors(x, y)
    );
    // moveAlongPath consumes from the end of the array.
    this.path = steps ? steps.slice().reverse() : [];
  }

  // Walkable neighbors, plus the other end of a tunnel so eyes can
  // cross back to the house on a multi-island board.
  homeNeighbors(x, y) {
    const neighbors = this.level.getNeighbors(x, y);
    const groups = this.level.teleportGroups || [];
    for (const group of groups) {
      const endpoints = group.endpoints || [];
      for (let i = 0; i < endpoints.length; i++) {
        if (endpoints[i].x !== x || endpoints[i].y !== y) continue;
        const dest =
          group.mode === 'pair' && endpoints.length === 2
            ? endpoints[i === 0 ? 1 : 0]
            : endpoints[(i + 1) % endpoints.length];
        if (!neighbors.some((neighbor) => neighbor.x === dest.x && neighbor.y === dest.y)) {
          neighbors.push({ x: dest.x, y: dest.y });
        }
      }
    }
    return neighbors;
  }

  // One greedy step toward this ghost's arcade target.
  generateDecisionPath(pacmanPos, pacmanFacing) {
    const startX = this.level.worldToGrid(this.position.x);
    const startY = this.level.worldToGrid(this.position.y);
    const neighbors = this.level.getNeighbors(startX, startY);
    const pacmanTile = {
      x: this.level.worldToGrid(pacmanPos.x),
      y: this.level.worldToGrid(pacmanPos.y)
    };
    const facing = pacmanFacing || { x: 0, y: -1 };
    const chaseArgs = {
      ghostType: this.ghostType,
      ghostTile: { x: startX, y: startY },
      pacmanTile,
      pacmanDirection: cardinalFromFacing(facing.x, facing.y),
      blinkyTile: this.blinkyTile(),
      scatterTarget: this.scatterTarget
    };
    const target = this.scared
      ? pacmanTile
      : patrolTarget({
          mode: this.patrolMode,
          elroyStage: this.elroyStage,
          ...chaseArgs
        });

    const choice = chooseNextTile({
      tile: { x: startX, y: startY },
      neighbors,
      target,
      lastDirection: this.lastDirection,
      frightened: this.scared,
      forceReverse: this.forceReverse
    });
    this.commitStep(choice, startX, startY);
  }

  blinkyTile() {
    if (!this.blinkyRef) return null;
    const blinkyPos = this.blinkyRef.getPosition();
    return {
      x: this.level.worldToGrid(blinkyPos.x),
      y: this.level.worldToGrid(blinkyPos.y)
    };
  }

  commitStep(choice, fromX, fromY) {
    this.forceReverse = false;
    if (!choice) {
      this.path = [];
      return;
    }
    this.lastDirection = { x: choice.x - fromX, y: choice.y - fromY };
    this.path = [choice];
  }

  getPosition() {
    return this.position;
  }

  reset() {
    // Reset to starting position
    this.position.copy(this.homePosition);
    this.path = [];
    this.dead = false;
    this.scared = false;
    this.exitingHome = false;
    this.state = GHOST_STATE.SCATTER;
    this.patrolMode = 'scatter';
    this.elroyStage = 0;
    this.frightActive = false;
    this.forceReverse = false;
    this.lastDirection = null;
    this.lastTeleportTileKey = null;
    this.scaredMaterial.color.setHex(0x0000ff);

    // Reset visuals
    this.headMesh.visible = true;
    this.bodyMesh.visible = true;
    this.bottomMesh.visible = true;
    this.headMesh.material = this.bodyMaterial;
    this.bodyMesh.material = this.bodyMaterial;
    this.bottomMesh.material = this.bodyMaterial;
    this.leftEye.visible = true;
    this.rightEye.visible = true;
    this.leftPupil.visible = true;
    this.rightPupil.visible = true;
    this.leftEye.scale.setScalar(1);
    this.rightEye.scale.setScalar(1);
    this.leftPupil.scale.setScalar(1);
    this.rightPupil.scale.setScalar(1);

    this.group.position.copy(this.position);
    this.yaw = 0;
    this.group.rotation.z = 0;
  }
}
