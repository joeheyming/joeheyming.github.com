import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { JSDOM } from 'jsdom';

import { ICONS } from '../paint/icons.js';
import { buildPalette, defaultColors, swapColors } from '../paint/ui.js';

const EMOJI = /[\p{Extended_Pictographic}←-⯿]/u;

function withPalette(state, onSetColors, fn) {
  const { window } = new JSDOM(
    '<!doctype html><div id="color-chips"></div><div id="palette-bar"></div>'
  );
  const prev = globalThis.document;
  globalThis.document = window.document;
  try {
    const doc = window.document;
    buildPalette(
      state,
      doc.getElementById('color-chips'),
      doc.getElementById('palette-bar'),
      () => {},
      () => {},
      onSetColors
    );
    return fn(doc);
  } finally {
    globalThis.document = prev;
  }
}

test('defaultColors is black on white', () => {
  assert.deepEqual(defaultColors(), { fg: '#000000', bg: '#ffffff' });
  // A fresh object each call, so a caller cannot mutate the default.
  assert.notEqual(defaultColors(), defaultColors());
});

test('swapColors trades foreground and background', () => {
  assert.deepEqual(swapColors('#ff0000', '#00ff00'), { fg: '#00ff00', bg: '#ff0000' });
  const once = swapColors('#123456', '#abcdef');
  assert.deepEqual(swapColors(once.fg, once.bg), { fg: '#123456', bg: '#abcdef' });
});

test('#color-chips holds Default Colors and Switch Colors with svg icons and no emoji', () => {
  withPalette({ color: '#ff0000', bgColor: '#0000ff' }, null, (doc) => {
    const chips = doc.getElementById('color-chips');
    for (const label of ['Default Colors (D)', 'Switch Colors (X)']) {
      const btn = chips.querySelector(`button[aria-label="${label}"]`);
      assert.ok(btn, `${label} button missing`);
      assert.equal(btn.title, label);
      assert.ok(btn.querySelector('svg'), `${label} has no svg`);
      assert.doesNotMatch(btn.textContent, EMOJI);
    }
    assert.ok(ICONS.copy && ICONS['arrow-left-right']);
  });
});

test('clicking the chip buttons passes the default and swapped colors', () => {
  const calls = [];
  const state = { color: '#ff0000', bgColor: '#0000ff' };
  withPalette(
    state,
    (c) => calls.push(c),
    (doc) => {
      doc.querySelector('button[aria-label="Switch Colors (X)"]').click();
      doc.querySelector('button[aria-label="Default Colors (D)"]').click();
    }
  );
  assert.deepEqual(calls, [
    { fg: '#0000ff', bg: '#ff0000' },
    { fg: '#000000', bg: '#ffffff' }
  ]);
});

test('paint.js binds D / X only without Ctrl, Cmd, or Alt and routes them through setColors', () => {
  const src = readFileSync(new URL('../paint/paint.js', import.meta.url), 'utf8');
  assert.match(src, /if \(!e\.ctrlKey && !e\.metaKey && !e\.altKey\) \{\s*const key = e\.key/);
  assert.match(src, /setColors\(key === 'd' \? defaultColors\(\) : swapColors\(/);
  // The single keys come after the input guard and the COMMANDS lookup that takes
  // Ctrl/Cmd-X (edit.cut) and Ctrl/Cmd-D (select.deselect).
  const guard = src.indexOf('if (inInput) {');
  const lookup = src.indexOf('const cmd = commandForKey(e);');
  const single = src.indexOf("setColors(key === 'd'");
  assert.ok(guard > 0 && lookup > guard && single > lookup);
  // setColors updates the state fields and shows both colors.
  const fn = src.slice(
    src.indexOf('function setColors('),
    src.indexOf('function setColors(') + 300
  );
  for (const s of [
    'state.color = fg',
    'state.activeColor = fg',
    'state.bgColor = bg',
    "showColor('fg', fg)",
    "showColor('bg', bg)"
  ]) {
    assert.ok(fn.includes(s), `setColors missing ${s}`);
  }
});
