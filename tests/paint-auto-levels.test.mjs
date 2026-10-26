import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { JSDOM } from 'jsdom';
import { buildMenuBar } from '../paint/menu-bar.js';
import { COMMANDS } from '../paint/commands.js';
import {
  applyLevelsChannels,
  autoClipPoints,
  autoLevelsParams,
  levelsHistograms,
  levelsMedian
} from '../paint/adjustments.js';
import { defaultAdjustmentParams } from '../paint/adjustment-layers.js';
import { historyIconName } from '../paint/history.js';

// PhotoCraft's 64-wide grey ramp: v = 0.3 + 0.4x/63, RGB (v, 0.9v, 0.8v), 64 rows.
function ramp() {
  const W = 64,
    H = 64;
  const data = new Uint8ClampedArray(W * H * 4);
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const v = 0.3 + (0.4 * x) / 63;
      const i = (y * W + x) * 4;
      data[i] = Math.round(v * 255);
      data[i + 1] = Math.round(v * 0.9 * 255);
      data[i + 2] = Math.round(v * 0.8 * 255);
      data[i + 3] = 255;
    }
  }
  return { width: W, height: H, data };
}

test('auto tone, contrast, and color stretch a low-contrast layer', () => {
  for (const kind of ['tone', 'contrast', 'color']) {
    const img = ramp();
    applyLevelsChannels(img, autoLevelsParams(img, kind), null);
    const a = img.data.slice(0, 4);
    const b = img.data.slice(63 * 4, 63 * 4 + 4);
    // Auto Contrast keeps colour (shared points): only the extreme channels reach 0 and 1.
    const [lo, hi] = kind === 'contrast' ? [a[2], b[0]] : [a[0], b[0]];
    assert.ok(lo / 255 < 0.05 && hi / 255 > 0.95, `${kind}: ${[...a]} ${[...b]}`);
  }
});

test('clip points edge cases', () => {
  assert.deepEqual(autoClipPoints(new Array(256).fill(0)), [0, 255]);
  // Everything at level 0: hi stops one above lo.
  const zeros = new Array(256).fill(0);
  zeros[0] = 1000;
  assert.deepEqual(autoClipPoints(zeros), [0, 1]);
  // Everything at level 255: lo stops at 254.
  const top = new Array(256).fill(0);
  top[255] = 1000;
  assert.deepEqual(autoClipPoints(top), [254, 255]);
  const mid = new Array(256).fill(0);
  mid[100] = 1000;
  assert.deepEqual(autoClipPoints(mid), [100, 101]);
  // 0.1% of 10000 is 10: one tail bin of 10 is clipped at each end, a second one is not.
  const h = new Array(256).fill(0);
  h[5] = 10;
  h[50] = 9970;
  h[250] = 10;
  h[251] = 10;
  assert.deepEqual(autoClipPoints(h), [50, 250]);
});

test('median is the first level reaching half the count', () => {
  const h = new Array(256).fill(0);
  h[10] = 2;
  h[20] = 2;
  assert.equal(levelsMedian(h), 10);
  h[30] = 1;
  assert.equal(levelsMedian(h), 20);
});

test('auto contrast gives all channels the summed histogram points', () => {
  const p = autoLevelsParams(ramp(), 'contrast');
  assert.equal(p.redBlack, p.greenBlack);
  assert.equal(p.redBlack, p.blueBlack);
  assert.equal(p.redWhite, p.blueWhite);
  assert.ok(p.blueBlack <= Math.round(0.3 * 0.8 * 255) + 1);
  assert.ok(p.redWhite >= Math.round(0.7 * 255) - 1);
  assert.equal(p.redGamma, 1);
  const tone = autoLevelsParams(ramp(), 'tone');
  assert.ok(tone.redBlack > tone.blueBlack);
});

test('auto params keep an identity RGB master and the levels key shape', () => {
  for (const kind of ['tone', 'contrast', 'color']) {
    const p = autoLevelsParams(ramp(), kind);
    assert.deepEqual(Object.keys(p).sort(), Object.keys(defaultAdjustmentParams('levels')).sort());
    assert.equal(p.black, 0);
    assert.equal(p.white, 255);
    assert.equal(p.gamma, 1);
    assert.equal(p.outBlack, 0);
    assert.equal(p.outWhite, 255);
  }
});

test('auto color sets per-channel gamma toward the mean median', () => {
  const p = autoLevelsParams(ramp(), 'color');
  for (const ch of ['red', 'green', 'blue']) {
    assert.ok(p[ch + 'Gamma'] >= 0.1 && p[ch + 'Gamma'] <= 9.99);
  }
  // A colour cast: red median low in its range, so red's gamma brightens (> 1) or the others dim.
  const W = 10,
    data = new Uint8ClampedArray(W * 4);
  for (let x = 0; x < W; x++) {
    data.set([x < 7 ? 20 : 240, 20 + x * 22, 20 + x * 22, 255], x * 4);
  }
  const cast = autoLevelsParams({ width: W, height: 1, data }, 'color');
  assert.ok(cast.redGamma > 1, `red gamma ${cast.redGamma}`);
});

test('empty histogram gives identity params', () => {
  const img = { width: 2, height: 1, data: new Uint8ClampedArray([9, 9, 9, 0, 200, 200, 200, 0]) };
  for (const kind of ['tone', 'contrast', 'color']) {
    assert.deepEqual(autoLevelsParams(img, kind), defaultAdjustmentParams('levels'));
  }
});

test('histograms skip alpha 0 and masked-out pixels', () => {
  const data = new Uint8ClampedArray([
    10, 20, 30, 255, 40, 50, 60, 1, 70, 80, 90, 0, 100, 110, 120, 255
  ]);
  const img = { width: 4, height: 1, data };
  const h = levelsHistograms(img);
  assert.equal(h[0][10] + h[0][40] + h[0][100], 3);
  assert.equal(h[0][70], 0);
  const hm = levelsHistograms(img, new Uint8Array([1, 0, 1, 0]));
  assert.equal(hm[0][10], 1);
  assert.equal(hm[0][40], 0);
  assert.equal(hm[0][100], 0);
  assert.equal(
    hm[1].reduce((a, v) => a + v, 0),
    1
  );
  // Only the selected pixel's points are used, and applying leaves the rest alone.
  const W = 64,
    big = ramp();
  const mask = new Uint8Array(W * 64);
  for (let i = 0; i < W * 64; i++) mask[i] = i % W < 32 ? 1 : 0;
  const p = autoLevelsParams(big, 'tone', mask);
  assert.ok(p.redWhite < Math.round(0.5 * 255) + 2);
  const before = big.data.slice(63 * 4, 63 * 4 + 4);
  applyLevelsChannels(big, p, mask);
  assert.deepEqual(big.data.slice(63 * 4, 63 * 4 + 4), before);
  assert.ok(big.data[0] < 13);
});

test('image menu has auto tone, auto contrast, and auto color', () => {
  const html = readFileSync(new URL('../paint/index.html', import.meta.url), 'utf8');
  const { document } = new JSDOM(html).window;
  buildMenuBar(document.getElementById('menu-bar'), COMMANDS, { mac: false });
  const list = document.getElementById('image-menu-list');
  for (const [id, label] of [
    ['btn-auto-tone', 'Auto Tone'],
    ['btn-auto-contrast', 'Auto Contrast'],
    ['btn-auto-color', 'Auto Color']
  ]) {
    const el = list.querySelector('#' + id);
    assert.ok(el, id);
    assert.equal(el.querySelector('.menu-label').textContent, label);
    assert.equal(historyIconName(label), 'sliders-horizontal');
  }
});
