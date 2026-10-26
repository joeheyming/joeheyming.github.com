// File › Place Embedded, File Info, Export › Layers to Files, Scripts › Delete All Empty
// Layers / Flatten All Masks (paint/file-extras.js, PhotoCraft file_cmds.rs / extra_cmds.rs).

import test from 'node:test';
import assert from 'node:assert/strict';
import zlib from 'node:zlib';
import { readFileSync } from 'node:fs';
import {
  FILE_INFO_FIELDS,
  crc32,
  emptyLayerIndices,
  fileInfoTextEntries,
  flattenAllMasks,
  insertPngText,
  isEmptyLayer,
  layersToFilesList,
  normalizeFileInfo,
  placeFit,
  placedLayerName,
  pngChunkTypes,
  sanitizeFileComponent
} from '../paint/file-extras.js';
import { COMMANDS_BY_ID } from '../paint/commands.js';
import { STACK_UNDO_LABELS } from '../paint/stack-history.js';
import { deserializeProject, serializeProject } from '../paint/project.js';

function chunk(type, data = new Uint8Array(0)) {
  const out = new Uint8Array(12 + data.length);
  const view = new DataView(out.buffer);
  view.setUint32(0, data.length);
  for (let i = 0; i < 4; i++) out[4 + i] = type.charCodeAt(i);
  out.set(data, 8);
  view.setUint32(8 + data.length, zlib.crc32(out.subarray(4, 8 + data.length)));
  return out;
}

function tinyPng() {
  const ihdr = new Uint8Array(13);
  new DataView(ihdr.buffer).setUint32(0, 1);
  new DataView(ihdr.buffer).setUint32(4, 1);
  ihdr.set([8, 6, 0, 0, 0], 8);
  const parts = [
    new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10]),
    chunk('IHDR', ihdr),
    chunk('IDAT', zlib.deflateSync(Buffer.from([0, 0, 0, 0, 0]))),
    chunk('IEND')
  ];
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  let o = 0;
  for (const p of parts) {
    out.set(p, o);
    o += p.length;
  }
  return out;
}

// Every chunk's [type, text, crcOk].
function readChunks(bytes) {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const out = [];
  for (let o = 8; o < bytes.length; ) {
    const len = view.getUint32(o);
    const body = bytes.subarray(o + 4, o + 8 + len);
    out.push({
      type: String.fromCharCode(...body.subarray(0, 4)),
      data: body.subarray(4),
      crcOk: view.getUint32(o + 8 + len) === zlib.crc32(body)
    });
    o += 12 + len;
  }
  return out;
}

function layer(name, alphas, opts = {}) {
  const data = new Uint8ClampedArray(alphas.length * 4);
  alphas.forEach((a, p) => {
    data.set([200, 100, 50, a], p * 4);
  });
  return {
    name,
    kind: opts.kind ?? 'pixel',
    visible: opts.visible ?? true,
    mask: opts.mask ?? null,
    maskEnabled: opts.maskEnabled ?? true,
    canvas: { width: alphas.length, height: 1 },
    ctx: {
      getImageData: () => ({ width: alphas.length, height: 1, data: new Uint8ClampedArray(data) }),
      putImageData: (img) => data.set(img.data)
    },
    alpha: () => [...data].filter((_, i) => i % 4 === 3)
  };
}

test('crc32 matches zlib', () => {
  const bytes = new TextEncoder().encode('IEND');
  assert.equal(crc32(bytes), 0xae426082);
  assert.equal(crc32(new Uint8Array([1, 2, 3, 250])), zlib.crc32(Buffer.from([1, 2, 3, 250])));
});

test('insertPngText puts tEXt chunks right after IHDR with valid CRCs', () => {
  const png = tinyPng();
  const out = insertPngText(png, [
    ['Title', 'Sunset'],
    ['Author', 'Ada']
  ]);
  assert.deepEqual(pngChunkTypes(out), ['IHDR', 'tEXt', 'tEXt', 'IDAT', 'IEND']);
  const chunks = readChunks(out);
  assert.ok(chunks.every((c) => c.crcOk));
  const text = chunks.filter((c) => c.type === 'tEXt').map((c) => Buffer.from(c.data).toString());
  assert.deepEqual(text, ['Title\0Sunset', 'Author\0Ada']);
  // The original bytes are untouched and the rest of the file is copied through.
  assert.deepEqual(pngChunkTypes(png), ['IHDR', 'IDAT', 'IEND']);
  assert.equal(out.length, png.length + 12 + 12 + 12 + 10);
});

test('insertPngText writes Latin-1 and replaces other characters', () => {
  const out = insertPngText(tinyPng(), [['Copyright', '© 2026 ✓']]);
  const t = readChunks(out).find((c) => c.type === 'tEXt');
  assert.deepEqual([...t.data.subarray(10)], [0xa9, 32, 50, 48, 50, 54, 32, 63]);
  assert.equal(insertPngText(tinyPng(), []).length, tinyPng().length);
  assert.throws(() => insertPngText(new Uint8Array(20), [['Title', 'x']]), /not a PNG/);
});

test('File Info fields normalize and become tEXt entries in dialog order', () => {
  assert.deepEqual(
    FILE_INFO_FIELDS.map((f) => f.key),
    ['title', 'author', 'description', 'keywords', 'copyright']
  );
  assert.deepEqual(normalizeFileInfo(undefined), {
    title: '',
    author: '',
    description: '',
    keywords: '',
    copyright: ''
  });
  assert.deepEqual(
    fileInfoTextEntries({ copyright: '(c) Me', title: 'Pic', author: '  ', keywords: 'a; b' }),
    [
      ['Title', 'Pic'],
      ['Keywords', 'a; b'],
      ['Copyright', '(c) Me']
    ]
  );
});

test('empty layers are fully transparent pixel layers with no mask', () => {
  assert.equal(isEmptyLayer(layer('a', [0, 0, 0])), true);
  assert.equal(isEmptyLayer(layer('b', [0, 1, 0])), false);
  assert.equal(isEmptyLayer(layer('c', [0, 0], { mask: new Uint8Array([255, 255]) })), false);
  assert.equal(isEmptyLayer(layer('d', [0, 0], { kind: 'adjustment' })), false);
  const stack = [
    layer('bg', [255, 255]),
    layer('e1', [0, 0]),
    layer('p', [9, 0]),
    layer('e2', [0, 0])
  ];
  assert.deepEqual(emptyLayerIndices(stack), [1, 3]);
  // A document keeps at least one layer.
  assert.deepEqual(emptyLayerIndices([layer('x', [0]), layer('y', [0])]), []);
});

test('flattenAllMasks bakes enabled pixel-layer masks and leaves the rest', () => {
  const masked = layer('m', [255, 255, 128], { mask: new Uint8Array([255, 0, 128]) });
  const disabled = layer('d', [255], { mask: new Uint8Array([0]), maskEnabled: false });
  const adj = layer('adj', [0], { kind: 'adjustment', mask: new Uint8Array([0]) });
  const plain = layer('p', [255]);
  const changed = flattenAllMasks([plain, masked, disabled, adj]);
  assert.deepEqual(changed, [masked]);
  assert.deepEqual(masked.alpha(), [255, 0, 64]);
  assert.equal(masked.mask, null);
  assert.ok(disabled.mask);
  assert.deepEqual(disabled.alpha(), [255]);
  assert.ok(adj.mask);
});

test('Layers to Files names <doc>_<index>_<layer>.png top first, skipping hidden layers', () => {
  const stack = [
    layer('Background', [255]),
    layer('Hidden', [255], { visible: false }),
    layer('Curves', [0], { kind: 'adjustment' }),
    layer('Sky / Clouds', [255])
  ];
  assert.deepEqual(layersToFilesList(stack, 'Untitled-1'), [
    { layerIdx: 3, fileName: 'Untitled-1_0000_Sky _ Clouds.png' },
    { layerIdx: 0, fileName: 'Untitled-1_0002_Background.png' }
  ]);
  assert.equal(sanitizeFileComponent('..'), 'layer');
  assert.equal(sanitizeFileComponent('a:b*c'), 'a_b_c');
});

test('Place Embedded fits the image inside the canvas, centred, never enlarged', () => {
  assert.deepEqual(placeFit(1000, 500, 400, 300), { x: 0, y: 50, w: 400, h: 200 });
  assert.deepEqual(placeFit(100, 50, 400, 300), { x: 150, y: 125, w: 100, h: 50 });
  assert.deepEqual(placeFit(300, 900, 400, 300), { x: 150, y: 0, w: 100, h: 300 });
  assert.equal(placedLayerName('photo.final.png'), 'photo.final');
  assert.equal(placedLayerName(''), 'Placed Layer');
});

test('the five File commands sit on their PhotoCraft menu paths', () => {
  const expect = {
    'file.placeEmbedded': ['File'],
    'file.fileInfo': ['File'],
    'file.export.layersToFiles': ['File', 'Export'],
    'file.scripts.deleteAllEmptyLayers': ['File', 'Scripts'],
    'file.scripts.flattenAllMasks': ['File', 'Scripts']
  };
  for (const [id, menu] of Object.entries(expect)) {
    const cmd = COMMANDS_BY_ID.get(id);
    assert.ok(cmd, id);
    assert.deepEqual(cmd.menu, menu, id);
  }
  assert.equal(COMMANDS_BY_ID.get('file.fileInfo').label, 'File Info…');
  assert.equal(COMMANDS_BY_ID.get('file.fileInfo').shortcut, 'Cmd+Alt+Shift+I');
  for (const label of ['Place Embedded', 'Delete All Empty Layers', 'Flatten All Masks']) {
    assert.ok(STACK_UNDO_LABELS.has(label), label);
  }
});

test('File Info is saved in .paintproj and old projects load without it', async () => {
  const state = { layers: [], objects: [], fileInfo: { title: 'Pic', copyright: '(c) Me' } };
  const data = serializeProject(state, 2, 2);
  assert.deepEqual(data.fileInfo, {
    ...normalizeFileInfo(null),
    title: 'Pic',
    copyright: '(c) Me'
  });
  let loaded;
  await deserializeProject(JSON.parse(JSON.stringify(data)), (doc) => (loaded = doc));
  assert.equal(loaded.fileInfo.title, 'Pic');
  delete data.fileInfo;
  await deserializeProject(data, (doc) => (loaded = doc));
  assert.deepEqual(loaded.fileInfo, normalizeFileInfo(null));
  const html = readFileSync(new URL('../paint/index.html', import.meta.url), 'utf8');
  for (const { key } of FILE_INFO_FIELDS) assert.match(html, new RegExp(`id="file-info-${key}"`));
  assert.match(html, /id="place-input"[\s\S]*?accept="image\/\*"/);
});
