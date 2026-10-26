import test from 'node:test';
import assert from 'node:assert/strict';
import { curvatureAnchors, fitTrace, freeformSubpath } from '../paint/pen-variants.js';
import { emptyPaths, pathMask, segmentPoint, targetPath } from '../paint/paths.js';
import { TOOLS, TOOL_OPTION_SCHEMA } from '../paint/tools.js';
import { TOOL_GROUPS, toolKey } from '../paint/tool-groups.js';
import { ICONS } from '../paint/icons.js';

// Dense samples of every segment of a subpath.
function curveSamples(sp, per = 400) {
  const a = sp.anchors;
  const segs = sp.closed ? a.length : a.length - 1;
  const out = [];
  for (let i = 0; i < segs; i++) {
    for (let k = 0; k <= per; k++) out.push(segmentPoint(a[i], a[(i + 1) % a.length], k / per));
  }
  return out;
}

// Largest distance from a trace sample to the fitted subpath.
function maxDeviation(sp, trace) {
  const curve = curveSamples(sp);
  let worst = 0;
  for (const [x, y] of trace) {
    let best = Infinity;
    for (const [cx, cy] of curve) best = Math.min(best, Math.hypot(cx - x, cy - y));
    worst = Math.max(worst, best);
  }
  return worst;
}

const cross = (a, b) => a[0] * b[1] - a[1] * b[0];
const minus = (p, q) => [p[0] - q[0], p[1] - q[1]];
const at = (a) => [a.x, a.y];

test('Freeform Pen fit stays within Curve Fit of a sine trace', () => {
  const trace = [];
  for (let i = 0; i <= 300; i++) trace.push([10 + i, 100 + 40 * Math.sin((i / 300) * 3 * Math.PI)]);
  for (const fit of [1, 2, 5]) {
    const sp = fitTrace(trace, fit, false);
    assert.equal(sp.closed, false);
    const dev = maxDeviation(sp, trace);
    assert.ok(dev <= fit + 0.05, `curve fit ${fit}: deviation ${dev}`);
    // A sine needs no more than two segments per half period.
    assert.ok(sp.anchors.length - 1 <= 6, `${sp.anchors.length} anchors at ${fit}`);
    assert.deepEqual(at(sp.anchors[0]), trace[0]);
    assert.deepEqual(at(sp.anchors[sp.anchors.length - 1]), trace[trace.length - 1]);
  }
  // A looser fit never needs more anchors.
  assert.ok(fitTrace(trace, 10).anchors.length <= fitTrace(trace, 0.5).anchors.length);
});

test('a jittery straight drag is one straight segment', () => {
  const line = [];
  for (let i = 0; i <= 100; i++) line.push([10 + 3 * i, 50 + (i % 2 ? -0.5 : 0.5)]);
  const sp = fitTrace(line, 2, false);
  assert.equal(sp.anchors.length, 2);
  assert.ok(maxDeviation(sp, line) <= 2.05);
});

test('a zig-zag keeps its corners as corner anchors', () => {
  const pts = [
    [0, 0],
    [60, 60],
    [120, 0],
    [180, 60],
    [240, 0],
    [300, 60]
  ];
  const trace = [];
  for (let s = 0; s + 1 < pts.length; s++) {
    for (let k = 0; k < 30; k++) {
      const t = k / 30;
      const [a, b] = [pts[s], pts[s + 1]];
      trace.push([a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t]);
    }
  }
  trace.push(pts[pts.length - 1]);
  const sp = fitTrace(trace, 2, false);
  assert.equal(sp.anchors.length, 6);
  sp.anchors.forEach((a, i) => {
    assert.ok(Math.hypot(a.x - pts[i][0], a.y - pts[i][1]) < 2.5, `anchor ${i} at ${at(a)}`);
  });
  assert.ok(maxDeviation(sp, trace) <= 2.05);
});

test('a trace ending on its start closes into a smooth loop within tolerance', () => {
  const trace = [];
  for (let i = 0; i <= 240; i++) {
    const t = (i / 240) * 2 * Math.PI;
    trace.push([100 + 80 * Math.cos(t), 100 + 80 * Math.sin(t)]);
  }
  const sp = freeformSubpath(trace, 2, 6);
  assert.equal(sp.closed, true);
  assert.ok(sp.anchors.length >= 2 && sp.anchors.length <= 8, `${sp.anchors.length} anchors`);
  assert.ok(maxDeviation(sp, trace) <= 2.05);
  // The closed path's interior is the disc.
  const mask = pathMask({ name: 'Work Path', subpaths: [sp] }, 200, 200);
  assert.equal(mask[100 * 200 + 100], 1);
  assert.equal(mask[100 * 200 + 185], 0);
  // An open stroke stays open, and a click draws nothing.
  assert.equal(freeformSubpath(trace.slice(0, 120), 2, 6).closed, false);
  assert.equal(freeformSubpath([[5, 5]], 2, 6), null);
});

test('Curvature Pen: smooth points have collinear handles parallel to the chord', () => {
  const pts = [
    [10, 80],
    [50, 20],
    [130, 40],
    [160, 100]
  ];
  const a = curvatureAnchors(pts);
  assert.equal(a.length, 4);
  a.forEach((k, i) => assert.deepEqual(at(k), pts[i]));
  for (const i of [1, 2]) {
    const k = a[i];
    const hin = minus(k.in, at(k)),
      hout = minus(k.out, at(k));
    const chord = minus(pts[i + 1], pts[i - 1]);
    // Collinear and opposite, along the neighbours' chord.
    assert.ok(Math.abs(cross(hin, hout)) < 1e-9);
    assert.ok(hin[0] * hout[0] + hin[1] * hout[1] < 0);
    assert.ok(Math.abs(cross(hout, chord)) < 1e-9);
    // Each a third of the distance to the neighbour on its side.
    const dPrev = Math.hypot(...minus(pts[i], pts[i - 1])),
      dNext = Math.hypot(...minus(pts[i + 1], pts[i]));
    assert.ok(Math.abs(Math.hypot(...hin) - dPrev / 3) < 1e-9);
    assert.ok(Math.abs(Math.hypot(...hout) - dNext / 3) < 1e-9);
  }
  // Open ends aim at the neighbour's nearer handle, a third of the way along.
  const out0 = minus(a[0].out, pts[0]);
  assert.ok(Math.abs(cross(out0, minus(a[1].in, pts[0]))) < 1e-9);
  assert.ok(Math.abs(Math.hypot(...out0) - Math.hypot(...minus(pts[1], pts[0])) / 3) < 1e-9);
  assert.deepEqual(a[0].in, pts[0]);
  const in3 = minus(a[3].in, pts[3]);
  assert.ok(Math.abs(cross(in3, minus(a[2].out, pts[3]))) < 1e-9);
  assert.deepEqual(a[3].out, pts[3]);
});

test('Curvature Pen: closed paths are smooth everywhere, corners retract, no NaN', () => {
  const sq = [
    [0, 0],
    [100, 0],
    [100, 100],
    [0, 100]
  ];
  const closed = curvatureAnchors(sq, [], true);
  for (const [i, k] of closed.entries()) {
    const chord = minus(sq[(i + 1) % 4], sq[(i + 3) % 4]);
    assert.ok(Math.abs(cross(minus(k.out, at(k)), chord)) < 1e-9, `point ${i}`);
    assert.ok(Math.hypot(...minus(k.out, at(k))) > 1);
  }
  const corner = curvatureAnchors(sq, [false, true], false);
  assert.deepEqual(corner[1].in, sq[1]);
  assert.deepEqual(corner[1].out, sq[1]);
  const same = curvatureAnchors(
    [
      [5, 5],
      [5, 5],
      [5, 5]
    ],
    [],
    false
  );
  for (const k of same) for (const v of [...k.in, ...k.out]) assert.ok(Number.isFinite(v));
});

function overlay() {
  const ov = { canvas: { width: 200, height: 200 } };
  for (const k of [
    'clearRect',
    'save',
    'restore',
    'beginPath',
    'moveTo',
    'lineTo',
    'stroke',
    'bezierCurveTo',
    'fillRect',
    'strokeRect'
  ]) {
    ov[k] = () => {};
  }
  return ov;
}

function penState() {
  const undo = [];
  const state = { zoom: 1, paths: emptyPaths(), drawing: false, toolOptions: {} };
  state.setPaths = (next, label) => {
    if (label) undo.push(label);
    state.paths = next;
  };
  return { state, undo };
}

test('the Freeform Pen tool fits its drag into the Work Path at the Curve Fit option', () => {
  const ov = overlay();
  const { state, undo } = penState();
  state.toolOptions.freeformPen = { curveFit: 1 };
  const trace = [];
  for (let i = 0; i <= 150; i++) trace.push([20 + i, 100 + 30 * Math.sin(i / 25)]);
  TOOLS.freeformPen.onDown(null, ov, state, ...trace[0]);
  assert.equal(state.drawing, true);
  for (const p of trace.slice(1, -1)) TOOLS.freeformPen.onMove(null, ov, state, ...p);
  TOOLS.freeformPen.onUp(null, ov, state, ...trace[trace.length - 1]);
  assert.equal(state.drawing, false);
  assert.deepEqual(undo, ['Freeform Pen']);
  const work = targetPath(state.paths);
  assert.equal(work.name, 'Work Path');
  assert.equal(work.subpaths.length, 1);
  assert.ok(maxDeviation(work.subpaths[0], trace) <= 1.05);
  // A second drag adds another subpath to the same path.
  TOOLS.freeformPen.onDown(null, ov, state, 10, 10);
  TOOLS.freeformPen.onMove(null, ov, state, 40, 12);
  TOOLS.freeformPen.onUp(null, ov, state, 70, 10);
  assert.equal(targetPath(state.paths).subpaths.length, 2);
  assert.equal(TOOL_OPTION_SCHEMA.freeformPen[0].key, 'curveFit');
  assert.equal(TOOL_OPTION_SCHEMA.freeformPen[0].default, 2);
});

test('the Curvature Pen tool flows through clicks, moves, toggles, and closes', () => {
  const ov = overlay();
  const { state, undo } = penState();
  const click = (x, y, dx = x, dy = y) => {
    TOOLS.curvaturePen.onDown(null, ov, state, x, y);
    TOOLS.curvaturePen.onMove(null, ov, state, dx, dy);
    TOOLS.curvaturePen.onUp(null, ov, state, dx, dy);
  };
  click(20, 100);
  click(60, 30, 70, 20); // dragged: the new point follows the pointer
  click(140, 60);
  assert.equal(state.drawing, true);
  let sp = targetPath(state.paths).subpaths[0];
  assert.equal(sp.anchors.length, 3);
  assert.deepEqual(at(sp.anchors[1]), [70, 20]);
  const k = sp.anchors[1];
  assert.ok(Math.abs(cross(minus(k.out, at(k)), minus([140, 60], [20, 100]))) < 1e-9);
  // The curve passes through every clicked point.
  assert.deepEqual(segmentPoint(sp.anchors[0], sp.anchors[1], 1), [70, 20]);

  // A double-click on a point makes it a corner.
  TOOLS.curvaturePen.toggle(ov, state, 70, 20);
  sp = targetPath(state.paths).subpaths[0];
  assert.deepEqual(sp.anchors[1].in, [70, 20]);
  assert.deepEqual(sp.anchors[1].out, [70, 20]);
  TOOLS.curvaturePen.toggle(ov, state, 70, 20);

  // A press on the first point closes the subpath.
  click(20, 100);
  assert.equal(state.drawing, false);
  sp = targetPath(state.paths).subpaths[0];
  assert.equal(sp.closed, true);
  assert.equal(sp.anchors.length, 3);
  for (const a of sp.anchors) assert.ok(Math.hypot(...minus(a.out, at(a))) > 1, 'smooth');
  assert.equal(targetPath(state.paths).subpaths.length, 1);
  assert.ok(undo.every((l) => l === 'Curvature Pen') && undo.length >= 4);

  // The next click starts a new subpath; end() leaves it open.
  click(150, 150);
  click(180, 170);
  TOOLS.curvaturePen.end(ov, state);
  const path = targetPath(state.paths);
  assert.equal(path.subpaths.length, 2);
  assert.equal(path.subpaths[1].closed, false);
});

test('PhotoCraft pen group, key P, and icons', () => {
  const pen = TOOL_GROUPS.find((g) => g[0] === 'pen');
  assert.deepEqual(pen.slice(0, 3), ['pen', 'freeformPen', 'curvaturePen']);
  assert.equal(toolKey('freeformPen'), 'P');
  assert.equal(toolKey('curvaturePen'), 'P');
  assert.equal(TOOLS.freeformPen.label, 'Freeform Pen');
  assert.equal(TOOLS.curvaturePen.label, 'Curvature Pen');
  assert.ok(ICONS[TOOLS.freeformPen.icon]);
  assert.ok(ICONS[TOOLS.curvaturePen.icon]);
});
