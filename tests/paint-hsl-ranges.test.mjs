import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { JSDOM } from 'jsdom';

import {
  ADJUSTMENTS,
  HUE_RANGES,
  applyHueSatLight,
  hueRangeWeight,
  rangeLightness
} from '../paint/adjustments.js';
import { defaultAdjustmentParams } from '../paint/adjustment-layers.js';

const html = readFileSync(new URL('../paint/index.html', import.meta.url), 'utf8');

function installDom() {
  const { window } = new JSDOM(html);
  globalThis.document = window.document;
  globalThis.getComputedStyle = window.getComputedStyle.bind(window);
  return window;
}

// A 2 × 2 ImageData-backed context; jsdom has no canvas package.
function fakeCtx() {
  const W = 2,
    H = 2;
  let pixels = new Uint8ClampedArray(W * H * 4).fill(128);
  return {
    canvas: { width: W, height: H },
    getImageData: () => ({ width: W, height: H, data: new Uint8ClampedArray(pixels) }),
    createImageData: (w, h) => ({ width: w, height: h, data: new Uint8ClampedArray(w * h * 4) }),
    putImageData: (img) => {
      pixels = new Uint8ClampedArray(img.data);
    }
  };
}

const { openAdjust, cancelAdjust } = await import('../paint/adjust-modal.js');

const px = (...rgba) => ({ width: rgba.length / 4, height: 1, data: new Uint8ClampedArray(rgba) });
const NAMES = ['Hue', 'Saturation', 'Lightness'];

function apply(img, edits) {
  ADJUSTMENTS.hsl.apply(img, { ...defaultAdjustmentParams('hsl'), ...edits }, null);
  return [...img.data];
}

test('Hue / Saturation has a local Edit select and three rows per range', () => {
  const fields = ADJUSTMENTS.hsl.fields;
  const edit = fields.find((f) => f.key === 'edit');
  assert.equal(edit.type, 'select');
  assert.equal(edit.local, true);
  assert.equal(edit.default, 'master');
  assert.deepEqual(
    edit.options.map((o) => o.value),
    ['master', 'reds', 'yellows', 'greens', 'cyans', 'blues', 'magentas']
  );
  for (const key of ['hue', 'saturation', 'lightness']) {
    assert.deepEqual(fields.find((f) => f.key === key).group, { key: 'edit', value: 'master' });
  }
  for (const range of HUE_RANGES) {
    for (const name of NAMES) {
      const f = fields.find((x) => x.key === range + name);
      assert.ok(f, range + name);
      assert.equal(f.min, name === 'Hue' ? -180 : -100);
      assert.equal(f.max, name === 'Hue' ? 180 : 100);
      assert.equal(f.default, 0);
      assert.deepEqual(f.group, { key: 'edit', value: range });
    }
  }
  const params = defaultAdjustmentParams('hsl');
  assert.equal('edit' in params, false);
  const expected = { hue: 0, saturation: 0, lightness: 0, colorize: false };
  for (const range of HUE_RANGES) for (const name of NAMES) expected[range + name] = 0;
  assert.deepEqual(params, expected);
});

test('hueRangeWeight follows the default PhotoCraft bounds and wraps', () => {
  assert.equal(hueRangeWeight(0, 350), 1);
  assert.equal(hueRangeWeight(0, 30), 0.5);
  assert.equal(hueRangeWeight(1, 120), 0);
  assert.equal(hueRangeWeight(0, 0), 1);
  assert.equal(hueRangeWeight(0, 330), 0.5);
  assert.equal(hueRangeWeight(2, 120), 1);
});

test('rangeLightness matches PhotoCraft range_lightness_matches_photoshop', () => {
  const rows = [
    [[0, 29, 115], 0.5, [57, 71, 115]],
    [[0, 64, 255], 0.5, [125, 157, 255]],
    [[102, 128, 204], 0.5, [152, 165, 204]],
    [[102, 128, 204], -0.5, [102, 115, 154]],
    [[0, 18, 115], -0.5, [0, 9, 58]]
  ];
  for (const [input, l, want] of rows) {
    const got = rangeLightness(
      input.map((v) => v / 255),
      l
    );
    got.forEach((v, i) => assert.ok(Math.abs(v * 255 - want[i]) <= 2.5, `${input} ch ${i}`));
  }
});

test('Reds saturation -100 greys pure red and leaves green and blue alone', () => {
  const out = apply(px(255, 0, 0, 255, 0, 255, 0, 255, 0, 0, 255, 200), { redsSaturation: -100 });
  assert.deepEqual(out.slice(0, 4), [128, 128, 128, 255]);
  assert.deepEqual(out.slice(4), [0, 255, 0, 255, 0, 0, 255, 200]);
});

test('range edits add to the master values and leave greys alone', () => {
  const a = px(255, 0, 0, 255);
  const b = px(255, 0, 0, 255);
  apply(a, { redsHue: 120 });
  apply(b, { hue: 120 });
  assert.deepEqual([...a.data], [...b.data]);
  assert.deepEqual(
    apply(px(90, 90, 90, 255), { redsHue: 60, redsLightness: 50 }),
    [90, 90, 90, 255]
  );
  const before = px(200, 90, 40, 255, 10, 200, 120, 255);
  const after = px(200, 90, 40, 255, 10, 200, 120, 255);
  applyHueSatLight(before, 40, 25, -10, false);
  apply(after, { hue: 40, saturation: 25, lightness: -10 });
  assert.deepEqual([...after.data], [...before.data]);
});

test('Colorize ignores range edits', () => {
  const a = px(200, 90, 40, 255);
  const b = px(200, 90, 40, 255);
  apply(a, { colorize: true, hue: 30, saturation: 50, redsHue: 90, redsSaturation: -100 });
  apply(b, { colorize: true, hue: 30, saturation: 50 });
  assert.deepEqual([...a.data], [...b.data]);
});

test('choosing Reds in the dialog shows the reds rows and hides master', () => {
  const window = installDom();
  const { document } = window;
  openAdjust('hsl', { sel: { mode: 'none' } }, { activeCtx: fakeCtx, pushUndo() {} });
  const rows = [...document.querySelectorAll('#adjust-modal-fields .adjust-field')];
  const visible = () =>
    rows
      .filter((r) => !r.hidden && r.querySelector('input[type="range"]'))
      .map((r) => r.dataset.key);
  assert.deepEqual(visible(), ['hue', 'saturation', 'lightness']);
  const select = rows
    .find((r) => r.querySelector('label').textContent === 'Edit')
    .querySelector('select');
  select.value = 'reds';
  select.dispatchEvent(new window.Event('change'));
  assert.deepEqual(visible(), ['redsHue', 'redsSaturation', 'redsLightness']);
  cancelAdjust();
});
