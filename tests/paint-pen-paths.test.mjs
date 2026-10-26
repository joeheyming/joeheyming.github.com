import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { JSDOM } from 'jsdom';
import {
  deleteTargetPath,
  deserializePaths,
  emptyPaths,
  newPath,
  pathMask,
  pathToPolygon,
  penDrag,
  penPress,
  renderPathsPanel,
  selectionToPath,
  serializePaths,
  targetPath,
  withTargetPath
} from '../paint/paths.js';
import { TOOLS, scanlineFill } from '../paint/tools.js';
import { TOOL_GROUPS, toolKey } from '../paint/tool-groups.js';

// A circle of radius r about (cx, cy) as four smooth anchors (κ = 0.5523).
function circlePath(cx, cy, r) {
  const k = 0.5522847498 * r;
  const a = (x, y, ix, iy, ox, oy) => ({ x, y, in: [ix, iy], out: [ox, oy] });
  return {
    name: 'Work Path',
    subpaths: [
      {
        closed: true,
        anchors: [
          a(cx + r, cy, cx + r, cy - k, cx + r, cy + k),
          a(cx, cy + r, cx + k, cy + r, cx - k, cy + r),
          a(cx - r, cy, cx - r, cy + k, cx - r, cy - k),
          a(cx, cy - r, cx - k, cy - r, cx + k, cy - r)
        ]
      }
    ]
  };
}

function polyArea(poly) {
  let a = 0;
  for (let i = 0; i < poly.length; i++) {
    const [x1, y1] = poly[i];
    const [x2, y2] = poly[(i + 1) % poly.length];
    a += x1 * y2 - x2 * y1;
  }
  return Math.abs(a) / 2;
}

test('pathToPolygon flattens a circle-ish path within tolerance', () => {
  const [poly, ...rest] = pathToPolygon(circlePath(50, 40, 30), 0.25);
  assert.equal(rest.length, 0);
  assert.ok(poly.length >= 16, `only ${poly.length} points`);
  assert.deepEqual(poly[0], [80, 40]);
  // Closed: the first point is not repeated at the end.
  assert.notDeepEqual(poly[poly.length - 1], poly[0]);
  for (const [x, y] of poly) {
    const d = Math.hypot(x - 50, y - 40);
    assert.ok(Math.abs(d - 30) < 0.1, `point at radius ${d}`);
  }
  const area = polyArea(poly);
  assert.ok(Math.abs(area - Math.PI * 900) / (Math.PI * 900) < 0.01, `area ${area}`);
  // A looser tolerance uses fewer points.
  assert.ok(pathToPolygon(circlePath(50, 40, 30), 4)[0].length < poly.length);
});

test('Load as Selection matches scanlineFill of the flattened path', () => {
  const W = 100,
    H = 80;
  const path = circlePath(50, 40, 30);
  const mask = pathMask(path, W, H);
  const expected = scanlineFill(pathToPolygon(path)[0], W, H);
  assert.deepEqual(mask, expected);
  assert.equal(mask[40 * W + 50], 1);
  assert.equal(mask[2 * W + 2], 0);
  const count = mask.reduce((n, v) => n + v, 0);
  assert.ok(Math.abs(count - Math.PI * 900) < 120, `selected ${count}`);
});

test('two subpaths fill even-odd: an inner ring is a hole', () => {
  const outer = circlePath(50, 40, 30).subpaths[0];
  const inner = circlePath(50, 40, 10).subpaths[0];
  const mask = pathMask({ name: 'p', subpaths: [outer, inner] }, 100, 80);
  assert.equal(mask[40 * 100 + 50], 0, 'centre is in the hole');
  assert.equal(mask[40 * 100 + 70], 1, 'ring is filled');
});

test('Pen: clicks place corners, a drag makes a smooth point, a click on the start closes', () => {
  let r = penPress(null, 10, 10);
  assert.equal(r.closed, false);
  r = penPress(r.path, 50, 10, { continuing: true });
  const dragged = penDrag(r.path, r.anchor, 60, 20);
  const smooth = dragged.subpaths[0].anchors[1];
  assert.deepEqual(smooth.out, [60, 20]);
  assert.deepEqual(smooth.in, [40, 0]);
  // The first anchor is still a corner, and the original path is untouched.
  assert.deepEqual(dragged.subpaths[0].anchors[0].out, [10, 10]);
  assert.deepEqual(r.path.subpaths[0].anchors[1].out, [50, 10]);
  r = penPress(dragged, 30, 50, { continuing: true });
  r = penPress(r.path, 12, 11, { continuing: true, closeRadius: 6 });
  assert.equal(r.closed, true);
  const sp = r.path.subpaths[0];
  assert.equal(sp.closed, true);
  assert.equal(sp.anchors.length, 3);
  // Not continuing starts another subpath.
  r = penPress(r.path, 70, 70);
  assert.equal(r.path.subpaths.length, 2);
});

test('the Pen tool writes the Work Path and closes it on the first anchor', () => {
  const ov = { canvas: { width: 100, height: 100 } };
  for (const k of ['clearRect', 'save', 'restore', 'beginPath', 'moveTo', 'lineTo', 'stroke']) {
    ov[k] = () => {};
  }
  ov.bezierCurveTo = ov.fillRect = ov.strokeRect = () => {};
  const undo = [];
  const state = { zoom: 1, paths: emptyPaths(), drawing: false };
  state.setPaths = (next, label) => {
    if (label) undo.push(label);
    state.paths = next;
  };
  const click = (x, y, dx = x, dy = y) => {
    TOOLS.pen.onDown(null, ov, state, x, y);
    TOOLS.pen.onMove(null, ov, state, dx, dy);
    TOOLS.pen.onUp(null, ov, state, dx, dy);
  };
  click(10, 10);
  click(80, 10, 90, 30);
  click(80, 80);
  assert.equal(state.drawing, true);
  click(10, 10);
  assert.equal(state.drawing, false);
  assert.equal(state.paths.target, 'work');
  const work = targetPath(state.paths);
  assert.equal(work.name, 'Work Path');
  assert.equal(work.subpaths[0].closed, true);
  assert.deepEqual(work.subpaths[0].anchors[1].out, [90, 30]);
  assert.deepEqual(undo, ['Pen', 'Pen', 'Pen', 'Pen']);
  assert.ok(pathMask(work, 100, 100)[50 * 100 + 50]);
});

test('Make Work Path from Selection traces the selection outline', () => {
  const W = 40,
    H = 30;
  const sel = new Uint8Array(W * H);
  for (let y = 5; y < 20; y++) for (let x = 8; x < 30; x++) sel[y * W + x] = 1;
  const path = selectionToPath(sel, W, H, 2);
  assert.equal(path.subpaths.length, 1);
  const pts = path.subpaths[0].anchors.map((a) => [a.x, a.y]);
  assert.equal(pts.length, 4);
  for (const corner of [
    [8, 5],
    [30, 5],
    [30, 20],
    [8, 20]
  ]) {
    assert.ok(
      pts.some((p) => p[0] === corner[0] && p[1] === corner[1]),
      `${corner}`
    );
  }
  // A selection with a hole gives two subpaths, and loading it back keeps the hole.
  for (let y = 10; y < 15; y++) for (let x = 15; x < 22; x++) sel[y * W + x] = 0;
  const holed = selectionToPath(sel, W, H, 2);
  assert.equal(holed.subpaths.length, 2);
  const back = pathMask(holed, W, H);
  assert.equal(back[12 * W + 18], 0);
  assert.equal(back[7 * W + 10], 1);
});

test('New, Delete, and the target: saving the Work Path and adding paths', () => {
  let paths = withTargetPath(emptyPaths(), circlePath(10, 10, 5));
  assert.equal(paths.target, 'work');
  paths = newPath(paths);
  assert.equal(paths.work, null);
  assert.equal(paths.saved[0].name, 'Path 1');
  assert.equal(paths.target, 0);
  paths = newPath({ ...paths, target: null });
  assert.equal(paths.saved[1].name, 'Path 2');
  assert.equal(paths.saved[1].subpaths.length, 0);
  paths = deleteTargetPath({ ...paths, target: 0 });
  assert.deepEqual(
    paths.saved.map((p) => p.name),
    ['Path 2']
  );
  assert.equal(paths.target, null);
});

test('paths round-trip through .paintproj, and older files have none', () => {
  const paths = newPath(withTargetPath(emptyPaths(), circlePath(20, 20, 8)));
  const withWork = withTargetPath({ ...paths, target: null }, circlePath(5, 5, 2));
  const json = JSON.parse(JSON.stringify(serializePaths(withWork)));
  const back = deserializePaths(json);
  assert.deepEqual(back.saved, withWork.saved);
  assert.deepEqual(back.work, withWork.work);
  assert.equal(back.target, null);
  assert.deepEqual(deserializePaths(undefined), emptyPaths());
  assert.equal(serializePaths(emptyPaths()), null);
});

test('Paths panel lists Work Path and saved paths with the six footer buttons', () => {
  const { document } = new JSDOM('<div id="c"></div>').window;
  // iconSvg builds the footer icons with the global document.
  globalThis.document = document;
  const container = document.getElementById('c');
  const calls = [];
  const paths = {
    work: circlePath(10, 10, 5),
    saved: [{ name: 'Path 1', subpaths: [] }],
    target: 'work'
  };
  const on = (name) => () => calls.push(name);
  renderPathsPanel(container, paths, {
    canMakeWorkPath: false,
    onTarget: (t) => calls.push(`target:${t}`),
    onFill: on('fill'),
    onStroke: on('stroke'),
    onLoad: on('load'),
    onMakeWorkPath: on('work-path'),
    onNew: on('new'),
    onDelete: on('delete')
  });
  const rows = [...container.querySelectorAll('.path-row')];
  assert.deepEqual(
    rows.map((r) => r.textContent),
    ['Work Path', 'Path 1']
  );
  assert.equal(rows[0].getAttribute('aria-selected'), 'true');
  assert.ok(rows[0].classList.contains('work'));
  rows[1].click();
  const buttons = [...container.querySelectorAll('.layer-footer-btn')];
  assert.deepEqual(
    buttons.map((b) => b.dataset.action),
    ['fill', 'stroke', 'load', 'work-path', 'new', 'delete']
  );
  assert.equal(buttons[3].disabled, true);
  for (const b of buttons) b.click();
  assert.deepEqual(calls, ['target:0', 'fill', 'stroke', 'load', 'new', 'delete']);
});

test('the Pen has its own tool slot, key P, and the Paths panel has a container', () => {
  assert.ok(TOOL_GROUPS.some((g) => g[0] === 'pen'));
  assert.equal(toolKey('pen'), 'P');
  assert.equal(TOOLS.pen.icon, 'pen-tool');
  const html = fs.readFileSync(new URL('../paint/index.html', import.meta.url), 'utf8');
  const { document } = new JSDOM(html).window;
  assert.ok(document.querySelector('#panel-paths #path-list-container'));
});
