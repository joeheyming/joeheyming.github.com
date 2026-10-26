import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  applyBlurGallery,
  blurWeightMap,
  fieldSigmaAt,
  gallerySigma,
  galleryPointer,
  irisSigmaAt,
  newGallery,
  removeSelectedPin,
  setGalleryField,
  tiltSigmaAt
} from '../paint/blur-gallery.js';
import { COMMANDS_BY_ID } from '../paint/commands.js';

const W = 64;
const H = 64;
const BOUNDS = { x0: 0, y0: 0, x1: W, y1: H };
const at = (map, x, y) => map[y * W + x];

// A 1-px checkerboard: any blur pulls it towards grey, sharp pixels stay 0 or 255.
function checker() {
  const data = new Uint8ClampedArray(W * H * 4);
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const v = (x + y) % 2 ? 255 : 0;
      data.set([v, v, v, 255], (y * W + x) * 4);
    }
  }
  return { width: W, height: H, data };
}
const red = (img, x, y) => img.data[(y * W + x) * 4];

test('iris weight map: zero inside the focus core, the full blur outside the shape', () => {
  const g = newGallery('iris', BOUNDS);
  g.pins[0].blur = 40;
  const map = blurWeightMap(g, W, H);
  const max = gallerySigma(40);
  assert.equal(at(map, 32, 32), 0);
  // rx 0.35 × 64 = 22.4 px: 8 px out is inside the feathered core (feather 0.5 → 11.2 px).
  assert.equal(at(map, 40, 32), 0);
  // Beyond the outline in x and y, and in a corner.
  assert.equal(at(map, 60, 32), max);
  assert.equal(at(map, 32, 60), max);
  assert.equal(at(map, 1, 1), max);
  // The feather ramps up monotonically between core and outline.
  const ramp = [44, 46, 48, 50, 52].map((x) => at(map, x, 32));
  assert.ok(ramp[0] > 0 && ramp[4] < max, ramp.join());
  for (let i = 1; i < ramp.length; i++) assert.ok(ramp[i] >= ramp[i - 1]);
  // Sharpness from any pin wins.
  g.pins.push({ ...g.pins[0], x: 0.05, y: 0.05, rx: 0.05, ry: 0.05 });
  assert.equal(irisSigmaAt(g.pins, BOUNDS, 3.5, 3.5), 0);
});

test('tilt-shift weight map is symmetric about the band and sharp inside it', () => {
  const g = newGallery('tilt', BOUNDS);
  g.pins[0].blur = 30;
  const max = gallerySigma(30);
  const map = blurWeightMap(g, W, H);
  // Horizontal band: focus 0.1 × 64 = 6.4 px each side of y = 32.
  for (const x of [0, 17, 63]) {
    for (let d = 0; d < 6; d++) assert.equal(at(map, x, 32 + d), 0, `x ${x} d ${d}`);
  }
  for (let d = 0; d < 32; d++) {
    const above = at(map, 10, 31 - d);
    const below = at(map, 10, 32 + d);
    assert.ok(Math.abs(above - below) < 1e-6, `row ±${d}: ${above} vs ${below}`);
  }
  // Past focus + transition (0.25 × 64 = 16 px) the blur is full.
  assert.equal(at(map, 5, 60), max);
  assert.equal(at(map, 5, 3), max);
  // Turned 90°, the band runs vertically and is symmetric about x = 32.
  g.pins[0].angle = 90;
  assert.equal(tiltSigmaAt(g.pins[0], BOUNDS, 32, 5), 0);
  const turned = (x) => tiltSigmaAt(g.pins[0], BOUNDS, x, 5);
  assert.ok(Math.abs(turned(22) - turned(42)) < 1e-6);
  assert.equal(tiltSigmaAt(g.pins[0], BOUNDS, 60, 32), max);
});

test('field weight map interpolates between pins', () => {
  const pins = [
    { x: 0.1, y: 0.5, blur: 0 },
    { x: 0.9, y: 0.5, blur: 100 }
  ];
  const left = fieldSigmaAt(pins, BOUNDS, 6.4, 32);
  const mid = fieldSigmaAt(pins, BOUNDS, 32, 32);
  const right = fieldSigmaAt(pins, BOUNDS, 57.6, 32);
  assert.ok(left < 1, `left ${left}`);
  assert.ok(right > gallerySigma(100) - 1, `right ${right}`);
  assert.ok(Math.abs(mid - gallerySigma(50)) < 1e-6, `mid ${mid}`);
});

test('spin weight map is zero outside the ellipse and the angle inside it', () => {
  const g = newGallery('spin', BOUNDS);
  g.pins[0].blur = 90;
  const map = blurWeightMap(g, W, H);
  assert.equal(at(map, 32, 32), 90);
  assert.equal(at(map, 1, 1), 0);
  assert.equal(at(map, 60, 32), 0);
});

test('iris blur keeps the core sharp and blurs outside', () => {
  const g = newGallery('iris', BOUNDS);
  g.pins[0].blur = 10;
  const img = checker();
  applyBlurGallery(img, g);
  assert.ok([0, 255].includes(red(img, 32, 32)));
  assert.ok([0, 255].includes(red(img, 33, 32)));
  assert.ok(Math.abs(red(img, 2, 2) - 128) < 20, `corner ${red(img, 2, 2)}`);
  // A selection limits the writes.
  const mask = new Uint8Array(W * H);
  const masked = checker();
  applyBlurGallery(masked, g, mask);
  assert.deepEqual(masked.data, checker().data);
});

test('tilt-shift blurs outside the band, spin blurs inside its ellipse only', () => {
  const tilt = newGallery('tilt', BOUNDS);
  const img = checker();
  applyBlurGallery(img, tilt);
  assert.ok([0, 255].includes(red(img, 10, 32)));
  assert.ok(Math.abs(red(img, 10, 2) - 128) < 20);

  const spin = newGallery('spin', BOUNDS);
  spin.pins[0].blur = 120;
  const s = checker();
  applyBlurGallery(s, spin);
  assert.equal(red(s, 1, 1), checker().data[(1 * W + 1) * 4]);
  assert.ok(Math.abs(red(s, 44, 32) - 128) < 40, `ring ${red(s, 44, 32)}`);
});

test('pins: a click adds one, a drag moves it, the ring turns the amount, Delete removes it', () => {
  const g = newGallery('field', BOUNDS);
  assert.equal(galleryPointer(g, 'down', 10, 10), true);
  assert.equal(g.pins.length, 2);
  assert.equal(g.selected, 1);
  galleryPointer(g, 'move', 16, 20);
  galleryPointer(g, 'up', 0, 0);
  assert.deepEqual([g.pins[1].x, g.pins[1].y], [16 / 64, 20 / 64]);
  // Pressing on the first pin's dot selects it rather than adding.
  galleryPointer(g, 'down', 32, 32);
  galleryPointer(g, 'up', 0, 0);
  assert.equal(g.pins.length, 2);
  assert.equal(g.selected, 0);
  // A quarter turn on the ring (24 px out) adds a quarter of 500 px.
  galleryPointer(g, 'down', 32, 32 - 24);
  galleryPointer(g, 'move', 32 + 24, 32);
  galleryPointer(g, 'up', 0, 0);
  assert.equal(g.pins[0].blur, 15 + 125);
  assert.ok(setGalleryField(g, 'blur', 40));
  assert.equal(g.pins[0].blur, 40);
  assert.ok(removeSelectedPin(g));
  assert.equal(g.pins.length, 1);
});

test('iris handles resize and feather the shape; tilt-shift lines set focus', () => {
  const g = newGallery('iris', BOUNDS);
  // The right outline handle sits at rx = 0.35 × 64 = 22.4 px.
  galleryPointer(g, 'down', 32 + 22.4, 32);
  galleryPointer(g, 'move', 32 + 32, 32);
  galleryPointer(g, 'up', 0, 0);
  assert.equal(g.pins[0].rx, 0.5);
  assert.equal(g.pins[0].angle, 0);
  assert.ok(setGalleryField(g, 'feather', 20));
  assert.equal(g.pins[0].feather, 0.2);
  // The core is now 0.2 × 32 = 6.4 px: 4.5 px out is sharp, 12.5 px out is not.
  const map = blurWeightMap(g, W, H);
  assert.equal(at(map, 36, 32), 0);
  assert.ok(at(map, 44, 32) > 0);

  const t = newGallery('tilt', BOUNDS);
  // The lower focus line is 6.4 px under the centre; drag it to 12.8 px.
  galleryPointer(t, 'down', 10, 32 + 6.4);
  galleryPointer(t, 'move', 10, 32 + 12.8);
  galleryPointer(t, 'up', 0, 0);
  assert.ok(Math.abs(t.pins[0].focus - 0.2) < 1e-9);
  assert.equal(t.pins.length, 1);
  assert.equal(removeSelectedPin(t), false);
});

test('Filter › Blur Gallery lists Field, Iris, Tilt-Shift, and Spin and opens the gallery', () => {
  const opened = [];
  const ctx = { openBlurGallery: (kind) => opened.push(kind) };
  const state = { layers: [{ id: 'a', kind: 'pixel' }], activeLayerIdx: 0 };
  const rows = [
    ['filter.blurGallery.fieldBlur', 'Field Blur…', 'field'],
    ['filter.blurGallery.irisBlur', 'Iris Blur…', 'iris'],
    ['filter.blurGallery.tiltShift', 'Tilt-Shift…', 'tilt'],
    ['filter.blurGallery.spinBlur', 'Spin Blur…', 'spin']
  ];
  for (const [id, label, kind] of rows) {
    const c = COMMANDS_BY_ID.get(id);
    assert.ok(c, id);
    assert.equal(c.label, label);
    assert.deepEqual(c.menu, ['Filter', 'Blur Gallery']);
    assert.equal(c.enabled(state), true);
    c.run(ctx);
    assert.equal(opened.at(-1), kind);
  }
});
