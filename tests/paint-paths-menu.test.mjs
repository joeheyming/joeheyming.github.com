import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { JSDOM } from 'jsdom';
import {
  cornerAnchor,
  duplicatePath,
  duplicatePathName,
  emptyPath,
  pathRowActions,
  renderPathsPanel
} from '../paint/paths.js';

const square = {
  name: 'Work Path',
  subpaths: [
    { closed: true, anchors: [cornerAnchor(1, 1), cornerAnchor(5, 1), cornerAnchor(5, 5)] }
  ]
};

function sample() {
  const logo = { ...square, name: 'Logo' };
  return { work: square, saved: [emptyPath('Path 1'), logo, emptyPath('Logo copy 1')], target: 0 };
}

test('duplicatePathName takes the first free "<name> copy N"', () => {
  const saved = sample().saved;
  assert.equal(duplicatePathName(saved, 'Path 1'), 'Path 1 copy 1');
  assert.equal(duplicatePathName(saved, 'Logo'), 'Logo copy 2');
  assert.equal(duplicatePathName([], 'X'), 'X copy 1');
});

test('duplicatePath appends a copy and keeps the target, without mutating', () => {
  const paths = sample();
  const snapshot = JSON.stringify(paths);
  const next = duplicatePath(paths, 1);
  assert.equal(next.saved.length, 4);
  assert.equal(next.saved[3].name, 'Logo copy 2');
  assert.deepEqual(next.saved[3].subpaths, square.subpaths);
  assert.equal(next.saved[1], paths.saved[1]);
  assert.equal(next.work, paths.work);
  assert.equal(next.target, 0);
  assert.equal(duplicatePath(paths, 9), paths);
  assert.equal(duplicatePath(paths, 'work'), paths);
  assert.equal(JSON.stringify(paths), snapshot);
});

test('pathRowActions lists PhotoCraft path_context_actions in order', () => {
  const labels = (key) => pathRowActions(key).map((a) => a.label);
  assert.deepEqual(labels('work'), [
    'Make Selection',
    'Fill Path',
    'Stroke Path…',
    'Save Path',
    'Delete Path'
  ]);
  assert.deepEqual(labels(0), [
    'Make Selection',
    'Fill Path',
    'Stroke Path…',
    'Duplicate Path',
    'Rename Path…',
    'Delete Path'
  ]);
  assert.deepEqual(
    pathRowActions(0).map((a) => a.action),
    ['load', 'fill', 'stroke', 'duplicate', 'rename', 'delete']
  );
  assert.equal(pathRowActions('work')[3].action, 'save');
});

function mount(paths, canPaint = true) {
  const dom = new JSDOM('<!doctype html><body><div id="c"></div></body>');
  const doc = dom.window.document;
  globalThis.document = doc;
  const container = doc.getElementById('c');
  const calls = [];
  const log =
    (name) =>
    (...args) =>
      calls.push([name, ...args]);
  renderPathsPanel(container, paths, {
    canMakeWorkPath: false,
    canPaint,
    onTarget: log('target'),
    onFill: log('fill'),
    onStroke: log('stroke'),
    onLoad: log('load'),
    onMakeWorkPath: log('workPath'),
    onNew: log('new'),
    onDelete: log('delete'),
    onDuplicate: log('duplicate'),
    onRename: log('rename')
  });
  const row = (key) => container.querySelector(`.path-row[data-path="${key}"]`);
  const menu = () => doc.querySelector('.layer-popup-menu[role="menu"]');
  const items = () => [...(menu()?.querySelectorAll('[role="menuitem"]') ?? [])];
  const item = (label) => items().find((b) => b.textContent === label);
  const context = (el) =>
    el.dispatchEvent(
      new dom.window.MouseEvent('contextmenu', {
        bubbles: true,
        cancelable: true,
        clientX: 40,
        clientY: 50
      })
    );
  return { dom, doc, row, menu, items, item, context, calls };
}

test('right-clicking a saved row targets it and opens its menu', () => {
  const { row, menu, items, context, calls } = mount(sample());
  const ev = context(row(1));
  assert.equal(ev, false, 'the browser menu is suppressed');
  assert.deepEqual(calls, [['target', 1]]);
  assert.ok(menu());
  assert.deepEqual(
    items().map((b) => b.textContent),
    ['Make Selection', 'Fill Path', 'Stroke Path…', 'Duplicate Path', 'Rename Path…', 'Delete Path']
  );
});

test('menu items run their panel callbacks and close the menu', () => {
  for (const [label, expected] of [
    ['Make Selection', ['load']],
    ['Fill Path', ['fill']],
    ['Stroke Path…', ['stroke']],
    ['Duplicate Path', ['duplicate', 1]],
    ['Delete Path', ['delete']]
  ]) {
    const { row, menu, item, context, calls } = mount(sample());
    context(row(1));
    item(label).click();
    assert.deepEqual(calls.slice(1), [expected], label);
    assert.equal(menu(), null, `${label} closes the menu`);
  }
});

test('Save Path saves the Work Path under the first free Path N', () => {
  const { row, item, context, calls } = mount(sample());
  context(row('work'));
  assert.equal(item('Duplicate Path'), undefined);
  assert.equal(item('Rename Path…'), undefined);
  item('Save Path').click();
  assert.deepEqual(calls, [
    ['target', 'work'],
    ['rename', 'work', 'Path 2']
  ]);
});

test('Rename Path… opens the inline name field', () => {
  const { row, item, context, calls } = mount(sample());
  context(row(1));
  item('Rename Path…').click();
  const input = row(1).querySelector('input.path-rename');
  assert.ok(input);
  assert.equal(input.value, 'Logo');
  assert.equal(calls.length, 1);
});

test('Fill and Stroke are disabled when the target layer cannot be painted', () => {
  const { row, item, context } = mount(sample(), false);
  context(row(1));
  assert.equal(item('Fill Path').disabled, true);
  assert.equal(item('Stroke Path…').disabled, true);
  assert.equal(item('Make Selection').disabled, false);
});

test('Escape closes the menu without running anything', () => {
  const { dom, doc, row, menu, context, calls } = mount(sample());
  context(row(0));
  doc.dispatchEvent(new dom.window.KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
  assert.equal(menu(), null);
  assert.deepEqual(calls, [['target', 0]]);
});

test('Layers and Paths share one popup menu module; paint.js wires Duplicate Path', () => {
  const read = (f) => fs.readFileSync(new URL(`../paint/${f}`, import.meta.url), 'utf8');
  assert.match(read('popup-menu.js'), /export function openPopupMenu\(/);
  assert.match(read('layers.js'), /from '\.\/popup-menu\.js'/);
  assert.doesNotMatch(read('layers.js'), /function openLayerMenu\(/);
  assert.match(read('paths-panel.js'), /from '\.\/popup-menu\.js'/);
  const paint = read('paint.js');
  assert.match(
    paint,
    /onDuplicate: \(key\) => setPaths\(duplicatePath\(state\.paths, key\), 'Duplicate Path'\)/
  );
  assert.match(paint, /canPaint:/);
  assert.match(read('history.js'), /'Duplicate Path'/);
});
