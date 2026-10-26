import test from 'node:test';
import assert from 'node:assert/strict';

import { TOOLS, TOOL_OPTION_SCHEMA, defaultToolOptions } from '../paint/tools.js';

const W = 7;
const H = 3;
const WHITE = [255, 255, 255, 255];
const BLACK = [0, 0, 0, 255];
const RED = [255, 0, 0, 255];

// Two white regions split by a black column at x = 3.
function makeCtx() {
  const data = new Uint8ClampedArray(W * H * 4);
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) data.set(x === 3 ? BLACK : WHITE, (y * W + x) * 4);
  }
  const ctx = {
    canvas: { width: W, height: H },
    data,
    puts: 0,
    getImageData: () => ({ data, width: W, height: H }),
    putImageData() {
      ctx.puts++;
    }
  };
  return ctx;
}

const px = (ctx, x, y) => Array.from(ctx.data.slice((y * W + x) * 4, (y * W + x) * 4 + 4));

test('fill schema has a Contiguous checkbox, default on', () => {
  const opt = TOOL_OPTION_SCHEMA.fill.find((o) => o.key === 'contiguous');
  assert.ok(opt);
  assert.equal(opt.type, 'checkbox');
  assert.equal(opt.label, 'Contiguous');
  assert.equal(opt.default, true);
  assert.equal(defaultToolOptions().fill.contiguous, true);
});

test('fill options carry no hint text', () => {
  assert.ok(!TOOL_OPTION_SCHEMA.fill.some((o) => o.type === 'hint'));
});

function runFill(contiguous, shiftKey) {
  const ctx = makeCtx();
  const toolOptions = { fill: { tolerance: 0 } };
  if (contiguous !== undefined) toolOptions.fill.contiguous = contiguous;
  const state = { activeColor: '#ff0000', shiftKey, toolOptions };
  TOOLS.fill.onDown(ctx, null, state, 0, 0);
  return ctx;
}

test('contiguous fill paints only the connected region; non-contiguous every match', () => {
  const ctx = runFill(true, false);
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < 3; x++) assert.deepEqual(px(ctx, x, y), RED);
    assert.deepEqual(px(ctx, 3, y), BLACK);
    for (let x = 4; x < W; x++) assert.deepEqual(px(ctx, x, y), WHITE);
  }
  const all = runFill(false, false);
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) assert.deepEqual(px(all, x, y), x === 3 ? BLACK : RED);
  }
});

test('the fill tool follows the Contiguous option and ignores Shift', () => {
  for (const shiftKey of [false, true]) {
    assert.deepEqual(px(runFill(undefined, shiftKey), 5, 1), WHITE);
    assert.deepEqual(px(runFill(true, shiftKey), 5, 1), WHITE);
    assert.deepEqual(px(runFill(false, shiftKey), 5, 1), RED);
  }
});
