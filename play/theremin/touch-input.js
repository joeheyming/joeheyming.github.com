/**
 * Touch / mouse / pen input for the theremin pad.
 *
 * Multi-touch model:
 *   First pointer to land  → primary voice (drives pitch + volume).
 *   Subsequent pointers    → vibrato modulators (X = rate, Y = depth).
 *   If the primary lifts while another pointer is still down, that
 *   pointer is promoted to primary so the drone keeps going (the
 *   player never has to think about "which finger landed first").
 */
import { resumeIfSuspended } from '../shared/audio.js';
import { xToMidi } from './scale.js';
import {
  ensureVoice,
  applyPrimary,
  applyVibrato,
  clearVibrato,
  fadeInVoice,
  fadeOutVoice
} from './voice.js';

/**
 * Wire pointer handlers on `padEl`. Returns a small handle exposing
 * `releaseAll()` so the coordinator can clear held pointers when the
 * user switches to air mode mid-touch.
 *
 *   getCfg()             → { scale, root, range, glideMs } (live, called per move)
 *   getMode()            → 'touch' | 'air' (touch events are no-ops while in air)
 *   getInputsSuspended() → true while a modal/dialog is up; pad is inert
 *   setTip()             → optional callback; called with { xNorm, yNorm }
 *                          on every primary-pointer update and `null`
 *                          when no primary is held. Drives the paint
 *                          trail (and any future tip-following effect).
 */
export const initTouchInput = ({ padEl, getCfg, getMode, getInputsSuspended, setTip }) => {
  /** pointerId -> { xNorm, yNorm, xPx, yPx } */
  const pointers = new Map();
  /** pointerId of the current primary voice (or null). */
  let primaryId = null;

  /** pointerId -> div.theremin-touch */
  const touchEls = new Map();

  const crosshair = document.createElement('div');
  crosshair.className = 'theremin-crosshair';
  const crosshairV = document.createElement('div');
  crosshairV.className = 'theremin-crosshair-line vertical';
  const crosshairH = document.createElement('div');
  crosshairH.className = 'theremin-crosshair-line horizontal';
  crosshair.appendChild(crosshairV);
  crosshair.appendChild(crosshairH);
  crosshair.hidden = true;
  padEl.appendChild(crosshair);

  const setCrosshair = (xPx, yPx, visible) => {
    crosshair.hidden = !visible;
    if (!visible) return;
    crosshairV.style.setProperty('--cx', `${xPx.toFixed(2)}px`);
    crosshairH.style.setProperty('--cy', `${yPx.toFixed(2)}px`);
  };

  const ensureTouchEl = (ptrId, isVibrato) => {
    let el = touchEls.get(ptrId);
    if (!el) {
      el = document.createElement('div');
      el.className = 'theremin-touch';
      padEl.appendChild(el);
      touchEls.set(ptrId, el);
    }
    el.classList.toggle('vibrato', !!isVibrato);
    return el;
  };

  const removeTouchEl = (ptrId) => {
    const el = touchEls.get(ptrId);
    if (!el) return;
    el.remove();
    touchEls.delete(ptrId);
  };

  const localCoords = (event) => {
    const rect = padEl.getBoundingClientRect();
    const x = (event.clientX - rect.left) / rect.width;
    const y = (event.clientY - rect.top) / rect.height;
    return {
      xNorm: Math.max(0, Math.min(1, x)),
      yNorm: Math.max(0, Math.min(1, y)),
      xPx: Math.max(0, Math.min(rect.width, event.clientX - rect.left)),
      yPx: Math.max(0, Math.min(rect.height, event.clientY - rect.top))
    };
  };

  const reassignPrimary = () => {
    // Pick the oldest still-active pointer as primary. Map iteration
    // order is insertion order, so the first key is the longest-held.
    primaryId = null;
    for (const id of pointers.keys()) {
      primaryId = id;
      break;
    }
  };

  const refreshTouchClassOrders = () => {
    // After a primary swap, repaint each touch element so the newly-
    // primary pointer drops the `vibrato` style and the newly-secondary
    // picks it up.
    for (const id of pointers.keys()) {
      const el = ensureTouchEl(id, id !== primaryId);
      const p = pointers.get(id);
      el.style.setProperty('--tx', `${p.xPx.toFixed(2)}px`);
      el.style.setProperty('--ty', `${p.yPx.toFixed(2)}px`);
    }
  };

  const onPointerDown = (event) => {
    // In air mode the camera drives the audio; pointer input on the
    // pad would conflict with the hand-tracking voice.
    if (getMode() === 'air') return;
    // Recording-preview modal (or any future overlay) suspends the
    // pad so playing-while-previewing doesn't double up the audio.
    if (getInputsSuspended?.()) return;

    const cfg = getCfg();
    ensureVoice(xToMidi(0, cfg));
    resumeIfSuspended();
    // setPointerCapture throws InvalidPointerId for pointer-ids that
    // aren't actively held (e.g. synthetic test events). Treat as
    // best-effort — it's only here so a finger that briefly drags off
    // the pad still routes its move events back to us.
    try {
      padEl.setPointerCapture?.(event.pointerId);
    } catch (_) {
      /* ignore */
    }

    const c = localCoords(event);
    pointers.set(event.pointerId, c);

    const isFirst = pointers.size === 1;
    if (isFirst) {
      primaryId = event.pointerId;
      fadeInVoice(c.yNorm);
      applyPrimary(c.xNorm, c.yNorm, cfg);
      setCrosshair(c.xPx, c.yPx, true);
      setTip?.({ xNorm: c.xNorm, yNorm: c.yNorm });
    } else {
      applyVibrato(c.xNorm, c.yNorm);
    }

    const el = ensureTouchEl(event.pointerId, !isFirst);
    el.style.setProperty('--tx', `${c.xPx.toFixed(2)}px`);
    el.style.setProperty('--ty', `${c.yPx.toFixed(2)}px`);

    padEl.classList.add('is-active');
    event.preventDefault();
  };

  const onPointerMove = (event) => {
    if (!pointers.has(event.pointerId)) return;
    if (getInputsSuspended?.()) return;
    const c = localCoords(event);
    pointers.set(event.pointerId, c);

    const el = touchEls.get(event.pointerId);
    if (el) {
      el.style.setProperty('--tx', `${c.xPx.toFixed(2)}px`);
      el.style.setProperty('--ty', `${c.yPx.toFixed(2)}px`);
    }

    if (event.pointerId === primaryId) {
      applyPrimary(c.xNorm, c.yNorm, getCfg());
      setCrosshair(c.xPx, c.yPx, true);
      setTip?.({ xNorm: c.xNorm, yNorm: c.yNorm });
    } else {
      applyVibrato(c.xNorm, c.yNorm);
    }
  };

  const endPointer = (event) => {
    if (!pointers.has(event.pointerId)) return;
    const wasPrimary = event.pointerId === primaryId;
    pointers.delete(event.pointerId);
    removeTouchEl(event.pointerId);

    if (pointers.size === 0) {
      primaryId = null;
      fadeOutVoice();
      clearVibrato();
      setCrosshair(0, 0, false);
      padEl.classList.remove('is-active');
      setTip?.(null);
      return;
    }

    if (wasPrimary) {
      // Promote whichever pointer is still down to primary so the
      // drone keeps going without a gap.
      reassignPrimary();
      refreshTouchClassOrders();
      const next = pointers.get(primaryId);
      if (next) {
        applyPrimary(next.xNorm, next.yNorm, getCfg());
        setCrosshair(next.xPx, next.yPx, true);
        setTip?.({ xNorm: next.xNorm, yNorm: next.yNorm });
      }
      // With one finger left, there's no vibrato source — collapse it.
      if (pointers.size === 1) clearVibrato();
    } else if (pointers.size === 1) {
      // Last secondary lifted; flatten vibrato.
      clearVibrato();
    }
  };

  /**
   * Drop any currently-held pointers without triggering audio events.
   * Called by the coordinator when switching to air mode mid-touch so
   * the air-mode voice doesn't have to fight a stale touch primary.
   */
  const releaseAll = () => {
    for (const ptrId of Array.from(pointers.keys())) {
      pointers.delete(ptrId);
      removeTouchEl(ptrId);
    }
    primaryId = null;
    setCrosshair(0, 0, false);
    padEl.classList.remove('is-active');
    setTip?.(null);
  };

  padEl.addEventListener('pointerdown', onPointerDown);
  padEl.addEventListener('pointermove', onPointerMove);
  padEl.addEventListener('pointerup', endPointer);
  padEl.addEventListener('pointercancel', endPointer);
  padEl.addEventListener('lostpointercapture', endPointer);

  return { releaseAll };
};
