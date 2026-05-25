/**
 * 3D Pacman Game - Main Entry Point
 * A Three.js recreation of the classic Pacman game
 * Originally by Erin Howard & Joe Heyming (UCSB)
 */

import * as THREE from 'three';
import { Level } from './level.js';
import { Pacman } from './pacman.js';
import { Ghost } from './ghost.js';
import { CameraController } from './camera.js';
import { Controls } from './controls.js';
import { AudioManager } from './audio.js';
import { Minimap } from './minimap.js';
import { GAME_STATES, GHOST_COLORS, GAMEPLAY, CAMERA, ANIMATION } from './constants.js';

class Game {
  constructor() {
    this.state = GAME_STATES.START;
    this.score = 0;
    this.highScore = parseInt(localStorage.getItem('pacman-high-score') || '0');
    this.lives = GAMEPLAY.STARTING_LIVES;
    this.level = null;
    this.pacman = null;
    this.ghosts = [];
    this.dots = [];
    this.powerPills = [];

    // Debug mode - check URL query string for debug=true
    const urlParams = new URLSearchParams(window.location.search);
    this.debugMode = urlParams.get('debug') === 'true';

    // Level selection - defaults to level1 if not specified
    const levelParam = urlParams.get('level');
    this.levelPath = levelParam ? `levels/${levelParam}.json` : 'levels/level1.json';

    // Number of ghosts - defaults to 4 if not specified
    const numGhostsParam = urlParams.get('numghosts');
    this.numGhosts = numGhostsParam !== null ? parseInt(numGhostsParam, 10) : 4;

    // Starting camera mode - birdseye, follow, fps
    // URL param takes priority, then localStorage, then default (null = birdseye)
    const startCameraParam = urlParams.get('startcamera');
    const savedCameraMode = localStorage.getItem('pacman-camera-mode');
    const parsedSavedMode = savedCameraMode !== null ? parseInt(savedCameraMode, 10) : null;
    // Validate saved mode is 0, 1, or 2
    let validSavedMode =
      parsedSavedMode !== null && parsedSavedMode >= 0 && parsedSavedMode <= 2
        ? parsedSavedMode
        : null;

    // Skip FPS mode (2) on mobile - it requires mouse look
    const isMobile = /Android|webOS|iPhone|iPad|iPod|BlackBerry|IEMobile|Opera Mini/i.test(
      navigator.userAgent
    );
    if (isMobile && validSavedMode === 2) {
      validSavedMode = 0; // Default to Bird's Eye on mobile
    }

    this.startCameraMode = this.parseCameraMode(startCameraParam) ?? validSavedMode;

    console.log(
      'URL search:',
      window.location.search,
      'debugMode:',
      this.debugMode,
      'numGhosts:',
      this.numGhosts,
      'startCamera:',
      startCameraParam
    );
    if (this.debugMode) {
      console.log('Debug mode enabled');
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
    this.powerModeTimer = 0;
    this.powerModeDuration = GAMEPLAY.POWER_MODE_DURATION;

    // DOM elements
    this.container = document.getElementById('game-container');
    this.scoreElement = document.getElementById('score');
    this.highScoreElement = document.getElementById('high-score');
    this.cameraModeElement = document.getElementById('camera-mode');
    this.livesElement = document.getElementById('lives');
    this.startScreen = document.getElementById('start-screen');

    // FPS HUD elements
    this.fpsHud = document.getElementById('fps-hud');
    this.minimap = new Minimap('minimap');
    this.introScreen = document.getElementById('intro-screen');

    // FPS Danger warning indicators (Three.js sprites)
    this.dangerIndicators = []; // Will be created after ghosts are loaded
    this.dangerWarningRadius = GAMEPLAY.DANGER_WARNING_RADIUS;

    // Reusable vectors to avoid allocations in hot paths
    this._tempGhostWorldPos = new THREE.Vector3();
    this._tempScreenPos = new THREE.Vector3();
    this.introCountdown = document.getElementById('intro-countdown');
    this.pauseScreen = document.getElementById('pause-screen');
    this.gameOverScreen = document.getElementById('game-over-screen');
    this.winScreen = document.getElementById('win-screen');

    this.init();
  }

  async init() {
    // Initialize Three.js
    this.initThreeJS();

    // Initialize audio
    this.audioManager = new AudioManager();

    // Disable audio in debug mode
    if (this.debugMode) {
      this.audioManager.setEnabled(false);
      console.log('Audio disabled in debug mode');
    }

    // Load level
    await this.loadLevel();

    // Initialize camera controller with level dimensions
    this.cameraController = new CameraController(
      this.camera,
      this.level.scale,
      this.level.width,
      this.level.height
    );

    // Initialize controls
    this.controls = new Controls(this);

    // Apply starting camera mode from URL param
    if (this.startCameraMode !== null) {
      this.cameraController.setMode(this.startCameraMode);
      const isFirstPerson = this.startCameraMode === 2; // FPPOV
      if (this.pacman) {
        this.pacman.setVisible(!isFirstPerson);
        // Only FPPOV uses STRAFE (movement relative to facing). Follow
        // now uses PERP (world-aligned movement) so the tap/joystick
        // joystick vector has stable meaning regardless of which way
        // Pacman is currently aimed.
        this.pacman.setKeyMode(isFirstPerson ? 1 : 2); // STRAFE : PERP
      }
      // Show/hide FPS overlays
      const mouthOverlay = document.getElementById('fps-mouth-overlay');
      if (mouthOverlay) {
        mouthOverlay.classList.toggle('hidden', !isFirstPerson);
      }
      if (this.fpsHud) {
        this.fpsHud.classList.toggle('hidden', !isFirstPerson);
      }
      // Danger indicators visibility is handled by updateDangerWarning/hideDangerWarning
      if (!isFirstPerson) {
        this.hideDangerWarning();
      }
    }

    // Setup UI
    this.updateUI();

    // Setup event listeners
    this.setupEventListeners();

    // Start render loop
    this.animate();
  }

  initThreeJS() {
    // Create scene
    this.scene = new THREE.Scene();
    this.scene.background = new THREE.Color(0x0a0a1a);

    // Create camera
    this.camera = new THREE.PerspectiveCamera(
      CAMERA.FOV,
      window.innerWidth / window.innerHeight,
      CAMERA.NEAR_PLANE,
      CAMERA.FAR_PLANE
    );
    this.camera.position.set(0, -50, 150);
    this.camera.lookAt(0, 0, 0);

    // Add camera to scene so child objects (like danger indicators) render
    this.scene.add(this.camera);

    // Create renderer
    this.renderer = new THREE.WebGLRenderer({ antialias: true });
    this.renderer.setSize(window.innerWidth, window.innerHeight);
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    this.container.insertBefore(this.renderer.domElement, this.container.firstChild);
    // Disable native touch gestures on the WebGL canvas so pointer
    // events can drive the in-game joystick / mouse-aim instead of
    // scrolling / zooming the page. Mirrored in style.css for the
    // browsers that ignore the JS hint.
    this.renderer.domElement.style.touchAction = 'none';

    // Add lighting (matching original Game.cpp lines 43-61)
    this.setupLighting();

    // Handle window resize
    window.addEventListener('resize', () => this.onWindowResize());
  }

  setupLighting() {
    // Ambient light (0.5, 0.5, 0.5 from original)
    const ambientLight = new THREE.AmbientLight(0x808080, 0.5);
    this.scene.add(ambientLight);

    // Main directional light (diffuse light from original)
    const directionalLight = new THREE.DirectionalLight(0xffffff, 0.8);
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

    // Add a subtle blue rim light for atmosphere
    const rimLight = new THREE.DirectionalLight(0x4488ff, 0.3);
    rimLight.position.set(-50, -50, 50);
    this.scene.add(rimLight);
  }

  async loadLevel() {
    this.level = new Level(this.levelPath);
    await this.level.load();

    // Add level geometry to scene
    this.level.addToScene(this.scene);

    // Create Pacman
    this.pacman = new Pacman(
      this.level.pacmanStart.x,
      this.level.pacmanStart.y,
      this.level.scale,
      this.level
    );
    this.pacman.addToScene(this.scene);

    // Create ghosts
    this.ghosts = [];
    // Ghost colors from constants: Blinky (Red), Inky (Cyan), Pinky (Pink), Clyde (Orange)
    const maxGhosts = Math.min(this.numGhosts, this.level.ghostHome.length, GHOST_COLORS.length);

    for (let i = 0; i < maxGhosts; i++) {
      const ghost = new Ghost(
        this.level.ghostHome[i].x,
        this.level.ghostHome[i].y,
        this.level.scale,
        this.level,
        GHOST_COLORS[i] || GHOST_COLORS[0]
      );
      ghost.addToScene(this.scene);
      this.ghosts.push(ghost);
    }

    // Set Blinky reference for Inky's AI (Inky uses Blinky's position)
    const blinky = this.ghosts.find((g) => g.ghostType === 'blinky');
    if (blinky) {
      this.ghosts.forEach((ghost) => {
        if (ghost.ghostType === 'inky') {
          ghost.setBlinkyRef(blinky);
        }
      });
    }

    // Store references to dots and power pills
    this.dots = this.level.dots;
    this.powerPills = this.level.powerPills;

    // Create danger indicator sprites for each ghost
    this.createDangerIndicators();
  }

  /**
   * Create danger indicator sprites for each ghost
   * These are arrow sprites attached to the camera so they stay in view
   * Each indicator matches the ghost's color (or blue when scared)
   */
  createDangerIndicators() {
    // Helper to create an arrow texture with a given color
    const createArrowTexture = (color) => {
      const canvas = document.createElement('canvas');
      canvas.width = 64;
      canvas.height = 64;
      const ctx = canvas.getContext('2d');

      ctx.fillStyle = color;
      ctx.shadowColor = color;
      ctx.shadowBlur = 15;

      // Triangle pointing right
      ctx.beginPath();
      ctx.moveTo(56, 32); // Point
      ctx.lineTo(16, 8); // Top
      ctx.lineTo(16, 56); // Bottom
      ctx.closePath();
      ctx.fill();

      // White border
      ctx.strokeStyle = '#ffffff';
      ctx.lineWidth = 3;
      ctx.stroke();

      const texture = new THREE.CanvasTexture(canvas);
      texture.needsUpdate = true;
      return texture;
    };

    // Create shared blue texture for scared ghosts
    this.scaredTexture = createArrowTexture('#00ffff');

    // Create a sprite for each ghost with its own colored texture
    this.dangerIndicators = this.ghosts.map((ghost, index) => {
      // Convert ghost color (hex number) to CSS color string
      const ghostColor = '#' + ghost.color.toString(16).padStart(6, '0');
      const normalTexture = createArrowTexture(ghostColor);

      const spriteMaterial = new THREE.SpriteMaterial({
        map: normalTexture,
        transparent: true,
        opacity: 0.9,
        depthTest: false,
        depthWrite: false,
        rotation: 0
      });

      const sprite = new THREE.Sprite(spriteMaterial);
      sprite.scale.set(0.4, 0.4, 1); // Small scale for camera-space
      sprite.visible = false;
      sprite.renderOrder = 999;

      // Store ghost index and normal texture
      sprite.userData.ghostIndex = index;
      sprite.userData.normalTexture = normalTexture;

      // Add as child of camera - positions are now in camera local space
      this.camera.add(sprite);
      return sprite;
    });
  }

  setupEventListeners() {
    // Start button
    document.getElementById('start-btn').addEventListener('click', () => {
      this.startGame();
    });

    // Restart button
    document.getElementById('restart-btn').addEventListener('click', () => {
      this.restartGame();
    });

    // Next level button
    document.getElementById('next-level-btn')?.addEventListener('click', () => {
      this.nextLevel();
    });

    // Camera toggle (tappable on mobile)
    const cameraToggle = document.getElementById('camera-toggle');
    if (cameraToggle) {
      cameraToggle.addEventListener('click', () => {
        if (this.controls) {
          this.controls.cycleCamera();
        }
      });
    }

    // Click to skip intro music
    this.introScreen.addEventListener('click', () => {
      if (this.state === GAME_STATES.INTRO) {
        this.audioManager.skipIntro();
      }
    });

    // Click on pause screen to resume
    this.pauseScreen.addEventListener('click', () => {
      this.resumeGame();
    });

    // Auto-pause when window loses focus
    window.addEventListener('blur', () => {
      if (this.state === GAME_STATES.PLAYING) {
        this.pauseGame();
      }
    });

    // Also pause when document visibility changes (tab switch)
    document.addEventListener('visibilitychange', () => {
      if (document.hidden && this.state === GAME_STATES.PLAYING) {
        this.pauseGame();
      }
    });
  }

  async startGame() {
    this.startScreen.classList.add('hidden');

    if (typeof window !== 'undefined' && window.trackEvent) {
      window.trackEvent('pacman_game_start', 'Pacman', 'start');
    }

    // In debug mode, skip the intro sound and start immediately
    if (this.debugMode) {
      this.state = GAME_STATES.PLAYING;
      return;
    }

    // Release pointer lock for intro screen interaction
    if (document.pointerLockElement) {
      document.exitPointerLock();
    }

    // Start with intro - play start sound and wait for it to finish
    this.state = GAME_STATES.INTRO;
    this.introScreen.classList.remove('hidden');

    // Update intro text
    if (this.introCountdown) {
      this.introCountdown.textContent = 'READY!';
    }

    // Play start sound and wait for it to finish
    await this.audioManager.playStart(true);

    // Start the game
    this.state = GAME_STATES.PLAYING;
    this.introScreen.classList.add('hidden');
  }

  pauseGame() {
    if (this.state === GAME_STATES.PLAYING) {
      this.state = GAME_STATES.PAUSED;
      this.pauseScreen.classList.remove('hidden');
      // Release pointer lock so user can click pause screen
      if (document.pointerLockElement) {
        document.exitPointerLock();
      }
    }
  }

  resumeGame() {
    if (this.state === GAME_STATES.PAUSED) {
      this.state = GAME_STATES.PLAYING;
      this.pauseScreen.classList.add('hidden');
    }
  }

  togglePause() {
    if (this.state === GAME_STATES.PLAYING) {
      this.pauseGame();
    } else if (this.state === GAME_STATES.PAUSED) {
      this.resumeGame();
    }
  }

  // Show intro sequence after losing a life (plays READY! and start music)
  async showIntro() {
    // In debug mode, skip the intro sound and start immediately
    if (this.debugMode) {
      this.state = GAME_STATES.PLAYING;
      return;
    }

    // Release pointer lock for intro screen interaction
    if (document.pointerLockElement) {
      document.exitPointerLock();
    }

    // Show intro screen
    this.state = GAME_STATES.INTRO;
    this.introScreen.classList.remove('hidden');

    // Update intro text
    if (this.introCountdown) {
      this.introCountdown.textContent = 'READY!';
    }

    // Play start sound and wait for it to finish
    await this.audioManager.playStart(true);

    // Resume the game
    this.state = GAME_STATES.PLAYING;
    this.introScreen.classList.add('hidden');
  }

  async restartGame() {
    if (typeof window !== 'undefined' && window.trackEvent) {
      window.trackEvent('pacman_game_start', 'Pacman', 'restart');
    }
    // Reset game state
    this.score = 0;
    this.lives = GAMEPLAY.STARTING_LIVES;
    this.powerModeTimer = 0;

    // Hide screens
    this.gameOverScreen.classList.add('hidden');
    this.winScreen.classList.add('hidden');
    this.startScreen.classList.add('hidden');

    // Reset entities
    this.pacman.reset();
    this.ghosts.forEach((ghost) => ghost.reset());
    this.level.resetDots();

    // Update UI
    this.updateUI();

    // In debug mode, skip the intro sound and start immediately
    if (this.debugMode) {
      this.state = GAME_STATES.PLAYING;
      return;
    }

    // Start with intro
    this.state = GAME_STATES.INTRO;
    this.introScreen.classList.remove('hidden');

    // Update intro text
    if (this.introCountdown) {
      this.introCountdown.textContent = 'READY!';
    }

    // Play start sound and wait for it to finish
    await this.audioManager.playStart(true);

    // Start the game
    this.state = GAME_STATES.PLAYING;
    this.introScreen.classList.add('hidden');
  }

  nextLevel() {
    // For now, just restart with same level
    this.restartGame();
  }

  gameOver() {
    this.state = GAME_STATES.GAME_OVER;
    document.getElementById('final-score').textContent = this.score;
    this.gameOverScreen.classList.remove('hidden');

    // Release pointer lock so user can click buttons
    if (document.pointerLockElement) {
      document.exitPointerLock();
    }

    // Update high score
    if (this.score > this.highScore) {
      this.highScore = this.score;
      localStorage.setItem('pacman-high-score', this.highScore.toString());
    }

    if (typeof window !== 'undefined' && window.trackEvent) {
      // Score → value so GA4 can compute avg/median. Label is a coarse
      // bucket so "Top event labels" gives a quick distribution without
      // exploding cardinality.
      const s = this.score;
      let bucket = '0';
      if (s >= 5000) bucket = '5000+';
      else if (s >= 2000) bucket = '2000-4999';
      else if (s >= 1000) bucket = '1000-1999';
      else if (s >= 500) bucket = '500-999';
      else if (s >= 100) bucket = '100-499';
      else if (s > 0) bucket = '1-99';
      window.trackEvent('pacman_game_over', 'Pacman', bucket, s);
    }
  }

  win() {
    this.state = GAME_STATES.WIN;
    document.getElementById('win-score').textContent = this.score;
    this.winScreen.classList.remove('hidden');

    // Release pointer lock so user can click buttons
    if (document.pointerLockElement) {
      document.exitPointerLock();
    }
  }

  addScore(points) {
    this.score += points;
    this.updateUI();

    // Update high score if needed
    if (this.score > this.highScore) {
      this.highScore = this.score;
      this.highScoreElement.textContent = this.highScore;
    }
  }

  loseLife() {
    this.lives--;
    this.updateLivesDisplay();

    // Enter death state to play animation
    this.state = GAME_STATES.DEATH;

    // Reset death camera state
    this.deathCameraAngle = 0;
    this.deathCameraTransitionTime = 0;
    this.deathCameraTransitionDuration = ANIMATION.DEATH_CAMERA_TRANSITION;

    // Save starting camera position for interpolation
    this.deathCameraStartPos = this.camera.position.clone();

    // Save current camera mode to restore later
    this.priorCameraMode = this.cameraController.currentMode;

    // Make Pacman visible for death animation (in case we're in FPS mode)
    this.pacman.setVisible(true);

    // Hide FPS overlays during death
    const mouthOverlay = document.getElementById('fps-mouth-overlay');
    if (mouthOverlay) mouthOverlay.classList.add('hidden');
    if (this.fpsHud) this.fpsHud.classList.add('hidden');
    this.hideDangerWarning();

    // Play death sound
    this.audioManager.playDeath();

    // Play death animation with callback
    this.pacman.playDeathAnimation(() => {
      this.onDeathAnimationComplete();
    });
  }

  onDeathAnimationComplete() {
    if (this.lives <= 0) {
      this.gameOver();
    } else {
      // Reset positions
      this.pacman.reset();
      this.ghosts.forEach((ghost) => ghost.reset());

      // Restore camera mode
      const isFirstPerson = this.priorCameraMode === 2;
      this.cameraController.setMode(this.priorCameraMode);

      // Only FPPOV uses STRAFE; everything else (including Follow)
      // stays on PERP so world-aligned input keeps working after the
      // respawn intro.
      this.pacman.setKeyMode(isFirstPerson ? 1 : 2); // STRAFE : PERP

      if (isFirstPerson) {
        this.pacman.setVisible(false);
        const mouthOverlay = document.getElementById('fps-mouth-overlay');
        if (mouthOverlay) mouthOverlay.classList.remove('hidden');
        if (this.fpsHud) this.fpsHud.classList.remove('hidden');
        // Danger indicators will be shown by updateDangerWarning in the game loop
      }

      // Go back to intro state and play start music
      this.showIntro();
    }
  }

  activatePowerMode() {
    this.powerModeTimer = this.powerModeDuration;
    this.ghosts.forEach((ghost) => ghost.setScared(true));
    this.audioManager.playPowerPill();
  }

  updateUI() {
    this.scoreElement.textContent = this.score;
    this.highScoreElement.textContent = this.highScore;
    this.updateLivesDisplay();
  }

  updateLivesDisplay() {
    const livesHTML = Array(this.lives)
      .fill('<span class="text-yellow-400 text-2xl">🟡</span>')
      .join('');
    this.livesElement.innerHTML = livesHTML;
  }

  updateCameraModeDisplay() {
    const modes = ["Bird's Eye", 'Follow (Mouse Aim)', 'First Person'];
    this.cameraModeElement.textContent = modes[this.cameraController.currentMode];
  }

  // Death camera - animates to overhead view, then slowly orbits
  updateDeathCamera() {
    const pacPos = this.pacman.getPosition();

    // Target overhead camera position
    const orbitRadius = ANIMATION.DEATH_CAMERA_ORBIT_RADIUS;
    const cameraHeight = ANIMATION.DEATH_CAMERA_HEIGHT;

    // Calculate target position with orbit
    this.deathCameraAngle += this.deltaTime * ANIMATION.DEATH_CAMERA_ORBIT_SPEED;
    const targetX = pacPos.x + Math.cos(this.deathCameraAngle) * orbitRadius;
    const targetY = pacPos.y + Math.sin(this.deathCameraAngle) * orbitRadius;
    const targetZ = cameraHeight;

    // Update transition time
    this.deathCameraTransitionTime += this.deltaTime;

    // Calculate interpolation factor with easing (ease-out cubic)
    const t = Math.min(this.deathCameraTransitionTime / this.deathCameraTransitionDuration, 1);
    const eased = 1 - Math.pow(1 - t, 3); // Ease-out cubic

    if (t < 1) {
      // Still transitioning - interpolate from start position to target
      const startPos = this.deathCameraStartPos;
      this.camera.position.set(
        startPos.x + (targetX - startPos.x) * eased,
        startPos.y + (targetY - startPos.y) * eased,
        startPos.z + (targetZ - startPos.z) * eased
      );
    } else {
      // Transition complete - just orbit
      this.camera.position.set(targetX, targetY, targetZ);
    }

    this.camera.lookAt(pacPos.x, pacPos.y, this.level.scale / 2);
  }

  // Parse camera mode from URL param string
  parseCameraMode(modeStr) {
    if (!modeStr) return null;
    const mode = modeStr.toLowerCase();
    switch (mode) {
      case 'birdseye':
      case 'birds':
      case '0':
        return 0; // BIRDSEYE
      case 'follow':
      case '1':
        return 1; // BIRDSEYE_FOLLOW
      case 'fps':
      case 'fppov':
      case 'firstperson':
      case 'first':
      case '2':
        return 2; // FPPOV
      default:
        return null;
    }
  }

  onWindowResize() {
    this.camera.aspect = window.innerWidth / window.innerHeight;
    this.camera.updateProjectionMatrix();
    this.renderer.setSize(window.innerWidth, window.innerHeight);

    // Update camera controller for new aspect ratio
    if (this.cameraController) {
      this.cameraController.onResize();
    }
  }

  update() {
    this.deltaTime = this.clock.getDelta();
    const elapsedTime = this.clock.getElapsedTime();

    // Update level animations (power pills, teleport tiles)
    if (this.level) {
      this.level.update(elapsedTime);
    }

    // Handle death state - just update death camera
    if (this.state === GAME_STATES.DEATH) {
      this.updateDeathCamera();
      return;
    }

    // Don't update during intro (waiting for sound) or other non-playing states
    if (this.state !== GAME_STATES.PLAYING) return;

    // Update power mode timer
    if (this.powerModeTimer > 0) {
      this.powerModeTimer -= this.deltaTime;
      if (this.powerModeTimer <= 0) {
        this.ghosts.forEach((ghost) => ghost.setScared(false));
      }
    }

    // Update Pacman.
    //
    // Birds-Eye Follow used to force `direction = 'up'` when the
    // player wasn't holding any key — relying on STRAFE keymode so
    // "up" meant "walk along facing toward the mouse". With Follow
    // now on PERP, that trick would mean "walk world +Y forever",
    // which made every other tap direction snap back to north.
    //
    // Instead, Follow now reads a continuous-angle move vector
    // (joystick deflection takes priority, falling back to compound
    // keyboard input) so the player can walk in any of 360°. Top-Down
    // and FPPOV still use the cardinal `direction` enum.
    const direction = this.controls.getDirection();
    const moveVec = this.cameraController.currentMode === 1 ? this.controls.getMoveVector() : null;
    this.pacman.update(this.deltaTime, direction, moveVec);

    // Update ghosts
    this.ghosts.forEach((ghost) => {
      ghost.update(this.deltaTime, this.pacman.getPosition(), this.pacman.isChasing());
    });

    // Check dot collection
    this.checkDotCollection();

    // Check ghost collision
    this.checkGhostCollision();

    // Check win condition
    if (this.level.allDotsCollected()) {
      this.win();
    }

    // Update camera with pacman position, yaw and pitch
    this.cameraController.update(
      this.pacman.getPosition(),
      this.pacman.getFacing(),
      this.pacman.getYaw(),
      this.pacman.getPitch()
    );

    // Update FPS HUD if in first person mode
    if (this.cameraController.currentMode === 2) {
      // FPPOV
      this.controls.updateMouthOverlay(this.pacman.getMouthAngle());
      this.minimap.update(this.level, this.pacman, this.ghosts);
      this.updateDangerWarning();
    } else {
      // Hide danger overlay when not in FPS mode
      this.hideDangerWarning();
    }
  }

  /**
   * Update danger warning indicators based on nearby dangerous ghosts
   * Sprites are in camera-local space, positioned at screen edges
   */
  updateDangerWarning() {
    if (!this.dangerIndicators || this.dangerIndicators.length === 0) return;

    const pacmanPos = this.pacman.getPosition();

    // Distance in front of camera (in camera local Z)
    const zDistance = -3; // Negative Z is forward in camera space

    // How far from center to place edge indicators (in camera local units)
    const edgeDistance = 1.8;

    // Check each ghost and update its indicator
    this.ghosts.forEach((ghost, index) => {
      const indicator = this.dangerIndicators[index];
      if (!indicator) return;

      // Hide if ghost is dead (eyes returning home)
      if (ghost.isDead()) {
        indicator.visible = false;
        return;
      }

      // Use blue texture when scared, normal color otherwise
      const isScared = ghost.isScared();
      indicator.material.map = isScared ? this.scaredTexture : indicator.userData.normalTexture;

      const ghostPos = ghost.getPosition();

      // Calculate distance in tiles
      const dx = ghostPos.x - pacmanPos.x;
      const dy = ghostPos.y - pacmanPos.y;
      const distanceTiles = Math.sqrt(dx * dx + dy * dy) / this.level.scale;

      // Hide if outside warning radius
      if (distanceTiles > this.dangerWarningRadius) {
        indicator.visible = false;
        return;
      }

      // Project ghost position to screen space (NDC: -1 to 1)
      // Reuse temp vectors to avoid allocations
      const ghostWorldPos = this._tempGhostWorldPos.set(
        ghostPos.x,
        ghostPos.y,
        ghostPos.z + this.level.scale / 2
      );
      const screenPos = this._tempScreenPos.copy(ghostWorldPos).project(this.camera);

      // Check if ghost is behind camera (z > 1 in NDC means behind)
      const isBehind = screenPos.z > 1;

      // Show indicator
      indicator.visible = true;

      let ndcX = screenPos.x;
      let ndcY = screenPos.y;

      if (isBehind) {
        // If behind, flip to opposite side of screen
        ndcX = -screenPos.x;
        ndcY = -screenPos.y;
      }

      // Calculate angle from center to ghost position
      const angle = Math.atan2(ndcY, ndcX);

      // Clamp to screen edge using angle
      // This keeps the indicator on a circular edge around the screen
      const clampedX = Math.cos(angle) * edgeDistance;
      const clampedY = Math.sin(angle) * edgeDistance;

      // Position in camera local space (x = right, y = up, z = -forward)
      // Account for aspect ratio
      const aspect = this.camera.aspect || 1;
      indicator.position.set(
        clampedX * aspect * 0.6, // Scale by aspect and shrink a bit
        clampedY * 0.6,
        zDistance
      );

      // Rotate arrow to point toward center (where the ghost direction is)
      // Arrow texture points right (+X), so rotate to point toward center
      const rotationToCenter = angle + Math.PI; // Point inward
      indicator.material.rotation = rotationToCenter;

      // Scale and opacity based on distance (closer = larger and more opaque)
      const proximityFactor = 1 - distanceTiles / this.dangerWarningRadius;
      const baseScale = 0.3 + proximityFactor * 0.3;
      const pulseScale = baseScale + Math.sin(Date.now() / 150) * 0.05;
      indicator.scale.set(pulseScale, pulseScale, 1);

      // Pulse opacity
      const baseOpacity = 0.6 + proximityFactor * 0.3;
      const pulseOpacity = baseOpacity + Math.sin(Date.now() / 150) * 0.2;
      indicator.material.opacity = Math.min(1, pulseOpacity);
    });
  }

  /**
   * Hide all danger warning indicators
   */
  hideDangerWarning() {
    if (!this.dangerIndicators) return;
    this.dangerIndicators.forEach((indicator) => {
      if (indicator) indicator.visible = false;
    });
  }

  checkDotCollection() {
    const pacmanPos = this.pacman.getPosition();
    const collectRadius = this.pacman.radius * GAMEPLAY.COLLISION_RADIUS_MULTIPLIER;

    // Check dots
    this.level.dots.forEach((dot, index) => {
      if (dot.visible && dot.position.distanceTo(pacmanPos) < collectRadius) {
        dot.visible = false;
        this.addScore(GAMEPLAY.SCORE_DOT);
        this.audioManager.playChomp();
        this.pacman.startChomp();
      }
    });

    // Check power pills
    this.level.powerPills.forEach((pill, index) => {
      if (pill.visible && pill.position.distanceTo(pacmanPos) < collectRadius) {
        pill.visible = false;
        this.addScore(GAMEPLAY.SCORE_POWER_PILL);
        this.activatePowerMode();
        this.pacman.startChomp();
      }
    });
  }

  checkGhostCollision() {
    const pacmanPos = this.pacman.getPosition();
    const collisionRadius = this.pacman.radius + GAMEPLAY.GHOST_COLLISION_PADDING;

    this.ghosts.forEach((ghost) => {
      if (ghost.isDead()) return;

      const distance = ghost.getPosition().distanceTo(pacmanPos);

      if (distance < collisionRadius) {
        if (ghost.isScared()) {
          // Eat the ghost
          ghost.die();
          this.addScore(GAMEPLAY.SCORE_GHOST);
          this.audioManager.playGhostEaten();
        } else {
          // Pacman dies
          this.loseLife();
        }
      }
    });
  }

  animate() {
    requestAnimationFrame(() => this.animate());

    this.update();
    this.renderer.render(this.scene, this.camera);
  }
}

// Start the game when DOM is ready
document.addEventListener('DOMContentLoaded', () => {
  window.game = new Game();
});
