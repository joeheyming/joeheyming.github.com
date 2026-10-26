import test from 'node:test';
import assert from 'node:assert/strict';
import {
  addAnchor,
  anchorsInBox,
  bendSegment,
  convertPoint,
  deleteAnchor,
  hitPath,
  isSmoothAnchor,
  moveHandle,
  moveSubpaths,
  pathToPolygon,
  segmentPoint,
  subpathAt
} from '../paint/paths.js';
import { TOOLS } from '../paint/tools.js';
import { TOOL_GROUPS, toolKey } from '../paint/tool-groups.js';
import { ICONS } from '../paint/icons.js';

const A = (x, y, ix = x, iy = y, ox = x, oy = y) => ({ x, y, in: [ix, iy], out: [ox, oy] });

// One open cubic from (0, 0) to (90, 0) bulging up, then a straight segment to (90, 60).
function curvePath() {
  return {
    name: 'Work Path',
    subpaths: [{ closed: false, anchors: [A(0, 0, 0, 0, 20, -60), A(90, 0, 70, -60), A(90, 60)] }]
  };
}

// Two closed squares, 10 px and 40 px across.
function twoSquares() {
  const sq = (x, y, w) => ({
    closed: true,
    anchors: [A(x, y), A(x + w, y), A(x + w, y + w), A(x, y + w)]
  });
  return { name: 'Work Path', subpaths: [sq(0, 0, 10), sq(50, 50, 40)] };
}

const near = (a, b, eps = 1e-9) =>
  assert.ok(Math.abs(a - b) <= eps, `${a} is not within ${eps} of ${b}`);

test('Add Anchor Point splits a curve by de Casteljau and keeps its shape', () => {
  const path = curvePath();
  const [s0, s1] = path.subpaths[0].anchors;
  const r = addAnchor(path, 0, 0, 0.3);
  assert.deepEqual(r.anchor, [0, 1]);
  const [a, m, b] = r.path.subpaths[0].anchors;
  assert.equal(r.path.subpaths[0].anchors.length, 4);
  // The new anchor is on the old curve and smooth.
  const at = segmentPoint(s0, s1, 0.3);
  near(m.x, at[0]);
  near(m.y, at[1]);
  assert.ok(isSmoothAnchor(m));
  // Each half retraces its part of the original curve.
  for (const u of [0.1, 0.25, 0.5, 0.75, 0.9]) {
    const p = segmentPoint(a, m, u);
    const q = segmentPoint(s0, s1, 0.3 * u);
    near(p[0], q[0], 1e-9);
    near(p[1], q[1], 1e-9);
    const p2 = segmentPoint(m, b, u);
    const q2 = segmentPoint(s0, s1, 0.3 + 0.7 * u);
    near(p2[0], q2[0], 1e-9);
    near(p2[1], q2[1], 1e-9);
  }
  // The input path is untouched.
  assert.deepEqual(path, curvePath());
});

test('Add Anchor Point on a straight segment adds a corner on the line', () => {
  const r = addAnchor(curvePath(), 0, 1, 0.5);
  const m = r.path.subpaths[0].anchors[2];
  assert.deepEqual(m, A(90, 30));
  assert.equal(addAnchor(curvePath(), 0, 2, 0.5), null, 'no segment leaves an open end');
  assert.equal(addAnchor(curvePath(), 0, 0, 1), null);
});

test('Delete Anchor Point joins the neighbours and refuses the last anchor', () => {
  const next = deleteAnchor(curvePath(), 0, 1);
  assert.deepEqual(next.subpaths[0].anchors, [A(0, 0, 0, 0, 20, -60), A(90, 60)]);
  // A one-anchor subpath goes with its anchor; the path's only anchor is refused.
  const two = { name: 'p', subpaths: [{ closed: false, anchors: [A(1, 1)] }, curvePath().subpaths[0]] };
  assert.equal(deleteAnchor(two, 0, 0).subpaths.length, 1);
  assert.equal(deleteAnchor({ name: 'p', subpaths: [{ closed: false, anchors: [A(1, 1)] }] }, 0, 0), null);
});

test('Convert Point zeroes handles on click and pulls out mirrored ones on drag', () => {
  const smooth = A(50, 50, 40, 50, 60, 50);
  const path = { name: 'p', subpaths: [{ closed: false, anchors: [A(0, 0), smooth, A(100, 0)] }] };
  assert.ok(isSmoothAnchor(path.subpaths[0].anchors[1]));
  const corner = convertPoint(path, 0, 1).subpaths[0].anchors[1];
  assert.deepEqual(corner, A(50, 50));
  assert.ok(!isSmoothAnchor(corner));
  const back = convertPoint(convertPoint(path, 0, 1), 0, 1, [70, 40]).subpaths[0].anchors[1];
  assert.deepEqual(back, A(50, 50, 30, 60, 70, 40));
  assert.ok(isSmoothAnchor(back));
});

test('Direct Selection handle drags keep a smooth point collinear unless ⌥ breaks it', () => {
  const path = { name: 'p', subpaths: [{ closed: false, anchors: [A(50, 50, 40, 50, 60, 50)] }] };
  const turned = moveHandle(path, 0, 0, 'out', 50, 80).subpaths[0].anchors[0];
  assert.deepEqual(turned.out, [50, 80]);
  near(turned.in[0], 50);
  near(turned.in[1], 40);
  const broken = moveHandle(path, 0, 0, 'out', 50, 80, true).subpaths[0].anchors[0];
  assert.deepEqual(broken.in, [40, 50]);
});

test('bendSegment moves the point under the pointer and a straight segment moves whole', () => {
  const path = curvePath();
  const before = segmentPoint(...path.subpaths[0].anchors.slice(0, 2), 0.4);
  const bent = bendSegment(path, 0, 0, 0.4, 5, 7);
  const after = segmentPoint(...bent.subpaths[0].anchors.slice(0, 2), 0.4);
  near(after[0], before[0] + 5, 1e-9);
  near(after[1], before[1] + 7, 1e-9);
  const line = bendSegment(path, 0, 1, 0.5, 3, 0).subpaths[0].anchors;
  assert.equal(line[1].x, 93);
  assert.equal(line[2].x, 93);
  assert.equal(line[0].x, 0);
});

test('hitPath prefers handles, then anchors, then the nearest segment', () => {
  const path = curvePath();
  assert.deepEqual(hitPath(path, 1, 1, 3), { type: 'anchor', s: 0, k: 0 });
  assert.deepEqual(hitPath(path, 20, -59, 3, [[0, 0, 'out']]), { type: 'handle', s: 0, k: 0, h: 'out' });
  const seg = hitPath(path, 91, 30, 3);
  assert.equal(seg.type, 'segment');
  assert.equal(seg.k, 1);
  near(seg.t, 0.5, 0.02);
  assert.equal(hitPath(path, 40, 40, 3), null);
  assert.deepEqual(anchorsInBox(path, 80, -10, 100, 70), [
    [0, 1],
    [0, 2]
  ]);
});

test('Path Selection picks a subpath by outline or interior and moves only it', () => {
  const path = twoSquares();
  assert.equal(subpathAt(path, 70, 70, 3), 1);
  assert.equal(subpathAt(path, 10, 5, 3), 0);
  assert.equal(subpathAt(path, 30, 30, 3), -1);
  const moved = moveSubpaths(path, [1], 5, -2);
  assert.deepEqual(moved.subpaths[0], path.subpaths[0]);
  assert.deepEqual(
    moved.subpaths[1].anchors.map((a) => [a.x, a.y]),
    [
      [55, 48],
      [95, 48],
      [95, 88],
      [55, 88]
    ]
  );
});

// ── The tools, driven like pointer.js does ───────────────────────────────────

function fakeOverlay() {
  const ov = new Proxy({}, { get: (t, k) => (k in t ? t[k] : () => {}), set: (t, k, v) => ((t[k] = v), true) });
  ov.canvas = { width: 200, height: 200 };
  return ov;
}

function toolState(path) {
  const undo = [];
  const state = {
    zoom: 1,
    paths: { work: path, saved: [], target: 'work' },
    pathAnchors: [],
    setPaths(next, label) {
      if (label) undo.push(label);
      state.paths = next;
    }
  };
  return { state, undo };
}

function drag(id, state, from, ...to) {
  const ov = fakeOverlay();
  TOOLS[id].onDown(null, ov, state, ...from);
  for (const p of to) if (state.drawing) TOOLS[id].onMove(null, ov, state, ...p);
  if (state.drawing) TOOLS[id].onUp(null, ov, state, ...(to.at(-1) ?? from));
}

test('Path Selection tool drags a whole subpath in one history step', () => {
  const { state, undo } = toolState(twoSquares());
  drag('pathSelection', state, [70, 70], [72.4, 71], [80.2, 66]);
  const sp = state.paths.work.subpaths;
  assert.deepEqual(sp[0], twoSquares().subpaths[0]);
  assert.deepEqual([sp[1].anchors[0].x, sp[1].anchors[0].y], [60, 46]);
  assert.deepEqual(undo, ['Path Selection']);
});

test('Direct Selection tool selects an anchor, drags it, and marquee-selects', () => {
  const { state, undo } = toolState(twoSquares());
  drag('directSelection', state, [50, 50], [45, 40]);
  assert.deepEqual(state.pathAnchors, [[1, 0]]);
  const sp = state.paths.work.subpaths[1].anchors;
  assert.deepEqual([sp[0].x, sp[0].y], [45, 40]);
  assert.deepEqual([sp[1].x, sp[1].y], [90, 50], 'the other anchors stay');
  assert.deepEqual(undo, ['Direct Selection']);
  drag('directSelection', state, [-5, -5], [20, 20]);
  assert.equal(state.pathAnchors.length, 4);
  assert.ok(state.pathAnchors.every(([s]) => s === 0));
  assert.deepEqual(undo, ['Direct Selection'], 'a marquee changes no path');
});

test('the anchor tools add, delete, and convert through clicks', () => {
  const { state, undo } = toolState(curvePath());
  drag('addAnchorPoint', state, [90, 30]);
  assert.equal(state.paths.work.subpaths[0].anchors.length, 4);
  drag('deleteAnchorPoint', state, [90, 30]);
  assert.equal(state.paths.work.subpaths[0].anchors.length, 3);
  drag('convertPoint', state, [90, 0]);
  assert.deepEqual(state.paths.work.subpaths[0].anchors[1], A(90, 0));
  drag('convertPoint', state, [90, 0], [100, 10]);
  assert.deepEqual(state.paths.work.subpaths[0].anchors[1], A(90, 0, 80, -10, 100, 10));
  assert.deepEqual(undo, [
    'Add Anchor Point',
    'Delete Anchor Point',
    'Convert Point',
    'Convert Point'
  ]);
});

test('PhotoCraft tool groups, keys, and icons', () => {
  const pen = TOOL_GROUPS.find((g) => g[0] === 'pen');
  assert.deepEqual(pen, [
    'pen',
    'freeformPen',
    'curvaturePen',
    'addAnchorPoint',
    'deleteAnchorPoint',
    'convertPoint'
  ]);
  assert.deepEqual(TOOL_GROUPS[TOOL_GROUPS.indexOf(pen) + 1], ['pathSelection', 'directSelection']);
  assert.equal(toolKey('pathSelection'), 'A');
  assert.equal(toolKey('directSelection'), 'A');
  assert.equal(toolKey('convertPoint'), 'P');
  for (const id of [...pen, 'pathSelection', 'directSelection']) assert.ok(ICONS[TOOLS[id].icon]);
  assert.equal(TOOLS.pathSelection.icon, 'mouse-pointer-2');
  assert.equal(TOOLS.directSelection.icon, 'direct-select');
});

test('pathToPolygon still sees the split path as the same outline', () => {
  const path = curvePath();
  const split = addAnchor(path, 0, 0, 0.5).path;
  const a = pathToPolygon(path, 0.1)[0];
  const b = pathToPolygon(split, 0.1)[0];
  assert.deepEqual(a[0], b[0]);
  assert.deepEqual(a.at(-1), b.at(-1));
});
