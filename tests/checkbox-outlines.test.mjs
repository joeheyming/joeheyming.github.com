import assert from 'node:assert/strict';
import test from 'node:test';
import { OUTLINE_NAMES, buildOutlines, outlineAt } from '../checkboxes/outlines.js';

const N = 1_000_000;

test('outlines follow the original spacing band', () => {
  const { indices, colors } = buildOutlines(N);
  assert.equal(indices[0], 45);
  assert.ok(indices.length > 2500 && indices.length < 3200);
  for (let i = 1; i < indices.length; i++) {
    const gap = indices[i] - indices[i - 1];
    assert.ok(gap >= 237 && gap <= 475, `gap ${gap} at ${i}`);
  }
  assert.ok(indices[indices.length - 1] < N);
  const counts = [0, 0, 0, 0];
  for (const color of colors) counts[color]++;
  for (const count of counts) {
    assert.ok(count > indices.length / 6, `color share ${count}`);
  }
  assert.equal(OUTLINE_NAMES.length, 4);
});

test('outlineAt finds only the scattered cells', () => {
  const built = buildOutlines(N);
  assert.equal(outlineAt(built.indices, built.colors, 45), built.colors[0]);
  assert.equal(outlineAt(built.indices, built.colors, 0), -1);
  assert.equal(outlineAt(built.indices, built.colors, 46), -1);
  const mid = built.indices[1000];
  assert.equal(outlineAt(built.indices, built.colors, mid), built.colors[1000]);
});
