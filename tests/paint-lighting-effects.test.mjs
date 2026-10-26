import { test } from 'node:test';
import assert from 'node:assert/strict';
import { applyLightingEffects, ADJUSTMENTS } from '../paint/adjustments.js';

const W = 20;
const H = 10;

function flat(fill = [100, 150, 200, 128], w = W, h = H) {
  const data = new Uint8ClampedArray(w * h * 4);
  for (let p = 0; p < w * h; p++) data.set(fill, p * 4);
  return { width: w, height: h, data };
}

function lightOn(params, img = flat(), mask = null) {
  applyLightingEffects(img, params, mask);
  return img;
}

const px = (img, x, y) =>
  Array.from(img.data.slice((y * img.width + x) * 4, (y * img.width + x) * 4 + 4));

test('lighting effects is registered and dispatches its params', () => {
  const adj = ADJUSTMENTS.lightingEffects;
  assert.equal(adj.label, 'Lighting Effects');
  const ranges = Object.fromEntries(adj.fields.map((f) => [f.key, [f.min, f.max, f.default]]));
  assert.deepEqual(ranges, {
    lightType: [0, 2, 0],
    lightX: [-50, 150, 25],
    lightY: [-50, 150, 20],
    lightZ: [0, 1000, 60],
    angle: [-360, 360, 135],
    elevation: [0, 90, 45],
    intensity: [-100, 100, 75],
    cone: [1, 89, 45],
    hotspot: [0, 100, 50],
    gloss: [-100, 100, 0],
    metallic: [-100, 100, 0],
    exposure: [-100, 100, 0],
    ambience: [-100, 100, 8],
    texture: [0, 5, 0],
    height: [0, 100, 50]
  });
  const params = { lightType: 2, intensity: 40, ambience: 20 };
  const a = flat();
  adj.apply(a, params, null);
  assert.deepEqual(a.data, lightOn(params).data);
});

test('hand-checked pixels for spot, point and infinite lights', () => {
  // Independent double-precision reference of render.rs `lighting`.
  assert.deepEqual(px(lightOn({}), 5, 2), [64, 89, 113, 128]);
  assert.deepEqual(
    px(lightOn({ lightType: 1 }, flat([40, 60, 80, 128])), 5, 2),
    [113, 143, 173, 128]
  );
  assert.deepEqual(px(lightOn({ lightType: 2 }), 5, 2), [126, 183, 240, 128]);
  assert.deepEqual(px(lightOn({ cone: 10 }), 9, 5), [130, 189, 248, 128]);
});

test('alpha is unchanged for every light type and texture', () => {
  const src = flat();
  for (let p = 0; p < W * H; p++) src.data[p * 4 + 3] = (p * 37) % 256;
  for (const lightType of [0, 1, 2]) {
    for (const texture of [0, 4, 5]) {
      const img = { width: W, height: H, data: new Uint8ClampedArray(src.data) };
      lightOn({ lightType, texture }, img);
      for (let p = 0; p < W * H; p++) assert.equal(img.data[p * 4 + 3], src.data[p * 4 + 3]);
    }
  }
});

test('intensity 0 with ambience 0 gives black RGB', () => {
  for (const lightType of [0, 1, 2]) {
    const img = lightOn({ lightType, intensity: 0, ambience: 0 });
    for (let p = 0; p < W * H; p++) {
      assert.deepEqual(Array.from(img.data.slice(p * 4, p * 4 + 4)), [0, 0, 0, 128]);
    }
  }
});

test('exposure 100 brightens a lit pixel more than exposure 0', () => {
  const lo = px(lightOn({ intensity: 20 }), 9, 5);
  const hi = px(lightOn({ intensity: 20, exposure: 100 }), 9, 5);
  assert.deepEqual(lo, [38, 55, 72, 128]);
  assert.deepEqual(hi, [151, 219, 255, 128]);
});

test('a pixel outside the spot cone gets only ambient light', () => {
  // ambient = 8 / 100 * 0.5 = 0.04, so [100, 150, 200] -> [4, 6, 8].
  assert.deepEqual(px(lightOn({ cone: 10 }), 0, 9), [4, 6, 8, 128]);
  assert.deepEqual(px(lightOn({ cone: 10, intensity: -100 }), 0, 9), [4, 6, 8, 128]);
});

test('a point light falls off with distance', () => {
  const img = lightOn({ lightType: 1 }, flat([40, 60, 80, 255]));
  const lum = (x, y) =>
    px(img, x, y)
      .slice(0, 3)
      .reduce((a, b) => a + b, 0);
  assert.ok(lum(5, 2) > lum(7, 3));
  assert.ok(lum(7, 3) > lum(10, 5));
  assert.deepEqual(px(img, 10, 5), [3, 5, 6, 255]);
  // Beyond reach = 0.8 * short = 8 only ambient remains.
  assert.deepEqual(px(img, 15, 8), [2, 2, 3, 255]);
});

test('a luminance texture bumps an edge; height 0 matches None', () => {
  const edge = () => {
    const img = flat([60, 60, 60, 255]);
    for (let y = 0; y < H; y++) {
      for (let x = 10; x < W; x++) img.data.set([200, 200, 200, 255], (y * W + x) * 4);
    }
    return img;
  };
  const none = lightOn({ lightType: 2 }, edge());
  const bumped = lightOn({ lightType: 2, texture: 5, height: 100 }, edge());
  const flatH = lightOn({ lightType: 2, texture: 5, height: 0 }, edge());
  assert.deepEqual(flatH.data, none.data);
  assert.notDeepEqual(px(bumped, 9, 5), px(none, 9, 5));
  assert.notDeepEqual(px(bumped, 10, 5), px(none, 10, 5));
  // Away from the edge the height field is flat, so the normal is unchanged.
  assert.deepEqual(px(bumped, 3, 5), px(none, 3, 5));
  assert.deepEqual(px(bumped, 16, 5), px(none, 16, 5));
});

test('parameters clamp and round', () => {
  const same = (a, b) => assert.deepEqual(lightOn(a).data, lightOn(b).data);
  same({ lightType: 7 }, { lightType: 2 });
  same({ lightType: 0.6 }, { lightType: 1 });
  same({ lightType: -3 }, { lightType: 0 });
  same({ texture: 9, height: 80 }, { texture: 5, height: 80 });
  same({ texture: 2.6, height: 80 }, { texture: 3, height: 80 });
  same({ lightX: 400, lightY: -400 }, { lightX: 150, lightY: -50 });
  same({ lightZ: 5000 }, { lightZ: 1000 });
  same({ intensity: 500, ambience: -500 }, { intensity: 100, ambience: -100 });
  same({ cone: 0, hotspot: 200 }, { cone: 1, hotspot: 100 });
  same(
    { gloss: 300, metallic: -300, exposure: 300 },
    { gloss: 100, metallic: -100, exposure: 100 }
  );
  same({ lightType: 2, elevation: 120, angle: 999 }, { lightType: 2, elevation: 90, angle: 360 });
  same({ texture: 5, height: 150 }, { texture: 5, height: 100 });
  same({ intensity: 'x' }, {});
});

test('the mask limits writes', () => {
  const mask = new Uint8Array(W * H);
  mask[2 * W + 5] = 1;
  const img = lightOn({}, flat(), mask);
  assert.deepEqual(px(img, 5, 2), [64, 89, 113, 128]);
  for (let p = 0; p < W * H; p++) {
    if (p === 2 * W + 5) continue;
    assert.deepEqual(Array.from(img.data.slice(p * 4, p * 4 + 4)), [100, 150, 200, 128]);
  }
});
