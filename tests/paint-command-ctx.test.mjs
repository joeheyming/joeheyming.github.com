import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

import { COMMAND_CTX_KEYS, createCommandCtx } from '../paint/command-ctx.js';
import { COMMANDS } from '../paint/commands.js';

const paintDir = join(dirname(fileURLToPath(import.meta.url)), '../paint');
const read = (name) => readFileSync(join(paintDir, name), 'utf8');

function stubPorts(overrides = {}) {
  const calls = [];
  const record =
    (name) =>
    (...args) => {
      calls.push([name, ...args]);
    };
  const state = {
    layers: [{ id: 1, name: 'Layer 1', locks: {} }],
    activeLayerIdx: 0,
    measurementScale: 1,
    colorTable: null,
    styleClipboard: null,
    viewFlip: false,
    guidesLocked: false
  };
  const ports = {
    state,
    uploadInput: { click: record('upload') },
    placeInput: { click: record('place') },
    openFilenameModal: record('filename'),
    downloadPNG: record('png'),
    downloadJPEG: record('jpeg'),
    canvasW: () => 10,
    canvasH: () => 10,
    newProject: record('newProject'),
    file: { save: record('save') },
    fileInfo: record('fileInfo'),
    exportLayersToFiles: record('exportLayers'),
    deleteAllEmptyLayers: record('deleteEmpty'),
    flattenAllLayerMasks: record('flattenMasks'),
    undo: record('undo'),
    redo: record('redo'),
    copySelection: record('copySelection'),
    activeCtx: () => ({ id: 'ctx' }),
    copyMerged: record('copyMerged'),
    pasteCommand: record('paste'),
    pasteClipboard: record('pasteClipboard'),
    pasteIntoSelection: record('pasteInto'),
    toggleLastState: record('toggleLast'),
    clearCanvas: record('clear'),
    fillStrokeDialogs: { openFill: record('fill'), openStroke: record('stroke') },
    shortcutsDialog: { open: record('shortcuts') },
    startFreeTransform: record('freeTransform'),
    transformAgain: record('transformAgain'),
    transformPreset: record('transformPreset'),
    defineLayerPattern: record('definePattern'),
    autoLevels: record('autoLevels'),
    openAdjust: record('openAdjust'),
    startBlurGallery: record('blurGallery'),
    startLiquify: record('liquify'),
    applyAdjustmentNow: record('applyNow'),
    runLastFilter: record('lastFilter'),
    openFade: record('fade'),
    imageSizeDialog: { open: record('imageSize') },
    trimDialog: { open: record('trim') },
    measurementScaleDialog: { open: record('measure') },
    pointer: { commitTextInput: record('commitText') },
    setActiveTool: record('setTool'),
    setDocMode: record('setDocMode'),
    indexedColorDialog: { open: record('indexed') },
    bitmapDialog: { open: record('bitmap') },
    colorTableDialog: { open: record('colorTable') },
    openResizeModalUI: record('resize'),
    rotateCanvas: record('rotate'),
    openRotateModal: record('rotateArb'),
    flipCanvas: record('flip'),
    cropToSelection: record('crop'),
    duplicateLayer: record('duplicate'),
    newLayerDialog: { open: record('newLayerDialog') },
    addLayer: record('addLayer'),
    layerFromBackground: record('fromBg'),
    backgroundFromLayer: record('bgFromLayer'),
    layerVia: record('layerVia'),
    mergeDown: record('mergeDown'),
    mergeLayers: record('mergeLayers'),
    mergeVisible: record('mergeVisible'),
    deleteHiddenLayers: record('deleteHidden'),
    selectAllLayers: record('selectAllLayers'),
    deselectLayers: record('deselectLayers'),
    newGroup: record('newGroup'),
    groupLayers: record('groupLayers'),
    ungroupLayers: record('ungroup'),
    toggleClippingMask: record('clip'),
    arrangeLayer: record('arrange'),
    reverseLayers: record('reverse'),
    alignLayers: record('align'),
    distributeLayers: record('distribute'),
    lockLayersDialog: { open: record('lockDialog') },
    activeLayer: () => state.layers[0],
    lockLayers: record('lockLayers'),
    openLayerStyle: record('layerStyle'),
    copyLayerStyle: record('copyStyle'),
    applyLayerStyleTo: record('applyStyle'),
    toggleAllEffects: record('allEffects'),
    newAdjustmentLayer: record('adjLayer'),
    newFillLayer: record('fillLayer'),
    convertToSmartObject: record('toSmart'),
    convertSmartToLayers: record('smartToLayers'),
    rasterizeSmartObject: record('rastSmart'),
    rasterizeTypeLayer: record('rastType'),
    rasterizeShapeLayer: record('rastShape'),
    combineShapes: record('combine'),
    addVectorMask: record('addVMask'),
    deleteVectorMask: record('delVMask'),
    toggleVectorMask: record('togVMask'),
    rasterizeVectorMask: record('rastVMask'),
    rasterizeLayers: record('rastLayers'),
    defineCustomShapeFromPath: record('customShape'),
    openWarpText: record('warp'),
    setTypeAntialias: record('aa'),
    setTypeOrientation: record('orient'),
    pasteLoremIpsum: record('lorem'),
    convertTypeToParagraph: record('toPara'),
    convertTypeToPoint: record('toPoint'),
    addLayerMask: record('addMask'),
    maskFromTransparency: record('maskTrans'),
    toggleLayerMask: record('togMask'),
    removeLayerMask: record('rmMask'),
    selectAll: record('selectAll'),
    deselect: record('deselect'),
    reselect: record('reselect'),
    invertSelection: record('invert'),
    modifySelection: record('modify'),
    growSelection: record('grow'),
    colorRangeDialog: { open: record('colorRange') },
    startTransformSelection: record('xformSel'),
    toggleQuickMask: record('qm'),
    selectionChannelDialog: {
      openSave: record('saveSel'),
      openLoad: record('loadSel')
    },
    togglePanel: record('togglePanel'),
    zoomIn: record('zoomIn'),
    zoomOut: record('zoomOut'),
    zoomReset: record('zoomReset'),
    setView: record('setView'),
    fitOnScreen: 'fit',
    areaSize: () => [100, 80],
    fitLayersOnScreen: record('fitLayers'),
    zoomViewCentered: 'centered',
    updateTransform: record('updateTransform'),
    refreshMenus: record('refreshMenus'),
    setScreenMode: record('screenMode'),
    toggleRulers: record('rulers'),
    updateExtras: record('extras'),
    guideDialogs: {
      openGrid: record('grid'),
      openNewGuide: record('newGuide'),
      openLayout: record('layout')
    },
    guidesView: { renderGuides: record('renderGuides') },
    setGuides: record('setGuides'),
    ...overrides
  };
  return { ports, calls, state };
}

test('createCommandCtx exposes every COMMAND_CTX_KEYS entry as a function or file bag', () => {
  const { ports } = stubPorts();
  const ctx = createCommandCtx(ports);
  assert.deepEqual(Object.keys(ctx).sort(), [...COMMAND_CTX_KEYS].sort());
  for (const key of COMMAND_CTX_KEYS) {
    if (key === 'file') {
      assert.equal(typeof ctx.file.save, 'function');
      continue;
    }
    assert.equal(typeof ctx[key], 'function', `${key} is callable`);
  }
});

test('File and View wrappers route through ports without needing the full paint.js bag', () => {
  const { ports, calls, state } = stubPorts();
  const ctx = createCommandCtx(ports);
  ctx.openFile();
  ctx.placeEmbedded();
  ctx.exportPng();
  ctx.flipView();
  ctx.toggleLockGuides();
  ctx.fitOnScreen();
  ctx.zoomTo(2);
  assert.deepEqual(
    calls.map((c) => c[0]),
    [
      'upload',
      'place',
      'filename',
      'updateTransform',
      'refreshMenus',
      'renderGuides',
      'refreshMenus',
      'setView',
      'setView'
    ]
  );
  assert.equal(state.viewFlip, true);
  assert.equal(state.guidesLocked, true);
  assert.equal(calls.find((c) => c[0] === 'filename')[1], 'untitled.png');
  assert.deepEqual(calls.find((c) => c[0] === 'setView' && c[1] === 'fit')?.slice(1), [
    'fit',
    100,
    80
  ]);
  assert.deepEqual(calls.filter((c) => c[0] === 'setView')[1].slice(1), ['centered', 100, 80, 2]);
});

test('selectTool commits text input before switching tools', () => {
  const { ports, calls } = stubPorts();
  const ctx = createCommandCtx(ports);
  ctx.selectTool('move');
  assert.deepEqual(calls, [['commitText'], ['setTool', 'move']]);
});

test('paint.js builds commandCtx through createCommandCtx', () => {
  const src = read('paint.js');
  assert.match(src, /import \{ createCommandCtx \} from '\.\/command-ctx\.js'/);
  assert.match(src, /commandCtx = createCommandCtx\(/);
  assert.doesNotMatch(src, /commandCtx = \{\n/);
});

test('every COMMANDS run(ctx) method exists on the Adapter surface', () => {
  const { ports } = stubPorts();
  const ctx = createCommandCtx(ports);
  const missing = new Set();
  for (const cmd of COMMANDS) {
    const src = Function.prototype.toString.call(cmd.run);
    for (const m of src.matchAll(/ctx\.([a-zA-Z_][\w]*)/g)) {
      const key = m[1];
      if (!(key in ctx)) missing.add(`${cmd.id} → ${key}`);
    }
  }
  assert.deepEqual([...missing].sort(), []);
});
