import { test } from 'node:test';
import assert from 'node:assert/strict';
import { applyZigZag, ADJUSTMENTS } from '../paint/adjustments.js';

// Non-square and odd height: cx = 20, cy = 12.5, rr = min(W, H) / 2 = 12.5, and row 12
// has pixel centres exactly on the horizontal axis through the centre.
const W = 40;
const H = 25;
const CX = W / 2;
const CY = H / 2;
const RR = Math.min(W, H) / 2;

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

// Horizontal ramp: a bilinear sample at source x reads exactly 5 * (sx - 0.5) + 20.
const ramp = (x) => [5 * x + 20, 100, 50, 255];
// Every pixel distinct in every channel, for whole-image checks.
const chart = (x, y) => [x * 6 + 3, y * 10 + 4, (x * 3 + y) % 256, 255 - x * 2 - y * 3];

// The source point for pixel (x, y), computed straight from the PRD formula.
function source(x, y, amount, ridges, style) {
  const a = amount / 100;
  const k = Math.max(ridges, 0.5);
  const dx = x + 0.5 - CX,
    dy = y + 0.5 - CY;
  const r = Math.hypot(dx, dy);
  const rn = r / RR;
  const wave = Math.sin(2 * Math.PI * k * rn) * (1 - rn);
  const [radial, angular] = [
    [0, (a * wave * Math.PI) / (2 * k)],
    [(a * wave * RR) / (4 * k), 0],
    [(a * wave * RR) / (8 * k), (a * wave * Math.PI) / (4 * k)]
  ][style];
  const th = Math.atan2(dy, dx) + angular;
  const rs = Math.max(r + radial, 0);
  return [CX + rs * Math.cos(th), CY + rs * Math.sin(th)];
}

const rampAt = (sx) => Math.round(5 * (sx - 0.5) + 20);

test('zigzag is registered and apply dispatches', () => {
  const def = ADJUSTMENTS.zigZag;
  assert.equal(def.label, 'ZigZag');
  assert.deepEqual(
    def.fields.map((f) => [f.key, f.label, f.min, f.max, f.default]),
    [
      ['amount', 'Amount', -100, 100, 10],
      ['ridges', 'Ridges', 0, 20, 5],
      ['style', 'Style', 0, 2, 2]
    ]
  );
  const src = image(chart);
  for (const style of [0, 1, 2]) {
    const a = image(chart);
    const b = image(chart);
    def.apply(a, { amount: 100, ridges: 3, style }, null);
    applyZigZag(b, 100, 3, style);
    assert.deepEqual(a.data, b.data);
    assert.notDeepEqual(a.data, src.data);
  }
});

test('amount 0 and a flat image are no-ops in every style', () => {
  const src = image(chart);
  const flat = () => image(() => [90, 140, 200, 255]);
  for (const style of [0, 1, 2]) {
    const a = image(chart);
    applyZigZag(a, 0, 5, style);
    assert.deepEqual(a.data, src.data);
    for (const amount of [10, 100, -100]) {
      const f = flat();
      applyZigZag(f, amount, 5, style);
      assert.deepEqual(f.data, flat().data);
    }
  }
});

test('pixels outside the inscribed circle are unchanged', () => {
  const src = image(chart);
  for (const style of [0, 1, 2]) {
    const img = image(chart);
    applyZigZag(img, 100, 3, style);
    let changed = 0;
    for (let y = 0; y < H; y++) {
      for (let x = 0; x < W; x++) {
        const r = Math.hypot(x + 0.5 - CX, y + 0.5 - CY);
        if (r >= RR) assert.deepEqual(px(img, x, y), px(src, x, y), `(${x}, ${y})`);
        else if (px(img, x, y).join() !== px(src, x, y).join()) changed++;
      }
    }
    assert.ok(changed > 0);
    // Corners and the far ends of the long axis stay put.
    assert.deepEqual(px(img, 0, 0), px(src, 0, 0));
    assert.deepEqual(px(img, 39, 12), px(src, 39, 12));
    assert.deepEqual(px(img, 4, 12), px(src, 4, 12));
  }
});

test('hand-computed pixel per style on a ramp', () => {
  // Out From Center on the horizontal axis: only the radius changes.
  // (26, 12): dx = 6.5, dy = 0, r = 6.5, rn = 0.52, k = 3.
  {
    const img = image(ramp);
    applyZigZag(img, 100, 3, 1);
    const rn = 6.5 / RR;
    const wave = Math.sin(2 * Math.PI * 3 * rn) * (1 - rn);
    const sx = CX + 6.5 + (wave * RR) / 12;
    assert.deepEqual(source(26, 12, 100, 3, 1), [sx, CY]);
    assert.deepEqual(px(img, 26, 12), [rampAt(sx), 100, 50, 255]);
    assert.notEqual(rampAt(sx), 5 * 26 + 20);
  }
  // Around Center and Pond Ripples straight below the centre: (19, 17) has
  // dx = -0.5, dy = 5, so rotating the angle moves source x a lot.
  for (const style of [0, 2]) {
    const img = image(ramp);
    applyZigZag(img, 100, 3, style);
    const [sx] = source(19, 17, 100, 3, style);
    assert.deepEqual(px(img, 19, 17), [rampAt(sx), 100, 50, 255]);
    assert.ok(Math.abs(rampAt(sx) - (5 * 19 + 20)) >= 3, `style ${style}`);
  }
});

test('negative amount reverses the direction', () => {
  // Out From Center: the radial push flips sign.
  const pos = image(ramp);
  const neg = image(ramp);
  applyZigZag(pos, 60, 3, 1);
  applyZigZag(neg, -60, 3, 1);
  const [sp] = source(26, 12, 60, 3, 1);
  const [sn] = source(26, 12, -60, 3, 1);
  assert.ok(Math.abs(sp - 26.5 + (sn - 26.5)) < 1e-9);
  assert.equal(px(pos, 26, 12)[0], rampAt(sp));
  assert.equal(px(neg, 26, 12)[0], rampAt(sn));
  const base = 5 * 26 + 20;
  assert.equal(Math.sign(px(pos, 26, 12)[0] - base), -Math.sign(px(neg, 26, 12)[0] - base));
  // Around Center: the twist flips sign.
  const cw = image(ramp);
  const ccw = image(ramp);
  applyZigZag(cw, 100, 3, 0);
  applyZigZag(ccw, -100, 3, 0);
  const b = 5 * 19 + 20;
  assert.equal(Math.sign(px(cw, 19, 17)[0] - b), -Math.sign(px(ccw, 19, 17)[0] - b));
});

test('ridges 0 behaves like 0.5 and ridges clamp to 0..20', () => {
  const run = (ridges) => {
    const img = image(chart);
    applyZigZag(img, 100, ridges, 2);
    return img.data;
  };
  assert.deepEqual(run(0), run(0.5));
  assert.deepEqual(run(-3), run(0.5));
  assert.notDeepEqual(run(0), run(1));
  assert.deepEqual(run(25), run(20));
  const img = image(ramp);
  applyZigZag(img, 100, 0, 1);
  assert.equal(px(img, 26, 12)[0], rampAt(source(26, 12, 100, 0.5, 1)[0]));
});

test('style rounds and clamps to 0..2', () => {
  const run = (style) => {
    const img = image(chart);
    applyZigZag(img, 100, 3, style);
    return img.data;
  };
  const [s0, s1, s2] = [run(0), run(1), run(2)];
  assert.notDeepEqual(s0, s1);
  assert.notDeepEqual(s1, s2);
  assert.notDeepEqual(s0, s2);
  assert.deepEqual(run(-1), s0);
  assert.deepEqual(run(0.4), s0);
  assert.deepEqual(run(1.4), s1);
  assert.deepEqual(run(1.6), s2);
  assert.deepEqual(run(7), s2);
  const def = image(chart);
  applyZigZag(def, 100, 3);
  assert.deepEqual(def.data, s2);
});

test('a mask limits writes; masked-in pixels sample masked-out sources', () => {
  const src = image(chart);
  const full = image(chart);
  applyZigZag(full, 100, 3, 0);
  const mask = new Uint8Array(W * H);
  mask[17 * W + 19] = 1;
  mask[12 * W + 26] = 1;
  const img = image(chart);
  applyZigZag(img, 100, 3, 0, mask);
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const want = mask[y * W + x] ? px(full, x, y) : px(src, x, y);
      assert.deepEqual(px(img, x, y), want, `(${x}, ${y})`);
    }
  }
  assert.notDeepEqual(px(img, 19, 17), px(src, 19, 17));
});
