import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  applyRelight,
  gaussBoxRadii,
  relightSigma,
  relightStep,
  ADJUSTMENTS
} from '../paint/adjustments.js';

const W = 40;
const H = 20;

function flat(fill = [100, 150, 200, 255], w = W, h = H) {
  const data = new Uint8ClampedArray(w * h * 4);
  for (let p = 0; p < w * h; p++) data.set(fill, p * 4);
  return { width: w, height: h, data };
}

// A ridge: grey rises from x = 0 to the centre and falls again.
function ridge(w = W, h = H) {
  const img = flat([0, 0, 0, 255], w, h);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const v = Math.round(40 + 160 * (1 - Math.abs(x + 0.5 - w / 2) / (w / 2)));
      img.data.set([v, v, v, 255], (y * w + x) * 4);
    }
  }
  return img;
}

function relight(params, img = flat(), mask = null) {
  applyRelight(img, params, mask);
  return img;
}

const px = (img, x, y) =>
  Array.from(img.data.slice((y * img.width + x) * 4, (y * img.width + x) * 4 + 4));

test('relight is registered and dispatches its params', () => {
  const adj = ADJUSTMENTS.relight;
  assert.equal(adj.label, 'Relight');
  const ranges = Object.fromEntries(adj.fields.map((f) => [f.key, [f.min, f.max, f.default]]));
  assert.deepEqual(ranges, {
    angle: [-180, 180, 45],
    elevation: [0, 90, 40],
    intensity: [0, 100, 40],
    ambient: [0, 100, 55],
    warmth: [-100, 100, 0],
    softness: [1, 100, 25]
  });
  const params = { angle: 10, elevation: 30, intensity: 70, ambient: 40, warmth: 20, softness: 9 };
  const a = ridge();
  const b = ridge();
  adj.apply(a, params, null);
  applyRelight(b, params, null);
  assert.deepEqual(a.data, b.data);
  assert.notDeepEqual(a.data, ridge().data);
});

test('intensity 0 leaves the image unchanged', () => {
  const img = ridge();
  assert.deepEqual(relight({ intensity: 0, ambient: 0, warmth: 100 }, img).data, ridge().data);
  const neg = ridge();
  assert.deepEqual(relight({ intensity: -20 }, neg).data, ridge().data);
});

test('a flat image has normal (0, 0, 1) and a hand-checked pixel', () => {
  const img = relight({});
  // shade = 0.55 + 0.4 * sin(40 deg); colour / Rec.709 luma of [100, 150, 200].
  const luma = (0.2126 * 100 + 0.7152 * 150 + 0.0722 * 200) / 255;
  const shade = 0.55 + 0.4 * Math.sin((40 * Math.PI) / 180);
  const expect = [100, 150, 200].map((v) =>
    Math.round(Math.min(1, ((v / 255) * shade) / luma) * 255)
  );
  assert.deepEqual(expect, [144, 216, 255]);
  for (const [x, y] of [
    [0, 0],
    [17, 9],
    [39, 19]
  ]) {
    assert.deepEqual(px(img, x, y), [...expect, 255]);
  }
  // Every angle lights a flat image the same way.
  assert.deepEqual(relight({ angle: -120 }).data, img.data);
});

test('lighting from angle 0 versus 180 brightens opposite sides of a ridge', () => {
  const right = relight({ angle: 0, elevation: 20, intensity: 100 }, ridge());
  const left = relight({ angle: 180, elevation: 20, intensity: 100 }, ridge());
  const lum = (img, x) => px(img, x, 10)[0];
  // The left slope faces left (towards angle 180), the right slope faces right.
  assert.ok(lum(left, 8) > lum(right, 8));
  assert.ok(lum(right, 31) > lum(left, 31));
  // The ridge is symmetric, so the two lamps mirror each other.
  for (let x = 0; x < W; x++) assert.equal(lum(left, x), lum(right, W - 1 - x));
});

test('positive warmth raises red over blue on a neutral grey', () => {
  const warm = relight({ warmth: 100 }, flat([128, 128, 128, 255]));
  const [r, g, b] = px(warm, 5, 5);
  assert.ok(r > g && g > b);
  const neutral = px(relight({}, flat([128, 128, 128, 255])), 5, 5);
  assert.equal(neutral[0], neutral[2]);
  const cool = px(relight({ warmth: -100 }, flat([128, 128, 128, 255])), 5, 5);
  assert.ok(cool[2] > cool[0]);
});

test('alpha is kept and alpha-0 pixels are untouched', () => {
  const img = ridge();
  for (let p = 0; p < W * H; p++) img.data[p * 4 + 3] = 50 + (p % 200);
  const hole = (3 * W + 12) * 4;
  img.data.set([10, 20, 30, 0], hole);
  const alphas = Array.from(img.data.filter((_, i) => i % 4 === 3));
  relight({ angle: 30, intensity: 90 }, img);
  assert.deepEqual(Array.from(img.data.filter((_, i) => i % 4 === 3)), alphas);
  assert.deepEqual(Array.from(img.data.slice(hole, hole + 4)), [10, 20, 30, 0]);
  // A hole in a flat image is held out of the shading, so its neighbours stay flat.
  const f = flat();
  f.data.set([0, 0, 0, 0], (5 * W + 5) * 4);
  relight({}, f);
  assert.deepEqual(px(f, 6, 5), [144, 216, 255, 255]);
  assert.deepEqual(px(f, 5, 5), [0, 0, 0, 0]);
});

test('sigma and step clamp on small and large canvases', () => {
  assert.equal(relightSigma(25, 40, 20), 2);
  assert.equal(relightStep(relightSigma(25, 40, 20)), 2);
  assert.equal(relightSigma(100, 8000, 6000), 96);
  assert.equal(relightStep(96), 32);
  assert.equal(relightSigma(50, 1000, 500), 20);
  assert.equal(relightStep(20), 20);
  assert.equal(relightSigma(0, 1000, 500), 2);
  assert.equal(relightSigma(10, 0, 0), 2);
  assert.equal(relightStep(Math.fround(2.4)), 2);
  assert.equal(relightStep(Math.fround(2.6)), 3);
  // Three-box radii (Kovesi) for the engine's sigma range.
  assert.deepEqual(gaussBoxRadii(2), [1, 1, 2]);
  assert.deepEqual(gaussBoxRadii(20), [19, 19, 20]);
  assert.deepEqual(gaussBoxRadii(0.4), [1, 0, 0]);
});

test('parameters clamp to the engine ranges', () => {
  const run = (params) => relight(params, ridge()).data;
  assert.deepEqual(run({ angle: 400 }), run({ angle: 180 }));
  assert.deepEqual(run({ elevation: -10 }), run({ elevation: 0 }));
  assert.deepEqual(run({ intensity: 500 }), run({ intensity: 100 }));
  assert.deepEqual(run({ ambient: 300 }), run({ ambient: 100 }));
  assert.deepEqual(run({ warmth: -900 }), run({ warmth: -100 }));
  assert.deepEqual(run({ softness: 0 }), run({ softness: 1 }));
  assert.deepEqual(run({ angle: 'x', softness: null }), run({}));
});

test('the mask limits writes', () => {
  const mask = new Uint8Array(W * H);
  for (let x = 0; x < W / 2; x++) mask[10 * W + x] = 1;
  const full = relight({ angle: 0, intensity: 100 }, ridge());
  const masked = relight({ angle: 0, intensity: 100 }, ridge(), mask);
  const orig = ridge();
  for (let p = 0; p < W * H; p++) {
    const want = mask[p] ? full : orig;
    assert.deepEqual(
      Array.from(masked.data.slice(p * 4, p * 4 + 4)),
      Array.from(want.data.slice(p * 4, p * 4 + 4))
    );
  }
});
