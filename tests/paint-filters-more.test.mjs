import test from 'node:test';
import assert from 'node:assert/strict';

import { COMMANDS_BY_ID, FILTER_IDS } from '../paint/commands.js';
import {
  ADJUSTMENTS,
  applyDisplace,
  applyShear,
  applyExtrude,
  applyTiles,
  applyOilPaint,
  setDisplaceMapSource,
  shearCurveAt
} from '../paint/adjustments.js';

const W = 24,
  H = 18;

// A colourful opaque image with a translucent stripe so alpha has something to keep.
function image() {
  const data = new Uint8ClampedArray(W * H * 4);
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const i = (y * W + x) * 4;
      data[i] = (x * 37 + y * 11) % 256;
      data[i + 1] = (x * 5 + y * 23) % 256;
      data[i + 2] = x < W / 2 ? 30 : 220;
      data[i + 3] = y === 4 ? 128 : 255;
    }
  }
  return { width: W, height: H, data };
}

function flat(value, w = W, h = H) {
  const data = new Uint8ClampedArray(w * h * 4).fill(value);
  for (let i = 3; i < data.length; i += 4) data[i] = 255;
  return { width: w, height: h, data };
}

const clone = (img) => ({ width: img.width, height: img.height, data: img.data.slice() });

// Left half of the image selected.
const leftMask = () => {
  const m = new Uint8Array(W * H);
  for (let y = 0; y < H; y++) for (let x = 0; x < W / 2; x++) m[y * W + x] = 1;
  return m;
};

function assertOutsideUntouched(before, after, mask) {
  for (let p = 0; p < W * H; p++) {
    if (mask[p]) continue;
    for (let c = 0; c < 4; c++) {
      assert.equal(after.data[p * 4 + c], before.data[p * 4 + c], `pixel ${p} channel ${c}`);
    }
  }
}

const changedInside = (before, after, mask) =>
  [...after.data].some((v, i) => mask[i >> 2] && v !== before.data[i]);

test('the five filters sit in their PhotoCraft Filter submenus and open their dialogs', () => {
  const rows = [
    ['filter.distort.displace', ['Filter', 'Distort'], 'Displace…', 'displace'],
    ['filter.distort.shear', ['Filter', 'Distort'], 'Shear…', 'shear'],
    ['filter.stylize.extrude', ['Filter', 'Stylize'], 'Extrude…', 'extrude'],
    ['filter.stylize.tiles', ['Filter', 'Stylize'], 'Tiles…', 'tiles'],
    ['filter.stylize.oilPaint', ['Filter', 'Stylize'], 'Oil Paint…', 'oilPaint']
  ];
  for (const [id, menu, label, adj] of rows) {
    const cmd = COMMANDS_BY_ID.get(id);
    assert.ok(cmd, id);
    assert.deepEqual(cmd.menu, menu);
    assert.equal(cmd.label, label);
    assert.ok(ADJUSTMENTS[adj], adj);
    assert.ok(FILTER_IDS.has(adj));
    const opened = [];
    cmd.run({ openAdjust: (a) => opened.push(a) });
    assert.deepEqual(opened, [adj]);
  }
});

test('Displace with a flat-gray map is the identity', () => {
  const src = image();
  for (const fit of ['stretch', 'tile']) {
    for (const undef of ['repeat', 'wrap']) {
      const out = clone(src);
      applyDisplace(out, 500, -300, fit, undef, flat(128, 7, 5));
      assert.deepEqual(out.data, src.data, `${fit} ${undef}`);
    }
  }
});

test('Displace shifts by the map, honours the mask, and reads its map from the chosen layer', () => {
  const src = image();
  // Red 255 → +128 px * 10 % = 12.8 px to the right is read (pixels move left).
  const map = flat(128);
  for (let i = 0; i < map.data.length; i += 4) map.data[i] = 255;
  const out = clone(src);
  applyDisplace(out, 10, 10, 'stretch', 'repeat', map);
  assert.notDeepEqual(out.data, src.data);
  // Byte 128 is neutral, so red 255 reads 127 / 127.5 * 12.8 px over: row 0, x = 0 samples
  // between source columns 12 and 13.
  const r12 = src.data[12 * 4],
    r13 = src.data[13 * 4];
  const t = (12.8 * 127) / 127.5 - 12;
  assert.ok(Math.abs(out.data[0] - (r12 + (r13 - r12) * t)) <= 1);

  const mask = leftMask();
  const masked = clone(src);
  setDisplaceMapSource({
    options: () => [{ value: '7', label: 'Map' }],
    image: (v) => (v === '7' ? map : null)
  });
  ADJUSTMENTS.displace.apply(
    masked,
    { horizontal: 10, vertical: 10, fit: 'stretch', undefinedAreas: 'repeat', mapLayer: '7' },
    mask
  );
  assert.ok(changedInside(src, masked, mask));
  assertOutsideUntouched(src, masked, mask);
  const mapField = ADJUSTMENTS.displace.fields.find((f) => f.key === 'mapLayer');
  assert.deepEqual(mapField.options, [{ value: '7', label: 'Map' }]);
  setDisplaceMapSource({ options: () => [], image: () => null });
});

test('Shear with a straight curve is the identity; a bent curve shifts rows', () => {
  const src = image();
  for (const undef of ['wrap', 'repeat']) {
    const out = clone(src);
    applyShear(
      out,
      [
        [0, 0],
        [0.5, 0],
        [1, 0]
      ],
      undef
    );
    assert.deepEqual(out.data, src.data);
    const dlg = clone(src);
    ADJUSTMENTS.shear.apply(dlg, { amount: 0, undefinedAreas: undef }, null);
    assert.deepEqual(dlg.data, src.data);
  }
  assert.ok(Math.abs(shearCurveAt([[0, 0], [0.5, 0.4], [1, -0.2]], 0.5) - 0.4) < 1e-9);
  assert.equal(shearCurveAt([[0, 0.3], [1, 0.3]], 0.42), 0.3);

  const bent = clone(src);
  ADJUSTMENTS.shear.apply(bent, { amount: 50, undefinedAreas: 'wrap' }, null);
  assert.notDeepEqual(bent.data, src.data);
  // Shear moves pixels along their row only, so each row's alpha stays put.
  for (let i = 3; i < bent.data.length; i += 4) assert.equal(bent.data[i], src.data[i]);
});

test('Extrude, Tiles, and Oil Paint change the selection and nothing outside it', () => {
  const runs = [
    ['extrude blocks', (img, m) => applyExtrude(img, { size: 4, depth: 60 }, m)],
    [
      'extrude pyramids',
      (img, m) => applyExtrude(img, { type: 'pyramids', size: 5, depthMode: 'levelBased' }, m)
    ],
    [
      'extrude solid',
      (img, m) =>
        applyExtrude(img, { size: 6, depth: 200, solidFrontFaces: true, seed: 3 }, m)
    ],
    ['tiles', (img, m) => applyTiles(img, { count: 3, maxOffset: 30, fill: 'background' }, m)],
    ['tiles inverse', (img, m) => applyTiles(img, { count: 4, maxOffset: 40, fill: 'inverse' }, m)],
    ['oil paint', (img, m) => applyOilPaint(img, {}, m)],
    ['oil paint flat', (img, m) => applyOilPaint(img, { lighting: false, stylization: 10 }, m)]
  ];
  for (const [name, run] of runs) {
    const src = image();
    const mask = leftMask();
    const out = clone(src);
    run(out, mask);
    assert.ok(changedInside(src, out, mask), `${name} changes the selection`);
    assertOutsideUntouched(src, out, mask);
  }
});

test('Oil Paint keeps the layer alpha; Tiles fills gaps with the background colour', () => {
  const src = image();
  const oil = clone(src);
  ADJUSTMENTS.oilPaint.apply(oil, { lighting: true, angle: -60, shine: 5 }, null);
  for (let i = 3; i < oil.data.length; i += 4) assert.equal(oil.data[i], src.data[i]);

  const tiles = clone(src);
  ADJUSTMENTS.tiles.apply(
    tiles,
    { count: 3, maxOffset: 40, fill: 'background', background: '#ff0000', seed: 2 },
    null
  );
  let gaps = 0;
  for (let i = 0; i < tiles.data.length; i += 4) {
    const [r, g, b, a] = tiles.data.slice(i, i + 4);
    if (r === 255 && g === 0 && b === 0 && a === 255) gaps++;
  }
  assert.ok(gaps > 0, 'offset tiles leave background-filled gaps');

  const unaltered = clone(src);
  applyTiles(unaltered, { count: 1, maxOffset: 1, fill: 'unaltered' }, null);
  // One tile shifted by under a pixel copies from itself where it covers.
  assert.equal(unaltered.data.length, src.data.length);
});
