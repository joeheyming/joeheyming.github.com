/**
 * Tuning constants for the streamed Pacman world.
 *
 * Split out of world.js so the ghost-pool module can read them without
 * importing the World class itself (avoids a circular dependency) and
 * so the values that define survival pressure live in one focused file
 * instead of being scattered through a 1000-line class.
 */

export const DEFAULT_RENDER_RADIUS = 2; // chunks: 5x5 grid loaded around player
export const DEFAULT_UNLOAD_RADIUS = 3; // sweep boundary

// How many of the closest ghosts get BFS terrain-aware pathing each
// frame. The rest fall back to greedy nearest-neighbour selection. 3 is
// enough to make the immediate threat ring feel smart without paying
// BFS cost for ghosts the player can't even see yet.
export const BFS_NEAREST_GHOST_COUNT = 3;

// Active spawn rebalancing: if fewer than this many ghosts sit within
// chase radius of Pacman, the next spawn attempt uses a tightened
// min-spawn-distance (× this multiplier) so the world doesn't get a
// lull just because the previous chasers wandered off.
export const NEAR_GHOST_TARGET_FRACTION = 0.4; // 40% of cap should be "near"
export const NEAR_SPAWN_DIST_TIGHTEN = 0.5; // tightens minD when we're under target

// Tier 3 — distance-from-origin survival pressure. The further Pacman
// wanders from spawn, the deadlier the world becomes. `farPct` is a
// 0..1 progress scalar (game.js updates it each frame); the *_BOOST
// constants below define how much each system intensifies at full
// progression. All clamped at FAR_CAP_TILES so the curve eventually
// flattens — past that point the world is "fully hard" without going
// into infinity-mode.
export const FAR_CAP_TILES = 600;
export const FAR_GHOST_SPEED_BOOST = 0.4; // ×1.4 ghost speed at the cap
export const FAR_GHOST_COUNT_BOOST = 0.6; // ×1.6 ghost cap at the cap
export const FAR_HUNGER_BOOST = 0.6; // ×1.6 hunger drain at the cap
export const FAR_DOT_DENSITY_PENALTY = 0.7; // dotKeep × max(0.3, 1 − 0.7·farPct)
export const FAR_SCORE_MULT_MAX = 5; // 5× at the cap
export const FAR_SCORE_MULT_MIN = 1;
