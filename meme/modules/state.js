// modules/state.js
//
// Single source of truth for the meme being edited. Other modules
// subscribe via `subscribe(fn)` to re-render when state changes.
//
// State shape:
//   template:     { id, name, src, width, height, defaultBoxes } | null
//   imageSrc:     resolved URL/Blob URL of the current image (or null)
//   naturalSize:  { w, h } — natural pixels of the loaded image
//   boxes:        TextBox[]
//   stickers:     Sticker[]
//   bgBlur:       0..30 (px, applied at natural-size scale)
//   selection:    { kind: 'box' | 'sticker', id } | null
//
// All positions/sizes inside boxes and stickers are FRACTIONS of the
// natural image size (0..1) so they stay correct regardless of
// display scaling and survive a round-trip through URL sharing.
//
//   TextBox:  { id, text, x, y, w, h, rotation,
//               fontFamily, fontSize, color, strokeColor, strokeWidth,
//               align, bold, italic, uppercase }
//
//   Sticker:  { id, emoji, x, y, w, h, rotation }

const initial = () => ({
  template: null,
  imageSrc: null,
  naturalSize: { w: 0, h: 0 },
  boxes: [],
  stickers: [],
  bgBlur: 0,
  selection: null
});

let state = initial();
const subs = new Set();

export function get() {
  return state;
}

export function subscribe(fn) {
  subs.add(fn);
  return () => subs.delete(fn);
}

function emit() {
  for (const fn of subs) fn(state);
}

let nextId = 1;
export function uid(prefix = 'id') {
  // Avoids the bundle-cost of nanoid for unique-within-session IDs.
  return `${prefix}-${Date.now().toString(36)}-${nextId++}`;
}

export const DEFAULT_BOX = Object.freeze({
  text: '',
  rotation: 0,
  fontFamily: 'Impact',
  fontSize: 0.08,
  color: '#FFFFFF',
  strokeColor: '#000000',
  strokeWidth: 0.005,
  align: 'center',
  bold: false,
  italic: false,
  uppercase: true
});

export function makeBox(overrides = {}) {
  return {
    id: uid('box'),
    text: '',
    x: 0.05,
    y: 0.4,
    w: 0.9,
    h: 0.2,
    ...DEFAULT_BOX,
    ...overrides
  };
}

export function makeSticker(emoji, overrides = {}) {
  return {
    id: uid('stk'),
    emoji,
    x: 0.4,
    y: 0.4,
    w: 0.2,
    h: 0.2,
    rotation: 0,
    ...overrides
  };
}

// ---------- Mutators ----------
//
// All mutators replace `state` so subscribers see a fresh reference,
// then emit. They never mutate `state` in place — that lets future
// callers do structural equality checks if needed.

export function setTemplate(template, imageSrc, naturalSize) {
  const boxes = (template?.defaultBoxes || []).map((b, idx) =>
    makeBox({
      text: idx === 0 ? '' : '',
      x: b.x,
      y: b.y,
      w: b.w,
      h: b.h,
      // Stacked layouts with many small boxes look better with a smaller default font.
      fontSize: Math.min(0.08, b.h * 0.55)
    })
  );

  state = {
    ...initial(),
    template,
    imageSrc,
    naturalSize,
    boxes
  };
  emit();
}

export function setCustomImage(imageSrc, naturalSize) {
  state = {
    ...initial(),
    template: null,
    imageSrc,
    naturalSize,
    boxes: [
      makeBox({ x: 0.05, y: 0.0, w: 0.9, h: 0.2 }),
      makeBox({ x: 0.05, y: 0.8, w: 0.9, h: 0.2 })
    ]
  };
  emit();
}

export function reset() {
  state = initial();
  emit();
}

export function setBgBlur(value) {
  state = { ...state, bgBlur: value };
  emit();
}

export function setSelection(kind, id) {
  if (state.selection?.kind === kind && state.selection?.id === id) return;
  state = { ...state, selection: kind && id ? { kind, id } : null };
  emit();
}

export function clearSelection() {
  if (!state.selection) return;
  state = { ...state, selection: null };
  emit();
}

// ---------- Box mutators ----------

export function addBox(overrides) {
  const box = makeBox(overrides);
  state = { ...state, boxes: [...state.boxes, box], selection: { kind: 'box', id: box.id } };
  emit();
  return box.id;
}

export function updateBox(id, patch) {
  let changed = false;
  const boxes = state.boxes.map((b) => {
    if (b.id !== id) return b;
    changed = true;
    return { ...b, ...patch };
  });
  if (!changed) return;
  state = { ...state, boxes };
  emit();
}

export function removeBox(id) {
  const boxes = state.boxes.filter((b) => b.id !== id);
  if (boxes.length === state.boxes.length) return;
  const selection =
    state.selection?.kind === 'box' && state.selection?.id === id ? null : state.selection;
  state = { ...state, boxes, selection };
  emit();
}

// ---------- Sticker mutators ----------

export function addSticker(emoji) {
  const sticker = makeSticker(emoji);
  state = {
    ...state,
    stickers: [...state.stickers, sticker],
    selection: { kind: 'sticker', id: sticker.id }
  };
  emit();
  return sticker.id;
}

export function updateSticker(id, patch) {
  let changed = false;
  const stickers = state.stickers.map((s) => {
    if (s.id !== id) return s;
    changed = true;
    return { ...s, ...patch };
  });
  if (!changed) return;
  state = { ...state, stickers };
  emit();
}

export function removeSticker(id) {
  const stickers = state.stickers.filter((s) => s.id !== id);
  if (stickers.length === state.stickers.length) return;
  const selection =
    state.selection?.kind === 'sticker' && state.selection?.id === id ? null : state.selection;
  state = { ...state, stickers, selection };
  emit();
}

export function clearStickers() {
  if (state.stickers.length === 0) return;
  state = { ...state, stickers: [], selection: null };
  emit();
}

// Whole-state restore — used by the URL-hash share decoder.
export function replaceAll(next) {
  state = { ...initial(), ...next };
  emit();
}
