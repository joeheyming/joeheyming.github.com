import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { JSDOM } from 'jsdom';

import {
  COMMANDS,
  COMMANDS_BY_ID,
  commandForKey,
  eventShortcut,
  formatShortcut,
  normalizeShortcut
} from '../paint/commands.js';
import { CATALOG } from '../paint/menu-catalog.js';
import { buildMenuBar, planMenus } from '../paint/menu-bar.js';

const html = readFileSync(new URL('../paint/index.html', import.meta.url), 'utf8');
const paintJs = readFileSync(new URL('../paint/paint.js', import.meta.url), 'utf8');

const TOP = ['File', 'Edit', 'Image', 'Layer', 'Type', 'Select', 'Filter', 'View', 'Window'];
const CATALOG_IDS = new Set(CATALOG.map((r) => r[3]));

function built(opts = {}) {
  const { window } = new JSDOM(html);
  const bar = window.document.getElementById('menu-bar');
  const refresh = buildMenuBar(bar, COMMANDS, { mac: false, ...opts });
  return { window, document: window.document, bar, refresh };
}

const key = (k, code, mods = {}) => ({ key: k, code, ...mods });

test('command ids are unique and every command has the full shape', () => {
  const ids = COMMANDS.map((c) => c.id);
  assert.equal(new Set(ids).size, ids.length);
  for (const c of COMMANDS) {
    assert.equal(typeof c.label, 'string', c.id);
    assert.ok(c.label.length > 0, c.id);
    assert.equal(typeof c.enabled, 'function', c.id);
    assert.equal(typeof c.run, 'function', c.id);
    assert.ok(c.shortcut === null || typeof c.shortcut === 'string', c.id);
    assert.equal(COMMANDS_BY_ID.get(c.id), c);
  }
});

test('every command sits under a PhotoCraft top-level menu', () => {
  for (const c of COMMANDS) {
    assert.ok(Array.isArray(c.menu) && c.menu.length > 0, c.id);
    assert.ok(TOP.includes(c.menu[0]), `${c.id} → ${c.menu[0]}`);
  }
});

test('catalog commands take their label and menu path from PhotoCraft', () => {
  for (const c of COMMANDS) {
    const row = CATALOG.find((r) => r[3] === c.id);
    if (!row) {
      // Paint-only: anchored after a catalog command in the same menu.
      assert.ok(CATALOG_IDS.has(c.after), `${c.id} needs a catalog anchor`);
      const anchor = CATALOG.find((r) => r[3] === c.after);
      assert.equal(anchor[0], c.menu.join(' > '), c.id);
      continue;
    }
    assert.equal(c.label, row[1], c.id);
    assert.equal(c.menu.join(' > '), row[0], c.id);
  }
  assert.deepEqual(COMMANDS_BY_ID.get('image.imageRotation.90cw').menu, [
    'Image',
    'Image Rotation'
  ]);
  assert.equal(COMMANDS_BY_ID.get('image.canvasSize').shortcut, 'Cmd+Alt+C');
});

test('shortcuts and aliases are unique across commands', () => {
  const all = COMMANDS.flatMap((c) => [c.shortcut, ...c.aliases].filter(Boolean)).map(
    normalizeShortcut
  );
  assert.equal(new Set(all).size, all.length, all.join(' '));
});

test('every built menu item carries data-command matching a COMMANDS id', () => {
  const { document } = built();
  const items = [...document.querySelectorAll('#menu-bar button.action-menu-item')];
  assert.ok(items.length >= COMMANDS.length);
  for (const b of items) assert.ok(COMMANDS_BY_ID.has(b.dataset.command), b.outerHTML);
  const seen = items.map((b) => b.dataset.command).sort();
  assert.deepEqual(seen, COMMANDS.map((c) => c.id).sort());
});

test('items follow catalog order with catalog separators, never doubled or at an edge', () => {
  const { document } = built();
  const edit = document.getElementById('edit-menu-list');
  const rows = [...edit.children].map((el) =>
    el.classList.contains('action-menu-sep')
      ? '---'
      : el.dataset.command ?? `[${el.dataset.menuPath}]`
  );
  assert.deepEqual(rows, [
    'edit.undo',
    'edit.redo',
    'edit.toggleLastState',
    'edit.fade',
    '---',
    'edit.cut',
    'edit.copy',
    'edit.copyMerged',
    'edit.paste',
    '[Edit > Paste Special]',
    'edit.clear',
    '---',
    'edit.fill',
    'edit.stroke',
    '---',
    'edit.freeTransform',
    '[Edit > Transform]',
    '---',
    'edit.definePattern',
    'edit.defineCustomShape',
    '---',
    'edit.keyboardShortcuts',
    '---',
    '[Edit > Preferences]'
  ]);
  for (const list of document.querySelectorAll('.action-menu-list, .action-submenu')) {
    const kids = [...list.children].filter((el) =>
      el.matches('.action-menu-sep, .action-menu-item')
    );
    if (!kids.length) continue;
    assert.ok(!kids[0].matches('.action-menu-sep'));
    assert.ok(!kids[kids.length - 1].matches('.action-menu-sep'));
    for (let i = 1; i < kids.length; i++) {
      assert.ok(!(kids[i].matches('.action-menu-sep') && kids[i - 1].matches('.action-menu-sep')));
    }
  }
});

test('Paint-only commands follow their anchor; submenus sit at their first catalog row', () => {
  const plan = planMenus(COMMANDS);
  assert.deepEqual(
    plan.get('File > Export').map((e) => (e.sep ? '---' : e.cmd.id)),
    [
      'file.export.quickExportAsPng',
      'file.export.quickExportAsJpeg',
      '---',
      'file.export.layersToFiles'
    ]
  );
  const image = plan.get('Image').map((e) => (e.sep ? '---' : e.sub ?? e.cmd.id));
  assert.ok(image.indexOf('image.canvasSize') < image.indexOf('Image > Image Rotation'));
  assert.ok(image.indexOf('Image > Image Rotation') < image.indexOf('image.crop'));
  // An extra path with no commands still gets its submenu.
  const withMode = planMenus(COMMANDS, ['Image > Mode']);
  assert.equal(withMode.get('Image')[0].sub, 'Image > Mode');
});

test('items show their shortcut in a .menu-shortcut span', () => {
  const { document } = built();
  const undo = document.getElementById('btn-undo');
  assert.equal(undo.querySelector('.menu-label').textContent, 'Undo');
  assert.equal(undo.querySelector('.menu-shortcut').textContent, 'Ctrl+Z');
  assert.equal(document.querySelector('[data-command="edit.clear"] .menu-shortcut'), null);
  const mac = built({ mac: true }).document;
  assert.equal(mac.getElementById('btn-redo').querySelector('.menu-shortcut').textContent, '⇧⌘Z');
  assert.equal(formatShortcut('Cmd+Alt+Shift+L', false), 'Ctrl+Alt+Shift+L');
  assert.equal(formatShortcut('Cmd+Alt+Shift+L', true), '⌥⇧⌘L');
  assert.equal(formatShortcut('Shift+F6', true), '⇧F6');
});

test('items render disabled from enabled(state) and refresh when a menu opens', () => {
  const state = { undoStack: [], redoStack: [], layers: [], activeLayerIdx: 0 };
  const ran = [];
  const ctx = { undo: () => ran.push('undo') };
  const { window, document } = built({ state, ctx });
  const undo = document.getElementById('btn-undo');
  const click = (el) => el.dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
  assert.equal(undo.disabled, true);
  click(undo);
  assert.deepEqual(ran, []);
  state.undoStack.push({});
  click(document.getElementById('btn-edit'));
  assert.equal(undo.disabled, false);
  click(undo);
  assert.deepEqual(ran, ['undo']);
});

test('Undo / Redo follow the crop frame history while Crop is active', () => {
  const undo = COMMANDS_BY_ID.get('edit.undo');
  const redo = COMMANDS_BY_ID.get('edit.redo');
  const state = { tool: 'crop', undoStack: [{}], redoStack: [], cropUndo: [], cropRedo: [{}] };
  assert.equal(undo.enabled(state), false);
  assert.equal(redo.enabled(state), true);
  state.cropRedo = [];
  assert.equal(undo.enabled(state), true);
  assert.equal(redo.enabled(state), false);
});

test('commandForKey resolves Ctrl/Cmd shortcuts through one lookup', () => {
  const id = (e) => commandForKey(e)?.id ?? null;
  assert.equal(id(key('z', 'KeyZ', { ctrlKey: true })), 'edit.undo');
  assert.equal(id(key('z', 'KeyZ', { metaKey: true })), 'edit.undo');
  assert.equal(id(key('Z', 'KeyZ', { ctrlKey: true, shiftKey: true })), 'edit.redo');
  assert.equal(id(key('y', 'KeyY', { ctrlKey: true })), 'edit.redo');
  assert.equal(id(key('c', 'KeyC', { metaKey: true })), 'edit.copy');
  assert.equal(id(key('x', 'KeyX', { metaKey: true })), 'edit.cut');
  assert.equal(id(key('a', 'KeyA', { ctrlKey: true })), 'select.all');
  assert.equal(id(key('d', 'KeyD', { ctrlKey: true })), 'select.deselect');
  assert.equal(id(key('I', 'KeyI', { ctrlKey: true, shiftKey: true })), 'select.inverse');
  assert.equal(id(key('t', 'KeyT', { ctrlKey: true })), 'edit.freeTransform');
  assert.equal(id(key('=', 'Equal', { ctrlKey: true })), 'view.zoomIn');
  // Alt changes e.key on a Mac; the physical key still matches.
  assert.equal(id(key('ç', 'KeyC', { metaKey: true, altKey: true })), 'image.canvasSize');
  assert.equal(id(key('F6', 'F6', { shiftKey: true })), 'select.modify.feather');
  assert.equal(id(key('z', 'KeyZ')), null);
  assert.equal(id(key('Control', 'ControlLeft', { ctrlKey: true })), null);
  assert.equal(eventShortcut(key('t', 'KeyT', { ctrlKey: true, shiftKey: true })), 'Cmd+Shift+T');
  assert.equal(normalizeShortcut('Shift+Ctrl+z'), 'Cmd+Shift+Z');
});

test('paint.js routes Ctrl/Cmd shortcuts through commandForKey, not an if-chain', () => {
  const body = paintJs.slice(paintJs.indexOf("document.addEventListener('keydown'"));
  const handler = body.slice(0, body.indexOf("document.addEventListener('keyup'"));
  assert.match(handler, /commandForKey\(e\)/);
  assert.doesNotMatch(handler, /e\.key === '[acdyz]'/);
  assert.doesNotMatch(handler, /e\.key\.toLowerCase\(\) === 't'/);
  assert.match(paintJs, /buildMenuBar\(menuBar, COMMANDS/);
});

test('index.html no longer hand-writes command items', () => {
  const { document } = new JSDOM(html).window;
  assert.equal(document.querySelectorAll('#menu-bar .action-menu-item').length, 0);
});
