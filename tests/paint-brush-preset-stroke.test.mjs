import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { JSDOM } from 'jsdom';

import { defaultToolOptions } from '../paint/tools.js';
import { GENERAL_BRUSHES, applyBrushPreset } from '../paint/brush-presets.js';
import { initBrushPanel } from '../paint/brush-panel.js';

const softRound = GENERAL_BRUSHES.find((p) => p.name === 'Soft Round');

function memoryStorage() {
  const m = new Map();
  return {
    getItem: (k) => (m.has(k) ? m.get(k) : null),
    setItem: (k, v) => m.set(k, String(v))
  };
}

test('applyBrushPreset sets the next stroke size while another tool is active', () => {
  const state = { tool: 'move', brushSize: 5, toolOptions: defaultToolOptions(), brushSettings: null };
  applyBrushPreset(state, softRound);
  assert.equal(state.brushSize, softRound.size);
  assert.equal(state.toolOptions.brush.size, softRound.size);
  assert.equal(state.toolOptions.brush.hardness, softRound.hardness);
});

const html = readFileSync(new URL('../paint/index.html', import.meta.url), 'utf8');

test('clicking a Brushes panel preset sets state.brushSize and calls onBrushChange', () => {
  const { window } = new JSDOM(html);
  const doc = window.document;
  const state = { tool: 'move', brushSize: 5, toolOptions: defaultToolOptions(), brushSettings: null };
  let changes = 0;
  initBrushPanel(state, { onBrushChange: () => changes++ }, doc, memoryStorage());
  doc.querySelector('#brush-preset-list .preset-item[data-preset="Soft Round"]').click();
  assert.equal(changes, 1);
  assert.equal(state.brushSize, softRound.size);
  assert.equal(state.toolOptions.brush.hardness, 0);

  const hard = GENERAL_BRUSHES.find((p) => p.name === 'Hard Round');
  doc.querySelector('#brush-preset-list .preset-item[data-preset="Hard Round"]').click();
  assert.equal(changes, 2);
  assert.equal(state.brushSize, hard.size);
  assert.equal(state.toolOptions.brush.hardness, hard.hardness);
});
