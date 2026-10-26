import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { JSDOM } from 'jsdom';

import { ICONS, iconSvg } from '../paint/icons.js';
import { TOOLS, TOOL_GROUPS, defaultToolOptions } from '../paint/tools.js';
import { buildToolbar } from '../paint/ui.js';

const EMOJI = /[\p{Extended_Pictographic}\u2190-\u2BFF]/u;

function withDocument(fn) {
  const { window } = new JSDOM('<!doctype html><div id="tools"></div>');
  const prev = globalThis.document;
  globalThis.document = window.document;
  try {
    return fn(window.document);
  } finally {
    globalThis.document = prev;
  }
}

test('every TOOLS icon is a name in ICONS', () => {
  for (const [id, tool] of Object.entries(TOOLS)) {
    assert.ok(Object.hasOwn(ICONS, tool.icon), `${id} icon ${tool.icon} is not in ICONS`);
  }
});

test('icon markup is plain stroke markup with no emoji', () => {
  for (const [name, markup] of Object.entries(ICONS)) {
    assert.doesNotMatch(markup, EMOJI, name);
    assert.doesNotMatch(markup, /<script|https?:/i, name);
  }
});

test('icons.js credits the Lucide ISC license and does not fetch', () => {
  const src = readFileSync(new URL('../paint/icons.js', import.meta.url), 'utf8');
  assert.match(src, /Lucide/);
  assert.match(src, /ISC/);
  assert.doesNotMatch(src, /fetch\(|XMLHttpRequest|import\(/);
});

test('iconSvg builds a 24 viewBox currentColor stroke svg', () => {
  withDocument(() => {
    const svg = iconSvg('brush');
    assert.equal(svg.namespaceURI, 'http://www.w3.org/2000/svg');
    assert.equal(svg.getAttribute('viewBox'), '0 0 24 24');
    assert.equal(svg.getAttribute('fill'), 'none');
    assert.equal(svg.getAttribute('stroke'), 'currentColor');
    assert.equal(svg.getAttribute('stroke-linecap'), 'round');
    assert.equal(svg.getAttribute('stroke-linejoin'), 'round');
    assert.ok(svg.querySelectorAll('path').length > 0);
    assert.throws(() => iconSvg('no-such-icon'), /Unknown icon/);
  });
});

test('tool buttons zero brand button padding so the glyph is not clipped', () => {
  const css = readFileSync(new URL('../paint/style.css', import.meta.url), 'utf8');
  const block = css.match(/\.tool-btn \{[^}]+\}/);
  assert.ok(block, '.tool-btn rule missing');
  assert.match(block[0], /padding:\s*0/);
});

test('Layers footer and lock buttons zero brand padding so icons stay visible', () => {
  // Layer chrome moved to panels.css with the dock/panels CSS split.
  const css = readFileSync(new URL('../paint/panels.css', import.meta.url), 'utf8');
  for (const sel of ['.layer-footer-btn', '.layer-lock-btn', '.layer-filter-kind']) {
    const block = css.match(new RegExp(`${sel.replace('.', '\\.')} \\{[^}]+\\}`));
    assert.ok(block, `${sel} rule missing`);
    assert.match(block[0], /padding:\s*0/, sel);
  }
});

test('the fx icon is italic SVG text, not an empty path', () => {
  withDocument((document) => {
    const prev = globalThis.document;
    globalThis.document = document;
    try {
      const svg = iconSvg('fx', 16);
      const text = svg.querySelector('text');
      assert.ok(text);
      assert.equal(text.textContent, 'fx');
      assert.equal(text.getAttribute('font-style'), 'italic');
      assert.equal(text.getAttribute('fill'), 'currentColor');
      assert.equal(text.namespaceURI, 'http://www.w3.org/2000/svg');
    } finally {
      globalThis.document = prev;
    }
  });
});

test('built tool buttons hold an svg and no emoji', () => {
  withDocument((document) => {
    const container = document.getElementById('tools');
    const state = { tool: 'brush', toolOptions: defaultToolOptions() };
    buildToolbar(TOOLS, state, container, () => {});
    const buttons = [...container.querySelectorAll('.tool-btn')];
    assert.equal(buttons.length, TOOL_GROUPS.length);
    for (const btn of buttons) {
      const svg = btn.querySelector('svg');
      assert.ok(svg, `${btn.dataset.tool} has no svg`);
      assert.ok(svg.children.length > 0, `${btn.dataset.tool} svg is empty`);
      assert.equal(btn.textContent.trim(), '', `${btn.dataset.tool} has text`);
      assert.doesNotMatch(btn.innerHTML, EMOJI, btn.dataset.tool);
      assert.ok(btn.getAttribute('aria-label'));
    }
  });
});
