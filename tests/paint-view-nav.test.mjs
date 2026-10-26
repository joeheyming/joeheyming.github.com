// US-206: View › Fit on Screen, Fit Layer(s) on Screen, 100% / 200%, Flip Horizontal, Screen
// Mode, and the Hand, Zoom, and Rotate View tools. Pure view math (paint/view.js).
import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  ZOOM_MAX,
  ZOOM_STEP,
  anchorView,
  docToView,
  fitBounds,
  fitOnScreen,
  fitZoom,
  nextScreenMode,
  rotateViewAngle,
  screenModeClasses,
  viewPivot,
  viewToDoc,
  viewTransformCss,
  zoomCentered,
  zoomToRect
} from '../paint/view.js';
import { COMMANDS_BY_ID, commandForKey } from '../paint/commands.js';
import { TOOLS, TOOL_GROUPS, toolForKey } from '../paint/tools.js';

const W = 400,
  H = 300;
const base = { zoom: 1, panX: 0, panY: 0, flip: false, rotation: 0 };
const near = (a, b, eps = 1e-9) => assert.ok(Math.abs(a - b) < eps, `${a} ≉ ${b}`);
const nearPt = (a, b, eps = 1e-9) => {
  near(a[0], b[0], eps);
  near(a[1], b[1], eps);
};

test('Fit on Screen fits with a 20 px margin, never past 100%, and centres the document', () => {
  // 840 × 640 area: (840 - 40) / 400 = 2, (640 - 40) / 300 = 2, capped at 1.
  let v = fitOnScreen(base, W, H, 840, 640);
  assert.equal(v.zoom, 1);
  nearPt(docToView(v, W, H, W / 2, H / 2), [420, 320]);
  // 440 × 640 area: (440 - 40) / 400 = 1 wins over 2 → 1; a narrower one shrinks.
  v = fitOnScreen({ ...base, zoom: 3, panX: 99 }, W, H, 240, 640);
  assert.equal(v.zoom, 0.5);
  nearPt(docToView(v, W, H, W / 2, H / 2), [120, 320]);
  nearPt(docToView(v, W, H, 0, 0), [20, 245]);
  assert.equal(fitZoom(400, 300, 440, 190), 0.5);
});

test('Fit Layer(s) on Screen zooms past 100% and centres on the layer bounds', () => {
  const b = { x0: 100, y0: 50, x1: 150, y1: 100 };
  const v = fitBounds(base, W, H, b, 540, 440);
  // min((540 - 40) / 50, (440 - 40) / 50) = 8.
  assert.equal(v.zoom, 8);
  nearPt(docToView(v, W, H, 125, 75), [270, 220]);
  nearPt(docToView(v, W, H, 100, 50), [70, 20]);
  // No layer pixels: fit the whole document (uncapped).
  assert.equal(fitBounds(base, W, H, null, 840, 640).zoom, 2);
});

test('100% and 200% keep the area centre still', () => {
  const v0 = { ...base, zoom: 0.5, panX: 30, panY: 10 };
  const docAtCentre = viewToDoc(v0, W, H, 300, 200);
  const v = zoomCentered(v0, W, H, 600, 400, 2);
  assert.equal(v.zoom, 2);
  nearPt(docToView(v, W, H, ...docAtCentre), [300, 200]);
});

test('view ↔ document mapping round-trips with flip and rotation', () => {
  for (const flip of [false, true]) {
    for (const rotation of [0, 30, 90, -135, 180]) {
      const v = { zoom: 1.5, panX: 40, panY: -25, flip, rotation };
      for (const [x, y] of [
        [0, 0],
        [W, H],
        [37, 251],
        [W / 2, H / 2]
      ]) {
        nearPt(viewToDoc(v, W, H, ...docToView(v, W, H, x, y)), [x, y]);
      }
      // Rotation and flip pivot on the document centre.
      nearPt(docToView(v, W, H, W / 2, H / 2), viewPivot(v, W, H));
    }
  }
});

test('Flip Horizontal mirrors the view only, about the document centre', () => {
  const v = { ...base, flip: true };
  nearPt(docToView(v, W, H, 0, 0), [W, 0]);
  nearPt(docToView(v, W, H, 100, 40), [300, 40]);
  // A click at view (10, 20) lands on the mirrored document pixel.
  nearPt(viewToDoc(v, W, H, 10, 20), [390, 20]);
  assert.match(viewTransformCss(v, W, H), /scale\(-1,1\)/);
  assert.equal(viewTransformCss(base, W, H), 'translate(0px,0px) scale(1)');
});

test('Rotate View turns clockwise about the document centre', () => {
  const v = { ...base, rotation: 90 };
  // Top-left corner (-200, -150 from centre) turns to (150, -200) from centre.
  nearPt(docToView(v, W, H, 0, 0), [350, -50]);
  nearPt(viewToDoc(v, W, H, 350, -50), [0, 0]);
  const flipped = { ...v, flip: true };
  // Mirror first: (200, -150) → turned (150, 200).
  nearPt(docToView(flipped, W, H, 0, 0), [350, 350]);
  assert.equal(
    viewTransformCss(v, W, H),
    'translate(0px,0px) scale(1) translate(200px,150px) rotate(90deg) translate(-200px,-150px)'
  );
});

test('Rotate View drag angle follows the pointer sweep; Shift snaps to 15°', () => {
  const c = [100, 100];
  near(rotateViewAngle(0, c, [200, 100], [100, 200]), 90);
  near(rotateViewAngle(10, c, [200, 100], [100, 0]), -80);
  near(rotateViewAngle(170, c, [200, 100], [100, 200]), -100);
  assert.equal(rotateViewAngle(0, c, [200, 100], [200, 120], true), 15);
});

test('Zoom tool: a drag fills the area with the rectangle, a click steps in, ⌥ steps out', () => {
  // A 100 × 50 view rect in a 600 × 400 area: k = min(6, 8) = 6.
  let v = zoomToRect(base, W, H, [100, 100], [200, 150], 600, 400);
  assert.equal(v.zoom, 6);
  nearPt(docToView(v, W, H, 150, 125), [300, 200]);
  // Dragging the other way gives the same rectangle.
  const back = zoomToRect(base, W, H, [200, 150], [100, 100], 600, 400);
  assert.equal(back.zoom, 6);
  // A click zooms in one step at the press point.
  v = zoomToRect(base, W, H, [80, 60], [81, 61], 600, 400);
  near(v.zoom, ZOOM_STEP);
  nearPt(docToView(v, W, H, 80, 60), [80, 60]);
  // ⌥-click zooms out.
  v = zoomToRect(base, W, H, [80, 60], [80, 60], 600, 400, true);
  near(v.zoom, 1 / ZOOM_STEP);
  nearPt(docToView(v, W, H, 80, 60), [80, 60]);
  // The rectangle maps through a turned view.
  const turned = { ...base, rotation: 90, flip: true };
  v = zoomToRect(turned, W, H, [100, 100], [200, 150], 600, 400);
  nearPt(docToView(v, W, H, ...viewToDoc(turned, W, H, 150, 125)), [300, 200]);
  assert.equal(zoomToRect({ ...base, zoom: 10 }, W, H, [0, 0], [10, 10], 600, 400).zoom, ZOOM_MAX);
});

test('anchorView keeps a document point under a view point', () => {
  const v = anchorView({ ...base, rotation: 45, flip: true }, W, H, [10, 290], [5, 7], 3);
  nearPt(docToView(v, W, H, 10, 290), [5, 7]);
});

test('Screen Mode cycles with F and hides chrome', () => {
  assert.equal(nextScreenMode('standard'), 'fullScreenWithMenuBar');
  assert.equal(nextScreenMode('fullScreenWithMenuBar'), 'fullScreen');
  assert.equal(nextScreenMode('fullScreen'), 'standard');
  assert.deepEqual(screenModeClasses('standard'), {
    'screen-full-menu': false,
    'screen-full': false
  });
  assert.deepEqual(screenModeClasses('fullScreenWithMenuBar'), {
    'screen-full-menu': true,
    'screen-full': false
  });
  assert.deepEqual(screenModeClasses('fullScreen'), {
    'screen-full-menu': true,
    'screen-full': true
  });
});

test('View commands sit in the View menu and run their ctx action', () => {
  const ran = [];
  const ctx = {
    fitOnScreen: () => ran.push('fit'),
    fitLayersOnScreen: () => ran.push('fitLayers'),
    zoomTo: (z) => ran.push(`zoom${z}`),
    flipView: () => ran.push('flip'),
    setScreenMode: (m) => ran.push(m)
  };
  const ids = [
    'view.fitOnScreen',
    'view.fitLayersOnScreen',
    'view.twoHundredPercent',
    'view.flipHorizontal',
    'view.screenMode.standard',
    'view.screenMode.fullScreenWithMenuBar',
    'view.screenMode.fullScreen'
  ];
  for (const id of ids) {
    const cmd = COMMANDS_BY_ID.get(id);
    assert.ok(cmd, id);
    assert.equal(cmd.menu[0], 'View');
    cmd.run(ctx);
  }
  assert.deepEqual(ran, [
    'fit',
    'fitLayers',
    'zoom2',
    'flip',
    'standard',
    'fullScreenWithMenuBar',
    'fullScreen'
  ]);
  assert.deepEqual(COMMANDS_BY_ID.get('view.screenMode.fullScreen').menu, ['View', 'Screen Mode']);
  assert.equal(COMMANDS_BY_ID.get('view.flipHorizontal').checked({ viewFlip: true }), true);
  assert.equal(COMMANDS_BY_ID.get('view.screenMode.standard').checked({}), true);
  assert.equal(
    COMMANDS_BY_ID.get('view.screenMode.fullScreen').checked({ screenMode: 'fullScreen' }),
    true
  );
  const key = { key: '0', code: 'Digit0', ctrlKey: true, metaKey: false, altKey: false };
  assert.equal(commandForKey({ ...key, shiftKey: false })?.id, 'view.fitOnScreen');
  const one = { key: '1', code: 'Digit1', ctrlKey: true, metaKey: false, altKey: false };
  assert.equal(commandForKey({ ...one, shiftKey: false })?.id, 'view.actualPixels');
});

test('Hand, Rotate View, and Zoom join the toolbox with H, R, and Z', () => {
  assert.deepEqual(TOOL_GROUPS.slice(-2), [['hand', 'rotateView'], ['zoom']]);
  assert.equal(TOOLS.hand.label, 'Hand');
  assert.equal(TOOLS.rotateView.icon, 'compass');
  assert.equal(TOOLS.zoom.icon, 'zoom-in');
  assert.equal(toolForKey('h', false, 'brush'), 'hand');
  assert.equal(toolForKey('r', false, 'brush'), 'rotateView');
  assert.equal(toolForKey('z', false, 'brush'), 'zoom');
});
