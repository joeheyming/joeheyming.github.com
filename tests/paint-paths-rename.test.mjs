import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { JSDOM } from 'jsdom';
import { cornerAnchor, emptyPath, renamePath, renderPathsPanel } from '../paint/paths.js';

const square = {
  name: 'Work Path',
  subpaths: [{ closed: true, anchors: [cornerAnchor(1, 1), cornerAnchor(5, 1), cornerAnchor(5, 5)] }]
};

function sample() {
  return { work: square, saved: [emptyPath('Path 1'), emptyPath('Outline')], target: null };
}

test('renamePath saves the Work Path under the typed name and targets it', () => {
  const paths = sample();
  const next = renamePath(paths, 'work', '  Logo  ');
  assert.equal(next.work, null);
  assert.equal(next.saved.length, 3);
  assert.equal(next.saved[2].name, 'Logo');
  assert.deepEqual(next.saved[2].subpaths, square.subpaths);
  assert.equal(next.target, 2);
});

test('renamePath renames a saved path and targets it', () => {
  const paths = sample();
  const next = renamePath(paths, 1, ' Border ');
  assert.equal(next.saved[1].name, 'Border');
  assert.equal(next.saved[0], paths.saved[0]);
  assert.equal(next.work, square);
  assert.equal(next.target, 1);
});

test('renamePath ignores blank, unchanged, and missing names without mutating', () => {
  const paths = sample();
  const snapshot = JSON.stringify(paths);
  assert.equal(renamePath(paths, 0, '   '), paths);
  assert.equal(renamePath(paths, 'work', ''), paths);
  assert.equal(renamePath(paths, 1, ' Outline '), paths);
  assert.equal(renamePath(paths, 5, 'Nope'), paths);
  assert.equal(renamePath({ ...paths, work: null }, 'work', 'X').saved.length, 2);
  renamePath(paths, 'work', 'Logo');
  renamePath(paths, 0, 'Other');
  assert.equal(JSON.stringify(paths), snapshot);
});

function mount(paths) {
  const dom = new JSDOM('<!doctype html><body><div id="c"></div></body>');
  const doc = dom.window.document;
  globalThis.document = doc;
  const container = doc.getElementById('c');
  const calls = [];
  const noop = () => {};
  renderPathsPanel(container, paths, {
    canMakeWorkPath: false,
    onTarget: noop,
    onFill: noop,
    onStroke: noop,
    onLoad: noop,
    onMakeWorkPath: noop,
    onNew: noop,
    onDelete: noop,
    onRename: (key, name) => calls.push([key, name])
  });
  const row = (key) => container.querySelector(`.path-row[data-path="${key}"]`);
  const dbl = (el) => el.dispatchEvent(new dom.window.MouseEvent('dblclick', { bubbles: true }));
  const key = (input, k) =>
    input.dispatchEvent(new dom.window.KeyboardEvent('keydown', { key: k, bubbles: true }));
  return { dom, doc, row, dbl, key, calls };
}

test('double-clicking a saved path opens a focused, selected name field; Enter commits', () => {
  const { doc, row, dbl, key, calls } = mount(sample());
  dbl(row(1));
  const input = row(1).querySelector('input.path-rename');
  assert.ok(input);
  assert.equal(input.getAttribute('aria-label'), 'Path name');
  assert.equal(input.value, 'Outline');
  assert.equal(doc.activeElement, input);
  assert.equal(input.selectionStart, 0);
  assert.equal(input.selectionEnd, 'Outline'.length);
  input.value = 'Border';
  key(input, 'Enter');
  assert.deepEqual(calls, [[1, 'Border']]);
  assert.equal(row(1).querySelector('input'), null);
  assert.equal(row(1).textContent, 'Outline');
});

test('the Work Path proposes the first free Path N and commits on blur', () => {
  const { row, dbl, calls } = mount(sample());
  dbl(row('work'));
  const input = row('work').querySelector('input.path-rename');
  assert.equal(input.value, 'Path 2');
  input.dispatchEvent(new input.ownerDocument.defaultView.FocusEvent('blur'));
  assert.deepEqual(calls, [['work', 'Path 2']]);
  input.dispatchEvent(new input.ownerDocument.defaultView.FocusEvent('blur'));
  assert.equal(calls.length, 1);
});

test('Escape restores the label without renaming', () => {
  const { row, dbl, key, calls } = mount(sample());
  dbl(row(0));
  const input = row(0).querySelector('input.path-rename');
  input.value = 'Changed';
  key(input, 'Escape');
  assert.deepEqual(calls, []);
  assert.equal(row(0).textContent, 'Path 1');
});

test('paint.js routes onRename through renamePath and setPaths', () => {
  const src = fs.readFileSync(new URL('../paint/paint.js', import.meta.url), 'utf8');
  assert.match(src, /onRename: \(key, name\) => \{[\s\S]*?renamePath\(state\.paths, key, name\)/);
  assert.match(src, /key === 'work' \? 'Save Path' : 'Rename Path'/);
});
