import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { JSDOM } from 'jsdom';
import { buildMenuBar } from '../paint/menu-bar.js';
import { COMMANDS_BY_ID, COMMANDS } from '../paint/commands.js';
import { TOOL_OPTION_SCHEMA } from '../paint/tools.js';
import {
  RASTERIZE_TYPE_MESSAGE,
  normalizeType,
  renderType,
  translateType,
  typeBounds,
  typeFont,
  typeFromJSON,
  typeLayerAt,
  typeLayerName,
  typeLayout,
  typeNeedsRasterize,
  typeToJSON
} from '../paint/type-layers.js';
import { isStackUndoLabel, restoreStack, snapshotStack } from '../paint/stack-history.js';
import { initRasterizePrompt } from '../paint/rasterize-prompt-dialog.js';

// Type layers (PhotoCraft doc TextLayer): the Type tool makes a layer that keeps its text, font,
// size, colour, and anchor; its pixels are drawn from them with fillText until it is rasterized.

// layers.js / project.js need document.createElement('canvas'): a byte-backed stub whose context
// records fillText calls, so the tests can see what a type layer draws.
function fakeCanvas() {
  const canvas = { width: 0, height: 0, className: '', dataset: {}, style: {}, pixels: null };
  const ensure = () => {
    if (!canvas.pixels || canvas.pixels.length !== canvas.width * canvas.height * 4) {
      canvas.pixels = new Uint8ClampedArray(canvas.width * canvas.height * 4);
    }
  };
  const ctx = {
    canvas,
    drawn: [],
    cleared: 0,
    createImageData: (w, h) => ({ width: w, height: h, data: new Uint8ClampedArray(w * h * 4) }),
    getImageData(x, y, w, h) {
      ensure();
      return { width: w, height: h, data: canvas.pixels.slice() };
    },
    putImageData(img) {
      ensure();
      canvas.pixels.set(img.data);
    },
    clearRect() {
      ctx.cleared++;
      ctx.drawn = [];
    },
    save() {},
    restore() {},
    fillText(text, x, y) {
      ctx.drawn.push({ text, x, y, font: ctx.font, color: ctx.fillStyle, align: ctx.textAlign });
    },
    measureText: (text) => ({ width: text.length * 10 }),
    drawImage() {}
  };
  canvas.getContext = () => ctx;
  canvas.toDataURL = () => '';
  return canvas;
}
globalThis.document = {
  createElement(tag) {
    if (tag !== 'canvas') throw new Error('unexpected element ' + tag);
    return fakeCanvas();
  }
};
const { createLayer, createTypeLayer, copyLayerContents, canMergeDown, refreshTypeLayers } =
  await import('../paint/layers.js');
const { serializeProject, deserializeProject } = await import('../paint/project.js');

// Every character is 10 px wide in every font.
const measure = (font, text) => text.length * 10;

const W = 200,
  H = 100;

test('a type record keeps text, font family, size, color, and position', () => {
  const t = normalizeType({ text: 'Hi', family: 'serif', size: 20, color: '#FF0000', x: 5, y: 30 });
  assert.equal(t.text, 'Hi');
  assert.equal(t.family, 'serif');
  assert.equal(t.size, 20);
  assert.equal(t.color, '#ff0000');
  assert.equal(t.x, 5);
  assert.equal(t.y, 30);
  assert.equal(t.align, 'left');
  assert.equal(t.bold, false);
  assert.equal(t.italic, false);
  assert.equal(t.orientation, 'horizontal');
  assert.equal(t.warp, null);
  // Bad values fall back to the defaults (justify is a real align; 'middle' is not).
  const d = normalizeType({ text: 'x', size: NaN, color: 'red', align: 'middle', family: '' });
  assert.equal(d.size, 16);
  assert.equal(d.color, '#000000');
  assert.equal(d.align, 'left');
  assert.equal(d.family, 'sans-serif');
  assert.equal(normalizeType({ text: 'x', align: 'justify' }).align, 'justify');
  assert.equal(typeFont({ ...t, bold: true, italic: true }), 'italic bold 20px serif');
  assert.equal(typeLayerName('  \n  Hello world  \nmore'), 'Hello world');
  assert.equal(typeLayerName(''), 'Layer');
  assert.deepEqual(translateType(t, 3, -4), { ...t, x: 8, y: 26 });
});

test('layout and bounds: the anchor is the first baseline, aligned left / center / right', () => {
  const t = normalizeType({ text: 'abcd\nab', size: 10, x: 50, y: 20 });
  assert.deepEqual(
    typeLayout(t, measure).map((l) => [l.x, l.y, l.width]),
    [
      [50, 20, 40],
      [50, 32, 20]
    ]
  );
  // Ascent 0.8 em above the first baseline, descent 0.2 em below the last.
  assert.deepEqual(typeBounds(t, measure), { x: 50, y: 12, w: 40, h: 22 });
  assert.deepEqual(typeBounds({ ...t, align: 'center' }, measure), { x: 30, y: 12, w: 40, h: 22 });
  assert.deepEqual(typeBounds({ ...t, align: 'right' }, measure), { x: 10, y: 12, w: 40, h: 22 });
  assert.equal(typeBounds({ ...t, text: '  ' }, measure), null);
});

test('renderType draws each line with fillText in the layer font, colour, and alignment', () => {
  const ctx = fakeCanvas().getContext();
  renderType(ctx, normalizeType({ text: 'one\n\ntwo', size: 10, color: '#00ff00', x: 4, y: 9 }));
  assert.deepEqual(ctx.drawn, [
    { text: 'one', x: 4, y: 9, font: '10px sans-serif', color: '#00ff00', align: 'left' },
    { text: 'two', x: 4, y: 33, font: '10px sans-serif', color: '#00ff00', align: 'left' }
  ]);
  assert.equal(ctx.textBaseline, 'alphabetic');
});

test('createTypeLayer stores the record and draws it; copies and resizes keep it', () => {
  const layer = createTypeLayer('Hello', { text: 'Hello', size: 24, x: 10, y: 40 }, W, H);
  assert.equal(layer.kind, 'type');
  assert.equal(layer.type.text, 'Hello');
  assert.deepEqual(
    layer.ctx.drawn.map((d) => [d.text, d.x, d.y, d.font]),
    [['Hello', 10, 40, '24px sans-serif']]
  );
  const copy = copyLayerContents(layer, createLayer('copy', W, H));
  assert.equal(copy.kind, 'type');
  assert.deepEqual(copy.type, layer.type);
  assert.notEqual(copy.type, layer.type);
  // Nothing merges down into a type layer: its pixels are drawn from its text.
  const above = createLayer('above', W, H);
  assert.equal(canMergeDown([layer, above], 1), false);
  // A canvas-size change draws the text again at the new size.
  const before = layer.ctx.cleared;
  layer.canvas.width = 300;
  refreshTypeLayers([layer]);
  assert.equal(layer.ctx.cleared, before + 1);
  assert.equal(layer.ctx.drawn.length, 1);
  refreshTypeLayers([layer]);
  assert.equal(layer.ctx.cleared, before + 1);
});

test('re-edit hit testing: a click inside a type layer bounds picks the topmost one', () => {
  const bg = createLayer('Background', W, H);
  const a = createTypeLayer('A', { text: 'AAAAAA', size: 20, x: 10, y: 40 }, W, H);
  const b = createTypeLayer('B', { text: 'BB', size: 20, x: 30, y: 40 }, W, H);
  const layers = [bg, a, b];
  // a spans x 10..70, b spans 30..50; both y 24..44.
  assert.equal(typeLayerAt(layers, 35, 30, measure), 2);
  assert.equal(typeLayerAt(layers, 15, 30, measure), 1);
  assert.equal(typeLayerAt(layers, 65, 43, measure), 1);
  // Outside every box, or on a pixel layer, starts a new type layer.
  assert.equal(typeLayerAt(layers, 75, 30, measure), -1);
  assert.equal(typeLayerAt(layers, 35, 50, measure), -1);
  assert.equal(typeLayerAt(layers, 35, 20, measure), -1);
  // A hidden type layer is not hit.
  b.visible = false;
  assert.equal(typeLayerAt(layers, 35, 30, measure), 1);
});

test('paint tools on a type layer ask to rasterize first; selections and Move do not', () => {
  const t = createTypeLayer('T', { text: 'T' }, W, H);
  const px = createLayer('px', W, H);
  for (const tool of ['brush', 'pencil', 'eraser', 'fill', 'gradient', 'cloneStamp', 'smudge']) {
    assert.equal(typeNeedsRasterize(t, tool), true, tool);
    assert.equal(typeNeedsRasterize(px, tool), false, tool);
  }
  for (const tool of ['select', 'text', 'rectSelect', 'lasso', 'eyedropper', 'crop']) {
    assert.equal(typeNeedsRasterize(t, tool), false, tool);
  }
  assert.match(RASTERIZE_TYPE_MESSAGE, /Rasterize the type\?$/);
});

test('the rasterize prompt shows the question; OK rasterizes, Cancel does nothing', () => {
  const html = readFileSync(new URL('../paint/index.html', import.meta.url), 'utf8');
  const { window } = new JSDOM(html);
  const doc = window.document;
  const prompt = initRasterizePrompt({ doc });
  const modal = doc.getElementById('rasterize-modal');
  let ran = 0;
  prompt.open(RASTERIZE_TYPE_MESSAGE, () => ran++);
  assert.equal(modal.classList.contains('hidden'), false);
  assert.equal(doc.getElementById('rasterize-message').textContent, RASTERIZE_TYPE_MESSAGE);
  doc.getElementById('rasterize-cancel').click();
  assert.equal(modal.classList.contains('hidden'), true);
  assert.equal(ran, 0);
  prompt.open(RASTERIZE_TYPE_MESSAGE, () => ran++);
  doc.getElementById('rasterize-ok').click();
  assert.equal(ran, 1);
  assert.equal(modal.classList.contains('hidden'), true);
});

test('Type › Rasterize Type Layer and Layer › Rasterize › Type run on a type layer only', () => {
  const t = createTypeLayer('T', { text: 'T' }, W, H);
  const px = createLayer('px', W, H);
  for (const id of ['type.rasterizeTypeLayer', 'layer.rasterize.type']) {
    const cmd = COMMANDS_BY_ID.get(id);
    assert.ok(cmd, id);
    assert.equal(cmd.enabled({ layers: [px, t], activeLayerIdx: 1 }), true);
    assert.equal(cmd.enabled({ layers: [px, t], activeLayerIdx: 0 }), false);
    let ran = 0;
    cmd.run({ rasterizeTypeLayer: () => ran++ });
    assert.equal(ran, 1);
  }
  assert.deepEqual(COMMANDS_BY_ID.get('type.rasterizeTypeLayer').menu, ['Type']);
  assert.deepEqual(COMMANDS_BY_ID.get('layer.rasterize.type').menu, ['Layer', 'Rasterize']);
  // Pixel commands (filters, transforms) are greyed on a type layer.
  const defringe = COMMANDS_BY_ID.get('layer.matting.defringe');
  assert.equal(defringe.enabled({ layers: [px, t], activeLayerIdx: 1 }), false);

  // The Type menu sits between Layer and Select and lists the command.
  const html = readFileSync(new URL('../paint/index.html', import.meta.url), 'utf8');
  const { window } = new JSDOM(html);
  const bar = window.document.getElementById('menu-bar');
  const ctx = new Proxy({}, { get: () => () => {} });
  // Window › panel checks read the global document; point it at this page while building.
  const stub = globalThis.document;
  globalThis.document = window.document;
  try {
    buildMenuBar(bar, COMMANDS, {
      ctx,
      mac: false,
      state: { layers: [], sel: { ids: [] } }
    });
  } finally {
    globalThis.document = stub;
  }
  const titles = [...bar.querySelectorAll('.menu-bar-btn')].map((b) => b.textContent.trim());
  assert.deepEqual(titles.slice(3, 6), ['Layer', 'Type', 'Select']);
  assert.ok(bar.querySelector('#type-menu-list [data-command="type.rasterizeTypeLayer"]'));
  assert.ok(bar.querySelector('#layer-menu-list [data-command="layer.rasterize.type"]'));
});

test('the Type options bar has font, size, alignment, color, and cancel / commit', () => {
  const keys = TOOL_OPTION_SCHEMA.text.map((o) => o.key);
  for (const k of ['family', 'size', 'align', 'color', '_typeCancel', '_typeCommit']) {
    assert.ok(keys.includes(k), k);
  }
  const align = TOOL_OPTION_SCHEMA.text.find((o) => o.key === 'align');
  assert.deepEqual(
    align.options.map((o) => o.value),
    ['left', 'center', 'right']
  );
  const commit = TOOL_OPTION_SCHEMA.text.find((o) => o.key === '_typeCommit');
  const cancel = TOOL_OPTION_SCHEMA.text.find((o) => o.key === '_typeCancel');
  assert.deepEqual(commit.patch({}), { _typeAction: 'commit' });
  assert.deepEqual(cancel.patch({}), { _typeAction: 'cancel' });
});

test('stack undo keeps the type record (New Type Layer, Rasterize Type)', () => {
  assert.equal(isStackUndoLabel('New Type Layer'), true);
  assert.equal(isStackUndoLabel('Rasterize Type'), true);
  const t = createTypeLayer('T', { text: 'Undo me', size: 30, x: 7, y: 50 }, W, H);
  const snap = snapshotStack([createLayer('bg', W, H), t], 1);
  t.type.text = 'changed';
  const back = restoreStack(snap).layers[1];
  assert.equal(back.kind, 'type');
  assert.equal(back.type.text, 'Undo me');
  assert.equal(back.type.size, 30);
});

test('.paintproj saves the type record, not pixels, and draws it again on load', async () => {
  const bg = createLayer('Background', W, H);
  const t = createTypeLayer(
    'Title',
    { text: 'Title\nline', family: 'serif', size: 32, color: '#123456', x: 100, y: 60 },
    W,
    H
  );
  t.type.align = 'center';
  t.opacity = 0.5;
  const state = { bgColor: '#ffffff', color: '#000000', activeLayerIdx: 1, layers: [bg, t] };
  state.objects = [];
  const data = JSON.parse(JSON.stringify(serializeProject(state, W, H)));
  assert.equal(data.layers[1].kind, 'type');
  assert.equal(data.layers[1].dataUrl, undefined);
  assert.deepEqual(data.layers[1].type, typeToJSON(t.type));

  let restored = null;
  await deserializeProject(data, (out) => (restored = out));
  const loaded = restored.layers[1];
  assert.equal(loaded.kind, 'type');
  assert.equal(loaded.name, 'Title');
  assert.equal(loaded.opacity, 0.5);
  assert.deepEqual(loaded.type, t.type);
  assert.deepEqual(
    loaded.ctx.drawn.map((d) => [d.text, d.x, d.y, d.font, d.color, d.align]),
    [
      ['Title', 100, 60, '32px serif', '#123456', 'center'],
      ['line', 100, 60 + 32 * 1.2, '32px serif', '#123456', 'center']
    ]
  );
  // Older files have no type layers; a 'type' entry without a record opens as a pixel layer.
  assert.equal(typeFromJSON(null), null);
  data.layers[1].type = null;
  await deserializeProject(data, (out) => (restored = out));
  assert.equal(restored.layers[1].kind, 'pixel');
});
