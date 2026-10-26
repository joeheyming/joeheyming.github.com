import test from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';

import { TOOL_OPTION_SCHEMA, defaultToolOptions } from '../paint/tools.js';
import { renderToolOptions } from '../paint/ui.js';

// The four tools people reach first, against the PhotoCraft Pro options bar.
const TOOLS_FIRST = ['select', 'rectSelect', 'brush', 'text'];
const INSTRUCTION = /Drag|Click|instruction/i;

function render(tool) {
  const { window } = new JSDOM('<!doctype html><div id="opts"></div>');
  const prev = globalThis.document;
  globalThis.document = window.document;
  try {
    const el = window.document.getElementById('opts');
    renderToolOptions(TOOL_OPTION_SCHEMA[tool], defaultToolOptions()[tool] || {}, el, () => {});
    return el;
  } finally {
    globalThis.document = prev;
  }
}

// Every piece of text a person can read on the bar: labels, option text, titles, aria-labels.
function barText(el) {
  const attrs = [...el.querySelectorAll('[title], [aria-label]')].flatMap((n) => [
    n.getAttribute('title') || '',
    n.getAttribute('aria-label') || ''
  ]);
  return [el.textContent, ...attrs].join(' ');
}

function labelFor(el, id) {
  const input = el.querySelector('#' + id);
  assert.ok(input, id);
  const label = el.querySelector(`label[for="${id}"]`);
  return (label?.textContent || input.getAttribute('aria-label') || '').trim();
}

test('the four schemas have no hint entry and no instruction label', () => {
  for (const tool of TOOLS_FIRST) {
    const schema = TOOL_OPTION_SCHEMA[tool];
    assert.ok(schema.length > 0, tool);
    assert.ok(!schema.some((o) => o.type === 'hint'), tool);
    for (const o of schema) {
      assert.doesNotMatch(o.label || '', INSTRUCTION, `${tool}.${o.key}`);
      assert.doesNotMatch(o.title || '', INSTRUCTION, `${tool}.${o.key}`);
    }
  }
});

test('Move renders Auto-Select and Show Transform Controls checkboxes', () => {
  const el = render('select');
  const auto = el.querySelector('#opt-autoSelect');
  const show = el.querySelector('#opt-showTransform');
  assert.equal(auto.type, 'checkbox');
  assert.equal(show.type, 'checkbox');
  assert.equal(auto.checked, false);
  assert.equal(show.checked, true);
  assert.equal(labelFor(el, 'opt-autoSelect'), 'Auto-Select');
  assert.equal(labelFor(el, 'opt-showTransform'), 'Show Transform Controls');
  assert.doesNotMatch(barText(el), INSTRUCTION);
});

test('Rectangular Marquee renders selection mode, Feather, and Style', () => {
  const el = render('rectSelect');
  const mode = el.querySelector('#opt-selectionMode');
  assert.equal(mode.getAttribute('role'), 'radiogroup');
  assert.equal(mode.querySelectorAll('[role=radio]').length, 4);
  assert.equal(el.querySelector('#opt-feather').type, 'number');
  assert.equal(labelFor(el, 'opt-feather'), 'Feather');
  const style = el.querySelector('#opt-marqueeStyle');
  assert.equal(style.tagName, 'SELECT');
  assert.equal(labelFor(el, 'opt-marqueeStyle'), 'Style');
  assert.deepEqual(
    [...style.options].map((o) => o.textContent),
    ['Normal', 'Fixed Ratio', 'Fixed Size']
  );
  assert.doesNotMatch(barText(el), INSTRUCTION);
});

test('Brush renders Size, Hardness, Opacity, and Flow', () => {
  const el = render('brush');
  for (const [key, label] of [
    ['size', 'Size'],
    ['hardness', 'Hardness'],
    ['opacity', 'Opacity'],
    ['flow', 'Flow']
  ]) {
    assert.equal(labelFor(el, 'opt-' + key), label);
  }
  assert.equal(el.querySelector('#opt-size').type, 'range');
  assert.equal(el.querySelector('#opt-size').value, '20');
  assert.equal(el.querySelector('#opt-flow').value, '100');
  assert.doesNotMatch(barText(el), INSTRUCTION);
});

test('Type renders font, size, and alignment, not only Commit / Cancel', () => {
  const el = render('text');
  assert.equal(el.querySelector('#opt-family').tagName, 'SELECT');
  assert.equal(labelFor(el, 'opt-family'), 'Font');
  assert.equal(labelFor(el, 'opt-size'), 'Font size');
  const align = el.querySelector('#opt-align');
  assert.equal(align.getAttribute('aria-label'), 'Alignment');
  assert.deepEqual(
    [...align.querySelectorAll('[role=radio]')].map((b) => b.getAttribute('aria-checked')),
    ['true', 'false', 'false']
  );
  const controls = el.querySelectorAll('input, select, [role=radio]');
  assert.ok(controls.length > 2);
  assert.doesNotMatch(barText(el), INSTRUCTION);
});
