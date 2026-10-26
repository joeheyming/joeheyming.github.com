import { test } from 'node:test';
import assert from 'node:assert/strict';

// createLayer and the project loader need document.createElement('canvas'); a tiny
// ImageData-backed stub keeps this test browser-free.
function fakeCanvas() {
  const canvas = {
    width: 0,
    height: 0,
    className: '',
    dataset: {},
    style: {},
    pixels: null,
    getContext: () => ctx,
    toDataURL: () => 'data:image/png;base64,'
  };
  const ensure = () => {
    if (!canvas.pixels || canvas.pixels.length !== canvas.width * canvas.height * 4) {
      canvas.pixels = new Uint8ClampedArray(canvas.width * canvas.height * 4);
    }
  };
  const ctx = {
    canvas,
    getImageData(x, y, w, h) {
      ensure();
      return { width: w, height: h, data: canvas.pixels.slice() };
    },
    putImageData(img) {
      ensure();
      canvas.pixels.set(img.data);
    }
  };
  return canvas;
}

globalThis.document = { createElement: () => fakeCanvas() };

const {
  BACKGROUND_NAME,
  LAYER_ZERO_NAME,
  backgroundPixels,
  canMoveLayer,
  hasBackground,
  isBackgroundLayer,
  liftIsEmpty,
  liftLayerPixels,
  nextLayerName,
  stackWithBackground,
  unlockBackground
} = await import('../paint/layer-new.js');
const { createLayer } = await import('../paint/layers.js');
const { TOOLS, defaultToolOptions } = await import('../paint/tools.js');
const { eraseDab, eraseSquareDab } = await import('../paint/retouch.js');
const { COMMANDS } = await import('../paint/commands.js');
const { snapshotStack, restoreStack, isStackUndoLabel } = await import('../paint/stack-history.js');
const { serializeProject, deserializeProject } = await import('../paint/project.js');
const { newLayerSettings } = await import('../paint/new-layer-dialog.js');

const W = 4,
  H = 3;
const px = (buf, x, y) => Array.from(buf.subarray((y * W + x) * 4, (y * W + x) * 4 + 4));

// Every pixel a distinct opaque colour: [10 * p, 20, 30, 255].
function layerPixels() {
  const src = new Uint8ClampedArray(W * H * 4);
  for (let p = 0; p < W * H; p++) src.set([10 * p, 20, 30, 255], p * 4);
  return src;
}

// The 2 x 2 selection at x 1..2, y 0..1.
function selection() {
  const mask = new Uint8Array(W * H);
  for (const [x, y] of [
    [1, 0],
    [2, 0],
    [1, 1],
    [2, 1]
  ])
    mask[y * W + x] = 1;
  return mask;
}

test('Layer via Copy lifts only the selected pixels and leaves the layer alone', () => {
  const src = layerPixels();
  const before = src.slice();
  const { lifted, rest } = liftLayerPixels(src, selection(), false);
  assert.equal(rest, null);
  assert.deepEqual(src, before);
  assert.deepEqual(px(lifted, 1, 0), [10, 20, 30, 255]);
  assert.deepEqual(px(lifted, 2, 1), [60, 20, 30, 255]);
  assert.deepEqual(px(lifted, 0, 0), [0, 0, 0, 0]);
  assert.deepEqual(px(lifted, 3, 2), [0, 0, 0, 0]);
  assert.equal(liftIsEmpty(lifted), false);
});

test('Layer via Cut lifts the selection and clears it: transparent, or the background colour', () => {
  const src = layerPixels();
  const cut = liftLayerPixels(src, selection(), true);
  assert.deepEqual(px(cut.lifted, 2, 0), [20, 20, 30, 255]);
  assert.deepEqual(px(cut.rest, 2, 0), [0, 0, 0, 0]);
  assert.deepEqual(px(cut.rest, 0, 0), [0, 20, 30, 255]);
  assert.deepEqual(px(cut.rest, 3, 2), [110, 20, 30, 255]);

  // On the Background the hole takes the background colour.
  const bg = liftLayerPixels(src, selection(), true, [255, 0, 255, 255]);
  assert.deepEqual(px(bg.rest, 1, 1), [255, 0, 255, 255]);
  assert.deepEqual(px(bg.lifted, 1, 1), [50, 20, 30, 255]);
});

test('Layer via Cut without a selection lifts the whole layer', () => {
  const src = layerPixels();
  const { lifted, rest } = liftLayerPixels(src, null, true);
  assert.deepEqual(lifted, src);
  assert.ok(rest.every((v) => v === 0));
});

test('a selection over transparent pixels lifts nothing', () => {
  const { lifted } = liftLayerPixels(new Uint8ClampedArray(W * H * 4), selection(), false);
  assert.equal(liftIsEmpty(lifted), true);
});

test('the Eraser on the Background paints the background colour and keeps it opaque', () => {
  const N = 9;
  const src = new Uint8ClampedArray(N * N * 4);
  for (let i = 0; i < src.length; i += 4) src.set([0, 0, 255, 255], i);
  const dst = src.slice();
  eraseDab(dst, src, N, N, 4.5, 4.5, 2, 1, 1, 1, null, new Float32Array(N * N), [255, 255, 0]);
  const c = (4 * N + 4) * 4;
  assert.deepEqual(Array.from(dst.subarray(c, c + 4)), [255, 255, 0, 255]);
  // Outside the tip nothing changes.
  assert.deepEqual(Array.from(dst.subarray(0, 4)), [0, 0, 255, 255]);

  const half = src.slice();
  eraseSquareDab(half, src, N, N, 4.5, 4.5, 2, 0.5, null, new Uint8Array(N * N), [255, 255, 0]);
  assert.deepEqual(Array.from(half.subarray(c, c + 4)), [128, 128, 128, 255]);
});

// A horizontal Eraser stroke across a 20 x 20 blue layer.
function eraserStroke(layer) {
  const N = 20;
  const buf = new Uint8ClampedArray(N * N * 4);
  for (let i = 0; i < buf.length; i += 4) buf.set([0, 0, 255, 255], i);
  const ctx = {
    canvas: { width: N, height: N },
    getImageData: () => ({ width: N, height: N, data: new Uint8ClampedArray(buf) }),
    putImageData(img, ox, oy, dx, dy, dw, dh) {
      for (let y = dy; y < dy + dh; y++) {
        const i = (y * N + dx) * 4;
        buf.set(img.data.subarray(i, i + dw * 4), i);
      }
    }
  };
  const state = {
    drawing: false,
    brushSize: 6,
    zoom: 1,
    sel: { mode: 'none' },
    bgColor: '#ff0000',
    layers: [layer],
    activeLayerIdx: 0,
    toolOptions: { eraser: { ...defaultToolOptions().eraser, size: 6 } }
  };
  TOOLS.eraser.onDown(ctx, null, state, 2.5, 10.5);
  TOOLS.eraser.onMove(ctx, null, state, 17.5, 10.5);
  TOOLS.eraser.onUp(ctx, null, state, 17.5, 10.5);
  const i = (10 * N + 10) * 4;
  return Array.from(buf.subarray(i, i + 4));
}

test('the Eraser tool paints the background colour on the Background, transparency elsewhere', () => {
  assert.deepEqual(eraserStroke({ name: 'Background', background: true }), [255, 0, 0, 255]);
  assert.equal(eraserStroke({ name: 'Layer 1', background: false })[3], 0);
});

test('Magic and Background Eraser turn the Background into Layer 0 after pushing undo', () => {
  for (const id of ['magicEraser', 'backgroundEraser']) {
    const calls = [];
    const N = 6;
    const ctx = {
      canvas: { width: N, height: N },
      getImageData: () => ({ width: N, height: N, data: new Uint8ClampedArray(N * N * 4) }),
      putImageData() {}
    };
    const state = {
      sel: { mode: 'none' },
      zoom: 1,
      bgColor: '#ffffff',
      toolOptions: defaultToolOptions(),
      pushUndo: (label) => calls.push(`undo:${label}`),
      unlockBackground: () => calls.push('unlock')
    };
    TOOLS[id].onDown(ctx, null, state, 2.5, 2.5);
    TOOLS[id].onUp?.(ctx, null, state, 2.5, 2.5);
    assert.equal(calls[1], 'unlock', id);
    assert.match(calls[0], /^undo:/, id);
  }
});

test('Layer from Background makes Layer 0, a normal layer that moves', () => {
  const bg = createLayer(BACKGROUND_NAME, W, H);
  bg.background = true;
  const a = createLayer('Layer 1', W, H);
  const layers = [bg, a];
  assert.equal(hasBackground(layers), true);
  assert.equal(canMoveLayer(layers, 0, 1), false);
  assert.equal(canMoveLayer(layers, 1, 0), false);

  assert.equal(unlockBackground(bg), true);
  assert.equal(bg.name, LAYER_ZERO_NAME);
  assert.equal(isBackgroundLayer(bg), false);
  assert.equal(hasBackground(layers), false);
  assert.equal(canMoveLayer(layers, 0, 1), true);
  assert.equal(canMoveLayer(layers, 1, 0), true);
  // A normal layer is left alone.
  assert.equal(unlockBackground(a), false);
  assert.equal(a.name, 'Layer 1');
});

test('Background from Layer: the layer over the background colour, opaque, at the bottom', () => {
  const src = new Uint8ClampedArray(W * H * 4);
  src.set([0, 0, 0, 255], 0); // black, opaque
  src.set([0, 0, 0, 128], 4); // black, half alpha
  // pixel 2 transparent
  src.set([200, 100, 0, 255], 12);
  const mask = new Uint8Array(W * H).fill(255);
  mask[3] = 0;
  const out = backgroundPixels(src, [255, 255, 255], { opacity: 1, mask });
  assert.deepEqual(px(out, 0, 0), [0, 0, 0, 255]);
  assert.deepEqual(px(out, 1, 0), [127, 127, 127, 255]);
  assert.deepEqual(px(out, 2, 0), [255, 255, 255, 255]);
  // The layer mask hides pixel 3.
  assert.deepEqual(px(out, 3, 0), [255, 255, 255, 255]);
  for (let i = 3; i < out.length; i += 4) assert.equal(out[i], 255);

  // Opacity and blend mode bake in: 50 % black, and Multiply of orange on gray.
  const faded = backgroundPixels(src, [255, 255, 255], { opacity: 0.5 });
  assert.deepEqual(px(faded, 0, 0), [128, 128, 128, 255]);
  const mult = backgroundPixels(src, [128, 128, 128], { blendMode: 'multiply' });
  assert.deepEqual(px(mult, 3, 0), [100, 50, 0, 255]);

  const layers = ['Layer 0', 'Layer 1', 'Layer 2'].map((name) => ({ name }));
  assert.deepEqual(
    stackWithBackground(layers, 2).map((l) => l.name),
    ['Layer 2', 'Layer 0', 'Layer 1']
  );
  assert.deepEqual(
    layers.map((l) => l.name),
    ['Layer 0', 'Layer 1', 'Layer 2']
  );
});

test('new layers take the first free "Layer N" name', () => {
  assert.equal(nextLayerName([{ name: 'Background' }]), 'Layer 1');
  assert.equal(nextLayerName([{ name: 'Background' }, { name: 'Layer 1' }]), 'Layer 2');
  assert.equal(nextLayerName([{ name: 'Layer 2' }]), 'Layer 1');
});

test('Layer › New commands sit in the Layer › New menu with PhotoCraft shortcuts', () => {
  const by = new Map(COMMANDS.map((c) => [c.id, c]));
  const ids = [
    'layer.new.layer',
    'layer.new.layerFromBackground',
    'layer.new.backgroundFromLayer',
    'layer.new.layerViaCopy',
    'layer.new.layerViaCut'
  ];
  for (const id of ids) assert.deepEqual(by.get(id)?.menu, ['Layer', 'New'], id);
  assert.equal(by.get('layer.new.layer').shortcut, 'Cmd+Shift+N');
  assert.equal(by.get('layer.new.layerViaCopy').shortcut, 'Cmd+J');
  assert.equal(by.get('layer.new.layerViaCut').shortcut, 'Cmd+Shift+J');

  const withBg = { layers: [{ background: true, kind: 'pixel' }], activeLayerIdx: 0 };
  const withoutBg = { layers: [{ background: false, kind: 'pixel' }], activeLayerIdx: 0 };
  assert.equal(by.get('layer.new.layerFromBackground').enabled(withBg), true);
  assert.equal(by.get('layer.new.layerFromBackground').enabled(withoutBg), false);
  assert.equal(by.get('layer.new.backgroundFromLayer').enabled(withBg), false);
  assert.equal(by.get('layer.new.backgroundFromLayer').enabled(withoutBg), true);

  const ran = [];
  const ctx = {
    newLayer: () => ran.push('new'),
    layerFromBackground: () => ran.push('fromBg'),
    backgroundFromLayer: () => ran.push('toBg'),
    layerVia: (cut) => ran.push(cut ? 'cut' : 'copy')
  };
  for (const id of ids) by.get(id).run(ctx);
  assert.deepEqual(ran, ['new', 'fromBg', 'toBg', 'copy', 'cut']);
  for (const label of ['Layer Via Copy', 'Layer Via Cut', 'Layer From Background']) {
    assert.equal(isStackUndoLabel(label), true, label);
  }
  assert.equal(isStackUndoLabel('Background From Layer'), true);
});

test('the Background flag survives undo snapshots and .paintproj; older files have none', async () => {
  const bg = createLayer(BACKGROUND_NAME, W, H);
  bg.background = true;
  const a = createLayer('Layer 1', W, H);
  assert.equal(a.background, false);
  const snap = restoreStack(snapshotStack([bg, a], 1));
  assert.deepEqual(
    snap.layers.map((r) => r.background),
    [true, false]
  );

  const state = { layers: [bg, a], activeLayerIdx: 1, bgColor: '#ffffff', color: '#000000' };
  const saved = serializeProject(state, W, H);
  assert.equal(saved.layers[0].background, true);
  assert.equal('background' in saved.layers[1], false);
  for (const l of saved.layers) delete l.dataUrl;

  let loaded = null;
  await deserializeProject(saved, (d) => (loaded = d.layers));
  assert.deepEqual(
    loaded.map((l) => [l.name, l.background]),
    [
      ['Background', true],
      ['Layer 1', false]
    ]
  );

  const old = {
    ...saved,
    layers: saved.layers.map((l) => {
      const r = { ...l };
      delete r.background;
      return r;
    })
  };
  await deserializeProject(old, (d) => (loaded = d.layers));
  assert.deepEqual(
    loaded.map((l) => l.background),
    [false, false]
  );
});

test('the New Layer dialog fields become name, blend mode, and 0..1 opacity', () => {
  assert.deepEqual(newLayerSettings({ name: ' Shade ', mode: 'multiply', opacity: '40' }), {
    name: 'Shade',
    blendMode: 'multiply',
    opacity: 0.4
  });
  assert.deepEqual(newLayerSettings({ name: '', mode: 'nope', opacity: '250' }), {
    name: '',
    blendMode: 'source-over',
    opacity: 1
  });
});
