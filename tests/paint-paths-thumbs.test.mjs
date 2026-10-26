import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { JSDOM } from 'jsdom';
import {
  cornerAnchor,
  emptyPath,
  pathLoadMode,
  pathThumbLines,
  renderPathsPanel
} from '../paint/paths.js';

const tri = {
  name: 'Work Path',
  subpaths: [
    { closed: true, anchors: [cornerAnchor(0, 0), cornerAnchor(100, 0), cornerAnchor(100, 50)] }
  ]
};

const near = (a, b) => a.every((v, i) => Math.abs(v - b[i]) < 1e-9);

test('pathThumbLines fits the document into the thumbnail, centred', () => {
  const lines = pathThumbLines(tri, 100, 50, 28);
  assert.equal(lines.length, 1);
  assert.equal(lines[0].closed, true);
  const pts = lines[0].points;
  assert.ok(near(pts[0], [0, 7]), String(pts[0]));
  assert.ok(pts.some((p) => near(p, [28, 7])));
  assert.ok(pts.some((p) => near(p, [28, 21])));
  // A tall document letterboxes left and right.
  const tall = pathThumbLines(
    { name: 'T', subpaths: [{ closed: false, anchors: [cornerAnchor(0, 0), cornerAnchor(50, 100)] }] },
    50,
    100,
    28
  );
  assert.equal(tall[0].closed, false);
  assert.ok(near(tall[0].points[0], [7, 0]));
  assert.ok(near(tall[0].points.at(-1), [21, 28]));
  assert.deepEqual(pathThumbLines(emptyPath('E'), 100, 50, 28), []);
  assert.deepEqual(pathThumbLines(tri, 0, 0, 28), []);
});

test('pathLoadMode follows channels_panel load_operation', () => {
  assert.equal(pathLoadMode({}), 'replace');
  assert.equal(pathLoadMode({ shiftKey: true }), 'add');
  assert.equal(pathLoadMode({ altKey: true }), 'subtract');
  assert.equal(pathLoadMode({ shiftKey: true, altKey: true }), 'intersect');
});

function mount(paths) {
  const dom = new JSDOM('<!doctype html><div id="c"></div>');
  const doc = dom.window.document;
  const container = doc.getElementById('c');
  const calls = [];
  const noop = () => {};
  renderPathsPanel(container, paths, {
    width: 100,
    height: 50,
    canMakeWorkPath: false,
    onTarget: (k) => calls.push(['target', k]),
    onFill: noop,
    onStroke: noop,
    onLoad: noop,
    onLoadPath: (k, mode) => calls.push(['load', k, mode]),
    onMakeWorkPath: noop,
    onNew: noop,
    onDelete: noop,
    onRename: noop
  });
  const row = (key) => container.querySelector(`.path-row[data-path="${key}"]`);
  const click = (el, init = {}) =>
    el.dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true, ...init }));
  return { dom, container, row, click, calls };
}

const sample = () => ({ work: tri, saved: [{ ...tri, name: 'Outline' }], target: 'work' });

test('each row is a 28 px thumbnail canvas then the name label', () => {
  const { row } = mount(sample());
  for (const key of ['work', '0']) {
    const r = row(key);
    const thumb = r.firstElementChild;
    assert.equal(thumb.tagName, 'CANVAS');
    assert.ok(thumb.classList.contains('path-thumb'));
    assert.equal(thumb.width, 28);
    assert.equal(thumb.height, 28);
    assert.ok(r.querySelector('.path-name'));
  }
  assert.equal(row('0').querySelector('.path-name').textContent, 'Outline');
  assert.equal(row('0').textContent, 'Outline');
});

test('Ctrl / Cmd-click on the thumbnail loads that path without retargeting', () => {
  const { row, click, calls } = mount(sample());
  click(row('0').querySelector('.path-thumb'), { ctrlKey: true });
  click(row('0').querySelector('.path-thumb'), { metaKey: true, shiftKey: true });
  click(row('work').querySelector('.path-thumb'), { ctrlKey: true, altKey: true });
  click(row('0').querySelector('.path-thumb'), { ctrlKey: true, shiftKey: true, altKey: true });
  assert.deepEqual(calls, [
    ['load', 0, 'replace'],
    ['load', 0, 'add'],
    ['load', 'work', 'subtract'],
    ['load', 0, 'intersect']
  ]);
});

test('a plain thumbnail click, or Ctrl-click on the name, targets the row', () => {
  const { row, click, calls } = mount(sample());
  click(row('0').querySelector('.path-thumb'));
  click(row('work').querySelector('.path-name'), { ctrlKey: true });
  assert.deepEqual(calls, [
    ['target', 0],
    ['target', 'work']
  ]);
});

test('clicking the empty list area deselects the path', () => {
  const { container, click, calls } = mount(sample());
  click(container.querySelector('.path-list'));
  assert.deepEqual(calls, [['target', null]]);
});

test('renaming swaps only the label; the thumbnail stays', () => {
  const { dom, row } = mount(sample());
  row('0').dispatchEvent(new dom.window.MouseEvent('dblclick', { bubbles: true }));
  const input = row('0').querySelector('input.path-rename');
  assert.ok(input);
  assert.ok(row('0').querySelector('.path-thumb'));
  input.dispatchEvent(new dom.window.KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
  assert.ok(row('0').querySelector('.path-thumb'));
  assert.equal(row('0').querySelector('.path-name').textContent, 'Outline');
});

test('paint.js passes the document size and loads a path by key and mode', () => {
  const src = fs.readFileSync(new URL('../paint/paint.js', import.meta.url), 'utf8');
  assert.match(src, /renderPathsPanel\(container, state\.paths, \{[\s\S]*?width: canvasW\(\)/);
  assert.match(src, /onLoadPath: \(key, mode\) =>/);
});
