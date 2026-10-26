import test from 'node:test';
import assert from 'node:assert/strict';

import { ICONS } from '../paint/icons.js';
import { redEyeFix, redEyeSearchRadius } from '../paint/retouch.js';
import { TOOLS, TOOL_OPTION_SCHEMA, defaultToolOptions } from '../paint/tools.js';

// Fails is_red_eye (R ≤ G + 0.15), like PhotoCraft's brown iris fixture.
const SKIN = [220, 190, 160, 255];
const RED = [242, 26, 26, 255];
const GRAY = [102, 102, 102, 255];

function image(W, H, f) {
  const d = new Uint8ClampedArray(W * H * 4);
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) d.set(f(x, y), (y * W + x) * 4);
  return d;
}

// A red disc of radius 8 at (cx, cy) on skin.
function portrait(W, H, cx = 20, cy = 20) {
  return image(W, H, (x, y) => (Math.hypot(x - cx, y - cy) <= 8 ? RED : SKIN));
}

function px(data, W, x, y) {
  const i = (y * W + x) * 4;
  return Array.from(data.slice(i, i + 4));
}

function luma([r, g, b]) {
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

function fakeCtx(W, H, data, order) {
  const img = { width: W, height: H, data };
  return {
    img,
    canvas: { width: W, height: H },
    getImageData() {
      return { width: W, height: H, data: img.data.slice() };
    },
    putImageData(next) {
      order.push('put');
      img.data.set(next.data);
    }
  };
}

function fakeOverlay(W, H, texts = []) {
  const ov = { canvas: { width: W, height: H } };
  for (const name of ['clearRect', 'save', 'restore']) ov[name] = () => {};
  ov.fillText = (text) => texts.push(text);
  return ov;
}

test('redEye is a tool with the eye icon and Pupil Size / Darken Amount options', () => {
  assert.equal(TOOLS.redEye.label, 'Red Eye');
  assert.equal(TOOLS.redEye.icon, 'eye');
  assert.ok(ICONS.eye);
  const fields = TOOL_OPTION_SCHEMA.redEye.filter((f) => f.type !== 'hint');
  assert.deepEqual(
    fields.map((f) => [f.key, f.min, f.max, f.default]),
    [
      ['pupilSize', 1, 100, 50],
      ['darken', 0, 100, 50]
    ]
  );
  assert.deepEqual(defaultToolOptions().redEye, { pupilSize: 50, darken: 50 });
});

test('search radius is 4 + 1.2 × Pupil Size clamped to 8..128', () => {
  assert.equal(redEyeSearchRadius(50), 64);
  assert.equal(redEyeSearchRadius(0), 8);
  assert.equal(redEyeSearchRadius(101), redEyeSearchRadius(100));
});

test('a red disc on skin loses its red and the skin is unchanged', () => {
  const W = 40,
    H = 40;
  const data = portrait(W, H);
  const before = data.slice();
  const n = redEyeFix(data, W, H, 20, 20, 50, 100, null);
  assert.ok(n > 0);
  const [r, g, b] = px(data, W, 20, 20);
  assert.ok(r - g < 0.15 * 255 && r - b < 0.15 * 255, `red no longer dominates: ${[r, g, b]}`);
  assert.ok(luma([r, g, b]) < luma(RED) - 10, 'pupil darkened');
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      // The σ 0.8 mask blur feathers up to 3 px past the eroded pupil.
      if (Math.hypot(x - 20, y - 20) <= 11) continue;
      assert.deepEqual(px(data, W, x, y), px(before, W, x, y), `skin at ${x},${y}`);
    }
  }
});

test('a gray image is untouched', () => {
  const W = 24,
    H = 24;
  const data = image(W, H, () => GRAY);
  const before = data.slice();
  assert.equal(redEyeFix(data, W, H, 12, 12, 50, 50, null), 0);
  assert.deepEqual(data, before);
});

test('a click outside the search radius of the disc does nothing', () => {
  const W = 120,
    H = 40;
  const data = portrait(W, H);
  const before = data.slice();
  // Pupil Size 1 → radius 8; the disc edge is 90 px away.
  assert.equal(redEyeFix(data, W, H, 110, 20, 1, 50, null), 0);
  assert.deepEqual(data, before);
});

test('Darken 0 leaves a lighter pupil than Darken 100', () => {
  const W = 40,
    H = 40;
  const light = portrait(W, H);
  const dark = portrait(W, H);
  assert.equal(redEyeFix(light, W, H, 20, 20, 50, 0, null), 0);
  assert.ok(redEyeFix(dark, W, H, 20, 20, 50, 100, null) > 0);
  assert.ok(luma(px(light, W, 20, 20)) > luma(px(dark, W, 20, 20)));
});

test('the selection mask limits writes', () => {
  const W = 40,
    H = 40;
  const data = portrait(W, H);
  const before = data.slice();
  const mask = new Uint8Array(W * H);
  for (let y = 0; y < H; y++) for (let x = 0; x < 20; x++) mask[y * W + x] = 1;
  assert.ok(redEyeFix(data, W, H, 20, 20, 50, 100, mask) > 0);
  assert.notDeepEqual(px(data, W, 17, 20), px(before, W, 17, 20));
  for (let y = 0; y < H; y++) {
    for (let x = 20; x < W; x++) {
      assert.deepEqual(px(data, W, x, y), px(before, W, x, y), `unselected ${x},${y}`);
    }
  }
});

test('the tool pushes undo before the put, and nothing on a miss', () => {
  const W = 40,
    H = 40;
  const order = [];
  const state = {
    toolOptions: defaultToolOptions(),
    sel: { mode: 'none' },
    pushUndo: (label) => order.push('undo:' + label)
  };
  const ctx = fakeCtx(W, H, portrait(W, H), order);
  TOOLS.redEye.onDown(ctx, fakeOverlay(W, H), state, 20, 20);
  assert.deepEqual(order, ['undo:Red Eye', 'put']);

  const missOrder = [];
  const texts = [];
  const gray = fakeCtx(
    W,
    H,
    image(W, H, () => GRAY),
    missOrder
  );
  TOOLS.redEye.onDown(
    gray,
    fakeOverlay(W, H, texts),
    { ...state, pushUndo: () => missOrder.push('undo') },
    20,
    20
  );
  assert.deepEqual(missOrder, []);
  assert.deepEqual(texts, ['No red-eye pixels near the click']);
});
