// Select › Color Range… (PhotoCraft algo selection.rs color_range_samples / tone_range and
// engine selection_cmds.rs color_range). Pure: every function takes an ImageData-like
// { width, height, data } and returns a soft Uint8Array coverage mask, 0..255, index y * W + x.
// Paint's selections are 0/1, so softToSelection snaps the coverage at half like featherMask.

export const COLOR_RANGE_SELECT = [
  { value: 'sampledColors', label: 'Sampled Colors' },
  { value: 'highlights', label: 'Highlights' },
  { value: 'midtones', label: 'Midtones' },
  { value: 'shadows', label: 'Shadows' }
];

// The dialog's opening values (color_range_ui.rs open).
export const COLOR_RANGE_DEFAULTS = Object.freeze({
  select: 'sampledColors',
  fuzziness: 40,
  toneFuzziness: 20,
  shadowsLevel: 65,
  highlightsLevel: 190,
  midtonesLow: 105,
  midtonesHigh: 150,
  invert: false
});

/**
 * Sampled Colors: each sample is { color: [r, g, b] (0..255), subtract?: boolean }, applied in
 * click order. A pixel's match to one sample falls off linearly with its largest per-channel
 * distance, reaching 0 at fuzziness + 1 levels; an added sample keeps the best match so far and
 * a subtracted one caps the coverage at 1 − its match. Transparent pixels are never selected.
 * @param {{ width: number, height: number, data: ArrayLike<number> }} img
 * @param {{ color: number[], subtract?: boolean }[]} samples
 * @param {number} fuzziness 0..200
 */
export function colorRangeMask(img, samples, fuzziness) {
  const n = img.width * img.height;
  const out = new Uint8Array(n);
  const f = Math.min(200, Math.max(0, Number(fuzziness) || 0)) + 1;
  const d = img.data;
  for (let p = 0; p < n; p++) {
    const i = p * 4;
    if (d[i + 3] <= 0) continue;
    let m = 0;
    for (const s of samples) {
      const [r, g, b] = s.color;
      const dist = Math.max(Math.abs(d[i] - r), Math.abs(d[i + 1] - g), Math.abs(d[i + 2] - b));
      const k = Math.min(1, Math.max(0, 1 - dist / f));
      m = s.subtract ? Math.min(m, 1 - k) : Math.max(m, k);
    }
    out[p] = Math.round(m * 255);
  }
  return out;
}

/**
 * Highlights / Midtones / Shadows: pixels whose Rec. 601 luminance (0..255) is in lo..hi are
 * fully selected; outside, coverage falls off linearly to 0 over falloff levels.
 */
export function toneRangeMask(img, lo, hi, falloff) {
  const n = img.width * img.height;
  const out = new Uint8Array(n);
  const ramp = Math.max(1e-3, falloff);
  const d = img.data;
  for (let p = 0; p < n; p++) {
    const i = p * 4;
    if (d[i + 3] <= 0) continue;
    const l = Math.min(255, Math.max(0, 0.299 * d[i] + 0.587 * d[i + 1] + 0.114 * d[i + 2]));
    const off = l < lo ? lo - l : l > hi ? l - hi : 0;
    out[p] = Math.round(Math.min(1, Math.max(0, 1 - off / ramp)) * 255);
  }
  return out;
}

// The tonal range [lo, hi] for a Select choice (selection_cmds.rs color_range).
export function tonalRange(params) {
  const p = { ...COLOR_RANGE_DEFAULTS, ...params };
  if (p.select === 'shadows') return [0, p.shadowsLevel];
  if (p.select === 'highlights') return [p.highlightsLevel, 255];
  const a = p.midtonesLow;
  const b = p.midtonesHigh;
  return [Math.min(a, b), Math.max(a, b)];
}

/**
 * The whole command: params as COLOR_RANGE_DEFAULTS plus samples (Sampled Colors). Tone
 * Fuzziness is a percentage of the tonal scale. Invert flips the coverage.
 */
export function colorRangeCoverage(img, params, samples = []) {
  const p = { ...COLOR_RANGE_DEFAULTS, ...params };
  let mask;
  if (p.select === 'sampledColors') mask = colorRangeMask(img, samples, p.fuzziness);
  else {
    const [lo, hi] = tonalRange(p);
    const fuzz = Math.min(100, Math.max(0, Number(p.toneFuzziness) || 0));
    mask = toneRangeMask(img, lo, hi, (fuzz / 100) * 255);
  }
  if (p.invert) for (let k = 0; k < mask.length; k++) mask[k] = 255 - mask[k];
  return mask;
}

// A soft coverage mask as a Paint selection: selected where coverage is at least half.
export function softToSelection(soft) {
  const out = new Uint8Array(soft.length);
  for (let k = 0; k < soft.length; k++) out[k] = soft[k] >= 128 ? 1 : 0;
  return out;
}

// The eyedropper: the plain one replaces the samples, + (or Shift) adds, − (or Alt) subtracts.
export function pickSample(samples, color, tool) {
  const s = { color: [color[0], color[1], color[2]] };
  if (tool === 'add') return [...samples, s];
  if (tool === 'subtract') return [...samples, { ...s, subtract: true }];
  return [s];
}
