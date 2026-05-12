/**
 * Controls Handler
 * Keyboard input for movement and game controls
 * Based on original KeyBinder.cpp
 */

import { DIRECTION, KEY_MODE, CONTROLS, GAME_STATES, GAMEPLAY } from './constants.js';

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
    // Touch-driven directional keys (tap-and-hold on the canvas). Held in
    // a separate slot so a finger lift doesn't clobber a keyboard arrow,
    // and vice versa. Merged with `keys` in updateDirection(). These are
    // 4-way snapped to the dominant axis — used by Top-Down for that
    // classic Pacman 4-way feel.
    this._touchKeys = { up: false, down: false, left: false, right: false };
    // Continuous-angle joystick vector in WORLD space (`x` east+/west−,
    // `y` north+/south−). `null` when the joystick is idle or inside
    // the dead zone. Used by Birds-Eye Follow so the player can walk in
    // any direction (not just 4 / 8 sectors).
    this._joystickVec = null;
    // Active touch anchor (where the player first tapped). The drag delta
    // from this anchor to the live pointer position drives the touch
    // direction so the player effectively gets a virtual joystick under
    // their finger.
    this._touchAnchor = null;
    // FPPOV uses a twin-stick scheme on mobile: left-half drag = walk
    // joystick (free-floating, anchored at the first touch on that
    // side), right-half drag = look around (yaw/pitch from drag delta,
    // mimicking the desktop pointer-lock mouse-look). Tracked with
    // independent pointer slots so two fingers can drive both at once.
    this._fpsWalkPointer = null; // { pointerId, anchorX, anchorY }
    this._fpsLookPointer = null; // { pointerId, lastX, lastY }
    // Last "tap" (short press, no drag) on the canvas. Used by the
    // double-tap-to-sprint gesture in Top-Down / Birds-Eye Follow.
    // Was double-tap-to-jump previously, but with a dedicated JUMP
    // touch button that gesture became redundant — sprint is the more
    // useful repurpose because it gives the player a way to "go
    // faster" via a touch-only escape gesture.
    this._lastTapTime = 0;
    this._lastTapX = 0;
    this._lastTapY = 0;
    // Tier 5 — double-tap-direction-to-sprint detector (keyboard).
    // Tracks the most recent canonicalised movement key ('up', 'down',
    // 'left', 'right') and its press time so the second hit of the
    // same direction within SPRINT_DOUBLE_TAP_MS triggers
    // game.trySprint(). Auto-repeat keydown events (event.repeat ===
    // true) are ignored to avoid a held key spuriously dashing.
    this._lastDirKey = null;
    this._lastDirKeyTime = 0;
    // Pointerdown bookkeeping — duration + drag-distance let us tell a
    // tap apart from a drag at pointerup time.
    this._pointerDownTime = 0;
    this._pointerDownX = 0;
    this._pointerDownY = 0;
    this._pointerMaxDrag = 0;

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

    // Tap-and-hold on the game canvas → virtual joystick. Works on both
    // touch and mouse so dev testing covers it. Only active in non-FPPOV
    // modes (FPPOV uses mouse-look and pointer lock).
    this.setupCanvasTapControl();
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

    // Canonicalise to a direction token for the sprint double-tap
    // detector. Keys that aren't movement keys yield null and skip the
    // sprint check below.
    const dirToken = (() => {
      switch (event.code) {
        case 'ArrowUp':
        case 'KeyW':
          return 'up';
        case 'ArrowDown':
        case 'KeyS':
          return 'down';
        case 'ArrowLeft':
        case 'KeyA':
          return 'left';
        case 'ArrowRight':
        case 'KeyD':
          return 'right';
        default:
          return null;
      }
    })();

    // Tier 5 — double-tap-direction-to-sprint. Only counts deliberate
    // re-presses (event.repeat === false) of the SAME direction key
    // within SPRINT_DOUBLE_TAP_MS. Different directions or held-down
    // auto-repeat are treated as fresh first-taps. Reset after a
    // successful trigger so a third tap doesn't immediately re-fire.
    if (dirToken && !event.repeat && this.game.state === GAME_STATES.PLAYING) {
      const now = performance.now();
      if (
        this._lastDirKey === dirToken &&
        now - this._lastDirKeyTime < GAMEPLAY.SPRINT_DOUBLE_TAP_MS
      ) {
        this.game.trySprint?.();
        this._lastDirKey = null;
      } else {
        this._lastDirKey = dirToken;
        this._lastDirKeyTime = now;
      }
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
        } else if (this.game.state === GAME_STATES.PLAYING) {
          // In-game: Space jumps. (Enter is left as a no-op so Pacman can't
          // accidentally jump from the keyboard's `Enter` mid-gameplay; this
          // keeps Space's role as the canonical "act" button across menus
          // and gameplay.)
          if (event.code === 'Space') this.game.tryJump();
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
    // Merge keyboard `keys` with touch-driven `_touchKeys` so either
    // input source can drive movement without stomping the other.
    const up = this.keys.up || this._touchKeys.up;
    const down = this.keys.down || this._touchKeys.down;
    const left = this.keys.left || this._touchKeys.left;
    const right = this.keys.right || this._touchKeys.right;
    // Priority: most recently pressed or single key
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

  /**
   * Tap-and-hold on the game canvas to walk Pacman in the dragged
   * direction. Acts like a free-floating virtual joystick rooted where
   * the finger first touched.
   *
   * Disabled in first-person mode because that camera uses click for
   * pointer lock and mouse-look for steering — a tap-to-move would
   * fight with both. Also disabled while the start menu / pause /
   * game-over overlays are showing so menu clicks don't move Pacman.
   */
  setupCanvasTapControl() {
    const canvas = this.game.renderer?.domElement;
    if (!canvas) {
      setTimeout(() => this.setupCanvasTapControl(), 100);
      return;
    }

    // Without this, a touch-drag on the canvas pulls the whole page
    // around (scrollbars, pinch-zoom, etc.), which the user reported
    // when trying to play in Birds-Eye Follow on mobile.
    canvas.style.touchAction = 'none';

    // Camera modes:
    //   0 = TOP_DOWN          → tap drives a centre-anchored joystick.
    //                            Double-tap = jump.
    //   1 = BIRDSEYE_FOLLOW   → same joystick PLUS Pacman's yaw is
    //                            aimed at the tap (mouse-look feel).
    //                            Double-tap = jump.
    //   2 = FPPOV             → twin-stick: left-half drag = walk
    //                            (STRAFE keys via _touchKeys),
    //                            right-half drag = look around
    //                            (yaw + pitch from drag delta).
    //                            On desktop this branch is ignored
    //                            because pointer-lock + mouse-look
    //                            still does the heavy lifting.
    const getMode = () => this.game.cameraController?.currentMode;

    const clearTouchKeys = () => {
      this._touchKeys.up = false;
      this._touchKeys.down = false;
      this._touchKeys.left = false;
      this._touchKeys.right = false;
      this._joystickVec = null;
      this.updateDirection();
    };

    const clearTouch = () => {
      this._touchAnchor = null;
      clearTouchKeys();
    };

    const clearFpsPointers = () => {
      this._fpsWalkPointer = null;
      this._fpsLookPointer = null;
      clearTouchKeys();
    };

    // Double-tap detector. Only counts pointers that pressed and
    // released within DOUBLE_TAP_MS without moving more than
    // DOUBLE_TAP_SLOP px. On the second qualifying tap we trigger
    // trySprint in non-FPPOV modes (FPPOV uses the canvas for
    // look-around so a tap-anywhere gesture would fight the camera;
    // FPPOV users dash via the dedicated DASH touch button instead).
    // Was tryJump originally — rebound to sprint in Tier 5 because
    // the touch UI has a dedicated JUMP button, so sprint is the
    // more useful gesture-only repurpose. Top-Down / Birds-Eye Follow
    // touch users can sprint via either this gesture or the DASH button.
    const DOUBLE_TAP_MS = 320;
    const DOUBLE_TAP_SLOP = 22;
    const TAP_MAX_DURATION_MS = 250;
    const tryDoubleTapSprint = (clientX, clientY, durationMs, maxDrag) => {
      if (durationMs > TAP_MAX_DURATION_MS) return;
      if (maxDrag > DOUBLE_TAP_SLOP) return;
      const now = performance.now();
      const dt = now - this._lastTapTime;
      const dx = clientX - this._lastTapX;
      const dy = clientY - this._lastTapY;
      const dist = Math.hypot(dx, dy);
      if (dt < DOUBLE_TAP_MS && dist < DOUBLE_TAP_SLOP) {
        const m = getMode();
        if (m === 0 || m === 1) {
          this.game.trySprint?.();
        }
        // Reset so a third tap doesn't compound into a chain.
        this._lastTapTime = 0;
      } else {
        this._lastTapTime = now;
        this._lastTapX = clientX;
        this._lastTapY = clientY;
      }
    };

    // Translate the joystick deflection into TWO outputs:
    //
    //  1. `_touchKeys`  — 4-way snap (the dominant axis wins). Drives
    //     Top-Down so it keeps the classic 4-way Pacman feel.
    //
    //  2. `_joystickVec` — continuous-angle world-space unit vector
    //     (any of 360°). Drives Birds-Eye Follow so a tap at any angle
    //     walks Pacman in exactly that direction.
    //
    // `dead` is the radius of the neutral zone — touches inside it
    // produce no movement.
    const updateJoystick = (dx, dy, dead = 18) => {
      const r = Math.hypot(dx, dy);
      if (r < dead) {
        this._touchKeys.up = false;
        this._touchKeys.down = false;
        this._touchKeys.left = false;
        this._touchKeys.right = false;
        this._joystickVec = null;
      } else {
        // Continuous vector: flip Y because screen +Y is DOWN but world
        // +Y / "up arrow" is north.
        this._joystickVec = { x: dx / r, y: -dy / r };

        // Cardinal 4-way snap for Top-Down — pick the dominant axis.
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

    // Single source of truth for "given a pointer at (clientX, clientY),
    // drive Pacman" in modes 0/1. Used by both pointerdown and
    // pointermove so the initial tap is responsive (no need to wiggle
    // a finger before Pacman starts moving).
    //
    // The joystick is centre-anchored — the canvas centre is the
    // neutral point and the offset of the touch from the centre is the
    // joystick deflection. This unifies both modes:
    //   - Top-Down → tap-and-hold near an edge walks Pacman that way.
    //   - Follow   → same, AND Pacman's yaw is set to face the tap so
    //                he visually aims at the touch like a mouse cursor.
    const driveFromPointer = (ev) => {
      const rect = canvas.getBoundingClientRect();
      const dx = ev.clientX - (rect.left + rect.width / 2);
      const dy = ev.clientY - (rect.top + rect.height / 2);
      // Scale the dead zone with canvas size so it feels right on both
      // a phone and a desktop browser. ~6% of the shorter axis.
      const dead = Math.max(20, 0.06 * Math.min(rect.width, rect.height));
      updateJoystick(dx, dy, dead);
      if (getMode() === 1) this.handleMouseAim(ev);
    };

    // FPPOV twin-stick: walk pointer is on the LEFT half of the
    // canvas, look pointer is on the RIGHT half. Each pointer is
    // tracked by its `pointerId` so two fingers can drive both at
    // once without colliding.
    const fpsLookSensitivity = 0.18; // tuned by feel — close to MOUSE_SENSITIVITY * 0.6.
    const fpsWalkDeadZone = 28; // px from anchor before WASD ignites.
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
        // Start with a clean joystick — it ignites only after the user
        // drags past the dead zone. A pure tap doesn't auto-walk.
        clearTouchKeys();
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
        // FPPOV runs on STRAFE keymode, so _touchKeys.up = walk
        // forward (along facing), .left = strafe left, etc. The
        // free-floating joystick is anchored at the first touch so
        // the stick "follows the thumb".
        updateJoystick(dx, dy, fpsWalkDeadZone);
      }
      if (this._fpsLookPointer && ev.pointerId === this._fpsLookPointer.pointerId) {
        const dx = ev.clientX - this._fpsLookPointer.lastX;
        const dy = ev.clientY - this._fpsLookPointer.lastY;
        // Mirrors `onMouseMove`'s mouse-look math so dragging right
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
        clearTouchKeys();
      }
      if (this._fpsLookPointer && ev.pointerId === this._fpsLookPointer.pointerId) {
        this._fpsLookPointer = null;
      }
    };

    canvas.addEventListener('pointerdown', (ev) => {
      if (this.game.state !== GAME_STATES.PLAYING) return;
      // Block default touch behaviour (page scroll / zoom / context menu).
      ev.preventDefault();
      // Bookkeeping for the double-tap-to-jump detector. Tracks the
      // press's start so pointerup can decide if this was a tap or a
      // drag.
      this._pointerDownTime = performance.now();
      this._pointerDownX = ev.clientX;
      this._pointerDownY = ev.clientY;
      this._pointerMaxDrag = 0;
      try {
        canvas.setPointerCapture(ev.pointerId);
      } catch (_e) {
        /* ignore */
      }
      if (getMode() === 2) {
        // Twin-stick is for touch only. Desktop FPPOV stays on the
        // existing pointer-lock + `onMouseMove` path so trackpad /
        // mouse users get high-precision aim.
        if (ev.pointerType === 'touch') handleFpsPointerDown(ev);
        return;
      }
      // Modes 0 / 1 — centre-anchored joystick (single primary pointer).
      if (this._touchAnchor) return;
      this._touchAnchor = { pointerId: ev.pointerId };
      driveFromPointer(ev);
    });

    canvas.addEventListener('pointermove', (ev) => {
      // Track the largest drag distance from press-start so we can
      // tell at pointerup whether this was a tap (no significant
      // movement) or a drag.
      const dragNow = Math.hypot(
        ev.clientX - this._pointerDownX,
        ev.clientY - this._pointerDownY
      );
      if (dragNow > this._pointerMaxDrag) this._pointerMaxDrag = dragNow;
      if (getMode() === 2) {
        if (ev.pointerType === 'touch') handleFpsPointerMove(ev);
        return;
      }
      if (!this._touchAnchor || ev.pointerId !== this._touchAnchor.pointerId) return;
      ev.preventDefault();
      driveFromPointer(ev);
    });

    const release = (ev) => {
      try {
        canvas.releasePointerCapture(ev.pointerId);
      } catch (_e) {
        /* ignore */
      }
      const duration = performance.now() - this._pointerDownTime;
      const maxDrag = this._pointerMaxDrag;
      // Double-tap-to-jump in modes 0 / 1. Compute on every release;
      // if it doesn't qualify the helper just records the tap for the
      // next press to compare against.
      tryDoubleTapSprint(ev.clientX, ev.clientY, duration, maxDrag);
      if (getMode() === 2) {
        if (ev.pointerType === 'touch') handleFpsPointerUp(ev);
        return;
      }
      if (!this._touchAnchor || ev.pointerId !== this._touchAnchor.pointerId) return;
      clearTouch();
    };
    canvas.addEventListener('pointerup', release);
    canvas.addEventListener('pointercancel', release);
    canvas.addEventListener('pointerleave', release);
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

      const isFirstPerson = newMode === 2; // FPPOV

      if (this.game.pacman) {
        this.game.pacman.setVisible(!isFirstPerson);

        // FPPOV is the only mode that needs STRAFE (mouse-look + WASD
        // twin-stick). BIRDSEYE_FOLLOW used to be STRAFE too, but the
        // tap-anywhere drive control gives world-direction joystick
        // input, and `handleMouseAim` sets yaw from the tap — combining
        // those with STRAFE produced a "tap down → walk up" reversal
        // because DOWN means "backward (−facing)". PERP keeps movement
        // intuitive (tap-direction == walk-direction); the mouse-aim
        // call still rotates Pacman visually when he's standing still.
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
    // Create touch overlay for mobile
    const touchOverlay = document.createElement('div');
    touchOverlay.id = 'touch-controls';
    touchOverlay.innerHTML = `
      <style>
        /* Without the d-pad, the action buttons no longer need to share
           bottom-centre real-estate with anything. Park them in the
           bottom-right corner so the rest of the canvas is free for the
           tap-to-drive control. */
        #touch-controls {
          display: none;
          position: fixed;
          right: 16px;
          bottom: 20px;
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
        /* The 4-way d-pad was removed in favour of a single tap-anywhere
           drive control on the canvas (see setupCanvasTapControl above).
           Only the action buttons (JUMP / VIEW / PAUSE) remain on the
           mobile overlay. */
        .touch-action-buttons {
          display: flex;
          flex-direction: row;
          gap: 12px;
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
          /* Same 12px label sizing as JUMP — was an emoji at 20px before
             but the camera emoji read as "take a screenshot", so it's
             now a plain VIEW text button. */
          font-size: 12px;
        }
        .touch-pause-btn {
          background: rgba(255, 200, 0, 0.25);
          border-color: rgba(255, 200, 0, 0.6);
          color: #ffc800;
        }
        .touch-pause-btn:active {
          background: rgba(255, 200, 0, 0.5);
        }
        .touch-jump-btn {
          background: rgba(255, 80, 200, 0.3);
          border-color: rgba(255, 80, 200, 0.7);
          color: #ff80c8;
          font-size: 14px;
        }
        .touch-jump-btn:active {
          background: rgba(255, 80, 200, 0.55);
        }
        /* Sprint button — cyan to match the in-game DASH HUD readout
           and the sprint glow on Pacman so the visual language is
           consistent between the button, the HUD, and the player
           feedback during a dash. */
        .touch-sprint-btn {
          background: rgba(34, 211, 238, 0.3);
          border-color: rgba(34, 211, 238, 0.7);
          color: #67e8f9;
          font-size: 12px;
        }
        .touch-sprint-btn:active {
          background: rgba(34, 211, 238, 0.55);
        }
      </style>
      <div class="touch-action-buttons">
        <button class="touch-action-btn touch-jump-btn" id="touch-jump">JUMP</button>
        <button class="touch-action-btn touch-sprint-btn" id="touch-sprint">DASH</button>
        <button class="touch-action-btn touch-camera-btn" id="touch-camera" aria-label="Cycle view">VIEW</button>
        <button class="touch-action-btn touch-pause-btn" id="touch-pause">⏸</button>
      </div>
    `;
    document.body.appendChild(touchOverlay);

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

    // Jump button (Phase 2a)
    const jumpBtn = document.getElementById('touch-jump');
    if (jumpBtn) {
      jumpBtn.addEventListener('touchstart', (e) => {
        e.preventDefault();
        this.game.tryJump();
      });
    }

    // Sprint / DASH button (Tier 5). Touch users can't double-tap a
    // direction key, and double-tapping the canvas is suppressed in
    // FPPOV (it's used for look-around there). A dedicated action
    // button gives every touch user a reliable way to dash.
    const sprintBtn = document.getElementById('touch-sprint');
    if (sprintBtn) {
      sprintBtn.addEventListener('touchstart', (e) => {
        e.preventDefault();
        this.game.trySprint?.();
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
    this._touchKeys = { up: false, down: false, left: false, right: false };
    this._joystickVec = null;
    this._touchAnchor = null;
    this._fpsWalkPointer = null;
    this._fpsLookPointer = null;
    this._lastTapTime = 0;
    this._pointerMaxDrag = 0;
    this.direction = DIRECTION.NONE;
  }
}
