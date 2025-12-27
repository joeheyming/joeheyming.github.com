/**
 * Level Parser and 3D Maze Generator
 * Loads levels from text files (matching original Level5.txt format)
 * and generates Three.js geometry
 */

import * as THREE from 'three';
import { TILE, ANIMATION } from './constants.js';

export class Level {
  constructor(levelPath = 'levels/level1.json') {
    this.levelPath = levelPath;

    // Level data (will be loaded from file)
    this.width = 0;
    this.height = 0;
    this.scale = 10;
    this.map = [];
    this.pacmanStart = { x: 0, y: 0, level: 0 };
    this.ghostHome = [];
    this.powerPillLocations = [];
    this.teleports = [];

    // 3D objects
    this.mazeMesh = null;
    this.floorMesh = null;
    this.teleportTiles = [];
    this.teleportGroup = new THREE.Group();
    this.ghostHomeTiles = [];
    this.ghostHomeGroup = new THREE.Group();
    this.pacmanStartTiles = [];
    this.pacmanStartGroup = new THREE.Group();
    this.dots = [];
    this.powerPills = [];
    this.dotGroup = new THREE.Group();

    // Materials
    this.wallMaterial = null;
    this.floorMaterial = null;
    this.teleportMaterial = null;
    this.ghostHomeMaterial = null;
    this.dotMaterial = null;
    this.powerPillMaterial = null;
    this.pacmanStartMaterial = null;
  }

  async load() {
    // Load and parse the level file
    await this.loadLevelFile();

    // Create 3D geometry
    this.createMaterials();
    this.createMaze();
    this.createFloor();
    this.createDots();
    this.createPowerPills();
  }

  /**
   * Load and parse a level file in JSON format
   */
  async loadLevelFile() {
    try {
      const response = await fetch(this.levelPath);
      if (!response.ok) {
        throw new Error(`Failed to load level: ${response.status}`);
      }
      const data = await response.json();
      this.parseLevel(data);
    } catch (error) {
      console.error('Error loading level file:', error);
      // Fall back to a minimal default level
      this.loadDefaultLevel();
    }
  }

  parseLevel(data) {
    // Parse JSON level format
    this.scale = data.scale;

    // Flip map so row 0 in JSON = top of screen (WYSIWYG)
    // Renderer treats Y=0 as bottom, so we reverse the array
    this.map = [...data.map].reverse();

    // Calculate width and height from map dimensions
    // Height is number of rows, width is number of columns (assuming all rows have same width)
    this.height = this.map.length;
    if (this.height === 0) {
      throw new Error('Map must have at least one row');
    }
    this.width = this.map[0].length;

    // Validate all rows have the same width
    for (let y = 0; y < this.height; y++) {
      if (this.map[y].length !== this.width) {
        throw new Error(`Map row ${y} has width ${this.map[y].length}, expected ${this.width}`);
      }
    }

    // Use provided width/height if they exist (for backward compatibility), but warn if they don't match
    if (data.width !== undefined && data.width !== this.width) {
      console.warn(
        `Provided width ${data.width} doesn't match map width ${this.width}, using map width`
      );
    }
    if (data.height !== undefined && data.height !== this.height) {
      console.warn(
        `Provided height ${data.height} doesn't match map height ${this.height}, using map height`
      );
    }

    // Helper to flip Y coordinates from JSON to internal
    const flipY = (y) => this.height - 1 - y;

    // Scan map for pacman start tile (type 6)
    this.pacmanStart = null;
    for (let y = 0; y < this.map.length; y++) {
      for (let x = 0; x < this.map[y].length; x++) {
        if (this.map[y][x] === TILE.PACMAN_START) {
          if (this.pacmanStart !== null) {
            throw new Error(`Multiple pacman start tiles found. Only one is allowed.`);
          }
          this.pacmanStart = { x, y, level: 0 };
        }
      }
    }

    // Backward compatibility: if no pacman start tile found in map, fall back to data.pacmanStart
    if (this.pacmanStart === null && data.pacmanStart) {
      this.pacmanStart = {
        x: data.pacmanStart.x,
        y: flipY(data.pacmanStart.y),
        level: data.pacmanStart.level || 0
      };
    }

    if (this.pacmanStart === null) {
      throw new Error(
        `No pacman start position found. Please add a pacman start tile (type 6) to the map.`
      );
    }

    console.log(`Found pacman start position:`, this.pacmanStart);

    // Scan map for ghost home tiles (type 3)
    this.ghostHome = [];
    for (let y = 0; y < this.map.length; y++) {
      for (let x = 0; x < this.map[y].length; x++) {
        if (this.map[y][x] === 3) {
          this.ghostHome.push({ x, y, level: 0 });
        }
      }
    }

    // If no ghost home tiles found in map, fall back to data.ghostHome
    if (this.ghostHome.length === 0 && data.ghostHome) {
      this.ghostHome = data.ghostHome.map((g) => ({
        x: g.x,
        y: flipY(g.y),
        level: g.level || 0
      }));
    }

    console.log(`Found ${this.ghostHome.length} ghost home positions:`, this.ghostHome);

    // Scan map for power pill tiles (type 5)
    this.powerPillLocations = [];
    for (let y = 0; y < this.map.length; y++) {
      for (let x = 0; x < this.map[y].length; x++) {
        if (this.map[y][x] === TILE.POWER_PILL) {
          this.powerPillLocations.push({ x, y, level: 0 });
        }
      }
    }

    // Backward compatibility: if no power pill tiles found in map, fall back to data.powerPills
    if (this.powerPillLocations.length === 0 && data.powerPills) {
      this.powerPillLocations = data.powerPills.map((p) => ({
        x: p.x,
        y: flipY(p.y),
        level: p.level || 0
      }));
    }

    console.log(
      `Found ${this.powerPillLocations.length} power pill positions:`,
      this.powerPillLocations
    );

    // Teleport pairs (flip Y for each position in each pair)
    // Teleports are represented as pairs: [[{x, y}, {x, y}], ...]
    this.teleports = [];
    if (Array.isArray(data.teleports)) {
      for (const pair of data.teleports) {
        if (Array.isArray(pair) && pair.length === 2) {
          // New format: pairs
          this.teleports.push([
            {
              x: pair[0].x,
              y: flipY(pair[0].y),
              level: pair[0].level || 0
            },
            {
              x: pair[1].x,
              y: flipY(pair[1].y),
              level: pair[1].level || 0
            }
          ]);
        } else if (pair.x !== undefined && pair.y !== undefined) {
          // Legacy format: flat array of coordinates
          // This will be handled below for backward compatibility
        }
      }
    }

    // Backward compatibility: if teleports is a flat array, convert to pairs
    if (this.teleports.length === 0 && data.teleports && data.teleports.length >= 2) {
      // Check if it's the old format (flat array)
      if (data.teleports[0].x !== undefined) {
        // Group into pairs (assume even number of teleports)
        for (let i = 0; i < data.teleports.length; i += 2) {
          if (i + 1 < data.teleports.length) {
            this.teleports.push([
              {
                x: data.teleports[i].x,
                y: flipY(data.teleports[i].y),
                level: data.teleports[i].level || 0
              },
              {
                x: data.teleports[i + 1].x,
                y: flipY(data.teleports[i + 1].y),
                level: data.teleports[i + 1].level || 0
              }
            ]);
          }
        }
      }
    }

    // Also scan map for teleport tiles and validate/auto-link if needed
    const teleportTiles = [];
    for (let y = 0; y < this.map.length; y++) {
      for (let x = 0; x < this.map[y].length; x++) {
        if (this.map[y][x] === TILE.TELEPORT) {
          teleportTiles.push({ x, y });
        }
      }
    }

    if (teleportTiles.length > 0) {
      console.log(`Found ${teleportTiles.length} teleport tiles in map:`, teleportTiles);
    }

    console.log(`Loaded level: ${this.width}x${this.height}, scale=${this.scale}`);
  }

  loadDefaultLevel() {
    // Minimal fallback level if file loading fails
    this.width = 5;
    this.height = 5;
    this.scale = 10;
    this.pacmanStart = { x: 2, y: 2, level: 0 };
    this.ghostHome = [{ x: 2, y: 1, level: 0 }];
    this.powerPillLocations = [];
    this.teleports = [];
    this.map = [
      [2, 2, 2, 2, 2],
      [2, 1, 1, 1, 2],
      [2, 1, 1, 1, 2],
      [2, 1, 1, 1, 2],
      [2, 2, 2, 2, 2]
    ];
  }

  createMaterials() {
    // Wall material - deep blue with some shine
    this.wallMaterial = new THREE.MeshStandardMaterial({
      color: 0x1a1aff,
      roughness: 0.3,
      metalness: 0.1,
      emissive: 0x0a0a3a,
      emissiveIntensity: 0.2
    });

    // Floor material - grey so Pacman's mouth is visible
    this.floorMaterial = new THREE.MeshStandardMaterial({
      color: 0x2a2a3a,
      roughness: 0.8,
      metalness: 0.0
    });

    // Dot material - glowing white/yellow
    this.dotMaterial = new THREE.MeshStandardMaterial({
      color: 0xffffaa,
      emissive: 0xffff88,
      emissiveIntensity: 0.5,
      roughness: 0.2,
      metalness: 0.3
    });

    // Power pill material - bright flashing
    this.powerPillMaterial = new THREE.MeshStandardMaterial({
      color: 0xffaaff,
      emissive: 0xff88ff,
      emissiveIntensity: 0.8,
      roughness: 0.1,
      metalness: 0.5
    });

    // Teleport material - shiny green
    this.teleportMaterial = new THREE.MeshStandardMaterial({
      color: 0x00ff88,
      emissive: 0x00ff44,
      emissiveIntensity: 0.6,
      roughness: 0.1,
      metalness: 0.8
    });

    // Ghost home material - Minecraft nether red
    this.ghostHomeMaterial = new THREE.MeshStandardMaterial({
      color: 0x8b0000, // Dark red (nether red)
      emissive: 0x5c0000, // Darker red glow
      emissiveIntensity: 0.4,
      roughness: 0.6,
      metalness: 0.2
    });

    // Pacman start material - same as floor
    this.pacmanStartMaterial = new THREE.MeshStandardMaterial({
      color: 0x2a2a3a, // Same grey as floor
      roughness: 0.8,
      metalness: 0.0
    });
  }

  createMaze() {
    const wallHeight = this.scale;
    const geometries = [];

    // Iterate through map and create wall blocks
    for (let y = 0; y < this.height; y++) {
      for (let x = 0; x < this.width; x++) {
        if (this.map[y][x] === TILE.WALL) {
          const geometry = new THREE.BoxGeometry(this.scale, this.scale, wallHeight);

          // Position the geometry
          const matrix = new THREE.Matrix4();
          matrix.setPosition(this.gridToWorld(x), this.gridToWorld(y), wallHeight / 2);
          geometry.applyMatrix4(matrix);

          geometries.push(geometry);
        }
      }
    }

    // Merge all wall geometries for better performance
    const mergedGeometry = this.mergeGeometries(geometries);
    this.mazeMesh = new THREE.Mesh(mergedGeometry, this.wallMaterial);
    this.mazeMesh.castShadow = true;
    this.mazeMesh.receiveShadow = true;
  }

  createFloor() {
    // Create floor plane
    const floorGeometry = new THREE.PlaneGeometry(
      this.width * this.scale,
      this.height * this.scale
    );

    this.floorMesh = new THREE.Mesh(floorGeometry, this.floorMaterial);
    this.floorMesh.position.set(
      (this.width * this.scale) / 2 - this.scale / 2,
      (this.height * this.scale) / 2 - this.scale / 2,
      0
    );
    this.floorMesh.receiveShadow = true;

    // Create teleport tiles as raised platforms
    const teleportHeight = this.scale * 0.1; // Slightly raised
    const teleportGeometry = new THREE.BoxGeometry(
      this.scale * 0.95,
      this.scale * 0.95,
      teleportHeight
    );

    for (let y = 0; y < this.height; y++) {
      for (let x = 0; x < this.width; x++) {
        if (this.map[y][x] === TILE.TELEPORT) {
          const teleportTile = new THREE.Mesh(teleportGeometry, this.teleportMaterial);
          teleportTile.position.set(this.gridToWorld(x), this.gridToWorld(y), teleportHeight / 2);
          teleportTile.castShadow = true;
          teleportTile.receiveShadow = true;
          this.teleportTiles.push(teleportTile);
          this.teleportGroup.add(teleportTile);
        }
      }
    }

    // Create ghost home tiles as raised platforms
    const ghostHomeHeight = this.scale * 0.1; // Slightly raised
    const ghostHomeGeometry = new THREE.BoxGeometry(
      this.scale * 0.95,
      this.scale * 0.95,
      ghostHomeHeight
    );

    for (let y = 0; y < this.height; y++) {
      for (let x = 0; x < this.width; x++) {
        if (this.map[y][x] === TILE.GHOST_HOME) {
          const ghostHomeTile = new THREE.Mesh(ghostHomeGeometry, this.ghostHomeMaterial);
          ghostHomeTile.position.set(this.gridToWorld(x), this.gridToWorld(y), ghostHomeHeight / 2);
          ghostHomeTile.castShadow = true;
          ghostHomeTile.receiveShadow = true;
          this.ghostHomeTiles.push(ghostHomeTile);
          this.ghostHomeGroup.add(ghostHomeTile);
        }
      }
    }

    // Create pacman start tiles as raised platforms
    const pacmanStartHeight = this.scale * 0.1; // Slightly raised
    const pacmanStartGeometry = new THREE.BoxGeometry(
      this.scale * 0.95,
      this.scale * 0.95,
      pacmanStartHeight
    );

    for (let y = 0; y < this.height; y++) {
      for (let x = 0; x < this.width; x++) {
        if (this.map[y][x] === TILE.PACMAN_START) {
          const pacmanStartTile = new THREE.Mesh(pacmanStartGeometry, this.pacmanStartMaterial);
          pacmanStartTile.position.set(
            this.gridToWorld(x),
            this.gridToWorld(y),
            pacmanStartHeight / 2
          );
          pacmanStartTile.castShadow = true;
          pacmanStartTile.receiveShadow = true;
          this.pacmanStartTiles.push(pacmanStartTile);
          this.pacmanStartGroup.add(pacmanStartTile);
        }
      }
    }

    // Add grid lines for visual effect
    const gridHelper = new THREE.GridHelper(
      Math.max(this.width, this.height) * this.scale,
      Math.max(this.width, this.height),
      0x222244,
      0x111122
    );
    gridHelper.rotation.x = Math.PI / 2;
    gridHelper.position.copy(this.floorMesh.position);
    gridHelper.position.z = 0.1;
    this.gridHelper = gridHelper;
  }

  createDots() {
    const dotRadius = this.scale * 0.08;
    const dotGeometry = new THREE.SphereGeometry(dotRadius, 8, 8);

    // Place dots on all floor tiles except special locations
    for (let y = 0; y < this.height; y++) {
      for (let x = 0; x < this.width; x++) {
        if (
          (this.map[y][x] === TILE.FLOOR ||
            this.map[y][x] === TILE.TELEPORT ||
            this.map[y][x] === TILE.POWER_PILL) &&
          !this.isSpecialLocation(x, y)
        ) {
          const dot = new THREE.Mesh(dotGeometry, this.dotMaterial);
          dot.position.set(this.gridToWorld(x), this.gridToWorld(y), this.scale / 2);
          dot.userData = { x, y, collected: false };
          this.dots.push(dot);
          this.dotGroup.add(dot);
        }
      }
    }
  }

  createPowerPills() {
    const pillRadius = this.scale * 0.25;
    const pillGeometry = new THREE.SphereGeometry(pillRadius, 16, 16);

    for (const loc of this.powerPillLocations) {
      // Power pills are now marked as tile type 5, so we don't need to check for conflicts
      const pill = new THREE.Mesh(pillGeometry, this.powerPillMaterial);
      pill.position.set(this.gridToWorld(loc.x), this.gridToWorld(loc.y), this.scale / 2);
      pill.userData = { x: loc.x, y: loc.y, collected: false };
      this.powerPills.push(pill);
      this.dotGroup.add(pill);
    }
  }

  isSpecialLocation(x, y) {
    // Check if this is pacman start, ghost home, power pill, or teleport location
    if (this.pacmanStart.x === x && this.pacmanStart.y === y) return true;

    for (const ghost of this.ghostHome) {
      if (ghost.x === x && ghost.y === y) return true;
    }

    for (const pill of this.powerPillLocations) {
      if (pill.x === x && pill.y === y) return true;
    }

    // Check if this is a teleport or power pill tile
    for (const pair of this.teleports) {
      if ((pair[0].x === x && pair[0].y === y) || (pair[1].x === x && pair[1].y === y)) {
        return true;
      }
    }

    // Power pill tiles don't have dots
    if (this.map[y]?.[x] === TILE.POWER_PILL) {
      return true;
    }

    // Ghost home area (no dots there) - calculate dynamically based on ghost home positions
    if (this.ghostHome.length > 0) {
      const minX = Math.min(...this.ghostHome.map((g) => g.x)) - 1;
      const maxX = Math.max(...this.ghostHome.map((g) => g.x)) + 1;
      const minY = Math.min(...this.ghostHome.map((g) => g.y)) - 1;
      const maxY = Math.max(...this.ghostHome.map((g) => g.y)) + 1;
      if (x >= minX && x <= maxX && y >= minY && y <= maxY) return true;
    }

    return false;
  }

  mergeGeometries(geometries) {
    if (geometries.length === 0) {
      return new THREE.BufferGeometry();
    }

    // Calculate total vertices and indices
    let totalVertices = 0;
    let totalIndices = 0;

    for (const geo of geometries) {
      totalVertices += geo.attributes.position.count;
      if (geo.index) {
        totalIndices += geo.index.count;
      } else {
        totalIndices += geo.attributes.position.count;
      }
    }

    // Create merged arrays
    const positions = new Float32Array(totalVertices * 3);
    const normals = new Float32Array(totalVertices * 3);
    const indices = new Uint32Array(totalIndices);

    let vertexOffset = 0;
    let indexOffset = 0;

    for (const geo of geometries) {
      const posAttr = geo.attributes.position;
      const normAttr = geo.attributes.normal;

      // Copy positions
      for (let i = 0; i < posAttr.count; i++) {
        positions[(vertexOffset + i) * 3] = posAttr.getX(i);
        positions[(vertexOffset + i) * 3 + 1] = posAttr.getY(i);
        positions[(vertexOffset + i) * 3 + 2] = posAttr.getZ(i);

        if (normAttr) {
          normals[(vertexOffset + i) * 3] = normAttr.getX(i);
          normals[(vertexOffset + i) * 3 + 1] = normAttr.getY(i);
          normals[(vertexOffset + i) * 3 + 2] = normAttr.getZ(i);
        }
      }

      // Copy indices
      if (geo.index) {
        for (let i = 0; i < geo.index.count; i++) {
          indices[indexOffset + i] = geo.index.getX(i) + vertexOffset;
        }
        indexOffset += geo.index.count;
      } else {
        for (let i = 0; i < posAttr.count; i++) {
          indices[indexOffset + i] = i + vertexOffset;
        }
        indexOffset += posAttr.count;
      }

      vertexOffset += posAttr.count;
    }

    const mergedGeo = new THREE.BufferGeometry();
    mergedGeo.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    mergedGeo.setAttribute('normal', new THREE.BufferAttribute(normals, 3));
    mergedGeo.setIndex(new THREE.BufferAttribute(indices, 1));

    return mergedGeo;
  }

  addToScene(scene) {
    if (this.mazeMesh) scene.add(this.mazeMesh);
    if (this.floorMesh) scene.add(this.floorMesh);
    if (this.teleportGroup) scene.add(this.teleportGroup);
    if (this.ghostHomeGroup) scene.add(this.ghostHomeGroup);
    if (this.pacmanStartGroup) scene.add(this.pacmanStartGroup);
    if (this.gridHelper) scene.add(this.gridHelper);
    scene.add(this.dotGroup);
  }

  // Convert grid coordinates to world coordinates
  gridToWorld(gridCoord) {
    return gridCoord * this.scale;
  }

  // Convert world coordinates to grid coordinates
  worldToGrid(worldCoord) {
    return Math.round(worldCoord / this.scale);
  }

  // Get world position for a grid cell
  getWorldPosition(gridX, gridY) {
    return new THREE.Vector3(this.gridToWorld(gridX), this.gridToWorld(gridY), this.scale / 2);
  }

  // Check if a grid position is walkable
  isWalkable(gridX, gridY) {
    if (gridX < 0 || gridX >= this.width || gridY < 0 || gridY >= this.height) {
      return false;
    }
    const tile = this.map[gridY][gridX];
    // Floor, ghost home, teleport, power pill, and pacman start tiles are walkable
    return (
      tile === TILE.FLOOR ||
      tile === TILE.GHOST_HOME ||
      tile === TILE.TELEPORT ||
      tile === TILE.POWER_PILL ||
      tile === TILE.PACMAN_START
    );
  }

  // Check if position can be moved to (for collision detection)
  canMoveTo(worldX, worldY, radius) {
    const gridX = this.worldToGrid(worldX);
    const gridY = this.worldToGrid(worldY);

    // Check current and adjacent cells
    const cellsToCheck = [
      { x: gridX, y: gridY },
      { x: gridX - 1, y: gridY },
      { x: gridX + 1, y: gridY },
      { x: gridX, y: gridY - 1 },
      { x: gridX, y: gridY + 1 }
    ];

    for (const cell of cellsToCheck) {
      if (!this.isWalkable(cell.x, cell.y)) {
        // Check if we're actually overlapping with this wall
        const wallCenterX = this.gridToWorld(cell.x);
        const wallCenterY = this.gridToWorld(cell.y);
        const halfScale = this.scale / 2;

        // Simple AABB collision
        if (
          worldX + radius > wallCenterX - halfScale &&
          worldX - radius < wallCenterX + halfScale &&
          worldY + radius > wallCenterY - halfScale &&
          worldY - radius < wallCenterY + halfScale
        ) {
          return false;
        }
      }
    }

    return true;
  }

  // Get neighboring walkable cells for pathfinding
  getNeighbors(gridX, gridY) {
    const neighbors = [];
    const directions = [
      { x: 0, y: 1 }, // North
      { x: 0, y: -1 }, // South
      { x: 1, y: 0 }, // East
      { x: -1, y: 0 } // West
    ];

    for (const dir of directions) {
      const nx = gridX + dir.x;
      const ny = gridY + dir.y;
      if (this.isWalkable(nx, ny)) {
        neighbors.push({ x: nx, y: ny });
      }
    }

    return neighbors;
  }

  // Reset all dots
  resetDots() {
    this.dots.forEach((dot) => {
      dot.visible = true;
      dot.userData.collected = false;
    });
    this.powerPills.forEach((pill) => {
      pill.visible = true;
      pill.userData.collected = false;
    });
  }

  // Check if all dots are collected
  allDotsCollected() {
    const dotsRemaining = this.dots.some((dot) => dot.visible);
    const pillsRemaining = this.powerPills.some((pill) => pill.visible);
    return !dotsRemaining && !pillsRemaining;
  }

  // Get center of the level in world coordinates
  getCenter() {
    return new THREE.Vector3((this.width * this.scale) / 2, (this.height * this.scale) / 2, 0);
  }

  // Animate power pills and teleport tiles (pulsing effect)
  update(time) {
    const pulseScale = 1 + Math.sin(time * ANIMATION.POWER_PILL_PULSE_SPEED) * 0.2;
    this.powerPills.forEach((pill) => {
      if (pill.visible) {
        pill.scale.setScalar(pulseScale);
      }
    });

    // Animate teleport tiles with a pulsing glow effect
    const teleportPulse = 0.6 + Math.sin(time * ANIMATION.TELEPORT_PULSE_SPEED) * 0.4;
    this.teleportTiles.forEach((tile) => {
      if (tile.material) {
        tile.material.emissiveIntensity = teleportPulse;
      }
    });
  }
}
