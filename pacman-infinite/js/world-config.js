/**
 * world-config.js — Data-driven registries for the procedural world.
 *
 * One module for every "kind of thing the world has more than one of":
 *
 *   - HAZARDS        — hazard tile codes + Pacman/ghost effects + materials
 *   - METERS         — drain/refill timers (breath today; heat/cold tomorrow)
 *   - WALL_KINDS     — pluggable wall flavours (house, mountain, obsidian, …)
 *   - DEATH_MESSAGES — single source of truth for respawn-overlay copy
 *
 * Every consumer in the codebase looks up its behaviour through these
 * registries instead of hardcoded `if (tile === TILE.WATER)` branches.
 * Adding a fourth hazard, a sixth wall kind, or a third drain meter is
 * a single PR to THIS FILE plus zero or one runtime tweaks.
 *
 * Conventions:
 *   - Every entry has a stable string id used as a key in `Map` /
 *     CSS selector / save data. Don't rename ids after shipping.
 *   - Material specs are plain objects with the same shape as
 *     `THREE.MeshStandardMaterial`'s constructor — `world-assets.js`
 *     hydrates them at world-load time.
 *   - Numeric defaults are spelt out per entry so the lookup paths
 *     can read fields unconditionally.
 *   - Derive caches (`HAZARD_BY_CODE`, etc.) are built once at module
 *     load. Mutating the registries at runtime is unsupported.
 */

// ---------------------------------------------------------------------------
// HAZARDS — tile codes 7+ that have side-effects beyond "walkable surface".
// ---------------------------------------------------------------------------
//
// Shape:
//   id:        registry key (also used as CSS class hook, save key, mesh
//              slot key inside chunks).
//   tileCode:  numeric `TILE.X` value the templates / chunks store.
//   pacman:
//     speedMul:    multiplier applied to PACMAN_SPEED when standing on it.
//                  Defaults to 1.0 (no slowdown).
//     lethal:      true → step on it = die(deathCause). Defaults to false.
//     deathCause:  cause string for `pacman.die()` when lethal. Required if
//                  `lethal: true`; ignored otherwise. See DEATH_MESSAGES.
//     drainMeter:  optional METERS id to drain while standing on this tile.
//                  Used for "you can be here briefly but not forever"
//                  (water → breath drain → drown).
//   ghost:
//     speedMul:    multiplier applied to GHOST_SPEED when on this tile.
//                  Defaults to 1.0.
//     blocked:     true → ghosts cannot enter (impassable). Defaults to
//                  false. Used by both `world.isGhostPassable` and the
//                  BFS frontier check in `ghost.js`.
//   material:    plain THREE.MeshStandardMaterial-shaped spec. Hydrated
//                once by `world-assets.js#createSharedAssets`.
//   slabThickness: fraction of `scale` for the visible slab. Top of the
//                  slab sits at `h * scale + 0.02`; bottom at
//                  `h * scale - slabThickness * scale + 0.02`. Pick a
//                  larger value to make the hazard look like a sunken
//                  pool (water/lava use 0.5 → half-tile-deep pit). Pick
//                  a small value (0.1–0.2) to make it look like a flat
//                  puddle (mud). Defaults to 0.18.
//   pacmanSink:    how far Pacman's render group dips into the slab when
//                  he stands on it, in tile units (multiplied by scale
//                  at apply time). 0 = no dip (mud). 0.5 = half-tile
//                  dip (water/lava — "wading at chest level" look).
//                  Visual only; `position.z` / pathing untouched.
//   minFarTilesHint: documentation-only — biomes that use this hazard
//                    usually gate to roughly this distance. Not enforced
//                    here (biome `.minFarTiles` is the real gate).
//
export const HAZARDS = {
  water: {
    id: 'water',
    tileCode: 7,
    pacman: { speedMul: 0.55, lethal: false, drainMeter: 'breath' },
    ghost: { speedMul: 1.0, blocked: false },
    material: {
      color: 0x3aa6ff,
      transparent: true,
      opacity: 0.7,
      roughness: 0.25,
      metalness: 0.1,
      emissive: 0x1a4a80,
      emissiveIntensity: 0.35
    },
    // Water + lava are "hollow blocks you fall into" rather than thin
    // wet surfaces — slabThickness=0.5 means the column extends half a
    // tile below the surrounding floor, and pacmanSink=0.5 dips Pacman
    // visually into it so he reads as wading half-submerged.
    slabThickness: 0.5,
    pacmanSink: 0.5,
    minFarTilesHint: 20
  },
  lava: {
    id: 'lava',
    tileCode: 8,
    pacman: { speedMul: 1.0, lethal: true, deathCause: 'lava' },
    ghost: { speedMul: 1.0, blocked: true },
    material: {
      color: 0xff5d2e,
      emissive: 0xff8030,
      emissiveIntensity: 0.9,
      roughness: 0.5,
      metalness: 0.0
    },
    // Lava is a sunken pit too — visually a more menacing pool than a
    // thin lava smear. pacmanSink is moot (lava kills instantly so
    // Pacman never actually stands in it), but kept consistent with
    // water for the symmetric look.
    slabThickness: 0.5,
    pacmanSink: 0.5,
    minFarTilesHint: 80
  },
  mud: {
    id: 'mud',
    tileCode: 9,
    pacman: { speedMul: 0.6, lethal: false },
    ghost: { speedMul: 0.6, blocked: false },
    material: {
      color: 0x6b4a2b,
      roughness: 0.95,
      metalness: 0.0,
      emissive: 0x2a1a08,
      emissiveIntensity: 0.15
    },
    // Mud stays a flat surface puddle — "splashy ground" rather than
    // "pool you fall into". No pacmanSink; thin slab on top of floor.
    slabThickness: 0.18,
    pacmanSink: 0,
    minFarTilesHint: 0
  }
};

/** Tile-code → spec, derived once. O(1) lookup on every movement step. */
export const HAZARD_BY_CODE = new Map();
for (const spec of Object.values(HAZARDS)) {
  HAZARD_BY_CODE.set(spec.tileCode, spec);
}

/** Set of all hazard tile codes — used by `templates.js` to skip the cross. */
export const HAZARD_TILE_CODES = new Set(HAZARD_BY_CODE.keys());

/** id → tileCode, for templates.js#buildTemplate to map keyed rect lists. */
export const HAZARD_CODE_BY_ID = new Map();
for (const spec of Object.values(HAZARDS)) {
  HAZARD_CODE_BY_ID.set(spec.id, spec.tileCode);
}

// ---------------------------------------------------------------------------
// METERS — drain/refill timers with optional kill-on-zero.
// ---------------------------------------------------------------------------
//
// Shape:
//   id:           registry key. game-state's _meters Map and game-hud's
//                 _refreshMetersHud loop key off this.
//   max:          full-meter value (seconds).
//   drainPerS:    rate while the meter is "active" (i.e. an active
//                 hazard wants this meter to drain). 1.0 means "1 s of
//                 active state = 1 s of meter loss".
//   refillPerS:   rate while inactive. Higher than drain → forgiving;
//                 lower → punitive (a dip costs more breath than you
//                 recover walking it off).
//   deathCause:   cause string for `_loseLife()` when the meter hits 0.
//                 Must have a corresponding DEATH_MESSAGES entry.
//   hudId:        DOM id of the outer `<div>` (visibility toggle target).
//   hudBarId:     DOM id of the inner bar (width target).
//   label:        text shown above the bar.
//   lowFrac:      when `value < lowFrac * max`, the meter gets a `.low`
//                 class for CSS pulse warnings (matches the food bar's
//                 FOOD_LOW_THRESHOLD pattern).
//
export const METERS = {
  breath: {
    id: 'breath',
    max: 3.0,
    drainPerS: 1.0,
    refillPerS: 2.0,
    deathCause: 'drown',
    hudId: 'breath-meter',
    hudBarId: 'breath-bar',
    label: 'BREATH',
    lowFrac: 0.25
  }
};

// ---------------------------------------------------------------------------
// WALL_KINDS — pluggable wall flavours. Selection is by:
//   1. chunk.wallKind override (set by a biome that wants a specific look)
//   2. fallback: first kind whose stackRange contains the tile's stack height
//   3. last-resort: the entry tagged `default: true`
// ---------------------------------------------------------------------------
//
// Shape:
//   id:          registry key.
//   stackRange:  [min, max] inclusive of stack-units (`heights[ly][lx] + 1`
//                for walls). Used by the height-based fallback when no
//                explicit wall kind is requested.
//   material:    THREE.MeshStandardMaterial-shaped spec. If `textureId` is
//                set, the texture is bound to BOTH `map` and `emissiveMap`
//                at hydrate time (matches the existing windowed-house
//                behaviour).
//   textureId:   optional id of a procedural canvas texture built in
//                world-assets.js. Today only 'building-windows' exists.
//   repeatVerticalUV: when true (e.g. for windowed houses), chunk.buildWalls
//                     scales side-face V coords by stackUnits so the
//                     texture repeats once per tile-unit of height.
//   default:     true for the fallback-of-last-resort entry. Exactly one
//                kind should set this — used when no height range matches.
//
export const WALL_KINDS = {
  house: {
    id: 'house',
    stackRange: [1, 2],
    textureId: 'building-windows',
    repeatVerticalUV: true,
    material: {
      color: 0xffffff,
      roughness: 0.6,
      metalness: 0.05,
      emissive: 0xffffff,
      emissiveIntensity: 0.35
    }
  },
  mountain: {
    id: 'mountain',
    stackRange: [3, 99],
    material: {
      color: 0x55607a,
      roughness: 0.95,
      metalness: 0.0,
      emissive: 0x111722,
      emissiveIntensity: 0.2
    },
    default: true
  },
  obsidian: {
    id: 'obsidian',
    // Volcano + lavaflow biomes use this regardless of stack height; no
    // fallback selection wants it, so stackRange is intentionally empty.
    stackRange: [1, 99],
    material: {
      color: 0x0a0510,
      roughness: 0.35,
      metalness: 0.4,
      emissive: 0xff3010,
      emissiveIntensity: 0.5
    }
  },
  ice: {
    id: 'ice',
    stackRange: [1, 99],
    material: {
      color: 0xb8e6ff,
      transparent: true,
      opacity: 0.85,
      roughness: 0.15,
      metalness: 0.2,
      emissive: 0x6090c0,
      emissiveIntensity: 0.3
    }
  },
  glass: {
    id: 'glass',
    stackRange: [1, 99],
    material: {
      color: 0x88ccff,
      transparent: true,
      opacity: 0.4,
      roughness: 0.05,
      metalness: 0.6,
      emissive: 0x4488ff,
      emissiveIntensity: 0.4
    }
  }
};

/**
 * Set of wall-kind ids that participate in the height-based fallback
 * selection. Override-only kinds (obsidian/ice/glass) are excluded so
 * a generic 3-tile-tall wall in a non-volcanic biome still picks
 * `mountain`, not `obsidian`. To make a new kind default-eligible,
 * add its id here AND give it a non-overlapping `stackRange`.
 */
export const FALLBACK_WALL_KIND_IDS = new Set(['house', 'mountain']);

/** Default kind id — looked up at boot, used when no other rule matches. */
export const DEFAULT_WALL_KIND_ID = (() => {
  for (const k of Object.values(WALL_KINDS)) if (k.default) return k.id;
  return 'mountain';
})();

/**
 * Pick the wall kind id to use for a tile.
 *   - `override` wins (biome opt-in).
 *   - Otherwise pick the first FALLBACK-eligible kind whose stackRange
 *     contains stackUnits.
 *   - Fall back to DEFAULT_WALL_KIND_ID.
 *
 * Kept here (not in chunk.js) so adding a new kind doesn't require
 * touching the rendering code.
 */
export function pickWallKindId(stackUnits, override) {
  if (override && WALL_KINDS[override]) return override;
  for (const kind of Object.values(WALL_KINDS)) {
    if (!FALLBACK_WALL_KIND_IDS.has(kind.id)) continue;
    const [lo, hi] = kind.stackRange;
    if (stackUnits >= lo && stackUnits <= hi) return kind.id;
  }
  return DEFAULT_WALL_KIND_ID;
}

// ---------------------------------------------------------------------------
// DEATH_MESSAGES — overlay copy keyed by death cause string.
// ---------------------------------------------------------------------------
//
// Every `_loseLife(cause)` / `die(cause)` call site must use a cause that
// has an entry here, or the overlay falls back to a generic message.
//
// Causes come from three sources:
//   1. Built-in: 'ghost', 'starvation', 'void'.
//   2. Hazard tiles: spec.pacman.deathCause (e.g. 'lava').
//   3. Meter exhaustion: meter.deathCause (e.g. 'drown').
//
export const DEATH_MESSAGES = {
  ghost: {
    title: 'A GHOST GOT YOU',
    flavour: 'Grab a power pill to fight back.',
    final: 'A ghost got you.'
  },
  starvation: {
    title: 'YOU STARVED',
    flavour: 'Eat more pellets to keep your hunger up.',
    final: 'You starved.'
  },
  void: {
    title: 'FELL INTO THE VOID',
    flavour: 'Stay on solid ground.',
    final: 'You fell into the void.'
  },
  lava: {
    title: 'BURNED IN LAVA',
    flavour: 'Lava kills on contact. Walk around it.',
    final: 'You burned in lava.'
  },
  drown: {
    title: 'YOU DROWNED',
    flavour: 'Wade fast — water is only safe for a few seconds.',
    final: 'You drowned.'
  }
};

/**
 * Look up overlay copy with a graceful default. Always returns a
 * `{ title, flavour, final }` object so callers can read fields
 * unconditionally.
 */
export function getDeathMessage(cause) {
  return DEATH_MESSAGES[cause] || DEATH_MESSAGES.ghost;
}
