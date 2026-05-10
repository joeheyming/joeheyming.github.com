/**
 * Controls Handler
 * Keyboard input for movement and game controls
 * Based on original KeyBinder.cpp
 */

import { DIRECTION, KEY_MODE, CONTROLS, GAME_STATES } from './constants.js';

export class Controls {
  constructor(game) {
    this.game = game;

    // Current keyboard input state
    this.keys = {
      up: false,
      down: false,
      left: false,
      right: false
    };
    // Touch-driven directional keys (canvas joystick). Held in a
    // separate slot so a finger lift doesn't clobber a keyboard arrow,
    // and vice versa. Merged with `keys` in `updateDirection()`.
    // Snapped to the dominant axis (4-way) — drives Top-Down's classic
    // Pacman feel.
    this._touchKeys = { up: false, down: false, left: false, right: false };
    // Continuous-angle joystick vector in WORLD space (`x` east+/west−,
    // `y` north+/south−). `null` when the joystick is idle or inside
    // the dead zone. Used by Birds-Eye Follow so the player can walk
    // in any of 360°.
    this._joystickVec = null;
    // Active pointer id for the canvas joystick (so multi-touch noise
    // doesn't hijack the drive in Top-Down / Follow).
    this._activePointerId = null;
    // FPPOV uses a twin-stick scheme on mobile: left-half drag = walk
    // joystick (free-floating, anchored at the first touch), right-half
    // drag = look around (yaw + pitch from drag delta — mimics the
    // desktop pointer-lock mouse-look). Tracked with independent
    // pointer slots so two fingers can drive both at once.
    this._fpsWalkPointer = null; // { pointerId, anchorX, anchorY }
    this._fpsLookPointer = null; // { pointerId, lastX, lastY }

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
    // Merge keyboard + touch joystick inputs. Touch keys are 4-way
    // (dominant axis only), so the merged result is also 4-way — keeps
    // Top-Down on the classic Pacman cardinal grid.
    const up = this.keys.up || this._touchKeys.up;
    const down = this.keys.down || this._touchKeys.down;
    const left = this.keys.left || this._touchKeys.left;
    const right = this.keys.right || this._touchKeys.right;

    if (up && !down) {
      this.direction = DIRECTION.UP;
    } else if (down && !up) {
      this.direction = DIRECTION.DOWN;
    } else if (left && !right) {
      this.direction = DIRECTION.LEFT;
    } else if (right && !left) {
      this.direction = DIRECTION.RIGHT;
    } else {
      this.direction = DIRECTION.NONE;
    }
  }

  /**
   * Continuous-angle world-space movement vector. Returns a unit vector
   * `{x, y}` (or `null` if no input). X = world east(+)/west(−),
   * Y = world north(+)/south(−).
   *
   * Source of truth (in priority order):
   *   1. The live joystick deflection (`_joystickVec`) — supplies any
   *      angle in 360°. Used for Birds-Eye Follow.
   *   2. Keyboard arrows — fall back to an 8-way unit vector composed
   *      from the held keys (so W+D walks north-east).
   *
   * Top-Down doesn't call this; it reads the cardinal `direction` enum
   * from `updateDirection`, which keeps the 4-way Pacman feel.
   */
  getMoveVector() {
    if (this._joystickVec) return this._joystickVec;
    let dx = 0;
    let dy = 0;
    if (this.keys.up) dy += 1;
    if (this.keys.down) dy -= 1;
    if (this.keys.left) dx -= 1;
    if (this.keys.right) dx += 1;
    if (dx === 0 && dy === 0) return null;
    const m = Math.hypot(dx, dy);
    return { x: dx / m, y: dy / m };
  }

  cycleCamera() {
    if (this.game.cameraController) {
      const newMode = this.game.cameraController.cycleMode();
      // FPPOV is now reachable on mobile too — the canvas pointer
      // pipeline switches into a twin-stick scheme (left-half drag =
      // walk, right-half drag = look) so phones don't need pointer
      // lock to use first-person.

      this.game.updateCameraModeDisplay();

      // Save camera mode to localStorage
      localStorage.setItem('pacman-camera-mode', newMode.toString());

      // Hide/show Pacman for first person view
      const isFirstPerson = newMode === 2; // FPPOV

      if (this.game.pacman) {
        this.game.pacman.setVisible(!isFirstPerson);

        // Only FPPOV uses STRAFE (movement relative to facing). Follow
        // and Top-Down use PERP (world-aligned movement) so the
        // tap/joystick vector keeps a stable meaning regardless of
        // which way Pacman is currently aimed.
        this.game.pacman.setKeyMode(isFirstPerson ? KEY_MODE.STRAFE : KEY_MODE.PERP);

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
    // Mobile uses a single "tap-anywhere on the canvas" virtual
    // joystick — no D-pad. The drive vector relative to the canvas
    // centre powers BOTH the cardinal `_touchKeys` (4-way snap, used
    // by Top-Down) AND the continuous-angle `_joystickVec` (any of
    // 360°, used by Birds-Eye Follow). FPPOV ignores the canvas
    // joystick — that mode wants pointer-locked mouse look instead.
    //
    // The View / Pause action buttons stay on a small column in the
    // bottom-right so they don't fight with the canvas drive zone.
    const touchOverlay = document.createElement('div');
    touchOverlay.id = 'touch-controls';
    touchOverlay.innerHTML = `
      <style>
        #touch-controls {
          display: none;
          position: fixed;
          /* bottom: 144px keeps the VIEW / PAUSE column entirely
             above the global "related projects" widget (share.js
             renders a ~48px bottom-right toggle around bottom:80px
             on mobile); without this clearance they stack on the
             same pixel. Right edge stays aligned with the toggle. */
          bottom: 144px;
          right: 12px;
          z-index: 100;
        }
        @media (max-width: 768px), (pointer: coarse) {
          #touch-controls {
            display: flex;
            align-items: flex-end;
            gap: 12px;
          }
          #controls-help {
            display: none !important;
          }
        }
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
        .touch-pause-btn {
          background: rgba(255, 200, 0, 0.25);
          border-color: rgba(255, 200, 0, 0.6);
          color: #ffc800;
        }
        .touch-pause-btn:active {
          background: rgba(255, 200, 0, 0.5);
        }
      </style>
      <div class="touch-action-buttons">
        <button class="touch-action-btn touch-camera-btn" id="touch-camera" aria-label="Cycle view">VIEW</button>
        <button class="touch-action-btn touch-pause-btn" id="touch-pause" aria-label="Pause">⏸</button>
      </div>
    `;
    document.body.appendChild(touchOverlay);

    // View / camera-cycle button
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

    // Bind the canvas-wide joystick once the renderer has a canvas.
    this.setupCanvasJoystick();
  }

  /**
   * Canvas-wide virtual joystick.
   *
   * Modes 0 (Top-Down) and 1 (Birds-Eye Follow):
   *   The drive vector is the offset from the canvas centre to the
   *   active pointer. Powers two outputs at once:
   *     - `_touchKeys`     — 4-way snap (dominant axis), Top-Down's
   *                           classic Pacman feel via `updateDirection`.
   *     - `_joystickVec`   — continuous-angle world-space unit vector,
   *                           Follow uses it (and aims Pacman's yaw
   *                           at the tap, mouse-aim style).
   *
   * Mode 2 (FPPOV) on **touch only**:
   *   Twin-stick. Left-half drag = walk joystick (free-floating,
   *   anchored at first touch — `_touchKeys` feed STRAFE keymode so
   *   "up" walks forward along facing). Right-half drag = look-around
   *   (yaw + pitch deltas, same math as the desktop mouse-look).
   *   Two fingers can drive both at once.
   *
   *   On desktop FPPOV the existing pointer-lock + `onMouseMove` path
   *   stays in charge — twin-stick gates on `pointerType === 'touch'`.
   */
  setupCanvasJoystick() {
    const canvas = this.game.renderer?.domElement;
    if (!canvas) {
      setTimeout(() => this.setupCanvasJoystick(), 100);
      return;
    }
    canvas.style.touchAction = 'none';

    const getMode = () => this.game.cameraController?.currentMode;

    const updateJoystick = (dx, dy, dead = 18) => {
      const r = Math.hypot(dx, dy);
      if (r < dead) {
        this._touchKeys.up = false;
        this._touchKeys.down = false;
        this._touchKeys.left = false;
        this._touchKeys.right = false;
        this._joystickVec = null;
      } else {
        // Continuous vector: flip Y because screen +Y is DOWN but
        // world +Y / "up arrow" is north.
        this._joystickVec = { x: dx / r, y: -dy / r };
        // 4-way snap (dominant axis) — Top-Down's classic feel and
        // also FPPOV's STRAFE keys (forward/back/strafe).
        if (Math.abs(dx) > Math.abs(dy)) {
          this._touchKeys.up = false;
          this._touchKeys.down = false;
          this._touchKeys.left = dx < 0;
          this._touchKeys.right = dx > 0;
        } else {
          this._touchKeys.left = false;
          this._touchKeys.right = false;
          this._touchKeys.up = dy < 0;
          this._touchKeys.down = dy > 0;
        }
      }
      this.updateDirection();
    };

    const clearJoystick = () => {
      this._touchKeys.up = false;
      this._touchKeys.down = false;
      this._touchKeys.left = false;
      this._touchKeys.right = false;
      this._joystickVec = null;
      this.updateDirection();
    };

    // Mode 0 / 1 — centre-anchored joystick on a single primary pointer.
    const driveFromPointer = (ev) => {
      const rect = canvas.getBoundingClientRect();
      const cx = rect.left + rect.width / 2;
      const cy = rect.top + rect.height / 2;
      const dx = ev.clientX - cx;
      const dy = ev.clientY - cy;
      updateJoystick(dx, dy);
      // In Birds-Eye Follow, ALSO aim Pacman toward the tap location
      // (mouse-aim semantics, but driven by a finger).
      if (getMode() === 1) {
        this.handleMouseAim(ev);
      }
    };

    // Mode 2 (FPPOV touch) — twin-stick.
    const fpsLookSensitivity = 0.18; // ≈ MOUSE_SENSITIVITY * 0.6, tuned by feel.
    const fpsWalkDeadZone = 28;
    const handleFpsPointerDown = (ev) => {
      const rect = canvas.getBoundingClientRect();
      const onLeftHalf = ev.clientX - rect.left < rect.width / 2;
      if (onLeftHalf) {
        if (this._fpsWalkPointer) return;
        this._fpsWalkPointer = {
          pointerId: ev.pointerId,
          anchorX: ev.clientX,
          anchorY: ev.clientY
        };
        // Tap without drag shouldn't auto-walk — wait for the user to
        // pull past the dead zone.
        clearJoystick();
      } else {
        if (this._fpsLookPointer) return;
        this._fpsLookPointer = {
          pointerId: ev.pointerId,
          lastX: ev.clientX,
          lastY: ev.clientY
        };
      }
    };
    const handleFpsPointerMove = (ev) => {
      if (this._fpsWalkPointer && ev.pointerId === this._fpsWalkPointer.pointerId) {
        const dx = ev.clientX - this._fpsWalkPointer.anchorX;
        const dy = ev.clientY - this._fpsWalkPointer.anchorY;
        // FPPOV is on STRAFE keymode, so _touchKeys.up = walk forward
        // along facing, .left = strafe left, etc. The free-floating
        // joystick "follows the thumb" from its initial touch.
        updateJoystick(dx, dy, fpsWalkDeadZone);
      }
      if (this._fpsLookPointer && ev.pointerId === this._fpsLookPointer.pointerId) {
        const dx = ev.clientX - this._fpsLookPointer.lastX;
        const dy = ev.clientY - this._fpsLookPointer.lastY;
        // Same math as `onMouseMove`'s mouse-look so dragging right
        // turns Pacman right and dragging up looks up.
        if (this.game.pacman) {
          this.game.pacman.addYaw(-dx * fpsLookSensitivity);
          this.game.pacman.addPitch(-dy * fpsLookSensitivity);
        }
        this._fpsLookPointer.lastX = ev.clientX;
        this._fpsLookPointer.lastY = ev.clientY;
      }
    };
    const handleFpsPointerUp = (ev) => {
      if (this._fpsWalkPointer && ev.pointerId === this._fpsWalkPointer.pointerId) {
        this._fpsWalkPointer = null;
        clearJoystick();
      }
      if (this._fpsLookPointer && ev.pointerId === this._fpsLookPointer.pointerId) {
        this._fpsLookPointer = null;
      }
    };

    canvas.addEventListener('pointerdown', (ev) => {
      if (this.game.state !== GAME_STATES.PLAYING) return;
      ev.preventDefault();
      if (getMode() === 2) {
        // Twin-stick is for touch only. Desktop FPPOV stays on the
        // existing pointer-lock + `onMouseMove` path.
        if (ev.pointerType === 'touch') handleFpsPointerDown(ev);
        return;
      }
      // Modes 0 / 1 — centre-anchored joystick (single primary pointer).
      if (this._activePointerId !== null) return;
      this._activePointerId = ev.pointerId;
      driveFromPointer(ev);
    });

    canvas.addEventListener('pointermove', (ev) => {
      if (getMode() === 2) {
        if (ev.pointerType === 'touch') handleFpsPointerMove(ev);
        return;
      }
      if (this._activePointerId !== ev.pointerId) return;
      ev.preventDefault();
      driveFromPointer(ev);
    });

    const releasePointer = (ev) => {
      if (getMode() === 2) {
        if (ev.pointerType === 'touch') handleFpsPointerUp(ev);
        return;
      }
      if (this._activePointerId !== ev.pointerId) return;
      this._activePointerId = null;
      clearJoystick();
    };
    canvas.addEventListener('pointerup', releasePointer);
    canvas.addEventListener('pointercancel', releasePointer);
    canvas.addEventListener('pointerleave', releasePointer);
  }

  // Reset all keys
  reset() {
    this.keys = {
      up: false,
      down: false,
      left: false,
      right: false
    };
    this._touchKeys = { up: false, down: false, left: false, right: false };
    this._joystickVec = null;
    this._activePointerId = null;
    this._fpsWalkPointer = null;
    this._fpsLookPointer = null;
    this.direction = DIRECTION.NONE;
  }
}
