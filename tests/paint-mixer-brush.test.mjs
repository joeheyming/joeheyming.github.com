import test from 'node:test';
import assert from 'node:assert/strict';

import { ICONS } from '../paint/icons.js';
import { historyIconName } from '../paint/history.js';
import {
  PICKUP_RATE,
  mixerBeginStroke,
  mixerClean,
  mixerDab,
  mixerEndStroke,
  mixerLoad,
  mixerState
} from '../paint/retouch.js';
import { TOOLS, TOOL_OPTION_SCHEMA, defaultToolOptions } from '../paint/tools.js';

const RED = [1, 0, 0, 1];
const BLUE = [0, 0, 1, 1];
const GREEN = [0, 1, 0, 1];

// A W × H straight RGBA f32 working copy filled by f(x, y).
function work(W, H, f) {
  const data = new Float32Array(W * H * 4);
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) data.set(f(x, y), (y * W + x) * 4);
  return data;
}

function px(data, W, x, y) {
  const i = (y * W + x) * 4;
  return Array.from(data.slice(i, i + 4));
}

// Dabs every 2 px along y = 10 from x0 to x1 (a quarter of a radius-8 tip).
function stroke(ms, data, W, H, m, x0 = 4, x1 = 196, sample = null, mask = null) {
  for (let x = x0; x <= x1; x += 2) mixerDab(ms, data, sample, W, H, x, 10.5, 8, 1, m, mask);
}

const near = (a, b, eps = 1e-3) =>
  assert.ok(
    a.every((v, i) => Math.abs(v - b[i]) < eps),
    `${a} ≉ ${b}`
  );

test('mixerBrush sits after brush with the palette icon and MixerSettings defaults', () => {
  const ids = Object.keys(TOOLS);
  assert.equal(ids[ids.indexOf('brush') + 1], 'mixerBrush');
  assert.equal(TOOLS.mixerBrush.label, 'Mixer Brush');
  assert.equal(TOOLS.mixerBrush.icon, 'palette');
  assert.ok(ICONS.palette.includes('M12 22a1 1 0 0 1 0-20'));
  assert.equal(historyIconName('Mixer Brush'), 'palette');
  const schema = TOOL_OPTION_SCHEMA.mixerBrush;
  const keys = schema.filter((f) => f.type !== 'hint').map((f) => f.key);
  assert.deepEqual(keys, [
    'size',
    'wet',
    'load',
    'mix',
    'flow',
    'sampleAllLayers',
    'loadAfterStroke',
    'cleanAfterStroke'
  ]);
  for (const key of ['wet', 'load', 'mix', 'flow']) {
    const f = schema.find((s) => s.key === key);
    assert.equal(f.min, 0);
    assert.equal(f.max, 100);
  }
  const d = defaultToolOptions().mixerBrush;
  assert.equal(d.wet, 50);
  assert.equal(d.load, 50);
  assert.equal(d.mix, 50);
  assert.equal(d.flow, 100);
  assert.equal(d.sampleAllLayers, false);
  assert.equal(d.loadAfterStroke, true);
  assert.equal(d.cleanAfterStroke, true);
});

test('load, clean, begin and end stroke follow MixerState', () => {
  const ms = mixerState();
  assert.deepEqual(ms, { reservoir: null, amount: 0, pickup: null, color: null });
  // A brush never loaded takes the stroke colour.
  mixerBeginStroke(ms, BLUE);
  assert.deepEqual([ms.reservoir, ms.amount], [BLUE, 1]);
  // Clean on, Load off: the next stroke in the same colour starts empty.
  mixerEndStroke(ms, BLUE, true, false);
  mixerBeginStroke(ms, BLUE);
  assert.deepEqual([ms.reservoir, ms.pickup, ms.amount], [null, null, 0]);
  // Another colour loads it.
  mixerBeginStroke(ms, GREEN);
  assert.deepEqual([ms.reservoir, ms.amount], [GREEN, 1]);
  // Load on, Clean off: full again and the pickup stays.
  ms.amount = 0.1;
  ms.pickup = BLUE.slice();
  mixerEndStroke(ms, GREEN, false, true);
  assert.deepEqual([ms.reservoir, ms.amount, ms.pickup], [GREEN, 1, BLUE]);
  // Both on: a fresh load with no pickup.
  mixerEndStroke(ms, GREEN, true, true);
  assert.deepEqual([ms.reservoir, ms.amount, ms.pickup], [GREEN, 1, null]);
  mixerClean(ms);
  assert.deepEqual([ms.reservoir, ms.amount, ms.pickup], [null, 0, null]);
});

test('a dry brush (wet 0) deposits only reservoir colour', () => {
  const W = 200,
    H = 20;
  const data = work(W, H, () => BLUE);
  const ms = mixerState();
  mixerLoad(ms, RED);
  stroke(ms, data, W, H, { wet: 0, load: 1, mix: 1, flow: 1 });
  assert.equal(ms.pickup, null);
  near(px(data, W, 100, 10), RED);
  near(px(data, W, 100, 0), BLUE);
});

test('an empty wet brush smears canvas colour and lays down no paint of its own', () => {
  const W = 200,
    H = 20;
  // Blue on the left half, white on the right.
  const data = work(W, H, (x) => (x < 100 ? BLUE : [1, 1, 1, 1]));
  const ms = mixerState();
  stroke(ms, data, W, H, { wet: 1, load: 0.5, mix: 1, flow: 1 });
  const c = px(data, W, 110, 10);
  assert.ok(c[2] > c[1] + 0.05 && c[1] < 0.95, `${c}`);
  assert.equal(c[0], c[1]);
  assert.ok(ms.pickup[2] > 0.2);
  assert.equal(ms.reservoir, null);
});

test('the first dab picks up the canvas colour, later dabs move by PICKUP_RATE × wet', () => {
  const W = 40,
    H = 20;
  const data = work(W, H, () => GREEN);
  const ms = mixerState();
  ms.pickup = [1, 0, 0, 1];
  mixerDab(ms, data, null, W, H, 20, 10.5, 4, 1, { wet: 0.5, load: 1, mix: 0, flow: 1 }, null);
  const k = PICKUP_RATE * 0.5;
  near(ms.pickup, [1 - k, k, 0, 1]);
  // mix 0: the deposit is reservoir only, and there is none, so the canvas is untouched.
  near(px(data, W, 20, 10), GREEN);
});

test('Load 100 % does not drain, lower Load does', () => {
  const W = 200,
    H = 20;
  const run = (load) => {
    const data = work(W, H, () => [0, 0, 0, 0]);
    const ms = mixerState();
    mixerLoad(ms, RED);
    stroke(ms, data, W, H, { wet: 0, load, mix: 0, flow: 1 });
    return { ms, start: px(data, W, 10, 10)[3], end: px(data, W, 190, 10)[3] };
  };
  const full = run(1);
  assert.equal(full.ms.amount, 1);
  assert.ok(full.start > 0.95 && full.end > 0.95);
  const dry = run(0);
  assert.ok(dry.ms.amount < 0.2, `${dry.ms.amount}`);
  assert.ok(dry.end < dry.start * 0.6, `${dry.start} → ${dry.end}`);
});

test('a dry empty brush paints nothing and the mask limits writes', () => {
  const W = 40,
    H = 20;
  const data = work(W, H, () => [0, 0, 0, 0]);
  const ms = mixerState();
  stroke(ms, data, W, H, { wet: 0, load: 0.5, mix: 0.5, flow: 1 }, 4, 36);
  assert.ok(data.every((v) => v === 0));
  mixerLoad(ms, RED);
  const mask = new Uint8Array(W * H);
  for (let y = 0; y < H; y++) for (let x = 0; x < 20; x++) mask[y * W + x] = 1;
  stroke(ms, data, W, H, { wet: 0, load: 1, mix: 0, flow: 1 }, 4, 36, null, mask);
  near(px(data, W, 10, 10), RED);
  near(px(data, W, 30, 10), [0, 0, 0, 0]);
});

test('Sample All Layers picks up from the sample, not the layer', () => {
  const W = 40,
    H = 20;
  const data = work(W, H, () => [0, 0, 0, 0]);
  const sample = work(W, H, () => BLUE);
  const ms = mixerState();
  stroke(ms, data, W, H, { wet: 1, load: 1, mix: 1, flow: 1 }, 10, 30, sample);
  near(ms.pickup, BLUE);
  near(px(data, W, 20, 10), BLUE);
});
