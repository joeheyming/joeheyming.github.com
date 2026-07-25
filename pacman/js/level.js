/**
 * Level Parser and 3D Maze Generator
 * Loads levels from text files (matching original Level5.txt format)
 * and generates Three.js geometry
 */

import * as THREE from 'three';
import { TILE, ANIMATION } from './constants.js';
import { normalizeLevelData } from './level-data.js';

export class Level {
  constructor(levelPath = 'levels/level1.json', levelData = null) {
    this.levelPath = levelPath;
    this.levelData = levelData;

    // Level data (will be loaded from file)
    this.width = 0;
    this.height = 0;
    this.scale = 10;
    this.map = [];
    this.heights = [];
    this.ramps = [];
    this.pacmanStart = { x: 0, y: 0, level: 0 };
    this.ghostHome = [];
    this.powerPillLocations = [];
    this.teleports = [];

    // 3D objects
    this.mazeMesh = null;
    this.floorMesh = null;
    this.elevatedFloorMesh = null;
    this.rampMesh = null;
    this.teleportTiles = [];
    this.teleportGroup = new THREE.Group();
    this.ghostHomeTiles = [];
    this.ghostHomeGroup = new THREE.Group();
    this.pacmanStartTiles = [];
    this.pacmanStartGroup = new THREE.Group();
    this.dots = [];
    this.powerPills = [];
    this.dotGroup = new THREE.Group();

    // Fruit spawn (optional; set to first tile of type FRUIT_SPAWN, else null).
    // Game code falls back to a sensible default (below ghost house) when null.
    this.fruitSpawn = null;

    // Teleport groups: normalized form of `teleports`. Each entry is
    //   { mode: 'pair' | 'next', endpoints: [{x,y,level}, ...] }
    // 'pair' uses the legacy edge-walking trigger (good for tunnels through
    // the wall border). 'next' uses step-on-tile trigger (good for islands).
    this.teleportGroups = [];

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
      if (this.levelData) {
        this.parseLevel(this.levelData);
        return;
      }
      const response = await fetch(this.levelPath);
      if (!response.ok) throw new Error(`Failed to load level: ${response.status}`);
      const data = await response.json();
      this.parseLevel(data);
    } catch (error) {
      console.error('Error loading level file:', error);
      if (this.levelData) throw error;
      // Fall back to a minimal default level
      this.loadDefaultLevel();
    }
  }

  parseLevel(data) {
    const parsed = normalizeLevelData(data);
    this.scale = parsed.scale;
    this.numGhosts = parsed.numGhosts;
    this.width = parsed.width;
    this.height = parsed.height;
    this.map = parsed.map;
    this.heights = parsed.heights;
    this.ramps = parsed.ramps;
    this.pacmanStart = parsed.pacmanStart;
    this.ghostHome = parsed.ghostHome;
    this.powerPillLocations = parsed.powerPillLocations;
    this.teleports = parsed.teleports;
    this.teleportGroups = parsed.teleportGroups;
    this.fruitSpawn = parsed.fruitSpawn;
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
    this.teleportGroups = [];
    this.ramps = [];
    this.map = [
      [2, 2, 2, 2, 2],
      [2, 1, 1, 1, 2],
      [2, 1, 1, 1, 2],
      [2, 1, 1, 1, 2],
      [2, 2, 2, 2, 2]
    ];
    this.heights = Array.from({ length: this.height }, () => Array(this.width).fill(0));
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
    const geometries = [];

    // Iterate through map and create wall blocks
    for (let y = 0; y < this.height; y++) {
      for (let x = 0; x < this.width; x++) {
        if (this.map[y][x] === TILE.WALL) {
          const adjacentHeight = Math.max(
            this.getTileHeight(x - 1, y),
            this.getTileHeight(x + 1, y),
            this.getTileHeight(x, y - 1),
            this.getTileHeight(x, y + 1)
          );
          const wallHeight = this.scale * (adjacentHeight + 1);
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

    const elevatedFloorGeometries = [];
    for (let y = 0; y < this.height; y++) {
      for (let x = 0; x < this.width; x++) {
        if (!this.isWalkable(x, y) || this.getTileHeight(x, y) === 0) continue;
        const geometry = new THREE.BoxGeometry(this.scale * 0.96, this.scale * 0.96, this.scale);
        geometry.translate(this.gridToWorld(x), this.gridToWorld(y), this.scale / 2);
        elevatedFloorGeometries.push(geometry);
      }
    }
    if (elevatedFloorGeometries.length > 0) {
      this.elevatedFloorMesh = new THREE.Mesh(
        this.mergeGeometries(elevatedFloorGeometries),
        this.floorMaterial
      );
      this.elevatedFloorMesh.castShadow = true;
      this.elevatedFloorMesh.receiveShadow = true;
    }

    const rampGeometries = this.ramps.map((ramp) => this.createRampGeometry(ramp));
    if (rampGeometries.length > 0) {
      this.rampMesh = new THREE.Mesh(this.mergeGeometries(rampGeometries), this.floorMaterial);
      this.rampMesh.castShadow = true;
      this.rampMesh.receiveShadow = true;
    }

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
          teleportTile.position.set(
            this.gridToWorld(x),
            this.gridToWorld(y),
            this.getFloorZ(x, y) + teleportHeight / 2
          );
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
          ghostHomeTile.position.set(
            this.gridToWorld(x),
            this.gridToWorld(y),
            this.getFloorZ(x, y) + ghostHomeHeight / 2
          );
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
            this.getFloorZ(x, y) + pacmanStartHeight / 2
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

  createRampGeometry(ramp) {
    const destination = this.getRampDestination(ramp);
    const dx = destination.x - ramp.x;
    const dy = destination.y - ramp.y;
    const slopeLength = Math.hypot(this.scale, this.scale);
    const geometry = new THREE.BoxGeometry(this.scale * 0.72, slopeLength, this.scale * 0.08);
    geometry.rotateX(Math.atan2(this.scale, this.scale));
    geometry.rotateZ(Math.atan2(-dx, dy));
    geometry.translate(
      (this.gridToWorld(ramp.x) + this.gridToWorld(destination.x)) / 2,
      (this.gridToWorld(ramp.y) + this.gridToWorld(destination.y)) / 2,
      this.scale / 2
    );
    return geometry;
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
            this.map[y][x] === TILE.POWER_PILL ||
            this.map[y][x] === TILE.FRUIT_SPAWN) &&
          !this.isSpecialLocation(x, y)
        ) {
          const dot = new THREE.Mesh(dotGeometry, this.dotMaterial);
          dot.position.set(this.gridToWorld(x), this.gridToWorld(y), this.getEntityZ(x, y));
          dot.userData = { x, y, level: this.getTileHeight(x, y), collected: false };
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
      pill.position.set(
        this.gridToWorld(loc.x),
        this.gridToWorld(loc.y),
        this.getEntityZ(loc.x, loc.y)
      );
      pill.userData = {
        x: loc.x,
        y: loc.y,
        level: this.getTileHeight(loc.x, loc.y),
        collected: false
      };
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

    // Fruit spawn tile is reserved for the bonus fruit; no dot there.
    if (this.map[y]?.[x] === TILE.FRUIT_SPAWN) {
      return true;
    }

    // Step-on-tile teleport endpoints (group mode 'next') should stay clear so
    // ghost respawn paths and the trigger reads land on a real walkable cell.
    if (Array.isArray(this.teleportGroups)) {
      for (const group of this.teleportGroups) {
        if (group.mode === 'next') {
          for (const ep of group.endpoints) {
            if (ep.x === x && ep.y === y) return true;
          }
        }
      }
    }

    // Ghost-home neighborhood (no dots there). Previously this was a single
    // bounding box around all ghost-home tiles, which worked for the classic
    // case of one clustered ghost house but stripped dots from the whole map
    // on island levels with ghost homes spread far apart. Instead, exclude
    // only the Chebyshev-radius-1 neighborhood of each ghost-home tile.
    for (const g of this.ghostHome) {
      if (Math.abs(x - g.x) <= 1 && Math.abs(y - g.y) <= 1) return true;
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
    if (this.elevatedFloorMesh) scene.add(this.elevatedFloorMesh);
    if (this.rampMesh) scene.add(this.rampMesh);
    if (this.teleportGroup) scene.add(this.teleportGroup);
    if (this.ghostHomeGroup) scene.add(this.ghostHomeGroup);
    if (this.pacmanStartGroup) scene.add(this.pacmanStartGroup);
    if (this.gridHelper) scene.add(this.gridHelper);
    scene.add(this.dotGroup);
  }

  // Remove all of this level's THREE objects from the scene. Used when
  // advancing to the next level so geometry from the old maze doesn't stack
  // on top of the new one.
  removeFromScene(scene) {
    if (this.mazeMesh) scene.remove(this.mazeMesh);
    if (this.floorMesh) scene.remove(this.floorMesh);
    if (this.elevatedFloorMesh) scene.remove(this.elevatedFloorMesh);
    if (this.rampMesh) scene.remove(this.rampMesh);
    if (this.teleportGroup) scene.remove(this.teleportGroup);
    if (this.ghostHomeGroup) scene.remove(this.ghostHomeGroup);
    if (this.pacmanStartGroup) scene.remove(this.pacmanStartGroup);
    if (this.gridHelper) scene.remove(this.gridHelper);
    if (this.dotGroup) scene.remove(this.dotGroup);
  }

  // Convert grid coordinates to world coordinates
  gridToWorld(gridCoord) {
    return gridCoord * this.scale;
  }

  // Convert world coordinates to grid coordinates
  worldToGrid(worldCoord) {
    return Math.round(worldCoord / this.scale);
  }

  getTileHeight(gridX, gridY) {
    return this.heights[gridY]?.[gridX] ?? 0;
  }

  getFloorZ(gridX, gridY) {
    return this.getTileHeight(gridX, gridY) * this.scale;
  }

  getEntityZ(gridX, gridY) {
    return this.getFloorZ(gridX, gridY) + this.scale / 2;
  }

  getRampDestination(ramp) {
    const deltas = {
      n: { x: 0, y: 1 },
      e: { x: 1, y: 0 },
      s: { x: 0, y: -1 },
      w: { x: -1, y: 0 }
    };
    const delta = deltas[ramp.dir];
    return { x: ramp.x + delta.x, y: ramp.y + delta.y };
  }

  hasRampBetween(firstX, firstY, secondX, secondY) {
    return this.ramps.some((ramp) => {
      const destination = this.getRampDestination(ramp);
      return (
        (ramp.x === firstX &&
          ramp.y === firstY &&
          destination.x === secondX &&
          destination.y === secondY) ||
        (ramp.x === secondX &&
          ramp.y === secondY &&
          destination.x === firstX &&
          destination.y === firstY)
      );
    });
  }

  canTraverse(firstX, firstY, secondX, secondY) {
    if (!this.isWalkable(firstX, firstY) || !this.isWalkable(secondX, secondY)) return false;
    if (Math.abs(firstX - secondX) + Math.abs(firstY - secondY) !== 1) return false;
    return (
      this.getTileHeight(firstX, firstY) === this.getTileHeight(secondX, secondY) ||
      this.hasRampBetween(firstX, firstY, secondX, secondY)
    );
  }

  isOnRampPath(firstX, firstY, secondX, secondY, worldX, worldY) {
    const ramp = this.ramps.find((candidate) => {
      const destination = this.getRampDestination(candidate);
      return (
        (candidate.x === firstX &&
          candidate.y === firstY &&
          destination.x === secondX &&
          destination.y === secondY) ||
        (candidate.x === secondX &&
          candidate.y === secondY &&
          destination.x === firstX &&
          destination.y === firstY)
      );
    });
    if (!ramp) return false;
    if (ramp.dir === 'n' || ramp.dir === 's') {
      return Math.abs(worldX - this.gridToWorld(ramp.x)) <= this.scale * 0.42;
    }
    return Math.abs(worldY - this.gridToWorld(ramp.y)) <= this.scale * 0.42;
  }

  getSurfaceZAtWorld(worldX, worldY) {
    for (const ramp of this.ramps) {
      const destination = this.getRampDestination(ramp);
      const startX = this.gridToWorld(ramp.x);
      const startY = this.gridToWorld(ramp.y);
      const endX = this.gridToWorld(destination.x);
      const endY = this.gridToWorld(destination.y);
      const segmentX = endX - startX;
      const segmentY = endY - startY;
      const lengthSquared = segmentX * segmentX + segmentY * segmentY;
      const progress =
        ((worldX - startX) * segmentX + (worldY - startY) * segmentY) / lengthSquared;
      if (progress < 0 || progress > 1) continue;
      const closestX = startX + segmentX * progress;
      const closestY = startY + segmentY * progress;
      if (Math.hypot(worldX - closestX, worldY - closestY) <= this.scale * 0.42) {
        return progress * this.scale;
      }
    }
    return this.getFloorZ(this.worldToGrid(worldX), this.worldToGrid(worldY));
  }

  // Get world position for a grid cell
  getWorldPosition(gridX, gridY) {
    return new THREE.Vector3(
      this.gridToWorld(gridX),
      this.gridToWorld(gridY),
      this.getEntityZ(gridX, gridY)
    );
  }

  // Check if a grid position is walkable
  isWalkable(gridX, gridY) {
    if (gridX < 0 || gridX >= this.width || gridY < 0 || gridY >= this.height) {
      return false;
    }
    const tile = this.map[gridY][gridX];
    // Floor, ghost home, teleport, power pill, pacman start, and fruit spawn
    // are walkable. (Fruit spawn is just a marker — same effect as floor.)
    return (
      tile === TILE.FLOOR ||
      tile === TILE.GHOST_HOME ||
      tile === TILE.TELEPORT ||
      tile === TILE.POWER_PILL ||
      tile === TILE.PACMAN_START ||
      tile === TILE.FRUIT_SPAWN
    );
  }

  // Check if position can be moved to (for collision detection)
  canMoveTo(worldX, worldY, radius, fromWorldX = worldX, fromWorldY = worldY) {
    const gridX = this.worldToGrid(worldX);
    const gridY = this.worldToGrid(worldY);
    const fromGridX = this.worldToGrid(fromWorldX);
    const fromGridY = this.worldToGrid(fromWorldY);

    if (
      (gridX !== fromGridX || gridY !== fromGridY) &&
      !this.canTraverse(fromGridX, fromGridY, gridX, gridY)
    ) {
      return false;
    }
    if (
      this.getTileHeight(gridX, gridY) !== this.getTileHeight(fromGridX, fromGridY) &&
      !this.isOnRampPath(fromGridX, fromGridY, gridX, gridY, worldX, worldY)
    ) {
      return false;
    }

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
      if (this.canTraverse(gridX, gridY, nx, ny)) {
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
