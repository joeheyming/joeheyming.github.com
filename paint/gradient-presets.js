// Gradient presets (PhotoCraft crates/engine/src/presets/gradients.rs builtin()). A stop color
// is 'foreground', 'background', or '#rrggbb'. Transparency lives apart in opacity stops
// [location, alpha 0..1] (PhotoCraft GradientPreset opacity): the Gradient tool fades through
// them, while a Gradient Map has no transparency (PhotoCraft gradient_map shows every preset
// opaque), so there Foreground to Transparent is the foreground alone and Rainbow Fade the plain
// Rainbow ramp.

import { normalizeStops, sampleStops } from './gradient-stops.js';

const freezeStops = (stops) => Object.freeze(stops.map((s) => Object.freeze(s)));

const OPAQUE = [
  [0, 1],
  [1, 1]
];

// GradientPreset::new: colors evenly spaced at i / (n - 1), opaque unless opacity stops are given.
const preset = (name, colors, opacity = OPAQUE) => {
  const n = Math.max(colors.length, 2) - 1;
  return Object.freeze({
    name,
    stops: freezeStops(colors.map((c, i) => [i / n, c])),
    opacity: freezeStops(opacity)
  });
};

const family = (prefix, sets) =>
  sets.map((colors, i) => preset(`${prefix} ${String(i + 1).padStart(2, '0')}`, colors));

const group = (name, presets) => Object.freeze({ name, presets: Object.freeze(presets) });

const RAINBOW = [
  '#ec1313',
  '#ec6d13',
  '#ecc813',
  '#b6ec13',
  '#5bec13',
  '#13ec25',
  '#13ec80',
  '#13ecda',
  '#13a4ec',
  '#1349ec',
  '#3713ec',
  '#9213ec',
  '#ec13ec'
];

export const GRADIENT_PRESET_GROUPS = Object.freeze([
  group('Basics', [
    preset('Foreground to Background', ['foreground', 'background']),
    preset(
      'Foreground to Transparent',
      ['foreground', 'foreground'],
      [
        [0, 1],
        [1, 0]
      ]
    ),
    preset('Black, White', ['#000000', '#ffffff'])
  ]),
  group(
    'Blues',
    family('Blue', [
      ['#0b3d91', '#4fa3e0'],
      ['#1c2a5a', '#3f6fd8', '#a8d4ff'],
      ['#00b4d8', '#03045e'],
      ['#5ec8f2', '#e6f6ff'],
      ['#253b80', '#20b2aa'],
      ['#89c2ff', '#1d4ed8', '#0a1a40']
    ])
  ),
  group(
    'Purples',
    family('Purple', [
      ['#3c096c', '#c77dff'],
      ['#5a189a', '#e0aaff'],
      ['#240046', '#7b2cbf', '#f3d9ff'],
      ['#9d4edd', '#4361ee'],
      ['#6a0572', '#ab83a1'],
      ['#2d0b59', '#ff6fd8']
    ])
  ),
  group(
    'Pinks',
    family('Pink', [
      ['#ff4d8d', '#ffd1e1'],
      ['#c9184a', '#ff8fab'],
      ['#ff70a6', '#ffd670'],
      ['#8e2c5a', '#f7a1c4', '#fff0f5'],
      ['#ff5fa2', '#a855f7'],
      ['#ffc2d6', '#ff2e63']
    ])
  ),
  group(
    'Reds',
    family('Red', [
      ['#7f0000', '#ff3b30'],
      ['#d00000', '#ffba08'],
      ['#370617', '#9d0208', '#f48c06'],
      ['#e5383b', '#f5f3f4'],
      ['#a4161a', '#0b090a'],
      ['#ff595e', '#ffca3a']
    ])
  ),
  group(
    'Oranges',
    family('Orange', [
      ['#ff6d00', '#ffd60a'],
      ['#e85d04', '#ffba08'],
      ['#9c3d0b', '#ff9e40', '#fff1d6'],
      ['#ff7b00', '#ff0054'],
      ['#fb8500', '#023047'],
      ['#ffb703', '#fb5607']
    ])
  ),
  group(
    'Greens',
    family('Green', [
      ['#004b23', '#70e000'],
      ['#2d6a4f', '#b7e4c7'],
      ['#1b4332', '#40916c', '#d8f3dc'],
      ['#38b000', '#ccff33'],
      ['#0b6e4f', '#08a0a8'],
      ['#606c38', '#dda15e']
    ])
  ),
  group(
    'Browns',
    family('Brown', [
      ['#3e2412', '#a47148'],
      ['#6f4518', '#e6ccb2'],
      ['#2b1708', '#7f5539', '#ddb892'],
      ['#8b5e34', '#ffd8a8'],
      ['#582f0e', '#b6ad90'],
      ['#4a3728', '#c08552', '#f3e9dc']
    ])
  ),
  group(
    'Grays',
    family('Gray', [
      ['#212529', '#f8f9fa'],
      ['#495057', '#dee2e6'],
      ['#000000', '#6c757d', '#ffffff'],
      ['#343a40', '#adb5bd', '#343a40'],
      ['#8d99ae', '#2b2d42'],
      ['#e9ecef', '#ced4da', '#868e96']
    ])
  ),
  group('Rainbows', [
    preset('Rainbow', RAINBOW),
    preset('Pastel Rainbow', [
      '#f4afaf',
      '#f4cbaf',
      '#f4e8af',
      '#e2f4af',
      '#c6f4af',
      '#aff4b4',
      '#aff4d1',
      '#aff4ee',
      '#afddf4',
      '#afc0f4',
      '#baaff4',
      '#d7aff4',
      '#f4aff4'
    ]),
    preset('Neon Rainbow', [
      '#ff0000',
      '#ff6a00',
      '#ffd400',
      '#bfff00',
      '#55ff00',
      '#00ff15',
      '#00ff80',
      '#00ffea',
      '#00aaff',
      '#0040ff',
      '#2a00ff',
      '#9500ff',
      '#ff00ff'
    ]),
    preset('Oil Slick', [
      '#0b0f1a',
      '#1b2a4a',
      '#0f6f6f',
      '#1fae8a',
      '#5ac8a8',
      '#7a5cff',
      '#b13bd6',
      '#e04a8f',
      '#f2a65a',
      '#3a2a6b',
      '#0b0f1a'
    ]),
    preset('Rainbow Fade', RAINBOW, [
      [0, 0],
      [0.125, 1],
      [0.875, 1],
      [1, 0]
    ])
  ])
]);

/**
 * PhotoCraft GradientPreset::resolve without transparency: a fresh [location, '#rrggbb'] stop
 * array with 'foreground' / 'background' replaced by fg / bg, through normalizeStops.
 */
export function resolvePresetStops(preset, fg = '#000000', bg = '#ffffff') {
  const color = (c) => (c === 'foreground' ? fg : c === 'background' ? bg : c);
  return normalizeStops(preset.stops.map(([t, c]) => [t, color(c)]));
}

/**
 * A preset's opacity stops as a fresh sorted [location, alpha 0..1] array, both clamped to 0..1
 * ([[0, 1], [1, 1]] for an opaque preset).
 */
export function resolvePresetOpacity(preset) {
  const clamp = (v) => (v < 0 ? 0 : v > 1 ? 1 : v);
  const stops = preset.opacity?.length ? preset.opacity : OPAQUE;
  return stops.map(([t, a]) => [clamp(t), clamp(a)]).sort((a, b) => a[0] - b[0]);
}

/** The opacity at t between [location, alpha] stops; past the end stops the end alpha holds. */
export function sampleOpacity(stops, t) {
  if (t <= stops[0][0]) return stops[0][1];
  for (let s = 1; s < stops.length; s++) {
    const [p0, a0] = stops[s - 1];
    const [p1, a1] = stops[s];
    if (t <= p1) return p1 > p0 ? a0 + ((a1 - a0) * (t - p0)) / (p1 - p0) : a0;
  }
  return stops[stops.length - 1][1];
}

/**
 * PhotoCraft gradient_ui preset_swatch as CSS: a linear-gradient(to right, …) over the preset's
 * color and opacity stop locations together, each an rgba() color at its percentage, in order.
 */
export function presetSwatchCss(preset, fg = '#000000', bg = '#ffffff') {
  const stops = resolvePresetStops(preset, fg, bg);
  const opacity = resolvePresetOpacity(preset);
  const at = [...new Set([...stops, ...opacity].map((s) => s[0]))].sort((a, b) => a - b);
  const round = (v, k) => Math.round(v * k) / k;
  const parts = at.map((t) => {
    const [r, g, b] = sampleStops(stops, t).map((v) => Math.round(v * 255));
    const a = round(sampleOpacity(opacity, t), 1000);
    return `rgba(${r}, ${g}, ${b}, ${a}) ${round(t * 100, 1000)}%`;
  });
  return `linear-gradient(to right, ${parts.join(', ')})`;
}

// PhotoCraft widgets::checker: 4px cells of gray 250 and 214, light at the top-left.
export const SWATCH_CHECKER = 'repeating-conic-gradient(#d6d6d6 0% 25%, #fafafa 0% 50%)';

/**
 * A preset swatch's CSS background-image: presetSwatchCss alone for an opaque preset, or layered
 * over SWATCH_CHECKER when any opacity stop is below 1 (style.css sizes the checker layer).
 */
export function swatchBackground(preset, fg = '#000000', bg = '#ffffff') {
  const css = presetSwatchCss(preset, fg, bg);
  return resolvePresetOpacity(preset).some(([, a]) => a < 1) ? `${css}, ${SWATCH_CHECKER}` : css;
}
