/**
 * Accordion Hero — page wiring + canvas render loop.
 *
 * StepMania-style layout: notes fall in N vertical columns (one per pitch
 * class used in the song). Column positions are pure math (w/N), no DOM
 * lookups needed.
 *
 * Single-song build: the chart for "That's Amore" is fetched from
 * `songs/thats-amore.json` and replayed with the lane engine. No video,
 * no song picker, no per-song prefs — just the rhythm-game core.
 */

import { getCtx, getMaster, resumeIfSuspended, setMasterVolume } from '../play/shared/audio.js';
import { AccordionSynth } from '../play/accordion/accordion-instruments.js';
import { RIGHT_REGISTERS } from '../play/accordion/accordion-registers.js';
import { notesForButton } from '../play/accordion/stradella-chords.js';

import { loadChart } from './chart-loader.js';
import { createLaneEngine } from './lane-engine.js';
import { attachInput, buildKeyMap, keyLabelForLaneIndex } from './input.js';

const SONG_URL = './songs/thats-amore.json';

// ----- DOM refs -----
const startScreenEl = document.getElementById('ah-start-screen');
const gameEl = document.getElementById('ah-game');
const resultsEl = document.getElementById('ah-results');
const toneSelectEl = /** @type {HTMLSelectElement} */ (document.getElementById('ah-tone-select'));
const speedEl = /** @type {HTMLInputElement} */ (document.getElementById('ah-speed'));
const speedValEl = document.getElementById('ah-speed-val');
const startBtnEl = document.getElementById('ah-start-btn');
const pauseBtnEl = document.getElementById('ah-pause-btn');
const resultsAgainBtnEl = document.getElementById('ah-results-again');
const canvasEl = /** @type {HTMLCanvasElement} */ (document.getElementById('ah-canvas'));
const laneBarEl = document.getElementById('ah-lane-bar');
const scoreEl = document.getElementById('ah-score');
const comboEl = document.getElementById('ah-combo');
const songTitleEl = document.getElementById('ah-song-title');
const songCreditEl = document.getElementById('ah-song-credit');
const judgmentEl = document.getElementById('ah-judgment');
const voicingEl = document.getElementById('ah-voicing');

const resScoreEl = document.getElementById('ah-results-score');
const resComboEl = document.getElementById('ah-results-combo');
const resPerfectEl = document.getElementById('ah-results-perfect');
const resSubEl = document.getElementById('ah-results-sub');
const resPartialEl = document.getElementById('ah-results-partial');
const resMissEl = document.getElementById('ah-results-miss');

// ----- Song loading -----
//
// We fetch + parse the chart once at startup so the Start-button click
// handler can run synchronously (no awaits in the user-gesture window).
// If the fetch fails we surface the error in the header status strip and
// leave the Start button disabled.

let currentChart = null;

(async function preloadChart() {
  startBtnEl.disabled = true;
  try {
    const resp = await fetch(SONG_URL);
    if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
    const song = await resp.json();
    currentChart = loadChart(song);
    if (songCreditEl) {
      songCreditEl.textContent = currentChart.meta.artist || '';
    }
    startBtnEl.disabled = false;
  } catch (err) {
    judgmentEl.textContent = 'LOAD ERROR';
    judgmentEl.dataset.tier = 'miss';
    voicingEl.textContent = `Couldn't load song: ${err?.message || err}`;
  }
})();

speedEl.addEventListener('input', () => {
  speedValEl.textContent = (Number(speedEl.value) / 100).toFixed(2) + '×';
});
speedValEl.textContent = (Number(speedEl.value) / 100).toFixed(2) + '×';

// ----- Audio -----

// Stick a +5 dB gain on the bass route. The bass-row Stradella button only
// produces a single MIDI note while a chord-row button fires a 3-note
// triad — a 3:1 amplitude disparity that, combined with the
// tango-accordion soundfont being naturally drier than the FreePats
// right-hand reeds, makes the bass feel buried in the mix during the
// rhythm-game's oom-pah-pah. ~1.7× linear ≈ +4.6 dB pulls it back up to
// where the chord buttons sit perceptually.
const audioCtx = getCtx();
const bassGainNode = audioCtx.createGain();
bassGainNode.gain.value = 1.75;
bassGainNode.connect(getMaster());

const synth = new AccordionSynth({ bassDestination: bassGainNode });
synth.setTone(toneSelectEl.value);
toneSelectEl.addEventListener('change', () => synth.setTone(toneSelectEl.value));

const RIGHT_MASTER = RIGHT_REGISTERS.find((r) => r.id === 'LMH') || RIGHT_REGISTERS[0];
synth.setRegister(RIGHT_MASTER.reeds);
setMasterVolume(0.7);

const laneVoices = new Map();

function laneAudioOn(lane) {
  const midis =
    lane.row === 'bass' ? [...notesForButton('bass', lane.pc)] : notesForButton(lane.row, lane.pc);
  const side = lane.row === 'bass' ? 'left' : 'right';
  laneVoices.set(lane.index, { midis, side });
  resumeIfSuspended();
  for (const m of midis) synth.noteOn(m, { side });
}

function laneAudioOff(lane) {
  const entry = laneVoices.get(lane.index);
  if (!entry) return;
  for (const m of entry.midis) synth.noteOff(m, { side: entry.side });
  laneVoices.delete(lane.index);
}

// ----- Canvas DPR scaling -----

function fitCanvas() {
  const dpr = window.devicePixelRatio || 1;
  const rect = canvasEl.getBoundingClientRect();
  const cssW = Math.max(1, Math.floor(rect.width));
  const cssH = Math.max(1, Math.floor(rect.height));
  if (canvasEl.width !== cssW * dpr || canvasEl.height !== cssH * dpr) {
    canvasEl.width = cssW * dpr;
    canvasEl.height = cssH * dpr;
  }
  return { w: cssW, h: cssH, dpr };
}

// ----- Game loop state -----

let engine = null;
let inputDispose = null;
let rafHandle = 0;

// Canvas-overlay state for the StepMania-style judgment + combo display.
// Both live in the canvas (not the DOM) so the impact reads as "rhythm
// game" rather than "status bar text".
const JUDGMENT_COLORS = {
  perfect: '#22d3ee',
  great: '#34d399',
  good: '#facc15',
  miss: '#ef4444'
};

const judgmentOverlay = {
  text: '',
  sub: '',
  tier: 'idle',
  shownAt: 0
};

let comboPopAt = 0;
let comboPrev = 0;

// Count-in tracking: which count-in beat (0-indexed) we last ticked on.
let countInLastTickIdx = -1;
let countInDone = false;

/**
 * Tiny percussive click via Web Audio — used for the count-in metronome
 * and the closing "GO!" hit. The first beat of the bar uses a slightly
 * lower, fuller pitch so the player can hear "where 1 is".
 */
function playClick(strong) {
  const ctx = getCtx();
  if (!ctx) return;
  resumeIfSuspended();
  const t0 = ctx.currentTime;
  const osc = ctx.createOscillator();
  const gain = ctx.createGain();
  osc.type = 'square';
  osc.frequency.setValueAtTime(strong ? 1400 : 2200, t0);
  gain.gain.setValueAtTime(0, t0);
  gain.gain.linearRampToValueAtTime(strong ? 0.18 : 0.1, t0 + 0.005);
  gain.gain.exponentialRampToValueAtTime(0.0001, t0 + 0.08);
  osc.connect(gain).connect(ctx.destination);
  osc.start(t0);
  osc.stop(t0 + 0.1);
}

function tickCountIn() {
  if (!engine || countInDone) return;
  const remaining = engine.getCountInRemaining();
  const totalBeats = engine.getCountInBeats();
  if (totalBeats <= 0) {
    countInDone = true;
    return;
  }

  const spb = engine.getSecondsPerBeat();
  const totalSec = totalBeats * spb;
  const elapsedInCountIn = totalSec - remaining;
  const beatIdx = Math.floor(elapsedInCountIn / spb);

  if (remaining > 0) {
    if (beatIdx > countInLastTickIdx && beatIdx < totalBeats) {
      countInLastTickIdx = beatIdx;
      playClick(beatIdx === 0);
      const beatsLeft = totalBeats - beatIdx;
      judgmentOverlay.text = String(beatsLeft);
      judgmentOverlay.sub = beatIdx === 0 ? 'READY…' : '';
      judgmentOverlay.tier = beatIdx === 0 ? 'good' : 'great';
      judgmentOverlay.shownAt = performance.now();
    }
  } else {
    countInDone = true;
    playClick(true);
    judgmentOverlay.text = 'GO!';
    judgmentOverlay.sub = '';
    judgmentOverlay.tier = 'perfect';
    judgmentOverlay.shownAt = performance.now();
  }
}

function triggerJudgmentOverlay(j) {
  const timing = j.tier;
  const text = timing === 'miss' ? 'MISS' : timing.toUpperCase();
  let sub = '';
  if (timing !== 'miss') {
    if (j.voicing === 'full') sub = `${j.targetLabel} ✓  +${j.points}`;
    else if (j.voicing === 'sub') sub = `${j.playedName || '?'} → ${j.targetLabel}  +${j.points}`;
    else if (j.voicing === 'partial')
      sub = `${j.playedName || '?'} ≈ ${j.targetLabel}  +${j.points}`;
  } else if (j.voicing === 'wrong' && j.playedName) {
    sub = `${j.playedName} ✗`;
  }
  judgmentOverlay.text = text;
  judgmentOverlay.sub = sub;
  judgmentOverlay.tier = timing;
  judgmentOverlay.shownAt = performance.now();
}

function comboTierColor(combo) {
  if (combo >= 100) return '#ff00ff';
  if (combo >= 50) return '#ffd700';
  if (combo >= 30) return '#00ffff';
  if (combo >= 20) return '#00ff88';
  if (combo >= 10) return '#88aaff';
  return '#aaaaaa';
}

function drawJudgmentLayer(ctx, w, strikeY, nowMs) {
  if (!judgmentOverlay.text) return;
  const t = (nowMs - judgmentOverlay.shownAt) / 1000;
  if (t > 0.95) return;

  const scale = 1.4 - Math.min(t / 0.1, 1) * 0.4;
  const alpha = t > 0.7 ? Math.max(0, 1 - (t - 0.7) / 0.25) : 1;
  if (alpha <= 0) return;

  const baseY = Math.min(strikeY * 0.4, 200);
  const y = judgmentOverlay.tier === 'miss' ? baseY - t * 70 : baseY;

  const color = JUDGMENT_COLORS[judgmentOverlay.tier] || '#fff';
  const size = Math.round(56 * scale);

  ctx.save();
  ctx.globalAlpha = alpha;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';

  ctx.font = `italic 900 ${size}px "Arial Black", Impact, system-ui, sans-serif`;
  ctx.lineWidth = 5 * scale;
  ctx.strokeStyle = 'rgba(0,0,0,0.9)';
  ctx.strokeText(judgmentOverlay.text, w / 2, y);
  ctx.shadowColor = color;
  ctx.shadowBlur = 20 * scale;
  ctx.fillStyle = color;
  ctx.fillText(judgmentOverlay.text, w / 2, y);

  if (judgmentOverlay.sub) {
    ctx.shadowBlur = 4;
    ctx.shadowColor = 'rgba(0,0,0,0.7)';
    ctx.font = `600 ${Math.round(
      16 * Math.min(scale, 1.1)
    )}px ui-sans-serif, system-ui, sans-serif`;
    ctx.lineWidth = 3;
    ctx.strokeStyle = 'rgba(0,0,0,0.85)';
    ctx.strokeText(judgmentOverlay.sub, w / 2, y + size * 0.6);
    ctx.fillStyle = '#e2e8f0';
    ctx.fillText(judgmentOverlay.sub, w / 2, y + size * 0.6);
  }
  ctx.restore();
}

function drawComboLayer(ctx, w, strikeY, nowMs) {
  const combo = engine.getCombo();
  if (combo < 4) {
    comboPrev = combo;
    return;
  }
  if (combo !== comboPrev) {
    if (combo > comboPrev) comboPopAt = nowMs;
    comboPrev = combo;
  }

  const dt = nowMs - comboPopAt;
  const scale = dt < 150 ? 1 + 0.25 * (1 - dt / 150) : 1;
  const color = comboTierColor(combo);
  const baseSize = combo >= 100 ? 60 : combo >= 50 ? 52 : 44;
  const fontSize = Math.round(baseSize * scale);

  const cx = w / 2;
  const cy = Math.min(strikeY * 0.62, 300);

  ctx.save();
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';

  if (combo >= 20) {
    ctx.shadowColor = color;
    ctx.shadowBlur = 15 + (combo >= 50 ? 10 : 0);
  } else {
    ctx.shadowColor = 'rgba(0,0,0,0.7)';
    ctx.shadowBlur = 4;
  }
  ctx.shadowOffsetX = 2;
  ctx.shadowOffsetY = 2;

  ctx.font = `bold ${fontSize}px "Segoe UI", Arial, sans-serif`;
  ctx.lineWidth = 3;
  ctx.strokeStyle = 'rgba(0,0,0,0.85)';
  ctx.strokeText(String(combo), cx, cy);
  ctx.fillStyle = color;
  ctx.fillText(String(combo), cx, cy);

  ctx.shadowBlur = 2;
  ctx.shadowOffsetX = 1;
  ctx.shadowOffsetY = 1;
  ctx.globalAlpha = 0.9;
  ctx.font = 'bold 14px "Segoe UI", Arial, sans-serif';
  ctx.fillStyle = color;
  ctx.fillText('COMBO', cx, cy + Math.round(fontSize * 0.62));

  if (combo % 50 === 0 && dt < 700) {
    ctx.globalAlpha = Math.max(0, 1 - dt / 700);
    ctx.shadowColor = '#ffd700';
    ctx.shadowBlur = 12;
    ctx.font = 'bold 18px "Segoe UI", Arial, sans-serif';
    ctx.fillStyle = '#ffd700';
    ctx.fillText(`★ ${combo} HIT MILESTONE ★`, cx, cy - Math.round(fontSize * 0.85));
  }
  ctx.restore();
}

// CSS `display: flex` on these panels overrides the HTML `hidden`
// attribute (author > UA), so we toggle `style.display` directly.
function showStart() {
  startScreenEl.style.removeProperty('display');
  gameEl.style.display = 'none';
  resultsEl.style.display = 'none';
}

function showGame() {
  startScreenEl.style.display = 'none';
  gameEl.style.removeProperty('display');
  resultsEl.style.display = 'none';
}

function showResults() {
  startScreenEl.style.display = 'none';
  gameEl.style.display = 'none';
  resultsEl.style.removeProperty('display');
}

const PC_NAMES = ['C', 'C♯', 'D', 'D♯', 'E', 'F', 'F♯', 'G', 'G♯', 'A', 'A♯', 'B'];

// Home pitches on a real Stradella (F, C, G — generalized to pc 0/4/8
// so the home dots stay evenly spaced regardless of how the column
// window is rotated).
const HOME_PITCH_CLASSES = new Set([0, 4, 8]);

// Per-row horizontal stagger, measured in column-widths. Each row down
// shifts the lane buttons (and the column of falling notes that maps to
// them) to the right by this fraction, giving the receptor strip the
// diagonal staircase look of a real Stradella keyboard. Applied
// identically in the canvas `laneX()` and in `buildLaneBar()` so the
// falling notes always land on top of their target buttons.
const ROW_DIAGONAL_OFFSET = 0.3;

function laneDiagonalShift(lane) {
  return (lane.rowIndex || 0) * ROW_DIAGONAL_OFFSET;
}

/**
 * Receptor strip: one button per lane. Columns evenly spaced; rows stack
 * top-to-bottom in Stradella order (bass at the top, chord rows below).
 */
function buildLaneBar(engine, laneToKey) {
  laneBarEl.innerHTML = '';
  const { rows } = engine.getGrid();
  const lanes = engine.getLanes();
  const numCols = engine.getGrid().columns.length;
  const numRows = rows.length;
  // Widen the effective column count to absorb the per-row diagonal
  // stagger so the rightmost button on the bottom row doesn't fall off
  // the right edge of the bar.
  const effectiveCols = numCols + Math.max(0, numRows - 1) * ROW_DIAGONAL_OFFSET;
  const unitPct = 100 / effectiveCols;

  laneBarEl.style.setProperty('--row-count', String(numRows));
  laneBarEl.style.setProperty('--col-count', String(numCols));

  // Vertical row-spread expressed as a percentage of the lane-bar
  // height. Combined with the per-row horizontal `laneDiagonalShift`,
  // a 50% spread pulls adjacent-row buttons into a honeycomb
  // arrangement — the bass row's button sits diagonally above the
  // chord-row button below it, so they read as a hex-packed Stradella
  // cluster instead of two distant rows separated by a wide gap.
  const ROW_VERTICAL_SPREAD_PCT = 50;
  const rowTopPct = (rowIdx) => {
    if (numRows <= 1) return 50;
    const center = 50;
    const half = ROW_VERTICAL_SPREAD_PCT / 2;
    return center - half + (rowIdx / (numRows - 1)) * ROW_VERTICAL_SPREAD_PCT;
  };

  for (const lane of lanes) {
    const leftPct = (lane.colIndex + 0.5 + laneDiagonalShift(lane)) * unitPct;
    const topPct = rowTopPct(lane.rowIndex);

    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'ah-col-btn';
    btn.dataset.col = String(lane.colIndex);
    btn.dataset.row = lane.row;
    btn.dataset.lanes = String(lane.index);
    btn.style.left = `${leftPct}%`;
    btn.style.top = `${topPct}%`;
    btn.setAttribute('aria-label', `${lane.row} ${PC_NAMES[lane.pc]}`);

    if (lane.row === 'bass' && HOME_PITCH_CLASSES.has(lane.pc)) {
      btn.classList.add('is-home');
    }

    const nameEl = document.createElement('span');
    nameEl.className = 'ah-col-name';
    nameEl.textContent =
      lane.row === 'bass' || lane.row === 'counter-bass' ? PC_NAMES[lane.pc] : rowGlyph(lane.row);
    btn.appendChild(nameEl);

    const keyEl = document.createElement('span');
    keyEl.className = 'ah-col-keys';
    const label = keyLabelForLaneIndex(laneToKey, lane.index);
    if (label) keyEl.textContent = label;
    btn.appendChild(keyEl);

    laneBarEl.appendChild(btn);
  }
}

function laneColor(row) {
  if (row === 'bass') return '#e2e8f0';
  if (row === 'major') return '#4ade80';
  if (row === 'minor') return '#2dd4bf';
  if (row === 'dom7') return '#fbbf24';
  if (row === 'dim7') return '#f87171';
  if (row === 'counter-bass') return '#22d3ee';
  return '#c084fc';
}

function rowGlyph(row) {
  switch (row) {
    case 'bass':
      return 'B';
    case 'counter-bass':
      return '↑';
    case 'major':
      return 'M';
    case 'minor':
      return 'm';
    case 'dom7':
      return '7';
    case 'dim7':
      return '°';
    default:
      return '';
  }
}

function drawFrame() {
  const { w, h, dpr } = fitCanvas();
  const ctx = canvasEl.getContext('2d');
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.clearRect(0, 0, w, h);

  if (!engine) return;

  const { columns, rows } = engine.getGrid();
  const colCount = columns.length;
  const rowCount = rows.length;
  if (colCount === 0) return;

  // Lanes are diagonally staggered (see ROW_DIAGONAL_OFFSET) so the
  // canvas reserves a slightly wider column footprint to keep the
  // bottom-row lanes inside the playfield. The lane bar below uses the
  // same effective count so falling notes always line up with their
  // target buttons.
  const effectiveCols = colCount + Math.max(0, rowCount - 1) * ROW_DIAGONAL_OFFSET;
  const colW = w / effectiveCols;
  const laneX = (lane) => (lane.colIndex + 0.5 + laneDiagonalShift(lane)) * colW;

  const laneBarRect = laneBarEl.getBoundingClientRect();
  const canvasRect = canvasEl.getBoundingClientRect();
  const strikeY = Math.max(40, laneBarRect.top - canvasRect.top - 4);

  // Look-ahead is measured in beats so on-screen note density stays the
  // same regardless of the user's tempo. 4 beats ≈ 1⅓ bars of waltz
  // preview — enough warning to read the next chord change without
  // crowding consecutive beats on top of each other (each beat occupies
  // strikeY / 4 of vertical space, vs strikeY / 5 with a 5-beat window).
  const lookAhead = 4 * engine.getSecondsPerBeat();
  const pxPerSec = (strikeY - 24) / lookAhead;

  // Column slabs + separators are drawn at the BASE column center (no
  // row offset) so the playfield reads as clean vertical key-columns
  // regardless of stagger. Only the lanes and falling notes pick up
  // the diagonal shift, which is enough to communicate "this row
  // staircases right" without making the background look skewed.
  for (const col of columns) {
    const x = (col.colIndex + 0.5) * colW;
    ctx.fillStyle = col.colIndex % 2 ? 'rgba(0,0,0,0.07)' : 'rgba(255,255,255,0.025)';
    ctx.fillRect(x - colW * 0.5, 0, colW, strikeY);
  }

  ctx.strokeStyle = 'rgba(148,163,184,0.13)';
  ctx.lineWidth = 1;
  for (const col of columns) {
    const x = (col.colIndex + 1) * colW;
    ctx.beginPath();
    ctx.moveTo(x, 0);
    ctx.lineTo(x, strikeY);
    ctx.stroke();
  }

  // Bass-row pitch labels at the very top of the playfield. The bass
  // row is rowIndex 0 → diagonal shift is 0, so the label sits exactly
  // over the column it names.
  ctx.fillStyle = 'rgba(148,163,184,0.4)';
  ctx.font = '700 11px ui-sans-serif,system-ui,sans-serif';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'top';
  for (const lane of engine.getLanes()) {
    if (lane.row === 'bass') ctx.fillText(PC_NAMES[lane.pc], laneX(lane), 6);
  }

  ctx.strokeStyle = 'rgba(244,114,182,0.9)';
  ctx.lineWidth = 3;
  ctx.beginPath();
  ctx.moveTo(0, strikeY);
  ctx.lineTo(w, strikeY);
  ctx.stroke();
  ctx.strokeStyle = 'rgba(244,114,182,0.22)';
  ctx.lineWidth = 12;
  ctx.beginPath();
  ctx.moveTo(0, strikeY);
  ctx.lineTo(w, strikeY);
  ctx.stroke();
  ctx.lineWidth = 1;

  const engineNow = engine.elapsedSec();
  // Match the falling-note bar width to the round receptor button so
  // the player sees exactly which button each note maps to. The CSS
  // sizes `.ah-col-btn` via `clamp(34px, 6.5vw, 52px)` and the value
  // depends on viewport width, so we read it from the live DOM each
  // frame (cheap — one rect per frame). Capped to the column width so
  // a very wide button on a tiny column doesn't overflow into the
  // neighbor.
  const sampleBtn = laneBarEl.querySelector('.ah-col-btn');
  const buttonSize = sampleBtn ? sampleBtn.getBoundingClientRect().width : 44;
  const noteW = Math.min(colW * 0.96, Math.max(20, buttonSize));
  const noteH = 22;

  const beatNotes = new Map();
  for (const note of engine.getActiveNotes(engineNow, lookAhead + 0.5)) {
    let arr = beatNotes.get(note.chordBeatId);
    if (!arr) {
      arr = [];
      beatNotes.set(note.chordBeatId, arr);
    }
    arr.push(note);
  }

  for (const [, notes] of beatNotes) {
    if (!notes.length) continue;
    const dt = notes[0].hitSec - engineNow;
    const baseY = strikeY - dt * pxPerSec;
    if (baseY < -60 || baseY > strikeY + 80) continue;

    const noteXs = notes.map((n) => laneX(engine.getLaneByIndex(n.laneIndex)));
    if (noteXs.length > 1) {
      ctx.strokeStyle = 'rgba(244,114,182,0.4)';
      ctx.lineWidth = 2;
      ctx.setLineDash([4, 4]);
      ctx.beginPath();
      ctx.moveTo(Math.min(...noteXs), baseY);
      ctx.lineTo(Math.max(...noteXs), baseY);
      ctx.stroke();
      ctx.setLineDash([]);
    }

    for (const note of notes) {
      const lane = engine.getLaneByIndex(note.laneIndex);
      const x = laneX(lane) - noteW / 2;
      const color = laneColor(lane.row);
      const tailH = Math.max(0, (note.holdSec || 0) * pxPerSec);
      const headTop = baseY - noteH / 2;

      if (note.state === 'judged') {
        const tier = note.judgment?.tier ?? 'miss';
        const jc =
          tier === 'perfect' || tier === 'great'
            ? '#34d399'
            : tier === 'good'
            ? '#facc15'
            : '#f87171';
        const age = engineNow - note.hitSec;
        ctx.globalAlpha = Math.max(0, 1 - age * 5);
        if (tailH > 0) {
          ctx.globalAlpha *= 0.55;
          ctx.fillStyle = jc;
          ctx.fillRect(x, headTop - tailH, noteW, tailH);
          ctx.globalAlpha = Math.max(0, 1 - age * 5);
        }
        roundedRect(ctx, x, headTop, noteW, noteH, 6, jc);
        ctx.globalAlpha = 1;
        continue;
      }

      // Sustain tail above the head, rendered semi-transparent so the
      // head still reads as the strike point. Bass beats have ~zero
      // tail (staccato), chord beats have a tall tail that visually
      // says "hold me through the pah".
      if (tailH > 0) {
        ctx.save();
        ctx.globalAlpha = 0.55;
        ctx.fillStyle = color;
        ctx.fillRect(x, headTop - tailH, noteW, tailH);
        // Thin inner highlight along the tail's leading edge so it
        // doesn't read as a flat block.
        ctx.globalAlpha = 0.8;
        ctx.fillStyle = 'rgba(255,255,255,0.18)';
        ctx.fillRect(x + 2, headTop - tailH, 2, tailH);
        ctx.restore();
      }

      roundedRect(ctx, x, headTop, noteW, noteH, 8, color);

      ctx.fillStyle = lane.row === 'bass' ? 'rgba(15,23,42,0.9)' : 'rgba(0,0,0,0.8)';
      ctx.font = `700 ${Math.round(noteH * 0.58)}px ui-sans-serif,system-ui,sans-serif`;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(rowGlyph(lane.row), laneX(lane), baseY);
    }

    // Chord label drawn last so it sits above tails. Position is above
    // the tallest tail in the beat so the text never collides with the
    // sustain block painted above the head.
    const labelable = notes.find((n) => n.state !== 'judged');
    if (labelable?.label && dt > 0 && dt < lookAhead * 0.5) {
      const avgX = noteXs.reduce((s, x) => s + x, 0) / noteXs.length;
      let maxTail = 0;
      for (const n of notes) {
        const th = (n.holdSec || 0) * pxPerSec;
        if (th > maxTail) maxTail = th;
      }
      const labelY = baseY - noteH / 2 - maxTail - 6;
      ctx.fillStyle = 'rgba(226,232,240,0.88)';
      ctx.font = '600 12px ui-sans-serif,system-ui,sans-serif';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'alphabetic';
      ctx.fillText(labelable.label, avgX, labelY);
    }
  }

  const nowMs = performance.now();
  drawComboLayer(ctx, w, strikeY, nowMs);
  drawJudgmentLayer(ctx, w, strikeY, nowMs);

  ctx.textBaseline = 'alphabetic';
}

function roundedRect(ctx, x, y, w, h, r, fill) {
  ctx.fillStyle = fill;
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.lineTo(x + w - r, y);
  ctx.quadraticCurveTo(x + w, y, x + w, y + r);
  ctx.lineTo(x + w, y + h - r);
  ctx.quadraticCurveTo(x + w, y + h, x + w - r, y + h);
  ctx.lineTo(x + r, y + h);
  ctx.quadraticCurveTo(x, y + h, x, y + h - r);
  ctx.lineTo(x, y + r);
  ctx.quadraticCurveTo(x, y, x + r, y);
  ctx.closePath();
  ctx.fill();
}

// ----- Run loop -----

function applyHud() {
  scoreEl.textContent = String(engine.getScore());
  comboEl.textContent = String(engine.getCombo());
}

function flashJudgment(j) {
  triggerJudgmentOverlay(j);

  const tier =
    j.tier === 'perfect' || j.tier === 'great'
      ? 'full'
      : j.tier === 'good'
      ? 'sub'
      : j.tier === 'miss'
      ? 'miss'
      : 'partial';
  const txt = j.tier === 'miss' ? 'MISS' : j.tier.toUpperCase();
  judgmentEl.textContent = txt;
  judgmentEl.dataset.tier = tier;
  judgmentEl.classList.remove('is-flash');
  void judgmentEl.offsetWidth;
  judgmentEl.classList.add('is-flash');

  let voicingTxt = '';
  if (j.tier !== 'miss') {
    if (j.voicing === 'full') voicingTxt = `${j.targetLabel} ✓ (${j.points})`;
    else if (j.voicing === 'sub')
      voicingTxt = `${j.playedName || '?'} → ${j.targetLabel} (${j.points})`;
    else if (j.voicing === 'partial')
      voicingTxt = `${j.playedName || '?'} ≈ ${j.targetLabel} (${j.points})`;
  } else {
    voicingTxt = j.voicing === 'wrong' && j.playedName ? `${j.playedName} ✗` : '';
  }
  voicingEl.textContent = voicingTxt;
}

function loop() {
  if (!engine) return;
  // Pass wall-clock time so it matches the timestamps `input.js` uses
  // when forwarding key/touch presses into `engine.pressLane`. The engine
  // subtracts its `startedAt` anchor internally — see `engine.start()`
  // below where we anchor it to `performance.now() / 1000`.
  engine.tick(performance.now() / 1000, {
    onJudgment: (j) => {
      applyHud();
      flashJudgment(j);
    },
    onLaneAudioOn: laneAudioOn,
    onLaneAudioOff: laneAudioOff
  });
  applyHud();
  tickCountIn();
  drawFrame();

  if (engine.isDone()) {
    finishSong();
    return;
  }
  rafHandle = requestAnimationFrame(loop);
}

// ----- Start / stop -----

function startSong() {
  if (!currentChart) return;
  getCtx();
  resumeIfSuspended();

  songTitleEl.textContent = currentChart.meta.title;

  engine = createLaneEngine(currentChart);
  engine.setSpeed(Number(speedEl.value) / 100);

  const laneToKey = buildKeyMap(engine.getLanes());
  buildLaneBar(engine, laneToKey);

  judgmentEl.textContent = 'READY…';
  judgmentEl.dataset.tier = 'full';
  voicingEl.textContent = '';

  comboPrev = 0;
  comboPopAt = 0;
  countInLastTickIdx = -1;
  countInDone = false;
  judgmentOverlay.text = '';
  judgmentOverlay.sub = '';
  judgmentOverlay.tier = 'idle';
  judgmentOverlay.shownAt = 0;

  inputDispose = attachInput({
    laneBarEl,
    laneToKey,
    engine,
    callbacks: { onLaneAudioOn: laneAudioOn, onLaneAudioOff: laneAudioOff }
  });

  // Anchor the engine to wall-clock time. `input.js` calls
  // `pressLane(idx, performance.now() / 1000, …)`, so the engine must
  // know to subtract that same wall-clock baseline when matching presses
  // against beat hit times. Anchoring to `0` (or any pre-subtracted
  // elapsed value) makes every press fall outside the timing window
  // and judges everything as MISS.
  engine.start(performance.now() / 1000);

  showGame();

  cancelAnimationFrame(rafHandle);
  rafHandle = requestAnimationFrame(loop);
}

function stopRun() {
  cancelAnimationFrame(rafHandle);
  rafHandle = 0;
  if (inputDispose) {
    inputDispose();
    inputDispose = null;
  }
  if (engine) engine.releaseAll({ onLaneAudioOff: laneAudioOff });
  synth.allOff();
}

function finishSong() {
  if (!engine) return;
  const counts = engine.getCounts();
  resScoreEl.textContent = String(engine.getScore());
  resComboEl.textContent = String(engine.getMaxCombo());
  resPerfectEl.textContent = String(counts.voicing.full || 0);
  resSubEl.textContent = String(counts.voicing.sub || 0);
  resPartialEl.textContent = String(counts.voicing.partial || 0);
  resMissEl.textContent = String(counts.voicing.wrong || 0);
  stopRun();
  showResults();
}

// ----- Buttons -----

startBtnEl.addEventListener('click', () => {
  try {
    startSong();
  } catch (err) {
    console.error(err);
    judgmentEl.textContent = 'LOAD ERROR';
    judgmentEl.dataset.tier = 'miss';
    voicingEl.textContent = String(err?.message || err);
  }
});

pauseBtnEl.addEventListener('click', () => {
  stopRun();
  showStart();
});
resultsAgainBtnEl.addEventListener('click', () => {
  showStart();
});

const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
if (reduceMotion) judgmentEl.classList.add('reduce-motion');

showStart();

const isTouch =
  (window.matchMedia && window.matchMedia('(any-pointer: coarse)').matches) ||
  (typeof navigator !== 'undefined' && navigator.maxTouchPoints > 0);
const helpEl = document.getElementById('ah-help');
if (helpEl && isTouch) helpEl.removeAttribute('open');
