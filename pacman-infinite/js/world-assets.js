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
 *   - createSharedAssets(scale) — wall / mountain / floor / dot / pill
 *                                materials and geometries.
 */

import * as THREE from 'three';

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
  const COLS = 3; // windows across one tile width
  const c = document.createElement('canvas');
  c.width = SIZE;
  c.height = SIZE;
  const ctx = c.getContext('2d');
  // Wall background — dark navy "facade" so the windows pop.
  ctx.fillStyle = '#0e1840';
  ctx.fillRect(0, 0, SIZE, SIZE);
  // Faint mortar / floor-divider line at the top of the tile.
  ctx.fillStyle = 'rgba(0,0,0,0.5)';
  ctx.fillRect(0, 0, SIZE, 4);
  // Vertical column gutters (between windows) for depth.
  ctx.fillStyle = 'rgba(0,0,0,0.35)';
  for (let i = 1; i < COLS; i++) {
    const x = (SIZE / COLS) * i - 1;
    ctx.fillRect(x, 0, 2, SIZE);
  }
  // Window grid. One row per tile-unit, with the windows centered
  // vertically so the texture tiles cleanly when V repeats.
  const cellW = SIZE / COLS;
  const winW = cellW * 0.6;
  const winH = SIZE * 0.55;
  const yStart = SIZE * 0.2;
  for (let i = 0; i < COLS; i++) {
    const x = i * cellW + (cellW - winW) / 2;
    const y = yStart;
    // Pseudo-random lit pattern (deterministic per column index) so it
    // looks like real windows without "every window lit" uniformity.
    const lit = (i * 37 + 11) % 4 < 3;
    if (lit) {
      // Bright warm yellow window with a soft glow halo.
      ctx.fillStyle = 'rgba(255, 220, 110, 0.35)';
      ctx.fillRect(x - 6, y - 6, winW + 12, winH + 12);
      ctx.fillStyle = '#ffe080';
    } else {
      ctx.fillStyle = '#070a18';
    }
    ctx.fillRect(x, y, winW, winH);
    // Window cross-mullions for that "office tower" look.
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
 * Create the materials + dot geometry that every chunk shares. Centralising
 * these means we only allocate the GL resources once per world, not per chunk.
 */
export function createSharedAssets(scale) {
  // Two wall flavours, picked per-tile in chunk.buildWalls() based on
  // the tile's stack height:
  //   - HOUSES  (short walls, stackUnits ≤ 2): textured with a window
  //     grid → reads as a low-rise village.
  //   - MOUNTAIN (tall walls, stackUnits ≥ 3): plain rocky grey with
  //     no windows → reads as a cliff/peak rather than a giant tower.
  const wallTexture = createBuildingWindowTexture();
  const wallMaterial = new THREE.MeshStandardMaterial({
    color: 0xffffff, // texture provides the colour; keep tint neutral
    roughness: 0.6,
    metalness: 0.05,
    // Emissive map = same texture, so the LIT WINDOWS glow against the
    // dark facade. Modest base intensity — the lit pixels already pop.
    emissive: 0xffffff,
    emissiveIntensity: 0.35,
    map: wallTexture,
    emissiveMap: wallTexture
  });
  // Mountain rock: cool slate-grey with a hint of blue so it harmonises
  // with the rest of the palette (which is mostly blue). High roughness
  // and zero metalness keep it matte — natural stone, not building.
  const mountainMaterial = new THREE.MeshStandardMaterial({
    color: 0x55607a,
    roughness: 0.95,
    metalness: 0.0,
    emissive: 0x111722,
    emissiveIntensity: 0.2
  });

  // Floors: lighter steel-blue, distinct from walls but visibly part of the
  // same family. Was 0x2a2a3a (almost black) which made elevated terrain
  // (e.g. the terraced pyramid) silhouette into the dark sky.
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

  // Bump dot radius from 0.08 → 0.13 of a tile so individual pellets read
  // from farther away — important now that they're sparser.
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

  return {
    wallMaterial,
    mountainMaterial,
    floorMaterial,
    dotMaterial,
    dotGeometry,
    pillMaterial,
    pillGeometry
  };
}
