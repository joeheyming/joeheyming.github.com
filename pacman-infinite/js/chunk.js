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
import { HAZARDS, HAZARD_BY_CODE, WALL_KINDS, pickWallKindId } from './world-config.js';

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
    // Cross-corridor decimation. Defaults to 100 (every cross-floor
    // tile gets a dot — the classic "trail down the corridor" look).
    // World overrides via the active preset's `crossDotKeepMul` so
    // Hard mode can thin the corridor too. Same hash-based gate as
    // off-cross dots so the layout is deterministic per (cx,cy,lx,ly).
    this.crossDotKeepPercent = opts.crossDotKeepPercent ?? 100;
    // Per-chunk wall-kind override (set by biomes via the template).
    // When unset, buildWalls picks per tile via WALL_KINDS stackRange
    // fallback. When set, every wall in the chunk uses this kind
    // regardless of height — a biome can say "I want volcanic obsidian
    // for all my walls".
    this.wallKind = opts.wallKind ?? template.wallKind ?? null;

    // Copy the per-cell tile codes and heights so per-chunk mutations
    // (collected dots) don't bleed into other chunks that share the template.
    this.map = template.map.map((row) => row.slice());
    this.heights = template.heights.map((row) => row.slice());

    // Wall + hazard meshes are registry-driven: one entry per
    // WALL_KINDS / HAZARDS id that actually produced geometry this
    // chunk. Iterating the map covers every kind, so adding a new
    // hazard or wall kind only requires editing the registry.
    /** @type {Map<string, THREE.Mesh>} keyed by HAZARDS id */
    this.hazardMeshes = new Map();
    /** @type {Map<string, THREE.Mesh>} keyed by WALL_KINDS id */
    this.wallMeshes = new Map();
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
   *   FLOOR / any HAZARD → heights[ly][lx] * scale
   *   WALL                → (heights[ly][lx] + 1) * scale (walls are 1 unit taller)
   *   VOID                → NaN (no surface)
   *
   * Hazards behave like FLOOR for surface-Z purposes — Pacman walks on
   * their tops at the same height as the surrounding floor; what makes
   * them hazardous lives in `pacman._reactToTileUnderFeet`, not here.
   */
  surfaceZ(lx, ly) {
    const t = this.map[ly][lx];
    if (t === TILE_VOID) return NaN;
    const offset = t === TILE_WALL ? 1 : 0;
    return (this.heights[ly][lx] + offset) * this.scale;
  }

  /** Surface height of (lx, ly) in tile-units (h for FLOOR/hazard, h+1 for WALL). */
  surfaceHeight(lx, ly) {
    const t = this.map[ly][lx];
    if (t === TILE_VOID) return NaN;
    const offset = t === TILE_WALL ? 1 : 0;
    return this.heights[ly][lx] + offset;
  }

  build() {
    this.buildWalls();
    this.buildFloor();
    this.buildHazards();
    this.buildDots();
  }

  /**
   * Walls render as full boxes from z=0 to z=(h+1)*scale. Their tops are
   * walkable surfaces at z=(h+1)*scale.
   *
   * Wall-kind selection is registry-driven: for each WALL tile we ask
   * `pickWallKindId(stackUnits, this.wallKind)` which honours a per-
   * chunk biome override and otherwise falls back to height-based
   * selection from the WALL_KINDS registry. All boxes of the same kind
   * merge into a single BufferGeometry to keep draw calls bounded —
   * one mesh per kind that's actually used in this chunk.
   *
   * UV handling: kinds with `repeatVerticalUV: true` (windowed houses
   * today) get their side-face V coords scaled by stackUnits so a
   * 4-tile-tall building shows 4 storeys of windows, while top + bottom
   * UVs collapse to a non-window texel so the rooftop doesn't show
   * stretched windows from above.
   */
  buildWalls() {
    /** @type {Map<string, THREE.BoxGeometry[]>} kindId → geometry buckets */
    const buckets = new Map();

    for (let ly = 0; ly < CHUNK_SIZE; ly++) {
      for (let lx = 0; lx < CHUNK_SIZE; lx++) {
        if (this.map[ly][lx] !== TILE_WALL) continue;
        const stackUnits = this.heights[ly][lx] + 1; // walls are 1+h tall
        const totalHeight = stackUnits * this.scale;
        const kindId = pickWallKindId(stackUnits, this.wallKind);
        const kind = WALL_KINDS[kindId];

        const geo = new THREE.BoxGeometry(this.scale, this.scale, totalHeight);

        if (kind?.repeatVerticalUV) {
          // Side faces (pX, nX, pY, nY) are vertices 0..15 → UVs 0..31.
          // Top + bottom faces (pZ, nZ) are vertices 16..23 → UVs 32..47.
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

        let bucket = buckets.get(kindId);
        if (!bucket) {
          bucket = [];
          buckets.set(kindId, bucket);
        }
        bucket.push(geo);
      }
    }

    for (const [kindId, geos] of buckets) {
      if (geos.length === 0) continue;
      const material = this.assets.wallMaterials.get(kindId);
      if (!material) continue;
      const merged = mergeBoxGeometries(geos);
      for (const g of geos) g.dispose();
      const mesh = new THREE.Mesh(merged, material);
      mesh.castShadow = true;
      mesh.receiveShadow = true;
      this.wallMeshes.set(kindId, mesh);
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
   * Hazard rendering — one merged mesh per hazard kind that actually
   * appears in this chunk. Each tile is a thin slab whose top surface
   * sits flush with the floor at the same height; Pacman walks on top
   * via `surfaceZ` (same as FLOOR) and gameplay reactions live in
   * `pacman._reactToTileUnderFeet`.
   *
   * Registry-driven: we iterate `HAZARDS` once at end of build to flush
   * each populated bucket. Adding a new hazard requires zero edits here.
   */
  buildHazards() {
    const DEFAULT_SLAB_T = 0.18; // fraction of `scale` — thin slab on the floor
    /** @type {Map<string, THREE.BoxGeometry[]>} hazardId → geometry buckets */
    const buckets = new Map();

    for (let ly = 0; ly < CHUNK_SIZE; ly++) {
      for (let lx = 0; lx < CHUNK_SIZE; lx++) {
        const tileCode = this.map[ly][lx];
        const spec = HAZARD_BY_CODE.get(tileCode);
        if (!spec) continue;
        const h = this.heights[ly][lx];
        const topZ = h * this.scale;
        const thickness = this.scale * (spec.slabThickness ?? DEFAULT_SLAB_T);
        const box = new THREE.BoxGeometry(this.scale, this.scale, thickness);
        const matrix = new THREE.Matrix4();
        // Slab is centred half-a-thickness below the top so the top face
        // lands exactly at `topZ + 0.02` (tiny lift avoids z-fighting
        // with the floor block underneath when h>0).
        matrix.setPosition(this.worldX(lx), this.worldY(ly), topZ - thickness / 2 + 0.02);
        box.applyMatrix4(matrix);
        let bucket = buckets.get(spec.id);
        if (!bucket) {
          bucket = [];
          buckets.set(spec.id, bucket);
        }
        bucket.push(box);
      }
    }

    for (const [hazardId, geos] of buckets) {
      if (geos.length === 0) continue;
      const material = this.assets.hazardMaterials.get(hazardId);
      if (!material) continue;
      const merged = mergeBoxGeometries(geos);
      for (const g of geos) g.dispose();
      const mesh = new THREE.Mesh(merged, material);
      mesh.receiveShadow = false;
      mesh.castShadow = false;
      this.hazardMeshes.set(hazardId, mesh);
    }
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
        // Decimate FLOOR tiles via global-coord hash. Same (cx, cy,
        // lx, ly) always produces the same dot/no-dot decision so the
        // dot layout is reproducible across reloads. Cross corridor
        // and off-cross use independent percentages so a difficulty
        // preset can keep the cross full (Easy/Normal) or thin it
        // alongside the off-cross density (Hard). Salt the cross hash
        // with a different seed (0x77 vs 0) so the cross/off-cross
        // patterns don't accidentally align on the same tile.
        const gx = this.cx * CHUNK_SIZE + lx;
        const gy = this.cy * CHUNK_SIZE + ly;
        if (onCross) {
          if (this.crossDotKeepPercent < 100) {
            const h = hashCoords(0x77, gx, gy);
            if (h % 100 >= this.crossDotKeepPercent) continue;
          }
        } else {
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
    for (const mesh of this.wallMeshes.values()) scene.add(mesh);
    if (this.floorMesh) scene.add(this.floorMesh);
    for (const mesh of this.hazardMeshes.values()) scene.add(mesh);
    if (this.dotMesh) scene.add(this.dotMesh);
    if (this.pillMesh) scene.add(this.pillMesh);
    this._added = true;
  }

  removeFromScene(scene) {
    if (!this._added) return;
    for (const mesh of this.wallMeshes.values()) scene.remove(mesh);
    if (this.floorMesh) scene.remove(this.floorMesh);
    for (const mesh of this.hazardMeshes.values()) scene.remove(mesh);
    if (this.dotMesh) scene.remove(this.dotMesh);
    if (this.pillMesh) scene.remove(this.pillMesh);
    this._added = false;
  }

  dispose() {
    // Wall + hazard meshes — geometries are unique per chunk (merged
    // BoxGeometry lists) so they must be disposed; the materials live
    // on world.assets and are shared, so they stay alive past the
    // chunk's lifetime.
    for (const mesh of this.wallMeshes.values()) mesh.geometry.dispose();
    this.wallMeshes.clear();
    for (const mesh of this.hazardMeshes.values()) mesh.geometry.dispose();
    this.hazardMeshes.clear();
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

