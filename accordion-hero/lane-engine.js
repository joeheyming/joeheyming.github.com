/**
 * Accordion Hero — lane / judgment engine.
 *
 * Owns:
 *   - lane assignment (derived from the chart's events)
 *   - the falling-note model (positions are computed per-frame from beat × pxPerBeat)
 *   - per-chord-beat input collection (multi-touch + concurrent keys all funnel
 *     into a single pitch-class set keyed by chordBeatId)
 *   - judgment: timing tier (PERFECT / GREAT / GOOD / MISS) × voicing
 *     multiplier (1.0× / 0.85× / 0.7× / 0×) → final score
 *
 * The engine is fully time-driven: it doesn't run RAF itself, it exposes
 * `tick(nowSec)` that the renderer calls each frame, and `pressLane` /
 * `releaseLane` / `pressBassPc` / `releaseBassPc` for input. The renderer
 * reads engine state (`getActiveNotes()`, `getLanes()`, `getScore()`,
 * `getLastJudgment()`) and draws.
 */

import { notesForButton } from '../play/accordion/stradella-chords.js';
import { judgeVoicing, VOICING_TIERS } from './chord-judge.js';

/**
 * Timing windows in seconds (centered on the note's hit time).
 *
 * Tuned for a casual rhythm game played with QWERTY keys / touch — much
 * more forgiving than StepMania-tournament defaults (which are ±25 ms
 * Perfect / ±60 ms Great / ±120 ms Good). Most browser-input chains
 * have 30–60 ms of jitter on their own, so an aggressive Perfect window
 * just makes "hit the button when it lights up" feel impossible.
 */
const TIMING_WINDOWS = [
  { name: 'perfect', halfWidthSec: 0.08, points: 1000 }, // ±80 ms
  { name: 'great', halfWidthSec: 0.15, points: 700 }, // ±150 ms
  { name: 'good', halfWidthSec: 0.25, points: 400 }, // ±250 ms
  { name: 'miss', halfWidthSec: Infinity, points: 0 }
];

// Once a chord beat is older than this past its hit time and still
// unresolved, finalize it as a miss. Has to be ≥ the widest non-miss
// window (`good`) so a press right at that edge still gets credit
// before the engine writes the beat off.
const MAX_LATE_SEC = 0.28;

// We hold input in a rolling window so a chord pressed slightly before
// the strike line still counts. Mirrors `MAX_LATE_SEC` for symmetry.
const MAX_EARLY_SEC = 0.28;

// Bass row pitch class (single note); chord rows have a fan of pitch classes.
function lanePitchClasses(lane) {
  if (lane.row === 'bass') return [lane.pc];
  const notes = notesForButton(lane.row, lane.pc);
  return notes.map((m) => ((m % 12) + 12) % 12);
}

function laneLabel(lane) {
  const NAMES = ['C', 'C♯', 'D', 'D♯', 'E', 'F', 'F♯', 'G', 'G♯', 'A', 'A♯', 'B'];
  const root = NAMES[lane.pc];
  switch (lane.row) {
    case 'bass':
      return { main: root, sub: 'bass' };
    case 'major':
      return { main: root, sub: 'maj' };
    case 'minor':
      return { main: root + 'm', sub: 'min' };
    case 'dom7':
      return { main: root + '7', sub: 'dom7' };
    case 'dim7':
      return { main: root + '°', sub: 'dim7' };
    default:
      return { main: root, sub: lane.row };
  }
}

/**
 * Mini-Stradella grid order. Columns run around the **circle of fifths**
 * centered on the song's key root — IV (subdominant) to the left of
 * the home column, V (dominant) to the right, then II / ♭VII on the
 * outside, just like a real Stradella keyboard. Rows run top-to-bottom
 * in the same order as a real Stradella: bass first, then chord rows
 * (major / minor / dom7 / dim7).
 *
 * This mirrors the on-screen Stradella layout in `play/accordion/`,
 * just trimmed to the columns + rows the song actually uses so the
 * grid stays readable as a rhythm-game playfield.
 */
const ROW_ORDER = {
  bass: 0,
  'counter-bass': 1, // present if a song ever uses it (chart-loader doesn't yet)
  major: 2,
  minor: 3,
  dom7: 4,
  dim7: 5
};

function deriveStradellaGrid(lanes, keyRootPc) {
  // Signed circle-of-fifths offset for each pitch class, indexed by the
  // pitch-class distance from the song's key root. The root maps to 0,
  // the V (a fifth above) to +1, the IV (a fifth below) to -1, the II
  // to +2, the ♭VII to -2, and so on around the circle. Sorting columns
  // by this signed offset centers the home column with the
  // flat-side (subdominant) chords to its left and the sharp-side
  // (dominant) chords to its right — the way a real Stradella keyboard
  // reads (e.g. in key C, the columns line up as F, C, G).
  const FIFTHS_OFFSET = [
    0, // pc +0 — I (root)
    -5, // pc +1 — ♭II
    2, // pc +2 — II
    -3, // pc +3 — ♭III
    4, // pc +4 — III
    -1, // pc +5 — IV
    6, // pc +6 — tritone (arbitrary side; folds to the right)
    1, // pc +7 — V
    -4, // pc +8 — ♭VI
    3, // pc +9 — VI
    -2, // pc +10 — ♭VII
    5 // pc +11 — VII
  ];
  const rotate = (pc) => (((pc - keyRootPc) % 12) + 12) % 12;
  const positionOf = (pc) => FIFTHS_OFFSET[rotate(pc)];

  // Group by column pc, collect rows that exist for that column.
  const colMap = new Map(); // pc → { pc, rows: Set<rowName> }
  for (const lane of lanes) {
    let entry = colMap.get(lane.pc);
    if (!entry) {
      entry = { pc: lane.pc, rows: new Set() };
      colMap.set(lane.pc, entry);
    }
    entry.rows.add(lane.row);
  }

  // Sort columns by circle-of-fifths position around the key root.
  const sortedCols = Array.from(colMap.values()).sort(
    (a, b) => positionOf(a.pc) - positionOf(b.pc)
  );

  // Collect all rows used across the song, sorted by Stradella row order.
  const rowsUsed = new Set();
  for (const c of sortedCols) for (const r of c.rows) rowsUsed.add(r);
  const sortedRows = Array.from(rowsUsed).sort(
    (a, b) => (ROW_ORDER[a] ?? 99) - (ROW_ORDER[b] ?? 99)
  );

  return {
    columns: sortedCols.map((c, i) => ({ pc: c.pc, colIndex: i })),
    rows: sortedRows.map((r, i) => ({ row: r, rowIndex: i }))
  };
}

function laneKey(lane) {
  return `${lane.row}:${lane.pc}`;
}

const KEY_ROOT_PC = {
  C: 0,
  D: 2,
  E: 4,
  F: 5,
  G: 7,
  A: 9,
  B: 11
};

function parseKey(keyStr) {
  if (!keyStr || typeof keyStr !== 'string') return 0;
  const m = keyStr.trim().match(/^([A-Ga-g])([#♯b♭]?)/);
  if (!m) return 0;
  let pc = KEY_ROOT_PC[m[1].toUpperCase()] ?? 0;
  if (m[2] === '#' || m[2] === '♯') pc = (pc + 1) % 12;
  if (m[2] === 'b' || m[2] === '♭') pc = (pc + 11) % 12;
  return pc;
}

/**
 * Create a lane engine for a parsed chart.
 *
 * @param {{meta:object, events:Array, totalBeats:number}} chart
 * @returns {object} engine instance
 */
export function createLaneEngine(chart) {
  // ----- Lane derivation -----
  // Collect unique (col, row) cells used by the song.
  const laneMap = new Map(); // laneKey → lane
  for (const ev of chart.events) {
    const k = laneKey(ev.lane);
    if (!laneMap.has(k)) laneMap.set(k, ev.lane);
  }
  const keyRootPc = parseKey(chart.meta.key);
  const grid = deriveStradellaGrid(Array.from(laneMap.values()), keyRootPc);
  const colByPc = new Map(grid.columns.map((c) => [c.pc, c.colIndex]));
  const rowByName = new Map(grid.rows.map((r) => [r.row, r.rowIndex]));

  // Assign each (col, row) cell a flat lane index (used as a key by
  // input + judgment), plus its 2D grid position for rendering.
  const lanes = Array.from(laneMap.values())
    .map((lane) => {
      return {
        ...lane,
        colIndex: colByPc.get(lane.pc),
        rowIndex: rowByName.get(lane.row),
        label: laneLabel(lane),
        pitchClasses: lanePitchClasses(lane)
      };
    })
    // Sort by (row top-to-bottom, then column left-to-right) so flat
    // index ordering matches a top-row-first reading order — that's
    // also the order the keyboard fallback maps A S D F … into.
    .sort((a, b) => a.rowIndex - b.rowIndex || a.colIndex - b.colIndex)
    .map((lane, idx) => ({ ...lane, index: idx }));

  // Build a (col, row) → laneIndex lookup so input can route fast.
  const laneByCell = new Map();
  for (const lane of lanes) {
    laneByCell.set(`${lane.colIndex}:${lane.rowIndex}`, lane);
    // Re-write laneMap entries so chart events still resolve.
    laneMap.set(laneKey({ row: lane.row, pc: lane.pc }), lane);
  }

  // ----- Note model -----
  // Each event becomes one falling note. Notes hit the strike line at
  // `note.hitSec` (computed from beat × secondsPerBeat in start()).
  const allNotes = chart.events.map((ev, i) => {
    const lane = laneMap.get(laneKey(ev.lane));
    return {
      id: i,
      laneIndex: lane.index,
      colIndex: lane.colIndex,
      rowIndex: lane.rowIndex,
      beat: ev.beat,
      chordBeatId: ev.chordBeatId,
      // Suggested sustain duration in beats — drives the visual tail
      // length so chord beats look like hold-notes instead of taps.
      holdBeats: ev.holdBeats ?? 0,
      targetChord: ev.targetChord,
      label: ev.label,
      hitSec: 0, // filled in at start()
      holdSec: 0, // filled in at start()
      state: 'pending', // 'pending' | 'judged' | 'expired'
      judgment: null
    };
  });

  // Group notes by chordBeatId for fast lookup.
  const beatGroups = new Map(); // chordBeatId → { hitSec, notes[], target, label, state, pressedPcs:Set }
  for (const note of allNotes) {
    let g = beatGroups.get(note.chordBeatId);
    if (!g) {
      g = {
        chordBeatId: note.chordBeatId,
        beat: note.beat,
        hitSec: 0,
        notes: [],
        target: note.targetChord,
        label: note.label,
        state: 'pending', // 'pending' | 'judged'
        // Pressed pitch classes accumulated in the input window.
        pressedPcs: new Set(),
        // Per-note earliest hit time the player landed (for timing tier).
        notePressedAt: new Map() // noteId → time
      };
      beatGroups.set(note.chordBeatId, g);
    }
    g.notes.push(note);
  }

  // ----- Runtime state -----
  let bpm = chart.meta.bpm || 100;
  // `secondsPerBeat` is the *effective* per-beat duration after the user's
  // speed multiplier is applied. Tempo IS scaled by `speedScale`: at 0.5×
  // the song plays at half speed (twice as long per beat), at 2.0× double
  // speed. The slider acts like the tempo dial on a real metronome.
  let speedScale = 1.0;
  let secondsPerBeat = 60 / bpm / speedScale;
  let startedAt = 0; // performance.now() seconds
  let nowSec = 0;

  let score = 0;
  let combo = 0;
  let maxCombo = 0;
  const judgmentCounts = { perfect: 0, great: 0, good: 0, miss: 0 };
  const voicingCounts = { full: 0, sub: 0, partial: 0, wrong: 0 };

  let lastJudgment = null; // { tier, voicing, points, at }

  // Currently held lane buttons: laneIndex → true. Multi-touch + multi-key feed this.
  const heldLanes = new Set();

  // ----- API -----

  function getLanes() {
    return lanes;
  }

  function getLaneByIndex(i) {
    return lanes[i];
  }

  // Count-in: delay all hitSec values by this many beats so the player has
  // time to feel the tempo before the first chord arrives. Set by
  // `start({ countInBeats })`; 0 disables the count-in.
  let countInBeats = 0;

  function start(now = performance.now() / 1000, opts = {}) {
    // Recompute secondsPerBeat here in case the slider was nudged between
    // construction and `start()` — that's the typical flow from
    // `startSelectedSong`.
    secondsPerBeat = 60 / bpm / speedScale;
    // Default count-in = one bar of the song's time signature. Songs in 3/4
    // get a 3-beat count, 4/4 gets 4 beats. Callers can override.
    const beatsPerBar = (chart.meta.timeSig && chart.meta.timeSig[0]) || 4;
    countInBeats = opts.countInBeats ?? beatsPerBar;
    const countInSec = countInBeats * secondsPerBeat;
    startedAt = now;
    nowSec = 0;
    score = 0;
    combo = 0;
    maxCombo = 0;
    judgmentCounts.perfect = 0;
    judgmentCounts.great = 0;
    judgmentCounts.good = 0;
    judgmentCounts.miss = 0;
    voicingCounts.full = 0;
    voicingCounts.sub = 0;
    voicingCounts.partial = 0;
    voicingCounts.wrong = 0;
    lastJudgment = null;
    heldLanes.clear();

    for (const note of allNotes) {
      note.hitSec = note.beat * secondsPerBeat + countInSec;
      note.holdSec = (note.holdBeats || 0) * secondsPerBeat;
      note.state = 'pending';
      note.judgment = null;
    }
    for (const g of beatGroups.values()) {
      g.hitSec = g.beat * secondsPerBeat + countInSec;
      g.state = 'pending';
      g.pressedPcs.clear();
      g.notePressedAt.clear();
    }
  }

  function setSpeed(scale) {
    speedScale = Math.max(0.3, Math.min(2.5, scale));
    // Reflect immediately so `secondsPerBeat` is consistent if someone
    // queries it before `start()`.
    secondsPerBeat = 60 / bpm / speedScale;
  }

  function getSpeed() {
    return speedScale;
  }

  function elapsedSec() {
    return nowSec;
  }

  function songLengthSec() {
    return chart.totalBeats * secondsPerBeat + countInBeats * secondsPerBeat + 1.0;
  }

  /**
   * Per-frame tick. The renderer calls this with the current wall-clock
   * time (in seconds). The engine updates internal time, finalizes any
   * chord beats whose window has passed, and triggers `onResolve` for
   * those.
   */
  function tick(absSec, callbacks = {}) {
    nowSec = absSec - startedAt;
    // Finalize any past-window pending beats as MISS or with whatever
    // input was collected so far.
    for (const g of beatGroups.values()) {
      if (g.state !== 'pending') continue;
      // If too late, finalize.
      const late = nowSec - g.hitSec;
      if (late > MAX_LATE_SEC) {
        finalizeBeat(g, callbacks);
      }
    }
  }

  function finalizeBeat(g, callbacks) {
    if (g.state !== 'pending') return;
    g.state = 'judged';

    // Voicing judgment.
    const voicing = judgeVoicing(g.pressedPcs, g.target);

    // Timing judgment is the best timing of any note in this beat
    // (so if any individual press landed PERFECT, the whole beat
    // gets the PERFECT timing tier — generous on purpose).
    let bestTier = 'miss';
    let bestPoints = 0;
    if (g.notePressedAt.size > 0) {
      let bestAbsDelta = Infinity;
      for (const t of g.notePressedAt.values()) {
        const delta = Math.abs(t - g.hitSec);
        if (delta < bestAbsDelta) bestAbsDelta = delta;
      }
      for (const win of TIMING_WINDOWS) {
        if (bestAbsDelta <= win.halfWidthSec) {
          bestTier = win.name;
          bestPoints = win.points;
          break;
        }
      }
    }

    // Combined score: timing points × voicing multiplier.
    let pts = Math.round(bestPoints * voicing.multiplier);
    let tier = bestTier;

    if (voicing.tier === 'wrong' || bestTier === 'miss') {
      tier = 'miss';
      pts = 0;
      combo = 0;
      judgmentCounts.miss += 1;
    } else {
      judgmentCounts[tier] = (judgmentCounts[tier] || 0) + 1;
      combo += 1;
      if (combo > maxCombo) maxCombo = combo;
      // Combo multiplier caps at ×4.
      const comboMult = 1 + Math.min(combo, 30) * 0.05;
      pts = Math.round(pts * comboMult);
    }

    voicingCounts[voicing.tier] = (voicingCounts[voicing.tier] || 0) + 1;
    score += pts;

    // Mark all notes in the beat as judged.
    for (const note of g.notes) {
      note.state = 'judged';
      note.judgment = { tier, voicing: voicing.tier };
    }

    lastJudgment = {
      tier,
      voicing: voicing.tier,
      voicingLabel: voicing.label,
      playedName: voicing.playedName,
      targetLabel: g.label,
      points: pts,
      at: nowSec
    };

    if (callbacks.onJudgment) callbacks.onJudgment(lastJudgment, g);
  }

  /**
   * Mark a lane as pressed. Adds the lane's pitch classes to any
   * chord-beat group whose hit window currently includes this time.
   */
  function pressLane(laneIndex, absSec, callbacks = {}) {
    const lane = lanes[laneIndex];
    if (!lane) return;
    if (heldLanes.has(laneIndex)) return;
    heldLanes.add(laneIndex);

    const t = absSec - startedAt;
    // Find the nearest pending beat whose window includes t.
    let target = null;
    let bestDelta = Infinity;
    for (const g of beatGroups.values()) {
      if (g.state !== 'pending') continue;
      const delta = t - g.hitSec;
      if (delta > MAX_LATE_SEC) continue;
      if (delta < -MAX_EARLY_SEC) continue;
      const abs = Math.abs(delta);
      if (abs < bestDelta) {
        bestDelta = abs;
        target = g;
      }
    }

    // Audio: play the lane's notes regardless of whether they
    // contribute to a chord-beat (free improvisation between hits is
    // fine — it just doesn't score).
    if (callbacks.onLaneAudioOn) callbacks.onLaneAudioOn(lane);

    if (!target) return;

    for (const pc of lane.pitchClasses) target.pressedPcs.add(pc);
    // Record the earliest press time per matching note in this beat,
    // so timing judgment uses real player timing per lane.
    for (const note of target.notes) {
      if (note.laneIndex === laneIndex && !target.notePressedAt.has(note.id)) {
        target.notePressedAt.set(note.id, t);
      }
    }

    // Eager finalization: if every suggested note in the beat is
    // pressed AND we're past the hit time, finalize immediately so
    // the judgment text shows up promptly (instead of waiting for the
    // late-window timeout).
    const allSuggestedHit = target.notes.every((n) => target.notePressedAt.has(n.id));
    if (allSuggestedHit && t >= target.hitSec - 0.01) {
      finalizeBeat(target, callbacks);
    }
  }

  function releaseLane(laneIndex, absSec, callbacks = {}) {
    if (!heldLanes.has(laneIndex)) return;
    heldLanes.delete(laneIndex);
    const lane = lanes[laneIndex];
    if (lane && callbacks.onLaneAudioOff) callbacks.onLaneAudioOff(lane);
  }

  function releaseAll(callbacks = {}) {
    for (const i of Array.from(heldLanes)) {
      releaseLane(i, performance.now() / 1000, callbacks);
    }
  }

  function getActiveNotes(now = nowSec, lookAheadSec = 3.5) {
    // Notes within `lookAheadSec` of the current time, in either direction
    // (so judged-but-recent notes can still draw their flash).
    const out = [];
    for (const note of allNotes) {
      const dt = note.hitSec - now;
      if (dt > lookAheadSec) continue;
      if (dt < -MAX_LATE_SEC - 0.2) continue;
      out.push(note);
    }
    return out;
  }

  function getBeatGroup(chordBeatId) {
    return beatGroups.get(chordBeatId) || null;
  }

  function isDone(now = nowSec) {
    // Done when we're past the last beat's hit window.
    if (allNotes.length === 0) return true;
    const last = allNotes[allNotes.length - 1];
    return now > last.hitSec + MAX_LATE_SEC + 0.2;
  }

  function getScore() {
    return score;
  }

  function getCombo() {
    return combo;
  }

  function getMaxCombo() {
    return maxCombo;
  }

  function getCounts() {
    return { judgment: { ...judgmentCounts }, voicing: { ...voicingCounts } };
  }

  function getLastJudgment() {
    return lastJudgment;
  }

  function getSecondsPerBeat() {
    return secondsPerBeat;
  }

  function getCountInBeats() {
    return countInBeats;
  }

  /**
   * Seconds remaining in the count-in (or 0 if the count-in is over / not
   * configured). The renderer uses this to draw the "READY 3 2 1 GO!"
   * overlay and to schedule per-beat tick sounds.
   */
  function getCountInRemaining() {
    if (countInBeats <= 0) return 0;
    const countInSec = countInBeats * secondsPerBeat;
    return Math.max(0, countInSec - nowSec);
  }

  function getCountInTotalSec() {
    return countInBeats * secondsPerBeat;
  }

  function isLaneHeld(i) {
    return heldLanes.has(i);
  }

  function getGrid() {
    return grid;
  }

  return {
    lanes,
    grid,
    getLanes,
    getLaneByIndex,
    getGrid,
    start,
    setSpeed,
    getSpeed,
    tick,
    pressLane,
    releaseLane,
    releaseAll,
    getActiveNotes,
    getBeatGroup,
    getScore,
    getCombo,
    getMaxCombo,
    getCounts,
    getLastJudgment,
    getSecondsPerBeat,
    getCountInBeats,
    getCountInRemaining,
    getCountInTotalSec,
    elapsedSec,
    songLengthSec,
    isDone,
    isLaneHeld,
    MAX_EARLY_SEC,
    MAX_LATE_SEC,
    TIMING_WINDOWS,
    VOICING_TIERS
  };
}

export { TIMING_WINDOWS };
