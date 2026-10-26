import test, { mock } from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';

import { TOOLTIP_SHOW_MS, initTooltips, tooltipPosition } from '../paint/tooltips.js';

function page() {
  const { window } = new JSDOM(
    '<!doctype html><body><button id="a" title="Create a new layer">+</button><button id="b" title="Delete layer">x</button></body>'
  );
  return { window, document: window.document };
}

function over(window, el) {
  el.dispatchEvent(new window.Event('pointerover', { bubbles: true }));
}

function out(window, el) {
  el.dispatchEvent(new window.Event('pointerout', { bubbles: true }));
}

test('tooltipPosition sits under the control and flips above the bottom edge', () => {
  const under = tooltipPosition({ left: 100, width: 20, top: 40, bottom: 60 }, 80, 18, 400, 300);
  assert.equal(under.top, 66);
  assert.equal(under.left, 70);
  const above = tooltipPosition({ left: 100, width: 20, top: 260, bottom: 280 }, 80, 18, 400, 300);
  assert.equal(above.top, 260 - 18 - 6);
});

test('a tip appears after a short delay and the native title is put away while it shows', () => {
  mock.timers.enable({ apis: ['setTimeout'] });
  try {
    const { window, document } = page();
    initTooltips(document);
    const btn = document.getElementById('a');
    over(window, btn);
    assert.equal(document.querySelector('.paint-tooltip').hidden, true);
    assert.equal(btn.getAttribute('title'), null, 'native tip cannot start its own timer');
    mock.timers.tick(TOOLTIP_SHOW_MS);
    const tip = document.querySelector('.paint-tooltip');
    assert.equal(tip.hidden, false);
    assert.equal(tip.textContent, 'Create a new layer');
    assert.ok(TOOLTIP_SHOW_MS <= 150);
    out(window, btn);
    assert.equal(tip.hidden, true);
    assert.equal(btn.getAttribute('title'), 'Create a new layer');
  } finally {
    mock.timers.reset();
  }
});

test('the next control shows its tip immediately', () => {
  mock.timers.enable({ apis: ['setTimeout'] });
  try {
    const { window, document } = page();
    initTooltips(document);
    const a = document.getElementById('a');
    const b = document.getElementById('b');
    over(window, a);
    mock.timers.tick(TOOLTIP_SHOW_MS);
    out(window, a);
    over(window, b);
    const tip = document.querySelector('.paint-tooltip');
    assert.equal(tip.hidden, false);
    assert.equal(tip.textContent, 'Delete layer');
  } finally {
    mock.timers.reset();
  }
});

test('leaving before the delay restores the title and shows nothing', () => {
  mock.timers.enable({ apis: ['setTimeout'] });
  try {
    const { window, document } = page();
    initTooltips(document);
    const btn = document.getElementById('a');
    over(window, btn);
    out(window, btn);
    mock.timers.tick(TOOLTIP_SHOW_MS);
    assert.equal(document.querySelector('.paint-tooltip').hidden, true);
    assert.equal(btn.getAttribute('title'), 'Create a new layer');
  } finally {
    mock.timers.reset();
  }
});
