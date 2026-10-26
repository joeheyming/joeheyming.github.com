// Edit › Transform: Again, Scale, Rotate, and the fixed turns and flips of the active layer
// (PhotoCraft extra_cmds.rs transform_preset, edit_cmds.rs transform_again,
// transform_tool.rs box_preset).
import test from 'node:test';
import assert from 'node:assert/strict';

import {
  IDENTITY_TRANSFORM,
  opaqueBBox,
  presetFreeTransform,
  restrictFreeTransformGrab,
  transformLayerPixels,
  transformMask,
  transformPresetAffine
} from '../paint/transform.js';
import { COMMANDS, COMMANDS_BY_ID } from '../paint/commands.js';
import { planMenus } from '../paint/menu-bar.js';

// A 3 × 2 layer A B C / D E F, red channel 10..60, at (ox, oy) on a W × H transparent canvas.
const NAMES = ['A', 'B', 'C', 'D', 'E', 'F'];
function layer(W, H, ox = 0, oy = 0) {
  const data = new Uint8ClampedArray(W * H * 4);
  NAMES.forEach((_, i) => {
    const p = ((oy + Math.floor(i / 3)) * W + ox + (i % 3)) * 4;
    data[p] = (i + 1) * 10;
    data[p + 3] = 255;
  });
  return { width: W, height: H, data };
}

// The layer as rows of names, '.' for transparent.
function rows(img) {
  const out = [];
  for (let y = 0; y < img.height; y++) {
    let row = '';
    for (let x = 0; x < img.width; x++) {
      const p = (y * img.width + x) * 4;
      row += img.data[p + 3] ? NAMES[img.data[p] / 10 - 1] : '.';
    }
    out.push(row);
  }
  return out;
}

function preset(img, kind) {
  const box = opaqueBBox(img);
  return transformLayerPixels(img, null, box, transformPresetAffine(kind, box), { nearest: true });
}

test('flips and Rotate 180° mirror a 3 × 2 layer about its own centre', () => {
  const img = layer(3, 2);
  assert.deepEqual(rows(img), ['ABC', 'DEF']);
  assert.deepEqual(rows(preset(img, 'flipHorizontal')), ['CBA', 'FED']);
  assert.deepEqual(rows(preset(img, 'flipVertical')), ['DEF', 'ABC']);
  assert.deepEqual(rows(preset(img, 'rotate180')), ['FED', 'CBA']);
});

test('flips turn about the content bounds, not the canvas', () => {
  const img = layer(6, 3, 1, 1);
  assert.deepEqual(rows(preset(img, 'flipHorizontal')), ['......', '.CBA..', '.FED..']);
  assert.deepEqual(rows(preset(img, 'rotate180')), ['......', '.FED..', '.CBA..']);
});

test('quarter turns keep the canvas size and land on PhotoCraft offsets', () => {
  // Box (1, 1, 3, 2) on 5 × 5: centre (2.5, 2), so Cw is X = 5 − y, Y = x − 1 (halves round
  // away from zero, as Rust's f64::round).
  const img = layer(5, 5, 1, 1);
  const box = opaqueBBox(img);
  assert.deepEqual(transformPresetAffine('rotate90Cw', box), [0, 1, -1, 0, 5, -1]);
  assert.deepEqual(transformPresetAffine('rotate90Ccw', box), [0, -1, 1, 0, 1, 5]);
  const cw = preset(img, 'rotate90Cw');
  assert.equal(cw.width, 5);
  assert.equal(cw.height, 5);
  // The top-left corner goes to the top-right after a clockwise turn.
  assert.deepEqual(rows(cw), ['..DA.', '..EB.', '..FC.', '.....', '.....']);
  assert.deepEqual(rows(preset(img, 'rotate90Ccw')), ['.....', '..CF.', '..BE.', '..AD.', '.....']);
});

test('only the selected pixels move; the bottom layer fills what they leave', () => {
  const W = 3;
  const H = 2;
  const img = layer(W, H);
  // Select B C / E F.
  const mask = new Uint8Array([0, 1, 1, 0, 1, 1]);
  const box = { x: 1, y: 0, w: 2, h: 2 };
  const flipped = transformLayerPixels(
    img,
    mask,
    box,
    transformPresetAffine('flipHorizontal', box),
    {
      nearest: true
    }
  );
  assert.deepEqual(rows(flipped), ['ACB', 'DFE']);
  // A 2 × 2 square turns in place: B C / E F → E B / F C.
  const turned = transformLayerPixels(img, mask, box, transformPresetAffine('rotate90Cw', box), {
    nearest: true
  });
  assert.deepEqual(rows(turned), ['AEB', 'DFC']);
  // The top row A B C stands up about (1.5, 0.5): A turns off the canvas, B C land in the middle
  // column, and the bottom layer's fill takes the uncovered pixels.
  const row = new Uint8Array([1, 1, 1, 0, 0, 0]);
  const rowBox = { x: 0, y: 0, w: 3, h: 1 };
  const stood = transformLayerPixels(
    img,
    row,
    rowBox,
    transformPresetAffine('rotate90Cw', rowBox),
    {
      nearest: true,
      fill: [0, 0, 255, 255]
    }
  );
  assert.deepEqual(rows(stood)[1], 'DCF');
  assert.deepEqual([...stood.data.slice(4, 8)], [20, 0, 0, 255]);
  for (const x of [0, 2])
    assert.deepEqual([...stood.data.slice(x * 4, x * 4 + 4)], [0, 0, 255, 255]);
});

test('the selection outline follows its pixels', () => {
  const W = 5;
  const H = 5;
  const mask = new Uint8Array(W * H);
  for (let x = 1; x < 4; x++) mask[W + x] = mask[2 * W + x] = 1;
  const box = { x: 1, y: 1, w: 3, h: 2 };
  const moved = transformMask(mask, W, H, box, transformPresetAffine('rotate90Cw', box));
  const on = [];
  for (let p = 0; p < W * H; p++) if (moved[p]) on.push([p % W, Math.floor(p / W)]);
  assert.deepEqual(on, [
    [2, 0],
    [3, 0],
    [2, 1],
    [3, 1],
    [2, 2],
    [3, 2]
  ]);
});

test('Again reapplies the stored matrix in document coordinates', () => {
  const img = layer(5, 5, 1, 1);
  const box = opaqueBBox(img);
  const last = { affine: transformPresetAffine('rotate90Cw', box), nearest: true };
  const once = transformLayerPixels(img, null, box, last.affine, { nearest: last.nearest });
  const again = transformLayerPixels(once, null, opaqueBBox(once), last.affine, {
    nearest: last.nearest
  });
  // The same quarter turn twice is a half turn about its fixed point: (x, y) → (6 − x, 4 − y).
  assert.deepEqual(rows(again), ['.....', '..FED', '..CBA', '.....', '.....']);
  // A stored bilinear identity-plus-move (a Free Transform drag) moves the layer again.
  const move = { affine: [1, 0, 0, 1, 1, 0], nearest: false };
  const moved = transformLayerPixels(img, null, box, move.affine, { nearest: move.nearest });
  assert.deepEqual(rows(moved).slice(1, 3), ['..ABC', '..DEF']);
});

test('presets turn an open Free Transform box instead of the layer', () => {
  const t = presetFreeTransform({ ...IDENTITY_TRANSFORM, tx: 3 }, 'flipHorizontal');
  assert.deepEqual(t, { tx: 3, ty: 0, sx: -1, sy: 1, angle: 0 });
  assert.equal(presetFreeTransform(IDENTITY_TRANSFORM, 'rotate90Cw').angle, Math.PI / 2);
  assert.equal(presetFreeTransform(IDENTITY_TRANSFORM, 'rotate90Ccw').angle, -Math.PI / 2);
  assert.equal(presetFreeTransform(IDENTITY_TRANSFORM, 'flipVertical').sy, -1);
});

test('Scale and Rotate restrict the Free Transform box to one gesture', () => {
  const handle = { hx: 1, hy: 1 };
  assert.equal(restrictFreeTransformGrab('rotate', 'scale'), null);
  assert.equal(restrictFreeTransformGrab(handle, 'scale'), handle);
  assert.equal(restrictFreeTransformGrab('move', 'scale'), 'move');
  assert.equal(restrictFreeTransformGrab(handle, 'rotate'), 'rotate');
  assert.equal(restrictFreeTransformGrab('move', 'rotate'), 'move');
  assert.equal(restrictFreeTransformGrab(handle, null), handle);
});

test('Edit › Transform lists Again, Scale, Rotate, Skew, Distort, Perspective, Warp, then the turns and flips', () => {
  const plan = planMenus(COMMANDS);
  const ids = plan
    .get('Edit > Transform')
    .map((e) => (e.sep ? '---' : e.cmd?.id))
    .filter(Boolean);
  assert.deepEqual(ids, [
    'edit.transform.again',
    '---',
    'edit.transform.scale',
    'edit.transform.rotate',
    'edit.transform.skew',
    'edit.transform.distort',
    'edit.transform.perspective',
    'edit.transform.warp',
    '---',
    'edit.transform.rotate180',
    'edit.transform.rotate90Cw',
    'edit.transform.rotate90Ccw',
    '---',
    'edit.transform.flipHorizontal',
    'edit.transform.flipVertical'
  ]);
  assert.equal(COMMANDS_BY_ID.get('edit.transform.again').shortcut, 'Cmd+Shift+T');
  const state = { layers: [{ id: 1 }], activeLayerIdx: 0, lastTransform: null };
  assert.equal(COMMANDS_BY_ID.get('edit.transform.again').enabled(state), false);
  state.lastTransform = { affine: [1, 0, 0, 1, 0, 0], nearest: false };
  assert.equal(COMMANDS_BY_ID.get('edit.transform.again').enabled(state), true);
  assert.equal(COMMANDS_BY_ID.get('edit.transform.flipHorizontal').enabled(state), true);
});
