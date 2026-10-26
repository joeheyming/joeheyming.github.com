import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { JSDOM } from 'jsdom';

import { TOOLS, TOOL_OPTION_SCHEMA, defaultToolOptions } from '../paint/tools.js';
import { buildToolbar } from '../paint/ui.js';

const src = (f) => readFileSync(new URL(`../paint/${f}`, import.meta.url), 'utf8');

test('spray is not a tool and has no options', () => {
  assert.equal('spray' in TOOLS, false);
  assert.equal('spray' in TOOL_OPTION_SCHEMA, false);
  assert.equal('spray' in defaultToolOptions(), false);
  assert.ok(TOOLS.brush, 'the brush is still there');
});

test('the tool column has no spray button', () => {
  const { document } = new JSDOM('<div id="tool-buttons"></div>').window;
  const prev = globalThis.document;
  globalThis.document = document;
  try {
    const container = document.getElementById('tool-buttons');
    buildToolbar(TOOLS, { tool: 'brush' }, container, () => {});
    assert.equal(container.querySelector('[data-tool="spray"]'), null);
    for (const btn of container.querySelectorAll('.tool-btn')) {
      assert.doesNotMatch(btn.title, /spray/i);
    }
  } finally {
    globalThis.document = prev;
  }
});

test('no S shortcut to a spray tool and no spray timer', () => {
  const paint = src('paint.js');
  const pointer = src('pointer.js');
  const ui = src('ui.js');
  assert.doesNotMatch(paint, /s:\s*'spray'/);
  assert.doesNotMatch(ui, /spray:\s*'S'/);
  for (const [name, text] of [
    ['paint.js', paint],
    ['pointer.js', pointer]
  ]) {
    assert.doesNotMatch(text, /spray/i, name);
  }
});
