/**
 * Staff geometry for grand-staff composer.
 */
import { measureSixteenths, totalSixteenths } from './notation.js';
import { BASS_NATURAL, TREBLE_NATURAL } from './model.js';

export const LAYOUT = {
  leftPad: 118,
  rightPad: 28,
  topPad: 46,
  bottomPad: 36,
  lineGap: 12,
  staffGap: 56, // space between treble bottom and bass top
  unitW: 14, // pixels per 16th-note unit
  playheadHit: 12
};

/** Treble: bottom line E4 = midi 64; top F5 = 77 */
const TREBLE_BOTTOM_MIDI = 64;
const TREBLE_TOP_MIDI = 77;
/** Bass: bottom line G2 = 43; top A3 = 57 */
const BASS_BOTTOM_MIDI = 43;
const BASS_TOP_MIDI = 57;

export function trebleStaffTop() {
  return LAYOUT.topPad;
}

export function bassStaffTop() {
  return trebleStaffTop() + 4 * LAYOUT.lineGap + LAYOUT.staffGap;
}

export function scoreHeight() {
  return bassStaffTop() + 4 * LAYOUT.lineGap + LAYOUT.bottomPad;
}

export function contentStartX(keySigCount = 0) {
  // clef + time sig + key sig accidentals
  return LAYOUT.leftPad + keySigCount * 10;
}

export function scoreWidth(measures, timeSig, keySigCount = 0) {
  const total = totalSixteenths(measures, timeSig);
  return contentStartX(keySigCount) + total * LAYOUT.unitW + LAYOUT.rightPad;
}

export function startToX(start, keySigCount = 0) {
  return contentStartX(keySigCount) + start * LAYOUT.unitW;
}

export function noteX(start, duration, keySigCount = 0) {
  // Center within the duration span for short notes; left-align long ones slightly
  const w = Math.max(duration, 1) * LAYOUT.unitW;
  return startToX(start, keySigCount) + Math.min(w * 0.35, LAYOUT.unitW * 2);
}

export function xToStart(x, keySigCount, measures, timeSig) {
  const raw = (x - contentStartX(keySigCount)) / LAYOUT.unitW;
  const max = totalSixteenths(measures, timeSig);
  return Math.max(0, Math.min(max - 1, Math.floor(raw)));
}

export function xToPlayheadStart(x, keySigCount, measures, timeSig) {
  const raw = (x - contentStartX(keySigCount)) / LAYOUT.unitW;
  const max = totalSixteenths(measures, timeSig);
  return Math.max(0, Math.min(max, raw));
}

export function playheadX(start, keySigCount = 0) {
  return startToX(start, keySigCount);
}

/**
 * Y position for a natural-step index on a staff.
 * Staff lines are every 2 diatonic steps.
 */
function midiToStaffY(midi, staffTop, topLineMidi, bottomLineMidi) {
  // Each diatonic step = lineGap/2. Map via letter steps from bottom line.
  const bottomStep = diatonicStepsFromC0(bottomLineMidi);
  const topStep = diatonicStepsFromC0(topLineMidi);
  const noteStep = diatonicStepsFromC0(midi);
  const stepsFromTop = topStep - noteStep;
  return staffTop + stepsFromTop * (LAYOUT.lineGap / 2);
}

function diatonicStepsFromC0(midi) {
  // Count white keys from MIDI 0's C
  const octave = Math.floor(midi / 12);
  const pc = midi % 12;
  const white = [0, 2, 4, 5, 7, 9, 11];
  let idx = white.indexOf(pc);
  if (idx < 0) {
    // nearest lower white
    idx = white.findIndex((w, i) => w > pc) - 1;
    if (idx < 0) idx = 0;
  }
  return octave * 7 + idx;
}

export function stepToY(staff, step) {
  const naturals = staff === 'bass' ? BASS_NATURAL : TREBLE_NATURAL;
  const midi = naturals[Math.max(0, Math.min(naturals.length - 1, step))];
  if (staff === 'bass') {
    return midiToStaffY(midi, bassStaffTop(), BASS_TOP_MIDI, BASS_BOTTOM_MIDI);
  }
  return midiToStaffY(midi, trebleStaffTop(), TREBLE_TOP_MIDI, TREBLE_BOTTOM_MIDI);
}

export function yToStaffAndStep(y) {
  const trebleMid = trebleStaffTop() + 2 * LAYOUT.lineGap;
  const bassMid = bassStaffTop() + 2 * LAYOUT.lineGap;
  const staff = Math.abs(y - trebleMid) <= Math.abs(y - bassMid) ? 'treble' : 'bass';
  const naturals = staff === 'bass' ? BASS_NATURAL : TREBLE_NATURAL;
  const topMidi = staff === 'bass' ? BASS_TOP_MIDI : TREBLE_TOP_MIDI;
  const bottomMidi = staff === 'bass' ? BASS_BOTTOM_MIDI : TREBLE_BOTTOM_MIDI;
  const staffTop = staff === 'bass' ? bassStaffTop() : trebleStaffTop();

  // Invert stepToY: find nearest natural
  let best = 0;
  let bestDist = Infinity;
  for (let i = 0; i < naturals.length; i++) {
    const yy = midiToStaffY(naturals[i], staffTop, topMidi, bottomMidi);
    const d = Math.abs(yy - y);
    if (d < bestDist) {
      bestDist = d;
      best = i;
    }
  }
  return { staff, step: best };
}

/** True when Y is within the placeable pitch band (highest treble … lowest bass). */
export function isPitchEntryY(y) {
  const margin = LAYOUT.lineGap * 0.75;
  const top = stepToY('treble', TREBLE_NATURAL.length - 1) - margin;
  const bottom = stepToY('bass', 0) + margin;
  return y >= top && y <= bottom;
}

export function staffLineMidis(staff) {
  if (staff === 'bass') {
    // G2 B2 D3 F3 A3
    return [43, 47, 50, 53, 57];
  }
  // E4 G4 B4 D5 F5
  return [64, 67, 71, 74, 77];
}

export function ledgerMidis(staff, midi) {
  const lines = staffLineMidis(staff);
  const bottom = lines[0];
  const top = lines[4];
  const ledgers = [];
  // Walk white notes for ledger lines
  const naturals = staff === 'bass' ? BASS_NATURAL : TREBLE_NATURAL;
  if (midi < bottom) {
    for (const m of naturals) {
      if (m < bottom && m >= midi && isLineMidi(staff, m)) ledgers.push(m);
    }
  } else if (midi > top) {
    for (const m of naturals) {
      if (m > top && m <= midi && isLineMidi(staff, m)) ledgers.push(m);
    }
  }
  return ledgers;
}

function isLineMidi(staff, midi) {
  // A pitch is on a line if its diatonic distance from bottom line is even
  const bottom = staffLineMidis(staff)[0];
  const diff = diatonicStepsFromC0(midi) - diatonicStepsFromC0(bottom);
  return diff % 2 === 0;
}

export function keySigCount(keySig) {
  return Math.abs(keySig || 0);
}

/**
 * Key-signature accidental Y positions for treble/bass.
 * Uses conventional vertical placement for sharps/flats.
 */
export function keySigPositions(staff, accidental) {
  // letter index → preferred octave midi on that staff for key sig glyphs
  // Sharp order F C G D A E B — Flat order B E A D G C F
  if (staff === 'treble') {
    if (accidental === 'sharp') {
      return { 3: 77, 0: 72, 4: 79, 1: 74, 5: 69, 2: 76, 6: 71 }; // F5 C5 G5 D5 A4 E5 B4
    }
    return { 6: 71, 2: 76, 5: 69, 1: 74, 4: 67, 0: 72, 3: 65 }; // B4 E5 A4 D5 G4 C5 F4
  }
  // bass
  if (accidental === 'sharp') {
    return { 3: 53, 0: 48, 4: 55, 1: 50, 5: 45, 2: 52, 6: 47 }; // F3 C3 G3 D3 A2 E3 B2
  }
  return { 6: 47, 2: 52, 5: 45, 1: 50, 4: 43, 0: 48, 3: 41 }; // B2 E3 A2 D3 G2 C3 F2
}

export { measureSixteenths, totalSixteenths, TREBLE_NATURAL, BASS_NATURAL };
