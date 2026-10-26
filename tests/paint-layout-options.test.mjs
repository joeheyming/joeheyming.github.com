import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { JSDOM } from 'jsdom';

import { TOOL_OPTION_SCHEMA } from '../paint/tools.js';
import { renderToolOptions } from '../paint/ui.js';

const html = readFileSync(new URL('../paint/index.html', import.meta.url), 'utf8');
const css = readFileSync(new URL('../paint/style.css', import.meta.url), 'utf8');

function load() {
  const { window } = new JSDOM(html);
  return { window, document: window.document };
}

test('options bar is the third row of .paint-layout, under the menu bar and document tab', () => {
  const { document } = load();
  const layout = document.querySelector('.paint-layout');
  const rows = [...layout.children];
  assert.equal(rows[0].id, 'menu-bar');
  assert.ok(rows[1].classList.contains('doc-tab'));
  assert.equal(rows[2].id, 'options-bar');
});

test('#tool-options lives in #options-bar and not in .paint-header', () => {
  const { document } = load();
  const opts = document.getElementById('tool-options');
  assert.ok(opts);
  assert.ok(document.getElementById('options-bar').contains(opts));
  assert.equal(opts.closest('.paint-header'), null);
  assert.equal(document.querySelector('.paint-header #tool-options'), null);
  assert.equal(document.querySelectorAll('#tool-options').length, 1);
});

test('options bar spans the window and clears the compact nav toggle', () => {
  const block = css.match(/\n\.options-bar \{[^}]*\}/)[0];
  assert.doesNotMatch(block, /max-width|width:/);
  const pad = block
    .match(/padding:\s*([^;]+);/)[1]
    .trim()
    .split(/\s+/);
  assert.ok(parseInt(pad[3], 10) >= 120, `desktop padding-left ${pad[3]}`);
  const narrow = css.match(/@media \(max-width: 640px\) \{[\s\S]*?\n\}/)[0];
  const narrowPad = narrow.match(/\.options-bar \{[^}]*padding-left:\s*(\d+)px/)[1];
  assert.ok(parseInt(narrowPad, 10) >= 100, `640px padding-left ${narrowPad}`);
});

test('switching tools re-renders #tool-options inside the options bar', () => {
  const { document } = load();
  const prev = globalThis.document;
  globalThis.document = document;
  try {
    const container = document.getElementById('tool-options');
    const show = (id) => renderToolOptions(TOOL_OPTION_SCHEMA[id] || [], {}, container, () => {});

    show('pencil');
    assert.equal(container.classList.contains('empty'), false);
    assert.ok(container.querySelector('#opt-size'));
    assert.ok(container.querySelector('#opt-lockAlpha'));

    show('magicWand');
    assert.equal(container.querySelector('#opt-lockAlpha'), null);
    assert.ok(container.querySelector('#opt-tolerance'));
    assert.ok(document.getElementById('options-bar').contains(container));

    show('eyedropper');
    assert.equal(container.children.length, 0);
    assert.equal(container.classList.contains('empty'), true);
  } finally {
    globalThis.document = prev;
  }
});
