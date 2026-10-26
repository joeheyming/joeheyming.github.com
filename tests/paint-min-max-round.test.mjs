import { test } from 'node:test';
import assert from 'node:assert/strict';
import { applyMinMax, applyMinMaxRound, ADJUSTMENTS } from '../paint/adjustments.js';

function image(W, H, fill) {
  const data = new Uint8ClampedArray(W * H * 4);
  for (let i = 0; i < data.length; i += 4) data.set(fill, i);
  return { width: W, height: H, data };
}

function clone(img) {
  return { width: img.width, height: img.height, data: img.data.slice() };
}

function px(img, x, y) {
  const i = (y * img.width + x) * 4;
  return Array.from(img.data.slice(i, i + 4));
}

function setPx(img, x, y, rgba) {
  img.data.set(rgba, (y * img.width + x) * 4);
}

// Seeded LCG noise so the comparison is deterministic.
function noisy(W, H) {
  const img = image(W, H, [0, 0, 0, 0]);
  let s = 12345;
  for (let i = 0; i < img.data.length; i++) {
    s = (s * 1103515245 + 12345) >>> 0;
    img.data[i] = s >>> 24;
  }
  return img;
}

// Brute-force disc window dx^2 + dy^2 <= r^2; outside the image reads as 0.
function bruteRound(img, r, max) {
  const { width: W, height: H, data } = img;
  const ri = Math.floor(r);
  const out = clone(img);
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      for (let c = 0; c < 4; c++) {
        let e = max ? -1 : 256;
        for (let dy = -ri; dy <= ri; dy++) {
          for (let dx = -ri; dx <= ri; dx++) {
            if (dx * dx + dy * dy > r * r) continue;
            const sx = x + dx,
              sy = y + dy;
            const v = sx < 0 || sx >= W || sy < 0 || sy >= H ? 0 : data[(sy * W + sx) * 4 + c];
            e = max ? Math.max(e, v) : Math.min(e, v);
          }
        }
        out.data[(y * W + x) * 4 + c] = e;
      }
    }
  }
  return out;
}

const GRAY = [128, 128, 128, 255];
const WHITE = [255, 255, 255, 255];
const BLACK = [0, 0, 0, 255];

test('maximum and minimum have a 0/1 round field after radius', () => {
  for (const id of ['maximum', 'minimum']) {
    const fields = ADJUSTMENTS[id].fields;
    assert.deepEqual(fields[0], { key: 'radius', label: 'Radius', min: 1, max: 100, default: 1 });
    assert.deepEqual(fields[1], {
      key: 'round',
      label: 'Roundness (0 square, 1 round)',
      min: 0,
      max: 1,
      default: 0
    });
  }
});

test('registry apply dispatches on round', () => {
  const src = noisy(20, 14);
  for (const [id, max] of [
    ['maximum', true],
    ['minimum', false]
  ]) {
    const sq = clone(src);
    ADJUSTMENTS[id].apply(sq, { radius: 3, round: 0 }, null);
    const wantSq = clone(src);
    applyMinMax(wantSq, 3, max);
    assert.deepEqual(sq.data, wantSq.data, `${id} square`);
    const rd = clone(src);
    ADJUSTMENTS[id].apply(rd, { radius: 3, round: 1 }, null);
    const wantRd = clone(src);
    applyMinMaxRound(wantRd, 3, max);
    assert.deepEqual(rd.data, wantRd.data, `${id} round`);
    assert.notDeepEqual(rd.data, sq.data);
  }
});

test('radius 0 and 0.5 leave the image unchanged', () => {
  const img = noisy(12, 9);
  const before = img.data.slice();
  for (const r of [0, 0.5]) {
    applyMinMaxRound(img, r, true);
    applyMinMaxRound(img, r, false);
  }
  assert.deepEqual(img.data, before);
});

test('PhotoCraft maximum_roundness_grows_a_point_into_a_disc', () => {
  const src = image(40, 30, BLACK);
  setPx(src, 20, 15, WHITE);
  for (const r of [1, 2, 3.5, 6]) {
    const img = clone(src);
    applyMinMaxRound(img, r, true);
    for (let y = 0; y < 30; y++) {
      for (let x = 0; x < 40; x++) {
        const dx = x - 20,
          dy = y - 15;
        const inDisc = dx * dx + dy * dy <= r * r;
        assert.equal(px(img, x, y)[0] > 127, inDisc, `r ${r} at ${dx},${dy}`);
      }
    }
  }
  const r1 = clone(src);
  applyMinMaxRound(r1, 1, true);
  assert.deepEqual(px(r1, 21, 15), WHITE);
  assert.deepEqual(px(r1, 21, 16), BLACK);
});

test('matches a brute-force disc window at r = 1, 2.5, 5, borders included', () => {
  const src = noisy(23, 17);
  for (const r of [1, 2.5, 5]) {
    for (const max of [true, false]) {
      const got = clone(src);
      applyMinMaxRound(got, r, max);
      assert.deepEqual(got.data, bruteRound(src, r, max).data, `r ${r} max ${max}`);
    }
  }
});

test('radius 20 on 256x256 finishes in under 2 seconds', () => {
  const img = noisy(256, 256);
  const t0 = performance.now();
  applyMinMaxRound(img, 20, true);
  assert.ok(performance.now() - t0 < 2000);
});

test('mask limits writes; masked-out pixels are still sampled', () => {
  const src = image(8, 8, GRAY);
  setPx(src, 3, 3, WHITE);
  const mask = new Uint8Array(64);
  mask[3 * 8 + 4] = 1;
  const img = clone(src);
  applyMinMaxRound(img, 1, true, mask);
  assert.deepEqual(px(img, 4, 3), WHITE);
  for (let p = 0; p < 64; p++) {
    if (p === 3 * 8 + 4) continue;
    const x = p % 8,
      y = (p / 8) | 0;
    assert.deepEqual(px(img, x, y), px(src, x, y));
  }
});
