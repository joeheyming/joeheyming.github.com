import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { JSDOM } from 'jsdom';

import { buildMenuBar, closeMenus, initMenuBar } from '../paint/menu-bar.js';
import { COMMANDS } from '../paint/commands.js';

const html = readFileSync(new URL('../paint/index.html', import.meta.url), 'utf8');
const css = readFileSync(new URL('../paint/style.css', import.meta.url), 'utf8');

const MENUS = ['File', 'Edit', 'Image', 'Layer', 'Type', 'Select', 'Filter', 'View', 'Window'];

function load() {
  const { window } = new JSDOM(html);
  // Every action is a no-op; these tests only open and close menus.
  const ctx = new Proxy({}, { get: () => () => {} });
  buildMenuBar(window.document.getElementById('menu-bar'), COMMANDS, { ctx, mac: false });
  return { window, document: window.document };
}

function menuNamed(document, name) {
  const btn = [...document.querySelectorAll('#menu-bar .menu-bar-btn')].find(
    (b) => b.textContent.trim() === name
  );
  return btn?.closest('.menu-bar-menu');
}

test('menu bar is the first row of .paint-layout with the menus in order', () => {
  const { document } = load();
  const layout = document.querySelector('.paint-layout');
  const bar = document.getElementById('menu-bar');
  assert.equal(layout.firstElementChild, bar);
  const labels = [...bar.querySelectorAll('.menu-bar-btn')].map((b) => b.textContent.trim());
  assert.deepEqual(labels, MENUS);
  for (const btn of bar.querySelectorAll('.menu-bar-btn')) {
    assert.equal(btn.getAttribute('aria-haspopup'), 'true');
    assert.equal(btn.getAttribute('aria-expanded'), 'false');
  }
});

test('existing commands live in File, Edit, Image, Layer, and Select', () => {
  const { document } = load();
  const inMenu = (name, sel) => {
    const el = document.querySelector(sel);
    assert.ok(el, sel);
    assert.equal(el.closest('.menu-bar-menu'), menuNamed(document, name), `${sel} in ${name}`);
  };
  inMenu('File', '[data-file="new"]');
  inMenu('File', '[data-file="open-computer"]');
  inMenu('File', '[data-file="save-png"]');
  inMenu('Edit', '#btn-undo');
  inMenu('Edit', '#btn-redo');
  inMenu('Image', '[data-command="image.adjustments.levels"]');
  inMenu('Layer', '[data-layer="duplicate"]');
  inMenu('Layer', '[data-layer="merge-down"]');
  inMenu('Select', '[data-select="all"]');
  inMenu('Select', '#select-radius');
  assert.ok(
    document.querySelector('.has-submenu[data-menu-path="Select > Modify"] #select-radius'),
    'radius sits in Select › Modify'
  );
  assert.ok(
    document.querySelector(
      '.has-submenu[data-menu-path="Image > Adjustments"] [data-command="image.adjustments.levels"]'
    ),
    'the adjustment list sits in Image › Adjustments'
  );
  assert.ok(menuNamed(document, 'Filter').querySelector('.action-menu-list'));
  assert.equal(document.querySelector('.paint-header .action-menu'), null);
});

test("the adjust menu's first entry is built inside Image", () => {
  const { window } = new JSDOM(html);
  const document = window.document;
  const opened = [];
  const ctx = { openAdjust: (id) => opened.push(id) };
  buildMenuBar(document.getElementById('menu-bar'), COMMANDS, { ctx, mac: false });
  const first = document.querySelector(
    '.has-submenu[data-menu-path="Image > Adjustments"] .action-submenu button.action-menu-item'
  );
  assert.equal(first.querySelector('.menu-label').textContent, 'Brightness/Contrast…');
  assert.equal(first.closest('.menu-bar-menu'), menuNamed(document, 'Image'));
  first.dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
  assert.deepEqual(opened, ['brightness']);
});

test('menus open on click, switch on hover, and close on item click or outside click', () => {
  const { window, document } = load();
  const prev = globalThis.document;
  globalThis.document = document;
  try {
    const bar = document.getElementById('menu-bar');
    initMenuBar(bar);
    const file = menuNamed(document, 'File');
    const edit = menuNamed(document, 'Edit');
    const open = (m) => !m.querySelector('.action-menu-list').classList.contains('hidden');
    const click = (el) => el.dispatchEvent(new window.MouseEvent('click', { bubbles: true }));

    edit.querySelector('.menu-bar-btn').dispatchEvent(new window.Event('pointerenter'));
    assert.equal(open(edit), false, 'hover alone does not open a closed bar');

    click(file.querySelector('.menu-bar-btn'));
    assert.equal(open(file), true);
    assert.equal(file.querySelector('.menu-bar-btn').getAttribute('aria-expanded'), 'true');

    edit.querySelector('.menu-bar-btn').dispatchEvent(new window.Event('pointerenter'));
    assert.equal(open(file), false);
    assert.equal(open(edit), true);

    click(document.getElementById('select-radius'));
    assert.equal(open(edit), true, 'clicks inside the bar that are not items keep it open');

    click(document.getElementById('btn-clear'));
    assert.equal(open(edit), false);

    click(file.querySelector('.menu-bar-btn'));
    click(document.getElementById('canvas-area'));
    assert.equal(open(file), false);

    click(file.querySelector('.menu-bar-btn'));
    click(file.querySelector('.menu-bar-btn'));
    assert.equal(open(file), false, 'second click on the title closes it');

    click(file.querySelector('.menu-bar-btn'));
    closeMenus(bar);
    assert.equal(open(file), false);
  } finally {
    globalThis.document = prev;
  }
});

test('menu bar clears the compact nav toggle', () => {
  const px = (block) => {
    const m = block.match(/padding(?:-left)?:\s*([^;]+);/);
    assert.ok(m, block);
    const parts = m[1].trim().split(/\s+/);
    return parseInt(m[0].includes('padding-left') ? parts[0] : parts[3] ?? parts[1], 10);
  };
  const base = css.match(/\n\.menu-bar \{[^}]*\}/)[0];
  assert.ok(px(base) >= 120, `desktop padding-left ${px(base)}`);
  const narrow = css.match(/@media \(max-width: 640px\) \{[\s\S]*?\n\}/)[0];
  const narrowBar = narrow.match(/\.menu-bar \{[^}]*\}/)[0];
  assert.ok(px(narrowBar) >= 100, `640px padding-left ${px(narrowBar)}`);
});

test('share and feedback cluster is anchored to the top-right', () => {
  const block = css.match(/\.related-projects-container \{[^}]*\}/)[0];
  assert.match(block, /top:\s*2px/);
  assert.match(block, /right:\s*8px/);
  assert.match(block, /bottom:\s*auto/);
  const share = css.match(/\.related-projects-container \.share-fab \{[^}]*\}/)[0];
  assert.match(share, /top:\s*0/);
  assert.match(share, /bottom:\s*auto/);
});
