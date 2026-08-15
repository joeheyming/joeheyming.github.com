/**
 * Pointer + keyboard input for the notation editor.
 */
import {
  isPitchEntryY,
  keySigCount,
  xToPlayheadStart,
  xToStart,
  yToStaffAndStep
} from './layout.js';
import {
  addNote,
  chainHead,
  chainNotes,
  findNote,
  insertMeasure,
  moveChain,
  naturalsForStaff,
  noteAt,
  paletteDuration,
  removeChain,
  removeMeasure,
  replaceChainWithRest,
  setSelectionDuration,
  soundingDuration,
  updateNote,
  moveRest,
  letterIndexFromKey,
  stepNearestLetter,
  copySelectionPayload,
  pasteSelectionPayload,
  slotBlocked
} from './model.js';
import { DUR, applyDot, baseDurationId, clamp, totalSixteenths } from './notation.js';
import { hitTestNote, hitTestPlayhead } from './render.js';

const DRAG_THRESHOLD = 5;

export function bindInput({
  svg,
  getScore,
  getUi,
  setUi,
  mutate,
  mutateLive,
  pushHistory,
  playback,
  redraw,
  setStatus
}) {
  let pointerId = null;
  let drag = null;
  let clipboard = null;

  function svgPoint(clientX, clientY) {
    const pt = svg.createSVGPoint();
    pt.x = clientX;
    pt.y = clientY;
    const ctm = svg.getScreenCTM();
    if (!ctm) return { x: 0, y: 0 };
    return pt.matrixTransform(ctm.inverse());
  }

  function ks() {
    return keySigCount(getScore().keySig);
  }

  function selectHead(note) {
    const score = getScore();
    const head = chainHead(score, note) || note;
    const ui = getUi();
    const written = head.rest ? head.duration : soundingDuration(score, head);
    const { base, dotted } = baseDurationId(written);
    setUi({
      selectedId: head.id,
      tool: { ...ui.tool, baseDur: base, dotted }
    });
    ui.onToolChange?.();
    return head;
  }

  function closestMeasureAction(target) {
    let t = target;
    while (t && t !== svg) {
      if (t.getAttribute && t.getAttribute('data-measure-action')) return t;
      t = t.parentNode;
    }
    return null;
  }

  function onPointerDown(e) {
    if (e.button != null && e.button !== 0) return;

    const measureEl = closestMeasureAction(e.target);
    if (measureEl) {
      const action = measureEl.getAttribute('data-measure-action');
      const index = Number(measureEl.getAttribute('data-measure-index'));
      if (action === 'remove') {
        mutate((s) => {
          if (!removeMeasure(s, index)) setStatus?.('Need at least one bar');
          else setStatus?.(`Removed bar ${index + 1}`);
        });
      } else if (action === 'insert-after') {
        mutate((s) => {
          if (!insertMeasure(s, index + 1)) setStatus?.('Max 16 bars');
          else setStatus?.(`Added bar after ${index + 1}`);
        });
      }
      e.preventDefault();
      return;
    }

    const score = getScore();
    const ui = getUi();
    const { x, y } = svgPoint(e.clientX, e.clientY);
    pointerId = e.pointerId;
    svg.setPointerCapture(e.pointerId);

    function beginPlayheadScrub() {
      const wasPlaying = playback.state.playing;
      if (wasPlaying) playback.pause();
      drag = { mode: 'playhead', wasPlaying, startX: e.clientX, startY: e.clientY };
      svg.classList.add('is-scrubbing');
      const pos = xToPlayheadStart(x, ks(), score.measures, score.timeSig);
      playback.seek(pos, { score });
      setUi({ playheadStart: pos });
      redraw();
      e.preventDefault();
    }

    if (hitTestPlayhead(score, x, y, ui.playheadStart, ks())) {
      beginPlayheadScrub();
      return;
    }

    const hit = hitTestNote(score, x, y, ks());
    if (hit) {
      // Click rest always selects. Alt/Option+click rest with note tool places into the slot.
      if (hit.rest && e.altKey && !ui.tool.rest) {
        const start = xToStart(x, ks(), score.measures, score.timeSig);
        const { staff, step } = yToStaffAndStep(y);
        drag = { mode: 'place', start, staff, step };
        e.preventDefault();
        return;
      }
      const head = selectHead(hit);
      if (e.shiftKey) {
        redraw();
        drag = null;
        pointerId = null;
        try {
          svg.releasePointerCapture(e.pointerId);
        } catch (_) {
          /* ignore */
        }
        e.preventDefault();
        return;
      }
      drag = {
        mode: 'maybe',
        noteId: head.id,
        originStep: head.step,
        originStart: head.start,
        originSounding: soundingDuration(score, head),
        startX: e.clientX,
        startY: e.clientY,
        historyPushed: false,
        moved: false
      };
      redraw();
      e.preventDefault();
      return;
    }

    // Above/below the placeable pitch range → move the playhead, don't clamp to extreme notes
    if (!isPitchEntryY(y)) {
      beginPlayheadScrub();
      return;
    }

    const start = xToStart(x, ks(), score.measures, score.timeSig);
    const { staff, step } = yToStaffAndStep(y);
    drag = { mode: 'place', start, staff, step };
    clearShadow();
    e.preventDefault();
  }

  function ensureGestureHistory(d) {
    if (d.historyPushed) return;
    d.historyPushed = true;
    if (pushHistory) pushHistory();
    else mutate(() => {});
  }

  function clearShadow() {
    if (!getUi().shadow) return;
    setUi({ shadow: null });
    redraw();
  }

  function shadowEqual(a, b) {
    if (!a && !b) return true;
    if (!a || !b) return false;
    return (
      a.start === b.start &&
      a.staff === b.staff &&
      a.step === b.step &&
      a.duration === b.duration &&
      !!a.rest === !!b.rest &&
      !!a.blocked === !!b.blocked &&
      (a.voice ?? 0) === (b.voice ?? 0)
    );
  }

  function updateShadowFromPointer(e) {
    if (drag) return;
    const score = getScore();
    const ui = getUi();
    const { x, y } = svgPoint(e.clientX, e.clientY);

    if (!isPitchEntryY(y)) {
      clearShadow();
      return;
    }

    const hit = hitTestNote(score, x, y, ks());
    if (hit) {
      // Over a note/rest — select target, no place preview (Alt+rest places without preview)
      clearShadow();
      return;
    }

    const start = xToStart(x, ks(), score.measures, score.timeSig);
    const { staff, step } = yToStaffAndStep(y);
    const duration = paletteDuration(ui.tool);
    const next = {
      start,
      staff,
      step: ui.tool.rest ? Math.floor(naturalsForStaff(staff).length / 2) : step,
      duration,
      rest: !!ui.tool.rest,
      voice: ui.tool.voice,
      blocked: ui.tool.rest
        ? false
        : !!slotBlocked(score, { staff, start, voice: ui.tool.voice, duration })
    };
    if (shadowEqual(ui.shadow, next)) return;
    setUi({ shadow: next });
    redraw();
  }

  function onPointerMove(e) {
    if (pointerId !== e.pointerId || !drag) {
      updateShadowFromPointer(e);
      return;
    }
    const score = getScore();

    if (drag.mode === 'playhead') {
      clearShadow();
      const { x } = svgPoint(e.clientX, e.clientY);
      const pos = xToPlayheadStart(x, ks(), score.measures, score.timeSig);
      playback.seek(pos, { score });
      setUi({ playheadStart: pos });
      redraw();
      return;
    }

    if (drag.mode === 'place') return;

    clearShadow();
    const note = findNote(score, drag.noteId);
    if (!note) return;

    const dist = Math.hypot(e.clientX - drag.startX, e.clientY - drag.startY);
    if (drag.mode === 'maybe' && dist >= DRAG_THRESHOLD) {
      // Rests are select-only — dragging spawned gap-fill fragments
      if (note.rest) return;
      drag.mode = 'move';
      ensureGestureHistory(drag);
    }
    if (drag.mode !== 'move') return;

    const { x, y } = svgPoint(e.clientX, e.clientY);
    const total = totalSixteenths(score.measures, score.timeSig);
    const nextStart = clamp(
      xToStart(x, ks(), score.measures, score.timeSig),
      0,
      Math.max(0, total - 1)
    );
    let nextStep = note.step;

    const hit = yToStaffAndStep(y);
    if (hit.staff === note.staff) nextStep = hit.step;

    const head = chainHead(score, note);
    if (nextStart === head.start && nextStep === head.step) return;

    drag.moved = true;
    const live = mutateLive || mutate;
    live((s) => {
      const result = moveChain(s, drag.noteId, {
        start: nextStart,
        step: nextStep,
        intendedDuration: drag.originSounding
      });
      if (result) {
        drag.noteId = result.head.id;
        setUi({ selectedId: result.head.id });
      } else {
        setStatus?.('That beat is taken');
      }
    });
    setStatus?.(stepLabel(note.staff, nextStep));
  }

  function onPointerUp(e) {
    if (pointerId !== e.pointerId) return;
    try {
      svg.releasePointerCapture(e.pointerId);
    } catch (_) {
      /* ignore */
    }
    const score = getScore();
    const d = drag;
    drag = null;
    pointerId = null;
    svg.classList.remove('is-scrubbing');
    if (!d) return;

    if (d.mode === 'playhead') {
      const { x } = svgPoint(e.clientX, e.clientY);
      const pos = xToPlayheadStart(x, ks(), score.measures, score.timeSig);
      playback.seek(pos, { resume: d.wasPlaying, score });
      setUi({ playheadStart: playback.state.playheadStart });
      redraw();
      return;
    }

    if (d.mode === 'place') {
      placeAt(d.start, d.staff, d.step);
      return;
    }

    if (d.mode === 'maybe') {
      // Click without drag → keep selection (already set on pointerdown)
      redraw();
      return;
    }

    if (d.mode === 'move') {
      const note = findNote(getScore(), d.noteId);
      if (note && !note.rest && d.moved) {
        playback.preview(getScore(), chainHead(getScore(), note));
      }
    }
  }

  function onPointerCancel(e) {
    if (pointerId !== e.pointerId) return;
    const wasPlaying = drag && drag.mode === 'playhead' && drag.wasPlaying;
    drag = null;
    pointerId = null;
    svg.classList.remove('is-scrubbing');
    if (wasPlaying) playback.play(getScore());
  }

  function placeAt(start, staff, step) {
    clearShadow();
    const score = getScore();
    const ui = getUi();
    const intended = paletteDuration(ui.tool);
    const voice = ui.tool.voice;
    const rest = ui.tool.rest;

    const existing = noteAt(score, { staff, start, step, voice, rest });
    if (existing) {
      selectHead(existing);
      redraw();
      return;
    }

    mutate((s) => {
      const n = addNote(s, {
        staff,
        start,
        step: rest ? Math.floor(naturalsForStaff(staff).length / 2) : step,
        duration: intended,
        intendedDuration: intended,
        voice,
        rest
      });
      if (n) {
        setUi({ selectedId: n.id });
        if (!rest) playback.preview(s, n);
      } else if (!rest) {
        setStatus?.('That beat is taken');
      }
    });
  }

  function placeLetter(letterIdx) {
    const ui = getUi();
    if (ui.tool.rest) {
      setStatus?.('Turn off Rest (R) to type A–G');
      return;
    }
    clearShadow();
    const score = getScore();
    let staff = 'treble';
    let preferStep = Math.floor(naturalsForStaff('treble').length / 2);
    if (ui.selectedId) {
      const sel = findNote(score, ui.selectedId);
      if (sel && !sel.rest) {
        staff = sel.staff;
        preferStep = sel.step;
      }
    }
    const step = stepNearestLetter(staff, letterIdx, preferStep);
    const start = clamp(
      Math.floor(ui.playheadStart),
      0,
      Math.max(0, totalSixteenths(score.measures, score.timeSig) - 1)
    );
    const intended = paletteDuration(ui.tool);
    mutate((s) => {
      const n = addNote(s, {
        staff,
        start,
        step,
        duration: intended,
        intendedDuration: intended,
        voice: ui.tool.voice,
        rest: false
      });
      if (n) {
        setUi({ selectedId: n.id });
        playback.preview(s, n);
        const sounding = soundingDuration(s, n);
        const nextHead = Math.min(totalSixteenths(s.measures, s.timeSig), n.start + sounding);
        playback.seek(nextHead, { score: s });
        setUi({ playheadStart: nextHead, selectedId: n.id });
        setStatus?.(stepLabel(staff, step));
      } else {
        setStatus?.('That beat is taken');
      }
    });
  }

  /** Insert a rest at the playhead (key 0). */
  function enterRestAtPlayhead() {
    clearShadow();
    const score = getScore();
    const ui = getUi();
    let staff = 'treble';
    if (ui.selectedId) {
      const sel = findNote(score, ui.selectedId);
      if (sel) staff = sel.staff;
    }
    const start = clamp(
      Math.floor(ui.playheadStart),
      0,
      Math.max(0, totalSixteenths(score.measures, score.timeSig) - 1)
    );
    const intended = paletteDuration(ui.tool);
    mutate((s) => {
      const n = addNote(s, {
        staff,
        start,
        duration: intended,
        voice: ui.tool.voice,
        rest: true
      });
      if (n) {
        const nextHead = Math.min(totalSixteenths(s.measures, s.timeSig), n.start + n.duration);
        playback.seek(nextHead, { score: s });
        setUi({
          selectedId: n.id,
          playheadStart: nextHead,
          tool: { ...getUi().tool, rest: false }
        });
        ui.onToolChange?.();
        setStatus?.('Rest');
      } else {
        setStatus?.('That beat is taken');
      }
    });
  }

  function stepLabel(staff, step) {
    const midi = naturalsForStaff(staff)[step];
    const names = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];
    return names[midi % 12] + (Math.floor(midi / 12) - 1);
  }

  function onKeyDown(e) {
    const tag = (e.target && e.target.tagName) || '';
    if (tag === 'INPUT' || tag === 'SELECT' || tag === 'TEXTAREA' || e.target.isContentEditable) {
      return;
    }
    const score = getScore();
    const ui = getUi();
    const meta = e.metaKey || e.ctrlKey;

    if (e.code === 'Space') {
      e.preventDefault();
      playback.toggle(score);
      setUi({ playheadStart: playback.state.playheadStart });
      return;
    }

    if (meta && e.key.toLowerCase() === 'z') {
      e.preventDefault();
      if (e.shiftKey) ui.historyRedo?.();
      else ui.historyUndo?.();
      return;
    }

    if (meta && e.key.toLowerCase() === 'c') {
      if (!ui.selectedId) return;
      e.preventDefault();
      const payload = copySelectionPayload(score, ui.selectedId);
      if (!payload) {
        setStatus?.('Nothing to copy');
        return;
      }
      clipboard = payload;
      setStatus?.(payload.rest ? 'Rest copied' : 'Note copied');
      return;
    }

    if (meta && e.key.toLowerCase() === 'v') {
      e.preventDefault();
      if (!clipboard) {
        setStatus?.('Clipboard empty');
        return;
      }
      clearShadow();
      const start = clamp(
        Math.floor(ui.playheadStart),
        0,
        Math.max(0, totalSixteenths(score.measures, score.timeSig) - 1)
      );
      mutate((s) => {
        const placed = pasteSelectionPayload(s, clipboard, start);
        if (!placed) {
          setStatus?.('That beat is taken');
          return;
        }
        setUi({ selectedId: placed.id });
        if (!placed.rest) playback.preview(s, placed);
        const advance = placed.rest ? placed.duration : soundingDuration(s, placed);
        const nextHead = Math.min(totalSixteenths(s.measures, s.timeSig), placed.start + advance);
        playback.seek(nextHead, { score: s });
        setUi({ playheadStart: nextHead, selectedId: placed.id });
        setStatus?.('Pasted');
      });
      return;
    }

    if (e.key === 'Delete' || e.key === 'Backspace') {
      if (!ui.selectedId) return;
      e.preventDefault();
      const n = findNote(score, ui.selectedId);
      if (!n) return;
      if (n.rest) {
        mutate((s) => {
          removeChain(s, ui.selectedId);
          setUi({ selectedId: null });
        });
        setStatus?.('Rest removed');
        return;
      }
      mutate((s) => {
        const rest = replaceChainWithRest(s, ui.selectedId);
        if (rest) setUi({ selectedId: rest.id });
        else setUi({ selectedId: null });
      });
      return;
    }

    if (e.key === 'Escape') {
      if (!ui.selectedId) return;
      e.preventDefault();
      setUi({ selectedId: null });
      redraw();
      return;
    }

    if (e.key >= '1' && e.key <= '5') {
      const bases = [DUR.whole, DUR.half, DUR.quarter, DUR.eighth, DUR.sixteenth];
      const baseDur = bases[Number(e.key) - 1];
      // Duration applies to notes and rests — do not exit rest mode
      setUi({ tool: { ...ui.tool, baseDur } });
      applyDurationToSelection(baseDur, ui.tool.dotted);
      ui.onToolChange?.();
      return;
    }

    if (e.key === '.') {
      const dotted = !ui.tool.dotted;
      setUi({ tool: { ...ui.tool, dotted } });
      applyDurationToSelection(ui.tool.baseDur, dotted);
      ui.onToolChange?.();
      return;
    }

    if (e.key === 'r' || e.key === 'R') {
      setUi({ tool: { ...ui.tool, rest: !ui.tool.rest } });
      ui.onToolChange?.();
      return;
    }

    // 0 enters a rest at the playhead with the current duration
    if (e.key === '0') {
      e.preventDefault();
      enterRestAtPlayhead();
      return;
    }

    const letterIdx = letterIndexFromKey(e.key);
    if (letterIdx != null && !meta) {
      e.preventDefault();
      placeLetter(letterIdx);
      return;
    }

    if (e.key === 't' || e.key === 'T') {
      e.preventDefault();
      tieSelected();
      return;
    }

    if (e.key === '#' || (e.key === 's' && !meta)) {
      cycleAccidental('sharp');
      return;
    }
    if (e.key === '-' || e.key === '_') {
      cycleAccidental('flat');
      return;
    }
    if (e.key === 'n' && !meta) {
      cycleAccidental('natural');
      return;
    }

    if (e.key === 'ArrowUp' || e.key === 'ArrowDown') {
      if (!ui.selectedId) return;
      e.preventDefault();
      const delta = e.key === 'ArrowUp' ? 1 : -1;
      mutate((s) => {
        const n = findNote(s, ui.selectedId);
        if (!n || n.rest) return;
        const head = chainHead(s, n);
        const max = naturalsForStaff(head.staff).length - 1;
        const nextStep = clamp(head.step + delta, 0, max);
        const result = moveChain(s, head.id, { start: head.start, step: nextStep });
        if (result) setUi({ selectedId: result.head.id });
      });
      return;
    }

    if (e.key === 'ArrowLeft' || e.key === 'ArrowRight') {
      if (!ui.selectedId) return;
      e.preventDefault();
      mutate((s) => {
        const n = findNote(s, ui.selectedId);
        if (!n) return;
        const head = chainHead(s, n);
        const total = totalSixteenths(s.measures, s.timeSig);
        const moveBy = e.shiftKey ? 1 : Math.max(1, soundingDuration(s, head) || head.duration);
        const delta = e.key === 'ArrowRight' ? moveBy : -moveBy;
        const nextStart = clamp(head.start + delta, 0, Math.max(0, total - 1));
        if (head.rest) {
          moveRest(s, head.id, nextStart);
          return;
        }
        const result = moveChain(s, head.id, {
          start: nextStart,
          step: head.step,
          intendedDuration: soundingDuration(s, head)
        });
        if (result) setUi({ selectedId: result.head.id });
        else setStatus?.('That beat is taken');
      });
      return;
    }
  }

  /** Apply palette duration to the current selection (notes and rests). */
  function applyDurationToSelection(baseDur, dotted) {
    const ui = getUi();
    if (!ui.selectedId) return;
    const dur = applyDot(baseDur, dotted);
    mutate((s) => {
      const head = setSelectionDuration(s, ui.selectedId, dur);
      if (head) setUi({ selectedId: head.id });
    });
  }

  function cycleAccidental(kind) {
    const ui = getUi();
    if (!ui.selectedId) return;
    mutate((s) => {
      const n = findNote(s, ui.selectedId);
      if (!n || n.rest) return;
      const head = chainHead(s, n);
      const next = head.accidental === kind ? null : kind;
      updateNote(s, head.id, { accidental: next });
      // Continuations stay without accidental
      for (const seg of chainNotes(s, head)) {
        if (seg.id !== head.id) updateNote(s, seg.id, { accidental: null });
      }
      playback.preview(s, { ...head, accidental: next });
      setUi({ selectedId: head.id });
    });
  }

  function tieSelected() {
    const ui = getUi();
    if (!ui.selectedId) return;
    mutate((s) => {
      const n = findNote(s, ui.selectedId);
      if (!n || n.rest) return;
      if (n.tieTo) {
        updateNote(s, n.id, { tieTo: null });
        return;
      }
      // Contiguous only: next must start exactly when this ends
      const next = s.notes
        .filter(
          (o) =>
            !o.rest &&
            o.staff === n.staff &&
            o.voice === n.voice &&
            o.step === n.step &&
            o.start === n.start + n.duration
        )
        .sort((a, b) => a.start - b.start)[0];
      if (next) updateNote(s, n.id, { tieTo: next.id });
      else setStatus?.('No adjacent note to tie');
    });
  }

  function setDynamic(dyn) {
    const ui = getUi();
    if (!ui.selectedId) return;
    mutate((s) => {
      const n = findNote(s, ui.selectedId);
      if (!n || n.rest) return;
      const head = chainHead(s, n);
      updateNote(s, head.id, { dynamic: head.dynamic === dyn ? null : dyn });
      setUi({ selectedId: head.id });
    });
  }

  svg.addEventListener('pointerdown', onPointerDown);
  svg.addEventListener('pointermove', onPointerMove);
  svg.addEventListener('pointerup', onPointerUp);
  svg.addEventListener('pointercancel', onPointerCancel);
  svg.addEventListener('pointerleave', () => {
    if (!drag) clearShadow();
  });
  window.addEventListener('keydown', onKeyDown);

  return { setDynamic, tieSelected, placeAt, applyDurationToSelection };
}
