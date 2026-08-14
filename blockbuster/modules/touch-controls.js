/**
 * Touch input for Blockbuster — same twin-stick scheme as pacman-infinite
 * FPPOV (`pacman-infinite/js/controls.js`):
 *
 *   Left half of the canvas  → free-floating walk joystick
 *   Right half of the canvas → drag to look; short tap to interact
 *
 * Wired for `pointerType === 'touch'` only. Desktop keeps pointer-lock
 * + mouse-look. No coarse-pointer gate — iPad "desktop site" and Chrome
 * device mode still emit touch pointers even when `pointer: fine`.
 */

const TAP_MAX_MOVE = 22;
const TAP_MAX_MS = 320;
const WALK_DEAD = 28;
/** px → radians; close to pacman's feel after unit conversion. */
const TOUCH_LOOK_SENS = 0.0034;

/**
 * Rough "show mobile chrome" hint — HUD copy / Rent button. Not used to
 * gate the twin-stick (that keys off pointerType === 'touch').
 * @returns {boolean}
 */
export function prefersTouchUi() {
  if (navigator.maxTouchPoints > 0) return true;
  return (
    window.matchMedia?.('(pointer: coarse)')?.matches === true ||
    window.matchMedia?.('(max-width: 768px)')?.matches === true
  );
}

/**
 * @param {{
 *   canvas: HTMLCanvasElement,
 *   setKey: (key: 'w'|'a'|'s'|'d'|'crouch'|'sprint', down: boolean) => void,
 *   look: (dx: number, dy: number) => void,
 *   onInteract: () => void,
 *   onRentOrGrab: () => void,
 *   isLocked: () => boolean,
 *   isHolding: () => boolean
 * }} opts
 */
export function installTouchControls(opts) {
  const { canvas, setKey, look, onInteract, onRentOrGrab, isLocked, isHolding } = opts;

  // Belt-and-braces with CSS — pacman sets this in JS too.
  canvas.style.touchAction = 'none';

  const rentBtn = /** @type {HTMLButtonElement | null} */ (document.getElementById('touch-rent'));
  if (rentBtn) {
    rentBtn.addEventListener(
      'touchstart',
      (e) => {
        e.preventDefault();
        if (!isLocked()) onRentOrGrab();
      },
      { passive: false }
    );
  }

  /** @type {{ pointerId: number, anchorX: number, anchorY: number } | null} */
  let walkPointer = null;
  /** @type {{ pointerId: number, lastX: number, lastY: number, startX: number, startY: number, startT: number, maxDrag: number } | null} */
  let lookPointer = null;

  function clearMoveKeys() {
    setKey('w', false);
    setKey('a', false);
    setKey('s', false);
    setKey('d', false);
  }

  /**
   * @param {number} dx
   * @param {number} dy
   * @param {number} dead
   */
  function applyWalkJoystick(dx, dy, dead) {
    const r = Math.hypot(dx, dy);
    if (r < dead) {
      clearMoveKeys();
      return;
    }
    // Dominant-axis 4-way snap (same as pacman _touchKeys), plus
    // diagonals when both axes are strong.
    const ax = dx / r;
    const ay = dy / r;
    setKey('w', ay < -0.35);
    setKey('s', ay > 0.35);
    setKey('a', ax < -0.35);
    setKey('d', ax > 0.35);
  }

  /**
   * @param {PointerEvent} ev
   */
  function handleTouchDown(ev) {
    const rect = canvas.getBoundingClientRect();
    const onLeftHalf = ev.clientX - rect.left < rect.width / 2;
    try {
      canvas.setPointerCapture(ev.pointerId);
    } catch {
      /* ignore */
    }
    if (onLeftHalf) {
      if (walkPointer) return;
      walkPointer = {
        pointerId: ev.pointerId,
        anchorX: ev.clientX,
        anchorY: ev.clientY
      };
      clearMoveKeys();
      return;
    }
    if (lookPointer) return;
    lookPointer = {
      pointerId: ev.pointerId,
      lastX: ev.clientX,
      lastY: ev.clientY,
      startX: ev.clientX,
      startY: ev.clientY,
      startT: performance.now(),
      maxDrag: 0
    };
  }

  /**
   * @param {PointerEvent} ev
   */
  function handleTouchMove(ev) {
    if (walkPointer && ev.pointerId === walkPointer.pointerId) {
      applyWalkJoystick(
        ev.clientX - walkPointer.anchorX,
        ev.clientY - walkPointer.anchorY,
        WALK_DEAD
      );
    }
    if (lookPointer && ev.pointerId === lookPointer.pointerId) {
      const drag = Math.hypot(ev.clientX - lookPointer.startX, ev.clientY - lookPointer.startY);
      if (drag > lookPointer.maxDrag) lookPointer.maxDrag = drag;
      const dx = ev.clientX - lookPointer.lastX;
      const dy = ev.clientY - lookPointer.lastY;
      lookPointer.lastX = ev.clientX;
      lookPointer.lastY = ev.clientY;
      if (!isLocked() && lookPointer.maxDrag > TAP_MAX_MOVE) {
        look(dx, dy);
      }
    }
  }

  /**
   * @param {PointerEvent} ev
   */
  function handleTouchUp(ev) {
    try {
      canvas.releasePointerCapture(ev.pointerId);
    } catch {
      /* ignore */
    }
    if (walkPointer && ev.pointerId === walkPointer.pointerId) {
      walkPointer = null;
      clearMoveKeys();
    }
    if (lookPointer && ev.pointerId === lookPointer.pointerId) {
      const elapsed = performance.now() - lookPointer.startT;
      const wasTap = lookPointer.maxDrag <= TAP_MAX_MOVE && elapsed <= TAP_MAX_MS;
      lookPointer = null;
      if (wasTap && !isLocked()) onInteract();
    }
  }

  canvas.addEventListener(
    'pointerdown',
    (ev) => {
      if (ev.pointerType !== 'touch') return;
      ev.preventDefault();
      handleTouchDown(ev);
    },
    { passive: false }
  );

  canvas.addEventListener(
    'pointermove',
    (ev) => {
      if (ev.pointerType !== 'touch') return;
      if (
        (walkPointer && ev.pointerId === walkPointer.pointerId) ||
        (lookPointer && ev.pointerId === lookPointer.pointerId)
      ) {
        ev.preventDefault();
      }
      handleTouchMove(ev);
    },
    { passive: false }
  );

  canvas.addEventListener('pointerup', (ev) => {
    if (ev.pointerType !== 'touch') return;
    handleTouchUp(ev);
  });
  canvas.addEventListener('pointercancel', (ev) => {
    if (ev.pointerType !== 'touch') return;
    handleTouchUp(ev);
  });

  document.addEventListener(
    'gesturestart',
    (e) => {
      e.preventDefault();
    },
    { passive: false }
  );

  window.addEventListener('blur', () => {
    walkPointer = null;
    lookPointer = null;
    clearMoveKeys();
  });

  return {
    update() {
      if (!rentBtn) return;
      const holding = isHolding();
      rentBtn.hidden = !holding;
      rentBtn.setAttribute('aria-hidden', holding ? 'false' : 'true');
    }
  };
}

export { TOUCH_LOOK_SENS };
