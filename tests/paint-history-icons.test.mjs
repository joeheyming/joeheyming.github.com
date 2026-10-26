import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { JSDOM } from 'jsdom';

import { ICONS } from '../paint/icons.js';
import { TOOLS } from '../paint/tools.js';
import {
  FALLBACK_HISTORY_ICON,
  historyIconName,
  makeHistoryItem,
  renderHistoryPanel
} from '../paint/history.js';

const EMOJI = /[\p{Extended_Pictographic}←-⯿]/u;

function withDocument(fn) {
  const { window } = new JSDOM('<!doctype html><div id="history"></div>');
  const prev = globalThis.document;
  globalThis.document = window.document;
  window.HTMLElement.prototype.scrollIntoView = () => {};
  try {
    return fn(window.document);
  } finally {
    globalThis.document = prev;
  }
}

test('history.js no longer maps labels to emoji', () => {
  const src = readFileSync(new URL('../paint/history.js', import.meta.url), 'utf8');
  assert.doesNotMatch(src, EMOJI);
});

test('every tool label uses its tool column icon', () => {
  for (const tool of Object.values(TOOLS)) {
    assert.equal(historyIconName(tool.label), tool.icon, tool.label);
  }
});

test('known command labels resolve to names in ICONS', () => {
  for (const label of ['Open', 'Paste', 'Cut', 'Delete', 'Clear', 'Crop', 'Resize', 'Flatten']) {
    const name = historyIconName(label);
    assert.notEqual(name, FALLBACK_HISTORY_ICON, label);
    assert.ok(Object.hasOwn(ICONS, name), `${label} → ${name}`);
  }
  assert.equal(historyIconName('Gaussian Blur'), 'sliders-horizontal');
});

test('an unknown label uses the neutral stroke icon', () => {
  assert.equal(historyIconName('Something New'), FALLBACK_HISTORY_ICON);
  assert.ok(Object.hasOwn(ICONS, FALLBACK_HISTORY_ICON));
  withDocument(() => {
    const el = makeHistoryItem('Something New', 'past');
    const svg = el.querySelector('.history-icon svg');
    assert.ok(svg);
    assert.equal(svg.getAttribute('stroke'), 'currentColor');
    assert.doesNotMatch(el.textContent, EMOJI);
  });
});

test('a rendered history row contains an svg and no emoji', () => {
  withDocument((doc) => {
    const container = doc.getElementById('history');
    const undo = [{ label: 'Brush' }, { label: 'Fill' }];
    const redo = [{ label: 'Cut' }];
    renderHistoryPanel(
      container,
      undo,
      redo,
      () => {},
      () => {}
    );
    const rows = container.querySelectorAll('.history-item');
    assert.equal(rows.length, 4);
    for (const row of rows) {
      assert.ok(row.querySelector('.history-icon svg'), row.textContent);
      assert.doesNotMatch(row.textContent, EMOJI);
    }
    const current = container.querySelector('.history-item.current');
    assert.equal(current.textContent, 'Fill');
  });
});
