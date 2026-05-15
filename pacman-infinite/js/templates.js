/**
 * Hand-authored chunk templates for the procedural infinite world.
 *
 * Every template is a 16x16 grid of int tile codes plus a parallel 16x16 grid
 * of integer height values. Tile codes for non-hazard tiles are fixed
 * here (VOID/FLOOR/WALL); hazard tile codes come from
 * `world-config.js#HAZARDS` and are looked up by id via HAZARD_CODE_BY_ID.
 *
 * Connector contract — guaranteed for every template via buildTemplate():
 *   - map[0][8]  = map[15][8] = map[8][0] = map[8][15] = FLOOR
 *   - heights[0][8] = heights[15][8] = heights[8][0] = heights[8][15] = 0
 *   - row 8 and column 8 are entirely FLOOR (the central cross).
 *   - all other border cells are WALL.
 *   - ANY hazard tile is NEVER stamped on the cross — even brand-new
 *     hazards added to the registry inherit this invariant via
 *     `stampHazard`.
 *
 * Because every chunk shares the same connector-cross contract, chunks can
 * abut on any side and corridors line up at ground level.
 *
 * Templates can optionally include a `wallKind` (string id of a
 * WALL_KINDS entry). When set, every WALL tile in the chunk renders in
 * that flavour (obsidian/ice/glass/…) instead of the default
 * height-based pick.
 */

import { HAZARD_CODE_BY_ID } from './world-config.js';

export const CHUNK_SIZE = 16;

const VOID = 0;
const FLOOR = 1;
const WALL = 2;

const CENTER = CHUNK_SIZE / 2; // 8

/**
 * Build a chunk template from rectangles. All rects are inclusive
 * `[r0, c0, r1, c1]` and clamped to the interior (rows 1..14, cols
 * 1..14) so border integrity is never broken.
 *
 * Pass order (latest wins for a given cell, except hazards never
 * overwrite the central cross):
 *   1. base = all WALL
 *   2. carve central cross to FLOOR at height 0
 *   3. apply VOID rects    (deadly pits)
 *   4. apply FLOOR rects   (bridges, decks)
 *   5. apply HAZARD rects  (per-id, skips cross cells)
 *   6. apply elevate rects (heights only)
 *
 * @param {object} opts
 * @param {Array<[number,number,number,number]>} [opts.floor]    - FLOOR rects
 * @param {Array<[number,number,number,number]>} [opts.voids]    - VOID rects (deadly)
 * @param {Object<string, Array<[number,number,number,number]>>} [opts.hazards]
 *        - keyed by hazard id (`'water'`, `'lava'`, `'mud'`, …) → rects.
 *          Unknown ids are silently skipped (defensive against typos).
 * @param {Array<[number,number,number,number,number]>} [opts.elevate]
 *        - `[r0,c0,r1,c1,h]` rects setting heights only.
 * @param {string|null} [opts.wallKind] - WALL_KINDS id override for every
 *        wall in this chunk (e.g. 'obsidian'). null = use height-based
 *        fallback picker.
 */
function buildTemplate({
  floor = [],
  voids = [],
  elevate = [],
  hazards = null,
  wallKind = null
} = {}) {
  const map = Array.from({ length: CHUNK_SIZE }, () => Array(CHUNK_SIZE).fill(WALL));
  const heights = Array.from({ length: CHUNK_SIZE }, () => Array(CHUNK_SIZE).fill(0));

  for (let i = 0; i < CHUNK_SIZE; i++) {
    map[CENTER][i] = FLOOR;
    map[i][CENTER] = FLOOR;
  }

  for (const rect of voids) {
    forEachInteriorCell(rect, (r, c) => {
      map[r][c] = VOID;
    });
  }

  for (const rect of floor) {
    forEachInteriorCell(rect, (r, c) => {
      map[r][c] = FLOOR;
    });
  }

  // Hazard passes — generic over the registry. `stampHazard` enforces
  // the "never stamp on the cross" invariant so connector reachability
  // survives every hazard biome and every future hazard kind.
  if (hazards) {
    for (const [hazardId, rects] of Object.entries(hazards)) {
      const tileCode = HAZARD_CODE_BY_ID.get(hazardId);
      if (tileCode == null) continue; // unknown id — skip silently
      stampHazard(map, rects, tileCode);
    }
  }

  for (const rect of elevate) {
    const [r0, c0, r1, c1, h] = rect;
    forEachInteriorCell([r0, c0, r1, c1], (r, c) => {
      heights[r][c] = h;
    });
  }

  return { map, heights, wallKind };
}

/**
 * Stamp a hazard tile code onto every interior cell of every rect, EXCEPT
 * the central cross (row CENTER and column CENTER). Keeping the cross
 * hazard-free preserves the cross-corridor traversal invariant — every
 * chunk has a guaranteed-safe + connected route from any side to any
 * other, no matter how aggressively a biome floods its interior with
 * lava or water.
 */
function stampHazard(map, rects, code) {
  for (const rect of rects) {
    forEachInteriorCell(rect, (r, c) => {
      if (r === CENTER || c === CENTER) return;
      map[r][c] = code;
    });
  }
}

function forEachInteriorCell(rect, fn) {
  const [r0, c0, r1, c1] = rect;
  const rs = Math.max(1, Math.min(r0, r1));
  const re = Math.min(CHUNK_SIZE - 2, Math.max(r0, r1));
  const cs = Math.max(1, Math.min(c0, c1));
  const ce = Math.min(CHUNK_SIZE - 2, Math.max(c0, c1));
  for (let r = rs; r <= re; r++) {
    for (let c = cs; c <= ce; c++) {
      fn(r, c);
    }
  }
}

// ---------------------------------------------------------------------------
// Phase 1: 8 flat templates (heights all zero)
// ---------------------------------------------------------------------------

const T1 = buildTemplate({});

const T2 = buildTemplate({
  floor: [
    [2, 2, 5, 5],
    [5, 4, 8, 4],
    [2, 10, 5, 13],
    [5, 11, 8, 11],
    [10, 2, 13, 5],
    [8, 4, 10, 4],
    [10, 10, 13, 13],
    [8, 11, 10, 11]
  ]
});

const T3 = buildTemplate({
  floor: [
    [3, 3, 3, 12],
    [12, 3, 12, 12],
    [3, 3, 12, 3],
    [3, 12, 12, 12]
  ]
});

const T4 = buildTemplate({
  floor: [
    [3, 1, 3, 14],
    [6, 1, 6, 14],
    [10, 1, 10, 14],
    [13, 1, 13, 14]
  ]
});

const T5 = buildTemplate({
  floor: [
    [1, 3, 14, 3],
    [1, 6, 14, 6],
    [1, 10, 14, 10],
    [1, 13, 14, 13]
  ]
});

const T6 = buildTemplate({
  floor: [
    [5, 5, 10, 10],
    [2, 2, 5, 5],
    [10, 10, 13, 13]
  ]
});

const T7 = buildTemplate({
  floor: [
    [5, 1, 5, 14],
    [5, 3, 7, 3],
    [5, 11, 7, 11],
    [11, 1, 11, 14],
    [9, 3, 11, 3],
    [9, 11, 11, 11]
  ]
});

const T8 = buildTemplate({
  floor: [
    [3, 1, 3, 7],
    [6, 8, 6, 14],
    [10, 1, 10, 7],
    [13, 8, 13, 14],
    [3, 5, 8, 5],
    [8, 11, 13, 11]
  ]
});

// ---------------------------------------------------------------------------
// Phase 2a: 6 elevated/void templates
// ---------------------------------------------------------------------------

// CLIFF-EAST: east half raised by 2. Cross at row 8 stays at height 0
// to preserve connector contract; you can only enter the east plateau via
// the bumpy step-up corridor along the cross.
const T9_CLIFF_EAST = buildTemplate({
  floor: [
    [1, 9, 14, 14] // east plateau (FLOOR)
  ],
  elevate: [
    [1, 9, 7, 14, 2], // upper-east plateau at height 2 (unreachable directly — decoration)
    [9, 9, 14, 14, 2], // lower-east plateau at height 2
    [8, 9, 8, 14, 1] // ramp along the cross (height 1, auto-step from west)
  ]
});

// PIT-CROSS: a 3x3 VOID hole in the centre. The four 1-tile FLOOR bridges
// of the cross thread through it. Walking off the bridge = death.
const T10_PIT_CROSS = buildTemplate({
  voids: [
    [7, 7, 9, 9] // 3x3 deadly pit
  ],
  floor: [
    [7, 8, 9, 8], // restore cross's vertical bridge through the pit
    [8, 7, 8, 9] // restore cross's horizontal bridge through the pit
  ]
});

// TERRACED: concentric height bands stepping up to a peak at the centre.
// Everything is auto-step accessible (each band rises by 1).
const T11_TERRACED = buildTemplate({
  floor: [
    [3, 3, 12, 12] // 10x10 terraced plateau
  ],
  elevate: [
    [3, 3, 12, 12, 1], // outer ring at h=1
    [4, 4, 11, 11, 2], // middle ring at h=2
    [5, 5, 10, 10, 3], // inner ring at h=3
    [6, 6, 9, 9, 4], // peak at h=4
    [7, 7, 8, 8, 5], // top of peak at h=5
    // Force the cross back to height 0 so connectors stay aligned.
    [8, 0, 8, 15, 0],
    [0, 8, 15, 8, 0]
  ]
});

// MOAT: chunk perimeter is VOID; only the cross corridors bridge across.
// Forces traffic onto the central cross.
const T12_MOAT = buildTemplate({
  voids: [
    [1, 1, 7, 7], // NW quadrant interior
    [1, 9, 7, 14], // NE quadrant interior
    [9, 1, 14, 7], // SW quadrant interior
    [9, 9, 14, 14] // SE quadrant interior
  ]
});

// BUMPY: scattered single-tile bumps at h=1. Auto-step on every transition.
// Lots of tiny height changes; visually busy.
const T13_BUMPY = buildTemplate({
  elevate: [
    [2, 2, 2, 2, 1],
    [2, 6, 2, 6, 1],
    [2, 10, 2, 10, 1],
    [2, 13, 2, 13, 1],
    [5, 4, 5, 4, 1],
    [5, 11, 5, 11, 1],
    [11, 4, 11, 4, 1],
    [11, 11, 11, 11, 1],
    [13, 2, 13, 2, 1],
    [13, 6, 13, 6, 1],
    [13, 10, 13, 10, 1],
    [13, 13, 13, 13, 1],
    // Cross stays at 0 for connector parity.
    [8, 0, 8, 15, 0],
    [0, 8, 15, 8, 0]
  ]
});

// GAUNTLET: alternating 1-tile FLOOR / 1-tile VOID stripes parallel to the
// cross. Pacman must jump every other tile — the chunk's signature dares
// you to use the new mechanic.
const T14_GAUNTLET = buildTemplate({
  voids: [
    // Vertical void stripes inside, leaving FLOOR at cols 1, 3, 5, 7, 9, 11, 13
    [1, 2, 14, 2],
    [1, 4, 14, 4],
    [1, 6, 14, 6],
    [1, 10, 14, 10],
    [1, 12, 14, 12],
    [1, 14, 14, 14]
  ],
  floor: [
    // Restore the cross's row 8 horizontal bridge across the voids.
    [8, 1, 8, 14]
  ]
});

// ---------------------------------------------------------------------------
// Procedural chunk generator
//
// generateChunk(rng) returns a fresh `{map, heights}` chunk, picking one
// of several "biomes" (open arena, rooms, pillars, plateau, pits,
// terraced, stripes). Each biome composes random rect lists into the
// same buildTemplate pipeline used by the hand-authored templates, so
// the cross + connector + border invariants come for free.
//
// Every generated chunk is validated; on the rare validation failure
// (e.g., an elevation rule isolated a connector), we fall back to the
// plain cross so the world keeps streaming and never hangs.
// ---------------------------------------------------------------------------

/** Random integer in [lo, hi] inclusive. */
function randInt(rng, lo, hi) {
  return Math.floor(rng() * (hi - lo + 1)) + lo;
}

/** Force the central cross's heights back to 0 after an elevation pass. */
function flattenCrossElevations() {
  return [
    [CENTER, 0, CENTER, CHUNK_SIZE - 1, 0],
    [0, CENTER, CHUNK_SIZE - 1, CENTER, 0]
  ];
}

/** Random axis-aligned interior rectangle — clamped to rows/cols 1..14. */
function randRect(rng, minSize = 2, maxSize = 6) {
  const w = randInt(rng, minSize, maxSize);
  const h = randInt(rng, minSize, maxSize);
  const r0 = randInt(rng, 1, CHUNK_SIZE - 2 - h);
  const c0 = randInt(rng, 1, CHUNK_SIZE - 2 - w);
  return [r0, c0, r0 + h, c0 + w];
}

// --- Biome generators ------------------------------------------------------
// Each returns a template (via buildTemplate) seeded by `rng`. Tuned so the
// cross stays clean and elevations don't isolate connectors.

function biomeOpen(rng) {
  // Big central FLOOR room with a few small wall pillars protruding in.
  const margin = randInt(rng, 1, 3);
  const room = [margin, margin, CHUNK_SIZE - 1 - margin, CHUNK_SIZE - 1 - margin];
  return buildTemplate({ floor: [room] });
}

function biomeRooms(rng) {
  // 2-4 FLOOR rectangles scattered around. Cross corridors stitch them.
  const n = randInt(rng, 2, 4);
  const floor = [];
  for (let i = 0; i < n; i++) floor.push(randRect(rng, 2, 5));
  return buildTemplate({ floor });
}

function biomePillars(rng) {
  // FLOOR base + small wall pillars at deterministic-ish offsets. Lots
  // of vertical lines of sight.
  const room = [2, 2, 13, 13];
  // (No way to "add walls" via buildTemplate — we don't try; the default
  // background is WALL, and we only carve floor here. So this biome
  // becomes "two L-shaped rooms" instead. Keeps things varied.)
  const floor = [
    room,
    [randInt(rng, 1, 4), randInt(rng, 1, 4), randInt(rng, 6, 9), randInt(rng, 6, 9)]
  ];
  return buildTemplate({ floor });
}

function biomePlateau(rng) {
  // Large FLOOR area with one elevated patch (height 1 only — auto-step).
  // The cross is reset to 0 so connectors stay aligned with neighbours.
  const room = [randInt(rng, 1, 3), randInt(rng, 1, 3), randInt(rng, 11, 14), randInt(rng, 11, 14)];
  const elevateRect = randRect(rng, 3, 6);
  return buildTemplate({
    floor: [room],
    elevate: [[...elevateRect, 1], ...flattenCrossElevations()]
  });
}

function biomePits(rng) {
  // FLOOR base with a few small VOID pits. Voids touching the cross are
  // automatically bridged by the cross FLOOR pass in buildTemplate.
  const room = [2, 2, 13, 13];
  const pits = [];
  const n = randInt(rng, 2, 4);
  for (let i = 0; i < n; i++) {
    const r0 = randInt(rng, 2, 12);
    const c0 = randInt(rng, 2, 12);
    pits.push([r0, c0, r0 + randInt(rng, 0, 1), c0 + randInt(rng, 0, 1)]);
  }
  return buildTemplate({
    floor: [room, [CENTER, 0, CENTER, CHUNK_SIZE - 1], [0, CENTER, CHUNK_SIZE - 1, CENTER]],
    voids: pits
  });
}

function biomeTerraced(rng) {
  // Concentric rings stepping up by 1 each. Always passes auto-step BFS
  // because adjacent rings differ by exactly 1.
  const peakHeight = randInt(rng, 2, 4);
  const elevate = [];
  // Outer ring at h=1, next at h=2, etc, up to peakHeight.
  for (let h = 1; h <= peakHeight; h++) {
    const m = h + 2; // each ring shrinks by 1 tile per height
    elevate.push([m, m, CHUNK_SIZE - 1 - m, CHUNK_SIZE - 1 - m, h]);
  }
  return buildTemplate({
    floor: [[3, 3, 12, 12]],
    elevate: [...elevate, ...flattenCrossElevations()]
  });
}

function biomeStripes(rng) {
  // Alternating FLOOR rows or columns — maze-like horizontal or vertical
  // bands plus the cross.
  const horizontal = rng() < 0.5;
  const floor = [];
  if (horizontal) {
    for (let r = 2; r < CHUNK_SIZE - 2; r += 3) {
      floor.push([r, 1, r, CHUNK_SIZE - 2]);
    }
  } else {
    for (let c = 2; c < CHUNK_SIZE - 2; c += 3) {
      floor.push([1, c, CHUNK_SIZE - 2, c]);
    }
  }
  return buildTemplate({ floor });
}

// -------------------- Verticality biomes -----------------------------------
// These produce dramatic terrain — large mountains, deep valleys, long
// canyons, and jagged ridges. Each one keeps the central cross flat at
// h=0 so chunks tile together cleanly, and uses concentric stepping so
// auto-step traversal still works.

function biomeMountain(rng) {
  // A tall central peak rising from a flat floor. Concentric square
  // rings step up by 1 each. Cross stays flat (h=0) so connectors
  // align — the mountain is purely decorative on either side of the
  // cross corridor; the player can climb its lower slopes via auto-step
  // but can't reach the peak (that's the point — it's a mountain).
  const peakHeight = randInt(rng, 3, 5);
  const cx = CENTER + randInt(rng, -2, 2);
  const cy = CENTER + randInt(rng, -2, 2);
  const elevate = [];
  for (let h = 1; h <= peakHeight; h++) {
    // r=1 gives a 3x3 peak; r=peakHeight gives the largest base ring.
    const r = peakHeight - h + 1;
    elevate.push([cx - r, cy - r, cx + r, cy + r, h]);
  }
  return buildTemplate({
    floor: [[1, 1, 14, 14]],
    elevate: [...elevate, ...flattenCrossElevations()]
  });
}

function biomeValley(rng) {
  // Wide FLOOR ringed by an elevated rim, with the cross threading
  // through at h=0. Reads as "we're in a valley with high walls".
  const rimHeight = randInt(rng, 2, 4);
  const elevate = [];
  // Build ring elevations on the outer two-tile band.
  for (let h = 1; h <= rimHeight; h++) {
    const m = h; // outer rings highest, inner rings smallest
    elevate.push([m, m, m, CHUNK_SIZE - 1 - m, h]);              // top
    elevate.push([CHUNK_SIZE - 1 - m, m, CHUNK_SIZE - 1 - m, CHUNK_SIZE - 1 - m, h]); // bottom
    elevate.push([m, m, CHUNK_SIZE - 1 - m, m, h]);              // left
    elevate.push([m, CHUNK_SIZE - 1 - m, CHUNK_SIZE - 1 - m, CHUNK_SIZE - 1 - m, h]); // right
  }
  return buildTemplate({
    floor: [[1, 1, 14, 14]],
    elevate: [...elevate, ...flattenCrossElevations()]
  });
}

function biomeCanyon(rng) {
  // Long narrow canyon: a 2-tile void strip parallel to one cross axis,
  // with single-tile elevated rims on either side and the cross
  // bridging across at h=0. Floor is laid AROUND the canyon (not over
  // it), so the void survives and you can fall in.
  const horizontal = rng() < 0.5;
  const voids = [];
  const floor = [];
  const elevate = [];
  if (horizontal) {
    // Canyon is rows 5-6, full width.
    voids.push([5, 1, 6, 14]);
    // FLOOR everywhere except the canyon. Two bands.
    floor.push([1, 1, 4, 14]);
    floor.push([7, 1, 14, 14]);
    // Cross col 8 must bridge the void.
    floor.push([5, CENTER, 6, CENTER]);
    // Single-tile rim of h=1 on the canyon's edges.
    elevate.push([4, 1, 4, 14, 1]);
    elevate.push([7, 1, 7, 14, 1]);
  } else {
    voids.push([1, 5, 14, 6]);
    floor.push([1, 1, 14, 4]);
    floor.push([1, 7, 14, 14]);
    floor.push([CENTER, 5, CENTER, 6]);
    elevate.push([1, 4, 14, 4, 1]);
    elevate.push([1, 7, 14, 7, 1]);
  }
  return buildTemplate({
    voids,
    floor,
    elevate: [...elevate, ...flattenCrossElevations()]
  });
}

function biomeRidge(rng) {
  // Long elevated ridge running parallel to one cross axis, with steps
  // down on either side. Pacman can scale it via auto-step.
  const horizontal = rng() < 0.5;
  const peakHeight = randInt(rng, 2, 4);
  const elevate = [];
  for (let h = 1; h <= peakHeight; h++) {
    if (horizontal) {
      // band centered on a non-center row, stepping symmetrically
      const off = peakHeight - h + 1;
      elevate.push([3, off, 5, CHUNK_SIZE - 1 - off, h]); // upper ridge
      elevate.push([10, off, 12, CHUNK_SIZE - 1 - off, h]); // lower ridge
    } else {
      const off = peakHeight - h + 1;
      elevate.push([off, 3, CHUNK_SIZE - 1 - off, 5, h]);
      elevate.push([off, 10, CHUNK_SIZE - 1 - off, 12, h]);
    }
  }
  return buildTemplate({
    floor: [[1, 1, 14, 14]],
    elevate: [...elevate, ...flattenCrossElevations()]
  });
}

function biomeArchipelago(rng) {
  // Multiple small FLOOR islands separated by VOID. Cross threads them.
  // Looks like floating tiles in a dark sea.
  const floor = [];
  // Cross corridor floor (always FLOOR via cross-carve, but explicit
  // here to bridge any voids that overlap).
  floor.push([CENTER, 0, CENTER, CHUNK_SIZE - 1]);
  floor.push([0, CENTER, CHUNK_SIZE - 1, CENTER]);
  // 3-5 island rectangles in the four quadrants.
  const n = randInt(rng, 3, 5);
  for (let i = 0; i < n; i++) {
    const w = randInt(rng, 2, 4);
    const h = randInt(rng, 2, 4);
    const r0 = randInt(rng, 1, CHUNK_SIZE - 2 - h);
    const c0 = randInt(rng, 1, CHUNK_SIZE - 2 - w);
    floor.push([r0, c0, r0 + h, c0 + w]);
  }
  // Everything else stays as default WALL — but we want VOID instead.
  // Punch the entire interior to void first, then re-floor with the
  // islands and cross.
  return buildTemplate({
    voids: [[1, 1, 14, 14]],
    floor
  });
}

function biomeStaircase(rng) {
  // A long staircase climbing along one cross axis. Each tile-band
  // along the axis is one height higher than the last. Always passes
  // auto-step BFS because each tile-band is exactly 1 above its neighbour.
  const horizontal = rng() < 0.5;
  const peakHeight = randInt(rng, 3, 6);
  const elevate = [];
  // Build a stepped plateau on one half.
  if (horizontal) {
    const step = Math.floor((CHUNK_SIZE - 2) / peakHeight);
    for (let i = 0; i < peakHeight; i++) {
      const c0 = 1 + i * step;
      const c1 = Math.min(CHUNK_SIZE - 2, c0 + step - 1);
      elevate.push([1, c0, 7, c1, i + 1]);  // upper half stepping up
      elevate.push([9, c0, 14, c1, i + 1]); // lower half mirrored
    }
  } else {
    const step = Math.floor((CHUNK_SIZE - 2) / peakHeight);
    for (let i = 0; i < peakHeight; i++) {
      const r0 = 1 + i * step;
      const r1 = Math.min(CHUNK_SIZE - 2, r0 + step - 1);
      elevate.push([r0, 1, r1, 7, i + 1]);
      elevate.push([r0, 9, r1, 14, i + 1]);
    }
  }
  return buildTemplate({
    floor: [[1, 1, 14, 14]],
    elevate: [...elevate, ...flattenCrossElevations()]
  });
}

function biomeCrater(rng) {
  // Big central VOID pit (6x6) ringed by floor, with the cross
  // bridging the pit on its single-tile axes. We lay floor in the
  // four bands AROUND the pit instead of over it so the void survives.
  const rimHeight = randInt(rng, 1, 3);
  const elevate = [];
  // Outer rim band at increasing height the further from the pit.
  for (let h = 1; h <= rimHeight; h++) {
    elevate.push([h, h, h, CHUNK_SIZE - 1 - h, h]);              // top edge
    elevate.push([CHUNK_SIZE - 1 - h, h, CHUNK_SIZE - 1 - h, CHUNK_SIZE - 1 - h, h]); // bottom edge
    elevate.push([h, h, CHUNK_SIZE - 1 - h, h, h]);              // left edge
    elevate.push([h, CHUNK_SIZE - 1 - h, CHUNK_SIZE - 1 - h, CHUNK_SIZE - 1 - h, h]); // right edge
  }
  return buildTemplate({
    voids: [[5, 5, 10, 10]],
    floor: [
      [1, 1, 4, 14],   // top band
      [11, 1, 14, 14], // bottom band
      [5, 1, 10, 4],   // left band
      [5, 11, 10, 14], // right band
      // Single-tile cross bridges across the pit.
      [CENTER, 5, CENTER, 10],
      [5, CENTER, 10, CENTER]
    ],
    elevate: [...elevate, ...flattenCrossElevations()]
  });
}

// -------------------- Hazard biomes ----------------------------------------
// Each hazard biome stamps WATER / LAVA / MUD rects onto a normal FLOOR
// base. `stampHazard` keeps the central cross safe, so connector
// reachability is unconditionally preserved (the validator BFS only
// counts FLOOR cells anyway, and the cross is always FLOOR — disconnected
// FLOOR islands inside a hazard sea are tolerated as "isolated by
// hazard", same as VOID islands in `biomeArchipelago`).
//
// All hazard biomes are tagged with `.isHazard = true` and a
// `.minFarTiles` (mirrors `FRUIT_TYPES.minFarTiles` in fruit.js).
// `generateChunk` filters by these so easy mode + chunks near origin
// rarely produce hazards.

function biomeLake(rng) {
  // One large pool of WATER in a random quadrant. The cross still cuts
  // through the chunk so you can always walk past, but the lake offers
  // a tactical shortcut (or ghost-shortcut, since ghosts float).
  // Walls render as `ice` so the biome reads as a frozen pond visually.
  const topHalf = rng() < 0.5;
  const leftHalf = rng() < 0.5;
  const r0 = topHalf ? randInt(rng, 1, 3) : randInt(rng, 9, 11);
  const c0 = leftHalf ? randInt(rng, 1, 3) : randInt(rng, 9, 11);
  return buildTemplate({
    floor: [[1, 1, 14, 14]],
    hazards: {
      water: [[r0, c0, r0 + randInt(rng, 3, 5), c0 + randInt(rng, 3, 5)]]
    },
    wallKind: 'ice'
  });
}
biomeLake.isHazard = true;
biomeLake.minFarTiles = 20;

function biomeRiver(rng) {
  // 3-tile-wide WATER ribbon across one quadrant with FLOOR stepping
  // stones halfway across. The cross intersects perpendicularly so you
  // can always walk around if you don't want to wade.
  const horizontal = rng() < 0.5;
  const water = [];
  const floor = [[1, 1, 14, 14]];
  if (horizontal) {
    const row = rng() < 0.5 ? randInt(rng, 2, 4) : randInt(rng, 10, 12);
    water.push([row, 1, row + 2, 14]);
    const stoneC = randInt(rng, 3, 12);
    floor.push([row + 1, stoneC, row + 1, stoneC]);
  } else {
    const col = rng() < 0.5 ? randInt(rng, 2, 4) : randInt(rng, 10, 12);
    water.push([1, col, 14, col + 2]);
    const stoneR = randInt(rng, 3, 12);
    floor.push([stoneR, col + 1, stoneR, col + 1]);
  }
  return buildTemplate({ floor, hazards: { water } });
}
biomeRiver.isHazard = true;
biomeRiver.minFarTiles = 40;

function biomeLavaFlow(rng) {
  // 2 narrow LAVA stripes radiating from a corner. The cross is safe;
  // straying off-cross around a corner is suddenly very expensive.
  // Walls switch to `obsidian` for visual cohesion with the lava.
  const corner = randInt(rng, 0, 3);
  const lava = [];
  if (corner === 0) {
    lava.push([2, 2, 6, 3]);
    lava.push([2, 5, 3, 7]);
  } else if (corner === 1) {
    lava.push([2, 12, 6, 13]);
    lava.push([2, 9, 3, 11]);
  } else if (corner === 2) {
    lava.push([9, 2, 13, 3]);
    lava.push([12, 5, 13, 7]);
  } else {
    lava.push([9, 12, 13, 13]);
    lava.push([12, 9, 13, 11]);
  }
  return buildTemplate({
    floor: [[1, 1, 14, 14]],
    hazards: { lava },
    wallKind: 'obsidian'
  });
}
biomeLavaFlow.isHazard = true;
biomeLavaFlow.minFarTiles = 80;

function biomeVolcano(rng) {
  // Central elevated cone with LAVA pools in the four corners forming a
  // ground-level moat. Visually striking, and since lava blocks ghosts
  // the corners become Pacman-only score deposits. Walls render as
  // `obsidian` so the cone reads as volcanic rock.
  const peakHeight = randInt(rng, 2, 4);
  const elevate = [];
  for (let h = 1; h <= peakHeight; h++) {
    const r = peakHeight - h + 1;
    elevate.push([CENTER - r, CENTER - r, CENTER + r, CENTER + r, h]);
  }
  return buildTemplate({
    floor: [[1, 1, 14, 14]],
    hazards: {
      lava: [
        [1, 1, 3, 3],
        [1, 12, 3, 14],
        [12, 1, 14, 3],
        [12, 12, 14, 14]
      ]
    },
    elevate: [...elevate, ...flattenCrossElevations()],
    wallKind: 'obsidian'
  });
}
biomeVolcano.isHazard = true;
biomeVolcano.minFarTiles = 150;

function biomeSwamp(rng) {
  // Speckled MUD across the whole interior — no death, but everyone
  // (including ghosts) moves slowly. Acts as a "stalling zone" where
  // pellet collection feels safer than usual because ghosts can't
  // sprint at you.
  const mud = [];
  const n = randInt(rng, 5, 8);
  for (let i = 0; i < n; i++) {
    const r0 = randInt(rng, 1, 12);
    const c0 = randInt(rng, 1, 12);
    mud.push([r0, c0, r0 + randInt(rng, 1, 2), c0 + randInt(rng, 1, 2)]);
  }
  return buildTemplate({
    floor: [[1, 1, 14, 14]],
    hazards: { mud }
  });
}
biomeSwamp.isHazard = true;
biomeSwamp.minFarTiles = 0;

function biomeMixedHazard(rng) {
  // WATER + LAVA in opposite quadrants — forces a real route choice:
  //   - go through water (slow, breath cost)
  //   - go around the lava (long way)
  //   - or stay on the cross (safe, but you miss the off-cross pellets).
  const flip = rng() < 0.5;
  return buildTemplate({
    floor: [[1, 1, 14, 14]],
    hazards: {
      water: [flip ? [2, 2, 5, 5] : [2, 10, 5, 13]],
      lava: [flip ? [10, 10, 13, 13] : [10, 2, 13, 5]]
    }
  });
}
biomeMixedHazard.isHazard = true;
biomeMixedHazard.minFarTiles = 200;

const BIOMES = [
  biomeOpen,
  biomeRooms,
  biomePillars,
  biomePlateau,
  biomePits,
  biomeTerraced,
  biomeStripes,
  // Verticality biomes (mountains, valleys, canyons, ridges, …)
  biomeMountain,
  biomeValley,
  biomeCanyon,
  biomeRidge,
  biomeArchipelago,
  biomeStaircase,
  biomeCrater,
  // Hazard biomes (water, lava, mud — gated by distance + difficulty)
  biomeLake,
  biomeRiver,
  biomeLavaFlow,
  biomeVolcano,
  biomeSwamp,
  biomeMixedHazard
];

/**
 * Generate a fresh chunk template using a procedural biome. Returns a
 * `{ id, map, heights }` shape compatible with what `CHUNK_TEMPLATES`
 * holds, so callers don't need to special-case it.
 *
 * Two-stage gating runs before biome selection so easy mode + chunks
 * near origin rarely produce hazards even though the biome list has
 * grown:
 *   1. distance gate — biomes with `minFarTiles > opts.farTiles` are
 *      filtered out entirely. Hazards build up as you walk further.
 *   2. hazard weight — once eligible, the chunk "decides" whether it
 *      wants a hazard biome via a single rng() draw scaled by
 *      `opts.hazardMul` (world.effectiveHazardDensityMul()). When the
 *      draw fails, the safe-biome pool is used.
 *
 * @param {() => number} rng - mulberry32-style PRNG, seeded per chunk
 * @param {{ farTiles?: number, hazardMul?: number }} [opts]
 */
export function generateChunk(rng, opts = {}) {
  const farTiles = opts.farTiles ?? 0;
  const hazardMul = opts.hazardMul ?? 1.0;
  // Filter by distance gate.
  const eligible = BIOMES.filter((b) => (b.minFarTiles ?? 0) <= farTiles);
  const hazardPool = eligible.filter((b) => b.isHazard);
  const safePool = eligible.filter((b) => !b.isHazard);
  // Decide once whether this chunk wants a hazard. 0.4 base × hazardMul
  // means: at hazardMul=1.0 (normal at origin) ~40% of hazard-eligible
  // chunks become hazardous; on easy (0.35) ~14%, on hard far (≥1.6×1.5)
  // up to the 0.9 cap. Safe pool is otherwise picked from the existing
  // 14 non-hazard biomes (uniform).
  const wantsHazard = hazardPool.length > 0 && rng() < Math.min(0.9, hazardMul * 0.4);
  const pool = wantsHazard && hazardPool.length > 0 ? hazardPool : safePool;
  const biome = pool.length > 0 ? pool[Math.floor(rng() * pool.length)] : BIOMES[0];
  let tmpl;
  try {
    tmpl = biome(rng);
    if (!isValidChunk(tmpl)) tmpl = null;
  } catch (_e) {
    tmpl = null;
  }
  if (!tmpl) {
    // Fallback: hand-authored plain cross. Always valid.
    tmpl = T1;
  }
  return { id: `proc-${biome.name}`, ...tmpl };
}

/** Non-throwing validity check used by generateChunk's fallback path. */
function isValidChunk(template) {
  try {
    validate(template, 'procedural-check');
    return true;
  } catch (_e) {
    return false;
  }
}

// ---------------------------------------------------------------------------
// Validation (runs at module load — fail fast if a template is malformed)
// ---------------------------------------------------------------------------

function validate(template, name) {
  const { map, heights } = template;
  if (map.length !== CHUNK_SIZE) {
    throw new Error(`Template ${name} has ${map.length} rows, expected ${CHUNK_SIZE}`);
  }
  if (heights.length !== CHUNK_SIZE) {
    throw new Error(`Template ${name} heights has ${heights.length} rows`);
  }
  for (let r = 0; r < CHUNK_SIZE; r++) {
    if (map[r].length !== CHUNK_SIZE) {
      throw new Error(`Template ${name} map row ${r} length ${map[r].length}`);
    }
    if (heights[r].length !== CHUNK_SIZE) {
      throw new Error(`Template ${name} heights row ${r} length ${heights[r].length}`);
    }
  }
  // Connector cells must be FLOOR at height 0.
  const connectors = [
    [0, CENTER],
    [CHUNK_SIZE - 1, CENTER],
    [CENTER, 0],
    [CENTER, CHUNK_SIZE - 1]
  ];
  for (const [r, c] of connectors) {
    if (map[r][c] !== FLOOR) {
      throw new Error(`Template ${name} connector at (${r},${c}) is not FLOOR`);
    }
    if (heights[r][c] !== 0) {
      throw new Error(`Template ${name} connector at (${r},${c}) is not at height 0`);
    }
  }
  // Outer border (non-connectors) must remain WALL.
  for (let c = 0; c < CHUNK_SIZE; c++) {
    if (c === CENTER) continue;
    if (map[0][c] !== WALL) throw new Error(`Template ${name} top border breach at col ${c}`);
    if (map[CHUNK_SIZE - 1][c] !== WALL)
      throw new Error(`Template ${name} bottom border breach at col ${c}`);
  }
  for (let r = 0; r < CHUNK_SIZE; r++) {
    if (r === CENTER) continue;
    if (map[r][0] !== WALL) throw new Error(`Template ${name} left border breach at row ${r}`);
    if (map[r][CHUNK_SIZE - 1] !== WALL)
      throw new Error(`Template ${name} right border breach at row ${r}`);
  }
  // Auto-step BFS from the cross centre. Every FLOOR cell that's reachable
  // by walking (|Δh| ≤ 1 between adjacent FLOORs) must be reachable from
  // the centre. Disconnected FLOOR islands are allowed — they're unreachable
  // by design (decoration / future jump-only puzzles); we just record them
  // for visibility on the console rather than failing the build.
  const visited = Array.from({ length: CHUNK_SIZE }, () => Array(CHUNK_SIZE).fill(false));
  const queue = [[CENTER, CENTER]];
  visited[CENTER][CENTER] = true;
  while (queue.length) {
    const [r, c] = queue.shift();
    const h = heights[r][c];
    for (const [dr, dc] of [
      [-1, 0],
      [1, 0],
      [0, -1],
      [0, 1]
    ]) {
      const nr = r + dr;
      const nc = c + dc;
      if (nr < 0 || nr >= CHUNK_SIZE || nc < 0 || nc >= CHUNK_SIZE) continue;
      if (visited[nr][nc]) continue;
      if (map[nr][nc] !== FLOOR) continue;
      if (Math.abs(heights[nr][nc] - h) > 1) continue;
      visited[nr][nc] = true;
      queue.push([nr, nc]);
    }
  }
  // Every connector must be reachable from the centre by walking.
  for (const [r, c] of connectors) {
    if (!visited[r][c]) {
      throw new Error(`Template ${name} connector (${r},${c}) unreachable from cross centre`);
    }
  }
}

export const CHUNK_TEMPLATES = [
  { id: 'plain-cross', ...T1 },
  { id: 'open-quadrants', ...T2 },
  { id: 'ring-loop', ...T3 },
  { id: 'striped-horizontal', ...T4 },
  { id: 'striped-vertical', ...T5 },
  { id: 'center-atrium', ...T6 },
  { id: 't-pillars', ...T7 },
  { id: 'zigzag', ...T8 },
  { id: 'cliff-east', ...T9_CLIFF_EAST },
  { id: 'pit-cross', ...T10_PIT_CROSS },
  { id: 'terraced', ...T11_TERRACED },
  { id: 'moat', ...T12_MOAT },
  { id: 'bumpy', ...T13_BUMPY },
  { id: 'gauntlet', ...T14_GAUNTLET }
];

for (const t of CHUNK_TEMPLATES) validate(t, t.id);
