import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  CROP_OVERLAYS,
  CROP_OVERLAY_SHOW,
  cropGuides,
  cropNextOverlay,
  cropOverlayOrientations,
  cropOverlayShows,
  drawCropOverlay
} from '../paint/crop-frame.js';
import { TOOLS, TOOL_OPTION_SCHEMA, cropToolGuides, defaultToolOptions } from '../paint/tools.js';

const near = (a, b, eps = 1e-6) => Math.abs(a - b) <= eps;
const vertical = (g) => g.filter((l) => l[0][0] === l[1][0]);
const horizontal = (g) => g.filter((l) => l[0][1] === l[1][1]);

function recordingOverlay(width = 400, height = 300) {
  const calls = [];
  const target = { canvas: { width, height }, calls };
  return new Proxy(target, {
    get(t, key) {
      if (key in t) return t[key];
      return (...args) => calls.push([key, ...args]);
    },
    set(t, key, value) {
      t[key] = value;
      return true;
    }
  });
}

function cropState(frame = [0, 0, 300, 200]) {
  return { toolOptions: defaultToolOptions(), zoom: 1, cropFrame: frame, cropAngle: 0 };
}

test('CROP_OVERLAYS and CROP_OVERLAY_SHOW follow PhotoCraft order and labels', () => {
  assert.deepEqual(CROP_OVERLAYS, [
    { value: 'thirds', label: 'Rule of Thirds' },
    { value: 'grid', label: 'Grid' },
    { value: 'diagonal', label: 'Diagonal' },
    { value: 'triangle', label: 'Triangle' },
    { value: 'goldenRatio', label: 'Golden Ratio' },
    { value: 'goldenSpiral', label: 'Golden Spiral' }
  ]);
  assert.deepEqual(CROP_OVERLAY_SHOW, [
    { value: 'auto', label: 'Auto Show Overlay' },
    { value: 'always', label: 'Always Show Overlay' },
    { value: 'never', label: 'Never Show Overlay' }
  ]);
});

test('cropOverlayShows: Auto only during a gesture, Always, Never', () => {
  assert.equal(cropOverlayShows('auto', true), true);
  assert.equal(cropOverlayShows('auto', false), false);
  assert.equal(cropOverlayShows('always', false), true);
  assert.equal(cropOverlayShows('always', true), true);
  assert.equal(cropOverlayShows('never', true), false);
  assert.equal(cropOverlayShows('never', false), false);
});

test('cropOverlayOrientations: the Spiral has four, the Triangle two, the rest one', () => {
  assert.equal(cropOverlayOrientations('goldenSpiral'), 4);
  assert.equal(cropOverlayOrientations('triangle'), 2);
  for (const k of ['thirds', 'grid', 'diagonal', 'goldenRatio']) {
    assert.equal(cropOverlayOrientations(k), 1);
  }
  assert.equal(cropNextOverlay('thirds'), 'grid');
  assert.equal(cropNextOverlay('goldenRatio'), 'goldenSpiral');
  assert.equal(cropNextOverlay('goldenSpiral'), 'thirds');
});

test('Rule of Thirds lines sit at a third and two thirds in frame px', () => {
  const g = cropGuides('thirds', 0, 300, 200);
  assert.equal(g.length, 4);
  assert.deepEqual(
    vertical(g).map((l) => l[0][0]),
    [100, 200]
  );
  assert.ok(near(horizontal(g)[0][0][1], 200 / 3));
  assert.ok(near(horizontal(g)[1][0][1], 400 / 3));
  assert.deepEqual(vertical(g)[0], [
    [100, 0],
    [100, 200]
  ]);
  // Symmetric overlays ignore the orientation.
  assert.deepEqual(cropGuides('thirds', 1, 300, 200), g);
});

test('Golden Ratio lines sit at 1 − 1/φ and 1/φ', () => {
  const g = cropGuides('goldenRatio', 0, 1, 1);
  assert.equal(g.length, 4);
  const xs = vertical(g).map((l) => l[0][0]);
  assert.ok(near(xs[0], 0.381966) && near(xs[1], 0.618034), String(xs));
  const ys = horizontal(g).map((l) => l[0][1]);
  assert.ok(near(ys[0], 0.381966) && near(ys[1], 0.618034), String(ys));
});

test('Grid spacing is about 32 screen px, bounded, and follows the zoom', () => {
  const g = cropGuides('grid', 0, 640, 320);
  assert.equal(vertical(g).length, 19);
  assert.equal(horizontal(g).length, 9);
  assert.deepEqual(vertical(g)[0], [
    [32, 0],
    [32, 320]
  ]);
  // A small frame still gets one line per axis (two cells).
  const small = cropGuides('grid', 0, 10, 10);
  assert.equal(vertical(small).length, 1);
  assert.equal(horizontal(small).length, 1);
  assert.deepEqual(vertical(small)[0][0], [5, 0]);
  // At most 95 lines per axis however large.
  const huge = cropGuides('grid', 0, 1e6, 1e6);
  assert.equal(vertical(huge).length, 95);
  // 320 x 160 doc px at 2× zoom is 640 x 320 on screen: the same cells.
  const zoomed = cropGuides('grid', 0, 320, 160, 2);
  assert.equal(vertical(zoomed).length, 19);
  assert.equal(horizontal(zoomed).length, 9);
  assert.deepEqual(vertical(zoomed)[0], [
    [16, 0],
    [16, 160]
  ]);
});

test('Diagonal lines run at 45° from each corner to the far edge', () => {
  const g = cropGuides('diagonal', 0, 300, 200);
  const want = [
    [0, 0, 200, 200],
    [300, 0, 100, 200],
    [0, 200, 200, 0],
    [300, 200, 100, 0]
  ];
  assert.equal(g.length, 4);
  g.forEach((l, i) =>
    assert.ok(
      l.flat().every((v, k) => near(v, want[i][k])),
      String(l)
    )
  );
  const square = cropGuides('diagonal', 0, 100, 100);
  assert.deepEqual(square[0], [
    [0, 0],
    [100, 100]
  ]);
});

test('Triangle: the diagonal and its perpendiculars, mirrored in orientation 1', () => {
  const w = 300;
  const h = 200;
  const g = cropGuides('triangle', 0, w, h);
  assert.equal(g.length, 3);
  assert.deepEqual(g[0], [
    [0, 0],
    [300, 200]
  ]);
  const t = (w * w) / (w * w + h * h);
  assert.deepEqual(g[1][0], [300, 0]);
  assert.ok(near(g[1][1][0], t * w) && near(g[1][1][1], t * h));
  assert.deepEqual(g[2][0], [0, 200]);
  assert.ok(near(g[2][1][0], (1 - t) * w) && near(g[2][1][1], (1 - t) * h));
  // The perpendiculars meet the diagonal at right angles.
  for (const l of g.slice(1)) {
    const d = [l[1][0] - l[0][0], l[1][1] - l[0][1]];
    assert.ok(Math.abs(d[0] * w + d[1] * h) < 1e-6);
  }
  // Orientation 1: the diagonal runs top-right to bottom-left.
  const m = cropGuides('triangle', 1, w, h);
  assert.deepEqual(m[0], [
    [300, 0],
    [0, 200]
  ]);
  for (let i = 0; i < 3; i++) {
    for (let j = 0; j < 2; j++) {
      assert.ok(near(m[i][j][0], w - g[i][j][0]) && near(m[i][j][1], g[i][j][1]));
    }
  }
  // Two orientations: 2 is 0 again.
  assert.deepEqual(cropGuides('triangle', 2, w, h), g);
  // A tall frame uses the other branch and still lands its feet on the diagonal.
  const tall = cropGuides('triangle', 0, 200, 300);
  const s = (200 * 200) / (200 * 200 + 300 * 300);
  assert.ok(near(tall[1][1][0], s * 200) && near(tall[1][1][1], s * 300));
});

test('Golden Spiral: one polyline from the bottom-left corner to the golden point', () => {
  const g = cropGuides('goldenSpiral', 0, 300, 200);
  assert.equal(g.length, 1);
  const pts = g[0];
  assert.ok(pts.length > 40, `${pts.length} points`);
  assert.deepEqual(pts[0], [0, 200]);
  const [ex, ey] = pts[pts.length - 1];
  assert.ok(near(ex / 300, 0.7236, 0.02) && near(ey / 200, 0.7236, 0.02), `${ex}, ${ey}`);
  for (const [x, y] of pts) {
    assert.ok(x >= 0 && x <= 300 && y >= 0 && y <= 200, `${x}, ${y} outside the frame`);
  }
  // The first arc turns about the first square's bottom-right corner up to its top edge.
  assert.ok(pts[12][1] < 1e-9 && near(pts[12][0], 300 / (1 + 0.618034)), 'first arc ends on top');
});

test('Golden Spiral orientations mirror it into each corner; 4 wraps to 0', () => {
  const base = cropGuides('goldenSpiral', 0, 300, 200)[0];
  for (let o = 1; o < 4; o++) {
    const g = cropGuides('goldenSpiral', o, 300, 200)[0];
    assert.equal(g.length, base.length);
    base.forEach(([x, y], i) => {
      const mx = o & 1 ? 300 - x : x;
      const my = o & 2 ? 200 - y : y;
      assert.ok(near(g[i][0], mx) && near(g[i][1], my), `orientation ${o} point ${i}`);
    });
  }
  assert.deepEqual(cropGuides('goldenSpiral', 1, 300, 200)[0][0], [300, 200]);
  assert.deepEqual(cropGuides('goldenSpiral', 2, 300, 200)[0][0], [0, 0]);
  assert.deepEqual(cropGuides('goldenSpiral', 3, 300, 200)[0][0], [300, 0]);
  assert.deepEqual(
    cropGuides('goldenSpiral', 4, 300, 200),
    cropGuides('goldenSpiral', 0, 300, 200)
  );
  // Symmetric overlays still ignore the orientation.
  assert.deepEqual(cropGuides('thirds', 3, 300, 200), cropGuides('thirds', 0, 300, 200));
});

test('degenerate frames have no guides', () => {
  for (const { value } of CROP_OVERLAYS) {
    assert.deepEqual(cropGuides(value, 0, 0, 10), []);
    assert.deepEqual(cropGuides(value, 0, 10, Number.NaN), []);
    assert.deepEqual(cropGuides(value, 0, 0.5, 100), []);
  }
  assert.deepEqual(cropGuides('spiral', 0, 100, 100), []);
});

test('the crop schema defaults to Rule of Thirds and Auto Show', () => {
  const schema = TOOL_OPTION_SCHEMA.crop;
  const overlay = schema.find((o) => o.key === 'cropOverlay');
  const show = schema.find((o) => o.key === 'cropOverlayShow');
  assert.equal(overlay.type, 'select');
  assert.equal(overlay.default, 'thirds');
  assert.deepEqual(overlay.options, CROP_OVERLAYS);
  assert.equal(show.type, 'select');
  assert.equal(show.default, 'auto');
  assert.deepEqual(show.options, CROP_OVERLAY_SHOW);
  const opts = defaultToolOptions().crop;
  assert.equal(opts.cropOverlay, 'thirds');
  assert.equal(opts.cropOverlayShow, 'auto');
  // Picking an overlay starts its orientation over.
  assert.deepEqual(overlay.onSelect('triangle'), {
    cropOverlay: 'triangle',
    cropOverlayOrientation: 0
  });
});

test('cropToolGuides shows the guides by mode and gesture', () => {
  const state = cropState();
  assert.deepEqual(cropToolGuides(state), [], 'Auto: none without a drag');
  state.cropDrag = { hit: 'inside' };
  assert.equal(cropToolGuides(state).length, 4, 'Auto: the thirds while dragging');
  state.toolOptions.crop.cropOverlayShow = 'never';
  assert.deepEqual(cropToolGuides(state), []);
  state.cropDrag = null;
  state.toolOptions.crop.cropOverlayShow = 'always';
  state.toolOptions.crop.cropOverlay = 'triangle';
  assert.equal(cropToolGuides(state).length, 3);
});

test('O and Shift+O cycle the overlay and its orientation', () => {
  const ov = recordingOverlay();
  const state = cropState();
  const opts = state.toolOptions.crop;
  const seen = [opts.cropOverlay];
  for (let i = 0; i < 6; i++) {
    TOOLS.crop.cycleOverlay(ov, state);
    seen.push(opts.cropOverlay);
  }
  assert.deepEqual(seen, [
    'thirds',
    'grid',
    'diagonal',
    'triangle',
    'goldenRatio',
    'goldenSpiral',
    'thirds'
  ]);
  TOOLS.crop.cycleOrientation(ov, state);
  assert.equal(opts.cropOverlayOrientation, 0, 'thirds has one orientation');
  opts.cropOverlay = 'triangle';
  TOOLS.crop.cycleOrientation(ov, state);
  assert.equal(opts.cropOverlayOrientation, 1);
  TOOLS.crop.cycleOrientation(ov, state);
  assert.equal(opts.cropOverlayOrientation, 0);
  TOOLS.crop.cycleOrientation(ov, state);
  TOOLS.crop.cycleOverlay(ov, state);
  assert.equal(opts.cropOverlay, 'goldenRatio');
  assert.equal(opts.cropOverlayOrientation, 0, 'O starts the orientation over');
  TOOLS.crop.cycleOverlay(ov, state);
  assert.equal(opts.cropOverlay, 'goldenSpiral');
  const turns = [];
  for (let i = 0; i < 5; i++) {
    TOOLS.crop.cycleOrientation(ov, state);
    turns.push(opts.cropOverlayOrientation);
  }
  assert.deepEqual(turns, [1, 2, 3, 0, 1]);
  TOOLS.crop.cycleOverlay(ov, state);
  assert.equal(opts.cropOverlay, 'thirds', 'wraps to Rule of Thirds');
  assert.equal(opts.cropOverlayOrientation, 0);
});

test('drawCropOverlay strokes the guides in the frame axes at a constant screen width', () => {
  const ov = recordingOverlay();
  const guides = cropGuides('thirds', 0, 300, 200);
  drawCropOverlay(ov, [10, 20, 310, 220], 2, 0, guides);
  const moves = ov.calls.filter((c) => c[0] === 'moveTo').map((c) => c.slice(1));
  assert.ok(
    moves.some(([x, y]) => x === 110 && y === 20),
    'first third offset by the frame'
  );
  assert.equal(ov.lineWidth, 0.5);
  const without = recordingOverlay();
  drawCropOverlay(without, [10, 20, 310, 220], 2, 0, []);
  assert.ok(!without.calls.some((c) => c[0] === 'moveTo' && c[1] === 110));
});

test('paint.js routes O / Shift+O to the crop overlay before the tool keys', async () => {
  const { readFileSync } = await import('node:fs');
  const src = readFileSync(new URL('../paint/paint.js', import.meta.url), 'utf8');
  const crop = src.indexOf("if (state.tool === 'crop' && !state.cropDrag)");
  const oKey = src.indexOf("if (key === 'o')", crop);
  const toolKeys = src.indexOf('toolForKey(e.key');
  assert.ok(crop > 0 && oKey > crop && oKey < toolKeys);
  assert.match(src.slice(oKey, oKey + 300), /cycleOrientation[\s\S]*cycleOverlay/);
});
