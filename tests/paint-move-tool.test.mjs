import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { TOOLS, TOOL_OPTION_SCHEMA, offsetLayerPixels } from '../paint/tools.js';
import * as objects from '../paint/objects.js';

const paintSrc = readFileSync(new URL('../paint/paint.js', import.meta.url), 'utf8');
const pointerSrc = readFileSync(new URL('../paint/pointer.js', import.meta.url), 'utf8');

// 3x2 image where pixel p has RGBA (p+1, 10*(p+1), 100+p, 255)
function sample(W = 3, H = 2) {
  const d = new Uint8ClampedArray(W * H * 4);
  for (let p = 0; p < W * H; p++) d.set([p + 1, 10 * (p + 1), 100 + p, 255], p * 4);
  return d;
}

function px(d, W, x, y) {
  return Array.from(d.subarray((y * W + x) * 4, (y * W + x) * 4 + 4));
}

test('the arrow tool keeps id select and is labeled Move', () => {
  assert.equal(TOOLS.select.label, 'Move');
  assert.equal(Object.keys(TOOLS)[0], 'select');
  assert.deepEqual(
    TOOL_OPTION_SCHEMA.select.map((o) => o.key),
    [
      'autoSelect',
      'showTransform',
      'align-leftEdges',
      'align-horizontalCenters',
      'align-rightEdges',
      'align-topEdges',
      'align-verticalCenters',
      'align-bottomEdges',
      'alignMenu'
    ]
  );
});

test('offsetLayerPixels shifts right/down and leaves vacated pixels transparent', () => {
  const W = 3,
    H = 2;
  const src = sample(W, H);
  const out = offsetLayerPixels(src, W, H, 1, 1);
  assert.equal(out.length, src.length);
  assert.deepEqual(px(out, W, 0, 0), [0, 0, 0, 0]);
  assert.deepEqual(px(out, W, 2, 0), [0, 0, 0, 0]);
  assert.deepEqual(px(out, W, 0, 1), [0, 0, 0, 0]);
  assert.deepEqual(px(out, W, 1, 1), px(src, W, 0, 0));
  assert.deepEqual(px(out, W, 2, 1), px(src, W, 1, 0));
  // Source is untouched
  assert.deepEqual(src, sample(W, H));
});

test('offsetLayerPixels shifts left/up, rounds, and uses the fill colour', () => {
  const W = 3,
    H = 2;
  const src = sample(W, H);
  const out = offsetLayerPixels(src, W, H, -1.4, -0.6, [9, 8, 7, 255]);
  // dx -1, dy -1: only (0,0) and (1,0) come from (1,1) and (2,1)
  assert.deepEqual(px(out, W, 0, 0), px(src, W, 1, 1));
  assert.deepEqual(px(out, W, 1, 0), px(src, W, 2, 1));
  assert.deepEqual(px(out, W, 2, 0), [9, 8, 7, 255]);
  for (let x = 0; x < W; x++) assert.deepEqual(px(out, W, x, 1), [9, 8, 7, 255]);
});

test('offsetLayerPixels: zero offset copies, off-canvas offset clears', () => {
  const W = 3,
    H = 2;
  const src = sample(W, H);
  assert.deepEqual(offsetLayerPixels(src, W, H, 0, 0), src);
  const gone = offsetLayerPixels(src, W, H, 5, 0);
  assert.ok(gone.every((v) => v === 0));
});

test('the Move tool moves the layer and selection, with no rubber band or Shift multi-select', () => {
  assert.match(paintSrc, /mode: 'layer'/);
  assert.match(paintSrc, /offsetLayerPixels\(/);
  assert.match(paintSrc, /'Move Layer'/);
  assert.match(paintSrc, /pushUndo\(\s*isTypeLayer\(layer\) \? 'Move Type'/);
  assert.match(paintSrc, /if \(tryBeginMove\(state, activeCtx\(\), x, y\)\) return;/);
  assert.doesNotMatch(paintSrc, /'marquee'/);
  assert.doesNotMatch(paintSrc, /objectsIntersectingRect|liftDrawingAt/);
  assert.doesNotMatch(paintSrc, /const additive = /);
  assert.doesNotMatch(pointerSrc, /'marquee'/);
  assert.equal(objects.objectsIntersectingRect, undefined);
});
