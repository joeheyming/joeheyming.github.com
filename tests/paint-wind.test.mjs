import { test } from 'node:test';
import assert from 'node:assert/strict';
import { applyWind, hash01, ADJUSTMENTS } from '../paint/adjustments.js';

// Non-square on purpose.
const W = 60;
const H = 7;
const LINE = 20;

function image(fn, w = W, h = H) {
  const data = new Uint8ClampedArray(w * h * 4);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) data.set(fn(x, y), (y * w + x) * 4);
  }
  return { width: w, height: h, data };
}

function px(img, x, y) {
  const i = (y * img.width + x) * 4;
  return Array.from(img.data.slice(i, i + 4));
}

function run(fn, method, direction, seed, mask) {
  const img = image(fn);
  applyWind(img, method, direction, seed, mask);
  return img;
}

// One white column on opaque black: the only vertical edges in the image.
const line = (x) => (x === LINE ? [255, 255, 255, 255] : [0, 0, 0, 255]);
const noisy = (x, y) => [
  (x * 37 + y * 11) % 256,
  (x * 13 + y * 53) % 256,
  (x * 71 + y * 29) % 256,
  (x * 5 + y * 17) % 256
];

// The farthest distance downwind from LINE that any row changed.
function reach(img, orig, d) {
  let far = 0;
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      if (px(img, x, y).join() !== px(orig, x, y).join()) far = Math.max(far, (x - LINE) * d);
    }
  }
  return far;
}

test('wind: registry fields and apply dispatch', () => {
  const adj = ADJUSTMENTS.wind;
  assert.equal(adj.label, 'Wind');
  assert.deepEqual(adj.fields, [
    { key: 'method', label: 'Method', min: 0, max: 2, default: 0 },
    { key: 'direction', label: 'Direction', min: 0, max: 1, default: 0 },
    { key: 'seed', label: 'Seed', min: 0, max: 9999, default: 0 }
  ]);
  for (const method of [0, 1, 2]) {
    const a = image(noisy);
    const b = image(noisy);
    adj.apply(a, { method, direction: 1, seed: 7 }, null);
    applyWind(b, method, 1, 7);
    assert.deepEqual(a.data, b.data, `method ${method}`);
  }
});

test('wind: a flat opaque image is unchanged in Wind and Blast', () => {
  const flat = () => [90, 140, 200, 255];
  for (const method of [0, 1]) {
    for (const direction of [0, 1]) {
      const img = run(flat, method, direction, 3);
      assert.deepEqual(img.data, image(flat).data, `method ${method} direction ${direction}`);
    }
  }
});

test('wind: hand-computed Wind pixel downwind of a single vertical edge', () => {
  // From Left (d = +1), seed 5, pixel (LINE + 2, y). Sources s = x - k. The only
  // nonzero edges are at s = LINE (white vs black) and s = LINE + 1 (black vs white).
  const seed = 5;
  let checked = 0;
  for (let y = 0; y < H; y++) {
    const x = LINE + 2;
    let best = 0;
    let bx = x;
    for (let k = 1; k <= 16; k++) {
      const s = x - k;
      const len = Math.max(1, hash01(s, y, 44, seed) ** 2 * 16);
      if (k > len) continue;
      const edge = s === LINE || s === LINE + 1 ? 1 : 0;
      const wgt = edge * (1 - k / (len + 1));
      if (wgt > best) {
        best = wgt;
        bx = s;
      }
    }
    const srcV = bx === LINE ? 255 : 0;
    const v = Math.round(0 + (srcV - 0) * best);
    const img = run(line, 0, 1, seed);
    assert.deepEqual(px(img, x, y), [v, v, v, 255], `row ${y}`);
    if (v > 0) checked++;
  }
  assert.ok(checked > 0, 'at least one row brightens');
});

test('wind: From Left streaks right, From Right streaks left', () => {
  const orig = image(line);
  for (const seed of [0, 1, 2]) {
    const left = run(line, 0, 1, seed);
    const right = run(line, 0, 0, seed);
    let movedRight = false;
    let movedLeft = false;
    for (let y = 0; y < H; y++) {
      for (let x = 0; x < W; x++) {
        if (x <= LINE) assert.deepEqual(px(left, x, y), px(orig, x, y), `left upwind ${x},${y}`);
        if (x >= LINE) assert.deepEqual(px(right, x, y), px(orig, x, y), `right upwind ${x},${y}`);
        if (x > LINE && px(left, x, y)[0] > 0) movedRight = true;
        if (x < LINE && px(right, x, y)[0] > 0) movedLeft = true;
      }
    }
    assert.ok(movedRight, `seed ${seed} From Left`);
    assert.ok(movedLeft, `seed ${seed} From Right`);
  }
});

test('wind: Blast reaches farther than Wind', () => {
  const orig = image(line);
  let blastBeyond = false;
  for (const seed of [0, 1, 2, 3]) {
    const wind = reach(run(line, 0, 1, seed), orig, 1);
    const blast = reach(run(line, 1, 1, seed), orig, 1);
    assert.ok(wind <= 16, `seed ${seed} wind reach ${wind}`);
    assert.ok(blast >= wind, `seed ${seed}`);
    if (blast > 16) blastBeyond = true;
  }
  assert.ok(blastBeyond, 'Blast streaks past the Wind maximum');
});

test('wind: hand-computed Stagger pixels equal the shifted source', () => {
  const orig = image(noisy);
  const seed = 11;
  let shifted = 0;
  let outside = 0;
  for (const direction of [0, 1]) {
    const d = direction === 1 ? 1 : -1;
    const img = run(noisy, 2, direction, seed);
    for (let y = 0; y < H; y++) {
      const segLen = 8 + Math.floor(hash01(0, y, 41, seed) * 32);
      const phase = Math.floor(hash01(1, y, 42, seed) * segLen);
      for (let x = 0; x < W; x++) {
        const seg = Math.floor((x * d + phase) / segLen);
        const shift = Math.floor(hash01(seg, y, 43, seed) ** 2 * 12);
        const sx = x - d * shift;
        const want = sx < 0 || sx >= W ? [0, 0, 0, 0] : px(orig, sx, y);
        assert.deepEqual(px(img, x, y), want, `${direction} ${x},${y}`);
        if (shift > 0) shifted++;
        if (sx < 0 || sx >= W) outside++;
      }
    }
  }
  assert.ok(shifted > 0, 'some pixel shifts');
  assert.ok(outside > 0, 'some pixel reads past the image edge');
});

test('wind: the same seed reproduces and a different seed changes the result', () => {
  for (const method of [0, 1, 2]) {
    const a = run(method === 2 ? noisy : line, method, 1, 42);
    const b = run(method === 2 ? noisy : line, method, 1, 42);
    const c = run(method === 2 ? noisy : line, method, 1, 43);
    assert.deepEqual(a.data, b.data, `method ${method} reproduce`);
    assert.notDeepEqual(a.data, c.data, `method ${method} seed changes`);
  }
});

test('wind: method, direction, and seed round and clamp', () => {
  const same = (a, b, msg) => assert.deepEqual(run(noisy, ...a).data, run(noisy, ...b).data, msg);
  same([2.4, 0, 3], [2, 0, 3], 'method rounds');
  same([1.6, 0, 3], [2, 0, 3], 'method rounds up');
  same([9, 0, 3], [2, 0, 3], 'method clamps high');
  same([-4, 0, 3], [0, 0, 3], 'method clamps low');
  same([0, 0.6, 3], [0, 1, 3], 'direction rounds');
  same([0, 5, 3], [0, 1, 3], 'direction clamps high');
  same([0, -2, 3], [0, 0, 3], 'direction clamps low');
  same([2, 1, 12.4], [2, 1, 12], 'seed rounds');
  same([2, 1, 50000], [2, 1, 9999], 'seed clamps high');
  same([2, 1, -8], [2, 1, 0], 'seed clamps low');
});

test('wind: a mask limits writes but masked-in pixels still read masked-out ones', () => {
  const full = run(line, 0, 1, 5);
  const orig = image(line);
  // Mask out the white column itself; streaks downwind of it must still appear.
  const mask = new Uint8Array(W * H);
  for (let y = 0; y < H; y++) for (let x = LINE + 1; x < W; x++) mask[y * W + x] = 1;
  mask[3 * W + LINE + 2] = 0;
  const img = run(line, 0, 1, 5, mask);
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const want = mask[y * W + x] ? px(full, x, y) : px(orig, x, y);
      assert.deepEqual(px(img, x, y), want, `${x},${y}`);
    }
  }
  assert.notDeepEqual(img.data, orig.data, 'masked-in pixels changed');
});
