import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { JSDOM } from 'jsdom';

import { buildPalette, PALETTE_COLORS } from '../paint/ui.js';

const html = readFileSync(new URL('../paint/index.html', import.meta.url), 'utf8');
const css = readFileSync(new URL('../paint/style.css', import.meta.url), 'utf8');

function load() {
  const { window } = new JSDOM(html);
  const { document } = window;
  // Swatch handlers resolve document at click time, so it stays set until the next load.
  globalThis.document = document;
  const state = { color: '#000000', bgColor: '#ffffff' };
  const calls = { fg: [], bg: [] };
  buildPalette(
    state,
    document.getElementById('color-chips'),
    document.getElementById('palette-bar'),
    (c) => calls.fg.push(c),
    (c) => calls.bg.push(c)
  );
  return { window, document, calls };
}

const follows = (a, b) => Boolean(b.compareDocumentPosition(a) & 4);

test('fg and bg swatches sit in .left-panel after #tool-buttons', () => {
  const { document } = load();
  const panel = document.querySelector('.left-panel');
  const tools = document.getElementById('tool-buttons');
  const chips = document.getElementById('color-chips');
  for (const id of ['fg-swatch', 'bg-swatch']) {
    const el = document.getElementById(id);
    assert.ok(el, id);
    assert.ok(panel.contains(el), `${id} inside .left-panel`);
    assert.ok(chips.contains(el), `${id} inside #color-chips`);
    assert.ok(follows(el, tools), `${id} after #tool-buttons`);
  }
  assert.equal(tools.parentElement, panel);
  assert.equal(chips.parentElement, panel);
  assert.equal(tools.nextElementSibling, chips);
});

test('the swatch strip is in the dock, not a bar under the canvas', () => {
  const { document } = load();
  const strip = document.getElementById('palette-bar');
  // US-061 moved the strip from the tool column into the dock's Swatches tab.
  assert.ok(document.getElementById('panel-swatches').contains(strip));
  assert.equal(document.querySelector('.left-panel #palette-bar'), null);
  assert.equal(document.querySelectorAll('#palette-bar').length, 1);
  assert.equal(document.querySelector('.palette-bar-outer #palette-bar'), null);
  assert.equal(document.querySelector('.palette-bar-outer .color-swatch'), null);
  assert.equal(strip.querySelectorAll('.swatch-grid .color-swatch').length, PALETTE_COLORS.length);
  assert.ok(strip.querySelector('#color-history'));
});

test('the chips overlap with the foreground in front and the background down-right', () => {
  const { document } = load();
  const chips = document.getElementById('color-chips');
  // Background is appended first and the foreground stacks on top of it.
  const order = [...chips.querySelectorAll('.fb-swatch')].map((el) => el.id);
  assert.deepEqual(order, ['bg-swatch', 'fg-swatch']);

  const rule = (sel) => css.match(new RegExp(`\\n${sel.replace('.', '\\.')} \\{[^}]*\\}`))[0];
  assert.match(rule('.fb-wrap'), /position: relative/);
  assert.match(rule('.fb-swatch'), /position: absolute/);
  const fg = rule('.fg-swatch');
  const bg = rule('.bg-swatch');
  assert.match(fg, /top: 0/);
  assert.match(fg, /left: 0/);
  assert.match(bg, /bottom: 0/);
  assert.match(bg, /right: 0/);
  const z = (block) => parseInt(block.match(/z-index: (\d+)/)[1], 10);
  assert.ok(z(fg) > z(bg));
  // Chip squares (26px) are larger than half the 38px wrap, so they overlap.
  const size = (block, prop) => parseInt(block.match(new RegExp(`${prop}: (\\d+)px`))[1], 10);
  const wrap = rule('.fb-wrap');
  const sw = rule('.fb-swatch');
  assert.ok(size(sw, 'width') * 2 > size(wrap, 'width'));
  assert.ok(size(sw, 'height') * 2 > size(wrap, 'height'));
});

test('clicking a swatch still sets the foreground or background color', () => {
  const { window, document, calls } = load();
  const fg = document.getElementById('fg-swatch');
  const bg = document.getElementById('bg-swatch');
  const fgInput = document.getElementById('fg-color-input');
  const bgInput = document.getElementById('bg-color-input');

  const opened = [];
  fgInput.click = () => opened.push('fg');
  bgInput.click = () => opened.push('bg');
  fg.click();
  bg.click();
  assert.deepEqual(opened, ['fg', 'bg']);

  fgInput.value = '#112233';
  fgInput.dispatchEvent(new window.Event('input'));
  bgInput.value = '#445566';
  bgInput.dispatchEvent(new window.Event('input'));
  assert.deepEqual(calls.fg, ['#112233']);
  assert.deepEqual(calls.bg, ['#445566']);

  const red = document.querySelector('.color-swatch[title="#ff0000"]');
  red.click();
  assert.deepEqual(calls.fg, ['#112233', '#ff0000']);
  assert.equal(fgInput.value, '#ff0000');
  red.dispatchEvent(new window.MouseEvent('contextmenu', { bubbles: true, cancelable: true }));
  assert.deepEqual(calls.bg, ['#445566', '#ff0000']);
  assert.equal(bgInput.value, '#ff0000');
});
