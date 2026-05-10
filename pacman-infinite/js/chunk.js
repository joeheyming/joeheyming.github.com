/**
 * One streamed chunk of the infinite world.
 *
 * Phase 2a (revised): Minecraft-style block geometry.
 *   - FLOOR tile at height h: solid block from z=0 to z=h*scale; walkable top
 *                              at z = h*scale. (h=0 floors render as a thin
 *                              ground plane to save geometry.)
 *   - WALL  tile at height h: solid block from z=0 to z=(h+1)*scale; walkable
 *                              top at z = (h+1)*scale. Walls behave like
 *                              "tall floors" — their tops are walkable too,
 *                              gated only by whether Pacman can step or jump
 *                              up to them.
 *   - VOID  tile:              no block at all — open air below, deadly.
 *
 * The FLOOR/WALL distinction is now mostly cosmetic: both are blocks. Walls
 * use the wall material (blue) and are 1 unit taller than their `heights`
 * value, while floors use the floor material (gray) and sit at exactly
 * `heights`. Movement code in world.js / pacman.js treats them uniformly via
 * `surfaceHeightAt()`.
 *
 * Materials and the dot SphereGeometry are shared via World assets.
 */

import * as THREE from 'three';
import { CHUNK_SIZE } from './templates.js';
import { hashCoords } from './prng.js';
  
const TILE_VOID = 0;
const TILE_FLOOR = 1;
const TILE_WALL = 2;

const CROSS_AXIS = CHUNK_SIZE / 2; // row 8 / col 8 — the inter-chunk corridor
// Base fraction of non-cross FLOOR tiles that get a dot. Cross corridors
// are always fully dotted; everything else (open arenas, plateaus,
// decorative floors) gets a sparse, hunt-worthy sprinkle. Difficulty
// scales this via the chunk's `dotKeepPercent` override (set by world).
const NON_CROSS_DOT_KEEP_PERCENT = 30;

// Power pill placement (Phase 3).
// Each chunk has exactly one power pill on its cross corridor. The arm
// (N/S/E/W) is picked deterministically from the chunk's hash so two
// adjacent chunks rarely place pills next to each other. Distance from
// the cross centre is fixed at PILL_OFFSET_TILES.
const PILL_OFFSET_TILES = 4;

export class Chunk {
  constructor(cx, cy, template, scale, assets, opts = {}) {
    this.cx = cx;
    this.cy = cy;
    this.scale = scale;
    this.assets = assets;
    this.templateId = template.id;
    // Difficulty-scaled percent of non-cross FLOOR tiles to dot. Defaults
    // to the base constant; world.js overrides with the active preset's
    // dotKeepMul × NON_CROSS_DOT_KEEP_PERCENT at construction time.
    this.dotKeepPercent = opts.dotKeepPercent ?? NON_CROSS_DOT_KEEP_PERCENT;

    // Copy the per-cell tile codes and heights so per-chunk mutations
    // (collected dots) don't bleed into other chunks that share the template.
    this.map = template.map.map((row) => row.slice());
    this.heights = template.heights.map((row) => row.slice());

    this.wallMesh = null;
    // Tall walls (stackUnits ≥ 3) render with the rocky mountain
    // material so big peaks/cliffs feel like terrain instead of
    // skyscrapers. Tracked separately from wallMesh because they use
    // different materials and can't be merged into a single mesh.
    this.mountainMesh = null;
    this.floorMesh = null;
    this.dotMesh = null; // InstancedMesh: 1 draw call for all small dots in this chunk
    this.pillMesh = null; // InstancedMesh: 1 draw call for power pills (typically 1 per chunk)
    // Combined collection list — both regular dots and power pills live
    // here. Pills carry `isPowerPill === true` so the collection handler
    // can score them and trigger power mode. World.eatenDots applies to
    // both since they share the (cx,cy,lx,ly) key space.
    this.dots = [];
    this._added = false;

    // Pill arm direction (chunk-local). Picked once at construction so
    // build/rebuild produces the same position. 0=N, 1=S, 2=E, 3=W.
    this._pillArm = (hashCoords(0xc0c0c0, cx, cy) >>> 0) % 4;
  }

  worldX(lx) {
    return (this.cx * CHUNK_SIZE + lx) * this.scale;
  }
  worldY(ly) {
    return (this.cy * CHUNK_SIZE + ly) * this.scale;
  }

  /**
   * World z-coordinate of the walkable top surface at (lx, ly):
   *   FLOOR → heights[ly][lx] * scale
   *   WALL  → (heights[ly][lx] + 1) * scale (walls are 1 unit taller)
   *   VOID  → NaN (no surface)
   */
  surfaceZ(lx, ly) {
    const t = this.map[ly][lx];
    if (t === TILE_VOID) return NaN;
    const offset = t === TILE_WALL ? 1 : 0;
    return (this.heights[ly][lx] + offset) * this.scale;
  }

  /** Surface height of (lx, ly) in tile-units (h for FLOOR, h+1 for WALL). */
  surfaceHeight(lx, ly) {
    const t = this.map[ly][lx];
    if (t === TILE_VOID) return NaN;
    const offset = t === TILE_WALL ? 1 : 0;
    return this.heights[ly][lx] + offset;
  }

  build() {
    this.buildWalls();
    this.buildFloor();
    this.buildDots();
  }

  /**
   * Walls render as full boxes from z=0 to z=(h+1)*scale. Their tops are
   * walkable surfaces at z=(h+1)*scale. All wall boxes in the chunk merge
   * into a single BufferGeometry to keep draw calls bounded.
   */
  buildWalls() {
    // Two buckets — short "house" walls and tall "mountain" walls. We
    // build one merged mesh per bucket with its own material so windows
    // only appear on low-rise tiles and big peaks read as natural rock.
    const HOUSE_MAX_STACK = 2; // stackUnits ≤ 2 → houses; ≥ 3 → mountain
    const houseGeos = [];
    const mountainGeos = [];

    for (let ly = 0; ly < CHUNK_SIZE; ly++) {
      for (let lx = 0; lx < CHUNK_SIZE; lx++) {
        if (this.map[ly][lx] !== TILE_WALL) continue;
        const stackUnits = this.heights[ly][lx] + 1; // walls are 1+h tall
        const totalHeight = stackUnits * this.scale;
        const geo = new THREE.BoxGeometry(this.scale, this.scale, totalHeight);
        const isHouse = stackUnits <= HOUSE_MAX_STACK;

        if (isHouse) {
          // Side faces (pX, nX, pY, nY) are vertices 0..15 → UVs 0..31.
          // Top + bottom faces (pZ, nZ) are vertices 16..23 → UVs 32..47.
          // We do two things:
          //   1. Repeat the side V coords by stackUnits so each tile-unit
          //      of wall height shows one row of windows.
          //   2. Collapse the top + bottom UVs onto a single non-window
          //      pixel of the texture (the bottom-left of the canvas is
          //      pure facade). Otherwise the roof would show the window
          //      grid stretched across it — the user spotted this from
          //      the top-down camera.
          const uvAttr = geo.attributes.uv;
          const uv = uvAttr.array;
          for (let i = 0; i < 16; i++) {
            uv[2 * i + 1] *= stackUnits;
          }
          for (let i = 16; i < 24; i++) {
            uv[2 * i] = 0;
            uv[2 * i + 1] = 0;
          }
          uvAttr.needsUpdate = true;
        }

        const matrix = new THREE.Matrix4();
        matrix.setPosition(this.worldX(lx), this.worldY(ly), totalHeight / 2);
        geo.applyMatrix4(matrix);

        if (isHouse) houseGeos.push(geo);
        else mountainGeos.push(geo);
      }
    }

    if (houseGeos.length > 0) {
      const merged = mergeBoxGeometries(houseGeos);
      for (const g of houseGeos) g.dispose();
      this.wallMesh = new THREE.Mesh(merged, this.assets.wallMaterial);
      this.wallMesh.castShadow = true;
      this.wallMesh.receiveShadow = true;
    }
    if (mountainGeos.length > 0) {
      // Mountains don't need UVs (the rock material has no map), so the
      // merger drops them automatically.
      const merged = mergeBoxGeometries(mountainGeos);
      for (const g of mountainGeos) g.dispose();
      this.mountainMesh = new THREE.Mesh(merged, this.assets.mountainMaterial);
      this.mountainMesh.castShadow = true;
      this.mountainMesh.receiveShadow = true;
    }
  }

  /**
   * Floor rendering. Two cases:
   *   - h === 0: render as a thin top-only plane at z=0 (cheap, no sides
   *              needed since z=0 is the ground baseline).
   *   - h  >  0: render as a full box from z=0 to z=h*scale (Minecraft-style
   *              block with all sides visible — no more floating slabs).
   * Both forms merge into a single BufferGeometry per chunk.
   */
  buildFloor() {
    const geometries = [];
    for (let ly = 0; ly < CHUNK_SIZE; ly++) {
      for (let lx = 0; lx < CHUNK_SIZE; lx++) {
        if (this.map[ly][lx] !== TILE_FLOOR) continue;
        const h = this.heights[ly][lx];
        if (h === 0) {
          const plane = new THREE.PlaneGeometry(this.scale, this.scale);
          const matrix = new THREE.Matrix4();
          matrix.setPosition(this.worldX(lx), this.worldY(ly), 0.01);
          plane.applyMatrix4(matrix);
          geometries.push(plane);
        } else {
          const totalHeight = h * this.scale;
          const box = new THREE.BoxGeometry(this.scale, this.scale, totalHeight);
          const matrix = new THREE.Matrix4();
          matrix.setPosition(this.worldX(lx), this.worldY(ly), totalHeight / 2);
          box.applyMatrix4(matrix);
          geometries.push(box);
        }
      }
    }
    if (geometries.length === 0) return;
    const merged = mergeBoxGeometries(geometries);
    for (const g of geometries) g.dispose();
    this.floorMesh = new THREE.Mesh(merged, this.assets.floorMaterial);
    this.floorMesh.receiveShadow = true;
    // Don't cast shadows from floors — too many block sides multiply the
    // shadow map cost and the visual win is marginal.
    this.floorMesh.castShadow = false;
  }

  /**
   * Dots — rendered as a single InstancedMesh per chunk so all dots in the
   * chunk cost exactly one draw call. Each dot is tracked by a lightweight
   * metadata record exposing `position` (Vector3) and `visible` (boolean)
   * so existing collection logic (Game.checkDotCollection) keeps working.
   *
   * Placement rules:
   *   - WALL tops: no dots (walls are barriers + climbing surfaces, not the
   *     primary collection target).
   *   - FLOOR cross-corridor (row 8 or col 8): always gets a dot — preserves
   *     the iconic Pac-Man "trail of dots down the corridor" look.
   *   - FLOOR elsewhere (arenas, plateaus, terraces): sparse via a
   *     deterministic per-tile hash so they're fun to hunt for, and the
   *     pattern is identical across reloads.
   *
   * Collected dots are hidden by setting their instance matrix to zero
   * scale; the metadata's `visible` flag is the source of truth for
   * collision logic.
   */
  buildDots() {
    const pill = this._pillCell(); // {lx, ly} on the cross corridor

    const dotPositions = [];
    const pillPositions = [];

    for (let ly = 0; ly < CHUNK_SIZE; ly++) {
      for (let lx = 0; lx < CHUNK_SIZE; lx++) {
        if (this.map[ly][lx] !== TILE_FLOOR) continue;

        // The chosen pill cell is removed from the regular dot pool and
        // added to the pillPositions list — the pill takes the slot.
        if (lx === pill.lx && ly === pill.ly) {
          pillPositions.push({
            lx,
            ly,
            position: new THREE.Vector3(
              this.worldX(lx),
              this.worldY(ly),
              this.surfaceZ(lx, ly) + this.scale * 0.6 // slightly higher than dots
            )
          });
          continue;
        }

        const onCross = lx === CROSS_AXIS || ly === CROSS_AXIS;
        if (!onCross) {
          // Decimate non-cross FLOOR tiles via global-coord hash. Same
          // (cx, cy, lx, ly) always produces the same dot/no-dot decision,
          // so dot layout is reproducible.
          const gx = this.cx * CHUNK_SIZE + lx;
          const gy = this.cy * CHUNK_SIZE + ly;
          const h = hashCoords(0, gx, gy);
          if (h % 100 >= this.dotKeepPercent) continue;
        }

        dotPositions.push({
          lx,
          ly,
          position: new THREE.Vector3(
            this.worldX(lx),
            this.worldY(ly),
            this.surfaceZ(lx, ly) + this.scale * 0.5
          )
        });
      }
    }

    // Build the regular-dot InstancedMesh.
    if (dotPositions.length > 0) {
      const dotGeo = this.assets.dotGeometry;
      const mesh = new THREE.InstancedMesh(dotGeo, this.assets.dotMaterial, dotPositions.length);
      mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
      const tmp = new THREE.Matrix4();
      for (let i = 0; i < dotPositions.length; i++) {
        const p = dotPositions[i];
        tmp.makeTranslation(p.position.x, p.position.y, p.position.z);
        mesh.setMatrixAt(i, tmp);
        const rec = new InstancedDotRecord(this.cx, this.cy, p.lx, p.ly, p.position, mesh, i);
        rec.isPowerPill = false;
        this.dots.push(rec);
      }
      mesh.castShadow = false;
      mesh.receiveShadow = false;
      this.dotMesh = mesh;
    }

    // Build the power-pill InstancedMesh (typically size 1 — one pill per
    // chunk). Pills share the same eatenSet logic via their (cx,cy,lx,ly)
    // key, so a collected pill stays gone across reloads.
    if (pillPositions.length > 0 && this.assets.pillGeometry && this.assets.pillMaterial) {
      const pillMesh = new THREE.InstancedMesh(
        this.assets.pillGeometry,
        this.assets.pillMaterial,
        pillPositions.length
      );
      pillMesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
      const tmp = new THREE.Matrix4();
      for (let i = 0; i < pillPositions.length; i++) {
        const p = pillPositions[i];
        tmp.makeTranslation(p.position.x, p.position.y, p.position.z);
        pillMesh.setMatrixAt(i, tmp);
        const rec = new InstancedDotRecord(this.cx, this.cy, p.lx, p.ly, p.position, pillMesh, i);
        rec.isPowerPill = true;
        this.dots.push(rec);
      }
      pillMesh.castShadow = false;
      pillMesh.receiveShadow = false;
      this.pillMesh = pillMesh;
    }
  }

  /**
   * Pick the deterministic (lx, ly) where this chunk's power pill sits.
   * Always lands on the central cross corridor (lx=CROSS_AXIS or
   * ly=CROSS_AXIS) so it's guaranteed to be on a FLOOR tile.
   */
  _pillCell() {
    switch (this._pillArm) {
      case 0: return { lx: CROSS_AXIS, ly: CROSS_AXIS - PILL_OFFSET_TILES }; // N
      case 1: return { lx: CROSS_AXIS, ly: CROSS_AXIS + PILL_OFFSET_TILES }; // S
      case 2: return { lx: CROSS_AXIS + PILL_OFFSET_TILES, ly: CROSS_AXIS }; // E
      default: return { lx: CROSS_AXIS - PILL_OFFSET_TILES, ly: CROSS_AXIS }; // W
    }
  }

  /**
   * Hide every dot in this chunk whose key (cx,cy,lx,ly) is in `eatenSet`.
   * Called by World right after `build()` to restore previously-collected
   * dots from a save. Cheap when the set is empty (early-out).
   */
  applyEatenSet(eatenSet) {
    if (!eatenSet || eatenSet.size === 0) return;
    for (const dot of this.dots) {
      const key = `${this.cx},${this.cy},${dot.lx},${dot.ly}`;
      if (eatenSet.has(key)) {
        dot.visible = false;
      }
    }
  }

  addToScene(scene) {
    if (this._added) return;
    if (this.wallMesh) scene.add(this.wallMesh);
    if (this.mountainMesh) scene.add(this.mountainMesh);
    if (this.floorMesh) scene.add(this.floorMesh);
    if (this.dotMesh) scene.add(this.dotMesh);
    if (this.pillMesh) scene.add(this.pillMesh);
    this._added = true;
  }

  removeFromScene(scene) {
    if (!this._added) return;
    if (this.wallMesh) scene.remove(this.wallMesh);
    if (this.mountainMesh) scene.remove(this.mountainMesh);
    if (this.floorMesh) scene.remove(this.floorMesh);
    if (this.dotMesh) scene.remove(this.dotMesh);
    if (this.pillMesh) scene.remove(this.pillMesh);
    this._added = false;
  }

  dispose() {
    if (this.wallMesh) {
      this.wallMesh.geometry.dispose();
      this.wallMesh = null;
    }
    if (this.mountainMesh) {
      this.mountainMesh.geometry.dispose();
      this.mountainMesh = null;
    }
    if (this.floorMesh) {
      this.floorMesh.geometry.dispose();
      this.floorMesh = null;
    }
    // InstancedMesh.dispose() releases instance buffers; the underlying
    // shared geometry/material live on world.assets and outlive any one
    // chunk, so we don't dispose them here.
    if (this.dotMesh) {
      this.dotMesh.dispose();
      this.dotMesh = null;
    }
    if (this.pillMesh) {
      this.pillMesh.dispose();
      this.pillMesh = null;
    }
    this.dots.length = 0;
  }
}

/**
 * Lightweight record proxying one instance inside an InstancedMesh of dots.
 * Mirrors the parts of the THREE.Mesh API that Game.checkDotCollection
 * touches (`position`, `visible`) so collection code didn't need to change.
 *
 * Setting `visible = false` updates the instance matrix to zero scale, which
 * makes that single dot disappear without the cost of removing the mesh.
 */
class InstancedDotRecord {
  constructor(cx, cy, lx, ly, position, mesh, instanceId) {
    this.cx = cx;
    this.cy = cy;
    this.lx = lx;
    this.ly = ly;
    this.position = position;
    this._mesh = mesh;
    this._instanceId = instanceId;
    this._visible = true;
  }

  get visible() {
    return this._visible;
  }

  set visible(v) {
    if (this._visible === v) return;
    this._visible = v;
    const m = _tmpMatrix;
    if (v) {
      m.makeTranslation(this.position.x, this.position.y, this.position.z);
    } else {
      m.makeScale(0, 0, 0);
    }
    this._mesh.setMatrixAt(this._instanceId, m);
    this._mesh.instanceMatrix.needsUpdate = true;
  }
}

const _tmpMatrix = new THREE.Matrix4();

/**
 * Merge a homogeneous list of indexed BoxGeometries into a single
 * BufferGeometry. Same approach as the Phase-1 wall merger.
 *
 * Carries `uv` through when ALL inputs have it. Walls use UVs to map a
 * window-pattern texture (per-tile V scaled by stackUnits in
 * buildWalls); floors don't carry UVs so the texture isn't applied.
 */
function mergeBoxGeometries(geometries) {
  let totalVertices = 0;
  let totalIndices = 0;
  let allHaveUv = geometries.length > 0;
  for (const geo of geometries) {
    totalVertices += geo.attributes.position.count;
    totalIndices += geo.index ? geo.index.count : geo.attributes.position.count;
    if (!geo.attributes.uv) allHaveUv = false;
  }
  const positions = new Float32Array(totalVertices * 3);
  const normals = new Float32Array(totalVertices * 3);
  const uvs = allHaveUv ? new Float32Array(totalVertices * 2) : null;
  const indices = new Uint32Array(totalIndices);
  let vOff = 0;
  let iOff = 0;
  for (const geo of geometries) {
    const posAttr = geo.attributes.position;
    const normAttr = geo.attributes.normal;
    const uvAttr = geo.attributes.uv;
    for (let i = 0; i < posAttr.count; i++) {
      positions[(vOff + i) * 3] = posAttr.getX(i);
      positions[(vOff + i) * 3 + 1] = posAttr.getY(i);
      positions[(vOff + i) * 3 + 2] = posAttr.getZ(i);
      if (normAttr) {
        normals[(vOff + i) * 3] = normAttr.getX(i);
        normals[(vOff + i) * 3 + 1] = normAttr.getY(i);
        normals[(vOff + i) * 3 + 2] = normAttr.getZ(i);
      }
      if (uvs && uvAttr) {
        uvs[(vOff + i) * 2] = uvAttr.getX(i);
        uvs[(vOff + i) * 2 + 1] = uvAttr.getY(i);
      }
    }
    if (geo.index) {
      for (let i = 0; i < geo.index.count; i++) {
        indices[iOff + i] = geo.index.getX(i) + vOff;
      }
      iOff += geo.index.count;
    } else {
      for (let i = 0; i < posAttr.count; i++) {
        indices[iOff + i] = i + vOff;
      }
      iOff += posAttr.count;
    }
    vOff += posAttr.count;
  }
  const merged = new THREE.BufferGeometry();
  merged.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  merged.setAttribute('normal', new THREE.BufferAttribute(normals, 3));
  if (uvs) merged.setAttribute('uv', new THREE.BufferAttribute(uvs, 2));
  merged.setIndex(new THREE.BufferAttribute(indices, 1));
  return merged;
}

