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
  BIRDSEYE: 0, // Fixed overhead view of entire map
  BIRDSEYE_FOLLOW: 1, // Overhead centered on Pacman
  FPPOV: 2 // First person point of view (Doom-style)
};

export const CAMERA_MODE_NAMES = ["Bird's Eye", 'Follow', 'First Person'];

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
// =============================================================================
export const GHOST_STATE = {
  CHASE: 'chase',
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
  PACMAN_START: 6,
  FRUIT_SPAWN: 7
};

// =============================================================================
// LEVEL PROGRESSION
// =============================================================================
// Order players advance through when the "NEXT LEVEL" button is pressed or
// when they finish a level. `level0` is the arcade-style intro, then the
// numbered originals. Add new levels here to make them part of the linear
// run-through; ad-hoc levels can still be loaded via ?level=name.
export const LEVEL_ORDER = [
  'level0',
  'level1',
  'level2',
  'level3',
  'level4',
  'level5',
  // Multi-island levels using 'next'-mode teleport groups. level6 is a
  // gentle 4-way cycle (small islands); level7 is the difficulty spike —
  // bigger islands, denser mazes, three-way cycle, 2 ghosts in the
  // gauntlet island.
  'level6',
  'level7'
];

// =============================================================================
// FRUIT TYPES (Ms. Pac-Man style bonus items, classic spawn rules)
// =============================================================================
// Indexed by current level number — higher levels show higher-score fruit.
// Color is a hex int for the 3D mesh; emoji is the HUD glyph.
export const FRUIT_TYPES = [
  { name: 'cherry', color: 0xff2222, score: 100, emoji: '🍒' },
  { name: 'strawberry', color: 0xff66aa, score: 300, emoji: '🍓' },
  { name: 'orange', color: 0xff9933, score: 500, emoji: '🍊' },
  { name: 'apple', color: 0xcc0000, score: 700, emoji: '🍎' },
  { name: 'melon', color: 0x77cc44, score: 1000, emoji: '🍉' },
  { name: 'galaxian', color: 0x66ccff, score: 2000, emoji: '👾' },
  { name: 'bell', color: 0xffff44, score: 3000, emoji: '🔔' },
  { name: 'key', color: 0xcc9933, score: 5000, emoji: '🔑' }
];

// =============================================================================
// GAMEPLAY CONSTANTS
// =============================================================================
export const GAMEPLAY = {
  // Pacman
  PACMAN_SPEED: 40, // units per second
  PACMAN_ROTATE_SPEED: 150, // degrees per second for mouse look
  PACMAN_MOUTH_MAX_ANGLE: 45, // degrees
  PACMAN_MOUTH_SPEED: 300, // degrees per second

  // Ghosts
  GHOST_SPEED: 35, // units per second (slightly slower than pacman)
  GHOST_HOME_SPEED: 60, // speed when returning home after being eaten
  GHOST_SCATTER_DURATION: 7, // seconds in scatter mode
  GHOST_CHASE_DURATION: 20, // seconds in chase mode

  // Power mode
  POWER_MODE_DURATION: 10, // seconds

  // Scoring
  SCORE_DOT: 10,
  SCORE_POWER_PILL: 50,
  SCORE_GHOST: 200,

  // Starting lives
  STARTING_LIVES: 3,

  // Collision
  COLLISION_RADIUS_MULTIPLIER: 1.5, // for dot collection
  GHOST_COLLISION_PADDING: 2, // additional radius for ghost collision

  // FPS danger warning
  DANGER_WARNING_RADIUS: 5, // tiles distance to trigger warning

  // Fruit (classic arcade rules: appears at fixed spawn after dot thresholds)
  FRUIT_LIFETIME: 10, // seconds visible before despawning
  FRUIT_FIRST_SPAWN_FRAC: 0.3, // spawn 1st fruit after ~30% dots eaten
  FRUIT_SECOND_SPAWN_FRAC: 0.7, // spawn 2nd fruit after ~70% dots eaten

  // Ghost-eat scoring chain (200, 400, 800, 1600 per ghost during one power mode)
  GHOST_CHAIN_SCORES: [200, 400, 800, 1600]
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
