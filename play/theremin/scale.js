/**
 * Pitch math + scale data for the theremin pad.
 *
 * Pure / DOM-free: every function takes a `cfg` snapshot
 * ({ scale, root, range }) so callers can read live values from
 * <select>s on every update without coupling these helpers to the
 * DOM. Re-evaluated on every move so scale changes apply immediately.
 */

export const SCALES = {
  continuous: null, // sentinel — no snapping
  major: [0, 2, 4, 5, 7, 9, 11],
  minor: [0, 2, 3, 5, 7, 8, 10],
  'pentatonic-major': [0, 2, 4, 7, 9],
  'pentatonic-minor': [0, 3, 5, 7, 10],
  blues: [0, 3, 5, 6, 7, 10],
  chromatic: [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11]
};

// The pad spans `range` octaves starting at `START_OCTAVE` shifted by
// the chosen `root`. e.g. root=C, START_OCTAVE=3, range=4 → C3..C7.
export const START_OCTAVE = 3;

/** Pad → midi range bounds for a given root + range (in octaves). */
export const getMidiRange = ({ root, range }) => {
  const startMidi = (START_OCTAVE + 1) * 12 + root;
  return { startMidi, endMidi: startMidi + range * 12 };
};

/**
 * Snap a real-valued midi to the nearest in-scale step. For
 * `continuous`, returns the input unchanged (true theremin glide).
 * Searches ±1 octave of `midi` — always more than enough to find the
 * closest match.
 */
export const snapToScale = (midi, { scale, root }) => {
  const intervals = SCALES[scale];
  if (!intervals) return midi;
  let best = midi;
  let bestDist = Infinity;
  const baseMidi = Math.round(midi);
  for (let m = baseMidi - 12; m <= baseMidi + 12; m++) {
    const pc = (((m - root) % 12) + 12) % 12;
    if (!intervals.includes(pc)) continue;
    const d = Math.abs(midi - m);
    if (d < bestDist) {
      bestDist = d;
      best = m;
    }
  }
  return best;
};

/**
 * Map normalized X (0=left, 1=right) to a midi number across the
 * configured range. With snapping, the result is rounded to the
 * nearest in-scale step; with `continuous`, returns a fractional midi
 * for true glide. xNorm is clamped to [0..1] for safety.
 */
export const xToMidi = (xNorm, cfg) => {
  const x = Math.max(0, Math.min(1, xNorm));
  const { startMidi, endMidi } = getMidiRange(cfg);
  const span = endMidi - startMidi;
  const raw = startMidi + x * span;
  return snapToScale(raw, cfg);
};
