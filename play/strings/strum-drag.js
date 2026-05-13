/**
 * Tap-to-play vs drag-to-reorder for the Strum Bar.
 *
 * Pointer-driven, with two different gating strategies depending on
 * pointer type:
 *
 * - TOUCH: requires a long-press (LONG_PRESS_MS) to enter drag mode.
 *   Any finger movement before the timer fires hands the gesture
 *   back to the browser, which then handles native scrolling
 *   (horizontal in the strum-bar pads container, vertical in the
 *   chord-builder). This is the iOS home-screen / Photos-album
 *   pattern: hold to pick up, then drag.
 * - MOUSE / PEN: skips long-press. A horizontal-dominant drag of
 *   more than DRAG_THRESHOLD pixels promotes to a reorder; vertical
 *   drags abandon the drag-state. Desktop users scroll with the
 *   wheel / trackpad, so they don't need a "scroll-friendly" gate
 *   on the pad itself.
 *
 * Either way, on drop we persist the new order. A floating ghost
 * clone follows the cursor / finger; the original pad stays in
 * place but dimmed (`drag-source` class) until drop.
 *
 * Also owns the strum-pad CLICK handler — taps that aren't drags
 * either remove the pad (when the × button is the target) or play
 * the chord while arming it as the edit target (for in-place
 * voicing edits).
 */

const DRAG_THRESHOLD = 8; // px before a mouse/pen tap promotes to a drag
const LONG_PRESS_MS = 400; // touch hold time before the pad becomes draggable
// Movement tolerance during the long-press wait — natural finger
// tremor is typically 3-6px, so anything under this counts as "still
// holding" and won't cancel the timer.
const LONG_PRESS_TOLERANCE = 12;
const DRAG_WATCHDOG_MS = 2500;

/**
 * @param {object} deps
 * @param {HTMLElement} deps.strumPadsEl  The pads container.
 * @param {HTMLElement | null} deps.chordBuilderEl  Builder wrapper (tap-away region).
 * @param {{ rootPc: number, qualityId: string }[]} deps.strumBar  Shared bar array (mutated via splice).
 * @param {() => null | { rootPc: number, qualityId: string }} deps.getEditTarget
 * @param {(t: null | { rootPc: number, qualityId: string }) => void} deps.setEditTarget
 * @param {() => void} deps.renderStrumBar
 * @param {() => void} deps.savePrefs
 * @param {(rootPc: number, qualityId: string, voicingIdx?: number) => void} deps.playChordAtPad
 * @param {(rootPc: number, qualityId: string) => void} deps.removeChordFromBar
 */
export function initStrumDrag({
  strumPadsEl,
  chordBuilderEl,
  strumBar,
  getEditTarget,
  setEditTarget,
  renderStrumBar,
  savePrefs,
  playChordAtPad,
  removeChordFromBar,
}) {
  let dragState = null;
  let longPressTimer = null;
  // briefly true after a drag so the trailing `click` event doesn't
  // accidentally re-strum the dropped chord.
  let justDragged = false;
  let dragWatchdogTimer = null;

  const findPadByChord = (chord) =>
    strumPadsEl?.querySelector(
      `.strum-pad[data-root-pc="${chord.rootPc}"][data-quality="${chord.qualityId}"]`
    );

  const startDrag = (event) => {
    if (!dragState) return;
    const sourcePad = findPadByChord(dragState.chord);
    if (!sourcePad) return;
    dragState.dragging = true;
    sourcePad.classList.add('drag-source');
    // Floating clone that the cursor literally drags around — no DOM
    // reflow needed for the visual bit; the underlying pad order is
    // updated independently.
    const rect = sourcePad.getBoundingClientRect();
    const ghost = sourcePad.cloneNode(true);
    ghost.classList.add('drag-ghost');
    ghost.classList.remove('drag-source');
    ghost.querySelector('.strum-pad-remove')?.remove();
    ghost.style.position = 'fixed';
    ghost.style.left = `${rect.left}px`;
    ghost.style.top = `${rect.top}px`;
    ghost.style.width = `${rect.width}px`;
    ghost.style.height = `${rect.height}px`;
    ghost.style.pointerEvents = 'none';
    ghost.style.zIndex = '9999';
    ghost.style.transform = 'scale(1.05)';
    ghost.style.transition = 'none';
    document.body.appendChild(ghost);
    dragState.ghostEl = ghost;
    // Pointer offset within the source pad — the ghost stays anchored
    // to that same offset for the life of the drag, so the chord name
    // doesn't snap-jump under the finger when the drag begins.
    dragState.ghostOffsetX = event.clientX - rect.left;
    dragState.ghostOffsetY = event.clientY - rect.top;
    document.body.classList.add('strum-dragging');
  };

  const cancelLongPress = () => {
    if (longPressTimer) {
      clearTimeout(longPressTimer);
      longPressTimer = null;
    }
  };

  // Defensive cleanup — strips ALL drag-related state from the DOM,
  // regardless of whether `dragState` still tracks them. Called from
  // every "interaction ended" hook (pointerup, pointercancel,
  // touchend, touchcancel) and the watchdog below, because iOS Safari
  // occasionally drops one of those events on the floor — if we
  // gated on pointerId we'd leave a ghost stranded mid-screen.
  const removeAllGhosts = () => {
    document.querySelectorAll('.strum-pad.drag-ghost').forEach((el) => el.remove());
    document
      .querySelectorAll('.strum-pad.drag-source')
      .forEach((el) => el.classList.remove('drag-source'));
    document
      .querySelectorAll('.strum-pad.long-press-active')
      .forEach((el) => el.classList.remove('long-press-active'));
    document
      .querySelectorAll('.strum-pad.long-press-pending')
      .forEach((el) => el.classList.remove('long-press-pending'));
    document.body.classList.remove('strum-dragging');
  };

  // Watchdog: if a drag is "in flight" but no pointermove has arrived
  // for a while, the OS probably swallowed our pointerup. Force the
  // drop and clean up. Refreshed every pointermove so a slow but live
  // drag never trips it.
  const armDragWatchdog = () => {
    if (dragWatchdogTimer) clearTimeout(dragWatchdogTimer);
    dragWatchdogTimer = setTimeout(() => {
      dragWatchdogTimer = null;
      if (dragState && dragState.dragging) {
        removeAllGhosts();
        dragState = null;
      }
    }, DRAG_WATCHDOG_MS);
  };
  const disarmDragWatchdog = () => {
    if (dragWatchdogTimer) {
      clearTimeout(dragWatchdogTimer);
      dragWatchdogTimer = null;
    }
  };

  const onStrumPointerDown = (event) => {
    if (event.button !== undefined && event.button !== 0) return; // primary button only
    if (event.target.closest('.strum-pad-remove')) return; // X button uses click
    const pad = event.target.closest('.strum-pad');
    if (!pad) return;
    const isTouch = event.pointerType === 'touch';
    dragState = {
      pointerId: event.pointerId,
      pointerType: event.pointerType,
      chord: {
        rootPc: Number(pad.dataset.rootPc),
        qualityId: pad.dataset.quality,
      },
      startX: event.clientX,
      startY: event.clientY,
      dragging: false,
      // For mouse / pen we're already "armed" — any direction-passing
      // drag past DRAG_THRESHOLD will start a reorder. Touch needs to
      // win the long-press race first.
      armed: !isTouch,
      ghostEl: null,
    };
    if (isTouch) {
      cancelLongPress();
      // Visual feedback during the wait so the player can SEE the
      // long-press timer ticking — without this the pad just sits
      // there for 400ms and feels unresponsive.
      pad.classList.add('long-press-pending');
      longPressTimer = setTimeout(() => {
        longPressTimer = null;
        if (!dragState) return;
        dragState.armed = true;
        const p = findPadByChord(dragState.chord);
        p?.classList.remove('long-press-pending');
        p?.classList.add('long-press-active');
        // Haptic confirmation on supported devices ("you've picked it up").
        if (navigator.vibrate) navigator.vibrate(15);
        // Start the drag immediately at the long-press point so the ghost
        // appears right under the finger — the player doesn't have to
        // wiggle to make it materialise.
        startDrag({ clientX: dragState.startX, clientY: dragState.startY });
        armDragWatchdog();
      }, LONG_PRESS_MS);
    }
  };

  const onStrumPointerMove = (event) => {
    if (!dragState || event.pointerId !== dragState.pointerId) return;
    const dx = event.clientX - dragState.startX;
    const dy = event.clientY - dragState.startY;
    // Touch: small finger movement during the long-press wait is
    // tolerated (natural tremor is 3-6px); only abandon if the player
    // moves further than LONG_PRESS_TOLERANCE, which we read as
    // "they're trying to scroll".
    if (!dragState.armed) {
      if (Math.hypot(dx, dy) <= LONG_PRESS_TOLERANCE) return;
      cancelLongPress();
      const p = findPadByChord(dragState.chord);
      p?.classList.remove('long-press-pending');
      p?.classList.remove('long-press-active');
      dragState = null;
      return;
    }
    if (!dragState.dragging) {
      if (Math.hypot(dx, dy) <= DRAG_THRESHOLD) return;
      // Mouse / pen direction gate (touch already passed long-press above
      // and starts the drag from inside the timer callback).
      if (dragState.pointerType !== 'touch' && Math.abs(dx) <= Math.abs(dy)) {
        dragState = null;
        return;
      }
      startDrag(event);
      if (!dragState.dragging) return;
    }
    // Move the ghost.
    dragState.ghostEl.style.left = `${event.clientX - dragState.ghostOffsetX}px`;
    dragState.ghostEl.style.top = `${event.clientY - dragState.ghostOffsetY}px`;
    armDragWatchdog();
    // Look beneath the cursor for any pad that ISN'T the source. Use
    // elementsFromPoint so the ghost (which is on top) doesn't shadow
    // the result.
    const els = document.elementsFromPoint(event.clientX, event.clientY);
    const targetPad = els.find(
      (el) => el.classList?.contains('strum-pad') && !el.classList.contains('drag-source')
    );
    if (!targetPad) return;
    const sourceIdx = strumBar.findIndex(
      (e) => e.rootPc === dragState.chord.rootPc && e.qualityId === dragState.chord.qualityId
    );
    const targetIdx = Number(targetPad.dataset.idx);
    if (sourceIdx < 0 || Number.isNaN(targetIdx)) return;
    // Insert the source before or after the target depending on which
    // half of the target the cursor is over — gives a predictable feel
    // regardless of approach direction.
    const r = targetPad.getBoundingClientRect();
    const insertBefore = event.clientX < r.left + r.width / 2;
    let newIdx = insertBefore ? targetIdx : targetIdx + 1;
    if (newIdx > sourceIdx) newIdx -= 1;
    if (newIdx === sourceIdx) return;
    const [moved] = strumBar.splice(sourceIdx, 1);
    strumBar.splice(newIdx, 0, moved);
    renderStrumBar();
    // renderStrumBar wiped + rebuilt DOM, so re-mark the new source pad.
    findPadByChord(dragState.chord)?.classList.add('drag-source');
    event.preventDefault();
  };

  const endStrumDrag = (_event) => {
    // Defensive: even with no live dragState, sweep any orphan ghosts
    // — covers the rare iOS case where pointercancel fires for a
    // pointerId we no longer track but the ghost element remained.
    if (!dragState) {
      if (document.querySelector('.strum-pad.drag-ghost')) removeAllGhosts();
      return;
    }
    // Tolerate pointerId mismatches: on iOS the pointerId can change
    // when our touchmove preventDefault confuses the gesture
    // recognizer. We'd rather over-clean than leave a ghost stranded.
    // Multi-touch with a SECOND finger pressing while we're mid-drag
    // would also land here — pointerup for that other pointer should
    // still trigger an end-of-drag, since the player has clearly
    // finished interacting with the pad.
    cancelLongPress();
    disarmDragWatchdog();
    const wasDragging = dragState.dragging;
    removeAllGhosts();
    if (wasDragging) {
      savePrefs();
      // Suppress the trailing `click` that fires on touch/mouse after
      // pointerup (otherwise the dropped pad would also strum).
      justDragged = true;
      setTimeout(() => {
        justDragged = false;
      }, 80);
    }
    dragState = null;
  };

  strumPadsEl?.addEventListener('pointerdown', onStrumPointerDown);
  // Listen on document so a fast drag that exits the bar doesn't lose
  // the pointerup event (capture-style behaviour without explicit
  // setPointerCapture, which was buggy in Safari for cloned ghosts).
  document.addEventListener('pointermove', onStrumPointerMove);
  document.addEventListener('pointerup', endStrumDrag);
  document.addEventListener('pointercancel', endStrumDrag);
  // Touch fallbacks — when our touchmove preventDefault confuses
  // Safari's gesture recognizer it sometimes drops the matching
  // pointerup, and the ghost is left floating mid-screen. The native
  // touchend / touchcancel still fire reliably, so we hook them as a
  // belt-and-braces cleanup path. (endStrumDrag is idempotent.)
  document.addEventListener('touchend', endStrumDrag);
  document.addEventListener('touchcancel', endStrumDrag);
  // And one more safety net: if focus leaves the page (e.g. user
  // switches apps mid-drag, or the system shows a permission prompt),
  // force-cleanup any in-flight ghost.
  window.addEventListener('blur', () => endStrumDrag());
  document.addEventListener('visibilitychange', () => {
    if (document.hidden) endStrumDrag();
  });

  // While a long-press drag is ACTIVE, swallow touchmove so the
  // browser doesn't simultaneously scroll the strum-bar pads
  // container (or chord-builder) as the player drags a pad. Pointer
  // events alone can't stop native scroll — touchmove with
  // `{ passive: false }` is the only way to do it on iOS Safari.
  // We deliberately do NOT preventDefault before the long-press
  // fires, so the player can still tap-drag to scroll like normal.
  document.addEventListener(
    'touchmove',
    (event) => {
      if (dragState && dragState.dragging) event.preventDefault();
    },
    { passive: false }
  );

  // iOS Safari fires `contextmenu` on long-press touches, which kills
  // the pointer events mid-stream and prevents the long-press timer
  // from completing. Block it on the strum pads so our own long-press
  // reorder can land cleanly.
  strumPadsEl?.addEventListener('contextmenu', (event) => {
    if (event.target.closest('.strum-pad')) event.preventDefault();
  });

  strumPadsEl?.addEventListener('click', (event) => {
    if (justDragged) {
      event.stopPropagation();
      event.preventDefault();
      return;
    }
    const removeBtn = event.target.closest('.strum-pad-remove');
    if (removeBtn) {
      event.stopPropagation();
      const pad = removeBtn.closest('.strum-pad');
      if (!pad) return;
      removeChordFromBar(Number(pad.dataset.rootPc), pad.dataset.quality);
      return;
    }
    const pad = event.target.closest('.strum-pad');
    if (!pad) return;
    const rootPc = Number(pad.dataset.rootPc);
    const qualityId = pad.dataset.quality;
    const voicingIdx = Number(pad.dataset.voicingIdx) || 0;
    // Tapping a pad arms it as the "edit target" — subsequent clicks
    // on Root / Quality / Shape rewrite THIS pad in place rather than
    // pinning a new one. Re-tapping the SAME pad toggles edit mode
    // off (so the player can go back to the normal "click Root pins a
    // new chord" flow without having to hunt for an exit).
    const current = getEditTarget();
    const isAlreadyEditing =
      current && current.rootPc === rootPc && current.qualityId === qualityId;
    setEditTarget(isAlreadyEditing ? null : { rootPc, qualityId });
    playChordAtPad(rootPc, qualityId, voicingIdx);
  });

  // Escape always exits edit mode. Skipped while a chord-search /
  // chord-name input has focus so the input keeps its own Escape
  // dismissal (see the popovers above).
  document.addEventListener('keydown', (event) => {
    if (event.key !== 'Escape') return;
    if (!getEditTarget()) return;
    const t = event.target;
    if (t && (t.matches('input, textarea, select') || t.isContentEditable)) return;
    setEditTarget(null);
  });

  // Tap-away exits edit mode. Anything inside the chord-builder
  // wrapper (which contains both the strum bar AND the Root/Quality/
  // Shape matrix) counts as "still editing" — tapping elsewhere on the
  // page (fretboard, header, instrument picker, the gap above HOW TO
  // PLAY, etc.) means the player's attention has moved on, so we drop
  // the edit target so the next Root click pins a new chord again.
  //
  // Uses pointerdown (not click) for two reasons:
  //   1. Mobile feel — taps register as soon as the finger lands.
  //   2. The Root/Quality/Voicing buttons run their own click handlers,
  //      and pointerdown fires first; if we used click here, ordering
  //      around stopPropagation could clear editTarget before those
  //      handlers had a chance to read it. With pointerdown we exit
  //      strictly only on outside taps.
  document.addEventListener('pointerdown', (event) => {
    if (!getEditTarget()) return;
    if (chordBuilderEl?.contains(event.target)) return;
    setEditTarget(null);
  });
}
