// Command Adapter Module — builds the flat actions bag every command's run(ctx) receives.
// paint.js is the composition root: it supplies document actions, dialogs, and view ports.
// The command table (commands.js) stays declarative; this Module owns the Adapter surface.

import { isSmartLayer } from './smart-objects.js';
import { GROUP_BASE_NAME } from './layer-groups.js';
import { LAYER_ZERO_NAME, nextLayerName } from './layer-new.js';
import { emptyGuides } from './guides.js';

/**
 * Build the command Adapter from paint.js ports.
 *
 * Ports are the live bindings paint owns (functions, dialogs, DOM inputs, state).
 * Wrappers that only compose ports live here so init does not author the mega bag.
 *
 * @param {object} p
 * @returns {object} Flat ctx for COMMANDS run(ctx)
 */
export function createCommandCtx(p) {
  const refreshMenus = () => p.refreshMenus?.();

  return {
    // File
    newProject: p.newProject,
    openFile: () => p.uploadInput?.click(),
    exportPng: () =>
      p.openFilenameModal('untitled.png', (f) =>
        p.downloadPNG(f, p.state, p.canvasW(), p.canvasH())
      ),
    exportJpeg: () =>
      p.openFilenameModal('untitled.jpg', (f) =>
        p.downloadJPEG(f, p.state, p.canvasW(), p.canvasH())
      ),
    file: p.file,
    placeEmbedded: () => p.placeInput?.click(),
    fileInfo: p.fileInfo,
    exportLayersToFiles: p.exportLayersToFiles,
    deleteAllEmptyLayers: p.deleteAllEmptyLayers,
    flattenAllMasks: p.flattenAllLayerMasks,

    // Edit
    undo: p.undo,
    redo: p.redo,
    cut: () => void p.copySelection(p.activeCtx(), true),
    copy: () => void p.copySelection(p.activeCtx(), false),
    copyMerged: () => void p.copyMerged(),
    paste: () => void p.pasteCommand(),
    pasteInPlace: () => p.pasteClipboard(p.activeCtx(), true),
    pasteInto: p.pasteIntoSelection,
    toggleLastState: p.toggleLastState,
    clearLayer: p.clearCanvas,
    openFill: () => p.fillStrokeDialogs.openFill(),
    openStroke: () => p.fillStrokeDialogs.openStroke(),
    openKeyboardShortcuts: () => p.shortcutsDialog.open(),
    freeTransform: (mode) => p.startFreeTransform(mode),
    transformAgain: p.transformAgain,
    transformPreset: p.transformPreset,
    definePattern: p.defineLayerPattern,

    // Image / Filter
    autoLevels: p.autoLevels,
    openAdjust: p.openAdjust,
    openBlurGallery: p.startBlurGallery,
    openLiquify: p.startLiquify,
    applyAdjustmentNow: p.applyAdjustmentNow,
    runLastFilter: p.runLastFilter,
    openFade: p.openFade,
    imageSize: () => p.imageSizeDialog.open(),
    trim: () => p.trimDialog.open(),
    setMeasurementScale: () => p.measurementScaleDialog.open(p.state.measurementScale),
    selectTool: (id) => {
      p.pointer.commitTextInput();
      p.setActiveTool(id);
    },
    setDocMode: p.setDocMode,
    indexedColor: () => p.indexedColorDialog.open(),
    bitmapMode: () => p.bitmapDialog.open(),
    colorTable: () => p.colorTableDialog.open(p.state.colorTable ?? []),
    canvasSize: () => p.openResizeModalUI(p.canvasW(), p.canvasH()),
    rotateCanvas: p.rotateCanvas,
    rotateArbitrary: p.openRotateModal,
    flipCanvas: p.flipCanvas,
    cropToSelection: p.cropToSelection,

    // Layer
    duplicateLayer: () => p.duplicateLayer(p.state.activeLayerIdx),
    newLayer: () =>
      p.newLayerDialog.open(
        { title: 'New Layer', name: nextLayerName(p.state.layers) },
        p.addLayer
      ),
    layerFromBackground: () =>
      p.newLayerDialog.open({ title: 'New Layer', name: LAYER_ZERO_NAME }, p.layerFromBackground),
    backgroundFromLayer: p.backgroundFromLayer,
    layerVia: p.layerVia,
    mergeDown: () => p.mergeDown(p.state.activeLayerIdx),
    mergeLayers: p.mergeLayers,
    mergeVisible: p.mergeVisible,
    deleteHiddenLayers: p.deleteHiddenLayers,
    selectAllLayers: p.selectAllLayers,
    deselectLayers: p.deselectLayers,
    newGroup: () =>
      p.newLayerDialog.open(
        {
          title: 'New Group',
          name: nextLayerName(p.state.layers, GROUP_BASE_NAME),
          group: true
        },
        p.newGroup
      ),
    groupFromLayers: () =>
      p.newLayerDialog.open(
        {
          title: 'New Group from Layers',
          name: nextLayerName(p.state.layers, GROUP_BASE_NAME),
          group: true
        },
        p.groupLayers
      ),
    groupLayers: () => p.groupLayers(),
    ungroupLayers: p.ungroupLayers,
    toggleClippingMask: p.toggleClippingMask,
    arrangeLayer: p.arrangeLayer,
    reverseLayers: p.reverseLayers,
    alignLayers: p.alignLayers,
    distributeLayers: p.distributeLayers,
    lockLayers: () =>
      p.lockLayersDialog.open(p.activeLayer()?.locks, (locks) => p.lockLayers(locks)),
    openLayerStyle: p.openLayerStyle,
    copyLayerStyle: p.copyLayerStyle,
    pasteLayerStyle: () => p.applyLayerStyleTo(p.state.styleClipboard, 'Paste Layer Style'),
    clearLayerStyle: () => p.applyLayerStyleTo(null, 'Clear Layer Style'),
    toggleAllEffects: p.toggleAllEffects,
    newAdjustmentLayer: p.newAdjustmentLayer,
    newFillLayer: p.newFillLayer,
    convertToSmartObject: p.convertToSmartObject,
    newSmartObjectViaCopy: () =>
      isSmartLayer(p.activeLayer()) &&
      p.duplicateLayer(p.state.activeLayerIdx, 'New Smart Object via Copy'),
    convertSmartToLayers: p.convertSmartToLayers,
    rasterizeSmartObject: p.rasterizeSmartObject,
    rasterizeTypeLayer: p.rasterizeTypeLayer,
    rasterizeShapeLayer: p.rasterizeShapeLayer,
    combineShapes: p.combineShapes,
    addVectorMask: p.addVectorMask,
    deleteVectorMask: p.deleteVectorMask,
    toggleVectorMask: p.toggleVectorMask,
    rasterizeVectorMask: p.rasterizeVectorMask,
    rasterizeLayers: p.rasterizeLayers,
    defineCustomShape: p.defineCustomShapeFromPath,
    openWarpText: p.openWarpText,
    setTypeAntialias: p.setTypeAntialias,
    setTypeOrientation: p.setTypeOrientation,
    pasteLoremIpsum: p.pasteLoremIpsum,
    convertTypeToParagraph: p.convertTypeToParagraph,
    convertTypeToPoint: p.convertTypeToPoint,
    addLayerMask: p.addLayerMask,
    maskFromTransparency: p.maskFromTransparency,
    toggleLayerMask: () => p.toggleLayerMask(),
    removeLayerMask: p.removeLayerMask,

    // Select
    selectAll: p.selectAll,
    deselect: p.deselect,
    reselect: p.reselect,
    invertSelection: p.invertSelection,
    modifySelection: p.modifySelection,
    growSelection: p.growSelection,
    colorRange: () => p.colorRangeDialog.open(),
    transformSelection: p.startTransformSelection,
    toggleQuickMask: p.toggleQuickMask,
    saveSelection: () => p.selectionChannelDialog.openSave(),
    loadSelection: () => p.selectionChannelDialog.openLoad(),

    // Window / View — thin ports; snap toggles stay in commands.js via updateExtras
    togglePanel: p.togglePanel,
    zoomIn: p.zoomIn,
    zoomOut: p.zoomOut,
    zoomReset: p.zoomReset,
    fitOnScreen: () => p.setView(p.fitOnScreen, ...p.areaSize()),
    fitLayersOnScreen: p.fitLayersOnScreen,
    zoomTo: (zoom) => p.setView(p.zoomViewCentered, ...p.areaSize(), zoom),
    flipView: () => {
      p.state.viewFlip = !p.state.viewFlip;
      p.updateTransform();
      refreshMenus();
    },
    setScreenMode: p.setScreenMode,
    toggleRulers: p.toggleRulers,
    updateExtras: p.updateExtras,
    gridPreferences: () => p.guideDialogs.openGrid(),
    toggleLockGuides: () => {
      p.state.guidesLocked = !p.state.guidesLocked;
      p.guidesView.renderGuides();
      refreshMenus();
    },
    clearGuides: () => p.setGuides(emptyGuides(), 'Clear Guides'),
    newGuide: () => p.guideDialogs.openNewGuide(),
    newGuideLayout: () => p.guideDialogs.openLayout()
  };
}

/** Keys the Adapter always exposes (menu + keyboard share this surface). */
export const COMMAND_CTX_KEYS = Object.freeze([
  'newProject',
  'openFile',
  'exportPng',
  'exportJpeg',
  'file',
  'placeEmbedded',
  'fileInfo',
  'exportLayersToFiles',
  'deleteAllEmptyLayers',
  'flattenAllMasks',
  'undo',
  'redo',
  'cut',
  'copy',
  'copyMerged',
  'paste',
  'pasteInPlace',
  'pasteInto',
  'toggleLastState',
  'clearLayer',
  'openFill',
  'openStroke',
  'openKeyboardShortcuts',
  'freeTransform',
  'transformAgain',
  'transformPreset',
  'definePattern',
  'autoLevels',
  'openAdjust',
  'openBlurGallery',
  'openLiquify',
  'applyAdjustmentNow',
  'runLastFilter',
  'openFade',
  'imageSize',
  'trim',
  'setMeasurementScale',
  'selectTool',
  'setDocMode',
  'indexedColor',
  'bitmapMode',
  'colorTable',
  'canvasSize',
  'rotateCanvas',
  'rotateArbitrary',
  'flipCanvas',
  'cropToSelection',
  'duplicateLayer',
  'newLayer',
  'layerFromBackground',
  'backgroundFromLayer',
  'layerVia',
  'mergeDown',
  'mergeLayers',
  'mergeVisible',
  'deleteHiddenLayers',
  'selectAllLayers',
  'deselectLayers',
  'newGroup',
  'groupFromLayers',
  'groupLayers',
  'ungroupLayers',
  'toggleClippingMask',
  'arrangeLayer',
  'reverseLayers',
  'alignLayers',
  'distributeLayers',
  'lockLayers',
  'openLayerStyle',
  'copyLayerStyle',
  'pasteLayerStyle',
  'clearLayerStyle',
  'toggleAllEffects',
  'newAdjustmentLayer',
  'newFillLayer',
  'convertToSmartObject',
  'newSmartObjectViaCopy',
  'convertSmartToLayers',
  'rasterizeSmartObject',
  'rasterizeTypeLayer',
  'rasterizeShapeLayer',
  'combineShapes',
  'addVectorMask',
  'deleteVectorMask',
  'toggleVectorMask',
  'rasterizeVectorMask',
  'rasterizeLayers',
  'defineCustomShape',
  'openWarpText',
  'setTypeAntialias',
  'setTypeOrientation',
  'pasteLoremIpsum',
  'convertTypeToParagraph',
  'convertTypeToPoint',
  'addLayerMask',
  'maskFromTransparency',
  'toggleLayerMask',
  'removeLayerMask',
  'selectAll',
  'deselect',
  'reselect',
  'invertSelection',
  'modifySelection',
  'growSelection',
  'colorRange',
  'transformSelection',
  'toggleQuickMask',
  'saveSelection',
  'loadSelection',
  'togglePanel',
  'zoomIn',
  'zoomOut',
  'zoomReset',
  'fitOnScreen',
  'fitLayersOnScreen',
  'zoomTo',
  'flipView',
  'setScreenMode',
  'toggleRulers',
  'updateExtras',
  'gridPreferences',
  'toggleLockGuides',
  'clearGuides',
  'newGuide',
  'newGuideLayout'
]);
