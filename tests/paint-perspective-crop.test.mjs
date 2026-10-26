// Perspective Crop (PhotoCraft perspective_crop_ui.rs, perspective_crop_cmds.rs,
// algo transform.rs Homography / convex_quad / quad_size).
import { test } from 'node:test';
import assert from 'node:assert/strict';

import { TOOLS, TOOL_OPTION_SCHEMA, defaultToolOptions } from '../paint/tools.js';
import { ICONS } from '../paint/icons.js';
import { historyIconName } from '../paint/history.js';
import { STACK_UNDO_LABELS } from '../paint/stack-history.js';
import {
  applyHomography,
  convexQuad,
  homographyFromQuad,
  invertHomography,
  perspectiveCropImageData,
  perspectiveCropSize,
  quadSize
} from '../paint/transform.js';

// A stub overlay context that ignores every draw call.
function overlay(width = 200, height = 150) {
  const target = { canvas: { width, height } };
  return new Proxy(target, {
    get: (t, key) => (key in t ? t[key] : () => {}),
    set: (t, key, value) => ((t[key] = value), true)
  });
}

function pcropState() {
  return { toolOptions: defaultToolOptions(), zoom: 1, perspectiveQuad: null };
}

const tool = TOOLS.perspectiveCrop;

test('Perspective Crop follows Crop with the perspective-crop icon', () => {
  const ids = Object.keys(TOOLS);
  assert.equal(tool.label, 'Perspective Crop');
  assert.equal(tool.icon, 'perspective-crop');
  assert.ok(Object.hasOwn(ICONS, 'perspective-crop'));
  assert.equal(ids.indexOf('perspectiveCrop'), ids.indexOf('crop') + 1);
  assert.equal(historyIconName('Perspective Crop'), 'perspective-crop');
  assert.ok(STACK_UNDO_LABELS.has('Perspective Crop'));
  const keys = TOOL_OPTION_SCHEMA.perspectiveCrop.map((o) => o.key);
  assert.deepEqual(keys.slice(0, 3), ['cropW', '_pcropSwap', 'cropH']);
});

test('a drag without area leaves no quad (a_drag_without_area_leaves_no_quad)', () => {
  const ov = overlay();
  const state = pcropState();
  for (const [x1, y1] of [
    [10, 60],
    [90, 10]
  ]) {
    tool.onDown(null, ov, state, 10, 10);
    tool.onMove(null, ov, state, x1, y1);
    tool.onUp(null, ov, state, x1, y1);
    assert.equal(state.perspectiveQuad, null, `drag to (${x1}, ${y1})`);
  }
  tool.onDown(null, ov, state, 30, 30);
  tool.onUp(null, ov, state, 30, 30);
  assert.equal(state.perspectiveQuad, null, 'a click');
});

test('drag a box, move a corner, and size the commit (drag_a_box_move_a_corner_and_commit)', () => {
  const ov = overlay();
  const state = pcropState();
  tool.onDown(null, ov, state, 20, 10);
  tool.onMove(null, ov, state, 120, 90);
  tool.onUp(null, ov, state, 120, 90);
  assert.deepEqual(state.perspectiveQuad, [
    [20, 10],
    [120, 10],
    [120, 90],
    [20, 90]
  ]);
  // The press is 1 px off the corner; the corner keeps that offset.
  tool.onDown(null, ov, state, 121, 89);
  tool.onUp(null, ov, state, 141, 99);
  assert.deepEqual(state.perspectiveQuad[2], [140, 100]);
  assert.deepEqual(state.perspectiveQuad[0], [20, 10], 'the other corners stay');
  assert.ok(convexQuad(state.perspectiveQuad));
  assert.deepEqual(perspectiveCropSize(state.perspectiveQuad, '', ''), { w: 110, h: 86 });
  assert.deepEqual(perspectiveCropSize(state.perspectiveQuad, '200', '100'), { w: 200, h: 100 });
  const [qw, qh] = quadSize(state.perspectiveQuad);
  assert.deepEqual(perspectiveCropSize(state.perspectiveQuad, '220', ''), {
    w: 220,
    h: Math.round((220 * qh) / qw)
  });
});

test('a press inside the quad moves it whole; outside it does nothing', () => {
  const ov = overlay();
  const state = pcropState();
  state.perspectiveQuad = [
    [20, 10],
    [120, 10],
    [120, 90],
    [20, 90]
  ];
  tool.onDown(null, ov, state, 60, 50);
  tool.onMove(null, ov, state, 70, 55);
  tool.onUp(null, ov, state, 70, 55);
  assert.deepEqual(state.perspectiveQuad, [
    [30, 15],
    [130, 15],
    [130, 95],
    [30, 95]
  ]);
  tool.onDown(null, ov, state, 180, 140);
  assert.equal(state.perspectiveDrag, null);
  tool.onUp(null, ov, state, 190, 145);
  assert.deepEqual(state.perspectiveQuad[0], [30, 15]);
  tool.cancel(ov, state);
  assert.equal(state.perspectiveQuad, null);
});

test('convexQuad rejects a bow-tie, a reversed winding, and a sliver', () => {
  assert.equal(
    convexQuad([
      [0, 0],
      [100, 0],
      [100, 80],
      [0, 80]
    ]),
    true
  );
  assert.equal(
    convexQuad([
      [0, 0],
      [100, 0],
      [0, 80],
      [100, 80]
    ]),
    false,
    'bow-tie'
  );
  assert.equal(
    convexQuad([
      [0, 0],
      [0, 80],
      [100, 80],
      [100, 0]
    ]),
    false,
    'counter-clockwise'
  );
  assert.equal(
    convexQuad([
      [0, 0],
      [1, 0],
      [1, 1],
      [0, 1.5]
    ]),
    true
  );
  assert.equal(
    convexQuad([
      [0, 0],
      [0.5, 0],
      [0.5, 0.5],
      [0, 0.5]
    ]),
    false,
    'under 1 px²'
  );
});

test('homographyFromQuad takes the rectangle corners onto the quad corners', () => {
  const q = [
    [30, 12],
    [140, 25],
    [128, 110],
    [14, 95]
  ];
  const m = homographyFromQuad(q, 100, 80);
  const corners = [
    [0, 0],
    [100, 0],
    [100, 80],
    [0, 80]
  ];
  corners.forEach(([x, y], i) => {
    const [X, Y] = applyHomography(m, x, y);
    assert.ok(Math.abs(X - q[i][0]) < 1e-9 && Math.abs(Y - q[i][1]) < 1e-9, `corner ${i}`);
  });
  const inv = invertHomography(m);
  const [u, v] = applyHomography(inv, ...applyHomography(m, 37, 41));
  assert.ok(Math.abs(u - 37) < 1e-9 && Math.abs(v - 41) < 1e-9);
});

test('perspectiveCropImageData rectifies a skewed ramp (perspective_crop_rectifies_a_skewed_ramp)', () => {
  const q = [
    [30, 12],
    [140, 25],
    [128, 110],
    [14, 95]
  ];
  const [w, h] = [100, 80];
  const [W, H] = [160, 120];
  // Each source pixel holds where it lands in the output: R = u / w, G = v / h.
  const toOut = invertHomography(homographyFromQuad(q, w, h));
  const data = new Uint8ClampedArray(W * H * 4);
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const [u, v] = applyHomography(toOut, x + 0.5, y + 0.5);
      const i = (y * W + x) * 4;
      data[i] = (u / w) * 255;
      data[i + 1] = (v / h) * 255;
      data[i + 3] = 255;
    }
  }
  const out = perspectiveCropImageData({ width: W, height: H, data }, q, w, h);
  assert.equal(out.width, 100);
  assert.equal(out.height, 80);
  const at = (x, y) => {
    const i = (y * w + x) * 4;
    return [(out.data[i] / 255) * w, (out.data[i + 1] / 255) * h, out.data[i + 3]];
  };
  // The output corners show the quad's corner pixels.
  for (const [x, y] of [
    [0, 0],
    [99, 0],
    [99, 79],
    [0, 79]
  ]) {
    const [u, v, a] = at(x, y);
    assert.equal(a, 255, `(${x}, ${y}) opaque`);
    assert.ok(Math.abs(u - (x + 0.5)) < 1 && Math.abs(v - (y + 0.5)) < 1, `(${x}, ${y})`);
  }
  for (let y = 2; y < 78; y += 5) {
    for (let x = 2; x < 98; x += 5) {
      const [u, v] = at(x, y);
      assert.ok(
        Math.abs(u - (x + 0.5)) < 1 && Math.abs(v - (y + 0.5)) < 1,
        `(${x}, ${y}) shows (${u.toFixed(2)}, ${v.toFixed(2)})`
      );
    }
  }
});

test('perspectiveCropImageData is transparent where the quad leaves the image', () => {
  const data = new Uint8ClampedArray(10 * 10 * 4).fill(255);
  const q = [
    [5, 0],
    [25, 0],
    [25, 10],
    [5, 10]
  ];
  const out = perspectiveCropImageData({ width: 10, height: 10, data }, q, 20, 10);
  assert.equal(out.data[(5 * 20 + 2) * 4 + 3], 255, 'inside the image');
  assert.equal(out.data[(5 * 20 + 15) * 4 + 3], 0, 'past the right edge');
});
