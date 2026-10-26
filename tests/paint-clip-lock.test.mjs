import { test } from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';

// Layer › Create Clipping Mask and Lock Layers (PhotoCraft commands.rs set_clipped,
// layer_multi_cmds.rs lock_layers, extra_cmds.rs toggle_lock_transparency, compose lib.rs
// clipping groups). createLayer needs document.createElement('canvas'); an ImageData-backed stub
// keeps the compositing, tool, and project tests browser-free.
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
    putImageData(img, ox = 0, oy = 0, dx, dy, dw, dh) {
      ensure();
      if (dw === undefined) {
        canvas.pixels.set(img.data);
        return;
      }
      for (let y = dy; y < dy + dh; y++) {
        const i = (y * canvas.width + dx) * 4;
        canvas.pixels.set(img.data.subarray(i, i + dw * 4), i);
      }
    }
  };
  return canvas;
}

globalThis.document = { createElement: () => fakeCanvas(), getElementById: () => null };
globalThis.window = {};

const {
  applyClipPlan,
  applyLockPlan,
  clipBaseIndex,
  clipKeyReleases,
  clipPlan,
  effectiveLocks,
  keepsAlphaFor,
  layerLocks,
  lockLayersPlan,
  lockToolRefusal,
  pixelsLocked,
  positionLocked,
  preserveAlpha,
  setLock,
  toggleTransparencyPlan,
  transparencyLocked
} = await import('../paint/layer-locks.js');
const { compositeTreeBytes } = await import('../paint/layer-groups.js');
const { createLayer, createGroupLayer, compositeLayerOnto } = await import('../paint/layers.js');
const { TOOLS, defaultToolOptions } = await import('../paint/tools.js');
const { COMMANDS, commandForKey } = await import('../paint/commands.js');
const { snapshotStack, restoreStack, isStackUndoLabel } = await import('../paint/stack-history.js');
const { serializeProject, deserializeProject } = await import('../paint/project.js');
const { createPointerController } = await import('../paint/pointer.js');

const W = 4,
  H = 2;

// A layer filled with rgba where cover(x, y) holds, transparent elsewhere.
function filled(name, rgba, cover = () => true) {
  const layer = createLayer(name, W, H);
  const data = new Uint8ClampedArray(W * H * 4);
  for (let y = 0; y < H; y++)
    for (let x = 0; x < W; x++) if (cover(x, y)) data.set(rgba, (y * W + x) * 4);
  layer.ctx.putImageData({ width: W, height: H, data }, 0, 0);
  return layer;
}

const px = (data, x, y = 0) => Array.from(data.subarray((y * W + x) * 4, (y * W + x) * 4 + 4));
const leftHalf = (x) => x < 2;

test('a clipped layer composites only where its base has alpha', () => {
  const base = filled('Base', [255, 0, 0, 255], leftHalf);
  const blue = filled('Blue', [0, 0, 255, 255]);
  blue.clipped = true;
  const out = compositeTreeBytes([base, blue], W, H, [255, 255, 255]);
  assert.deepEqual(px(out, 0), [0, 0, 255, 255], 'inside the base: the clipped layer');
  assert.deepEqual(px(out, 3), [255, 255, 255, 255], 'outside the base: the backdrop');

  // Released, the blue layer covers everything.
  blue.clipped = false;
  const free = compositeTreeBytes([base, blue], W, H, [255, 255, 255]);
  assert.deepEqual(px(free, 3), [0, 0, 255, 255]);
});

test('clipped layers keep their own mode and opacity; the base sets the group’s', () => {
  const base = filled('Base', [200, 100, 50, 255], leftHalf);
  const mult = filled('Multiply', [128, 128, 128, 255]);
  mult.clipped = true;
  mult.blendMode = 'multiply';
  const out = compositeTreeBytes([base, mult], W, H, [255, 255, 255]);
  assert.deepEqual(px(out, 0), [100, 50, 25, 255], 'multiply onto the base');
  assert.deepEqual(px(out, 2), [255, 255, 255, 255]);

  const half = filled('Half', [0, 0, 0, 255]);
  half.clipped = true;
  half.opacity = 0.5;
  const o2 = compositeTreeBytes([base, half], W, H, [255, 255, 255]);
  assert.deepEqual(px(o2, 0), [100, 50, 25, 255], 'half-opacity black atop the base');

  // The base at 50 % carries its clipped layers with it.
  const blue = filled('Blue', [0, 0, 255, 255]);
  blue.clipped = true;
  const faded = filled('Base', [255, 0, 0, 255], leftHalf);
  faded.opacity = 0.5;
  const o3 = compositeTreeBytes([faded, blue], W, H, [255, 255, 255]);
  assert.deepEqual(px(o3, 0), [128, 128, 255, 255]);
  assert.deepEqual(px(o3, 3), [255, 255, 255, 255]);
});

test('a hidden base hides its clipped layers; a clipped layer with no base draws normally', () => {
  const base = filled('Base', [255, 0, 0, 255], leftHalf);
  const blue = filled('Blue', [0, 0, 255, 255]);
  blue.clipped = true;
  base.visible = false;
  const out = compositeTreeBytes([base, blue], W, H, [255, 255, 255]);
  assert.deepEqual(px(out, 0), [255, 255, 255, 255]);

  const lone = filled('Lone', [0, 255, 0, 255]);
  lone.clipped = true;
  const o2 = compositeTreeBytes([lone], W, H, [255, 255, 255]);
  assert.deepEqual(px(o2, 3), [0, 255, 0, 255]);
  assert.equal(clipBaseIndex([lone], 0), -1);
});

test('two clipped layers share one base, and a group can be a base', () => {
  const base = filled('Base', [255, 0, 0, 255], leftHalf);
  const a = filled('A', [0, 255, 0, 255], (x) => x === 0);
  const b = filled('B', [0, 0, 255, 255], (x) => x === 3 || x === 1);
  a.clipped = b.clipped = true;
  const layers = [base, a, b];
  assert.deepEqual(
    layers.map((_, i) => clipBaseIndex(layers, i)),
    [-1, 0, 0]
  );
  const out = compositeTreeBytes(layers, W, H, [255, 255, 255]);
  assert.deepEqual(
    [0, 1, 2, 3].map((x) => px(out, x)),
    [
      [0, 255, 0, 255],
      [0, 0, 255, 255],
      [255, 255, 255, 255],
      [255, 255, 255, 255]
    ]
  );

  const group = createGroupLayer('Group', W, H);
  const child = filled('Child', [255, 0, 0, 255], (x) => x === 2);
  child.parentId = group.id;
  const over = filled('Over', [0, 0, 255, 255]);
  over.clipped = true;
  const g = compositeTreeBytes([child, group, over], W, H, [255, 255, 255]);
  assert.deepEqual(px(g, 2), [0, 0, 255, 255]);
  assert.deepEqual(px(g, 0), [255, 255, 255, 255]);
});

test('Create Clipping Mask clips all selected but the lowest; Release cascades upward', () => {
  const [a, b, c] = ['A', 'B', 'C'].map((n) => createLayer(n, W, H));
  const layers = [a, b, c];
  const ids = layers.map((l) => l.id);
  assert.equal(clipKeyReleases(layers, ids), false);
  const targets = clipPlan(layers, ids, true);
  assert.deepEqual(targets, [b.id, c.id], 'the lowest selected layer is the base');
  applyClipPlan(layers, targets, true);
  assert.deepEqual(
    layers.map((l) => l.clipped),
    [false, true, true]
  );
  assert.equal(clipKeyReleases(layers, ids), true, 'the key now releases');

  // Releasing B releases C, which would otherwise be left clipped to a released layer.
  const release = clipPlan(layers, [b.id], false);
  assert.deepEqual(release, [b.id, c.id]);
  applyClipPlan(layers, release, false);
  assert.deepEqual(
    layers.map((l) => l.clipped),
    [false, false, false]
  );

  // A lone selected layer clips to the one below; the bottom layer has nothing to clip to.
  assert.deepEqual(clipPlan(layers, [c.id], true), [c.id]);
  assert.deepEqual(clipPlan(layers, [a.id], true), []);
});

test('the Layer menu command toggles its label and Cmd+/ opens Lock Layers', () => {
  const [a, b] = ['A', 'B'].map((n) => createLayer(n, W, H));
  const state = { layers: [a, b], activeLayerIdx: 1, selectedLayers: new Set([b.id]) };
  state.layerSelectionFor = b.id;
  const clip = COMMANDS.find((c) => c.id === 'layer.createClippingMask');
  assert.deepEqual(clip.menu, ['Layer']);
  assert.equal(clip.shortcut, 'Cmd+Alt+G');
  assert.equal(clip.enabled(state), true);
  assert.equal(clip.labelFor(state), 'Create Clipping Mask');
  b.clipped = true;
  assert.equal(clip.labelFor(state), 'Release Clipping Mask');
  let ran = null;
  clip.run({ toggleClippingMask: () => (ran = 'clip') });
  assert.equal(ran, 'clip');

  const lock = commandForKey({ code: 'Slash', key: '/', ctrlKey: true });
  assert.equal(lock?.id, 'layer.lockLayers');
  lock.run({ lockLayers: () => (ran = 'lock') });
  assert.equal(ran, 'lock');
  for (const label of [
    'Create Clipping Mask',
    'Release Clipping Mask',
    'Lock Layers',
    'Lock Transparent Pixels',
    'Unlock Transparent Pixels'
  ])
    assert.ok(isStackUndoLabel(label), label);
});

test('merging a clipped layer down keeps it inside its base', () => {
  const ops = [];
  const dst = {
    clipped: false,
    canvas: { width: W, height: H },
    ctx: {
      save() {},
      restore() {},
      drawImage: () => ops.push(dst.ctx.globalCompositeOperation),
      set globalCompositeOperation(v) {
        this._op = v;
      },
      get globalCompositeOperation() {
        return this._op;
      }
    }
  };
  const src = filled('Clipped', [0, 0, 255, 255]);
  src.clipped = true;
  compositeLayerOnto(src, dst);
  assert.deepEqual(ops, ['source-atop']);
});

test('lock records follow Locks::set; Lock Layers toggles Lock All with no locks given', () => {
  assert.deepEqual(setLock(layerLocks(null), 'transparency', true), {
    transparency: true,
    pixels: false,
    position: false,
    all: false
  });
  const pix = setLock({ transparency: true }, 'pixels', true);
  assert.equal(pix.transparency, false, 'image pixels covers transparency');
  assert.equal(setLock(pix, 'transparency', true).transparency, false);

  const [a, b] = ['A', 'B'].map((n) => createLayer(n, W, H));
  const layers = [a, b];
  applyLockPlan(layers, lockLayersPlan(layers, [a.id, b.id]));
  assert.ok(a.locks.all && b.locks.all);
  applyLockPlan(layers, lockLayersPlan(layers, [a.id, b.id]));
  assert.ok(!a.locks.all && !b.locks.all, 'every one locked: the toggle unlocks');
  applyLockPlan(layers, lockLayersPlan(layers, [b.id], { position: true, bogus: true }));
  assert.deepEqual(layerLocks(b), {
    transparency: false,
    pixels: false,
    position: true,
    all: false
  });

  // `/` leaves the Background out.
  const bg = createLayer('Background', W, H);
  bg.background = true;
  const isBg = (l) => l.background === true;
  assert.equal(toggleTransparencyPlan([bg], [bg.id], isBg), null);
  const r = toggleTransparencyPlan([bg, a], [bg.id, a.id], isBg);
  assert.equal(r.lock, true);
  assert.deepEqual(
    r.plan.map((p) => p.id),
    [a.id]
  );
});

test('each lock blocks the right operations, and a group’s locks reach its layers', () => {
  const a = createLayer('A', W, H);
  const layers = [a];
  a.locks = setLock(layerLocks(a), 'pixels', true);
  assert.match(lockToolRefusal(layers, a, 'brush', 'Brush'), /Could not use the Brush/);
  assert.match(lockToolRefusal(layers, a, 'eraser', 'Eraser'), /"A" is locked/);
  assert.equal(lockToolRefusal(layers, a, 'select', 'Move'), null, 'pixels lock still moves');
  assert.equal(lockToolRefusal(layers, a, 'rectSelect', 'Marquee'), null);
  assert.equal(positionLocked(layers, a), false);

  a.locks = setLock(layerLocks(null), 'position', true);
  assert.equal(lockToolRefusal(layers, a, 'brush', 'Brush'), null, 'position lock still paints');
  assert.equal(positionLocked(layers, a), true);

  a.locks = setLock(layerLocks(null), 'all', true);
  assert.ok(pixelsLocked(layers, a) && positionLocked(layers, a));
  assert.ok(lockToolRefusal(layers, a, 'brush', 'Brush'));

  a.locks = setLock(layerLocks(null), 'transparency', true);
  assert.equal(lockToolRefusal(layers, a, 'brush', 'Brush'), null);
  assert.equal(keepsAlphaFor(layers, a, 'brush'), true);
  assert.equal(keepsAlphaFor(layers, a, 'select'), false);

  const g = createGroupLayer('G', W, H);
  const child = createLayer('Child', W, H);
  child.parentId = g.id;
  g.locks = setLock(layerLocks(null), 'position', true);
  assert.equal(effectiveLocks([child, g], child).position, true);
  g.locks = setLock(layerLocks(null), 'transparency', true);
  assert.equal(transparencyLocked([child, g], child), true);
});

test('Lock Transparent Pixels keeps every pixel’s alpha', () => {
  const before = new Uint8ClampedArray([0, 0, 0, 0, 0, 255, 0, 255, 0, 0, 255, 128]);
  // An opaque red stroke over all three pixels, as source over leaves it.
  const after = new Uint8ClampedArray([255, 0, 0, 255, 255, 0, 0, 255, 255, 0, 0, 255]);
  preserveAlpha(before, after);
  assert.deepEqual(Array.from(after.subarray(0, 4)), [0, 0, 0, 0], 'transparent stays so');
  assert.deepEqual(Array.from(after.subarray(4, 8)), [255, 0, 0, 255]);
  assert.deepEqual(Array.from(after.subarray(8, 12)), [255, 0, 0, 128], 'red atop, alpha kept');

  // Half-strength red over half-transparent blue: the atop colour is the even mix.
  const b2 = new Uint8ClampedArray([0, 0, 255, 128]);
  // Source over: as = 0.5 → ao = 0.5 + 0.5·(128/255)·… computed the same way the brush does.
  const a0 = 128 / 255,
    as = 0.5,
    ao = as + a0 * (1 - as);
  const co = [(as * 1) / ao, 0, ((1 - as) * a0 * 1) / ao].map((v) => Math.round(v * 255));
  const a2 = new Uint8ClampedArray([...co, Math.round(ao * 255)]);
  preserveAlpha(b2, a2);
  assert.deepEqual(
    Array.from(a2).map((v, i) => (i < 3 ? Math.abs(v - [128, 0, 128][i]) <= 2 : v)),
    [true, true, true, 128]
  );
});

// One Eraser stroke across a 20 x 20 layer, its left half green, the rest transparent.
function eraserStroke(layer) {
  const N = 20;
  const buf = new Uint8ClampedArray(N * N * 4);
  for (let y = 0; y < N; y++)
    for (let x = 0; x < 10; x++) buf.set([0, 255, 0, 255], (y * N + x) * 4);
  const ctx = {
    canvas: { width: N, height: N },
    getImageData: () => ({ width: N, height: N, data: new Uint8ClampedArray(buf) }),
    putImageData(img, ox, oy, dx = 0, dy = 0, dw = N, dh = N) {
      for (let y = dy; y < dy + dh; y++) {
        const i = (y * N + dx) * 4;
        buf.set(img.data.subarray(i, i + dw * 4), i);
      }
    }
  };
  const state = {
    drawing: false,
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
  return buf;
}

test('the Eraser on a transparency-locked layer paints the background colour', () => {
  const locked = { name: 'Layer 1', locks: { transparency: true } };
  const buf = eraserStroke(locked);
  const at = (x, y) => Array.from(buf.subarray((y * 20 + x) * 4, (y * 20 + x) * 4 + 4));
  assert.deepEqual(at(5, 10), [255, 0, 0, 255]);
  const free = eraserStroke({ name: 'Layer 1' });
  assert.equal(free[(10 * 20 + 5) * 4 + 3], 0, 'unlocked: erased to transparency');
});

// The pointer controller over a W x H document with one layer and the Brush.
function pointerRig(locks) {
  const layer = filled('Layer 1', [0, 255, 0, 255], leftHalf);
  layer.locks = locks;
  const messages = [];
  const undo = [];
  const state = {
    tool: 'brush',
    layers: [layer],
    activeLayerIdx: 0,
    color: '#ff0000',
    bgColor: '#ffffff',
    zoom: 1,
    sel: { mode: 'none' },
    toolOptions: defaultToolOptions(),
    brushSize: 20,
    drawing: false,
    showStatusMessage: (m) => messages.push(m)
  };
  state.toolOptions.brush = { ...state.toolOptions.brush, size: 20, hardness: 100 };
  const overlayCanvas = {
    width: W,
    height: H,
    style: {},
    setPointerCapture() {},
    getBoundingClientRect: () => ({ left: 0, top: 0, width: W, height: H })
  };
  const ov = new Proxy({}, { get: () => () => {} });
  const pointer = createPointerController({
    state,
    overlayCanvas,
    ov,
    activeCtx: () => layer.ctx,
    activeLayer: () => layer,
    pushUndo: (l) => undo.push(l),
    updateTransform() {},
    refreshLayerPanel() {}
  });
  const ev = (x, y) => ({ button: 0, clientX: x, clientY: y, pointerId: 1, preventDefault() {} });
  const stroke = () => {
    pointer.onPointerDown(ev(0.5, 0.5));
    pointer.onPointerMove(ev(3.5, 1.5));
    pointer.onPointerUp(ev(3.5, 1.5));
  };
  return { layer, state, messages, undo, stroke };
}

test('Lock Image Pixels refuses the Brush with a status message and leaves the pixels', () => {
  const rig = pointerRig({ pixels: true });
  const before = rig.layer.ctx.getImageData(0, 0, W, H).data;
  rig.stroke();
  assert.equal(rig.messages.length, 1);
  assert.match(rig.messages[0], /Brush.*"Layer 1" is locked/);
  assert.deepEqual(rig.layer.ctx.getImageData(0, 0, W, H).data, before);
  assert.deepEqual(rig.undo, [], 'no history step');
});

test('a Brush stroke on a transparency-locked layer paints only its opaque pixels', () => {
  const rig = pointerRig({ transparency: true });
  rig.stroke();
  const after = rig.layer.ctx.getImageData(0, 0, W, H).data;
  assert.equal(rig.messages.length, 0);
  assert.deepEqual(px(after, 0), [255, 0, 0, 255], 'the green half takes the red');
  assert.equal(px(after, 3)[3], 0, 'the transparent half stays transparent');

  const free = pointerRig({});
  free.stroke();
  const painted = free.layer.ctx.getImageData(0, 0, W, H).data;
  assert.ok(px(painted, 3)[3] > 0, 'unlocked: the stroke covers the transparent half');
});

test('stack undo and .paintproj keep clipping and locks; older files load unlocked', async () => {
  const a = filled('A', [255, 0, 0, 255]);
  const b = filled('B', [0, 0, 255, 255]);
  b.clipped = true;
  b.locks = setLock(layerLocks(null), 'position', true);
  const snap = restoreStack(snapshotStack([a, b], 1));
  assert.deepEqual(
    snap.layers.map((r) => [r.clipped, layerLocks(r).position]),
    [
      [false, false],
      [true, true]
    ]
  );

  const saved = serializeProject({ layers: [a, b], activeLayerIdx: 1 }, W, H);
  assert.equal('clipped' in saved.layers[0], false);
  assert.equal(saved.layers[1].clipped, true);
  assert.equal(saved.layers[1].locks.position, true);
  for (const l of saved.layers) delete l.dataUrl;
  let loaded = null;
  await deserializeProject(saved, (d) => (loaded = d.layers));
  assert.deepEqual(
    loaded.map((l) => [l.clipped, l.locks.position]),
    [
      [false, false],
      [true, true]
    ]
  );

  const old = {
    ...saved,
    layers: saved.layers.map(({ clipped: _c, locks: _l, ...rest }) => rest)
  };
  await deserializeProject(old, (d) => (loaded = d.layers));
  assert.deepEqual(
    loaded.map((l) => [l.clipped, layerLocks(l).all, layerLocks(l).position]),
    [
      [false, false, false],
      [false, false, false]
    ]
  );
});

test('the Layers panel indents clipped rows and has four lock buttons', async () => {
  const { window } = new JSDOM('<!doctype html><body><div id="layers"></div></body>');
  const prev = globalThis.document;
  globalThis.document = window.document;
  try {
    const noop = new Proxy({}, { get: () => () => {} });
    window.HTMLCanvasElement.prototype.getContext = () => noop;
    const { renderLayerPanel } = await import('../paint/layers.js');
    const canvas = window.document.createElement('canvas');
    const layers = [
      { id: 1, name: 'Base', visible: true, opacity: 1, blendMode: 'source-over', canvas },
      {
        id: 2,
        name: 'Clipped',
        visible: true,
        opacity: 1,
        blendMode: 'source-over',
        canvas,
        clipped: true,
        locks: { position: true }
      }
    ];
    const calls = [];
    const callbacks = new Proxy(
      {},
      { get: (_, key) => (key === 'maskTarget' ? false : (...args) => calls.push([key, ...args])) }
    );
    const container = window.document.getElementById('layers');
    renderLayerPanel(layers, 1, container, callbacks);
    const [top, bottom] = container.querySelectorAll('.layer-row');
    assert.ok(top.classList.contains('layer-clipped'));
    assert.ok(top.querySelector('.layer-clip-glyph svg'), 'clip glyph');
    assert.ok(top.querySelector('.layer-lock-glyph'), 'lock glyph on a locked row');
    assert.ok(bottom.classList.contains('layer-clip-base'));
    assert.equal(bottom.querySelector('.layer-clip-glyph'), null);

    top.dispatchEvent(new window.MouseEvent('click', { altKey: true, bubbles: true }));
    assert.deepEqual(calls.at(-1), ['onToggleClip', 1]);
    top.dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
    assert.equal(calls.at(-1)[0], 'onActivate');

    const buttons = [...container.querySelectorAll('.layer-panel-header .layer-lock-btn')];
    assert.deepEqual(
      buttons.map((b) => [b.dataset.lock, b.getAttribute('aria-pressed')]),
      [
        ['transparency', 'false'],
        ['pixels', 'false'],
        ['position', 'true'],
        ['all', 'false']
      ]
    );
    buttons[1].click();
    assert.deepEqual(calls.at(-1), ['onLockChange', 1, 'pixels', true]);
    buttons[2].click();
    assert.deepEqual(calls.at(-1), ['onLockChange', 1, 'position', false]);
  } finally {
    globalThis.document = prev;
  }
});
