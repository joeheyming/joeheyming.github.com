import test from 'node:test';
import assert from 'node:assert/strict';

import {
  applyHomography,
  quadHomography,
  homographyCorners,
  warpQuad,
  hitQuad,
  quadGesture,
  QUAD_GESTURES,
  dragQuad,
  keepConvex,
  presetQuad,
  transformLayerPixels,
  transformMask
} from '../paint/transform.js';
import { COMMANDS_BY_ID } from '../paint/commands.js';

function image(W, H, px) {
  const data = new Uint8ClampedArray(W * H * 4);
  for (let p = 0; p < W * H; p++) data.set(px(p % W, Math.floor(p / W)), p * 4);
  return { width: W, height: H, data };
}

const at = (img, x, y) =>
  Array.from(img.data.slice((y * img.width + x) * 4, (y * img.width + x) * 4 + 4));

const near = (a, b, eps = 1e-9) =>
  a.every((v, i) => Math.abs(v - b[i]) <= eps * Math.max(1, Math.abs(b[i])));

const boxQuad = ({ x, y, w, h }) => [
  [x, y],
  [x + w, y],
  [x + w, y + h],
  [x, y + h]
];

test('the homography maps the box corners exactly onto the quad', () => {
  const box = { x: 3, y: 5, w: 20, h: 12 };
  const quads = [
    [
      [2, 4],
      [30, 1],
      [26, 22],
      [6, 18]
    ],
    [
      [10, 10],
      [40, 12],
      [35, 30],
      [8, 28]
    ],
    boxQuad(box)
  ];
  for (const quad of quads) {
    const m = quadHomography(box, quad);
    const corners = boxQuad(box);
    for (let k = 0; k < 4; k++) {
      const got = applyHomography(m, ...corners[k]);
      assert.ok(near(got, quad[k]), `corner ${k}: ${got} vs ${quad[k]}`);
    }
    homographyCorners(box, m).forEach((c, k) => assert.ok(near(c, quad[k])));
  }
});

test('an identity quad leaves pixels unchanged', () => {
  const src = image(9, 7, (x, y) => [x * 25, y * 30, (x * y) % 256, x === 4 ? 128 : 255]);
  const out = warpQuad(src, boxQuad({ x: 0, y: 0, w: 9, h: 7 }), 9, 7);
  assert.deepEqual(Array.from(out.data), Array.from(src.data));
  // A sub-box warped onto itself is that sub-box, nothing else.
  const box = { x: 2, y: 1, w: 4, h: 3 };
  const part = warpQuad(src, boxQuad(box), 9, 7, box);
  for (let y = 0; y < 7; y++) {
    for (let x = 0; x < 9; x++) {
      const inBox = x >= 2 && x < 6 && y >= 1 && y < 4;
      assert.deepEqual(at(part, x, y), inBox ? at(src, x, y) : [0, 0, 0, 0]);
    }
  }
});

test('a perspective quad keeps the image inside it and clears outside', () => {
  const src = image(10, 10, () => [200, 50, 10, 255]);
  const quad = [
    [3, 0],
    [7, 0],
    [10, 10],
    [0, 10]
  ];
  const out = warpQuad(src, quad, 10, 10);
  assert.deepEqual(at(out, 5, 0), [200, 50, 10, 255]);
  assert.deepEqual(at(out, 5, 9), [200, 50, 10, 255]);
  assert.equal(at(out, 0, 0)[3], 0);
  assert.equal(at(out, 9, 0)[3], 0);
});

test('Distort moves one corner freely; Perspective mirrors the corner sharing that side', () => {
  const q0 = boxQuad({ x: 0, y: 0, w: 10, h: 10 });
  const start = { x: 10, y: 10 };
  const d = dragQuad(q0, 'distort', { corner: 2 }, start, { x: 13, y: 12 });
  assert.deepEqual(d, [
    [0, 0],
    [10, 0],
    [13, 12],
    [0, 10]
  ]);
  // A mostly horizontal drag of the top-left corner pulls the top-right one the other way.
  const p = dragQuad(q0, 'perspective', { corner: 0 }, { x: 0, y: 0 }, { x: 3, y: 1 });
  assert.deepEqual(p, [
    [3, 0],
    [7, 0],
    [10, 10],
    [0, 10]
  ]);
  // A vertical drag pairs the left side.
  const v = dragQuad(q0, 'perspective', { corner: 0 }, { x: 0, y: 0 }, { x: 1, y: 2 });
  assert.deepEqual(v, [
    [0, 2],
    [10, 0],
    [10, 10],
    [0, 8]
  ]);
});

test('Skew slides an edge along itself and a corner along one of its edges', () => {
  const q0 = boxQuad({ x: 0, y: 0, w: 10, h: 10 });
  const e = dragQuad(q0, 'skewEdgeAlong', { edge: 0 }, { x: 5, y: 0 }, { x: 8, y: 4 });
  assert.deepEqual(e, [
    [3, 0],
    [13, 0],
    [10, 10],
    [0, 10]
  ]);
  const c = dragQuad(q0, 'skewCorner', { corner: 1 }, { x: 10, y: 0 }, { x: 11, y: 4 });
  assert.deepEqual(c, [
    [0, 0],
    [10, 4],
    [10, 10],
    [0, 10]
  ]);
  // ⌘-edge in Free Transform moves the edge freely; ⌥ moves the opposite edge the other way.
  const free = dragQuad(
    q0,
    'skewEdge',
    { edge: 1 },
    { x: 10, y: 5 },
    { x: 12, y: 7 },
    { alt: true }
  );
  assert.deepEqual(free, [
    [-2, -2],
    [12, 2],
    [12, 12],
    [-2, 8]
  ]);
});

test('Distort stops before the box folds over', () => {
  const q0 = boxQuad({ x: 0, y: 0, w: 10, h: 10 });
  const q = dragQuad(q0, 'distort', { corner: 2 }, { x: 10, y: 10 }, { x: -10, y: -10 });
  const turns = q.map((a, k) => {
    const b = q[(k + 1) % 4];
    const c = q[(k + 2) % 4];
    return (b[0] - a[0]) * (c[1] - b[1]) - (b[1] - a[1]) * (c[0] - b[0]);
  });
  assert.ok(turns.every((t) => t > 0));
  assert.deepEqual(keepConvex(q0, q0), q0);
});

test('modes pick the gesture: Ctrl-drag a corner in Free Transform distorts', () => {
  const corner = { corner: 0 };
  const edge = { edge: 1 };
  assert.equal(quadGesture(corner, null, { ctrl: true }), 'distort');
  assert.equal(quadGesture(corner, null, { ctrl: true, alt: true, shift: true }), 'perspective');
  assert.equal(quadGesture(edge, null, { ctrl: true }), 'skewEdge');
  assert.equal(quadGesture(corner, null, {}), 'scale');
  assert.equal(quadGesture('rotate', null, {}), 'rotate');
  assert.equal(quadGesture(corner, 'distort'), 'distort');
  assert.equal(quadGesture(edge, 'distort'), null);
  assert.equal(quadGesture('rotate', 'distort'), null);
  assert.equal(quadGesture(edge, 'skew'), 'skewEdgeAlong');
  assert.equal(quadGesture(corner, 'skew'), 'skewCorner');
  assert.equal(quadGesture('rotate', 'skew'), null);
  assert.equal(quadGesture(corner, 'perspective'), 'perspective');
  assert.equal(quadGesture('move', 'perspective'), 'move');
  assert.ok(QUAD_GESTURES.has('distort') && !QUAD_GESTURES.has('scale'));
});

test('hitQuad finds corners, edge handles, inside, and outside', () => {
  const q = [
    [0, 0],
    [20, 2],
    [18, 20],
    [2, 16]
  ];
  assert.deepEqual(hitQuad(q, 19, 1, 2), { corner: 1 });
  assert.deepEqual(hitQuad(q, 10, 18, 2), { edge: 2 });
  assert.equal(hitQuad(q, 10, 10, 2), 'move');
  assert.equal(hitQuad(q, 30, 30, 2), 'rotate');
});

test('a quad scale keeps the opposite side and presets reorder or turn the corners', () => {
  const q0 = boxQuad({ x: 0, y: 0, w: 10, h: 10 });
  const s = dragQuad(q0, 'scale', { edge: 1 }, { x: 10, y: 5 }, { x: 20, y: 5 });
  assert.ok(near(s.flat(), [0, 0, 20, 0, 20, 10, 0, 10]));
  assert.deepEqual(presetQuad(q0, 'flipHorizontal'), [q0[1], q0[0], q0[3], q0[2]]);
  assert.ok(near(presetQuad(q0, 'rotate180').flat(), [10, 10, 0, 10, 0, 0, 10, 0]));
});

test('Transform Again replays a homography on the layer and the selection', () => {
  const W = 8;
  const H = 8;
  const img = image(W, H, (x, y) => (x < 4 && y < 4 ? [255, 0, 0, 255] : [0, 0, 0, 0]));
  const box = { x: 0, y: 0, w: 4, h: 4 };
  const m = quadHomography(box, boxQuad({ x: 4, y: 4, w: 4, h: 4 }));
  const out = transformLayerPixels(img, null, box, m);
  assert.deepEqual(at(out, 5, 5), [255, 0, 0, 255]);
  assert.equal(at(out, 1, 1)[3], 0);
  const mask = new Uint8Array(W * H);
  for (let p = 0; p < W * H; p++) mask[p] = p % W < 4 && p < 4 * W ? 1 : 0;
  const moved = transformMask(mask, W, H, box, m);
  assert.equal(moved[5 * W + 5], 1);
  assert.equal(moved[1 * W + 1], 0);
});

test('Edit › Transform › Skew / Distort / Perspective open the box in that mode', () => {
  const calls = [];
  const ctx = { freeTransform: (mode) => calls.push(mode) };
  for (const mode of ['skew', 'distort', 'perspective']) {
    const cmd = COMMANDS_BY_ID.get(`edit.transform.${mode}`);
    assert.equal(cmd.label, mode[0].toUpperCase() + mode.slice(1));
    cmd.run(ctx);
  }
  assert.deepEqual(calls, ['skew', 'distort', 'perspective']);
});
