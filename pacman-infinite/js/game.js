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
import { Fruit } from './fruit.js';
import { CameraController } from './camera.js';
import { Controls } from './controls.js';
import { AudioManager } from './audio.js';
import {
  GAME_STATES,
  GHOST_STATE,
  GAMEPLAY,
  CAMERA,
  TILE,
  DIFFICULTY,
  DIFFICULTY_PRESETS
} from './constants.js';
import { CHUNK_SIZE } from './templates.js';
import { randomSeed } from './prng.js';
import { loadSave, saveState, clearSave, eatenKey } from './save.js';

const RESPAWN_DELAY = GAMEPLAY.PACMAN_RESPAWN_DELAY;

const CAMERA_STORAGE_KEY = 'pacman-camera-mode';
const DIFFICULTY_STORAGE_KEY = 'pacman-infinite-difficulty';
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

    // Starting camera mode. Default = BIRDSEYE_FOLLOW per the plan; fixed
    // BIRDSEYE is meaningless in an infinite world.
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
    this.startCameraMode = parsedStartCamera ?? validSavedMode ?? 1; // BIRDSEYE_FOLLOW

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
    /** @type {Fruit | null} */
    this._activeFruit = null;
    // Brief invulnerability after respawn (covers the "ghost was sitting
    // on my respawn tile" footgun).
    this._postRespawnGrace = 0;

    // Food meter (Minecraft-style hunger). Restored from save when
    // available so Continue picks up your starvation timer; defaults to
    // FOOD_START on a fresh run.
    this.food = this._savedState && typeof this._savedState.food === 'number'
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
    this.gameOverScreen = document.getElementById('game-over-screen');
    this.finalScoreElement = document.getElementById('final-score');
    this.finalHighScoreElement = document.getElementById('final-high-score');
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
      const surf = this.world.surfaceHeightAt(savedPacman.gx, savedPacman.gy);
      const safeHeight =
        Number.isFinite(surf) && !Number.isNaN(surf) ? surf : (savedPacman.h ?? 0);
      this.pacman.respawnAt(savedPacman.gx, savedPacman.gy, safeHeight);
      if (typeof savedPacman.yaw === 'number') {
        this.pacman.setYaw(savedPacman.yaw);
      }
    }
  }

  setupEventListeners() {
    // Configure the start menu based on whether there's anything to continue.
    this._refreshStartMenu();
    this._refreshDifficultyButtons();

    if (this.continueBtn) {
      this.continueBtn.addEventListener('click', () => this.startGame());
    }
    if (this.newGameBtn) {
      this.newGameBtn.addEventListener('click', () => this.startNewGame());
    }
    // Wire all difficulty pills. Cosmetic until NEW GAME is pressed.
    const difficultyButtons = document.querySelectorAll('.difficulty-btn');
    for (const btn of difficultyButtons) {
      btn.addEventListener('click', () => {
        const diff = btn.getAttribute('data-difficulty');
        if (diff) this.setDifficulty(diff);
      });
    }

    const cameraToggle = document.getElementById('camera-toggle');
    if (cameraToggle) {
      cameraToggle.addEventListener('click', () => {
        if (this.controls) this.controls.cycleCamera();
      });
    }

    if (this.pauseScreen) {
      this.pauseScreen.addEventListener('click', () => this.resumeGame());
    }

    if (this.backToMenuBtn) {
      this.backToMenuBtn.addEventListener('click', () => this._backToMenuFromGameOver());
    }

    window.addEventListener('blur', () => {
      if (this.state === GAME_STATES.PLAYING) this.pauseGame();
    });
    document.addEventListener('visibilitychange', () => {
      // pagehide isn't reliable on iOS; visibilitychange:hidden is the
      // canonical "the user might be leaving" signal. Flush before pause
      // so we never lose progress to an OS-level tab swap.
      if (document.hidden) {
        this._flushSave();
        if (this.state === GAME_STATES.PLAYING) this.pauseGame();
      }
    });
    // pagehide is the most reliable "we are about to die" signal for
    // page navigations / closes. beforeunload doesn't fire on iOS.
    window.addEventListener('pagehide', () => this._flushSave());
  }

  /**
   * Toggle the CONTINUE / NEW GAME buttons based on whether `_savedState`
   * is non-null. Called once on boot (and after any future menu reopen).
   */
  _refreshStartMenu() {
    const canContinue = this._savedState !== null;
    if (this.continueBtn) {
      this.continueBtn.classList.toggle('hidden', !canContinue);
    }
    if (this.newGameBtn) {
      // When a save exists, NEW GAME drops to a smaller "secondary" style
      // so CONTINUE reads as the obvious primary action.
      this.newGameBtn.classList.toggle('btn-primary', !canContinue);
      this.newGameBtn.classList.toggle('btn-secondary', canContinue);
    }
  }

  startGame() {
    if (this.startScreen) this.startScreen.classList.add('hidden');
    this.state = GAME_STATES.PLAYING;
    // From here on we can persist progress (and pagehide will flush).
    this._canSave = true;
  }

  /**
   * Player chose "NEW GAME".
   *
   * Two cases:
   *   - No save loaded: the current world is already fresh, so just start
   *     playing. No reload, no flicker.
   *   - Save loaded: discard it, drop any ?seed= URL param, and reload so
   *     boot rolls a new random seed (and all of Three.js's lifecycle —
   *     chunks, meshes, audio — gets a clean slate).
   *
   * Disable saves *before* clearing so the pagehide handler triggered by
   * the navigation can't race us and rewrite the save we just removed.
   */
  startNewGame() {
    if (this._savedState === null) {
      this.startGame();
      return;
    }
    this._canSave = false;
    clearSave();
    const url = new URL(window.location.href);
    url.searchParams.delete('seed');
    // Sentinel telling the post-reload boot to skip the menu and drop
    // straight into gameplay. Without this, the player has to click
    // NEW GAME a second time on the freshly-empty start screen.
    url.searchParams.set('newgame', '1');
    window.location.replace(url.toString());
  }

  /**
   * Build the JSON-friendly snapshot of Pacman's pose for the save.
   * Returns null if pacman isn't ready yet (boot race). Recomputes grid
   * coords from world coords so they round to whole tiles deterministically.
   */
  _snapshotPacman() {
    if (!this.world || !this.pacman) return null;
    return {
      gx: this.world.worldToGrid(this.pacman.position.x),
      gy: this.world.worldToGrid(this.pacman.position.y),
      h: this.pacman.tileHeight,
      yaw: this.pacman.yaw
    };
  }

  /** Synchronously persist the current world state. Cheap; called on a timer. */
  _flushSave() {
    if (!this.world || !this._canSave) return;
    saveState({
      seed: this.seed,
      pacman: this._snapshotPacman(),
      eatenDots: this._eatenDots,
      score: this.score,
      highScore: this.highScore,
      food: this.food,
      difficulty: this.difficulty
    });
    this._saveTimer = 0;
  }

  pauseGame() {
    if (this.state !== GAME_STATES.PLAYING) return;
    this.state = GAME_STATES.PAUSED;
    if (this.pauseScreen) this.pauseScreen.classList.remove('hidden');
    if (document.pointerLockElement) document.exitPointerLock();
  }

  resumeGame() {
    if (this.state !== GAME_STATES.PAUSED) return;
    this.state = GAME_STATES.PLAYING;
    if (this.pauseScreen) this.pauseScreen.classList.add('hidden');
  }

  togglePause() {
    if (this.state === GAME_STATES.PLAYING) this.pauseGame();
    else if (this.state === GAME_STATES.PAUSED) this.resumeGame();
  }

  /** Used by Controls.cycleCamera (also from the camera-toggle button).
   *  FPPOV → STRAFE (mouse-look + WASD twin-stick).
   *  Other modes → PERP (joystick / arrows = world directions). Follow
   *  used to be STRAFE but it conflicted with the tap-anywhere drive
   *  control and made Pacman walk *opposite* to the tap; see the
   *  matching comment in Controls.cycleCamera. */
  applyCameraModeUI(mode) {
    const isFirstPerson = mode === 2;
    if (this.pacman) {
      this.pacman.setVisible(!isFirstPerson);
      this.pacman.setKeyMode(isFirstPerson ? 1 : 2);
    }
    const mouthOverlay = document.getElementById('fps-mouth-overlay');
    if (mouthOverlay) mouthOverlay.classList.toggle('hidden', !isFirstPerson);
  }

  updateUI() {
    if (this.cameraModeElement && this.cameraController) {
      this.updateCameraModeDisplay();
    }
  }

  updateCameraModeDisplay() {
    if (this.cameraModeElement && this.cameraController) {
      // Single source of truth lives on the camera controller — keeps the
      // HUD label in sync if camera modes ever get renamed/reordered.
      this.cameraModeElement.textContent = this.cameraController.getModeName();
    }
  }

  refreshHud() {
    if (!this.world || !this.pacman) return;
    if (this.scoreElement) {
      this.scoreElement.textContent = String(this.score);
    }
    if (this.highScoreElement) {
      this.highScoreElement.textContent = String(this.highScore);
    }
    if (this.livesElement) {
      // Render lives as filled hearts. Empty hearts after a death give a
      // glance-readable "you have 1 life left" state.
      const filled = '\u2665'.repeat(Math.max(0, this.lives));
      const empty = '\u2661'.repeat(Math.max(0, GAMEPLAY.STARTING_LIVES - this.lives));
      this.livesElement.innerHTML = filled + `<span class="text-red-900/60">${empty}</span>`;
    }
  }

  /**
   * Drive the hunger HUD bar each frame. Width tracks `food / FOOD_MAX`,
   * and the meter gets a `.low` class when food drops under
   * FOOD_LOW_THRESHOLD so the CSS pulses it red.
   */
  _refreshFoodHud() {
    if (!this.foodBarElement || !this.foodMeterElement) return;
    const max = GAMEPLAY.FOOD_MAX;
    const f = Math.max(0, Math.min(max, this.food));
    this.foodBarElement.style.width = `${(f / max) * 100}%`;
    const low = f < GAMEPLAY.FOOD_LOW_THRESHOLD;
    this.foodMeterElement.classList.toggle('low', low);
  }

  /**
   * Apply per-frame hunger drain and trigger starvation when food
   * reaches zero. Only called during active PLAYING frames.
   */
  _tickHunger(deltaTime) {
    if (this.food <= 0) return; // already starving — wait for the death state to clear
    const drain = GAMEPLAY.FOOD_DRAIN_RATE * this._diff().hungerDrainMul;
    this.food = Math.max(0, this.food - drain * deltaTime);
    if (this.food <= 0) {
      this._starve();
    }
  }

  /**
   * Add `amount` (can be negative) to the food meter, clamped to
   * [0, FOOD_MAX]. If a negative amount drops food to zero we still
   * route through the death pipeline so the player gets the same
   * visual cue as drain-starvation.
   */
  _addFood(amount) {
    if (amount === 0) return;
    this.food = Math.max(0, Math.min(GAMEPLAY.FOOD_MAX, this.food + amount));
    if (amount < 0 && this.food <= 0 && this.state === GAME_STATES.PLAYING) {
      this._starve();
    }
  }

  /**
   * Starvation death. Same animation + scoring as a ghost kill, but
   * we surface it as its own method so future tweaks (sound, overlay,
   * HUD flash) can land in one place. Re-uses _loseLife so all
   * downstream state machines (lives, game-over, save) flow correctly.
   */
  _starve() {
    if (this.pacman.dying || this.pacman.dead) return;
    this._loseLife('starvation');
  }

  /**
   * Read the difficulty preset for the current run. Always returns a
   * valid preset (falls back to normal) so callers can read multipliers
   * unconditionally.
   */
  _diff() {
    return DIFFICULTY_PRESETS[this.difficulty] || DIFFICULTY_PRESETS[DIFFICULTY.NORMAL];
  }

  /**
   * Pick the difficulty for this constructor: prefer the saved run's
   * difficulty (so Continue feels consistent), then the user's last
   * menu choice, then NORMAL.
   */
  _initialDifficulty() {
    if (this._savedState && typeof this._savedState.difficulty === 'string') {
      const d = this._savedState.difficulty;
      if (DIFFICULTY_PRESETS[d]) return d;
    }
    try {
      const stored = localStorage.getItem(DIFFICULTY_STORAGE_KEY);
      if (stored && DIFFICULTY_PRESETS[stored]) return stored;
    } catch (_e) {
      /* ignore */
    }
    return DIFFICULTY.NORMAL;
  }

  /** Switch the active difficulty (menu selection); persists to localStorage. */
  setDifficulty(diff) {
    if (!DIFFICULTY_PRESETS[diff]) return;
    this.difficulty = diff;
    try {
      localStorage.setItem(DIFFICULTY_STORAGE_KEY, diff);
    } catch (_e) {
      /* ignore */
    }
    this._refreshDifficultyButtons();
    // If the world already exists (mid-run difficulty change is rare,
    // but technically allowed by setDifficulty being public), push the
    // new multipliers down so AI reacts instantly.
    this._syncWorldDifficulty();
  }

  /**
   * Copy the multipliers off the active preset onto the World instance
   * so ghost code can read them without importing constants. Called
   * from loadWorld() and setDifficulty().
   */
  _syncWorldDifficulty() {
    if (!this.world) return;
    const preset = this._diff();
    this.world.difficulty.ghostSpeedMul = preset.ghostSpeedMul;
    this.world.difficulty.ghostCountMul = preset.ghostCountMul;
    this.world.difficulty.ghostChaseRadiusMul = preset.ghostChaseRadiusMul;
    this.world.difficulty.dotKeepMul = preset.dotKeepMul;
  }

  /** Sync the menu pill highlights with the current `this.difficulty`. */
  _refreshDifficultyButtons() {
    const buttons = document.querySelectorAll('.difficulty-btn');
    for (const btn of buttons) {
      const active = btn.getAttribute('data-difficulty') === this.difficulty;
      btn.classList.toggle('difficulty-active', active);
    }
  }

  /**
   * Cause-specific copy used by the respawn overlay (between deaths
   * mid-run) and the GAME OVER screen (final death). Bold "title" plus
   * a quieter flavour line keeps the overlay glanceable.
   */
  _deathMessage(cause) {
    switch (cause) {
      case 'starvation':
        return { title: 'YOU STARVED', flavour: 'Eat more pellets to keep your hunger up.' };
      case 'void':
        return { title: 'FELL INTO THE VOID', flavour: 'Stay on solid ground.' };
      case 'ghost':
      default:
        return { title: 'A GHOST GOT YOU', flavour: 'Grab a power pill to fight back.' };
    }
  }

  /** Update the death-overlay copy + the GAME OVER flavour line. */
  _applyDeathMessage(cause) {
    const msg = this._deathMessage(cause);
    if (this.respawnTitle) this.respawnTitle.textContent = msg.title;
    if (this.respawnFlavour) this.respawnFlavour.textContent = msg.flavour;
    if (this.gameOverCauseElement) {
      // GAME OVER replaces "respawning" copy with a more final tone.
      const finalText =
        cause === 'starvation'
          ? 'You starved.'
          : cause === 'void'
            ? 'You fell into the void.'
            : 'A ghost got you.';
      this.gameOverCauseElement.textContent = finalText;
    }
  }

  /**
   * Drive the power-mode HUD bar each frame. Hidden when not powered.
   * Width is pacman.powerTimer / POWER_MODE_DURATION; the bar adds an
   * `expiring` class in the final 2 seconds for the CSS pulse.
   */
  _refreshPowerHud() {
    if (!this.powerTimerElement || !this.powerTimerBar) return;
    if (!this.pacman?.powered) {
      this.powerTimerElement.classList.add('hidden');
      this.powerTimerElement.classList.remove('expiring');
      this.container?.classList.remove('ghost-flee-glow');
      return;
    }
    this.powerTimerElement.classList.remove('hidden');
    const frac = Math.max(0, this.pacman.powerTimer / GAMEPLAY.POWER_MODE_DURATION);
    this.powerTimerBar.style.width = `${frac * 100}%`;
    this.powerTimerElement.classList.toggle('expiring', this.pacman.powerTimer < 2);
    this.container?.classList.add('ghost-flee-glow');
  }

  /** Called by Controls when Space (or the touch jump button) is pressed. */
  tryJump() {
    if (this.state !== GAME_STATES.PLAYING) return;
    if (!this.pacman) return;
    this.pacman.tryJump();
  }

  parseCameraMode(modeStr) {
    if (!modeStr) return null;
    const mode = modeStr.toLowerCase();
    switch (mode) {
      case 'follow':
      case '1':
        return 1;
      case 'fps':
      case 'fppov':
      case 'firstperson':
      case 'first':
      case '2':
        return 2;
      case 'birdseye':
      case 'birds':
      case '0':
        return 0; // allowed via URL param even though cycle skips it
      default:
        return null;
    }
  }

  onWindowResize() {
    this.camera.aspect = window.innerWidth / window.innerHeight;
    this.camera.updateProjectionMatrix();
    this.renderer.setSize(window.innerWidth, window.innerHeight);
    if (this.cameraController) this.cameraController.onResize();
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
    const moveVec =
      this.cameraController.currentMode === 1 ? this.controls.getMoveVector() : null;
    this.pacman.update(this.deltaTime, direction, moveVec);

    // Drive ghost AI + power-pill pulse. Done after pacman.update so the
    // ghost positions track this frame's pacman position.
    if (this.world.update) {
      this.world.update(this.deltaTime, this.pacman.position, {
        // Letting the world know power state means freshly-spawned
        // ghosts can start in FLEE while Pacman is still powered.
        powered: this.pacman.powered,
        powerTimer: this.pacman.powerTimer
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

  /**
   * Pacman walked into a void this frame.
   *
   * Falling counts as losing a life — the player feels the cost the same
   * way as a ghost touch. If lives run out the death animation runs and
   * THEN we transition to GAME_OVER (after the fall completes), so the
   * player still gets the visual moment.
   */
  _enterDeath() {
    this.state = GAME_STATES.DEATH;
    this._respawnTimer = RESPAWN_DELAY;
    this._deathCause = 'void';
    this._applyDeathMessage('void');
    if (this.respawnOverlay) this.respawnOverlay.classList.remove('hidden');
    this.audioManager.playDeath?.();

    // Cost a life, mirroring the ghost-touch path. Power mode ends.
    this.lives = Math.max(0, this.lives - 1);
    this.pacman.clearPowerMode();
    this.audioManager.playLifeLost?.();
    // Refresh the HUD now so the heart count visibly updates as Pacman
    // is mid-fall — feels punchier than waiting until respawn.
    this.refreshHud();
  }

  _respawn() {
    if (!this.world || !this.pacman) return;
    const spawn = this.world.randomLoadedFloor();
    if (!spawn) {
      // Should be impossible (cross center is always FLOOR) but be defensive.
      this.pacman.respawnAt(CHUNK_SIZE / 2, CHUNK_SIZE / 2, 0);
    } else {
      this.pacman.respawnAt(spawn.gridX, spawn.gridY, spawn.height);
    }
    if (this.respawnOverlay) this.respawnOverlay.classList.add('hidden');
    // Restock food on respawn so a starvation death doesn't immediately
    // re-trigger. Use FOOD_RESPAWN (60) instead of full so the player
    // still has to engage with hunger after coming back.
    this.food = GAMEPLAY.FOOD_RESPAWN;

    // If the void death used the player's last life, the fall animation
    // has finished — now it's safe to flip to GAME_OVER without losing
    // the dramatic moment.
    if (this.lives <= 0) {
      this._enterGameOver();
      return;
    }
    this.state = GAME_STATES.PLAYING;
    this._postRespawnGrace = POST_RESPAWN_GRACE_S;
    // Force-stream new chunks around the respawn point in case it's far
    // from the death site.
    this.world.streamAround(this.pacman.position);
  }

  checkDotCollection() {
    const pacmanPos = this.pacman.getPosition();
    const collectRadius = this.pacman.radius * GAMEPLAY.COLLISION_RADIUS_MULTIPLIER;
    // World.dots is a getter that aggregates across loaded chunks; we only
    // walk it on each frame for the MVP. With ~25 chunks * ~150 dots = ~3700
    // dots max, this is fine. If perf becomes an issue we can spatial-index
    // by chunk.
    const allDots = this.world.dots;
    for (const dot of allDots) {
      if (!dot.visible) continue;
      if (dot.position.distanceTo(pacmanPos) < collectRadius) {
        dot.visible = false;
        // Persist the eat. The Set is shared with World.eatenDots so any
        // chunk loaded later will already know to hide this dot.
        this._eatenDots.add(eatenKey(dot.cx, dot.cy, dot.lx, dot.ly));

        if (dot.isPowerPill) {
          this.score += GAMEPLAY.SCORE_POWER_PILL;
          this._addFood(GAMEPLAY.FOOD_PER_POWER_PILL);
          this.audioManager.playPowerPill?.();
          this.pacman.startChomp();
          // Enter power mode — refreshes the timer if already powered.
          this.pacman.enterPowerMode(GAMEPLAY.POWER_MODE_DURATION);
          // Reset the ghost-eat combo at the start of every power window
          // so a fresh pill always pays out 200 → 400 → 800 → 1600.
          this._powerChainCount = 0;
          // Scare every live ghost.
          this.world.scareAllGhosts(GAMEPLAY.POWER_MODE_DURATION);
        } else {
          this.score += GAMEPLAY.SCORE_DOT;
          this._addFood(GAMEPLAY.FOOD_PER_DOT);
          this.audioManager.playChomp();
          this.pacman.startChomp();
        }
      }
    }
  }

  // ---------------------------------------------------------------------------
  // Phase 3 — ghosts, fruit, lives, game over
  // ---------------------------------------------------------------------------

  /**
   * Pacman vs all ghosts. Behaviour depends on Pacman's power state and
   * each ghost's state:
   *   - Powered + ghost.FLEE → eat ghost, score combo, ghost respawns home
   *   - Otherwise → lose a life (unless we're mid-jump, mid-respawn-grace,
   *     or the ghost is currently EATEN/invisible)
   */
  _checkGhostCollisions() {
    if (!this.world || !this.pacman) return;
    if (this.pacman.dead) return;
    if (this.pacman.invulnerable) return; // mid-jump grace
    if (this._postRespawnGrace > 0) return;

    const pacmanPos = this.pacman.position;
    // Collision radius generous enough to land hits at typical play speeds
    // without making ghosts feel "magnetic" — about 60% of a tile.
    const collisionR = this.world.scale * 0.6;
    const collisionR2 = collisionR * collisionR;

    for (const ghost of this.world.getGhosts()) {
      if (ghost.state === GHOST_STATE.EATEN) continue;
      const dx = ghost.position.x - pacmanPos.x;
      const dy = ghost.position.y - pacmanPos.y;
      const dz = ghost.position.z - pacmanPos.z;
      // Allow a generous z tolerance (1.5 tiles) — a ghost on a low
      // plateau can still grab Pacman walking past on the ground tile.
      if (Math.abs(dz) > this.world.scale * 1.5) continue;
      if (dx * dx + dy * dy > collisionR2) continue;

      if (this.pacman.powered && ghost.state === GHOST_STATE.FLEE) {
        this._eatGhost(ghost);
      } else {
        this._loseLife('ghost');
        return; // a single life-loss frame should consume any further hits
      }
    }
  }

  _eatGhost(ghost) {
    const points =
      GAMEPLAY.SCORE_GHOST_BASE * (1 << Math.min(this._powerChainCount, 3));
    this.score += points;
    this._powerChainCount++;
    // "Ghost is gnarly food" — score reward, but a hunger penalty.
    // Routed through _addFood so a starving player chomping a ghost
    // can bottom out and trigger a starvation-death (rare edge case
    // that's still preferable to a silent inconsistency).
    this._addFood(-GAMEPLAY.FOOD_GHOST_PENALTY);
    this.audioManager.playGhostEaten?.();
    ghost.setEaten();
  }

  /**
   * Pacman caught by a ghost. Plays the iconic "pew pew pew :-(" death
   * cue + the classic spin/shrink animation, *then* respawns (or rolls
   * into game over if it was the last life). We re-use the DEATH state
   * machine so the timer-driven _respawn() path handles either outcome.
   */
  _loseLife(cause = 'ghost') {
    this.lives--;
    this._deathCause = cause;
    // Iconic death cue from the original game (assets/sounds/death.wav).
    this.audioManager.playDeath?.();
    this.pacman.clearPowerMode();
    this.refreshHud();
    // Show the cause overlay for ALL deaths so the player always knows
    // why they died. The overlay's bg/60 + flex layout sits on top of
    // the canvas; the spin/shrink animation still plays underneath
    // and is partially visible through the dim overlay.
    this._applyDeathMessage(cause);
    if (this.respawnOverlay) this.respawnOverlay.classList.remove('hidden');
    // Hand the next ~1.5s over to the death state machine so the spin
    // animation has time to play. _respawn() runs at the end and will
    // detect lives<=0 and roll into GAME_OVER for us.
    this.state = GAME_STATES.DEATH;
    this._respawnTimer = GAMEPLAY.PACMAN_DEATH_ANIM_DURATION;
    this.pacman.dieByGhost();
  }

  _enterGameOver() {
    this.state = GAME_STATES.GAME_OVER;
    this.audioManager.playGameOver?.();
    // Final-screen flavour line reflects whatever killed Pacman last.
    this._applyDeathMessage(this._deathCause ?? 'ghost');
    if (this.score > this.highScore) {
      this.highScore = this.score;
    }
    if (this.gameOverScreen) {
      this.gameOverScreen.classList.remove('hidden');
    }
    if (this.finalScoreElement) {
      this.finalScoreElement.textContent = String(this.score);
    }
    if (this.finalHighScoreElement) {
      this.finalHighScoreElement.textContent = String(this.highScore);
    }
    // Persist the high-score and zero out the run's score. Eaten dots and
    // pacman pose are preserved so Continue picks up where the player
    // fell — only the run-specific stats reset.
    this.score = 0;
    this._powerChainCount = 0;
    this._flushSave();
  }

  /**
   * Player tapped "BACK TO MENU" on the game-over screen. Hide the
   * overlay, restore the start menu, and require an explicit start
   * action to resume gameplay. Lives are restored to the starting count
   * here too so Continue from the menu plays correctly.
   *
   * We also clear the live ghost pool and any active fruit — their
   * positions are stale (from the last run's chase point) and on
   * Continue the world will spawn fresh ghosts around the new spawn
   * tile. Same justification as Minecraft despawning hostile mobs on
   * a difficulty change.
   */
  _backToMenuFromGameOver() {
    if (this.gameOverScreen) this.gameOverScreen.classList.add('hidden');
    this.lives = GAMEPLAY.STARTING_LIVES;
    this.food = GAMEPLAY.FOOD_START;
    this.state = GAME_STATES.START;
    if (this.world?.clearGhosts) this.world.clearGhosts();
    this._despawnFruit();
    // Re-derive the saved-state view of the world so the menu's CONTINUE
    // button picks up the just-flushed save.
    this._savedState = loadSave();
    this._refreshStartMenu();
    if (this.startScreen) this.startScreen.classList.remove('hidden');
    this._canSave = false;
  }

  /**
   * Pick a random spawn delay for the next fruit. Difficulty stretches
   * (or compresses) the window so easy gets fruit faster than hard.
   */
  _rollFruitInterval() {
    const mul = this._diff().fruitSpawnPeriodMul;
    const lo = GAMEPLAY.FRUIT_SPAWN_PERIOD_MIN * mul;
    const hi = GAMEPLAY.FRUIT_SPAWN_PERIOD_MAX * mul;
    return lo + Math.random() * (hi - lo);
  }

  /**
   * Fruit lifecycle:
   *   - When no fruit is active, the spawn timer counts down. When it
   *     hits zero, we attempt to spawn one fruit at a random nearby
   *     walkable tile (outside FRUIT_SPAWN_MIN_DIST_TILES of Pacman).
   *   - The active fruit ticks its bob animation, self-destructs after
   *     FRUIT_LIFETIME, and gives SCORE_FRUIT on collision.
   *   - The interval is re-rolled each spawn so timing feels organic.
   *   - If Pacman walks far away from the fruit, it auto-despawns to
   *     avoid keeping mesh memory around for an unreachable bonus.
   */
  _tickFruit() {
    if (this._activeFruit) {
      const expired = this._activeFruit.update(this.deltaTime);
      const pacmanPos = this.pacman.position;
      const dx = this._activeFruit.position.x - pacmanPos.x;
      const dy = this._activeFruit.position.y - pacmanPos.y;
      const dz = this._activeFruit.position.z - pacmanPos.z;
      const dXY2 = dx * dx + dy * dy;
      const r = this.world.scale * 0.7;
      if (dXY2 < r * r && Math.abs(dz) < this.world.scale * 1.2) {
        this.score += GAMEPLAY.SCORE_FRUIT;
        // Fruit is the strongest food source in the game (intentional —
        // it's rare, time-limited, and the user wanted "fruit is better").
        this._addFood(GAMEPLAY.FOOD_PER_FRUIT);
        this.audioManager.playFruitEaten?.();
        this._despawnFruit();
        return;
      }
      // Too-far cull: if Pacman walked off two chunks away from the
      // fruit, treat it as gone. Keeps memory bounded if the player
      // never approaches.
      const cullR = GAMEPLAY.FRUIT_SPAWN_MAX_DIST * CHUNK_SIZE * this.world.scale * 1.5;
      if (dXY2 > cullR * cullR || expired) {
        this._despawnFruit();
        // Skip-ahead the timer so the next attempt happens soon-ish.
        this._fruitSpawnTimer = Math.min(this._fruitSpawnTimer, 5);
      }
      return;
    }

    this._fruitSpawnTimer -= this.deltaTime;
    if (this._fruitSpawnTimer <= 0) {
      this._spawnFruit();
      // Always reset the timer so a failed spawn (no valid tile)
      // doesn't churn every frame.
      this._fruitSpawnTimer = this._rollFruitInterval();
    }
  }

  /**
   * Pick a random walkable FLOOR tile near Pacman (outside the safety
   * radius) and instantiate a Fruit there. Tries up to 12 random tiles
   * before giving up; spawning failures simply roll the timer again.
   */
  _spawnFruit() {
    if (!this.world || !this.pacman) return;
    const spawn = this._pickFruitSpawnTile();
    if (!spawn) return;
    this._activeFruit = new Fruit({
      gridX: spawn.gx,
      gridY: spawn.gy,
      surfaceHeight: spawn.h,
      scale: this.world.scale
    });
    this._activeFruit.addToScene(this.scene);
  }

  _pickFruitSpawnTile() {
    const pcx = Math.floor(this.world.worldToGrid(this.pacman.position.x) / CHUNK_SIZE);
    const pcy = Math.floor(this.world.worldToGrid(this.pacman.position.y) / CHUNK_SIZE);
    const maxDist = GAMEPLAY.FRUIT_SPAWN_MAX_DIST;
    const minD = GAMEPLAY.FRUIT_SPAWN_MIN_DIST_TILES * this.world.scale;
    const minD2 = minD * minD;
    for (let attempt = 0; attempt < 16; attempt++) {
      const dx = Math.floor(Math.random() * (2 * maxDist + 1)) - maxDist;
      const dy = Math.floor(Math.random() * (2 * maxDist + 1)) - maxDist;
      const cx = pcx + dx;
      const cy = pcy + dy;
      const lx = Math.floor(Math.random() * CHUNK_SIZE);
      const ly = Math.floor(Math.random() * CHUNK_SIZE);
      const gx = cx * CHUNK_SIZE + lx;
      const gy = cy * CHUNK_SIZE + ly;
      const surf = this.world.surfaceHeightAt(gx, gy);
      if (!Number.isFinite(surf) || Number.isNaN(surf)) continue;
      const ppx = this.pacman.position.x;
      const ppy = this.pacman.position.y;
      const wx = gx * this.world.scale;
      const wy = gy * this.world.scale;
      if ((wx - ppx) * (wx - ppx) + (wy - ppy) * (wy - ppy) < minD2) continue;
      // Confirm tile type is FLOOR specifically (not WALL — those are
      // climbable but a fruit perched on top can be hard to reach).
      const tile = this._tileAtGlobal(gx, gy);
      if (tile !== TILE.FLOOR) continue;
      return { gx, gy, h: surf };
    }
    return null;
  }

  /** Look up the tile-type at a global grid coord. Returns null if unloaded. */
  _tileAtGlobal(gx, gy) {
    const cx = Math.floor(gx / CHUNK_SIZE);
    const cy = Math.floor(gy / CHUNK_SIZE);
    const k = `${cx},${cy}`;
    const chunk = this.world.chunks.get(k);
    if (!chunk) return null;
    const lx = gx - cx * CHUNK_SIZE;
    const ly = gy - cy * CHUNK_SIZE;
    return chunk.map[ly][lx];
  }

  _despawnFruit() {
    if (!this._activeFruit) return;
    this._activeFruit.removeFromScene(this.scene);
    this._activeFruit.dispose();
    this._activeFruit = null;
  }

  animate() {
    requestAnimationFrame(() => this.animate());
    this.update();
    this.renderer.render(this.scene, this.camera);
  }
}

document.addEventListener('DOMContentLoaded', () => {
  window.game = new Game();
});
