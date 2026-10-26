import { test } from 'node:test';
import assert from 'node:assert/strict';
import { applyDeInterlace, ADJUSTMENTS } from '../paint/adjustments.js';

const W = 4;
const H = 5;

// Every pixel distinct and opaque.
const val = (x, y) => [x * 40 + 10, y * 50 + 5, x * 7 + y * 13 + 3, 255];

function image(fn = val, w = W, h = H) {
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

function row(img, y) {
  const out = [];
  for (let x = 0; x < img.width; x++) out.push(px(img, x, y));
  return out;
}

const avg = (y1, y2) => (x) => {
  const a = val(x, y1);
  const b = val(x, y2);
  return [0, 1, 2].map((c) => Math.round((a[c] + b[c]) / 2)).concat(255);
};
const rowOf = (fn, w = W) => Array.from({ length: w }, (_, x) => fn(x));

test('deInterlace is registered and apply dispatches', () => {
  const def = ADJUSTMENTS.deInterlace;
  assert.equal(def.label, 'De-Interlace');
  assert.deepEqual(
    def.fields.map((f) => [f.key, f.label, f.min, f.max, f.default]),
    [
      ['eliminate', 'Eliminate', 0, 1, 0],
      ['createBy', 'Create By', 0, 1, 1]
    ]
  );
  const a = image();
  const b = image();
  def.apply(a, { eliminate: 1, createBy: 0 }, null);
  applyDeInterlace(b, 1, 0, null);
  assert.deepEqual(a.data, b.data);
  assert.notDeepEqual(a.data, image().data);
});

test('odd-field interpolation rebuilds rows 0, 2, 4 and keeps 1, 3', () => {
  const img = image();
  applyDeInterlace(img, 0, 1);
  // Hand-computed row 2 at x = 1: avg of (50, 55, 23) and (50, 155, 49).
  assert.deepEqual(px(img, 1, 2), [50, 105, 36, 255]);
  assert.deepEqual(row(img, 2), rowOf(avg(1, 3)));
  // Top row has no row above: copies the row below.
  assert.deepEqual(
    row(img, 0),
    rowOf((x) => val(x, 1))
  );
  // Bottom row 4 has no row below: copies the row above.
  assert.deepEqual(
    row(img, 4),
    rowOf((x) => val(x, 3))
  );
  assert.deepEqual(
    row(img, 1),
    rowOf((x) => val(x, 1))
  );
  assert.deepEqual(
    row(img, 3),
    rowOf((x) => val(x, 3))
  );
});

test('duplication copies the row above', () => {
  const img = image();
  applyDeInterlace(img, 0, 0);
  assert.deepEqual(
    row(img, 0),
    rowOf((x) => val(x, 1))
  );
  assert.deepEqual(
    row(img, 2),
    rowOf((x) => val(x, 1))
  );
  assert.deepEqual(
    row(img, 4),
    rowOf((x) => val(x, 3))
  );
  assert.deepEqual(
    row(img, 1),
    rowOf((x) => val(x, 1))
  );
});

test('even-field elimination leaves odd lines untouched', () => {
  const img = image();
  applyDeInterlace(img, 1, 1);
  for (const y of [0, 2, 4])
    assert.deepEqual(
      row(img, y),
      rowOf((x) => val(x, y))
    );
  assert.deepEqual(row(img, 1), rowOf(avg(0, 2)));
  assert.deepEqual(row(img, 3), rowOf(avg(2, 4)));

  // Even height: the last row (line 4, even) has no row below.
  const tall = image(val, W, 4);
  applyDeInterlace(tall, 1, 1);
  assert.deepEqual(
    row(tall, 3),
    rowOf((x) => val(x, 2))
  );
});

test('interpolation averages premultiplied colour and alpha', () => {
  const img = image(
    (x, y) => {
      if (y === 0) return [200, 100, 0, 255];
      if (y === 2) return x === 0 ? [0, 0, 200, 128] : [9, 9, 9, 0];
      return [50, 50, 50, 255];
    },
    2,
    3
  );
  applyDeInterlace(img, 1, 1);
  // x = 0: (200 * 255 + 0 * 128) / 383 = 133.16, (100 * 255) / 383 = 66.58,
  // (200 * 128) / 383 = 66.84, alpha (255 + 128) / 2 = 191.5.
  assert.deepEqual(px(img, 0, 1), [133, 67, 67, 192]);
  // x = 1: the transparent neighbour adds nothing to colour, halves alpha.
  assert.deepEqual(px(img, 1, 1), [200, 100, 0, 128]);

  const clear = image((x, y) => (y === 1 ? [70, 70, 70, 255] : [80, 90, 100, 0]), 2, 3);
  applyDeInterlace(clear, 1, 1);
  assert.deepEqual(px(clear, 0, 1), [0, 0, 0, 0]);
});

test('a one-row image is unchanged', () => {
  for (const [e, c] of [
    [0, 0],
    [0, 1],
    [1, 0],
    [1, 1]
  ]) {
    const img = image(val, 6, 1);
    applyDeInterlace(img, e, c);
    assert.deepEqual(img.data, image(val, 6, 1).data);
  }
});

test('eliminate and createBy round and clamp', () => {
  const ref = (e, c) => {
    const img = image();
    applyDeInterlace(img, e, c);
    return img.data;
  };
  assert.deepEqual(ref(0.6, 0.4), ref(1, 0));
  assert.deepEqual(ref(-3, 9), ref(0, 1));
  assert.deepEqual(ref(7, -2), ref(1, 0));
  assert.deepEqual(ref(0.4, 0.6), ref(0, 1));
  assert.notDeepEqual(ref(0, 0), ref(0, 1));
});

test('mask limits writes', () => {
  const img = image();
  const mask = new Uint8Array(W * H);
  mask[2 * W + 1] = 1;
  mask[0 * W + 3] = 1;
  applyDeInterlace(img, 0, 1, mask);
  const full = image();
  applyDeInterlace(full, 0, 1);
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const want = mask[y * W + x] ? px(full, x, y) : val(x, y);
      assert.deepEqual(px(img, x, y), want, `(${x}, ${y})`);
    }
  }
});
