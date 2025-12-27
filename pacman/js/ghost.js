/**
 * Ghost Character
 * 3D model with hemisphere head, cylinder body, and wavy tentacles
 * Each ghost has unique AI behavior based on original Pac-Man:
 * - Blinky (Red): Direct chase
 * - Pinky (Pink): Ambush - targets 4 tiles ahead of Pacman
 * - Inky (Cyan): Unpredictable - uses Blinky's position
 * - Clyde (Orange): Shy - chases when far, flees when close
 * Based on original Ghost.cpp
 */

import * as THREE from 'three';
import { GHOST_STATE, GHOST_TYPE, GAMEPLAY, ANIMATION } from './constants.js';

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
    this.position = new THREE.Vector3(startX * scale, startY * scale, scale / 2);

    // Home position for respawning
    this.homePosition = this.position.clone();

    // Scatter corner targets (each ghost goes to different corner)
    this.scatterTarget = this.getScatterCorner();

    // Movement
    this.moveSpeed = GAMEPLAY.GHOST_SPEED;
    this.homeSpeed = GAMEPLAY.GHOST_HOME_SPEED;
    this.facing = new THREE.Vector3(0, 1, 0);
    this.yaw = 0;
    this.lastDirection = null; // Track last movement direction

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

    // Mode timing - ghosts alternate between scatter and chase
    this.modeTimer = 0;
    this.scatterDuration = GAMEPLAY.GHOST_SCATTER_DURATION;
    this.chaseDuration = GAMEPLAY.GHOST_CHASE_DURATION;
    this.inChaseMode = false;

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

  // Each ghost has a different scatter corner
  getScatterCorner() {
    const width = this.level.width || 23;
    const height = this.level.height || 22;

    switch (this.ghostType) {
      case 'blinky':
        return { x: width - 2, y: height - 2 }; // Top-right
      case 'pinky':
        return { x: 2, y: height - 2 }; // Top-left
      case 'inky':
        return { x: width - 2, y: 1 }; // Bottom-right
      case 'clyde':
        return { x: 2, y: 1 }; // Bottom-left
      default:
        return { x: width - 2, y: height - 2 };
    }
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
    this.scared = scared;
    this.state = scared ? GHOST_STATE.SCARED : GHOST_STATE.SCATTER;

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

  isScared() {
    return this.scared && !this.dead;
  }

  die() {
    this.dead = true;
    this.state = GHOST_STATE.DEAD;
    this.scared = false;
    this.path = []; // Clear existing path
    this.lastDirection = null; // Allow backtracking when returning home
    this.lastHomePos = null; // Reset home pathfinding tracking

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
    this.lastHomePos = null;
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

  update(deltaTime, pacmanPos, pacmanChasing) {
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

    // Update mode timer (scatter <-> chase)
    if (!this.scared && !this.dead) {
      this.modeTimer += deltaTime;
      const currentDuration = this.inChaseMode ? this.chaseDuration : this.scatterDuration;
      if (this.modeTimer >= currentDuration) {
        this.modeTimer = 0;
        this.inChaseMode = !this.inChaseMode;
        this.state = this.inChaseMode ? GHOST_STATE.CHASE : GHOST_STATE.SCATTER;
        this.path = []; // Clear path to recalculate
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
        // Finished exiting home, resume normal behavior
        this.exitingHome = false;
        this.state = GHOST_STATE.SCATTER;
        this.lastDirection = null; // Reset so ghost can move any direction
      } else {
        this.moveAlongPath(deltaTime, this.moveSpeed);
      }
    } else {
      // Generate new path if needed
      if (this.path.length === 0) {
        if (this.scared) {
          this.generateFleeingPath(pacmanPos);
        } else if (this.state === GHOST_STATE.SCATTER) {
          this.generateScatterPath();
        } else {
          this.generateChasingPath(pacmanPos);
        }
      }

      this.moveAlongPath(deltaTime, this.moveSpeed);
    }

    // Update visual position
    this.group.position.copy(this.position);
    this.group.rotation.z = (this.yaw * Math.PI) / 180;

    // Update pupil direction to look at pacman
    this.updatePupilDirection(pacmanPos);
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

  // Pathfinding to home for dead ghosts - greedy with loop prevention
  generatePathHome() {
    const startX = this.level.worldToGrid(this.position.x);
    const startY = this.level.worldToGrid(this.position.y);
    const goalX = Math.round(this.homePosition.x / this.scale);
    const goalY = Math.round(this.homePosition.y / this.scale);

    // Already at home
    if (startX === goalX && startY === goalY) {
      this.path = [];
      this.lastHomePos = null;
      return;
    }

    // Get neighbors
    let neighbors = this.level.getNeighbors(startX, startY);

    // Filter out the last position to prevent oscillation (but only if we have other options)
    if (this.lastHomePos && neighbors.length > 1) {
      neighbors = neighbors.filter(
        (n) => !(n.x === this.lastHomePos.x && n.y === this.lastHomePos.y)
      );
    }

    // If filtering removed all neighbors, get them back
    if (neighbors.length === 0) {
      neighbors = this.level.getNeighbors(startX, startY);
    }

    if (neighbors.length > 0) {
      // Pick the neighbor closest to home (greedy)
      let bestNeighbor = neighbors[0];
      let bestDistance = Infinity;

      for (const neighbor of neighbors) {
        const dx = neighbor.x - goalX;
        const dy = neighbor.y - goalY;
        const distance = Math.sqrt(dx * dx + dy * dy);
        if (distance < bestDistance) {
          bestDistance = distance;
          bestNeighbor = neighbor;
        }
      }

      // Remember current position to avoid coming back
      this.lastHomePos = { x: startX, y: startY };
      this.path = [bestNeighbor];
    } else {
      this.path = [];
    }
  }

  // Get target based on ghost personality
  getTargetForPersonality(pacmanPos) {
    const pacmanGridX = this.level.worldToGrid(pacmanPos.x);
    const pacmanGridY = this.level.worldToGrid(pacmanPos.y);

    switch (this.ghostType) {
      case 'blinky':
        // Blinky: Direct chase - target Pacman's current position
        return { x: pacmanGridX, y: pacmanGridY };

      case 'pinky':
        // Pinky: Ambush - target 4 tiles ahead of Pacman
        // Use a simple approximation based on Pacman's likely direction
        const aheadDist = 4;
        // Add some randomness to make it less predictable
        const offsetX = (Math.random() - 0.5) * 2;
        const offsetY = (Math.random() - 0.5) * 2;
        return {
          x: Math.max(
            1,
            Math.min(
              this.level.width - 2,
              pacmanGridX + offsetX + aheadDist * (Math.random() > 0.5 ? 1 : -1)
            )
          ),
          y: Math.max(
            1,
            Math.min(
              this.level.height - 2,
              pacmanGridY + offsetY + aheadDist * (Math.random() > 0.5 ? 1 : -1)
            )
          )
        };

      case 'inky':
        // Inky: Unpredictable - uses vector from Blinky through a point ahead of Pacman
        if (this.blinkyRef) {
          const blinkyPos = this.blinkyRef.getPosition();
          const blinkyGridX = this.level.worldToGrid(blinkyPos.x);
          const blinkyGridY = this.level.worldToGrid(blinkyPos.y);
          // Vector from Blinky to a point ahead of Pacman, doubled
          const targetX = pacmanGridX + (pacmanGridX - blinkyGridX);
          const targetY = pacmanGridY + (pacmanGridY - blinkyGridY);
          return {
            x: Math.max(1, Math.min(this.level.width - 2, targetX)),
            y: Math.max(1, Math.min(this.level.height - 2, targetY))
          };
        }
        // Fallback to direct chase if no Blinky reference
        return { x: pacmanGridX, y: pacmanGridY };

      case 'clyde':
        // Clyde: Shy - chase when far, scatter when close (within 8 tiles)
        const startX = this.level.worldToGrid(this.position.x);
        const startY = this.level.worldToGrid(this.position.y);
        const distToPacman = Math.sqrt(
          Math.pow(startX - pacmanGridX, 2) + Math.pow(startY - pacmanGridY, 2)
        );

        if (distToPacman > 8) {
          // Far away - chase Pacman
          return { x: pacmanGridX, y: pacmanGridY };
        } else {
          // Close - retreat to scatter corner
          return this.scatterTarget;
        }

      default:
        return { x: pacmanGridX, y: pacmanGridY };
    }
  }

  // Generate path chasing pacman based on ghost personality
  generateChasingPath(pacmanPos) {
    const startX = this.level.worldToGrid(this.position.x);
    const startY = this.level.worldToGrid(this.position.y);

    // Get target based on ghost personality
    const target = this.getTargetForPersonality(pacmanPos);

    // Get available neighbors (excluding where we just came from to avoid backtracking)
    let neighbors = this.level.getNeighbors(startX, startY);

    // Filter out the tile we came from (prevents immediate backtracking)
    if (this.lastDirection && neighbors.length > 1) {
      neighbors = neighbors.filter((n) => {
        const dx = n.x - startX;
        const dy = n.y - startY;
        // Don't go back the way we came
        return !(dx === -this.lastDirection.x && dy === -this.lastDirection.y);
      });
    }

    if (neighbors.length === 0) {
      neighbors = this.level.getNeighbors(startX, startY);
    }

    if (neighbors.length > 0) {
      // Add some randomness at intersections (3+ choices) like original
      if (neighbors.length >= 3 && Math.random() < 0.3) {
        // 30% chance to pick random direction at intersections
        const randomIndex = Math.floor(Math.random() * neighbors.length);
        const chosen = neighbors[randomIndex];
        this.lastDirection = { x: chosen.x - startX, y: chosen.y - startY };
        this.path = [chosen];
        return;
      }

      // Otherwise pick the neighbor closest to target
      let bestNeighbor = neighbors[0];
      let bestDistance = Infinity;

      for (const neighbor of neighbors) {
        const dx = neighbor.x - target.x;
        const dy = neighbor.y - target.y;
        const distance = Math.sqrt(dx * dx + dy * dy);
        if (distance < bestDistance) {
          bestDistance = distance;
          bestNeighbor = neighbor;
        }
      }

      this.lastDirection = { x: bestNeighbor.x - startX, y: bestNeighbor.y - startY };
      this.path = [bestNeighbor];
    }
  }

  // Generate path to scatter corner
  generateScatterPath() {
    const startX = this.level.worldToGrid(this.position.x);
    const startY = this.level.worldToGrid(this.position.y);

    // Get available neighbors (excluding where we just came from)
    let neighbors = this.level.getNeighbors(startX, startY);

    if (this.lastDirection && neighbors.length > 1) {
      neighbors = neighbors.filter((n) => {
        const dx = n.x - startX;
        const dy = n.y - startY;
        return !(dx === -this.lastDirection.x && dy === -this.lastDirection.y);
      });
    }

    if (neighbors.length === 0) {
      neighbors = this.level.getNeighbors(startX, startY);
    }

    if (neighbors.length > 0) {
      // Pick neighbor closest to scatter target
      let bestNeighbor = neighbors[0];
      let bestDistance = Infinity;

      for (const neighbor of neighbors) {
        const dx = neighbor.x - this.scatterTarget.x;
        const dy = neighbor.y - this.scatterTarget.y;
        const distance = Math.sqrt(dx * dx + dy * dy);
        if (distance < bestDistance) {
          bestDistance = distance;
          bestNeighbor = neighbor;
        }
      }

      this.lastDirection = { x: bestNeighbor.x - startX, y: bestNeighbor.y - startY };
      this.path = [bestNeighbor];
    }
  }

  // Generate path fleeing from pacman (scared mode)
  generateFleeingPath(pacmanPos) {
    const startX = this.level.worldToGrid(this.position.x);
    const startY = this.level.worldToGrid(this.position.y);
    const pacmanGridX = this.level.worldToGrid(pacmanPos.x);
    const pacmanGridY = this.level.worldToGrid(pacmanPos.y);

    // Get neighbors, preferring not to backtrack
    let neighbors = this.level.getNeighbors(startX, startY);

    if (this.lastDirection && neighbors.length > 1) {
      neighbors = neighbors.filter((n) => {
        const dx = n.x - startX;
        const dy = n.y - startY;
        return !(dx === -this.lastDirection.x && dy === -this.lastDirection.y);
      });
    }

    if (neighbors.length === 0) {
      neighbors = this.level.getNeighbors(startX, startY);
    }

    if (neighbors.length > 0) {
      // In scared mode, pick random direction (original behavior)
      // This makes scared ghosts unpredictable
      const randomIndex = Math.floor(Math.random() * neighbors.length);
      const chosen = neighbors[randomIndex];
      this.lastDirection = { x: chosen.x - startX, y: chosen.y - startY };
      this.path = [chosen];
    }
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

    this.group.position.copy(this.position);
    this.yaw = 0;
    this.group.rotation.z = 0;
  }
}
