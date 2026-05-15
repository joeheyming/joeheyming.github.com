/**
 * Shared GL assets + chunk keying for the streamed Pacman world.
 *
 * Split out of world.js because these are pure factories — they don't
 * touch World state, they just build the three.js materials, textures,
 * and geometries that every chunk reuses. Centralising them means we
 * allocate the GL resources once per world load instead of per chunk.
 *
 * Exports:
 *   - chunkKey(cx, cy)         — canonical "cx,cy" string key for the
 *                                chunk map in world.js.
 *   - createSharedAssets(scale) — returns:
 *       {
 *         floorMaterial,
 *         dotMaterial, dotGeometry,
 *         pillMaterial, pillGeometry,
 *         hazardMaterials:  Map<hazardId,  THREE.Material>,
 *         wallMaterials:    Map<wallKindId, THREE.Material>,
 *         wallTextures:     Map<textureId,  THREE.Texture>
 *       }
 *
 * The hazard- and wall-material maps are populated from the HAZARDS /
 * WALL_KINDS registries in `world-config.js`. Adding a new hazard or
 * wall kind requires zero edits here.
 */

import * as THREE from 'three';
import { HAZARDS, WALL_KINDS } from './world-config.js';

/** Stable string key for the world's chunk Map. */
export function chunkKey(cx, cy) {
  return `${cx},${cy}`;
}

/**
 * Build a procedural canvas texture that looks like a wall of building
 * windows when tiled vertically. Per-pixel window pattern is drawn once
 * at boot and re-used for every wall tile in every chunk.
 *
 * The texture itself is one "building floor" tall — in combination with
 * the per-tile UV V-scaling in chunk.buildWalls(), a 4-tile-tall mountain
 * gets 4 rows of windows stacked, reading as a 4-storey building.
 */
function createBuildingWindowTexture() {
  const SIZE = 128;
  const COLS = 3;
  const c = document.createElement('canvas');
  c.width = SIZE;
  c.height = SIZE;
  const ctx = c.getContext('2d');
  ctx.fillStyle = '#0e1840';
  ctx.fillRect(0, 0, SIZE, SIZE);
  ctx.fillStyle = 'rgba(0,0,0,0.5)';
  ctx.fillRect(0, 0, SIZE, 4);
  ctx.fillStyle = 'rgba(0,0,0,0.35)';
  for (let i = 1; i < COLS; i++) {
    const x = (SIZE / COLS) * i - 1;
    ctx.fillRect(x, 0, 2, SIZE);
  }
  const cellW = SIZE / COLS;
  const winW = cellW * 0.6;
  const winH = SIZE * 0.55;
  const yStart = SIZE * 0.2;
  for (let i = 0; i < COLS; i++) {
    const x = i * cellW + (cellW - winW) / 2;
    const y = yStart;
    const lit = (i * 37 + 11) % 4 < 3;
    if (lit) {
      ctx.fillStyle = 'rgba(255, 220, 110, 0.35)';
      ctx.fillRect(x - 6, y - 6, winW + 12, winH + 12);
      ctx.fillStyle = '#ffe080';
    } else {
      ctx.fillStyle = '#070a18';
    }
    ctx.fillRect(x, y, winW, winH);
    ctx.strokeStyle = 'rgba(0,0,0,0.7)';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(x + winW / 2, y);
    ctx.lineTo(x + winW / 2, y + winH);
    ctx.moveTo(x, y + winH / 2);
    ctx.lineTo(x + winW, y + winH / 2);
    ctx.stroke();
  }
  const tex = new THREE.CanvasTexture(c);
  tex.wrapS = THREE.RepeatWrapping;
  tex.wrapT = THREE.RepeatWrapping;
  tex.magFilter = THREE.LinearFilter;
  tex.minFilter = THREE.LinearMipmapLinearFilter;
  tex.anisotropy = 4;
  return tex;
}

/**
 * Registry of procedural texture factories keyed by `textureId`. WALL_KINDS
 * entries can reference one of these via their `textureId` field; the
 * texture is bound to both `map` and `emissiveMap` so lit window pixels
 * glow.
 *
 * Adding a new procedural texture (rock face, brick, hexagons, …):
 *   1. Write a factory returning a `THREE.CanvasTexture` here.
 *   2. Add an entry to TEXTURE_FACTORIES below.
 *   3. Reference it from a WALL_KINDS entry's `textureId` field.
 */
const TEXTURE_FACTORIES = {
  'building-windows': createBuildingWindowTexture
};

/**
 * Build all procedural canvas textures referenced by the WALL_KINDS
 * registry. Returns a Map<textureId, THREE.Texture>. Cached at
 * world-load time so we don't redraw the canvas per chunk.
 */
function buildWallTextures() {
  const out = new Map();
  for (const kind of Object.values(WALL_KINDS)) {
    const id = kind.textureId;
    if (!id) continue;
    if (out.has(id)) continue;
    const factory = TEXTURE_FACTORIES[id];
    if (!factory) {
      // Don't crash on a typo — log once, render without a texture.
      // eslint-disable-next-line no-console
      console.warn(`world-assets: no texture factory for '${id}'; wall kind '${kind.id}' will render untextured.`);
      continue;
    }
    out.set(id, factory());
  }
  return out;
}

/**
 * Hydrate a single registry spec (HAZARDS[id].material or
 * WALL_KINDS[id].material) into a THREE material. When the entry has a
 * `textureId`, we look up the canvas texture and bind it as both `map`
 * AND `emissiveMap` (matches the windowed-house behaviour: lit windows
 * glow because the same canvas drives the emissive channel).
 */
function hydrateMaterial(spec, textureId, textures) {
  const opts = { ...spec };
  if (textureId && textures.has(textureId)) {
    const tex = textures.get(textureId);
    opts.map = tex;
    opts.emissiveMap = tex;
  }
  return new THREE.MeshStandardMaterial(opts);
}

/**
 * Build the hazard material map from the HAZARDS registry. Keyed by
 * hazard id (`'water'`, `'lava'`, `'mud'`). Chunk.buildHazards reads
 * `assets.hazardMaterials.get(spec.id)` per merged mesh.
 */
function buildHazardMaterials() {
  const out = new Map();
  for (const spec of Object.values(HAZARDS)) {
    out.set(spec.id, hydrateMaterial(spec.material, null, new Map()));
  }
  return out;
}

/**
 * Build the wall material map from the WALL_KINDS registry. Keyed by
 * wall-kind id (`'house'`, `'mountain'`, `'obsidian'`, …). Chunk.buildWalls
 * reads `assets.wallMaterials.get(kindId)` after picking the kind via
 * `pickWallKindId(stackUnits, chunk.wallKind)`.
 */
function buildWallMaterials(textures) {
  const out = new Map();
  for (const kind of Object.values(WALL_KINDS)) {
    out.set(kind.id, hydrateMaterial(kind.material, kind.textureId, textures));
  }
  return out;
}

/**
 * Create the materials + dot geometry that every chunk shares. Centralising
 * these means we only allocate the GL resources once per world, not per chunk.
 *
 * Output shape:
 *   floorMaterial             — shared floor material (no registry — only one)
 *   dotMaterial, dotGeometry  — instanced dots
 *   pillMaterial, pillGeometry — instanced power pills
 *   hazardMaterials: Map<id, Material>  — keyed by HAZARDS entry id
 *   wallMaterials:   Map<id, Material>  — keyed by WALL_KINDS entry id
 *   wallTextures:    Map<id, Texture>   — keyed by textureId for inspection
 */
export function createSharedAssets(scale) {
  // Procedural textures referenced by any wall kind.
  const wallTextures = buildWallTextures();

  // Floor: lighter steel-blue, distinct from walls but visibly part of the
  // same family. (Floors only have one flavour today; if we add biome-
  // specific floor materials later, this becomes a registry too.)
  const floorMaterial = new THREE.MeshStandardMaterial({
    color: 0x6080b0,
    roughness: 0.7,
    metalness: 0.0,
    emissive: 0x182840,
    emissiveIntensity: 0.2
  });

  const dotMaterial = new THREE.MeshStandardMaterial({
    color: 0xffffaa,
    emissive: 0xffff88,
    emissiveIntensity: 0.6,
    roughness: 0.2,
    metalness: 0.3
  });
  const dotGeometry = new THREE.SphereGeometry(scale * 0.13, 8, 8);

  // Power pill — clearly distinct from regular dots: ~3× size, magenta,
  // strong emissive that gets pulsed by World.update().
  const pillMaterial = new THREE.MeshStandardMaterial({
    color: 0xff80ff,
    emissive: 0xff40ff,
    emissiveIntensity: 0.7,
    roughness: 0.3,
    metalness: 0.4
  });
  const pillGeometry = new THREE.SphereGeometry(scale * 0.32, 16, 12);

  // Registry-driven maps — one entry per spec, looked up at chunk-build
  // time by id.
  const hazardMaterials = buildHazardMaterials();
  const wallMaterials = buildWallMaterials(wallTextures);

  return {
    floorMaterial,
    dotMaterial,
    dotGeometry,
    pillMaterial,
    pillGeometry,
    hazardMaterials,
    wallMaterials,
    wallTextures
  };
}
