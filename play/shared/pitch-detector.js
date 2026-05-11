/**
 * Time-domain autocorrelation pitch detector for an `AnalyserNode` source.
 *
 * Used by /play/tuner/ but kept general so any future page that needs to
 * pull a fundamental out of a live audio stream (vocal-driven instruments,
 * a "sing the note" exercise, etc.) can drop this in.
 *
 * Algorithm: Chris Wilson's classic PitchDetect autocorrelation —
 * https://github.com/cwilso/PitchDetect — translated into modern ESM and
 * constrained to a musically useful lag range so the inner O(N²) loop is
 * tractable on phones.
 *
 *   1. Pull a time-domain buffer from the AnalyserNode (Float32, [-1..1]).
 *   2. Reject buffers under an RMS threshold as silence/noise.
 *   3. Compute the autocorrelation only across lags inside the
 *      [MIN_FREQ_HZ … MAX_FREQ_HZ] band.
 *   4. Skip past the first dip (handles the autocorrelation's initial
 *      monotonic descent), find the highest peak after it.
 *   5. Parabolic interpolation around that peak gives sub-sample lag
 *      resolution → cents accuracy.
 *   6. Score with normalised cross-correlation at the best lag — divides
 *      the raw correlation by the geometric mean of the two overlapping
 *      segments' energies. This makes the clarity metric unbiased across
 *      lag (i.e. across frequency); a naive `bestVal / totalEnergy`
 *      caps clarity at `(size - lag) / size`, which silently rejects
 *      low strings on a guitar (low E only reaches ~0.74 in a 2048
 *      buffer, well under any "is this a real note?" threshold).
 *
 * Clarity in the returned object is in [-1, 1]; 1.0 = perfect periodicity
 * regardless of fundamental frequency.
 */

const MIN_FREQ_HZ = 35; // ~C♯1, below 4-string bass low E (41 Hz) with headroom
const MAX_FREQ_HZ = 1300; // ~E6, well above the highest violin position
const RMS_SILENCE_THRESHOLD = 0.005; // below this, treat as silence
const CLARITY_THRESHOLD = 0.9; // NCC ≥ this counts as "real periodic note"
// 4096 samples ≈ 93 ms at 44.1 kHz — comfortably > 7 cycles of guitar
// low E (82 Hz). Bass low E (41 Hz, ~24 ms period) gets ~3.8 cycles, the
// minimum for a stable autocorrelation peak. 5-string bass low B
// (~31 Hz) is below MIN_FREQ_HZ and intentionally not supported — it'd
// need an 8192-sample buffer and noticeably more CPU.
const DEFAULT_BUFFER_SIZE = 4096;

const NOTE_NAMES = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];

/**
 * Tone-naming systems. The German tradition uses `B` for B♭ and `H` for
 * B-natural, which is a real footgun if you display only one tradition
 * to a global audience.
 */
export const NOTE_NAMINGS = {
  english: ['C', 'C♯', 'D', 'D♯', 'E', 'F', 'F♯', 'G', 'G♯', 'A', 'A♯', 'B'],
  solfege: ['Do', 'Do♯', 'Re', 'Re♯', 'Mi', 'Fa', 'Fa♯', 'Sol', 'Sol♯', 'La', 'La♯', 'Si'],
  german: ['C', 'Cis', 'D', 'Dis', 'E', 'F', 'Fis', 'G', 'Gis', 'A', 'B', 'H']
};

/**
 * Per-pitch-class cents offset from equal temperament, with C as tonic.
 * Sign convention: positive = the temperament's target frequency is
 * sharper than equal-temp; negative = flatter. We subtract this from
 * the equal-temp cents-off-pitch to get the cents-off-temperament value.
 *
 * - `equal`     12-TET, all zeros (the modern default).
 * - `just`      5-limit Ptolemaic just intonation in C major. Strings,
 *               choirs, and barbershop quartets gravitate here naturally.
 * - `pythagorean` Stack of pure 3:2 fifths from C. Pure-fifth tuning that
 *               medieval and early-renaissance music used, with notably
 *               sharp major thirds.
 *
 * Tonic is fixed at C for simplicity. A "key" selector would let the
 * tonic move (so just-intonation centred on D, A, etc.) but that's a
 * second dropdown most users wouldn't understand; punting until asked.
 */
export const TEMPERAMENTS = {
  equal: { label: 'Equal', offsets: [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0] },
  just: {
    label: 'Just (C)',
    offsets: [0, 11.73, 3.91, 15.64, -13.69, -1.96, -9.78, 1.96, 13.69, -15.64, 17.6, -11.73]
  },
  pythagorean: {
    label: 'Pythagorean (C)',
    offsets: [0, 11.73, 3.91, -5.87, 7.82, -1.96, 9.77, 1.96, 13.69, 5.87, -3.91, 11.73]
  }
};

/**
 * Wraps an AudioContext input source (typically a MediaStreamSource from
 * the mic) with an AnalyserNode and exposes a per-frame `read()` that
 * returns the detected fundamental, or `null` for silence/unclear frames.
 *
 * The caller owns the source node and is responsible for cleaning up the
 * underlying MediaStream. `dispose()` here just disconnects our analyser.
 */
export class PitchDetector {
  constructor({ ctx, source, bufferSize = DEFAULT_BUFFER_SIZE }) {
    this.ctx = ctx;
    this.source = source;
    this.analyser = ctx.createAnalyser();
    this.analyser.fftSize = bufferSize;
    this.analyser.smoothingTimeConstant = 0;
    this.buffer = new Float32Array(this.analyser.fftSize);
    source.connect(this.analyser);
  }

  /**
   * Pull a fresh frame and try to detect a pitch.
   *
   * Returns `{ frequency, clarity }` on a clean detection, or `null` if
   * the input is too quiet, too noisy, or out of musical range.
   */
  read() {
    this.analyser.getFloatTimeDomainData(this.buffer);
    return autocorrelate(this.buffer, this.ctx.sampleRate);
  }

  dispose() {
    try {
      this.source.disconnect(this.analyser);
    } catch (_) {
      /* already disconnected */
    }
  }
}

function autocorrelate(buf, sampleRate) {
  const size = buf.length;
  let rms = 0;
  for (let i = 0; i < size; i++) {
    const v = buf[i];
    rms += v * v;
  }
  rms = Math.sqrt(rms / size);
  if (rms < RMS_SILENCE_THRESHOLD) return null;

  // Lag bounds derived from the musical range — autocorrelating the full
  // buffer would be ~3× slower than we need without bounding the search.
  const minLag = Math.max(2, Math.floor(sampleRate / MAX_FREQ_HZ));
  const maxLag = Math.min(size - 1, Math.ceil(sampleRate / MIN_FREQ_HZ));
  if (maxLag <= minLag + 4) return null;

  const c = new Float32Array(maxLag + 1);
  for (let lag = minLag; lag <= maxLag; lag++) {
    let sum = 0;
    const limit = size - lag;
    for (let j = 0; j < limit; j++) sum += buf[j] * buf[j + lag];
    c[lag] = sum;
  }

  // Walk past the first dip (autocorrelation is monotonically decreasing
  // around lag 0; the first minimum marks where real periodic peaks begin).
  let d = minLag;
  while (d < maxLag && c[d] > c[d + 1]) d++;

  // Find the strongest correlation past that first dip.
  let bestLag = -1;
  let bestVal = -Infinity;
  for (let lag = d; lag <= maxLag; lag++) {
    if (c[lag] > bestVal) {
      bestVal = c[lag];
      bestLag = lag;
    }
  }
  if (bestLag <= 0 || bestVal <= 0) return null;

  // Parabolic interpolation for sub-sample lag resolution.
  let lag = bestLag;
  if (bestLag > minLag && bestLag < maxLag) {
    const x1 = c[bestLag - 1];
    const x2 = c[bestLag];
    const x3 = c[bestLag + 1];
    const denom = x1 + x3 - 2 * x2;
    if (denom !== 0) {
      const offset = (x3 - x1) / (2 * denom);
      // Guard against runaway parabolic offsets when the peak is flat.
      if (offset > -1 && offset < 1) lag = bestLag - offset;
    }
  }

  // Normalised cross-correlation as the clarity score: divide the raw
  // correlation at the best lag by sqrt(eA * eB), where eA and eB are
  // the energies of the two overlapping windows. Result is in [-1, 1]
  // and unbiased across lag — a perfectly periodic signal scores ≈ 1.0
  // whether the period is 50 samples or 800.
  let eA = 0;
  let eB = 0;
  const overlap = size - bestLag;
  for (let j = 0; j < overlap; j++) {
    eA += buf[j] * buf[j];
    eB += buf[j + bestLag] * buf[j + bestLag];
  }
  const energyDenom = Math.sqrt(eA * eB);
  const clarity = energyDenom > 0 ? bestVal / energyDenom : 0;

  if (clarity < CLARITY_THRESHOLD) return null;
  const frequency = sampleRate / lag;
  if (frequency < MIN_FREQ_HZ || frequency > MAX_FREQ_HZ) return null;

  return { frequency, clarity };
}

/**
 * Convert a frequency in Hz to a note name + cents-off-pitch.
 *
 * Options:
 *   - `a4`           the A4 reference frequency (default 440 Hz)
 *   - `temperament`  key from TEMPERAMENTS (default 'equal'); the
 *                    cents-off value is measured against the temperament-
 *                    adjusted target, not the equal-temp target
 *   - `targetMidi`   if provided, force the comparison to be against
 *                    this exact MIDI note (used by "locked target" mode
 *                    where the user is tuning to one specific string and
 *                    the cents reading should not snap to the nearest
 *                    chromatic note)
 *
 * Returns `{ midi, pc, octave, cents, targetFreq, equalCents }`:
 *   - `midi`         the chosen target MIDI number (either nearest or
 *                    `targetMidi`)
 *   - `pc`           pitch class 0..11 (handy for naming + temperament)
 *   - `octave`       octave number for that MIDI
 *   - `cents`        signed cents off the temperament target. In auto
 *                    mode (no `targetMidi`) this is roughly bounded
 *                    [−50, +50]; in locked mode it can swing widely.
 *   - `targetFreq`   the in-tune frequency for `midi` under the chosen
 *                    temperament (handy to display alongside)
 *   - `equalCents`   the equal-temperament cents-off value before the
 *                    temperament offset is applied (debug-friendly)
 */
export function freqToNoteInfo(freq, options = {}) {
  if (!Number.isFinite(freq) || freq <= 0) return null;
  const { a4 = 440, temperament = 'equal', targetMidi = null } = options;

  const midiFloat = 69 + 12 * Math.log2(freq / a4);
  const midi = targetMidi != null ? targetMidi : Math.round(midiFloat);
  const pc = ((midi % 12) + 12) % 12;
  const octave = Math.floor(midi / 12) - 1;

  const equalCents = (midiFloat - midi) * 100;
  const offset = TEMPERAMENTS[temperament]?.offsets?.[pc] ?? 0;
  const cents = Math.round(equalCents - offset);

  const targetFreq = a4 * Math.pow(2, (midi - 69) / 12) * Math.pow(2, offset / 1200);

  return { midi, pc, octave, cents, targetFreq, equalCents };
}

/**
 * Look up the display name of a MIDI note in the given naming system.
 * Returns `{ name, octave }` so the caller can decide how to render the
 * octave (subscript, separate span, suppressed in tight UIs, etc.).
 */
export function midiToDisplayName(midi, naming = 'english') {
  const pc = ((midi % 12) + 12) % 12;
  const octave = Math.floor(midi / 12) - 1;
  const names = NOTE_NAMINGS[naming] ?? NOTE_NAMINGS.english;
  return { name: names[pc], octave };
}

/**
 * Convert a (pitch-class index, octave) pair to a MIDI note number.
 * Pitch classes are always 0=C through 11=B regardless of naming
 * system — naming is purely a display concern.
 */
export function midiFromPcOctave(pc, octave) {
  return (octave + 1) * 12 + pc;
}

/**
 * Get the in-tune frequency for a given MIDI note under a chosen
 * temperament + A4 reference. Used by the reference-pitch buttons to
 * play a sustained tone the user can ear-tune against.
 */
export function midiToFreq(midi, { a4 = 440, temperament = 'equal' } = {}) {
  const pc = ((midi % 12) + 12) % 12;
  const offset = TEMPERAMENTS[temperament]?.offsets?.[pc] ?? 0;
  return a4 * Math.pow(2, (midi - 69) / 12) * Math.pow(2, offset / 1200);
}

export { NOTE_NAMES, MIN_FREQ_HZ, MAX_FREQ_HZ };
