/**
 * Pac-Infinite — Main entry point.
 *
 * Phase 3: ghosts patrol every chunk, power pills make Pacman dangerous,
 * fruits spawn periodically for bonus points, and there's a 3-lives + score
 * system with a Game Over screen.
 */

import * as THREE from 'three';
import { World } from './world.js';
import { Pacman } from './pacman.js';
import { CameraController } from './camera.js';
import { Controls } from './controls.js';
import { AudioManager } from './audio.js';
import { GAME_STATES, GAMEPLAY, CAMERA } from './constants.js';
import { METERS } from './world-config.js';
import { CHUNK_SIZE } from './templates.js';
import { randomSeed } from './prng.js';
import { loadSave } from './save.js';
import { gameHud } from './game-hud.js';
import { gameInput } from './game-input.js';
import { gameState } from './game-state.js';
import { gameSpawn } from './game-spawn.js';

const CAMERA_STORAGE_KEY = 'pacman-camera-mode';
const HUD_REFRESH_HZ = 5; // updates per second
// How often the game flushes its save while playing. localStorage writes
// are cheap so we can afford a tight interval; higher would risk losing
// progress if the tab crashes.
const SAVE_PERIOD_S = 3;
// Pacman is briefly invulnerable after losing a life so a ghost camping
// the respawn tile can't chain-deplete lives.
const POST_RESPAWN_GRACE_S = 1.5;

class Game {
  constructor() {
    this.state = GAME_STATES.START;
    this.world = null;
    this.pacman = null;

    const urlParams = new URLSearchParams(window.location.search);
    this.debugMode = urlParams.get('debug') === 'true';

    // Boot-time persistence resolution:
    //   1. ?seed=N in the URL wins (used for sharing a specific world).
    //      If a save matches that seed, we'll restore its eaten dots and
    //      Pacman pose; otherwise we treat it as a fresh game with that
    //      seed and clear the prior save when the player actually starts.
    //   2. Else the saved seed continues the previous session.
    //   3. Else a fresh random seed.
    //
    // `_savedState` is what we'll restore from when the player picks
    // "Continue"; it stays null when there's nothing to continue.
    const urlSeed = urlParams.get('seed');
    const persisted = loadSave();
    /** @type {ReturnType<typeof loadSave>} */
    this._savedState = null;

    if (urlSeed !== null && /^-?\d+$/.test(urlSeed)) {
      const requestedSeed = parseInt(urlSeed, 10) >>> 0;
      this.seed = requestedSeed;
      // Honour the save only if it's *for this seed* — otherwise the
      // shared URL is asking for a different world.
      if (persisted && persisted.seed === requestedSeed) {
        this._savedState = persisted;
      }
    } else if (persisted) {
      this.seed = persisted.seed;
      this._savedState = persisted;
    } else {
      this.seed = randomSeed();
    }

    // Starting camera mode. Default = FPPOV on desktop (first-person
    // sells the scale of the procedurally-generated terrain — sunken
    // water pits, towering mountain walls, lava chasms — far better
    // than overhead). On touch devices FPPOV is impractical without a
    // mouse to aim, so mobile downgrades to BIRDSEYE_FOLLOW. Fixed
    // BIRDSEYE (=0) is meaningless in an infinite world so it isn't a
    // selectable default; users can still toggle to it via the C key.
    //
    // Resolution order: ?startcamera URL param > persisted localStorage
    // choice > device-aware default.
    const startCameraParam = urlParams.get('startcamera');
    const savedCameraMode = localStorage.getItem(CAMERA_STORAGE_KEY);
    const parsedSavedMode = savedCameraMode !== null ? parseInt(savedCameraMode, 10) : null;
    let validSavedMode =
      parsedSavedMode !== null && parsedSavedMode >= 1 && parsedSavedMode <= 2
        ? parsedSavedMode
        : null;
    const isMobile = /Android|webOS|iPhone|iPad|iPod|BlackBerry|IEMobile|Opera Mini/i.test(
      navigator.userAgent
    );
    if (isMobile && validSavedMode === 2) validSavedMode = 1;

    const parsedStartCamera = this.parseCameraMode(startCameraParam);
    const deviceDefaultMode = isMobile ? 1 : 2; // BIRDSEYE_FOLLOW on touch, FPPOV elsewhere
    this.startCameraMode = parsedStartCamera ?? validSavedMode ?? deviceDefaultMode;

    if (this.debugMode) {
      console.log('[pac-infinite] debug=true seed=', this.seed);
    }

    // Three.js components
    this.scene = null;
    this.camera = null;
    this.renderer = null;
    this.cameraController = null;
    this.controls = null;
    this.audioManager = null;

    // Game timing
    this.clock = new THREE.Clock();
    this.deltaTime = 0;
    this._hudTimer = 0;

    // Respawn bookkeeping (Phase 2a)
    this._respawnTimer = 0;

    // Save bookkeeping. `_eatenDots` is the live, mutable Set shared with
    // the World — any addition here is visible to subsequent chunk loads.
    /** @type {Set<string>} */
    this._eatenDots = this._savedState ? new Set(this._savedState.eatenDots) : new Set();
    this._saveTimer = 0;
    // Saves only happen after the player has actually entered gameplay
    // (CONTINUE / NEW GAME → startGame). This prevents the start-screen
    // pagehide handler from writing an empty "I just opened the page"
    // save that would clobber a real saved session, and it stops
    // startNewGame()'s reload from racing clearSave() against pagehide.
    this._canSave = false;

    // ---- Phase 3 run state -------------------------------------------------
    // Score and lives reset at the start of every gameplay session. The
    // running score is restored from save so reloading mid-run doesn't
    // erase your progress; high score persists across sessions and
    // updates whenever a run beats it. Lives always start at 3.
    this.score = this._savedState ? this._savedState.score : 0;
    this.highScore = this._savedState ? this._savedState.highScore : 0;
    this.lives = GAMEPLAY.STARTING_LIVES;
    // Ghost-eat combo counter — doubles score per ghost within a single
    // power window (200 → 400 → 800 → 1600). Resets when power mode ends.
    this._powerChainCount = 0;
    // Fruit spawn timer — counts down to a per-spawn random interval in
    // [FRUIT_SPAWN_PERIOD_MIN, FRUIT_SPAWN_PERIOD_MAX]. The timer pauses
    // while a fruit is on the board so two never coexist.
    this._fruitSpawnTimer = this._rollFruitInterval();
    /** @type {import('./fruit.js').Fruit | null} */
    this._activeFruit = null;
    // Brief invulnerability after respawn (covers the "ghost was sitting
    // on my respawn tile" footgun).
    this._postRespawnGrace = 0;

    // Tier 3 — arcade dot streak. Increments on every dot/pill/fruit
    // pickup, resets to 0 when Pacman takes damage (ghost / starvation /
    // void). Drives a per-pickup score multiplier on top of the
    // distance multiplier — sustained survival without taking a hit
    // becomes the highest-leverage scoring mode.
    this._dotStreak = 0;
    this._streakBest = 0;

    // Food meter (Minecraft-style hunger). Restored from save when
    // available so Continue picks up your starvation timer; defaults to
    // FOOD_START on a fresh run.
    this.food =
      this._savedState && typeof this._savedState.food === 'number'
        ? this._savedState.food
        : GAMEPLAY.FOOD_START;

    // Most-recent death cause — drives the respawn overlay title and the
    // GAME OVER flavour line. One of: 'ghost', 'starvation', 'void'.
    /** @type {'ghost' | 'starvation' | 'void' | null} */
    this._deathCause = null;

    // Difficulty. Continue inherits the saved difficulty, otherwise we
    // load the player's last menu pick (or default to NORMAL on a
    // fresh browser). Multipliers are read at runtime via _diff()
    // so live changes to localStorage are picked up on next tick.
    this.difficulty = this._initialDifficulty();

    // DOM elements (HUD)
    this.container = document.getElementById('game-container');
    this.startScreen = document.getElementById('start-screen');
    this.continueBtn = document.getElementById('continue-btn');
    this.newGameBtn = document.getElementById('new-game-btn');
    this.pauseScreen = document.getElementById('pause-screen');
    this.respawnOverlay = document.getElementById('respawn-overlay');
    this.respawnTitle = document.getElementById('respawn-title');
    this.respawnFlavour = document.getElementById('respawn-flavour');
    this.gameOverCauseElement = document.getElementById('game-over-cause');
    this.cameraModeElement = document.getElementById('camera-mode');
    // Phase 3 HUD elements
    this.scoreElement = document.getElementById('score');
    this.livesElement = document.getElementById('lives');
    this.highScoreElement = document.getElementById('high-score');
    this.powerTimerElement = document.getElementById('power-timer');
    this.powerTimerBar = document.getElementById('power-timer-bar');
    // Hunger HUD
    this.foodMeterElement = document.getElementById('food-meter');
    this.foodBarElement = document.getElementById('food-bar');
    // Registry-driven meter HUD lookups. Each METERS entry declares
    // its DOM ids (hudId / hudBarId); we cache the lookups once so
    // _refreshMetersHud doesn't have to query per frame. Adding a new
    // meter requires a matching <div> in index.html plus the registry
    // entry — no code changes here.
    this.meterElements = new Map();
    for (const meter of Object.values(METERS)) {
      const wrap = document.getElementById(meter.hudId);
      const bar = document.getElementById(meter.hudBarId);
      if (wrap && bar) this.meterElements.set(meter.id, { wrap, bar });
    }
    // Tier 3 — survival/runner HUD elements (FAR / MULT / STREAK).
    this.farTilesElement = document.getElementById('far-tiles');
    this.scoreMultElement = document.getElementById('score-mult');
    this.dotStreakElement = document.getElementById('dot-streak');
    // Tier 5 — DASH readout. Status text + charge bar. The bar is
    // the primary feedback channel for FPPOV players, who can't see
    // the cyan sprint glow on Pacman's body (they ARE Pacman); the
    // text label backs it up across all camera modes.
    this.dashStatusElement = document.getElementById('dash-status');
    this.dashBarElement = document.getElementById('dash-bar');
    // Tier 4 — on-screen ghost proximity overlay. The overlay div is a
    // full-viewport pointer-events-none layer; per-ghost arrow markers
    // are pooled inside `_ghostMarkerPool` (created on demand, hidden
    // when not in use). Each frame, game-hud.js:_refreshGhostIndicators
    // claims one marker per active threat, sets its --marker-x / -y /
    // -rot CSS variables, and toggles the warn-watch / warn-danger /
    // warn-imminent tier class. Markers reach into the ghost set via
    // `world.getGhosts()` and use `this.camera` for projection, so
    // both must exist before the layer is visible.
    this.ghostIndicatorsLayer = document.getElementById('ghost-indicators');
    /** @type {HTMLDivElement[]} */
    this._ghostMarkerPool = [];
    this.gameOverScreen = document.getElementById('game-over-screen');
    this.finalScoreElement = document.getElementById('final-score');
    this.finalHighScoreElement = document.getElementById('final-high-score');
    // Tier 3 — per-run best streak. Row stays hidden until the player
    // actually built a streak so an instant-death run doesn't show
    // "Best Streak: 0" as if it were a stat worth boasting about.
    this.finalStreakRow = document.getElementById('final-streak-row');
    this.finalStreakElement = document.getElementById('final-streak');
    this.backToMenuBtn = document.getElementById('back-to-menu-btn');

    this.init();
  }

  async init() {
    this.initThreeJS();

    this.audioManager = new AudioManager();
    if (this.debugMode) this.audioManager.setEnabled(false);

    await this.loadWorld();

    // CameraController was originally fed level width/height to compute
    // optimalDistance for the fixed BIRDSEYE view. In an infinite world
    // there's no global "level dimensions" — pass the chunk size so the
    // birdseye-follow zoom feels right.
    this.cameraController = new CameraController(
      this.camera,
      this.world.scale,
      CHUNK_SIZE,
      CHUNK_SIZE
    );

    this.controls = new Controls(this);

    this.cameraController.setMode(this.startCameraMode);
    this.applyCameraModeUI(this.startCameraMode);

    this.setupEventListeners();
    this.updateUI();
    this.animate();

    // ?newgame=1 sentinel: the user just clicked NEW GAME on the menu,
    // which forced a reload to wipe the saved session. Skip the start
    // screen entirely and drop them into gameplay so they don't have to
    // click "NEW GAME" a second time. We also strip the sentinel from
    // the URL so a refresh doesn't re-trigger this branch.
    const params = new URLSearchParams(window.location.search);
    if (params.get('newgame') === '1') {
      params.delete('newgame');
      const newUrl = window.location.pathname + (params.toString() ? '?' + params.toString() : '');
      window.history.replaceState(null, '', newUrl);
      this.startGame();
    }
  }

  initThreeJS() {
    this.scene = new THREE.Scene();
    this.scene.background = new THREE.Color(0x0a0a1a);

    this.camera = new THREE.PerspectiveCamera(
      CAMERA.FOV,
      window.innerWidth / window.innerHeight,
      CAMERA.NEAR_PLANE,
      CAMERA.FAR_PLANE
    );
    this.camera.position.set(0, -50, 150);
    this.camera.lookAt(0, 0, 0);
    this.scene.add(this.camera);

    this.renderer = new THREE.WebGLRenderer({ antialias: true });
    this.renderer.setSize(window.innerWidth, window.innerHeight);
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    this.container.insertBefore(this.renderer.domElement, this.container.firstChild);

    this.setupLighting();
    window.addEventListener('resize', () => this.onWindowResize());
  }

  setupLighting() {
    // Ambient bumped from 0.5 → 0.85 so block sides in shadow stay readable.
    // The blocky terrain has lots of vertical faces that go dark fast under
    // a single overhead light; this lifts them without washing out colour.
    const ambientLight = new THREE.AmbientLight(0xb0c0e0, 0.85);
    this.scene.add(ambientLight);

    // Hemisphere light fills sky-vs-ground tints so the FLOOR / WALL
    // colour difference reads clearly even on tile sides.
    const hemiLight = new THREE.HemisphereLight(0x99bbff, 0x223040, 0.55);
    this.scene.add(hemiLight);

    const directionalLight = new THREE.DirectionalLight(0xffffff, 0.55);
    directionalLight.position.set(0, 0, 100);
    directionalLight.castShadow = true;
    directionalLight.shadow.mapSize.width = 2048;
    directionalLight.shadow.mapSize.height = 2048;
    directionalLight.shadow.camera.near = 1;
    directionalLight.shadow.camera.far = 200;
    directionalLight.shadow.camera.left = -100;
    directionalLight.shadow.camera.right = 100;
    directionalLight.shadow.camera.top = 100;
    directionalLight.shadow.camera.bottom = -100;
    this.scene.add(directionalLight);

    const rimLight = new THREE.DirectionalLight(0x4488ff, 0.25);
    rimLight.position.set(-50, -50, 50);
    this.scene.add(rimLight);
  }

  async loadWorld() {
    this.world = new World({ seed: this.seed, scale: 10, eatenDots: this._eatenDots });
    // Push the difficulty multipliers into world before any ghosts spawn
    // so the initial seed-batch already respects the player's choice.
    this._syncWorldDifficulty();
    await this.world.load();

    // If we're restoring a save, stream chunks around the saved Pacman
    // position so the first batch is already where the player will be —
    // saves a frame of "wrong chunks unload, right chunks load".
    const savedPacman = this._savedState?.pacman ?? null;
    let initialOrigin = null;
    if (savedPacman) {
      initialOrigin = new THREE.Vector3(
        savedPacman.gx * this.world.scale,
        savedPacman.gy * this.world.scale,
        0
      );
    }
    this.world.addToScene(this.scene, initialOrigin);

    this.pacman = new Pacman(
      this.world.pacmanStart.x,
      this.world.pacmanStart.y,
      this.world.scale,
      this.world
    );
    this.pacman.addToScene(this.scene);

    // Restore Pacman's pose if we're continuing. We trust the saved grid
    // coords/yaw, but recompute the surface height from the (deterministic)
    // world so a stale or impossible h doesn't strand him in mid-air.
    if (savedPacman) {
      // Use Pacman's per-actor surface height so a continuing save that
      // left him standing in water restores at the sunken Z (not the
      // floor-edge Z). The next movement step would correct it via
      // `_reactToTileUnderFeet` anyway, but doing it here means the
      // first frame after Continue doesn't pop him out of the pool.
      const surf = this.world.pacmanSurfaceHeightAt(savedPacman.gx, savedPacman.gy);
      const safeHeight = Number.isFinite(surf) && !Number.isNaN(surf) ? surf : savedPacman.h ?? 0;
      this.pacman.respawnAt(savedPacman.gx, savedPacman.gy, safeHeight);
      if (typeof savedPacman.yaw === 'number') {
        this.pacman.setYaw(savedPacman.yaw);
      }
    }
  }

  update() {
    this.deltaTime = this.clock.getDelta();

    // Always stream chunks around Pacman so HUD/visuals stay current even
    // while paused or on the start screen.
    if (this.world && this.pacman) {
      this.world.streamAround(this.pacman.position);
    }

    // HUD throttle
    this._hudTimer += this.deltaTime;
    if (this._hudTimer >= 1 / HUD_REFRESH_HZ) {
      this._hudTimer = 0;
      this.refreshHud();
    }
    // Power-bar + food-bar update every frame so they visibly drain smoothly.
    this._refreshPowerHud();
    this._refreshFoodHud();
    // Breath bar — only visible while wading or refilling. Cheap when
    // hidden (early-out inside the helper).
    this._refreshMetersHud();
    // On-screen ghost proximity arrows — runs every frame so the
    // markers track ghost motion smoothly and tier escalation happens
    // the moment a ghost crosses a radius threshold.
    this._refreshGhostIndicators();
    // DASH status updates every frame so the cooldown counts down
    // smoothly (5-Hz throttled refresh would visibly stutter on a
    // 3-second timer).
    this._refreshDashHud();

    // Game Over: world keeps streaming visually but no gameplay updates.
    if (this.state === GAME_STATES.GAME_OVER) {
      this.cameraController.update(
        this.pacman.getPosition(),
        this.pacman.getFacing(),
        this.pacman.getYaw(),
        this.pacman.getPitch()
      );
      return;
    }

    if (this.state !== GAME_STATES.PLAYING && this.state !== GAME_STATES.DEATH) return;

    // Handle death/respawn pipeline. The DEATH state owns the fall animation
    // (driven by pacman.update with `pacman.dead === true`) plus a small
    // post-fall pause before respawn.
    if (this.state === GAME_STATES.DEATH) {
      this.pacman.update(this.deltaTime, 'none');
      this._respawnTimer -= this.deltaTime;
      if (this._respawnTimer <= 0) {
        this._respawn();
      }
      this.cameraController.update(
        this.pacman.getPosition(),
        this.pacman.getFacing(),
        this.pacman.getYaw(),
        this.pacman.getPitch()
      );
      return;
    }

    // Tier 3 — survival/runner identity. Push Pacman's distance from
    // the world origin into the World BEFORE ghost AI / hunger / dot
    // density read from it; those systems all consume `world.farPct`
    // via the effective* helpers (Tier 3 design note in world.js).
    if (this.world) {
      const px = this.pacman.position.x / this.world.scale;
      const py = this.pacman.position.y / this.world.scale;
      this.world.updateFarProgress(Math.hypot(px, py));
    }

    const direction = this.controls.getDirection();
    // Birds-Eye Follow uses a continuous-angle move vector (from the
    // joystick or from compound keyboard input) so the player can walk
    // in any of 360° — matching the "tap aims Pacman like a mouse"
    // intent. Top-Down still uses the cardinal `direction` enum for
    // the classic 4-way Pacman feel.
    //
    // Follow used to auto-walk by forcing `direction = 'up'` whenever
    // there was no input; that was a STRAFE-mode artifact ("up" =
    // forward along facing). With Follow now on PERP, the same trick
    // becomes "walk world +Y forever", which made every other tap
    // direction appear to snap back to north. Auto-walk is gone; the
    // player drives Pacman explicitly in every mode.
    const moveVec = this.cameraController.currentMode === 1 ? this.controls.getMoveVector() : null;
    this.pacman.update(this.deltaTime, direction, moveVec);

    // Drive ghost AI + power-pill pulse. Done after pacman.update so the
    // ghost positions track this frame's pacman position. Pacman's facing
    // is forwarded so personality-driven ghosts (Pinky / Inky) can target
    // tiles ahead of him.
    if (this.world.update) {
      this.world.update(this.deltaTime, this.pacman.position, {
        // Letting the world know power state means freshly-spawned
        // ghosts can start in FLEE while Pacman is still powered.
        powered: this.pacman.powered,
        powerTimer: this.pacman.powerTimer,
        pacmanFacing: this.pacman.getFacing()
      });
    }

    // Pacman just walked into VOID this frame? Enter death state.
    if (this.pacman.dead) {
      this._enterDeath();
    } else {
      this.checkDotCollection();
      // Phase 3 collision sweeps. Order matters: ghosts first so a power-eat
      // is registered before fruit collection (one frame's worth of priority).
      this._checkGhostCollisions();
      this._tickFruit();
      // Hunger drain. Runs only during active gameplay (not during DEATH /
      // GAME_OVER / start screen). Eating dots/pills/fruit refills the meter
      // in the corresponding handlers above; eating ghosts subtracts from it.
      // Hitting zero triggers a starvation-death (same flow as a ghost kill).
      this._tickHunger(this.deltaTime);
      // All registry-driven meters (breath today; future heat/cold/…).
      // Each ticks independently against pacman._activeMeters: an entry
      // present in the set drains, otherwise it refills. Empty meter
      // routes through _loseLife(meter.deathCause) — drown for water.
      this._tickMeters(this.deltaTime);
    }

    if (this._postRespawnGrace > 0) {
      this._postRespawnGrace -= this.deltaTime;
    }

    this.cameraController.update(
      this.pacman.getPosition(),
      this.pacman.getFacing(),
      this.pacman.getYaw(),
      this.pacman.getPitch()
    );

    // FPPOV: drive the SVG mouth overlay so the chomp animation tracks
    // Pacman's actual mouth angle (parity with the original /pacman/ game).
    if (this.cameraController.currentMode === 2) {
      this.controls.updateMouthOverlay(this.pacman.getMouthAngle());
    }

    // Periodic save. Two reasons we drive this from the game loop instead
    // of a setInterval:
    //   1. It naturally pauses when the game is paused / on the start
    //      screen — no risk of overwriting a saved pose with the menu pose.
    //   2. The deltaTime-driven counter aligns with the rest of the
    //      gameplay timers (jump cooldown, respawn delay).
    // We always save Pacman's pose on the tick; we only mark `_saveDirty`
    // when a dot is collected so a stationary player doesn't churn writes.
    this._saveTimer += this.deltaTime;
    if (this._saveTimer >= SAVE_PERIOD_S) {
      this._flushSave();
    }
  }

  animate() {
    requestAnimationFrame(() => this.animate());
    this.update();
    this.renderer.render(this.scene, this.camera);
  }
}

Object.assign(Game.prototype, gameHud, gameInput, gameState, gameSpawn);

document.addEventListener('DOMContentLoaded', () => {
  window.game = new Game();
});
