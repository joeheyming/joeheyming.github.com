import test from 'node:test';
import assert from 'node:assert/strict';

import {
  evalMesh,
  meshFromBox,
  meshWarp,
  meshHit,
  dragMeshPoint,
  meshParamAt,
  pullMesh,
  freeTransformAffine
} from '../paint/transform.js';
import { COMMANDS_BY_ID } from '../paint/commands.js';

function image(W, H, px) {
  const data = new Uint8ClampedArray(W * H * 4);
  for (let p = 0; p < W * H; p++) data.set(px(p % W, Math.floor(p / W)), p * 4);
  return { width: W, height: H, data };
}

const at = (img, x, y) =>
  Array.from(img.data.slice((y * img.width + x) * 4, (y * img.width + x) * 4 + 4));

const close = (a, b, eps = 1e-9) => a.every((v, i) => Math.abs(v - b[i]) <= eps);

test('the identity mesh sits at the thirds of the box and evaluates to the identity', () => {
  const box = { x: 3, y: 5, w: 30, h: 12 };
  const mesh = meshFromBox(box);
  assert.equal(mesh.length, 16);
  assert.deepEqual(mesh[0], [3, 5]);
  assert.deepEqual(mesh[15], [33, 17]);
  assert.ok(close(mesh[5], [13, 9]));
  for (const [s, t] of [
    [0, 0],
    [0.25, 0.7],
    [0.5, 0.5],
    [1, 1]
  ]) {
    assert.ok(close(evalMesh(mesh, s, t), [3 + 30 * s, 5 + 12 * t]));
  }
});

test('an untouched mesh warp reproduces the box exactly and leaves the rest transparent', () => {
  const src = image(24, 20, (x, y) => [x * 10, y * 12, (x * y) % 256, 128 + ((x + y) % 128)]);
  const box = { x: 2, y: 3, w: 17, h: 13 };
  for (const nearest of [false, true]) {
    const out = meshWarp(src, meshFromBox(box), 24, 20, box, nearest);
    for (let y = 0; y < 20; y++) {
      for (let x = 0; x < 24; x++) {
        const inside = x >= box.x && x < box.x + box.w && y >= box.y && y < box.y + box.h;
        assert.deepEqual(at(out, x, y), inside ? at(src, x, y) : [0, 0, 0, 0], `${x},${y}`);
      }
    }
  }
});

test('moving a corner control point moves that corner pixel', () => {
  const box = { x: 0, y: 0, w: 40, h: 40 };
  const red = [255, 0, 0, 255];
  const blue = [0, 0, 255, 255];
  const src = image(64, 64, (x, y) =>
    x === 0 && y === 0 ? red : x < 40 && y < 40 ? blue : [0, 0, 0, 0]
  );
  const mesh = dragMeshPoint(meshFromBox(box), 0, [10, 10]);
  assert.deepEqual(mesh[0], [10, 10]);
  assert.ok(close(evalMesh(mesh, 0, 0), [10, 10]));
  const out = meshWarp(src, mesh, 64, 64, box, true);
  assert.deepEqual(at(out, 10, 10), red);
  assert.deepEqual(at(out, 0, 0), [0, 0, 0, 0]);
  assert.deepEqual(at(out, 9, 9), [0, 0, 0, 0]);
  assert.deepEqual(at(out, 11, 11), blue);
  // The other corners stay where they were.
  assert.deepEqual(at(out, 39, 0), blue);
  assert.deepEqual(at(out, 39, 39), blue);
  assert.deepEqual(at(out, 0, 39), blue);
  // Bilinear sampling lands the red corner there too.
  const [r, , b, a] = at(meshWarp(src, mesh, 64, 64, box), 10, 10);
  assert.ok(r > b && a === 255, `${r} ${b} ${a}`);
});

test('dragging a corner carries its handles and the inner point beside it, nothing else', () => {
  const mesh0 = meshFromBox({ x: 0, y: 0, w: 9, h: 9 });
  const moved = dragMeshPoint(mesh0, 15, [2, -1]);
  const changed = moved.flatMap((p, k) => (close(p, mesh0[k]) ? [] : [k]));
  assert.deepEqual(changed, [10, 11, 14, 15]);
  assert.ok(close(moved[15], [11, 8]));
  // A handle on the top edge carries the point across its line; the inner point bends alone.
  const handle = dragMeshPoint(mesh0, 1, [0, 3]);
  assert.deepEqual(
    handle.flatMap((p, k) => (close(p, mesh0[k]) ? [] : [k])),
    [1, 5]
  );
  const inner = dragMeshPoint(mesh0, 6, [1, 1]);
  assert.deepEqual(
    inner.flatMap((p, k) => (close(p, mesh0[k]) ? [] : [k])),
    [6]
  );
  // The source mesh is not mutated.
  assert.deepEqual(mesh0[15], [9, 9]);
});

test('only the twelve border points are grabbable', () => {
  const mesh = meshFromBox({ x: 0, y: 0, w: 30, h: 30 });
  assert.equal(meshHit(mesh, 0.5, 0.5, 3), 0);
  assert.equal(meshHit(mesh, 10.4, 0, 3), 1);
  assert.equal(meshHit(mesh, 30, 29, 3), 15);
  assert.equal(meshHit(mesh, 10, 10, 3), -1);
  assert.equal(meshHit(mesh, 15, 15, 3), -1);
});

test('a surface pull lands the grabbed point on the pointer and keeps the corners', () => {
  const mesh0 = meshFromBox({ x: 0, y: 0, w: 60, h: 40 });
  const [s, t] = meshParamAt(mesh0, [21, 17]);
  assert.ok(close([s, t], [21 / 60, 17 / 40], 1e-6));
  const pulled = pullMesh(mesh0, s, t, [5, -3]);
  assert.ok(close(evalMesh(pulled, s, t), [26, 14], 1e-6));
  for (const k of [0, 3, 12, 15]) assert.deepEqual(pulled[k], mesh0[k]);
  // Away from the border the border stays put.
  assert.ok(close(evalMesh(pulled, 0.5, 0), [30, 0]));
  // Near the border its handles bend it too.
  const edge = pullMesh(mesh0, 0.5, 0.02, [0, -6]);
  assert.ok(close(evalMesh(edge, 0.5, 0.02), [30, 0.8 - 6], 1e-6));
  assert.ok(evalMesh(edge, 0.5, 0)[1] < 0);
});

test('a box turned first keeps its shape when it becomes a warp', () => {
  const box = { x: 4, y: 4, w: 20, h: 10 };
  const affine = freeTransformAffine(box, { tx: 3, ty: -2, sx: 1.5, sy: 0.5, angle: 0.4 });
  const mesh = meshFromBox(box, affine);
  const [a, b, c, d, e, f] = affine;
  for (const [s, t] of [
    [0, 0],
    [0.3, 0.6],
    [1, 1]
  ]) {
    const x = box.x + box.w * s;
    const y = box.y + box.h * t;
    assert.ok(close(evalMesh(mesh, s, t), [a * x + c * y + e, b * x + d * y + f]));
  }
});

test('Edit › Transform › Warp opens the box in warp mode', () => {
  const cmd = COMMANDS_BY_ID.get('edit.transform.warp');
  assert.equal(cmd.label, 'Warp');
  assert.deepEqual(cmd.menu, ['Edit', 'Transform']);
  let mode;
  cmd.run({ freeTransform: (m) => (mode = m) });
  assert.equal(mode, 'warp');
});
