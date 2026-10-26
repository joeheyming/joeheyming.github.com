import { test } from 'node:test';
import assert from 'node:assert/strict';
import { applyOffset, ADJUSTMENTS } from '../paint/adjustments.js';

const W = 5;
const H = 3;

// Every pixel distinct in all four channels.
const val = (x, y) => [x * 40 + 1, y * 60 + 2, x * 7 + y * 11 + 3, 200 + x + y * W];

function image(fn = val) {
  const data = new Uint8ClampedArray(W * H * 4);
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) data.set(fn(x, y), (y * W + x) * 4);
  }
  return { width: W, height: H, data };
}

function px(img, x, y) {
  const i = (y * img.width + x) * 4;
  return Array.from(img.data.slice(i, i + 4));
}

const wrap = (v, n) => ((v % n) + n) % n;
const clampTo = (v, n) => Math.max(0, Math.min(n - 1, v));

function expectAll(img, fn, msg) {
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) assert.deepEqual(px(img, x, y), fn(x, y), `${msg} (${x}, ${y})`);
  }
}

test('offset is registered and apply dispatches', () => {
  const def = ADJUSTMENTS.offset;
  assert.equal(def.label, 'Offset');
  assert.deepEqual(
    def.fields.map((f) => [f.key, f.label, f.min, f.max, f.default]),
    [
      ['dx', 'Horizontal', -2000, 2000, 0],
      ['dy', 'Vertical', -2000, 2000, 0],
      ['undefinedAreas', 'Undefined Areas', 0, 2, 0]
    ]
  );
  const img = image();
  def.apply(img, { dx: 1, dy: 0, undefinedAreas: 0 }, null);
  assert.deepEqual(px(img, 1, 0), val(0, 0));
  assert.deepEqual(px(img, 0, 0), val(W - 1, 0));
});

test('dx = dy = 0 is a no-op in every mode', () => {
  for (const mode of [0, 1, 2]) {
    const img = image();
    applyOffset(img, 0, 0, mode);
    assert.deepEqual(img.data, image().data, `mode ${mode}`);
  }
});

test('wrap at (W, H) is identity and negative offsets match a hand-built expectation', () => {
  const img = image();
  applyOffset(img, W, H, 0);
  assert.deepEqual(img.data, image().data);

  const neg = image();
  applyOffset(neg, -2, -1, 0);
  // Output (x, y) reads (x + 2, y + 1) wrapped.
  assert.deepEqual(px(neg, 0, 0), val(2, 1));
  assert.deepEqual(px(neg, 3, 0), val(0, 1));
  assert.deepEqual(px(neg, 4, 2), val(1, 0));
  expectAll(neg, (x, y) => val(wrap(x + 2, W), wrap(y + 1, H)), 'wrap -2,-1');
});

test('wrap is a permutation: offset then -offset restores the image', () => {
  for (const [dx, dy] of [
    [2, 1],
    [-3, 2],
    [7, -4]
  ]) {
    const img = image();
    applyOffset(img, dx, dy, 0);
    assert.notDeepEqual(img.data, image().data);
    applyOffset(img, -dx, -dy, 0);
    assert.deepEqual(img.data, image().data, `${dx}, ${dy}`);
  }
});

test('repeat smears the edge column and row', () => {
  const img = image();
  applyOffset(img, 2, 1, 1);
  expectAll(img, (x, y) => val(clampTo(x - 2, W), clampTo(y - 1, H)), 'repeat 2,1');
  assert.deepEqual(px(img, 0, 0), val(0, 0));
  assert.deepEqual(px(img, 1, 0), val(0, 0));
  assert.deepEqual(px(img, 1, 1), val(0, 0));
  assert.deepEqual(px(img, 4, 2), val(2, 1));

  const left = image();
  applyOffset(left, -1, 0, 1);
  for (let y = 0; y < H; y++) assert.deepEqual(px(left, W - 1, y), val(W - 1, y));
});

test('transparent fills the uncovered strip and shifts the rest', () => {
  const img = image();
  applyOffset(img, 2, -1, 2);
  expectAll(
    img,
    (x, y) => {
      const sx = x - 2;
      const sy = y + 1;
      return sx < 0 || sy >= H ? [0, 0, 0, 0] : val(sx, sy);
    },
    'transparent 2,-1'
  );
  assert.deepEqual(px(img, 1, 0), [0, 0, 0, 0]);
  assert.deepEqual(px(img, 3, 2), [0, 0, 0, 0]);
  assert.deepEqual(px(img, 2, 0), val(0, 1));
});

test('offsets larger than the image work in all three modes', () => {
  const wrapped = image();
  applyOffset(wrapped, 2 * W + 1, -(3 * H + 2), 0);
  expectAll(wrapped, (x, y) => val(wrap(x - 1, W), wrap(y + 2, H)), 'wrap large');

  const repeated = image();
  applyOffset(repeated, 100, -100, 1);
  expectAll(repeated, () => val(0, H - 1), 'repeat large');

  const cleared = image();
  applyOffset(cleared, -100, 50, 2);
  expectAll(cleared, () => [0, 0, 0, 0], 'transparent large');
});

test('dx and dy round and undefinedAreas rounds and clamps to 0..2', () => {
  const a = image();
  applyOffset(a, 1.4, 0.6, 0);
  const b = image();
  applyOffset(b, 1, 1, 0);
  assert.deepEqual(a.data, b.data);

  const hi = image();
  applyOffset(hi, 1, 0, 9);
  const t = image();
  applyOffset(t, 1, 0, 2);
  assert.deepEqual(hi.data, t.data);

  const lo = image();
  applyOffset(lo, 1, 0, -3);
  const w = image();
  applyOffset(w, 1, 0, 0);
  assert.deepEqual(lo.data, w.data);

  const r = image();
  applyOffset(r, 1, 0, 1.2);
  const rr = image();
  applyOffset(rr, 1, 0, 1);
  assert.deepEqual(r.data, rr.data);
});

test('mask limits writes; masked-in pixels still read masked-out sources', () => {
  // Only column 2 is masked in; it reads column 1, which is masked out.
  const mask = new Uint8Array(W * H);
  for (let y = 0; y < H; y++) mask[y * W + 2] = 1;
  const img = image();
  applyOffset(img, 1, 0, 0, mask);
  expectAll(img, (x, y) => (x === 2 ? val(1, y) : val(x, y)), 'masked');

  const tmask = new Uint8Array(W * H);
  tmask[0] = 1;
  const t = image();
  applyOffset(t, 1, 0, 2, tmask);
  expectAll(t, (x, y) => (x === 0 && y === 0 ? [0, 0, 0, 0] : val(x, y)), 'masked transparent');
});
