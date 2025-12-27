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
