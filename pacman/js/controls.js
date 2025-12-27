/**
 * Controls Handler
 * Keyboard input for movement and game controls
 * Based on original KeyBinder.cpp
 */

import { DIRECTION, KEY_MODE, CONTROLS, GAME_STATES } from './constants.js';

export class Controls {
  constructor(game) {
    this.game = game;

    // Current input state
    this.keys = {
      up: false,
      down: false,
      left: false,
      right: false
    };

    // Current direction
    this.direction = DIRECTION.NONE;

    // Mouse look for FPS mode
    this.mouseSensitivity = CONTROLS.MOUSE_SENSITIVITY;
    this.isPointerLocked = false;

    // Bind event listeners
    this.bindEvents();
  }

  bindEvents() {
    // Keyboard down
    document.addEventListener('keydown', (e) => this.onKeyDown(e));

    // Keyboard up
    document.addEventListener('keyup', (e) => this.onKeyUp(e));

    // Mouse look for FPS mode
    this.setupMouseLook();

    // Touch controls for mobile
    this.setupTouchControls();
  }

  setupMouseLook() {
    const canvas = this.game.renderer?.domElement;
    if (!canvas) {
      // Retry after renderer is created
      setTimeout(() => this.setupMouseLook(), 100);
      return;
    }

    // Request pointer lock on click in first person mode (only during gameplay)
    canvas.addEventListener('click', () => {
      const isFirstPerson = this.game.cameraController?.currentMode === 2; // FPPOV
      const isPlaying = this.game.state === GAME_STATES.PLAYING;
      if (isFirstPerson && !this.isPointerLocked && isPlaying) {
        canvas.requestPointerLock();
      }
    });

    // Track pointer lock state
    document.addEventListener('pointerlockchange', () => {
      this.isPointerLocked = document.pointerLockElement === canvas;
    });

    // Handle mouse movement for looking around
    document.addEventListener('mousemove', (e) => this.onMouseMove(e));

    // Handle clicks during pointer lock (for intro skip, pause resume, etc.)
    // Use both mousedown and click to ensure we catch the event
    const handleLockedClick = () => {
      if (this.isPointerLocked) {
        // Skip intro if in intro state
        if (this.game.state === GAME_STATES.INTRO) {
          this.game.audioManager?.skipIntro();
        }
        // Resume if paused
        else if (this.game.state === GAME_STATES.PAUSED) {
          this.game.resumeGame();
        }
      }
    };

    document.addEventListener('mousedown', handleLockedClick);
    canvas.addEventListener('click', handleLockedClick);

    // Store canvas reference for auto-lock
    this.canvas = canvas;
  }

  /**
   * Request pointer lock for first-person mode
   * Called automatically when movement keys are pressed in FPPOV
   */
  requestPointerLockIfNeeded() {
    const isFirstPerson = this.game.cameraController?.currentMode === 2; // FPPOV
    const isPlaying = this.game.state === 'playing';
    if (isFirstPerson && !this.isPointerLocked && isPlaying && this.canvas) {
      this.canvas.requestPointerLock();
    }
  }

  onMouseMove(event) {
    const cameraMode = this.game.cameraController?.currentMode;

    // Handle BIRDSEYE_FOLLOW mode (mode 1) - mouse aims Pacman
    if (cameraMode === 1) {
      this.handleMouseAim(event);
      return;
    }

    // Only handle mouse look in first person mode with pointer lock
    if (!this.isPointerLocked) return;
    const isFirstPerson = cameraMode === 2; // FPPOV
    if (!isFirstPerson) return;

    const movementX = event.movementX || 0;
    const movementY = event.movementY || 0;

    // Update Pacman's yaw and pitch based on mouse movement
    if (this.game.pacman) {
      // Negative because moving mouse right should turn right (decrease yaw)
      this.game.pacman.addYaw(-movementX * this.mouseSensitivity);
      // Negative because moving mouse down should look down (decrease pitch)
      this.game.pacman.addPitch(-movementY * this.mouseSensitivity);
    }
  }

  /**
   * Handle mouse aiming in BIRDSEYE_FOLLOW mode
   * Pacman faces toward the mouse cursor position
   */
  handleMouseAim(event) {
    if (!this.game.pacman || this.game.state !== 'playing') return;

    const canvas = this.game.renderer?.domElement;
    if (!canvas) return;

    // Get canvas bounds
    const rect = canvas.getBoundingClientRect();

    // Calculate mouse position relative to canvas center
    const centerX = rect.left + rect.width / 2;
    const centerY = rect.top + rect.height / 2;
    const mouseX = event.clientX - centerX;
    const mouseY = event.clientY - centerY;

    // Calculate angle from center to mouse (in degrees)
    // atan2 gives angle from +X axis
    // Negate both axes to convert from screen coords to game coords:
    // - Screen Y is inverted (positive = down)
    // - Screen X needs flipping for correct left/right mapping
    const radian = Math.atan2(-mouseY, -mouseX);
    let degree = (radian * 180) / Math.PI;

    // Convert from screen angle to game yaw
    // After the axis flip: 0° = left, 90° = up, 180° = right, -90° = down
    // Game yaw: 0° = +Y (up), 90° = -X (left), 180° = -Y (down), 270° = +X (right)
    degree = 90 - degree;

    // Normalize to 0-360
    while (degree < 0) degree += 360;
    while (degree >= 360) degree -= 360;

    this.game.pacman.setYaw(degree);
  }

  onKeyDown(event) {
    // Don't intercept if modifier keys are pressed (allow Ctrl+R, Cmd+R, etc.)
    if (event.ctrlKey || event.metaKey || event.altKey) {
      return;
    }

    // Prevent default for game keys
    if (
      ['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Space', 'KeyP', 'KeyC', 'KeyR'].includes(
        event.code
      )
    ) {
      event.preventDefault();
    }

    switch (event.code) {
      // Movement keys
      case 'ArrowUp':
      case 'KeyW':
        this.keys.up = true;
        this.requestPointerLockIfNeeded();
        break;
      case 'ArrowDown':
      case 'KeyS':
        this.keys.down = true;
        this.requestPointerLockIfNeeded();
        break;
      case 'ArrowLeft':
      case 'KeyA':
        this.keys.left = true;
        this.requestPointerLockIfNeeded();
        break;
      case 'ArrowRight':
      case 'KeyD':
        this.keys.right = true;
        this.requestPointerLockIfNeeded();
        break;

      // Game controls
      case 'KeyP':
      case 'Escape':
        this.game.togglePause();
        break;
      case 'KeyC':
        this.cycleCamera();
        break;
      case 'KeyR':
        if (this.game.state === GAME_STATES.GAME_OVER || this.game.state === GAME_STATES.WIN) {
          this.game.restartGame();
        }
        break;
      case 'Space':
      case 'Enter':
        if (this.game.state === GAME_STATES.START) {
          this.game.startGame();
        } else if (this.game.state === GAME_STATES.PAUSED) {
          this.game.resumeGame();
        }
        break;

      // Debug/camera zoom
      case 'PageUp':
        if (this.game.cameraController) {
          this.game.cameraController.zoom(-10);
        }
        break;
      case 'PageDown':
        if (this.game.cameraController) {
          this.game.cameraController.zoom(10);
        }
        break;
    }

    this.updateDirection();
  }

  onKeyUp(event) {
    switch (event.code) {
      case 'ArrowUp':
      case 'KeyW':
        this.keys.up = false;
        break;
      case 'ArrowDown':
      case 'KeyS':
        this.keys.down = false;
        break;
      case 'ArrowLeft':
      case 'KeyA':
        this.keys.left = false;
        break;
      case 'ArrowRight':
      case 'KeyD':
        this.keys.right = false;
        break;
    }

    this.updateDirection();
  }

  updateDirection() {
    // Priority: most recently pressed or single key
    if (this.keys.up && !this.keys.down) {
      this.direction = DIRECTION.UP;
    } else if (this.keys.down && !this.keys.up) {
      this.direction = DIRECTION.DOWN;
    } else if (this.keys.left && !this.keys.right) {
      this.direction = DIRECTION.LEFT;
    } else if (this.keys.right && !this.keys.left) {
      this.direction = DIRECTION.RIGHT;
    } else {
      this.direction = DIRECTION.NONE;
    }
  }

  cycleCamera() {
    if (this.game.cameraController) {
      let newMode = this.game.cameraController.cycleMode();

      // Skip FPS mode on mobile (mode 2) - it requires mouse look which doesn't work on touch
      const isMobile = /Android|webOS|iPhone|iPad|iPod|BlackBerry|IEMobile|Opera Mini/i.test(
        navigator.userAgent
      );
      if (isMobile && newMode === 2) {
        newMode = this.game.cameraController.cycleMode(); // Skip to mode 0
      }

      this.game.updateCameraModeDisplay();

      // Save camera mode to localStorage
      localStorage.setItem('pacman-camera-mode', newMode.toString());

      // Hide/show Pacman for first person view
      const isFirstPerson = newMode === 2; // FPPOV
      const isFollowMode = newMode === 1; // BIRDSEYE_FOLLOW with mouse aim

      if (this.game.pacman) {
        this.game.pacman.setVisible(!isFirstPerson);

        // Set key mode based on camera mode
        // FPPOV and BIRDSEYE_FOLLOW use STRAFE mode (movement relative to facing)
        // Other modes use PERP mode (classic Pacman - arrows = world directions)
        const useStrafe = isFirstPerson || isFollowMode;
        this.game.pacman.setKeyMode(useStrafe ? KEY_MODE.STRAFE : KEY_MODE.PERP);

        // When entering FPPOV, clamp pitch so we're not looking too far up or down
        if (isFirstPerson) {
          this.game.pacman.clampPitch(CONTROLS.FPS_PITCH_CLAMP);
        }
      }

      // Show/hide mouth overlay and HUD for first person view
      const mouthOverlay = document.getElementById('fps-mouth-overlay');
      if (mouthOverlay) {
        mouthOverlay.classList.toggle('hidden', !isFirstPerson);
      }
      const fpsHud = document.getElementById('fps-hud');
      if (fpsHud) {
        fpsHud.classList.toggle('hidden', !isFirstPerson);
      }

      // Exit pointer lock when leaving first person mode
      if (!isFirstPerson && this.isPointerLocked) {
        document.exitPointerLock();
      }
    }
  }

  // Update mouth overlay animation based on pacman's mouth angle
  updateMouthOverlay(mouthAngle) {
    const topJaw = document.getElementById('top-jaw');
    const bottomJaw = document.getElementById('bottom-jaw');
    if (!topJaw || !bottomJaw) return;

    // mouthAngle is 0-45 degrees, map to overlay position
    const openAmount = (mouthAngle / 45) * 15; // max 15% movement

    // Animate top jaw up and bottom jaw down
    topJaw.setAttribute(
      'd',
      `M 0,0 L 100,0 L 100,${15 - openAmount} Q 50,${25 - openAmount * 1.5} 0,${15 - openAmount} Z`
    );
    bottomJaw.setAttribute(
      'd',
      `M 0,100 L 100,100 L 100,${85 + openAmount} Q 50,${75 + openAmount * 1.5} 0,${
        85 + openAmount
      } Z`
    );
  }

  getDirection() {
    return this.direction;
  }

  setupTouchControls() {
    // Create touch overlay for mobile
    const touchOverlay = document.createElement('div');
    touchOverlay.id = 'touch-controls';
    touchOverlay.innerHTML = `
      <style>
        #touch-controls {
          display: none;
          position: fixed;
          bottom: 20px;
          left: 50%;
          transform: translateX(-50%);
          z-index: 100;
        }
        @media (max-width: 768px), (pointer: coarse) {
          #touch-controls {
            display: flex;
            align-items: flex-end;
            gap: 20px;
          }
          #controls-help {
            display: none !important;
          }
        }
        .touch-dpad {
          display: grid;
          grid-template-columns: 60px 60px 60px;
          grid-template-rows: 60px 60px 60px;
          gap: 4px;
        }
        .touch-btn {
          width: 60px;
          height: 60px;
          background: rgba(255, 255, 255, 0.2);
          border: 2px solid rgba(255, 255, 255, 0.4);
          border-radius: 12px;
          display: flex;
          align-items: center;
          justify-content: center;
          font-size: 24px;
          color: white;
          user-select: none;
          -webkit-user-select: none;
          touch-action: manipulation;
        }
        .touch-btn:active {
          background: rgba(255, 255, 255, 0.4);
        }
        .touch-up { grid-column: 2; grid-row: 1; }
        .touch-left { grid-column: 1; grid-row: 2; }
        .touch-center { grid-column: 2; grid-row: 2; background: transparent; border: none; }
        .touch-right { grid-column: 3; grid-row: 2; }
        .touch-down { grid-column: 2; grid-row: 3; }
        
        .touch-action-buttons {
          display: flex;
          flex-direction: column;
          gap: 8px;
        }
        .touch-action-btn {
          width: 60px;
          height: 60px;
          background: rgba(0, 200, 255, 0.25);
          border: 2px solid rgba(0, 200, 255, 0.6);
          border-radius: 50%;
          display: flex;
          align-items: center;
          justify-content: center;
          font-size: 12px;
          font-weight: bold;
          color: #00c8ff;
          user-select: none;
          -webkit-user-select: none;
          touch-action: manipulation;
          text-transform: uppercase;
          letter-spacing: 0.5px;
        }
        .touch-action-btn:active {
          background: rgba(0, 200, 255, 0.5);
        }
        .touch-camera-btn {
          font-size: 20px;
        }
        .touch-pause-btn {
          background: rgba(255, 200, 0, 0.25);
          border-color: rgba(255, 200, 0, 0.6);
          color: #ffc800;
        }
        .touch-pause-btn:active {
          background: rgba(255, 200, 0, 0.5);
        }
      </style>
      <div class="touch-dpad">
        <button class="touch-btn touch-up" data-dir="up">▲</button>
        <button class="touch-btn touch-left" data-dir="left">◀</button>
        <button class="touch-btn touch-center"></button>
        <button class="touch-btn touch-right" data-dir="right">▶</button>
        <button class="touch-btn touch-down" data-dir="down">▼</button>
      </div>
      <div class="touch-action-buttons">
        <button class="touch-action-btn touch-camera-btn" id="touch-camera">📷</button>
        <button class="touch-action-btn touch-pause-btn" id="touch-pause">⏸</button>
      </div>
    `;
    document.body.appendChild(touchOverlay);

    // Bind touch events for D-pad
    const buttons = touchOverlay.querySelectorAll('.touch-btn[data-dir]');
    buttons.forEach((btn) => {
      const dir = btn.dataset.dir;

      btn.addEventListener('touchstart', (e) => {
        e.preventDefault();
        this.keys[dir] = true;
        this.updateDirection();
      });

      btn.addEventListener('touchend', (e) => {
        e.preventDefault();
        this.keys[dir] = false;
        this.updateDirection();
      });

      btn.addEventListener('touchcancel', (e) => {
        e.preventDefault();
        this.keys[dir] = false;
        this.updateDirection();
      });
    });

    // Camera toggle button
    const cameraBtn = document.getElementById('touch-camera');
    if (cameraBtn) {
      cameraBtn.addEventListener('touchstart', (e) => {
        e.preventDefault();
        this.cycleCamera();
      });
    }

    // Pause button
    const pauseBtn = document.getElementById('touch-pause');
    if (pauseBtn) {
      pauseBtn.addEventListener('touchstart', (e) => {
        e.preventDefault();
        this.game.togglePause();
      });
    }
  }

  // Reset all keys
  reset() {
    this.keys = {
      up: false,
      down: false,
      left: false,
      right: false
    };
    this.direction = DIRECTION.NONE;
  }
}
