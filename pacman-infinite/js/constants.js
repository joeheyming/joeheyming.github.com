/**
 * Game Constants
 * Central location for all magic numbers and shared enums
 */

// =============================================================================
// DIRECTION - Shared across pacman.js, controls.js, and ghost.js
// =============================================================================
export const DIRECTION = {
  NONE: 'none',
  UP: 'up',
  DOWN: 'down',
  LEFT: 'left',
  RIGHT: 'right'
};

// =============================================================================
// KEY MODES - Movement control schemes
// =============================================================================
export const KEY_MODE = {
  ROTATE: 0, // L/R rotate, U/D move forward/back
  STRAFE: 1, // L/R strafe, U/D move forward/back (FPS style)
  PERP: 2 // L/R/U/D move in world directions (classic Pacman)
};

// =============================================================================
// CAMERA MODES
// =============================================================================
export const CAMERA_MODE = {
  // Strategic top-down view: camera looks straight down at Pacman from
  // high above. Repurposed from the original "Bird's Eye" — in the
  // infinite world there's no fixed level center, so this slot becomes
  // the high-altitude tactical view instead.
  BIRDSEYE: 0,
  // Default follow cam: tilted overhead behind Pacman, close in.
  BIRDSEYE_FOLLOW: 1,
  // First-person, mouse-look.
  FPPOV: 2
};

export const CAMERA_MODE_NAMES = ['Top-Down', 'Follow', 'First Person'];

// =============================================================================
// DIFFICULTY
// =============================================================================
//
// Each difficulty level scales a small set of base values (hunger drain,
// ghost speed/count/range, fruit spawn cadence). The base values live in
// GAMEPLAY below; the multipliers here are what the runtime actually
// reads at the start of every frame. Keeps the tuning in one place and
// avoids sprinkling `if (hard) ...` checks across the codebase.
//
// EASY:  forgiving — slower hunger, fewer/slower ghosts, fruit comes faster.
// NORMAL: the original tuning the game shipped with.
// HARD:  punitive — faster hunger, more aggressive ghosts, fruit is rare.
//
// The chosen difficulty persists in localStorage; Continue uses the last
// pick automatically, NEW GAME inherits whichever mode the menu showed.
//
export const DIFFICULTY = {
  EASY: 'easy',
  NORMAL: 'normal',
  HARD: 'hard'
};

// Each preset folds five families of multipliers/overrides:
//   - hungerDrainMul        — speeds up / slows down the food-meter clock
//   - ghostSpeedMul         — applied to GHOST_SPEED. On Hard this now sits
//                             ABOVE Pacman's speed so a straight-line chase
//                             actually catches him (was 1.15 → ~39 u/s vs
//                             Pacman's 40; bumped to 1.25 → ~42.5).
//   - ghostCountMul         — soft cap on the live ghost pool
//   - ghostChaseRadiusMul   — how early ghosts notice Pacman
//   - fruitSpawnPeriodMul   — wider/narrower fruit cadence
//   - dotKeepMul            — how dense pellets are per chunk
//   - powerModeDurationS    — *absolute* power-pill window (not a multiplier
//                             — the game previously used the flat 8 s
//                             constant which made power pills equally
//                             generous on every difficulty)
//   - fleeSpeedMul          — speed of fleeing ghosts during power mode.
//                             Higher = harder to catch them, less of a
//                             free combo on Hard.
//   - jumpCooldownMul       — multiplies PACMAN_JUMP_COOLDOWN. Hard mode
//                             rations jumps so the player can't spam the
//                             "I'm invulnerable while airborne" loophole.
//   - ghostMinSpawnDistMul  — multiplies GHOST_MIN_SPAWN_DIST_TILES so
//                             Hard ghosts can pop in closer (more "around
//                             the corner" surprises).
export const DIFFICULTY_PRESETS = {
  easy: {
    label: 'Easy',
    hungerDrainMul: 0.7,
    ghostSpeedMul: 0.85,
    ghostCountMul: 0.6,
    ghostChaseRadiusMul: 0.8,
    fruitSpawnPeriodMul: 0.7, // shorter interval = more fruit
    dotKeepMul: 1.6, // more pellets per chunk
    powerModeDurationS: 10,
    fleeSpeedMul: 0.5,
    jumpCooldownMul: 0.8,
    ghostMinSpawnDistMul: 1.3,
    foodPerDotMul: 1.2 // more nourishment per dot — easy is forgiving
  },
  normal: {
    label: 'Normal',
    hungerDrainMul: 1.0,
    ghostSpeedMul: 1.0,
    ghostCountMul: 1.0,
    ghostChaseRadiusMul: 1.0,
    fruitSpawnPeriodMul: 1.0,
    dotKeepMul: 1.0,
    powerModeDurationS: 8,
    fleeSpeedMul: 0.6,
    jumpCooldownMul: 1.0,
    ghostMinSpawnDistMul: 1.0,
    foodPerDotMul: 1.0
  },
  hard: {
    label: 'Hard',
    hungerDrainMul: 1.45,
    ghostSpeedMul: 1.25, // above Pacman speed → straight-line chase catches him
    ghostCountMul: 1.4,
    ghostChaseRadiusMul: 1.25,
    fruitSpawnPeriodMul: 1.25, // longer interval = less fruit (was 1.6 — too punishing on top of base nerf)
    dotKeepMul: 0.5, // fewer pellets per chunk
    powerModeDurationS: 5,
    fleeSpeedMul: 0.85,
    jumpCooldownMul: 2.4,
    ghostMinSpawnDistMul: 0.7,
    foodPerDotMul: 0.5 // grazing your way to immortality is no longer viable
  }
};

// =============================================================================
// GAME STATES
// =============================================================================
export const GAME_STATES = {
  START: 'start',
  INTRO: 'intro',
  PLAYING: 'playing',
  PAUSED: 'paused',
  DEATH: 'death',
  GAME_OVER: 'game_over',
  WIN: 'win'
};

// =============================================================================
// GHOST STATES
// (Phase 3 uses WANDER/CHASE/FLEE/EATEN; the older SCATTER/SCARED/DEAD/HOME
//  values are kept for compatibility with the original /pacman/ port.)
// =============================================================================
export const GHOST_STATE = {
  WANDER: 'wander',
  CHASE: 'chase',
  FLEE: 'flee',
  EATEN: 'eaten',
  // Legacy aliases — referenced only by the older single-maze game code.
  SCATTER: 'scatter',
  SCARED: 'scared',
  DEAD: 'dead',
  HOME: 'home'
};

// =============================================================================
// GHOST TYPES (by color)
// =============================================================================
export const GHOST_TYPE = {
  BLINKY: 0xff0000, // Red - direct chaser
  INKY: 0x00ffff, // Cyan - unpredictable
  PINKY: 0xffb8ff, // Pink - ambusher
  CLYDE: 0xffb852 // Orange - shy/random
};

export const GHOST_COLORS = [
  GHOST_TYPE.BLINKY,
  GHOST_TYPE.INKY,
  GHOST_TYPE.PINKY,
  GHOST_TYPE.CLYDE
];

// =============================================================================
// TILE TYPES - Level map values
// =============================================================================
export const TILE = {
  VOID: 0,
  FLOOR: 1,
  WALL: 2,
  GHOST_HOME: 3,
  TELEPORT: 4,
  POWER_PILL: 5,
  PACMAN_START: 6
};

// =============================================================================
// GAMEPLAY CONSTANTS
// =============================================================================
export const GAMEPLAY = {
  // Pacman
  PACMAN_SPEED: 40, // units per second
  PACMAN_ROTATE_SPEED: 150, // degrees per second for mouse look
  PACMAN_MOUTH_MAX_ANGLE: 45, // degrees
  PACMAN_MOUTH_SPEED: 300, // degrees per second

  // Pacman terrain + jump (Phase 2a)
  PACMAN_STEP_LERP_SPEED: 30, // tile-units per second when auto-stepping ±1
  PACMAN_JUMP_HEIGHT: 1, // peak hop in tile-units (Pac-Mania-style short hop)
  PACMAN_JUMP_DURATION: 0.4, // seconds for a full jump arc
  PACMAN_JUMP_COOLDOWN: 0.5, // seconds after landing before another jump
  PACMAN_RESPAWN_DELAY: 1.0, // seconds after death before respawn (void fall)
  PACMAN_DEATH_ANIM_DURATION: 1.5, // seconds for the classic spin+shrink death animation (ghost kill)

  // Ghosts (Phase 3) — Minecraft-style: a small live pool around the
  // player, spawned at random walkable tiles outside a safety radius and
  // despawned once the player walks too far away. Counts and timings keep
  // the population organic without overloading memory.
  GHOST_SPEED: 34, // units per second — a hair slower than Pacman so you can outpace them on a clean run
  GHOST_HOME_SPEED: 60, // speed when returning home after being eaten (unused in v3 spawning, kept for legacy)
  GHOST_FLEE_SPEED_MULTIPLIER: 0.6, // ×GHOST_SPEED when in FLEE state (power mode)
  GHOST_TURN_PERIOD: 0.4, // seconds between AI re-decisions in WANDER state
  GHOST_CHASE_RADIUS: 8, // tiles — pacman within this distance triggers CHASE
  GHOST_LEAVE_CHASE_RADIUS: 12, // tiles — hysteresis so ghosts don't oscillate in/out of CHASE
  GHOST_DESPAWN_DELAY: 0.4, // seconds an EATEN ghost stays absent before disposing
  GHOST_SCATTER_DURATION: 7, // seconds in scatter mode (legacy, unused in phase 3)
  GHOST_CHASE_DURATION: 20, // seconds in chase mode (legacy, unused in phase 3)
  // Ghost spawning (Minecraft-ish)
  GHOST_TARGET_COUNT: 10, // soft cap on live ghosts around the player
  GHOST_MIN_SPAWN_DIST_TILES: 7, // never spawn within this many tiles of Pacman
  GHOST_MAX_SPAWN_DIST_TILES: 22, // never spawn farther than this (avoids spawning behind unloaded edges)
  GHOST_CULL_DIST_TILES: 30, // ghosts farther than this from Pacman are despawned
  GHOST_SPAWN_INTERVAL_MIN: 1.5, // seconds — fastest re-roll of "should we spawn another?"
  GHOST_SPAWN_INTERVAL_MAX: 6.0, // seconds — slowest, gives a "calm period" feeling

  // Power mode (Phase 3)
  POWER_MODE_DURATION: 8, // seconds — Pacman is dangerous to flee ghosts during this window

  // Fruits — cadence retuned 2026-05 because players reported "I never
  // see fruits". Old values were 18/45 s × difficulty mul, with 15 s
  // lifetime, capped to one fruit at a time → on Hard you'd see a
  // fruit roughly every 60–90 seconds, way too sparse to feel like a
  // real reward loop. New values keep the upper-end pacing slow enough
  // that fruit still feels special, but the *typical* gap is short
  // enough that any 30-second play burst will hit one.
  FRUIT_SPAWN_PERIOD_MIN: 8, // seconds — fastest interval before next fruit spawns
  FRUIT_SPAWN_PERIOD_MAX: 20, // seconds — slowest interval; actual spawn time is uniform in [min, max]
  FRUIT_LIFETIME: 25, // seconds before an unclaimed fruit despawns
  FRUIT_SPAWN_MIN_DIST_TILES: 3, // never spawn directly under the player's feet
  FRUIT_SPAWN_MAX_DIST: 2, // chunks from Pacman to consider when picking a spawn site
  // Legacy alias for any external callers; the runtime uses MIN/MAX above.
  FRUIT_SPAWN_PERIOD: 14,

  // Scoring (Phase 3)
  SCORE_DOT: 10,
  SCORE_POWER_PILL: 50,
  SCORE_FRUIT: 100,
  SCORE_GHOST_BASE: 200, // doubles per chained ghost (200, 400, 800, 1600) within a single power window
  SCORE_GHOST: 200, // legacy alias

  // Starting lives
  STARTING_LIVES: 3,

  // Food meter (Minecraft-style hunger). Pellets keep you alive; fruit
  // is a bigger reward; eating ghosts costs you food (you bit something
  // chewy). Hitting 0 triggers a starvation death (same animation as
  // a ghost kill — losing a life and respawning).
  //
  // Tuning rationale:
  //   - drain 1.5 u/s → 67 seconds from full (100) to starvation if you eat nothing
  //   - dot gives 1.5 → eating 1 dot per second exactly balances drain
  //   - power pill gives 25 → ~17 seconds of fuel (rare, big buffer)
  //   - fruit gives 40 → ~27 seconds of fuel ("fruit is like better")
  //   - ghost penalty -15 → still net-positive due to score, but a tactical cost
  //   - respawn refills to 60 (not full) so a starvation loop is at least
  //     theoretically possible if the player keeps avoiding food
  FOOD_MAX: 100,
  FOOD_START: 100,
  FOOD_RESPAWN: 60,
  FOOD_DRAIN_RATE: 1.8, // base; multiplied by DIFFICULTY_PRESETS[*].hungerDrainMul
  FOOD_PER_DOT: 1.5,
  FOOD_PER_POWER_PILL: 25,
  // Tier 3 — eating a power pill ALSO costs you food on activation
  // (-10), so net food gain is +15 instead of +25. Stops "stack pills
  // for free score" loops without making the pill itself feel
  // worthless. Negative value (subtracted from the +25 in game-spawn).
  FOOD_POWER_PILL_COST: -10,
  FOOD_PER_FRUIT: 40,
  FOOD_GHOST_PENALTY: 15,
  // Tier 4 — every jump now costs 2 food. Jump-spamming as a free
  // panic-evade is the loophole this closes (the smaller arc i-frame
  // window from Tier 1 already made jumps less spammable; the food
  // cost finishes the job by tying jumps to your hunger budget).
  FOOD_PER_JUMP: 2,
  // Sprint costs more than a jump because it gives you ~1.5 s of
  // ghost-outrunning speed. ~5 food = roughly half a dot streak's
  // worth of resource so you can't spam it as a panic button. Tier 1.
  FOOD_PER_SPRINT: 5,
  FOOD_LOW_THRESHOLD: 30, // below this, the food bar pulses red (warning)

  // -------- Sprint (Tier 5: "double-tap to dash") -------------------------
  // Pacman's base speed (40 u/s) sits a hair above Ghost speed (34 u/s)
  // base. With distance + Hard mods, ghosts hit ~42 u/s — they catch up.
  // Sprint at 1.6× = 64 u/s gives the player a clear escape margin
  // (and a chance to CHASE a fleeing ghost during power mode), but
  // only for SPRINT_DURATION_S, after which a SPRINT_COOLDOWN_S
  // cooldown blocks re-entry. The food cost (FOOD_PER_SPRINT above)
  // adds an economic limiter on top of the time-based one.
  SPRINT_SPEED_MUL: 1.6,
  SPRINT_DURATION_S: 1.5,
  SPRINT_COOLDOWN_S: 3.0,
  // Double-tap detection window (ms). Same key (e.g. ArrowUp twice)
  // pressed within this many ms triggers a sprint. Long enough that a
  // panicked player can hit it twice without sub-150ms reflexes,
  // short enough that two intentional taps in a row don't trigger.
  SPRINT_DOUBLE_TAP_MS: 280,

  // Collision
  COLLISION_RADIUS_MULTIPLIER: 1.5, // for dot collection
  GHOST_COLLISION_PADDING: 2, // additional radius for ghost collision

  // FPS danger warning
  DANGER_WARNING_RADIUS: 5 // tiles distance to trigger warning
};

// =============================================================================
// CAMERA CONSTANTS
// =============================================================================
export const CAMERA = {
  VIEWING_ANGLE: 25, // degrees - tilt angle for overhead views
  FOV: 60, // field of view
  NEAR_PLANE: 1,
  FAR_PLANE: 500,
  LERP_BIRDSEYE: 0.05,
  LERP_FOLLOW: 0.1,
  LERP_FPS: 0.5,
  ZOOM_MIN: 0.3,
  ZOOM_MAX: 2.0,
  ZOOM_SPEED: 0.05
};

// =============================================================================
// AUDIO CONSTANTS
// =============================================================================
export const AUDIO = {
  DEFAULT_VOLUME: 0.5,
  CHOMP_POOL_SIZE: 3, // number of chomp sounds to pool
  SOUND_FILES: {
    chomp: 'assets/sounds/chomp.wav',
    powerPill: 'assets/sounds/power-pill.wav',
    ghostEaten: 'assets/sounds/ghost-eaten.wav',
    death: 'assets/sounds/death.wav',
    start: 'assets/sounds/start.wav'
  }
};

// =============================================================================
// ANIMATION CONSTANTS
// =============================================================================
export const ANIMATION = {
  DEATH_DURATION: 1500, // ms
  DEATH_CAMERA_TRANSITION: 0.5, // seconds
  DEATH_CAMERA_ORBIT_SPEED: 1.5, // radians per second
  DEATH_CAMERA_HEIGHT: 50,
  DEATH_CAMERA_ORBIT_RADIUS: 25,
  POWER_PILL_PULSE_SPEED: 5, // for sine wave
  TELEPORT_PULSE_SPEED: 3,
  SCARED_BLINK_INTERVAL: 0.2 // seconds
};

// =============================================================================
// MINIMAP CONSTANTS
// =============================================================================
export const MINIMAP = {
  VIEW_RADIUS: 7, // tiles around player to show
  COLORS: {
    background: 'rgba(0, 0, 0, 0.8)',
    wall: '#1a1aff',
    floor: '#1a1a2e',
    void: '#000000',
    ghostHome: '#8b0000',
    teleport: '#00ff88',
    player: '#ffff00',
    ghost: '#ff0000',
    ghostScared: '#00ffff',
    dot: '#ffffaa',
    powerPill: '#ffaaff'
  }
};

// =============================================================================
// CONTROLS CONSTANTS
// =============================================================================
export const CONTROLS = {
  MOUSE_SENSITIVITY: 0.3,
  MAX_PITCH: 89, // degrees - prevent camera flip
  FPS_PITCH_CLAMP: 30 // max pitch when entering FPS mode
};
