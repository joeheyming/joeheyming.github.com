// Paint — Window › Styles: layer style presets (PhotoCraft crates/engine/src/presets/styles.rs
// builtin()). A preset is a list of [kind, params] effects in layer.layerStyle.<kind> form plus an
// optional Fill; applying one replaces the layer's effects (Photoshop; Shift-click adds instead).

import { EFFECT_KINDS, normalizeStyles, setLayerStyles } from './layer-style.js';

const preset = (name, effects, fillOpacity = null) =>
  Object.freeze({ name, effects: Object.freeze(effects), fillOpacity });

export const STYLE_PRESET_GROUPS = Object.freeze([
  Object.freeze({
    name: 'Basics',
    presets: Object.freeze([
      preset('Default Style (None)', []),
      preset('Drop Shadow', [['dropShadow', { distance: 6, size: 8, opacity: 60 }]]),
      preset('Soft Shadow', [['dropShadow', { distance: 2, size: 16, opacity: 45 }]]),
      preset('Black Stroke', [['stroke', { size: 3, color: '#000000', position: 'outside' }]]),
      preset('White Stroke', [['stroke', { size: 3, color: '#ffffff', position: 'outside' }]]),
      preset('Inner Shadow', [['innerShadow', { distance: 4, size: 6, opacity: 55 }]]),
      preset('Outer Glow', [['outerGlow', { size: 14, color: '#ffe9a8', opacity: 80 }]]),
      preset('Emboss', [['bevelEmboss', { style: 'emboss', size: 4, depth: 120 }]])
    ])
  }),
  Object.freeze({
    name: 'Text Effects',
    presets: Object.freeze([
      preset('Neon Blue', [
        ['colorOverlay', { color: '#d8f4ff' }],
        ['innerGlow', { color: '#3fb6ff', size: 6, opacity: 90, blend: 'normal' }],
        ['outerGlow', { color: '#1e90ff', size: 22, opacity: 90 }]
      ]),
      preset('Neon Pink', [
        ['colorOverlay', { color: '#ffe1f3' }],
        ['innerGlow', { color: '#ff4fb4', size: 6, opacity: 90, blend: 'normal' }],
        ['outerGlow', { color: '#ff2d95', size: 22, opacity: 90 }]
      ]),
      preset('Chrome', [
        ['gradientOverlay', { from: '#3a3f47', to: '#f4f6f8', angle: 90 }],
        ['bevelEmboss', { style: 'inner', size: 6, depth: 250, soften: 1 }],
        ['stroke', { size: 1, color: '#2a2d33', position: 'outside' }]
      ]),
      preset('Gold', [
        ['gradientOverlay', { from: '#8a5a12', to: '#ffe08a', angle: 90 }],
        ['bevelEmboss', { style: 'inner', size: 5, depth: 180 }],
        ['dropShadow', { distance: 3, size: 5, opacity: 50 }]
      ]),
      preset('Comic Outline', [
        ['colorOverlay', { color: '#ffd23f' }],
        ['stroke', { size: 4, color: '#111111', position: 'outside' }],
        ['dropShadow', { distance: 6, size: 0, opacity: 100, angle: 135 }]
      ]),
      preset('Letterpress', [
        ['colorOverlay', { color: '#5b6168' }],
        ['innerShadow', { distance: 2, size: 2, opacity: 70 }],
        [
          'dropShadow',
          { distance: 1, size: 0, color: '#ffffff', opacity: 60, blend: 'screen', angle: 90 }
        ]
      ]),
      preset('Hollow', [['stroke', { size: 2, color: '#222222', position: 'inside' }]], 0)
    ])
  })
]);

/** The preset named `group/name`, or null. */
export function findStylePreset(value) {
  for (const g of STYLE_PRESET_GROUPS) {
    for (const p of g.presets) if (`${g.name}/${p.name}` === value) return p;
  }
  return null;
}

// effect_from_params: PhotoCraft's `blend` is our blendMode (normal is source-over), and a
// gradient overlay's from / to are its two stops.
function effectParams(kind, params) {
  const out = {};
  for (const [k, v] of Object.entries(params)) {
    if (k === 'blend') out.blendMode = v === 'normal' ? 'source-over' : v;
    else if (k !== 'from' && k !== 'to') out[k] = v;
  }
  if (kind === 'gradientOverlay' && params.from && params.to) {
    out.preset = 'Custom';
    out.stops = [
      [0, params.from],
      [1, params.to]
    ];
  }
  return out;
}

/** The layer.styles record a preset applies (null for Default Style (None)). */
export function stylePresetStyles(p) {
  const raw = {};
  for (const [kind, params] of p.effects) raw[kind] = effectParams(kind, params);
  if (p.fillOpacity != null) raw.fillOpacity = p.fillOpacity * 100;
  return normalizeStyles(raw);
}

/**
 * style.presets.apply: the preset's effects on the layers named by ids. With add, they join each
 * layer's existing effects (the preset's win where both have one). Returns how many changed.
 */
export function applyStylePreset(layers, ids, p, add = false) {
  const styles = stylePresetStyles(p);
  if (!add) return setLayerStyles(layers, ids, styles);
  let n = 0;
  for (const layer of layers) {
    if (!ids.includes(layer.id)) continue;
    const merged = { ...(layer.styles ?? {}) };
    for (const kind of EFFECT_KINDS) if (styles?.[kind]) merged[kind] = styles[kind];
    if (styles?.fillOpacity != null) merged.fillOpacity = styles.fillOpacity;
    n += setLayerStyles([layer], [layer.id], merged);
  }
  return n;
}
