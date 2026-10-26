import {
  TOOLS,
  TOOL_OPTION_SCHEMA,
  syncCustomShapeOptions,
  floodSelect,
  floodSelectImage,
  scanlineFill,
  offsetLayerPixels,
  defaultToolOptions,
  cropToolTarget,
  drawPerspectiveCrop,
  drawCount,
  drawNotes,
  drawRuler,
  drawSamplers,
  straightenAngle,
  toolForKey
} from './tools.js';
import {
  buildToolbar,
  buildPalette,
  updateFgSwatch,
  showColor,
  showPaletteMode,
  defaultColors,
  swapColors,
  updateColorHistory,
  renderToolOptions,
  selectToolbarTool,
  slotTool,
  updateStatus
} from './ui.js';
import {
  createLayer,
  insertLayerBefore,
  copyLayerContents,
  canMergeDown,
  compositeLayerOnto,
  removeLayerFromDOM,
  syncLayerDOM,
  flattenToCanvas,
  renderLayerPanel,
  syncLayerMask,
  createAdjustmentLayer,
  createFillLayer,
  createGroupLayer,
  refreshFillLayers,
  renderFillLayer,
  createSmartLayer,
  renderSmartLayer,
  refreshSmartLayers,
  createTypeLayer,
  renderTypeLayer,
  refreshTypeLayers,
  createShapeLayer,
  renderShapeLayer,
  refreshShapeLayers
} from './layers.js';
import {
  RASTERIZE_SHAPE_MESSAGE,
  defineCustomShape as defineShapePreset,
  editShape,
  isShapeLayer,
  isShapeTool,
  SHAPE_TOOLS,
  nextShapeLayerName,
  normalizeShape,
  renderShapesPanel,
  shapeLayerBase,
  translateShape
} from './shapes.js';
import { initCustomShapeDialog } from './custom-shape-dialog.js';
import {
  COMBINE_SHAPE_OPS,
  combineShapesPlan,
  newVectorMask,
  rasterizeVectorMask as bakeVectorMask
} from './combine-shapes.js';
import {
  RASTERIZE_TYPE_MESSAGE,
  insertLorem,
  isTypeLayer,
  isTypeTool,
  loremTypeRecord,
  renderType,
  typeSelectionMask,
  withAntialias,
  withWarp,
  withOrientation,
  normalizeType,
  typeLayerAt,
  typeLayerName,
  toParagraphText,
  toPointText,
  translateType,
  withTypeField
} from './type-layers.js';
import { initTypePanels } from './type-panels.js';
import { initRasterizePrompt } from './rasterize-prompt-dialog.js';
import { rasterizeRecord, rasterizeTargets } from './rasterize.js';
import { initWarpTextDialog } from './warp-text-dialog.js';
import {
  affineHomography,
  cloneSmart,
  freeTransformHomography,
  isSmartLayer,
  renderSmart,
  smartBounds,
  smartFromLayers,
  transformSmart,
  unpackSmart
} from './smart-objects.js';
import {
  EDIT_FILL_LABEL,
  FILL_LAYER_TYPES,
  cloneFill,
  defaultFill,
  isFillLayer,
  nextFillName
} from './fill-layers.js';
import { initFillLayerDialog } from './fill-layer-dialog.js';
import {
  GROUP_BASE_NAME,
  PASS_THROUGH,
  blockIndices,
  groupLayersPlan,
  insertGroupAbove,
  isGroupLayer,
  applyMovePlan,
  moveLayerPlan,
  normalizeTree,
  reparentOrphans,
  topLevelIds,
  ungroupPlan
} from './layer-groups.js';
import {
  alignMoves,
  alignTarget,
  alphaBounds,
  applyArrangePlan,
  arrangePlan,
  distributeMoves,
  reversePlan,
  unionBounds
} from './layer-arrange.js';
import { defaultAdjustmentParams, isAdjustmentLayer } from './adjustment-layers.js';
import {
  ADJUSTMENTS,
  applyLevelsChannels,
  autoLevelsParams,
  setDisplaceMapSource,
  setLensDepthSource
} from './adjustments.js';
import {
  applyLayerMask,
  compositeMask,
  cropMask,
  maskFromRgba,
  maskFromTransparency as newMaskFromTransparency,
  maskGrayHex,
  maskLevel,
  maskToRgba,
  newLayerMask
} from './layer-mask.js';
import { createHistoryController, MAX_UNDO } from './document-history.js';
import { createCommandCtx } from './command-ctx.js';
import { renderHistoryPanel as buildHistoryPanel } from './history.js';
import { addSnapshot, deleteCurrentState, restoreSnapshot } from './history-snapshots.js';
import {
  deserializeProject,
  downloadProject,
  readProjectFile,
  serializeProject,
  scheduleAutosave,
  readAutosave,
  clearAutosave
} from './project.js';
import {
  startSelectionAnimation,
  commitSelection as doCommitSelection,
  copySelection as doCopySelection,
  pasteClipboard as doPasteClipboard,
  deleteSelection as doDeleteSelection,
  applySelectionWithMask as doApplySelectionWithMask,
  selectAll as doSelectAll,
  invertSelection as doInvertSelection,
  imageDataToPngBlob,
  writePngBlobToClipboard,
  activatePlacedSelection as doActivatePlacedSelection,
  drawSelectionOverlay,
  tryBeginMove,
  constrainLine,
  constrainSquare,
  hexToRgb,
  stampFloatingSelection,
  modifySelection as doModifySelection,
  deselectSelection as doDeselectSelection,
  reselectSelection as doReselectSelection,
  growSelection as doGrowSelection,
  selectionToFullMask,
  maskBBox,
  getSelectionImageData,
  extractLocalMask
} from './selection.js';
import { openAdjust as doOpenAdjust, cancelAdjust, commitAdjust } from './adjust-modal.js';
import { installOSBridge } from './os-bridge.js';
import { initMenuBar, buildMenuBar } from './menu-bar.js';
import { COMMANDS, COMMANDS_BY_ID, FILTER_IDS, commandForKey } from './commands.js';
import {
  applyView,
  fitBounds,
  fitOnScreen,
  nextScreenMode,
  screenModeClasses,
  viewOf,
  viewToDoc,
  viewTransformCss,
  zoomAt,
  zoomCentered as zoomViewCentered
} from './view.js';
import { canFade, fadePixels, fadeableLabels, noteFadeStep, recordLastFilter } from './fade.js';
import { initFadeDialog } from './fade-dialog.js';
import {
  GALLERY_KINDS,
  applyBlurGallery,
  blurGallerySessionPointer,
  drawGallery,
  newGallery,
  removeSelectedPin,
  setGalleryField
} from './blur-gallery.js';
import { initBlurGalleryPanel } from './blur-gallery-panel.js';
import {
  LIQUIFY_FIELDS,
  LIQUIFY_TOOLS,
  applyLiquify,
  defaultLiquifyOptions,
  liquifyRenderPad,
  liquifySessionPointer,
  newLiquifyField,
  reconstructAll,
  restoreAll,
  setFreezeAll,
  unionRect
} from './liquify.js';
import { initLiquifyPanel } from './liquify-panel.js';
import { initDock, bindDockBrushSize, syncDockSplits } from './dock.js';
import { initTooltips } from './tooltips.js';
import { initBrushPanel } from './brush-panel.js';
import { addPattern, initPresetPanels } from './preset-panels.js';
import { applyStylePreset } from './style-presets.js';
import { initPropertiesPanel } from './properties-panel.js';
import { toggleDockPanel } from './window-panels.js';
import { applyComp, captureComp, nextCompName, renderLayerCompsPanel } from './layer-comps.js';
import { initDocPanels } from './doc-panels.js';
import {
  closeFileMenu,
  openFilenameModal,
  confirmFilenameModal,
  closeFilenameModal,
  openResizeModal as openResizeModalUI,
  closeResizeModal,
  confirmResize as confirmResizeUI,
  downloadPNG,
  downloadJPEG,
  downloadLayerFiles,
  exportPNGBlob,
  mergedCanvas
} from './file-menu.js';
import {
  toggleLastState as doToggleLastState,
  pasteOffset,
  pasteIntoMask,
  selectionCenter
} from './edit-clipboard.js';
import {
  FILE_INFO_FIELDS,
  normalizeFileInfo,
  emptyLayerIndices,
  flattenAllMasks,
  layersToFilesList,
  placeFit,
  placedLayerName
} from './file-extras.js';
import { createPointerController } from './pointer.js';
import {
  cloneObjects,
  createImageObjectFromImage,
  createImageObjectFromImageData,
  hitTestObject,
  hitTestHandle,
  handleCursor,
  findObject,
  updateTextObject,
  moveObject,
  resizeObjectFromHandle,
  renderObjects,
  objectsBounds
} from './objects.js';
import { checkerPattern, definePattern } from './retouch.js';
import { hexToUnit } from './gradient-stops.js';
import { fillContentsSource, fillMask, strokeMask } from './fill-stroke.js';
import { initFillStrokeDialogs } from './fill-stroke-dialog.js';
import { initShortcutsDialog } from './shortcuts-dialog.js';
import { initImageSizeDialog } from './image-size-dialog.js';
import { resample } from './image-size.js';
import { initTrimDialog } from './trim-dialog.js';
import { quickMaskFromSelection, quickMaskOverlay, quickMaskToSelection } from './quick-mask.js';
import {
  channelSelection,
  channelViewPixels,
  deleteChannel,
  duplicateChannel,
  duplicateColorChannel,
  fittingChannels,
  loadSelectionMode,
  newChannel,
  renameChannel,
  renderChannelsPanel,
  saveSelectionToChannel,
  setChannelOptions,
  toggleAlphaShown,
  toggleColorVisible
} from './channels.js';
import { initSelectionChannelDialog } from './selection-channel-dialog.js';
import { initChannelOptionsDialog } from './channel-options-dialog.js';
import {
  deleteTargetPath,
  drawPathOverlay,
  duplicatePath,
  emptyPaths,
  newPath,
  pathMask,
  pathToPolygon,
  renamePath,
  renderPathsPanel,
  selectionToPath,
  targetPath
} from './paths.js';
import { iconSvg } from './icons.js';
import { defaultLayerFilter } from './layer-filter.js';
import { initColorRangeDialog } from './color-range-dialog.js';
import { softToSelection } from './color-range.js';
import { trimBounds } from './trim.js';
import {
  CROP_FRONT,
  CROP_HANDLE_PX,
  CROP_WXH,
  cropClamp,
  cropHitTurned,
  cropNormalizedAngle
} from './crop-frame.js';
import {
  rotatedSize,
  rotateImageData,
  flipImageData,
  straightenCropRect,
  straightenImageData,
  turnedCropImageData,
  resampleImageData,
  IDENTITY_TRANSFORM,
  freeTransformAffine,
  transformImageData,
  transformedCorners,
  transformPresetAffine,
  presetFreeTransform,
  transformLayerPixels,
  transformMask,
  transformSelectionMask,
  liftForTransform,
  opaqueBBox,
  applyHomography,
  convexQuad,
  homographyFromQuad,
  invertHomography,
  perspectiveCropImageData,
  perspectiveCropSize,
  quadHomography,
  warpQuad,
  presetQuad,
  evalMesh,
  meshFromBox,
  meshWarp,
  freeTransformCorners,
  ensureFreeTransformQuad,
  freeTransformPointer as runFreeTransformPointer
} from './transform.js';
import {
  isStackUndoLabel,
  layerSnapshot,
  restoreLayerSnapshot,
  restoreStack,
  snapshotStack
} from './stack-history.js';
import { DEFAULT_DOC_NAME, updateDocTab } from './doc-tab.js';
import { docColor, grayscaleLayers, normalizeDocMode } from './image-mode.js';
import { measurementScaleFromDialog, normalizeMeasurementScale } from './measurement.js';
import { addGuide, emptyGuides } from './guides.js';
import { initGuides } from './guides-ui.js';
import { initGuideDialogs } from './guides-dialog.js';
import {
  beginSnapDrag,
  defaultExtras,
  gridStep,
  shows,
  smartTargets,
  snapOptions,
  snapTargets,
  snapThreshold
} from './snap.js';
import { initExtras } from './extras-ui.js';
import { initMeasurementScaleDialog } from './measurement-scale-dialog.js';
import { activeCountColor, countTotal, emptyCount, setCountGroupColor } from './count.js';
import { removeNote, setNote } from './notes.js';
import { quantizeIndexed, recolorTable, toBitmap } from './indexed-mode.js';
import {
  initBitmapDialog,
  initColorTableDialog,
  initIndexedColorDialog
} from './indexed-mode-dialog.js';
import { createFileDocument, dirtyTitle } from './file-save.js';
import { initConfirmDialog } from './confirm-dialog.js';
import {
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
} from './layer-new.js';
import { initNewLayerDialog } from './new-layer-dialog.js';
import { initLockLayersDialog } from './lock-layers-dialog.js';
import { initLayerStyleDialog } from './layer-style-dialog.js';
import {
  canHaveStyle,
  cloneStyles,
  drawsStyle,
  hasLayerStyle,
  setAllEffects,
  setFillOpacity,
  setLayerStyles
} from './layer-style.js';
import {
  applyClipPlan,
  applyLockPlan,
  clipKeyReleases,
  clipPlan,
  layerLocks,
  lockLayersPlan,
  pixelsLocked,
  positionLocked,
  preserveAlpha,
  toggleTransparencyPlan,
  transparencyLocked
} from './layer-locks.js';
import {
  allLayerIds,
  applyMergePlan,
  clickLayerSelection,
  hiddenLayersPlan,
  mergeLayersPlan,
  mergeVisiblePlan,
  removeLayersAt,
  stateLayerSelection
} from './layer-multi.js';
import {
  applyLinkPlan,
  linkPlan,
  linkedPartners,
  offsetLinked,
  transformLinked
} from './layer-link.js';

// ── State ────────────────────────────────────────────────────────────────────

const state = {
  tool: 'select',
  color: '#000000',
  bgColor: '#ffffff',
  activeColor: '#000000',
  brushSize: 4,
  shapeFill: false,
  toolOptions: defaultToolOptions(),
  // Edit › Define Custom Shape… results ({ name, path }), after the built-in Shapes.
  customShapes: [],
  // Brush Settings (brush-dynamics.js): tip Spacing / Angle / Roundness and the dynamics.
  brushSettings: null,
  // One selection mode for every selection tool (PhotoCraft app.ui.selection_mode).
  selectionMode: 'new',
  drawing: false,
  startX: 0,
  startY: 0,
  lastX: 0,
  lastY: 0,

  // Layers
  layers: [],
  activeLayerIdx: 0,
  // Layers panel multi-selection (paint/layer-multi.js): layer ids, the active layer id it was
  // made for, and the Shift-click anchor.
  selectedLayers: new Set(),
  // The Layers panel filter row (layer-filter.js); a view only, not saved and not undone.
  layerFilter: defaultLayerFilter(),
  layerSelectionFor: null,
  layerAnchor: null,
  // Copy Layer Style's clipboard (layer-style.js), or null.
  styleClipboard: null,

  // Document tab
  docName: DEFAULT_DOC_NAME,
  // File › Save state (paint/file-save.js).
  fileName: null,
  dirty: false,
  fileSnapshot: null,
  // File › File Info… (paint/file-extras.js FILE_INFO_FIELDS), saved in .paintproj.
  fileInfo: normalizeFileInfo(null),
  // Image › Mode (paint/image-mode.js): 'rgb' or 'grayscale', saved in .paintproj.
  docMode: 'rgb',
  // Indexed Color's color table ('#rrggbb' entries, never mutated in place), else null.
  colorTable: null,

  // Zoom + pan
  zoom: 1,
  panX: 0,
  panY: 0,
  // View › Flip Horizontal and the Rotate View tool's turn (degrees clockwise); view only.
  viewFlip: false,
  viewRotation: 0,
  // View › Screen Mode (paint/view.js SCREEN_MODES).
  screenMode: 'standard',
  panning: false,
  panStartClientX: 0,
  panStartClientY: 0,
  panStartX: 0,
  panStartY: 0,
  spaceDown: false,

  // Pointer
  pressure: 1,

  // Selection
  sel: { mode: 'none', x: 0, y: 0, w: 0, h: 0, data: null, mask: null, baseData: null },
  selStartMoveX: 0,
  selStartMoveY: 0,
  selOrigX: 0,
  selOrigY: 0,
  lassoPath: [],
  polyPath: null,
  polyMode: null,

  // Clipboard
  clipboard: null,

  // Placed text / image objects (moved with the Move tool)
  objects: [],
  /** @type {number[]} */
  selectedObjectIds: [],
  /** Primary / last-selected id (kept in sync with selectedObjectIds). */
  selectedObjectId: null,
  objectDrag: null,

  // Color history
  colorHistory: [],

  // Undo
  undoStack: [],
  redoStack: [],
  // History panel snapshots: [{ name, stack }], session only (not in .paintproj)
  historySnapshots: [],

  // History Brush sources: layer id → ImageData snapshot
  historySource: new Map(),
  // The last committed Edit › Transform, for Transform Again: { affine, nearest }.
  lastTransform: null,
  // Pattern Stamp tile from Edit > Define Pattern ({ width, height, data }); null = checkerboard.
  pattern: null,
  // True while the active layer's mask (not its pixels) is the edit target.
  editMask: false,
  // Select › Edit in Quick Mask Mode: { levels, unselected, canvas, ctx } (paint/quick-mask.js)
  // while on, else null. Its gray canvas is the edit target and the selection is put away.
  quickMask: null,
  // Alpha channels [{ name, data }] from Save Selection… (paint/channels.js), saved in .paintproj.
  channels: [],
  // The Channels panel's targeted alpha channel index, or null for the composite.
  channelTarget: null,
  // Window › Layer Comps (paint/layer-comps.js), saved in .paintproj; never mutated. The panel's
  // selected comp index and the last applied one (null = Last Document State).
  layerComps: [],
  layerCompSelected: null,
  layerCompApplied: null,
  // Channels panel eyes [r, g, b], true = hidden (view only: not saved, not undone).
  channelHidden: [false, false, false],
  // Pen paths { work, saved, target } (paint/paths.js), saved in .paintproj. Never mutated.
  paths: emptyPaths(),
  // The Pen's subpath in progress { dragging, anchor, closed, x, y }, or null.
  pen: null,
  // Direct Selection's selected anchors ([subpath, anchor] pairs) and the path tools' drag.
  pathAnchors: [],
  pathDrag: null,
  // Ruler tool line { start, end } in document px, or null (PhotoCraft measurement.ruler).
  ruler: null,
  // Image › Analysis measurement scale (paint/measurement.js), saved in .paintproj.
  measurementScale: normalizeMeasurementScale(null),
  // Count tool markers { groups, active } (paint/count.js), saved in .paintproj.
  count: emptyCount(),
  // Color Sampler points [x, y] (paint/samplers.js) and notes (paint/notes.js), saved in
  // .paintproj; noteSelected is the Note tool's selected note index or -1.
  samplers: [],
  notes: [],
  noteSelected: -1,
  // Guides { vertical, horizontal } in document px (paint/guides.js), saved in .paintproj.
  guides: emptyGuides(),
  // View › Show › Guides, View › Rulers, and View › Lock Guides.
  showGuides: true,
  showRulers: false,
  guidesLocked: false,
  // View › Extras, Show, Snap, Snap To, the grid spacing, and Pixel Art Preview (paint/snap.js).
  ...defaultExtras(),
  // The drag's snapping while a pointer is down (snap.js beginSnapDrag), or null.
  snapDrag: null,

  // Callbacks (set up after DOM ready)
  onColorChange: null,
  onBgColorChange: null,
  beginType: null,
  commitSelection: null,
  doMagicWand: null,
  sampleVisible: null,
  scanlineFill: null
};

// ── Canvas / layer helpers ───────────────────────────────────────────────────

const overlayCanvas = document.getElementById('overlay-canvas');
const ov = overlayCanvas.getContext('2d', { willReadFrequently: true });
const objectsCanvas = document.getElementById('objects-canvas');
const stackEl = document.getElementById('canvas-stack');

/** Ref element for inserting layer canvases (below objects + overlay). */
function layerInsertRef() {
  return objectsCanvas || overlayCanvas;
}

function redrawObjects() {
  if (!objectsCanvas) return;
  renderObjects(objectsCanvas, state.objects, state.selectedObjectIds, state.zoom);
}

function canvasW() {
  return state.layers[0]?.canvas.width ?? 800;
}
function canvasH() {
  return state.layers[0]?.canvas.height ?? 600;
}
function activeLayer() {
  return state.layers[state.activeLayerIdx];
}
function activeCtx() {
  if (state.quickMask) return state.quickMask.ctx;
  return editingMask() ? activeLayer().maskCtx : activeLayer().ctx;
}

// ── Layer mask edit target ───────────────────────────────────────────────────

function editingMask() {
  // In Quick Mask every tool paints the Quick Mask's gray plane, as on a layer mask.
  if (state.quickMask) return true;
  const layer = activeLayer();
  // An adjustment or fill layer has no pixels to paint: its mask is always the edit target.
  const maskOnly = isAdjustmentLayer(layer) || isFillLayer(layer);
  return (state.editMask || maskOnly) && !!layer?.mask && !!layer.maskCtx;
}

// Tools painted the mask's gray surface: read the levels back into layer.mask.
function pullMaskEdit() {
  if (!editingMask()) return;
  if (state.quickMask) {
    pullQuickMask();
    return;
  }
  const layer = activeLayer();
  const { width, height } = layer.maskCanvas;
  const data = layer.maskCtx.getImageData(0, 0, width, height).data;
  layer.mask = maskFromRgba(data, maskLevel(state.bgColor));
  syncLayerMask(layer);
}

let maskPullFrame = 0;
function scheduleMaskPull() {
  if (maskPullFrame) return;
  maskPullFrame = requestAnimationFrame(() => {
    maskPullFrame = 0;
    pullMaskEdit();
  });
}

// Layer > Layer Mask > Add Layer Mask (PhotoCraft layer.mask.add). kind: revealAll |
// revealSelection | hideSelection | hideAll. The new mask becomes the edit target.
function addLayerMask(kind) {
  const layer = activeLayer();
  if (layer.mask || refuseGroupTarget('add a layer mask', null)) return;
  const W = canvasW(),
    H = canvasH();
  let selMask = null;
  if (kind === 'revealSelection' || kind === 'hideSelection') {
    if (state.sel.mode !== 'active') return;
    selMask = selectionToFullMask(state.sel, W, H);
  }
  pushUndo('Add Layer Mask');
  layer.mask = newLayerMask(kind, W, H, selMask);
  layer.maskEnabled = true;
  syncLayerMask(layer);
  state.editMask = true;
  refreshLayerPanelUI();
}

// Layer > Layer Mask > From Transparency: the alpha becomes a mask and the pixels opaque. The
// Background turns into a layer first, as in PhotoCraft (background_to_layer_for_mask).
function maskFromTransparency() {
  const layer = activeLayer();
  if (layer.mask || refuseGroupTarget('add a layer mask')) return;
  const { width, height } = layer.canvas;
  const img = layer.ctx.getImageData(0, 0, width, height);
  pushUndo('From Transparency');
  if (unlockBackground(layer)) syncLayerDOM(layer);
  layer.mask = newMaskFromTransparency(img);
  layer.ctx.putImageData(img, 0, 0);
  layer.maskEnabled = true;
  syncLayerMask(layer);
  state.editMask = true;
  refreshLayerPanelUI();
}

function toggleLayerMask(idx = state.activeLayerIdx) {
  const layer = state.layers[idx];
  if (!layer?.mask) return;
  state.activeLayerIdx = idx;
  pushUndo(layer.maskEnabled === false ? 'Enable Layer Mask' : 'Disable Layer Mask');
  layer.maskEnabled = layer.maskEnabled === false;
  syncLayerMask(layer);
  refreshLayerPanelUI();
}

// Apply bakes the mask into the layer's alpha; Delete discards it.
function removeLayerMask(apply) {
  pullMaskEdit();
  const layer = activeLayer();
  if (!layer.mask) return;
  pushUndo(apply ? 'Apply Layer Mask' : 'Delete Layer Mask');
  if (apply) {
    const { width, height } = layer.canvas;
    const out = applyLayerMask(layer.ctx.getImageData(0, 0, width, height), layer.mask);
    layer.ctx.putImageData(new ImageData(out.data, width, height), 0, 0);
  }
  layer.mask = null;
  layer.maskEnabled = true;
  state.editMask = false;
  syncLayerMask(layer);
  refreshLayerPanelUI();
}

// ── Adjustment layers ─────────────────────────────────────────────────────────
// Layer canvases are CSS-blended in the stack, but an adjustment layer reads the layers
// below it. While one is visible, the stack shows a single composited canvas instead
// and the per-layer canvases stay as hidden edit surfaces.

let compositeCanvas = null;
let compositeFrame = 0;

function syncCompositeView() {
  // A group changes how its layers composite (pass-through, isolation, its opacity), so any
  // group also switches to the one composited canvas.
  // So does a clipped layer: CSS cannot clip one canvas to another's alpha. And a layer style:
  // its effects are drawn from the layer's alpha (layer-style.js).
  const on = state.layers.some(
    (l) =>
      (isAdjustmentLayer(l) && l.visible) ||
      isGroupLayer(l) ||
      l.clipped ||
      (l.visible && drawsStyle(l))
  );
  for (const layer of state.layers) layer.canvas.style.visibility = on ? 'hidden' : '';
  if (!on) {
    compositeCanvas?.remove();
    return;
  }
  const W = canvasW(),
    H = canvasH();
  if (!compositeCanvas) {
    compositeCanvas = document.createElement('canvas');
    compositeCanvas.className = 'layer-canvas composite-canvas';
  }
  if (compositeCanvas.width !== W) compositeCanvas.width = W;
  if (compositeCanvas.height !== H) compositeCanvas.height = H;
  stackEl.insertBefore(compositeCanvas, layerInsertRef());
  const flat = flattenToCanvas(state.layers, state.bgColor, W, H, { transparentBg: true });
  const ctx = compositeCanvas.getContext('2d');
  ctx.clearRect(0, 0, W, H);
  ctx.drawImage(flat, 0, 0);
}

function scheduleComposite() {
  if (compositeFrame || !(compositeCanvas?.isConnected || channelViewCanvas?.isConnected)) return;
  compositeFrame = requestAnimationFrame(() => {
    compositeFrame = 0;
    pullMaskEdit();
    syncCompositeView();
    syncChannelView();
  });
}

// Channels panel eyes: with a color channel hidden or an alpha shown, one canvas over the stack
// shows channelViewPixels of the visible composite. The layers stay the edit surfaces.
let channelViewCanvas = null;

function syncChannelView() {
  const W = canvasW(),
    H = canvasH();
  const hidden = state.channelHidden;
  // Each shown record carries its Channel Options color, opacity, and Color Indicates.
  const overlays = state.channels.filter((c) => c.shown);
  const view =
    (hidden.some(Boolean) || overlays.length > 0) &&
    channelViewPixels(state.sampleVisible(W, H), hidden, overlays);
  if (!view) {
    channelViewCanvas?.remove();
    return;
  }
  if (!channelViewCanvas) {
    channelViewCanvas = document.createElement('canvas');
    channelViewCanvas.className = 'layer-canvas channel-view-canvas';
  }
  if (channelViewCanvas.width !== W) channelViewCanvas.width = W;
  if (channelViewCanvas.height !== H) channelViewCanvas.height = H;
  stackEl.insertBefore(channelViewCanvas, layerInsertRef());
  channelViewCanvas.getContext('2d').putImageData(new ImageData(view.data, W, H), 0, 0);
}

// Layer > New Adjustment Layer: a layer above the active one holding id and its params.
function newAdjustmentLayer(id) {
  const def = ADJUSTMENTS[id];
  if (!def) return;
  commitSelection();
  pushUndo('New Adjustment Layer');
  const idx = state.activeLayerIdx + 1;
  const layer = createAdjustmentLayer(
    def.label,
    id,
    defaultAdjustmentParams(id),
    canvasW(),
    canvasH()
  );
  const below = state.layers[idx - 1];
  layer.parentId = below.parentId ?? null;
  state.layers.splice(idx, 0, layer);
  stackEl.insertBefore(layer.canvas, below.canvas.nextSibling);
  syncLayerDOM(layer);
  snapshotHistorySource(layer);
  state.activeLayerIdx = idx;
  state.editMask = true;
  refreshLayerPanelUI();
  propertiesPanel.show();
}

// A double-click on an adjustment layer opens its params in Properties (PhotoCraft has no modal).
function editAdjustmentLayer(idx) {
  const layer = state.layers[idx];
  if (!isAdjustmentLayer(layer)) return;
  setEditTarget(idx, true);
  propertiesPanel.show();
}

// ── Fill layers (paint/fill-layers.js) ────────────────────────────────────────

let fillLayerDialog = { open() {} };

/**
 * Layer › New Fill Layer › Solid Color… / Gradient… / Pattern…: a fill layer above the active
 * one, masked to the selection when there is one (else Reveal All), then its dialog. Cancel
 * takes the layer and its history row back out.
 */
function newFillLayer(type) {
  const spec = FILL_LAYER_TYPES.find((t) => t.type === type);
  if (!spec) return;
  commitSelection();
  const W = canvasW(),
    H = canvasH();
  const selMask = state.sel.mode === 'active' ? selectionToFullMask(state.sel, W, H) : null;
  const fill = defaultFill(type, {
    fg: state.color,
    bg: state.bgColor,
    pattern: state.pattern ?? standInPattern()
  });
  pushUndo(spec.undo);
  const idx = state.activeLayerIdx + 1;
  const mask = selMask ? newLayerMask('revealSelection', W, H, selMask) : null;
  const layer = createFillLayer(nextFillName(state.layers, spec.name), fill, W, H, mask);
  const below = state.layers[idx - 1];
  layer.parentId = below.parentId ?? null;
  state.layers.splice(idx, 0, layer);
  stackEl.insertBefore(layer.canvas, below.canvas.nextSibling);
  syncLayerDOM(layer);
  snapshotHistorySource(layer);
  state.activeLayerIdx = idx;
  state.editMask = true;
  refreshLayerPanelUI();
  fillLayerDialog.open(layer.fill, {
    onPreview: (f) => setLayerFill(layer, f),
    onOk: (f) => {
      setLayerFill(layer, f);
      refreshLayerPanelUI();
    },
    onCancel: () => {
      const at = state.layers.indexOf(layer);
      if (at < 0) return;
      removeLayerFromDOM(layer);
      state.layers.splice(at, 1);
      state.activeLayerIdx = Math.max(0, Math.min(at - 1, state.layers.length - 1));
      state.editMask = false;
      if (state.undoStack.at(-1)?.label === spec.undo) state.undoStack.pop();
      updateUndoButtons();
      renderHistoryPanel();
      refreshLayerPanelUI();
    }
  });
}

/** Double-click a fill layer: its dialog again; OK is one 'Edit Fill Layer' history step. */
function editFillLayer(idx) {
  const layer = state.layers[idx];
  if (!isFillLayer(layer)) return;
  setEditTarget(idx, true);
  const before = cloneFill(layer.fill);
  fillLayerDialog.open(before, {
    onPreview: (f) => setLayerFill(layer, f),
    onOk: (f) => {
      setLayerFill(layer, before);
      pushUndo(EDIT_FILL_LABEL);
      setLayerFill(layer, f);
      refreshLayerPanelUI();
    },
    onCancel: () => {
      setLayerFill(layer, before);
      refreshLayerPanelUI();
    }
  });
}

function setLayerFill(layer, fill) {
  layer.fill = cloneFill(fill);
  renderFillLayer(layer);
  syncCompositeView();
}

// The Pattern Stamp's checkerboard in fg / bg, for pattern commands before Define Pattern.
function standInPattern() {
  return checkerPattern(
    ...[state.color, state.bgColor ?? '#ffffff'].map((c) => hexToUnit(c).map((v) => v * 255))
  );
}

// The current foreground and background colors (Gradient Map presets).
const swatches = () => [state.color, state.bgColor];

function setEditTarget(idx, mask) {
  state.activeLayerIdx = idx;
  state.editMask = mask && !!state.layers[idx]?.mask;
  refreshLayerPanelUI();
}

// ── File › Place Embedded, File Info, Layers to Files, Scripts (paint/file-extras.js) ──

// Place Embedded…: the image becomes a new layer above the active one, scaled down to fit and
// centred, then Free Transform starts on it (PhotoCraft transform_tool begin_placed).
/** Put a new layer above the active one and make it active (Place Embedded, Paste Into). */
function insertLayerAboveActive(layer) {
  const idx = state.activeLayerIdx + 1;
  // A sibling of the active layer: in its group, or above a group that is active.
  layer.parentId = state.layers[idx - 1]?.parentId ?? null;
  state.layers.splice(idx, 0, layer);
  stackEl.insertBefore(layer.canvas, state.layers[idx - 1].canvas.nextSibling);
  syncLayerDOM(layer);
  snapshotHistorySource(layer);
  state.activeLayerIdx = idx;
  state.editMask = false;
}

function placeEmbeddedFile(file) {
  if (!file?.type?.startsWith('image/')) return;
  const url = URL.createObjectURL(file);
  const img = new Image();
  img.onload = () => {
    URL.revokeObjectURL(url);
    commitSelection();
    pushUndo('Place Embedded');
    const W = canvasW(),
      H = canvasH();
    const fit = placeFit(img.naturalWidth || img.width, img.naturalHeight || img.height, W, H);
    const layer = createLayer(placedLayerName(file.name), W, H);
    layer.ctx.drawImage(img, fit.x, fit.y, fit.w, fit.h);
    insertLayerAboveActive(layer);
    refreshLayerPanelUI();
    scheduleComposite();
    startFreeTransform();
  };
  img.onerror = () => URL.revokeObjectURL(url);
  img.src = url;
}

function fileInfoInput(key) {
  return /** @type {HTMLInputElement | HTMLTextAreaElement} */ (
    document.getElementById(`file-info-${key}`)
  );
}

function openFileInfo() {
  const info = normalizeFileInfo(state.fileInfo);
  for (const { key } of FILE_INFO_FIELDS) {
    const input = fileInfoInput(key);
    if (input) input.value = info[key];
  }
  document.getElementById('file-info-modal')?.classList.remove('hidden');
  setTimeout(() => fileInfoInput('title')?.focus(), 50);
}

function closeFileInfo() {
  document.getElementById('file-info-modal')?.classList.add('hidden');
}

function confirmFileInfo() {
  const next = {};
  for (const { key } of FILE_INFO_FIELDS) next[key] = fileInfoInput(key)?.value ?? '';
  const info = normalizeFileInfo(next);
  closeFileInfo();
  if (FILE_INFO_FIELDS.every(({ key }) => info[key] === state.fileInfo[key])) return;
  state.fileInfo = info;
  fileDoc.markDirty();
  scheduleAutosave(state, canvasW(), canvasH());
}

function exportLayersToFiles() {
  pullMaskEdit();
  const files = layersToFilesList(state.layers, state.docName);
  if (files.length) void downloadLayerFiles(files, state, canvasW(), canvasH());
}

// Scripts › Delete All Empty Layers: fully transparent pixel layers without a mask, one undo.
function deleteAllEmptyLayers() {
  const doomed = emptyLayerIndices(state.layers);
  if (!doomed.length) return;
  pushUndo('Delete All Empty Layers');
  const active = activeLayer();
  for (const i of [...doomed].reverse()) {
    removeLayerFromDOM(state.layers[i]);
    state.layers.splice(i, 1);
  }
  const kept = state.layers.indexOf(active);
  state.activeLayerIdx = kept >= 0 ? kept : state.layers.length - 1;
  if (kept < 0) state.editMask = false;
  refreshLayerPanelUI();
  scheduleComposite();
}

// Scripts › Flatten All Masks: every enabled pixel-layer mask is applied, one undo.
function flattenAllLayerMasks() {
  pullMaskEdit();
  const eligible = state.layers.some(
    (l) => l.mask && l.maskEnabled !== false && !isAdjustmentLayer(l)
  );
  if (!eligible) return;
  pushUndo('Flatten All Masks');
  for (const layer of flattenAllMasks(state.layers)) syncLayerMask(layer);
  if (!activeLayer().mask) state.editMask = false;
  refreshLayerPanelUI();
  scheduleComposite();
}

// Menu items read enabled(state) / checked(state) from COMMANDS (paint/commands.js).
let refreshMenus = () => {};
// The actions object every command's run(ctx) receives (built in init).
let commandCtx = {};
let fillStrokeDialogs = { openFill() {}, openStroke() {} };
let shortcutsDialog = { open() {} };
let imageSizeDialog = { open() {} };
let trimDialog = { open() {} };
let fadeDialog = { open() {} };
let blurGalleryPanel = { open() {}, sync() {}, close() {} };
let liquifyPanel = { open() {}, sync() {}, close() {} };
// Liquify's brush options persist between sessions, as PhotoCraft's do.
const liquifyOptions = defaultLiquifyOptions();
// pushUndo labels Edit › Fade can blend back (filters, adjustments, Fill, Stroke, paint strokes).
const FADEABLE_LABELS = fadeableLabels(ADJUSTMENTS, TOOLS);
let selectionChannelDialog = { openSave() {}, openLoad() {} };
let channelOptionsDialog = { open() {} };
let colorRangeDialog = { open() {} };
let measurementScaleDialog = { open() {} };
let guidesView = { render() {}, renderRulers() {}, renderGuides() {} };
let guideDialogs = { openNewGuide() {}, openLayout() {}, openGrid() {} };
let extrasView = { render() {}, renderEdges() {}, renderSmart() {}, hover() {} };
let docPanels = { refresh() {}, invalidate() {}, hover() {} };
let propertiesPanel = { render() {}, show() {} };
let typePanels = { render() {} };
let newLayerDialog = { open() {} };
let lockLayersDialog = { open() {} };
let rasterizePrompt = { open() {} };
let customShapeDialog = { open() {} };
// The layer a Shape tool's options bar last showed (refreshLayerPanelUI redraws it on a change),
// and the last options-bar shape edit (one history step per run of edits to one field).
let shapeOptionsLayer = null;
let lastShapeEdit = null;
let warpTextDialog = { open() {} };
let layerStyleDialog = { open() {} };
let indexedColorDialog = { open() {} };
let bitmapDialog = { open() {} };
let colorTableDialog = { open() {} };

// ── File › Save / Revert / Close (paint/file-save.js) ────────────────────────

const BASE_TITLE = typeof document !== 'undefined' ? document.title : '';

const confirmDialog = initConfirmDialog();

const fileDoc = createFileDocument({
  state,
  serialize: () => serializeProject(state, canvasW(), canvasH()),
  download: (data, fileName) => downloadProject(data, fileName),
  askName: openFilenameModal,
  takeSnapshot: () => ({
    stack: snapshotStack(state.layers, state.activeLayerIdx),
    objects: cloneObjects(state.objects)
  }),
  restoreSnapshot: (snap) => {
    remountStack(snap.stack);
    state.objects = cloneObjects(snap.objects);
    setObjectSelection([]);
    redrawObjects();
    afterHistoryStep();
  },
  // History controller owns pushUndo; call through so this runs after that const binds.
  pushUndo: (label, stack) => pushUndo(label, stack),
  confirm: (message, onOk) => confirmDialog.openConfirm(message, onOk),
  resetDocument: resetToBlankDocument,
  onChange: () => {
    document.title = dirtyTitle(BASE_TITLE, state.dirty);
    updateDocTab(state);
  }
});

function defaultCanvasSize(area) {
  const rect = area.getBoundingClientRect();
  // Prefer the available area; only fall back to 400×300 when layout
  // hasn't measured yet (rect can be 0 during early init).
  const W = Math.floor(rect.width) > 0 ? Math.floor(rect.width) : 400;
  const H = Math.floor(rect.height) > 0 ? Math.floor(rect.height) : 300;
  return { W, H };
}

function initCanvas() {
  const area = document.getElementById('canvas-area');
  const { W, H } = defaultCanvasSize(area);

  const layer0 = createLayer(BACKGROUND_NAME, W, H);
  layer0.background = true;
  layer0.ctx.fillStyle = state.bgColor;
  layer0.ctx.fillRect(0, 0, W, H);
  state.layers.push(layer0);
  insertLayerBefore(layer0, stackEl, layerInsertRef());

  if (objectsCanvas) {
    objectsCanvas.width = W;
    objectsCanvas.height = H;
  }
  overlayCanvas.width = W;
  overlayCanvas.height = H;
  stackEl.style.width = W + 'px';
  stackEl.style.height = H + 'px';
  redrawObjects();
  resetHistorySources();
}

function resizeStack(W, H) {
  // Snapshots no longer match the canvas size.
  state.historySource = new Map();
  for (const layer of state.layers) {
    const old = layer.ctx.getImageData(0, 0, layer.canvas.width, layer.canvas.height);
    if (layer.mask) layer.mask = cropMask(layer.mask, old.width, old.height, 0, 0, W, H);
    layer.canvas.width = W;
    layer.canvas.height = H;
    if (isBackgroundLayer(layer)) {
      layer.ctx.fillStyle = state.bgColor;
      layer.ctx.fillRect(0, 0, W, H);
    }
    layer.ctx.putImageData(old, 0, 0);
    if (layer.mask) syncLayerMask(layer);
  }
  setStackSize(W, H);
}

// Overlay, objects canvas, and stack element follow the document size.
function setStackSize(W, H) {
  if (objectsCanvas) {
    objectsCanvas.width = W;
    objectsCanvas.height = H;
  }
  overlayCanvas.width = W;
  overlayCanvas.height = H;
  stackEl.style.width = W + 'px';
  stackEl.style.height = H + 'px';
  redrawObjects();
}

// ── Quick Mask and alpha channels ────────────────────────────────────────────

let quickMaskView = null;

// Read the Quick Mask's gray canvas back into its levels and redraw the red overlay.
function pullQuickMask() {
  const q = state.quickMask;
  const { width: W, height: H } = q.canvas;
  q.levels = maskFromRgba(q.ctx.getImageData(0, 0, W, H).data, maskLevel(state.bgColor));
  drawQuickMaskView();
}

function drawQuickMaskView() {
  const q = state.quickMask;
  if (!q || !quickMaskView) return;
  const { width: W, height: H } = q.canvas;
  const img = new ImageData(W, H);
  quickMaskOverlay(q.levels, img.data);
  quickMaskView.getContext('2d').putImageData(img, 0, 0);
}

function syncQuickMaskButton() {
  const btn = document.getElementById('btn-quick-mask');
  if (!btn) return;
  const on = !!state.quickMask;
  btn.classList.toggle('active', on);
  btn.setAttribute('aria-pressed', String(on));
  const tip = on ? 'Edit in Standard Mode (Q)' : 'Edit in Quick Mask Mode (Q)';
  btn.title = tip;
  btn.setAttribute('aria-label', tip.replace(' (Q)', ''));
}

// Q: the selection becomes the Quick Mask (shown red over the masked areas) and is put away;
// Q again turns the painted mask back into the selection (channel_cmds.rs quick_mask).
function toggleQuickMask() {
  if (state.drawing) return;
  pointer.commitTextInput();
  const W = canvasW(),
    H = canvasH();
  if (state.quickMask) {
    pullMaskEdit();
    const q = state.quickMask;
    state.quickMask = null;
    quickMaskView?.remove();
    quickMaskView = null;
    const mask = q.levels.length === W * H ? quickMaskToSelection(q.levels, q.unselected) : null;
    applySelectionWithMask(mask ?? new Uint8Array(W * H), W, H, null);
    ov.clearRect(0, 0, overlayCanvas.width, overlayCanvas.height);
    if (state.sel.mode === 'active') drawSelectionOverlay(state, ov);
  } else {
    if (state.freeTransform) endFreeTransform(true);
    if (state.sel.data && state.sel.baseData) stampFloatingSelection(state, activeLayer().ctx);
    const selMask = state.sel.mode === 'active' ? selectionToFullMask(state.sel, W, H) : null;
    const { levels, unselected } = quickMaskFromSelection(selMask, W, H);
    const canvas = document.createElement('canvas');
    canvas.width = W;
    canvas.height = H;
    const ctx = canvas.getContext('2d', { willReadFrequently: true });
    ctx.putImageData(new ImageData(maskToRgba(levels), W, H), 0, 0);
    state.quickMask = { levels, unselected, canvas, ctx };
    applySelectionWithMask(new Uint8Array(W * H), W, H, null);
    ov.clearRect(0, 0, overlayCanvas.width, overlayCanvas.height);
    quickMaskView = document.createElement('canvas');
    quickMaskView.className = 'layer-canvas quick-mask-canvas';
    quickMaskView.width = W;
    quickMaskView.height = H;
    stackEl.insertBefore(quickMaskView, layerInsertRef());
    drawQuickMaskView();
  }
  syncQuickMaskButton();
  updateDocTab(state);
  refreshMenus();
}

// A new or opened document, or a canvas-size change, leaves Quick Mask without converting it.
function dropQuickMask() {
  if (!state.quickMask) return;
  state.quickMask = null;
  quickMaskView?.remove();
  quickMaskView = null;
  syncQuickMaskButton();
}

function renderLayerComps() {
  const container = document.getElementById('layer-comps-container');
  if (!container) return;
  renderLayerCompsPanel(container, state.layerComps, {
    selected: state.layerCompSelected ?? state.layerCompApplied,
    applied: state.layerCompApplied,
    onApply: applyLayerComp,
    onNew: () => {
      state.layerComps = [
        ...state.layerComps,
        captureComp(state.layers, nextCompName(state.layerComps))
      ];
      state.layerCompSelected = state.layerComps.length - 1;
      state.layerCompApplied = state.layerCompSelected;
      fileDoc.markDirty();
      renderLayerComps();
    },
    onDelete: (i) => {
      if (!state.layerComps[i]) return;
      state.layerComps = state.layerComps.filter((_, j) => j !== i);
      state.layerCompSelected = null;
      if (state.layerCompApplied === i) state.layerCompApplied = null;
      else if (state.layerCompApplied > i) state.layerCompApplied--;
      fileDoc.markDirty();
      renderLayerComps();
    }
  });
}

/** Restore comp `i`'s layer visibility and appearance (one undo step). */
function applyLayerComp(i) {
  const comp = state.layerComps[i];
  if (!comp) return;
  pushUndo('Apply Layer Comp');
  // Copy the restored fields onto the live records: their canvases stay mounted.
  applyComp(state.layers, comp).forEach((next, j) => {
    const layer = state.layers[j];
    if (next === layer) return;
    Object.assign(layer, {
      visible: next.visible,
      opacity: next.opacity,
      blendMode: next.blendMode
    });
    syncLayerDOM(layer);
  });
  state.layerCompSelected = i;
  state.layerCompApplied = i;
  syncCompositeView();
  refreshLayerPanelUI();
  renderLayerComps();
}

function renderChannels() {
  const container = document.getElementById('channel-list-container');
  const length = canvasW() * canvasH();
  // A canvas-size change leaves channels of the old size; they no longer load.
  state.channels = fittingChannels(state.channels, length);
  if (state.channelTarget != null && !state.channels[state.channelTarget]) {
    state.channelTarget = null;
  }
  refreshMenus();
  // A shown alpha channel's overlay follows the list (toggle, delete, undo).
  if (channelViewCanvas?.isConnected || state.channels.some((c) => c.shown)) syncChannelView();
  if (!container) return;
  renderChannelsPanel(container, state.channels, {
    target: state.channelTarget,
    canSave: state.sel.mode === 'active' && !state.quickMask,
    hidden: state.channelHidden,
    image: state.sampleVisible?.(canvasW(), canvasH()),
    onToggleVisible: (name) => {
      state.channelHidden = toggleColorVisible(state.channelHidden, name);
      renderChannels();
      syncChannelView();
    },
    onToggleAlpha: (i) => {
      state.channels = toggleAlphaShown(state.channels, i);
      renderChannels();
    },
    onTarget: (i) => {
      state.channelTarget = i;
      renderChannels();
    },
    onLoad: (i) => loadSelectionChannel({ channel: i, operation: 'new' }),
    onSave: () => saveSelectionChannel({ channel: 'new', name: '', operation: 'new' }),
    onNew: () => {
      pushUndo('New Channel');
      const next = newChannel(state.channels, length);
      state.channels = next.channels;
      state.channelTarget = next.index;
      renderChannels();
    },
    onDelete: (i) => {
      pushUndo('Delete Channel');
      state.channels = deleteChannel(state.channels, i);
      state.channelTarget = null;
      renderChannels();
    },
    onDuplicate: (i) => {
      pushUndo('Duplicate Channel');
      const next = duplicateChannel(state.channels, i);
      state.channels = next.channels;
      state.channelTarget = next.index;
      renderChannels();
    },
    onDuplicateColor: (name) => {
      pushUndo('Duplicate Channel');
      const img = state.sampleVisible(canvasW(), canvasH());
      const next = duplicateColorChannel(state.channels, img, name);
      state.channels = next.channels;
      if (next.index >= 0) state.channelTarget = next.index;
      renderChannels();
    },
    onRename: (i, name) => {
      const next = renameChannel(state.channels, i, name);
      if (next !== state.channels) {
        pushUndo('Rename Channel');
        state.channels = next;
      }
      renderChannels();
    },
    onOptions: (i) => channelOptionsDialog.open(i),
    onSetOptions: (i, options) => {
      if (!state.channels[i]) return;
      pushUndo('Channel Options');
      state.channels = setChannelOptions(state.channels, i, options);
      renderChannels();
      syncChannelView();
    }
  });
}

// Select › Save Selection… OK: the selection goes into a new or existing alpha channel.
function saveSelectionChannel({ channel, name, operation }) {
  if (state.sel.mode !== 'active' || state.quickMask) return;
  const W = canvasW(),
    H = canvasH();
  pushUndo('Save Selection');
  const r = saveSelectionToChannel(state.channels, selectionToFullMask(state.sel, W, H), W * H, {
    channel,
    name,
    operation
  });
  state.channels = r.channels;
  state.channelTarget = r.index;
  renderChannels();
}

// Select › Load Selection… OK: the channel becomes, or combines with, the selection.
function loadSelectionChannel({ channel, operation }) {
  const ch = state.channels[channel];
  const W = canvasW(),
    H = canvasH();
  if (!ch || ch.data.length !== W * H || state.quickMask) return;
  if (state.sel.data && state.sel.baseData) stampFloatingSelection(state, activeLayer().ctx);
  const mode = loadSelectionMode(operation);
  applySelectionWithMask(channelSelection(ch), W, H, state.sel.mode === 'active' ? mode : null);
  ov.clearRect(0, 0, overlayCanvas.width, overlayCanvas.height);
  if (state.sel.mode === 'active') drawSelectionOverlay(state, ov);
  renderChannels();
}

// ── Paths panel (paint/paths.js) ─────────────────────────────────────────────

// The Pen and the panel buttons change paths through here; a label pushes an undo row first.
function setPaths(next, label = null) {
  if (label) pushUndo(label);
  state.paths = next;
  renderPaths();
}

function showTargetPath() {
  ov.clearRect(0, 0, overlayCanvas.width, overlayCanvas.height);
  if (state.sel.mode === 'active') drawSelectionOverlay(state, ov);
  drawPathOverlay(ov, targetPath(state.paths), 1 / (state.zoom || 1));
}

function renderPaths() {
  const container = document.getElementById('path-list-container');
  if (!container) return;
  renderPathsPanel(container, state.paths, {
    width: canvasW(),
    height: canvasH(),
    canMakeWorkPath: state.sel.mode === 'active' && !state.quickMask,
    canPaint: () => !!activeLayer() && !groupTargetRefusal(),
    onTarget: (t) => {
      endPenSubpath();
      state.paths = { ...state.paths, target: t };
      state.pathAnchors = [];
      renderPaths();
      showTargetPath();
    },
    onFill: fillPath,
    onStroke: strokePath,
    onLoad: loadPathSelection,
    onLoadPath: (key, mode) =>
      loadPathSelection(key === 'work' ? state.paths.work : state.paths.saved[key], mode),
    onMakeWorkPath: makeWorkPath,
    onNew: () => setPaths(newPath(state.paths), 'New Path'),
    onDuplicate: (key) => setPaths(duplicatePath(state.paths, key), 'Duplicate Path'),
    onRename: (key, name) => {
      const next = renamePath(state.paths, key, name);
      if (next === state.paths) renderPaths();
      else setPaths(next, key === 'work' ? 'Save Path' : 'Rename Path');
    },
    onDelete: () => {
      setPaths(deleteTargetPath(state.paths), 'Delete Path');
      showTargetPath();
    }
  });
}

// Fill Path: the path's interior in the foreground color (path.fill).
function fillPath() {
  const path = targetPath(state.paths);
  if (!path) return;
  const W = canvasW(),
    H = canvasH();
  const src = fillContentsSource('foreground', { fg: state.color });
  fillOrStroke('Fill Path', (img) => fillMask(img, pathMask(path, W, H), src));
}

// Stroke Path: the Brush, with its current options, dragged along each subpath (path.stroke).
function strokePath() {
  const path = targetPath(state.paths);
  if (!path || !activeLayer() || refuseGroupTarget('stroke the path')) return;
  pushUndo('Stroke Path');
  const ctx = activeCtx();
  const keep = { drawing: state.drawing, pressure: state.pressure, color: state.activeColor };
  state.activeColor = editingMask() ? maskGrayHex(state.color) : state.color;
  state.pressure = 1;
  const subpaths = path.subpaths.filter((sp) => sp.anchors.length);
  pathToPolygon(path).forEach((poly, i) => {
    const pts = subpaths[i].closed ? [...poly, poly[0]] : poly;
    TOOLS.brush.onDown(ctx, ov, state, pts[0][0], pts[0][1]);
    for (const [x, y] of pts.slice(1)) TOOLS.brush.onMove(ctx, ov, state, x, y);
    TOOLS.brush.onUp(ctx, ov, state);
  });
  state.drawing = keep.drawing;
  state.pressure = keep.pressure;
  state.activeColor = keep.color;
  pullMaskEdit();
  scheduleComposite();
  refreshLayerPanelUI();
}

// Load Path as a Selection: the path's interior replaces the selection (path.toSelection).
// A Cmd / Ctrl-clicked thumbnail passes its own path and the load mode; the target is unchanged.
function loadPathSelection(path = targetPath(state.paths), mode = 'replace') {
  if (!path || state.quickMask) return;
  const W = canvasW(),
    H = canvasH();
  if (state.sel.data && state.sel.baseData) stampFloatingSelection(state, activeLayer().ctx);
  applySelectionWithMask(pathMask(path, W, H), W, H, mode === 'replace' ? null : mode);
  showTargetPath();
  renderPaths();
}

// Make Work Path from Selection: the selection's outline, tolerance 2 px (select.toWorkPath).
function makeWorkPath() {
  if (state.sel.mode !== 'active' || state.quickMask) return;
  const W = canvasW(),
    H = canvasH();
  const work = selectionToPath(selectionToFullMask(state.sel, W, H), W, H, 2);
  setPaths({ ...state.paths, work, target: 'work' }, 'Make Work Path');
  showTargetPath();
}

// Pen tools whose subpath stays open between clicks (state.drawing); Enter, Escape, another tool,
// a Paths panel target, or undo ends it.
const PEN_SUBPATH_TOOLS = new Set(['pen', 'curvaturePen']);

function endPenSubpath() {
  if (PEN_SUBPATH_TOOLS.has(state.tool) && state.drawing) TOOLS[state.tool].end(ov, state);
}

/** Window › <panel>: show and focus it in the dock, or hide it when it is shown. */
function togglePanel(name) {
  if (toggleDockPanel(name)) {
    if (name === 'channels') renderChannels();
    if (name === 'paths') renderPaths();
    if (name === 'layerComps') renderLayerComps();
    docPanels.refresh();
  }
  syncDockSplits();
  refreshMenus();
}

// ── History Brush source ──────────────────────────────────────────────────────

function snapshotHistorySource(layer) {
  const { width, height } = layer.canvas;
  state.historySource.set(layer.id, layer.ctx.getImageData(0, 0, width, height));
}

// A document was opened or created: every layer's source is its current pixels.
function resetHistorySources() {
  // The ruler line is document data too; a new or opened document has none.
  state.ruler = null;
  state.historySnapshots = [];
  state.measurementScale = normalizeMeasurementScale(null);
  state.count = emptyCount();
  state.samplers = [];
  state.notes = [];
  state.noteSelected = -1;
  state.guides = emptyGuides();
  guidesView.renderGuides();
  // Reselect never brings back another document's selection.
  state.lastSelMask = null;
  // Alpha channels and Quick Mask belong to the document; an opened file brings its own.
  dropQuickMask();
  state.channels = [];
  state.channelTarget = null;
  state.channelHidden = [false, false, false];
  renderChannels();
  syncChannelView();
  state.layerComps = [];
  state.layerCompSelected = null;
  state.layerCompApplied = null;
  renderLayerComps();
  state.paths = emptyPaths();
  state.pen = null;
  state.pathAnchors = [];
  renderPaths();
  state.onRulerChange?.();
  if (['count', 'colorSampler', 'note'].includes(state.tool)) refreshToolOptions();
  state.historySource = new Map();
  for (const layer of state.layers) snapshotHistorySource(layer);
}

// Rebuilds the layer stack from a stack snapshot. Layers keep their ids, so single-layer
// entries further down the history still find their target.
function remountStack(snapshot) {
  const { width: W, height: H, activeIdx, layers } = restoreStack(snapshot);
  const sizeChanged = W !== canvasW() || H !== canvasH();
  const byId = new Map(state.layers.map((l) => [l.id, l]));
  for (const layer of state.layers) removeLayerFromDOM(layer);
  state.layers = layers.map((r) => {
    let layer = byId.get(r.id);
    if (!layer) {
      layer = createLayer(r.name, W, H);
      layer.id = r.id;
      layer.canvas.dataset.layerId = r.id;
    }
    layer.name = r.name;
    layer.kind = r.kind;
    layer.opacity = r.opacity;
    layer.visible = r.visible;
    layer.blendMode = r.blendMode;
    layer.background = r.background === true;
    layer.parentId = r.parentId ?? null;
    layer.clipped = r.clipped === true;
    if (r.linkId) layer.linkId = r.linkId;
    else delete layer.linkId;
    layer.locks = layerLocks(r);
    layer.styles = cloneStyles(r.styles);
    if (r.kind === 'group') layer.collapsed = r.collapsed === true;
    else delete layer.collapsed;
    if (r.kind === 'adjustment') {
      layer.adjustmentId = r.adjustmentId;
      layer.params = r.params;
    } else {
      delete layer.adjustmentId;
      delete layer.params;
    }
    if (r.kind === 'fill') {
      layer.fill = r.fill;
      layer.fillSize = [W, H];
    } else {
      delete layer.fill;
      delete layer.fillSize;
    }
    if (r.kind === 'smart') {
      layer.smart = r.smart;
      layer.smartSize = [W, H];
    } else {
      delete layer.smart;
      delete layer.smartSize;
    }
    if (r.kind === 'type') {
      layer.type = r.type;
      layer.typeSize = [W, H];
    } else {
      delete layer.type;
      delete layer.typeSize;
    }
    if (r.kind === 'shape') {
      layer.shape = r.shape;
      layer.shapeSize = [W, H];
    } else {
      delete layer.shape;
      delete layer.shapeSize;
    }
    layer.canvas.width = W;
    layer.canvas.height = H;
    if (r.pixels) {
      const { data, width, height } = r.pixels;
      layer.ctx.putImageData(new ImageData(data, width, height), 0, 0);
    }
    layer.mask = r.mask;
    layer.maskEnabled = r.maskEnabled;
    layer.maskDensity = r.maskDensity ?? 1;
    layer.maskFeather = r.maskFeather ?? 0;
    layer.vectorMask = r.vectorMask ?? null;
    syncLayerMask(layer);
    insertLayerBefore(layer, stackEl, layerInsertRef());
    return layer;
  });
  state.activeLayerIdx = activeIdx;
  state.editMask = false;
  if (sizeChanged) {
    setStackSize(W, H);
    state.historySource = new Map();
    state.sel.mode = 'none';
    state.sel.data = null;
    state.sel.mask = null;
    state.sel.baseData = null;
  }
  for (const layer of state.layers) {
    if (!state.historySource.has(layer.id)) snapshotHistorySource(layer);
  }
}

function afterHistoryStep() {
  // An untouched default frame follows the restored canvas size.
  if (state.cropDefault) {
    TOOLS.crop.cancel(ov, state);
    ensureCropFrame();
  }
  updateUndoButtons();
  refreshLayerPanelUI();
  propertiesPanel.render(true);
  renderHistoryPanel();
}

/**
 * While the Crop tool has frame history, Undo / Redo step the pending frame, not the document
 * (crop_ui.rs intercept); a stack with nothing left is a no-op. False when it does not apply.
 */
function cropHistoryStep(redo) {
  if (state.tool !== 'crop' || TOOLS.crop.historyEnabled(state, 'undo') === null) return false;
  TOOLS.crop.stepHistory(ov, state, redo);
  updateUndoButtons();
  return true;
}

// Document History Module — paint.js is the Adapter (sessions, remount, panels, dirty).
const {
  pushUndo,
  undo,
  redo,
  jumpUndo: jumpHistoryUndo,
  jumpRedo: jumpHistoryRedo,
  stepHistory
} = createHistoryController({
  getDoc: () => state,
  activeLayerId: () => activeLayer().id,
  commitOpenSessions: () => {
    // Any other command commits an open Free Transform or Blur Gallery first (each pushes its row).
    if (state.freeTransform) endFreeTransform(true);
    if (state.blurGallery) endBlurGallery(true);
    if (state.liquify) endLiquify(true);
    pullMaskEdit();
  },
  layerSnapshot,
  restoreLayerSnapshot,
  remountStack,
  cloneObjects,
  snapshotStack,
  isStackUndoLabel,
  applyDocMode,
  onChannelsRestored: () => renderChannels(),
  onPathsRestored: () => {
    endPenSubpath();
    state.pathAnchors = [];
    renderPaths();
  },
  onGuidesRestored: () => guidesView.renderGuides(),
  onQuickMaskRestored: (levels) => {
    const q = state.quickMask;
    if (q && levels?.length === q.levels.length) {
      q.levels = levels.slice();
      q.ctx.putImageData(
        new ImageData(maskToRgba(q.levels), q.canvas.width, q.canvas.height),
        0,
        0
      );
      drawQuickMaskView();
    }
  },
  onObjectsRestored: (ids) => {
    setObjectSelection(ids);
    redrawObjects();
  },
  noteFadeStep: (label) => noteFadeStep(state, label, FADEABLE_LABELS),
  onPushed: () => {
    fileDoc.markDirty();
    updateUndoButtons();
    renderHistoryPanel();
    scheduleAutosave(state, canvasW(), canvasH());
  },
  onStepped: afterHistoryStep,
  beforeUndo: () => {
    if (state.freeTransform) {
      endFreeTransform(false);
      return true;
    }
    if (state.blurGallery) {
      endBlurGallery(false);
      return true;
    }
    if (state.liquify) {
      endLiquify(false);
      return true;
    }
    return cropHistoryStep(false);
  },
  beforeRedo: () => cropHistoryStep(true)
});

function updateUndoButtons() {
  refreshMenus();
}

// ── History panel ────────────────────────────────────────────────────────────

function renderHistoryPanel() {
  const container = document.getElementById('history-list-container');
  if (!container) return;
  buildHistoryPanel(container, state.undoStack, state.redoStack, jumpHistoryUndo, jumpHistoryRedo, {
    snapshots: state.historySnapshots,
    onSnapshot: restoreHistorySnapshot,
    onDeleteState: deleteHistoryState,
    onNewSnapshot: newHistorySnapshot
  });
  docPanels.invalidate();
}

// History footer trash: step back past the current state and drop the redo states after it.
function deleteHistoryState() {
  if (!deleteCurrentState(state, stepHistory)) return;
  fileDoc.markDirty();
  afterHistoryStep();
}

function newHistorySnapshot() {
  pullMaskEdit();
  state.historySnapshots = addSnapshot(
    state.historySnapshots,
    snapshotStack(state.layers, state.activeLayerIdx)
  );
  renderHistoryPanel();
}

// Restoring a snapshot is itself a history state, so it can be undone.
function restoreHistorySnapshot(i) {
  const restored = restoreSnapshot(state.historySnapshots, i, {
    pushUndo,
    remount: remountStack
  });
  if (restored) afterHistoryStep();
}

// ── Zoom / Pan ───────────────────────────────────────────────────────────────

function updateTransform() {
  stackEl.style.transform = viewTransformCss(viewOf(state), canvasW(), canvasH());
  const zoomEl = document.getElementById('zoom-display');
  if (zoomEl) zoomEl.textContent = Math.round(state.zoom * 100) + '%';
  updateDocTab(state);
  guidesView.render();
  extrasView.render();
  docPanels.refresh();
}

/** Client point → view point: CSS pixels from the canvas stack's untransformed origin. */
function toView(clientX, clientY) {
  const area = document.getElementById('canvas-area');
  const rect = area.getBoundingClientRect();
  return [
    clientX - rect.left - area.clientLeft + area.scrollLeft - stackEl.offsetLeft,
    clientY - rect.top - area.clientTop + area.scrollTop - stackEl.offsetTop
  ];
}

/** View point → client point (the inverse of toView). */
function viewToClient(vx, vy) {
  const area = document.getElementById('canvas-area');
  const rect = area.getBoundingClientRect();
  return [
    vx + rect.left + area.clientLeft - area.scrollLeft + stackEl.offsetLeft,
    vy + rect.top + area.clientTop - area.scrollTop + stackEl.offsetTop
  ];
}

/** A guide edit from a ruler drag or a View command: an undoable row, then redraw. */
function setGuides(guides, label) {
  pushUndo(label);
  state.guides = guides;
  // A guide made while guides are hidden shows them (rulers.rs finish_drag).
  if (label === 'New Guide' || label === 'New Guide Layout') state.showGuides = true;
  guidesView.renderGuides();
  refreshMenus?.();
}

/** A View › Extras / Show / Snap command changed the view flags: redraw what they show. */
function updateExtras(change) {
  change(state);
  guidesView.renderGuides();
  extrasView.render();
  if (state.sel.mode === 'active' && !state.drawing) drawSelectionOverlay(state, ov);
  refreshMenus?.();
}

// Layers that are Snap To Layers targets: visible, with pixels of their own.
function snapLayerRects(excludeId) {
  const W = canvasW(),
    H = canvasH();
  return state.layers
    .filter((l) => l.visible !== false && l.ctx && l.id !== excludeId)
    .filter((l) => l.kind !== 'adjustment' && l.kind !== 'group')
    .map((l) => alphaBounds(l.ctx.getImageData(0, 0, W, H).data, W, H))
    .filter(Boolean)
    .map((b) => [b.x0, b.y0, b.x1, b.y1]);
}

function currentSnapTargets(excludeId = null) {
  const opts = snapOptions(state);
  if (!opts) return null;
  return snapTargets({
    W: canvasW(),
    H: canvasH(),
    opts,
    guides: state.guides,
    layerRects: opts.layers ? snapLayerRects(excludeId) : [],
    step: gridStep(state.grid)
  });
}

// Marquee and crop corners and Free Transform handles snap the pointer itself.
const POINT_SNAP_TOOLS = new Set(['rectSelect', 'ellipseSelect', 'crop']);

/** A press at (x, y), before the tool sees it: point tools snap the pointer (snap_ui.rs begin). */
function beginSnap(x, y) {
  state.snapDrag = null;
  if (!state.freeTransform && !POINT_SNAP_TOOLS.has(state.tool)) return;
  const t = currentSnapTargets();
  if (t) state.snapDrag = beginSnapDrag('point', [x, y], t, snapThreshold(state.zoom));
}

/**
 * After the press: a Move-tool layer drag or a dragged selection snaps the box it moves, and
 * with Smart Guides on reports the layer alignments it makes.
 */
function retargetSnap(x, y) {
  const drag = state.objectDrag;
  const sel = state.sel;
  let rect = null,
    exclude = null;
  if (sel.mode === 'moving') {
    rect = [sel.x, sel.y, sel.x + sel.w, sel.y + sel.h];
  } else if (state.tool === 'select' && drag?.mode === 'layer') {
    const b = alphaBounds(drag.src.data, drag.src.width, drag.src.height);
    if (b) rect = [b.x0, b.y0, b.x1, b.y1];
    exclude = activeLayer()?.id ?? null;
  }
  if (!rect) return;
  const t = currentSnapTargets(exclude);
  if (!t) {
    state.snapDrag = null;
    return;
  }
  const smart = shows(state, 'smartGuides')
    ? smartTargets(
        snapTargets({
          W: canvasW(),
          H: canvasH(),
          opts: { layers: true, document: true },
          layerRects: snapLayerRects(exclude)
        })
      )
    : null;
  state.snapDrag = beginSnapDrag('rect', [x, y], t, snapThreshold(state.zoom), rect, smart);
}

/** View › Rulers (Ctrl+R): the canvas area shrinks to make room, so the view redraws. */
function toggleRulers() {
  state.showRulers = !state.showRulers;
  guidesView.renderRulers();
  updateTransform();
  refreshMenus?.();
}

function areaSize() {
  const area = document.getElementById('canvas-area');
  return [area.clientWidth, area.clientHeight];
}

function zoomToward(clientX, clientY, factor) {
  const [vx, vy] = toView(clientX, clientY);
  applyView(state, zoomAt(viewOf(state), canvasW(), canvasH(), vx, vy, state.zoom * factor));
  updateTransform();
}

/** Run a paint/view.js view function on the current view and area, then redraw. */
function setView(fn, ...args) {
  applyView(state, fn(viewOf(state), canvasW(), canvasH(), ...args));
  updateTransform();
}

/** View › Fit Layer(s) on Screen: the selected layers' pixel bounds (the document if empty). */
function fitLayersOnScreen() {
  const ids = new Set(stateLayerSelection(state).ids);
  const W = canvasW(),
    H = canvasH();
  const bounds = unionBounds(
    state.layers
      .filter((l) => ids.has(l.id) && l.ctx)
      .map((l) => alphaBounds(l.ctx.getImageData(0, 0, W, H).data, W, H))
  );
  setView(fitBounds, bounds, ...areaSize());
}

/** View › Screen Mode: Full Screen modes hide panels; Full Screen also takes the display. */
function setScreenMode(mode) {
  state.screenMode = mode;
  const layout = document.querySelector('.paint-layout');
  for (const [cls, on] of Object.entries(screenModeClasses(mode))) {
    layout?.classList.toggle(cls, on);
  }
  const root = document.documentElement;
  if (mode === 'fullScreen' && !document.fullscreenElement) {
    root.requestFullscreen?.()?.catch?.(() => {});
  } else if (mode !== 'fullScreen' && document.fullscreenElement) {
    document.exitFullscreen?.()?.catch?.(() => {});
  }
  refreshMenus?.();
}

// ── Selection helpers ────────────────────────────────────────────────────────
// The actual implementations live in `./selection.js`. The wrappers below
// inject the shared `state`, the overlay context `ov`, and a couple of
// closures so the rest of paint.js can keep its no-arg call sites unchanged.

function commitSelection() {
  doCommitSelection(state, ov, activeCtx());
}
async function copySelection(ctx, cut) {
  const copied = doCopySelection(state, ov, ctx, cut, pushUndo);
  if (copied && state.clipboard?.data) {
    const blob = await imageDataToPngBlob(state.clipboard.data);
    await writePngBlobToClipboard(blob);
    return;
  }
  if (!cut) {
    // No selection — copy the full flattened document to the OS clipboard
    const blob = await exportPNGBlob(state, canvasW(), canvasH());
    await writePngBlobToClipboard(blob);
  }
}
/** Visible viewport center in canvas pixel coords (accounts for pan/zoom). */
function viewportPasteOrigin(pasteW, pasteH) {
  const area = document.getElementById('canvas-area');
  if (!area) return { x: 0, y: 0 };
  const rect = area.getBoundingClientRect();
  // Center of visible area in canvas coords
  const [cx, cy] = viewToDoc(viewOf(state), canvasW(), canvasH(), rect.width / 2, rect.height / 2);
  return {
    x: Math.round(cx - pasteW / 2),
    y: Math.round(cy - pasteH / 2)
  };
}
/**
 * Where a clipboard paste lands. Paste centres on the view (paste_offset with the view centre,
 * kept on the canvas); Paste in Place keeps the copied position. A clip with no position (an
 * OS image) centres on the view.
 */
function pasteOrigin(clip, inPlace) {
  const view = viewportPasteOrigin(clip.w, clip.h);
  if (clip.x == null) return view;
  const center = [view.x + clip.w / 2, view.y + clip.h / 2];
  const { dx, dy } = pasteOffset(clip, { w: canvasW(), h: canvasH() }, { center, inPlace });
  return { x: clip.x + dx, y: clip.y + dy };
}
function pasteClipboard(ctx, inPlace = false) {
  const clip = state.clipboard;
  if (!clip) return;
  const origin = pasteOrigin(clip, inPlace);
  // Prefer Drawings-style image object for pasted bitmaps
  if (clip.data && !clip.localMask) {
    pushUndo('Paste');
    commitSelection();
    const obj = createImageObjectFromImageData(clip.data, origin.x, origin.y);
    state.objects.push(obj);
    setObjectSelection([obj.id]);
    redrawObjects();
    setActiveTool('select');
    return;
  }
  if (!doPasteClipboard(state, ctx, pushUndo, origin.x, origin.y)) return;
  selectPlacedContent();
}
/** Edit › Paste: the in-app clipboard, else an image the OS clipboard holds. */
async function pasteCommand() {
  if (state.clipboard) {
    pasteClipboard(activeCtx());
    return;
  }
  try {
    for (const item of (await navigator.clipboard?.read?.()) ?? []) {
      const type = item.types.find((t) => t.startsWith('image/'));
      if (type) {
        void pasteImageFile(await item.getType(type));
        return;
      }
    }
  } catch {
    // Permission denied / unsupported — the Cmd+V paste event still works.
  }
}
/**
 * Edit › Paste Special › Paste Into / Paste Outside (extra_cmds.rs paste_into): the clipboard
 * centred on the selection, not kept on the canvas, as a new layer above the active one whose
 * mask reveals only the selection (or everything but it). One stack undo; the selection drops.
 */
function pasteIntoSelection(outside) {
  const clip = state.clipboard;
  if (!clip?.data || state.sel.mode !== 'active') return;
  const W = canvasW(),
    H = canvasH();
  const selMask = selectionToFullMask(state.sel, W, H);
  const center = selectionCenter(state.sel);
  const box = { x: clip.x ?? 0, y: clip.y ?? 0, w: clip.w, h: clip.h };
  const { dx, dy } = pasteOffset(box, { w: W, h: H }, { center, clamp: false });
  commitSelection();
  pushUndo(outside ? 'Paste Outside' : 'Paste Into');
  const layer = createLayer(`Layer ${state.layers.length + 1}`, W, H);
  layer.ctx.putImageData(clip.data, box.x + dx, box.y + dy);
  layer.mask = pasteIntoMask(selMask, W, H, outside);
  layer.maskEnabled = true;
  syncLayerMask(layer);
  insertLayerAboveActive(layer);
  refreshLayerPanelUI();
  scheduleComposite();
}
/** Edit › Copy Merged: the selection (or the canvas) of the visible composite. */
async function copyMerged() {
  const W = canvasW(),
    H = canvasH();
  const flat = mergedCanvas(state, W, H);
  const fctx = flat.getContext('2d', { willReadFrequently: true });
  const sel = state.sel;
  if (sel.mode === 'active' && sel.w >= 1 && sel.h >= 1) {
    state.clipboard = {
      data: getSelectionImageData(state, fctx),
      x: sel.x,
      y: sel.y,
      w: sel.w,
      h: sel.h,
      localMask: extractLocalMask(sel, W)
    };
  } else {
    state.clipboard = {
      data: fctx.getImageData(0, 0, W, H),
      x: 0,
      y: 0,
      w: W,
      h: H,
      localMask: null
    };
  }
  refreshMenus();
  await writePngBlobToClipboard(await imageDataToPngBlob(state.clipboard.data));
}
function toggleLastState() {
  doToggleLastState({ undoStack: state.undoStack, redoStack: state.redoStack, undo, redo });
}
async function pasteImageFile(file) {
  try {
    pushUndo('Paste');
    commitSelection();
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => {
      const origin = viewportPasteOrigin(
        img.naturalWidth || img.width,
        img.naturalHeight || img.height
      );
      const obj = createImageObjectFromImage(img, origin.x, origin.y);
      state.objects.push(obj);
      setObjectSelection([obj.id]);
      URL.revokeObjectURL(url);
      redrawObjects();
      setActiveTool('select');
    };
    img.onerror = () => URL.revokeObjectURL(url);
    img.src = url;
  } catch (err) {
    console.warn('Could not paste image', err);
  }
}
/** After raster placement, switch to object Select when possible. */
function selectPlacedContent() {
  setActiveTool('select');
  drawSelectionOverlay(state, ov);
}

// ── Move tool (PhotoCraft: object, selection, or layer under the pointer) ────────

function setObjectSelection(ids) {
  const unique = [];
  const seen = new Set();
  for (const id of ids || []) {
    if (id == null || seen.has(id)) continue;
    if (!findObject(state.objects, id)) continue;
    seen.add(id);
    unique.push(id);
  }
  state.selectedObjectIds = unique;
  state.selectedObjectId = unique.length ? unique[unique.length - 1] : null;
}

function deselectObject() {
  setObjectSelection([]);
  state.objectDrag = null;
  ov.clearRect(0, 0, overlayCanvas.width, overlayCanvas.height);
  redrawObjects();
}

function beginObjectSelect(x, y) {
  // Dragging inside a selection moves the selected pixels (floating or not).
  if (tryBeginMove(state, activeCtx(), x, y)) return;
  commitSelection();

  // Resize handles on the selected object
  if (state.selectedObjectIds.length === 1) {
    const selected = findObject(state.objects, state.selectedObjectId);
    const handle = selected ? hitTestHandle(selected, x, y, state.zoom) : null;
    if (handle && selected) {
      state.objectDrag = {
        id: selected.id,
        mode: 'resize',
        handle,
        startX: x,
        startY: y,
        start: {
          x: selected.x,
          y: selected.y,
          w: selected.w,
          h: selected.h,
          fontSize: selected.fontSize,
          canvasX: selected.canvasX,
          canvasY: selected.canvasY,
          fontSpec: selected.fontSpec
        },
        moved: false
      };
      state.drawing = true;
      overlayCanvas.style.cursor = handleCursor(handle);
      redrawObjects();
      return;
    }
  }

  const hit = hitTestObject(state.objects, x, y);
  if (!hit && !editingMask() && positionLocked(state.layers, activeLayer())) {
    showStatusMessage(`Could not move: the layer "${activeLayer().name}" is position-locked`);
    return;
  }
  if (!hit && isBackgroundLayer(activeLayer()) && !editingMask()) {
    showStatusMessage(
      'Could not move: the Background layer is locked (Layer › New › Layer from Background unlocks it)'
    );
    return;
  }
  if (!hit) {
    // Nothing else hit — move the active layer's pixels, and its linked layers by the same delta
    const ctx = activeCtx();
    const W = ctx.canvas.width;
    const H = ctx.canvas.height;
    const partners = linkedMovers(activeLayer(), 'move');
    if (!partners) return;
    setObjectSelection([]);
    redrawObjects();
    state.objectDrag = {
      mode: 'layer',
      startX: x,
      startY: y,
      src: ctx.getImageData(0, 0, W, H),
      fill: [0, 0, 0, 0],
      linked: partners.map((layer) => ({ layer, src: layer.ctx.getImageData(0, 0, W, H) })),
      dx: 0,
      dy: 0
    };
    state.drawing = true;
    return;
  }

  // Double-click text → re-edit (only when already the sole selection)
  const now = performance.now();
  if (
    hit.type === 'text' &&
    state.selectedObjectIds.length === 1 &&
    state.selectedObjectId === hit.id &&
    state._lastObjectClickId === hit.id &&
    now - (state._lastObjectClickAt || 0) < 400
  ) {
    state._lastObjectClickAt = 0;
    openTextObjectEditor(hit);
    return;
  }
  state._lastObjectClickId = hit.id;
  state._lastObjectClickAt = now;

  setObjectSelection([hit.id]);
  const moveIds = [hit.id];
  state.objectDrag = {
    mode: 'move',
    ids: moveIds,
    startX: x,
    startY: y,
    origins: moveIds.map((id) => {
      const o = findObject(state.objects, id);
      return { id, x: o.x, y: o.y };
    }),
    moved: false
  };
  state.drawing = true;
  redrawObjects();
}

function dragObjectSelect(x, y) {
  const drag = state.objectDrag;
  if (!drag) return;

  if (drag.mode === 'layer') {
    const dx = Math.round(x - drag.startX);
    const dy = Math.round(y - drag.startY);
    if (dx === drag.dx && dy === drag.dy) return;
    drag.dx = dx;
    drag.dy = dy;
    putLayerOffset(drag, dx, dy);
    return;
  }

  if (drag.mode === 'resize') {
    const obj = findObject(state.objects, drag.id);
    if (!obj) return;
    if (!drag.moved) {
      pushUndo('Resize Object');
      drag.moved = true;
    }
    // Shift (or Ctrl/Cmd) locks aspect ratio.
    const lockAspect = !!(state.shiftKey || state.ctrlKey);
    resizeObjectFromHandle(obj, drag.handle, x, y, drag.start, lockAspect);
    redrawObjects();
    updateStatus(x, y, { w: obj.w, h: obj.h });
    return;
  }

  // Group move
  const dx = x - drag.startX;
  const dy = y - drag.startY;
  if (!drag.moved && (Math.round(dx) !== 0 || Math.round(dy) !== 0)) {
    pushUndo(drag.ids.length > 1 ? 'Move Objects' : 'Move Object');
    drag.moved = true;
  }
  for (const orig of drag.origins) {
    const obj = findObject(state.objects, orig.id);
    if (!obj) continue;
    moveObject(obj, Math.round(orig.x + dx), Math.round(orig.y + dy));
  }
  redrawObjects();
  const moved = drag.ids.map((id) => findObject(state.objects, id)).filter(Boolean);
  const bounds = objectsBounds(moved);
  if (bounds) updateStatus(x, y, { w: bounds.w, h: bounds.h });
}

function putLayerOffset(drag, dx, dy) {
  const { src } = drag;
  const out = offsetLayerPixels(src.data, src.width, src.height, dx, dy, drag.fill);
  activeCtx().putImageData(new ImageData(out, src.width, src.height), 0, 0);
  offsetLinked(drag.linked ?? [], dx, dy, toImageData);
}

function endObjectSelect() {
  const drag = state.objectDrag;
  if (drag?.mode === 'layer' && (drag.dx || drag.dy)) {
    // One undo step on release: snapshot the pre-move pixels, then re-apply the offset
    activeCtx().putImageData(drag.src, 0, 0);
    const linked = drag.linked ?? [];
    for (const { layer: l, src } of linked) l.ctx.putImageData(src, 0, 0);
    const layer = activeLayer();
    // Linked layers move in one whole-stack undo row.
    pushUndo(
      isTypeLayer(layer) ? 'Move Type' : isShapeLayer(layer) ? 'Move Shape' : 'Move Layer',
      linked.length > 0 || undefined
    );
    putLayerOffset(drag, drag.dx, drag.dy);
    for (const l of [layer, ...linked.map((e) => e.layer)]) {
      // A type layer moves its anchor and draws again, so the text stays whole past the edges.
      if (isTypeLayer(l)) {
        l.type = translateType(l.type, drag.dx, drag.dy);
        renderTypeLayer(l);
      }
      // A shape layer moves its path, so it draws whole past the edges and stays editable.
      if (isShapeLayer(l)) {
        l.shape = translateShape(l.shape, drag.dx, drag.dy);
        renderShapeLayer(l);
      }
    }
    if (linked.length) scheduleComposite();
    refreshLayerPanelUI();
  }
  state.objectDrag = null;
  state.drawing = false;
}

function deleteSelectedObject() {
  if (!state.selectedObjectIds.length) return false;
  pushUndo(state.selectedObjectIds.length > 1 ? 'Delete Objects' : 'Delete Object');
  const remove = new Set(state.selectedObjectIds);
  state.objects = state.objects.filter((o) => !remove.has(o.id));
  setObjectSelection([]);
  redrawObjects();
  return true;
}

function openTextObjectEditor(obj) {
  // Remove from canvas temporarily while editing (hide by not rendering selected...
  // keep in list but show textarea over it)
  const input = /** @type {HTMLTextAreaElement} */ (document.getElementById('text-input'));
  if (!input) return;
  const area = document.getElementById('canvas-area');
  const areaRect = area.getBoundingClientRect();
  const stackRect = overlayCanvas.getBoundingClientRect();
  const screenX = stackRect.left - areaRect.left + obj.canvasX * state.zoom;
  const screenY = stackRect.top - areaRect.top + obj.canvasY * state.zoom;
  input.style.left = screenX + 'px';
  input.style.top = screenY + 'px';
  input.style.fontFamily = obj.family || 'sans-serif';
  input.style.fontSize = obj.fontSize * state.zoom + 'px';
  input.style.fontWeight = obj.bold ? 'bold' : 'normal';
  input.style.fontStyle = obj.italic ? 'italic' : 'normal';
  input.style.color = obj.color;
  input.value = obj.text;
  input.style.display = 'block';
  input.dataset.editingObjectId = String(obj.id);
  input.dataset.canvasX = String(obj.canvasX);
  input.dataset.canvasY = String(obj.canvasY);
  input.dataset.layerId = '';
  input.dataset.fontSpec = obj.fontSpec;
  input.dataset.fontSize = String(obj.fontSize);
  // Hide the object while editing so we don't see double text
  obj._hiddenWhileEdit = true;
  redrawObjects();
  input.focus();
  input.select();
}

// ── Type layers (paint/type-layers.js) ───────────────────────────────────────

// The text box shows over the canvas while a type layer is edited; the layer's own pixels are
// cleared meanwhile so the text is not seen twice.
// box is the paragraph text box ({ w, h }, x / y its top-left), or null for point text.
// mask is null, or the Type Mask tools' combine mode ('new', 'add', 'subtract', 'intersect').
const typeEdit = {
  layerId: null,
  mask: null,
  x: 0,
  y: 0,
  orientation: 'horizontal',
  antialias: 'smooth',
  box: null
};

// The record keys the Type tool's options carry: the options bar's, then the Character and
// Paragraph panels' (a type layer loads them all back when it is edited again).
const TYPE_OPTION_KEYS = [
  'family',
  'size',
  'color',
  'align',
  'bold',
  'italic',
  'leading',
  'tracking',
  'fauxBold',
  'fauxItalic',
  'indentLeft',
  'indentRight',
  'indentFirst',
  'spaceBefore',
  'spaceAfter'
];

function measureType(font, text) {
  const ctx = overlayCanvas.getContext('2d');
  ctx.save();
  ctx.font = font;
  const w = ctx.measureText(text).width;
  ctx.restore();
  return w;
}

// Horizontal and Vertical Type share one options bar; each keeps its own values.
function typeOptions() {
  const o = state.toolOptions[isTypeTool(state.tool) ? state.tool : 'text'] || {};
  const picked = Object.fromEntries(TYPE_OPTION_KEYS.map((k) => [k, o[k]]));
  return normalizeType({ ...picked, color: o.color ?? state.color });
}

/** The text box follows the type options (font, size, colour, alignment) while it is open. */
function styleTypeInput() {
  const input = /** @type {HTMLTextAreaElement} */ (document.getElementById('text-input'));
  if (!input || input.style.display === 'none' || input.dataset.editingObjectId) return;
  const t = typeOptions();
  const area = document.getElementById('canvas-area');
  const areaRect = area.getBoundingClientRect();
  const stackRect = overlayCanvas.getBoundingClientRect();
  // The anchor is the first baseline: the box starts an ascent above it.
  const top = typeEdit.y - t.size * 0.8;
  input.style.left = stackRect.left - areaRect.left + typeEdit.x * state.zoom + 'px';
  input.style.top = stackRect.top - areaRect.top + top * state.zoom + 'px';
  input.style.fontFamily = t.family;
  input.style.fontSize = t.size * state.zoom + 'px';
  input.style.lineHeight = String(1.2);
  input.style.fontWeight = t.bold ? 'bold' : 'normal';
  input.style.fontStyle = t.italic ? 'italic' : 'normal';
  input.style.color = t.color;
  input.style.letterSpacing = ((t.tracking * t.size) / 1000) * state.zoom + 'px';
  if (t.leading > 0) input.style.lineHeight = t.leading * state.zoom + 'px';
  const box = typeEdit.box;
  input.style.width = box ? box.w * state.zoom + 'px' : '';
  input.style.height = box ? box.h * state.zoom + 'px' : '';
  input.style.whiteSpace = box ? 'pre-wrap' : '';
  input.style.textIndent = box ? t.indentFirst * state.zoom + 'px' : '';
  input.style.paddingLeft = box ? t.indentLeft * state.zoom + 'px' : '';
  input.style.paddingRight = box ? t.indentRight * state.zoom + 'px' : '';
  if (box) {
    // Paragraph text: the textarea is the box, wrapping its lines as the layer will.
    input.style.left = stackRect.left - areaRect.left + typeEdit.x * state.zoom + 'px';
    input.style.top = stackRect.top - areaRect.top + typeEdit.y * state.zoom + 'px';
    input.style.writingMode = '';
    input.style.textOrientation = '';
    input.style.textAlign = t.align;
    input.style.transform = '';
    return;
  }
  if (typeEdit.orientation === 'vertical') {
    // A vertical box: the first column centred on the anchor, glyphs running down from it.
    input.style.writingMode = 'vertical-rl';
    input.style.textOrientation = 'upright';
    const left = typeEdit.x - t.size / 2;
    input.style.left = stackRect.left - areaRect.left + left * state.zoom + 'px';
    input.style.top = stackRect.top - areaRect.top + typeEdit.y * state.zoom + 'px';
    input.style.textAlign = 'left';
    input.style.transform = '';
    return;
  }
  input.style.writingMode = '';
  input.style.textOrientation = '';
  input.style.textAlign = t.align === 'justify' ? 'left' : t.align;
  input.style.transform =
    t.align === 'center' ? 'translateX(-50%)' : t.align === 'right' ? 'translateX(-100%)' : '';
}

/**
 * The Type tool's click: on a type layer's text it edits that layer again (its options load into
 * the bar); elsewhere a new type layer starts at the click, its first baseline there.
 */
function beginType(x, y, orientation = 'horizontal', mask = null) {
  const input = /** @type {HTMLTextAreaElement} */ (document.getElementById('text-input'));
  if (!input) return;
  // The Type Mask tools always start new text: it becomes a selection, not a layer.
  const idx = mask ? -1 : typeLayerAt(state.layers, x, y, measureType);
  typeEdit.mask = mask;
  const layer = idx >= 0 ? state.layers[idx] : null;
  const opts = (state.toolOptions[isTypeTool(state.tool) ? state.tool : 'text'] ??= {});
  if (layer) {
    if (idx !== state.activeLayerIdx) setActiveLayer(idx);
    const t = layer.type;
    for (const k of TYPE_OPTION_KEYS) opts[k] = t[k];
    typeEdit.layerId = layer.id;
    typeEdit.x = t.x;
    typeEdit.y = t.y;
    typeEdit.orientation = t.orientation;
    typeEdit.antialias = t.antialias;
    typeEdit.box = t.box;
    layer.ctx.clearRect(0, 0, layer.canvas.width, layer.canvas.height);
    scheduleComposite();
  } else {
    opts.color = state.color;
    typeEdit.layerId = null;
    typeEdit.x = x;
    typeEdit.y = y;
    typeEdit.orientation = orientation;
    typeEdit.antialias = 'smooth';
    typeEdit.box = null;
  }
  delete input.dataset.editingObjectId;
  input.value = layer ? layer.type.text : '';
  input.style.display = 'block';
  styleTypeInput();
  refreshToolOptions();
  input.focus();
  if (layer) input.select();
}

/**
 * The Type tool's drag ended with a box: the new text box opened on pointer down becomes
 * paragraph text there. A drag that began on existing text keeps editing that text.
 */
function beginParagraph(box) {
  if (typeEdit.layerId != null) return;
  typeEdit.x = box.x;
  typeEdit.y = box.y;
  typeEdit.orientation = 'horizontal';
  typeEdit.box = { w: box.w, h: box.h };
  styleTypeInput();
  document.getElementById('text-input')?.focus();
}

/** Commit the text box: a new type layer above the active one, or the edited layer redrawn. */
function commitType(text) {
  const t = {
    ...typeOptions(),
    text,
    x: typeEdit.x,
    y: typeEdit.y,
    orientation: typeEdit.orientation,
    antialias: typeEdit.antialias,
    box: typeEdit.box
  };
  if (typeEdit.mask) {
    commitTypeMask(t, typeEdit.mask);
    return;
  }
  const editing = state.layers.find((l) => l.id === typeEdit.layerId);
  typeEdit.layerId = null;
  if (editing && isTypeLayer(editing)) {
    if (!text.trim()) {
      // Emptied text leaves nothing to keep: the layer goes, as in Photoshop.
      renderTypeLayer(editing);
      deleteLayer(state.layers.indexOf(editing));
      return;
    }
    // The undo snapshot reads the canvas: draw the old text back first.
    renderTypeLayer(editing);
    pushUndo('Edit Type Layer');
    editing.type = normalizeType(t);
    editing.name = typeLayerName(text);
    renderTypeLayer(editing);
  } else {
    if (!text.trim()) return;
    pushUndo('New Type Layer');
    const layer = createTypeLayer(typeLayerName(text), t, canvasW(), canvasH());
    insertLayerAboveActive(layer);
  }
  refreshLayerPanelUI();
  scheduleComposite();
  scheduleAutosave(state, canvasW(), canvasH());
}

/**
 * The Type Mask tools' commit (PhotoCraft type.createSelection): the glyphs, drawn as a type
 * layer would draw them, become the selection, combined with the current one by mode. No text
 * leaves the selection as it was.
 */
function commitTypeMask(t, mode) {
  typeEdit.mask = null;
  if (!t.text.trim()) return;
  const W = canvasW();
  const H = canvasH();
  const scratch = document.createElement('canvas');
  scratch.width = W;
  scratch.height = H;
  const sctx = scratch.getContext('2d');
  renderType(sctx, normalizeType(t));
  const mask = typeSelectionMask(sctx.getImageData(0, 0, W, H).data, W, H);
  if (state.sel.data && state.sel.baseData) stampFloatingSelection(state, activeCtx());
  applySelectionWithMask(mask, W, H, mode === 'new' || state.sel.mode !== 'active' ? null : mode);
  ov.clearRect(0, 0, overlayCanvas.width, overlayCanvas.height);
  if (state.sel.mode === 'active') drawSelectionOverlay(state, ov);
}

/** Type › Warp Text…: the dialog edits the active type layer's warp, previewing on the layer. */
function openWarpText() {
  pointer.commitTextInput();
  const layer = activeLayer();
  if (!isTypeLayer(layer)) return;
  const before = layer.type;
  warpTextDialog.open(before.warp, {
    preview(warp) {
      layer.type = withWarp(before, warp);
      renderTypeLayer(layer);
      scheduleComposite();
    },
    commit(warp) {
      layer.type = before;
      editActiveType('Warp Text', (t) => withWarp(t, warp));
    },
    cancel() {
      layer.type = before;
      renderTypeLayer(layer);
      scheduleComposite();
    }
  });
}

/** Close the text box without keeping its edits (Escape, the options bar's cancel). */
function cancelTextInput() {
  const input = /** @type {HTMLTextAreaElement} */ (document.getElementById('text-input'));
  if (!input || input.style.display === 'none') return false;
  const editingId = input.dataset.editingObjectId;
  if (editingId) {
    const obj = findObject(state.objects, parseInt(editingId, 10));
    if (obj) obj._hiddenWhileEdit = false;
    delete input.dataset.editingObjectId;
    redrawObjects();
  }
  const editing = state.layers.find((l) => l.id === typeEdit.layerId);
  typeEdit.layerId = null;
  typeEdit.mask = null;
  if (editing) {
    renderTypeLayer(editing);
    scheduleComposite();
  }
  input.style.display = 'none';
  input.value = '';
  return true;
}

/** The active type layer's record rewritten by edit(type) under one undo step. */
function editActiveType(label, edit) {
  pointer.commitTextInput();
  const layer = activeLayer();
  if (!isTypeLayer(layer)) return;
  renderTypeLayer(layer);
  pushUndo(label);
  layer.type = edit(layer.type);
  renderTypeLayer(layer);
  refreshLayerPanelUI();
  scheduleComposite();
  scheduleAutosave(state, canvasW(), canvasH());
}

/** Type › Anti-Alias: None, Sharp, Crisp, Strong, Smooth. */
function setTypeAntialias(mode) {
  editActiveType('Anti-Alias', (t) => withAntialias(t, mode));
}

/** Type › Convert to Paragraph Text: a box around the point text, the lines where they were. */
function convertTypeToParagraph() {
  editActiveType('Convert to Paragraph Text', (t) => toParagraphText(t, measureType));
}

/** Type › Convert to Point Text: wrapped lines become hard breaks. */
function convertTypeToPoint() {
  editActiveType('Convert to Point Text', (t) => toPointText(t, measureType));
}

/**
 * A Character or Paragraph panel edit: the Type tool's options always take it; the active type
 * layer (after the open text box commits) takes it under one undo step.
 */
function setTypeFields(patch) {
  const opts = (state.toolOptions[isTypeTool(state.tool) ? state.tool : 'text'] ??= {});
  Object.assign(opts, patch);
  const paragraph = Object.keys(patch).some((k) => k === 'align' || /^indent|^space/.test(k));
  pointer.commitTextInput();
  if (isTypeLayer(activeLayer())) {
    editActiveType(paragraph ? 'Paragraph' : 'Character', (t) =>
      Object.entries(patch).reduce((acc, [k, v]) => withTypeField(acc, k, v), t)
    );
  }
  if (isTypeTool(state.tool)) refreshToolOptions();
  typePanels.render();
}

/** What the Character and Paragraph panels show: the active type layer, else the tool options. */
function typePanelRecord() {
  const layer = activeLayer();
  return isTypeLayer(layer) ? layer.type : typeOptions();
}

/** Type › Orientation: Horizontal or Vertical, about the same anchor. */
function setTypeOrientation(orientation) {
  editActiveType('Change Text Orientation', (t) => withOrientation(t, orientation));
}

/**
 * Type › Paste Lorem Ipsum (PhotoCraft paste_lorem): at the caret while typing, at the end of
 * the active type layer's text, else a new type layer over the middle of the canvas.
 */
function pasteLoremIpsum() {
  const input = /** @type {HTMLTextAreaElement} */ (document.getElementById('text-input'));
  if (input && input.style.display !== 'none' && !input.dataset.editingObjectId) {
    const at = input.selectionStart ?? input.value.length;
    const end = input.selectionEnd ?? at;
    input.value = insertLorem(input.value.slice(0, at) + input.value.slice(end), at);
    input.selectionStart = input.selectionEnd = at + insertLorem('').length;
    input.focus();
    return;
  }
  if (isTypeLayer(activeLayer())) {
    editActiveType('Paste Lorem Ipsum', (t) => ({ ...t, text: insertLorem(t.text) }));
    return;
  }
  pushUndo('Paste Lorem Ipsum');
  const t = loremTypeRecord(canvasW(), canvasH(), typeOptions(), measureType);
  insertLayerAboveActive(createTypeLayer(typeLayerName(t.text), t, canvasW(), canvasH()));
  refreshLayerPanelUI();
  scheduleComposite();
  scheduleAutosave(state, canvasW(), canvasH());
}

/** Type › Rasterize Type Layer, Layer › Rasterize › Type: the text becomes pixels as it looks. */
function rasterizeTypeLayer() {
  pointer.commitTextInput();
  const layer = activeLayer();
  if (!isTypeLayer(layer)) return;
  renderTypeLayer(layer);
  pushUndo('Rasterize Type');
  layer.kind = 'pixel';
  delete layer.type;
  delete layer.typeSize;
  refreshLayerPanelUI();
  scheduleComposite();
  scheduleAutosave(state, canvasW(), canvasH());
}

// ── Shape layers (paint/shapes.js) ───────────────────────────────────────────

/** A Shape tool drag's record becomes a new shape layer above the active one. */
function addShapeLayer(tool, shape) {
  pushUndo('New Shape Layer');
  const name = nextShapeLayerName(shapeLayerBase(tool), state.layers);
  insertLayerAboveActive(createShapeLayer(name, shape, canvasW(), canvasH()));
  refreshLayerPanelUI();
  scheduleComposite();
  scheduleAutosave(state, canvasW(), canvasH());
}

/** An options-bar edit on the active shape layer (shape_options.rs → shape.edit). */
function editActiveShape(key, value) {
  const layer = activeLayer();
  if (!isShapeLayer(layer)) return;
  const next = editShape(layer.shape, key, value, {
    fillColor: state.color,
    strokeColor: state.bgColor,
    strokeAlign: state.toolOptions[state.tool]?.strokeAlign
  });
  if (next === layer.shape) return;
  // A drag in a colour well or a run of keystrokes in one field is one history step.
  const now = Date.now();
  const last = lastShapeEdit;
  if (!(last && last.id === layer.id && last.key === key && now - last.at < 1000)) {
    pushUndo('Edit Shape');
  }
  lastShapeEdit = { id: layer.id, key, at: now };
  layer.shape = next;
  renderShapeLayer(layer);
  refreshLayerPanelUI();
  scheduleComposite();
  scheduleAutosave(state, canvasW(), canvasH());
}

/** Layer › Rasterize › Shape: the shape becomes pixels as it looks; its path is gone. */
function rasterizeShapeLayer() {
  const layer = activeLayer();
  if (!isShapeLayer(layer)) return;
  renderShapeLayer(layer);
  pushUndo('Rasterize Shape');
  layer.kind = 'pixel';
  delete layer.shape;
  delete layer.shapeSize;
  refreshLayerPanelUI();
  scheduleComposite();
  scheduleAutosave(state, canvasW(), canvasH());
}

// ── Combine Shapes and vector masks (paint/combine-shapes.js) ────────────────

/** Layer › Combine Shapes: op 'combine' … 'exclude', or null for Merge Shape Components. */
function combineShapes(op) {
  const ids = new Set(stateLayerSelection(state).ids);
  const plan = combineShapesPlan(state.layers, ids, state.activeLayerIdx, op);
  if (!plan) return;
  pushUndo(op === null ? 'Merge Shape Components' : COMBINE_SHAPE_OPS.find((r) => r[1] === op)[2]);
  const { keep } = plan;
  keep.shape = normalizeShape({ ...keep.shape, path: plan.path, live: null });
  renderShapeLayer(keep);
  if (plan.remove.length) {
    const gone = plan.remove.map((l) => state.layers.indexOf(l));
    for (const l of removeLayersAt(state.layers, gone)) removeLayerFromDOM(l);
    setLayerSelection({ ids: [keep.id], active: keep.id, anchor: keep.id });
  }
  state.activeLayerIdx = state.layers.indexOf(keep);
  refreshLayerPanelUI();
  scheduleComposite();
  scheduleAutosave(state, canvasW(), canvasH());
}

/** Layer › Vector Mask › Reveal All / Hide All / Current Path (vector_mask_add). */
function addVectorMask(kind) {
  const layer = activeLayer();
  if (!layer || layer.vectorMask || isShapeLayer(layer)) return;
  if (refuseGroupTarget('add a vector mask', null)) return;
  const path = kind === 'path' ? targetPath(state.paths) : null;
  if (kind === 'path' && !path?.subpaths?.some((sp) => sp.anchors.length)) return;
  pushUndo('Add Vector Mask');
  if (unlockBackground(layer)) syncLayerDOM(layer);
  layer.vectorMask = newVectorMask(kind, path);
  afterVectorMaskEdit(layer);
}

function deleteVectorMask() {
  const layer = activeLayer();
  if (!layer?.vectorMask) return;
  pushUndo('Delete Vector Mask');
  layer.vectorMask = null;
  afterVectorMaskEdit(layer);
}

/** Layer › Vector Mask › Enable Vector Mask: a disabled one is kept but hides nothing. */
function toggleVectorMask() {
  const layer = activeLayer();
  if (!layer?.vectorMask) return;
  const on = layer.vectorMask.enabled === false;
  pushUndo(on ? 'Enable Vector Mask' : 'Disable Vector Mask');
  layer.vectorMask = { ...layer.vectorMask, enabled: on };
  afterVectorMaskEdit(layer);
}

/** Layer › Rasterize › Vector Mask: multiplied into the pixel mask, then dropped. */
function rasterizeVectorMask() {
  const layer = activeLayer();
  if (!layer?.vectorMask) return;
  pushUndo('Rasterize Vector Mask');
  layer.mask = bakeVectorMask(layer, canvasW(), canvasH());
  layer.maskEnabled = layer.maskEnabled !== false;
  layer.vectorMask = null;
  afterVectorMaskEdit(layer);
}

/**
 * Layer › Rasterize › Layer (the selected layers) and All Layers: live type, shape, fill, and
 * Smart Object layers become pixels as they look, and vector masks bake in; one history step.
 */
function rasterizeLayers(all) {
  pointer.commitTextInput();
  const ids = new Set(stateLayerSelection(state).ids);
  const targets = rasterizeTargets(state.layers, ids, all);
  if (!targets.length) return;
  for (const layer of targets) {
    renderTypeLayer(layer);
    renderShapeLayer(layer);
  }
  pushUndo(all ? 'Rasterize All Layers' : 'Rasterize Layer');
  for (const layer of targets) {
    rasterizeRecord(layer, canvasW(), canvasH());
    syncLayerMask(layer);
  }
  state.editMask = false;
  refreshLayerPanelUI();
  scheduleComposite();
  scheduleAutosave(state, canvasW(), canvasH());
}

function afterVectorMaskEdit(layer) {
  syncLayerMask(layer);
  refreshLayerPanelUI();
  scheduleComposite();
  scheduleAutosave(state, canvasW(), canvasH());
}

/** Edit › Define Custom Shape…: the target path (or the shape layer's) joins the Shapes. */
function defineCustomShapeFromPath() {
  const target = targetPath(state.paths);
  const path = target?.subpaths?.some((sp) => sp.anchors.length)
    ? target
    : isShapeLayer(activeLayer())
    ? activeLayer().shape.path
    : null;
  if (!path) return;
  customShapeDialog.open(`Shape ${state.customShapes.length + 1}`, (name) => {
    const out = defineShapePreset(state.customShapes, path, name);
    if (!out) return;
    state.customShapes = out.list;
    syncCustomShapeOptions(state.customShapes);
    (state.toolOptions.customShape ??= {}).shape = out.name;
    renderShapes();
    if (state.tool === 'customShape') refreshToolOptions();
  });
}

/** The Shapes panel: picking a shape makes it the Custom Shape tool's and selects the tool. */
function renderShapes() {
  const container = document.getElementById('panel-shapes');
  if (!container) return;
  renderShapesPanel(container, state.customShapes, state.toolOptions.customShape?.shape, {
    onPick: (name) => {
      (state.toolOptions.customShape ??= {}).shape = name;
      if (state.tool === 'customShape') refreshToolOptions();
      else setActiveTool('customShape');
      renderShapes();
    }
  });
}

function commitTextObjectEdit(objectId, text, style) {
  const obj = findObject(state.objects, objectId);
  if (!obj || obj.type !== 'text') return;
  pushUndo('Edit Text');
  if (!text) {
    state.objects = state.objects.filter((o) => o.id !== objectId);
    setObjectSelection([]);
  } else {
    updateTextObject(obj, text, style);
    obj._hiddenWhileEdit = false;
    setObjectSelection([obj.id]);
  }
  redrawObjects();
  setActiveTool('select');
}
function deleteSelection(ctx) {
  doDeleteSelection(state, ov, ctx, pushUndo);
}
function applySelectionWithMask(newMask, W, H, mode) {
  doApplySelectionWithMask(state, newMask, W, H, mode);
}
function selectAll() {
  doSelectAll(state, ov, canvasW(), canvasH());
}
function invertSelection() {
  doInvertSelection(state, ov, canvasW(), canvasH());
}
function modifySelection(op) {
  const input = /** @type {HTMLInputElement | null} */ (document.getElementById('select-radius'));
  doModifySelection(state, ov, activeCtx(), canvasW(), canvasH(), op, input?.value);
}
function deselect() {
  doDeselectSelection(state, ov, activeCtx(), canvasW(), canvasH());
}
function reselect() {
  doReselectSelection(state, ov, activeCtx(), canvasW(), canvasH());
}
// Grow / Similar use the Magic Wand's Tolerance (PhotoCraft select.grow tolerance, default 32).
// Select › Color Range… OK: the coverage becomes the selection, limited to the current one
// (selection_cmds.rs scope_color_range). A floating paste is stamped first.
function colorRangeSelect(soft, W, H) {
  if (W !== canvasW() || H !== canvasH()) return;
  if (state.sel.data && state.sel.baseData) stampFloatingSelection(state, activeCtx());
  const mode = state.sel.mode === 'active' ? 'intersect' : null;
  applySelectionWithMask(softToSelection(soft), W, H, mode);
  ov.clearRect(0, 0, overlayCanvas.width, overlayCanvas.height);
  if (state.sel.mode === 'none') showStatusMessage('Color Range: no pixels were selected');
  else drawSelectionOverlay(state, ov);
}
function growSelection(contiguous) {
  const tolerance = state.toolOptions.magicWand?.tolerance ?? 32;
  doGrowSelection(state, ov, activeCtx(), canvasW(), canvasH(), tolerance, contiguous);
}

// ── Layer panel ───────────────────────────────────────────────────────────────

function refreshLayerPanelUI() {
  const container = document.getElementById('layer-list-container');
  pullMaskEdit();
  // A canvas-size change leaves fill layers at their old size: draw them again.
  refreshFillLayers(state.layers);
  refreshSmartLayers(state.layers);
  refreshTypeLayers(state.layers);
  refreshShapeLayers(state.layers);
  setLayerSelection(stateLayerSelection(state));
  refreshMenus();
  extrasView.renderEdges();
  // The Move tool's align buttons enable with the layer selection; a Shape tool's bar shows
  // the shape layer it edits.
  if (state.tool === 'select') refreshToolOptions();
  else if (isShapeTool(state.tool) && activeLayer()?.id !== shapeOptionsLayer) refreshToolOptions();
  syncCompositeView();
  propertiesPanel.render();
  typePanels.render();
  if (!container) return;
  renderLayerPanel(state.layers, state.activeLayerIdx, container, {
    selectedIds: state.selectedLayers,
    maskTarget: editingMask(),
    layerFilter: state.layerFilter,
    onFilterChange: (next) => {
      state.layerFilter = next;
      refreshLayerPanelUI();
    },
    onEditAdjustment: editAdjustmentLayer,
    onEditFill: editFillLayer,
    onNewFill: newFillLayer,
    onTargetLayer: (i) => setEditTarget(i, false),
    onTargetMask: (i) => setEditTarget(i, true),
    onToggleMask: toggleLayerMask,
    onAdd: addLayer,
    onDuplicate: duplicateLayer,
    onMergeDown: mergeDown,
    onDelete: deleteLayer,
    onActivate: clickLayerRow,
    onToggleVisible: toggleLayerVisible,
    onOpacityChange: setLayerOpacity,
    onFillChange: setLayerFillOpacity,
    onBlendModeChange: setLayerBlendMode,
    onMove: moveLayerTo,
    onAddMask: addMaskFromPanel,
    onNewAdjustment: newAdjustmentLayer,
    onRename: () => refreshLayerPanelUI(),
    onFlatten: flattenLayers,
    onNewGroup: newGroupFromPanel,
    onToggleCollapsed: toggleGroupCollapsed,
    onToggleClip: toggleClipAt,
    onLockChange: setLayerLock,
    onLink: linkSelectedLayers,
    onLayerStyle: () => openLayerStyle(null)
  });
}

// A new empty layer above the active one (the Layers footer button, and Layer › New › Layer… with
// the dialog's name, mode, and opacity).
function addLayer({ name, blendMode = 'source-over', opacity = 1 } = {}) {
  pushUndo('New Layer');
  const layer = createLayer(name || nextLayerName(state.layers), canvasW(), canvasH());
  layer.blendMode = blendMode;
  layer.opacity = opacity;
  insertLayerAboveActive(layer);
  refreshLayerPanelUI();
  scheduleComposite();
}

// ── Layer › New (paint/layer-new.js) ─────────────────────────────────────────

/**
 * Layer via Copy / Cut (PhotoCraft edit_cmds.rs layer_via): the selection's pixels (or, for Cut,
 * the whole layer without one) lift to a new layer above; Cut clears them, to the background
 * colour on the Background. Copy without a selection duplicates the layer. The selection drops.
 */
function layerVia(cut) {
  const layer = activeLayer();
  // Layer via Copy leaves the layer as it is, so only Cut is refused on a locked one.
  if (!layer || refuseGroupTarget('complete the command', cut ? 'pixels' : null)) return;
  const hasSel = state.sel.mode === 'active';
  if (!hasSel && !cut) {
    duplicateLayer(state.activeLayerIdx, 'Layer Via Copy');
    return;
  }
  if (isAdjustmentLayer(layer)) return;
  const W = canvasW(),
    H = canvasH();
  if (hasSel && state.sel.data && state.sel.baseData) stampFloatingSelection(state, layer.ctx);
  const mask = hasSel ? selectionToFullMask(state.sel, W, H) : null;
  const fill = isBackgroundLayer(layer) ? [...hexToRgb(state.bgColor), 255] : null;
  const src = layer.ctx.getImageData(0, 0, W, H).data;
  const { lifted, rest } = liftLayerPixels(src, mask, cut, fill);
  if (liftIsEmpty(lifted)) {
    showStatusMessage('Could not complete the command: the selected area is empty');
    return;
  }
  pushUndo(cut ? 'Layer Via Cut' : 'Layer Via Copy');
  if (rest) layer.ctx.putImageData(new ImageData(rest, W, H), 0, 0);
  const created = createLayer(nextLayerName(state.layers), W, H);
  created.ctx.putImageData(new ImageData(lifted, W, H), 0, 0);
  insertLayerAboveActive(created);
  if (hasSel) commitSelection();
  refreshLayerPanelUI();
  scheduleComposite();
}

/** Layer › New › Layer from Background…: the Background becomes a normal layer ("Layer 0"). */
function layerFromBackground({ name, blendMode = 'source-over', opacity = 1 } = {}) {
  const layer = state.layers[0];
  if (!isBackgroundLayer(layer)) return;
  pushUndo('Layer From Background');
  unlockBackground(layer);
  layer.name = name || LAYER_ZERO_NAME;
  layer.blendMode = blendMode;
  layer.opacity = opacity;
  syncLayerDOM(layer);
  state.activeLayerIdx = 0;
  state.editMask = false;
  refreshLayerPanelUI();
  scheduleComposite();
}

/**
 * Layer › New › Background from Layer (background_cmds.rs): the active layer as it looks (mask,
 * opacity, blend mode) over the background colour becomes the opaque Background at the bottom.
 */
function backgroundFromLayer() {
  const layer = activeLayer();
  if (!layer || hasBackground(state.layers) || isAdjustmentLayer(layer) || isGroupLayer(layer))
    return;
  const W = canvasW(),
    H = canvasH();
  pushUndo('Background From Layer');
  const mask = compositeMask(layer, W);
  const src = layer.ctx.getImageData(0, 0, W, H).data;
  const opts = { opacity: layer.opacity, blendMode: layer.blendMode || 'source-over', mask };
  const out = backgroundPixels(src, hexToRgb(state.bgColor), opts);
  layer.ctx.putImageData(new ImageData(out, W, H), 0, 0);
  layer.mask = null;
  syncLayerMask(layer);
  layer.opacity = 1;
  layer.blendMode = 'source-over';
  layer.name = BACKGROUND_NAME;
  layer.background = true;
  syncLayerDOM(layer);
  // The Background sits at the top level, below everything.
  layer.parentId = null;
  state.layers = normalizeTree(stackWithBackground(state.layers, state.activeLayerIdx));
  for (const l of state.layers) stackEl.insertBefore(l.canvas, layerInsertRef());
  state.activeLayerIdx = 0;
  state.editMask = false;
  refreshLayerPanelUI();
  scheduleComposite();
}

/**
 * Before an edit the Background cannot take (erasing to transparency, a faded or blended look),
 * it becomes Layer 0 (extra_cmds.rs background_to_layer). The caller has pushed its undo row.
 */
function unlockActiveBackground() {
  if (!state.editMask && unlockBackground(activeLayer())) refreshLayerPanelUI();
}

function duplicateLayer(idx, label = 'Duplicate layer') {
  const src = state.layers[idx];
  if (!src) return;
  const group = isGroupLayer(src);
  pushUndo(group && label === 'Duplicate layer' ? 'Duplicate Group' : label);
  // A group copies with everything in it; the copies keep their nesting.
  const ids = new Map();
  const copies = blockIndices(state.layers, idx).map((i) => {
    const from = state.layers[i];
    const make = isGroupLayer(from) ? createGroupLayer : createLayer;
    const copy = make(i === idx ? `${from.name} copy` : from.name, canvasW(), canvasH());
    copyLayerContents(from, copy);
    ids.set(from.id, copy.id);
    copy.parentId = i === idx ? src.parentId ?? null : ids.get(from.parentId) ?? null;
    return copy;
  });
  state.layers.splice(idx + 1, 0, ...copies);
  // Directly above the source in the stack
  let after = src.canvas;
  for (const copy of copies) {
    stackEl.insertBefore(copy.canvas, after.nextSibling);
    after = copy.canvas;
    syncLayerDOM(copy);
    snapshotHistorySource(copy);
  }
  state.activeLayerIdx = idx + copies.length;
  refreshLayerPanelUI();
  scheduleComposite();
}

function mergeDown(idx) {
  if (!canMergeDown(state.layers, idx)) return;
  const src = state.layers[idx];
  const dst = state.layers[idx - 1];
  pushUndo('Merge down');
  state.activeLayerIdx = idx - 1;
  compositeLayerOnto(src, dst);
  removeLayerFromDOM(src);
  state.layers.splice(idx, 1);
  refreshLayerPanelUI();
}

// ── Smart objects (paint/smart-objects.js) ───────────────────────────────────

// A layer's bytes with its enabled mask applied (the contents keep the masked look).
function maskedLayerBytes(layer, W, H) {
  const data = new Uint8ClampedArray(layer.ctx.getImageData(0, 0, W, H).data);
  const mask = compositeMask(layer, W);
  if (mask) for (let p = 0; p < W * H; p++) data[p * 4 + 3] = (data[p * 4 + 3] * mask[p]) / 255;
  return data;
}

/**
 * Layer › Smart Objects › Convert to Smart Object (smart_cmds.rs convert): the selected layers
 * become one smart object in the topmost one's place, named after it. A single layer keeps its
 * visibility, opacity, blend mode, and clipping on the smart layer (layer_to_smart); its mask
 * and style go inside.
 */
function convertToSmartObject() {
  const ids = topLevelIds(state.layers, stateLayerSelection(state).ids);
  const picked = state.layers.filter((l) => ids.includes(l.id));
  if (!picked.length) return;
  if (picked.some((l) => isGroupLayer(l) || isAdjustmentLayer(l))) {
    showStatusMessage('Could not convert to a smart object: groups and adjustment layers stay');
    return;
  }
  const W = canvasW(),
    H = canvasH();
  const single = picked.length === 1;
  const records = picked.map((l) => ({
    name: isBackgroundLayer(l) ? LAYER_ZERO_NAME : l.name,
    opacity: single ? 1 : l.opacity,
    visible: single || l.visible !== false,
    blendMode: single ? 'source-over' : l.blendMode,
    clipped: !single && l.clipped === true,
    styles: l.styles,
    data: maskedLayerBytes(l, W, H)
  }));
  const smart = smartFromLayers(records, W, H);
  if (!smart) {
    showStatusMessage('Could not convert to a smart object: the layer is empty');
    return;
  }
  pushUndo('Convert to Smart Object');
  const top = picked[picked.length - 1];
  const layer = createSmartLayer(records[records.length - 1].name, smart, W, H);
  if (single) {
    layer.visible = top.visible !== false;
    layer.opacity = top.opacity;
    layer.blendMode = top.blendMode === PASS_THROUGH ? 'source-over' : top.blendMode;
    layer.clipped = top.clipped === true;
    if (!isBackgroundLayer(top)) layer.locks = layerLocks(top);
  }
  layer.parentId = top.parentId ?? null;
  state.layers.splice(state.layers.indexOf(top) + 1, 0, layer);
  insertLayerBefore(layer, stackEl, top.canvas.nextSibling);
  snapshotHistorySource(layer);
  const gone = picked.map((l) => state.layers.indexOf(l));
  for (const l of removeLayersAt(state.layers, gone)) removeLayerFromDOM(l);
  state.activeLayerIdx = state.layers.indexOf(layer);
  state.editMask = false;
  setLayerSelection({ ids: [layer.id], active: layer.id, anchor: layer.id });
  refreshLayerPanelUI();
  scheduleComposite();
}

/**
 * Layer › Smart Objects › Convert to Layers (smart_cmds/unpack.rs): the contents come back as
 * layers at the placement. One Normal layer takes the smart object's place and settings; several
 * land in a group named after it that carries its opacity, blend mode, and mask.
 */
function convertSmartToLayers() {
  const idx = state.activeLayerIdx;
  const so = state.layers[idx];
  if (!isSmartLayer(so)) return;
  const W = canvasW(),
    H = canvasH();
  const records = unpackSmart(so.smart, W, H);
  pushUndo('Convert to Layers');
  const make = (r) => {
    const l = createLayer(r.name, W, H);
    l.ctx.putImageData(new ImageData(new Uint8ClampedArray(r.data), W, H), 0, 0);
    l.opacity = r.opacity;
    l.visible = r.visible;
    l.blendMode = r.blendMode;
    l.clipped = r.clipped;
    l.styles = cloneStyles(r.styles);
    return l;
  };
  const carry = (l) => {
    l.name = so.name;
    l.visible = so.visible !== false;
    l.blendMode = so.blendMode || 'source-over';
    l.clipped = so.clipped === true;
    l.parentId = so.parentId ?? null;
    l.mask = so.mask ? so.mask.slice() : null;
    l.maskEnabled = so.maskEnabled !== false;
    syncLayerMask(l);
  };
  const folds =
    records.length === 1 &&
    records[0].blendMode === 'source-over' &&
    !(records[0].styles && so.styles);
  let made;
  if (folds) {
    const l = make(records[0]);
    carry(l);
    l.opacity = records[0].opacity * so.opacity;
    l.styles = cloneStyles(records[0].styles ?? so.styles);
    made = [l];
  } else {
    const group = createGroupLayer(so.name, W, H);
    carry(group);
    group.opacity = so.opacity;
    made = records.map((r) => Object.assign(make(r), { parentId: group.id }));
    made.push(group);
  }
  state.layers.splice(idx, 1, ...made);
  for (const l of made) insertLayerBefore(l, stackEl, so.canvas);
  removeLayerFromDOM(so);
  for (const l of made) snapshotHistorySource(l);
  const top = made[made.length - 1];
  state.activeLayerIdx = state.layers.indexOf(top);
  state.editMask = false;
  setLayerSelection({ ids: [top.id], active: top.id, anchor: top.id });
  refreshLayerPanelUI();
  scheduleComposite();
}

/** Layer › Smart Objects › Rasterize: the smart object becomes a pixel layer as it looks now. */
function rasterizeSmartObject() {
  const layer = activeLayer();
  if (!isSmartLayer(layer)) return;
  pushUndo('Rasterize Smart Object');
  layer.kind = 'pixel';
  delete layer.smart;
  delete layer.smartSize;
  refreshLayerPanelUI();
  scheduleComposite();
}

function deleteLayer(idx) {
  const layer = state.layers[idx];
  // A group goes with everything in it; the document keeps at least one layer.
  const block = layer ? blockIndices(state.layers, idx) : [];
  if (!block.length || block.length >= state.layers.length) return;
  pushUndo(isGroupLayer(layer) ? 'Delete Group' : 'Delete Layer');
  const active = activeLayer();
  for (const l of removeLayersAt(state.layers, block)) removeLayerFromDOM(l);
  const kept = state.layers.indexOf(active);
  state.activeLayerIdx =
    kept >= 0 ? kept : Math.max(0, Math.min(block[0], state.layers.length - 1));
  state.editMask = false;
  refreshLayerPanelUI();
  scheduleComposite();
}

// ── Layer groups (paint/layer-groups.js) ─────────────────────────────────────

/** Layer › New › Group… and the Layers footer: an empty group above the active layer. */
function newGroup({ name, blendMode = PASS_THROUGH, opacity = 1 } = {}) {
  pushUndo('New Group');
  const group = createGroupLayer(
    name || nextLayerName(state.layers, GROUP_BASE_NAME),
    canvasW(),
    canvasH()
  );
  group.blendMode = blendMode;
  group.opacity = opacity;
  state.layers = insertGroupAbove(state.layers, state.activeLayerIdx, group);
  insertLayerBefore(group, stackEl, layerInsertRef());
  state.activeLayerIdx = state.layers.indexOf(group);
  state.editMask = false;
  refreshLayerPanelUI();
  scheduleComposite();
}

/**
 * Layer › Group Layers (Cmd+G) and New › Group from Layers… (with the dialog's settings): the
 * selected layers go into a new, collapsed group in the topmost one's place, which becomes the
 * active and only selected layer. A grouped Background turns into Layer 0.
 */
function groupLayers({ name, blendMode = PASS_THROUGH, opacity = 1 } = {}) {
  const ids = stateLayerSelection(state).ids;
  if (!ids.length) {
    showStatusMessage('Could not group the layers: no layer is selected');
    return;
  }
  pushUndo('Group Layers');
  for (const l of state.layers) if (ids.includes(l.id)) unlockBackground(l);
  const group = createGroupLayer(
    name || nextLayerName(state.layers, GROUP_BASE_NAME),
    canvasW(),
    canvasH()
  );
  group.blendMode = blendMode;
  group.opacity = opacity;
  state.layers = groupLayersPlan(state.layers, ids, group).layers;
  insertLayerBefore(group, stackEl, layerInsertRef());
  state.activeLayerIdx = state.layers.indexOf(group);
  state.editMask = false;
  setLayerSelection({ ids: [group.id], active: group.id, anchor: group.id });
  refreshLayerPanelUI();
  scheduleComposite();
}

/** Layer › Ungroup Layers (Shift+Cmd+G): the active group's layers take its place. */
function ungroupLayers() {
  const idx = state.activeLayerIdx;
  const group = state.layers[idx];
  if (!isGroupLayer(group)) {
    showStatusMessage('Could not ungroup: the active layer is not a group');
    return;
  }
  pushUndo('Ungroup Layers');
  const { layers, activeId } = ungroupPlan(state.layers, idx);
  removeLayerFromDOM(group);
  state.layers = layers;
  const top = layers.findIndex((l) => l.id === activeId);
  state.activeLayerIdx = top >= 0 ? top : layers.length - 1;
  state.editMask = false;
  refreshLayerPanelUI();
  scheduleComposite();
}

/** A group row's disclosure triangle: a view change, no history step (layer.setExpanded). */
function toggleGroupCollapsed(idx) {
  const group = state.layers[idx];
  if (!isGroupLayer(group)) return;
  group.collapsed = !group.collapsed;
  refreshLayerPanelUI();
}

/** The footer's group button: Shift-click or several selected layers group them (panels.rs). */
function newGroupFromPanel(shift) {
  if (shift || stateLayerSelection(state).ids.length > 1) groupLayers();
  else newGroup();
}

/**
 * Status note and true when the active layer is a group a pixel command cannot edit, or its
 * `lock` ('pixels', 'position', or null for neither) is on. A mask edit ignores the locks.
 */
function refuseGroupTarget(what = 'complete the command', lock = 'pixels') {
  const why = groupTargetRefusal(what, lock);
  if (why) showStatusMessage(why);
  return !!why;
}

// refuseGroupTarget's message, or null when the active layer can take the command.
function groupTargetRefusal(what = 'complete the command', lock = 'pixels') {
  const layer = activeLayer();
  if (isGroupLayer(layer)) return `Could not ${what}: the target layer is a group`;
  // A fill layer's pixels come from its fill; only its mask can be edited.
  if (isFillLayer(layer) && (lock === 'position' || !editingMask())) {
    return `Could not ${what}: the target layer is a fill layer`;
  }
  // A smart object's pixels render from its contents; transforms edit its placement instead.
  if (isSmartLayer(layer) && lock === 'pixels' && !editingMask()) {
    return `Could not ${what}: the target layer is a smart object`;
  }
  const locked = lock === 'position' ? positionLocked : lock === 'pixels' ? pixelsLocked : null;
  if (!layer || !locked || editingMask() || !locked(state.layers, layer)) return null;
  return `Could not ${what}: the layer "${layer.name}" is locked`;
}

// ── Clipping masks and locks (paint/layer-locks.js) ──────────────────────────

function setClipped(ids, clip) {
  pushUndo(clip ? 'Create Clipping Mask' : 'Release Clipping Mask');
  applyClipPlan(state.layers, ids, clip);
  refreshLayerPanelUI();
  scheduleComposite();
}

/**
 * Layer › Create Clipping Mask (Cmd+Alt+G): the selected layers but the lowest clip to the layer
 * below; it reads and runs as Release when every one of them already clips (clip_key_releases).
 */
function toggleClippingMask() {
  const ids = stateLayerSelection(state).ids;
  const release = clipKeyReleases(state.layers, ids);
  const targets = clipPlan(state.layers, ids, !release);
  if (!targets.length) {
    showStatusMessage('Could not create a clipping mask: there is no layer below to clip to');
    return;
  }
  setClipped(targets, !release);
}

/** Alt-click under a Layers row: that layer clips to the one below it, or is released. */
function toggleClipAt(idx) {
  const layer = state.layers[idx];
  const targets = layer ? clipPlan(state.layers, [layer.id], !layer.clipped) : [];
  if (targets.length) setClipped(targets, !layer.clipped);
}

// ── Layer styles (paint/layer-style.js) ──────────────────────────────────────

/**
 * Layer › Layer Style › <effect>… and the Layers footer's fx: the Layer Style dialog on the
 * active layer, previewing live. OK records one history step; Cancel puts the old style back.
 */
function openLayerStyle(kind) {
  const layer = activeLayer();
  if (!canHaveStyle(layer)) {
    showStatusMessage('Could not add a layer style: the target layer is not a pixel layer');
    return;
  }
  commitSelection();
  const before = cloneStyles(layer.styles);
  const [opacity, blendMode] = [layer.opacity, layer.blendMode];
  // Blending Options' Opacity and Blend Mode are the layer's own.
  const apply = (styles, general) => {
    layer.styles = styles;
    layer.opacity = general ? general.opacity / 100 : opacity;
    layer.blendMode = general ? general.blendMode : blendMode;
    syncLayerDOM(layer);
  };
  layerStyleDialog.open(before, kind, {
    general: { blendMode: blendMode || 'source-over', opacity: Math.round(opacity * 100) },
    onPreview: (styles, general) => {
      apply(styles, general);
      syncCompositeView();
    },
    onOk: (styles, general) => {
      apply(before, null);
      pushUndo('Layer Style');
      // The Background has no opacity or blend mode: changing them makes it a layer.
      if (general.opacity < 100 || general.blendMode !== 'source-over') unlockBackground(layer);
      apply(styles, general);
      refreshLayerPanelUI();
    },
    onCancel: () => {
      apply(before, null);
      refreshLayerPanelUI();
    }
  });
}

/** Layer › Layer Style › Copy Layer Style: the active layer's effects to the style clipboard. */
function copyLayerStyle() {
  const layer = activeLayer();
  if (!hasLayerStyle(layer)) return;
  state.styleClipboard = cloneStyles(layer.styles);
  refreshMenus();
}

/** Paste Layer Style (the clipboard) or Clear Layer Style (null) on the selected layers. */
function applyLayerStyleTo(styles, label) {
  const ids = stateLayerSelection(state).ids.filter((id) =>
    canHaveStyle(state.layers.find((l) => l.id === id))
  );
  if (!ids.length) return;
  pushUndo(label);
  setLayerStyles(state.layers, ids, styles);
  refreshLayerPanelUI();
}

/** Window › Styles: a click applies the preset to the selected layers (Shift adds to them). */
function applyStyleToSelection(preset, add) {
  const ids = stateLayerSelection(state).ids.filter((id) =>
    canHaveStyle(state.layers.find((l) => l.id === id))
  );
  if (!ids.length) return;
  pushUndo('Apply Style');
  applyStylePreset(state.layers, ids, preset, add);
  refreshLayerPanelUI();
}

/** Hide All Effects, or Show All Effects once every style is hidden (set_all_effects). */
function toggleAllEffects() {
  const styled = state.layers.filter(hasLayerStyle);
  if (!styled.length) return;
  const show = styled.every((l) => l.styles.enabled === false);
  pushUndo('Hide All Effects');
  setAllEffects(state.layers, show);
  refreshLayerPanelUI();
}

/** Layer › Lock Layers… OK and the Lock: buttons: set locks on ids (the selected layers). */
function lockLayers(given, ids = stateLayerSelection(state).ids) {
  const plan = lockLayersPlan(state.layers, ids, given);
  if (!plan.length) return;
  pushUndo('Lock Layers');
  applyLockPlan(state.layers, plan);
  refreshLayerPanelUI();
}

/** A Lock: button: the selected layers when the row is one of them, else that row's layer. */
function setLayerLock(idx, key, on) {
  const layer = state.layers[idx];
  if (!layer) return;
  const selected = stateLayerSelection(state).ids;
  lockLayers({ [key]: on }, selected.includes(layer.id) ? selected : [layer.id]);
}

/** `/`: Lock Transparent Pixels on or off for the selected layers (toggle_lock_transparency). */
function toggleLockTransparency() {
  const r = toggleTransparencyPlan(state.layers, stateLayerSelection(state).ids, isBackgroundLayer);
  if (!r) {
    showStatusMessage(
      "Could not lock transparent pixels: the Background layer can't take that lock"
    );
    return;
  }
  pushUndo(r.lock ? 'Lock Transparent Pixels' : 'Unlock Transparent Pixels');
  applyLockPlan(state.layers, r.plan);
  refreshLayerPanelUI();
}

// The Layers footer link button: link the selected layers, or unlink the active layer's set.
function linkSelectedLayers() {
  const plan = linkPlan(state.layers, stateLayerSelection(state).ids);
  if (!plan) {
    showStatusMessage('Could not link: select two or more layers');
    return;
  }
  pushUndo(plan.link ? 'Link Layers' : 'Unlink Layers');
  applyLinkPlan(state.layers, plan);
  refreshLayerPanelUI();
}

const toImageData = (data, w, h) => new ImageData(data, w, h);

// The linked layers a Move or Free Transform carries along; null (and a status message) when
// one of them cannot move.
function linkedMovers(layer, verb) {
  if (editingMask()) return [];
  const all = linkedPartners(state.layers, layer);
  const stuck = all.find((l) => isBackgroundLayer(l) || positionLocked(state.layers, l));
  if (stuck) {
    showStatusMessage(`Could not ${verb}: the linked layer "${stuck.name}" is locked`);
    return null;
  }
  return all;
}

function setLayerSelection(sel) {
  state.selectedLayers = new Set(sel.ids);
  state.layerSelectionFor = sel.active;
  state.layerAnchor = sel.anchor;
}

// A Layers row click: Ctrl/Cmd toggles the row in the selection, Shift selects the range.
function clickLayerRow(idx, e) {
  const mode = e?.shiftKey ? 'range' : e?.ctrlKey || e?.metaKey ? 'toggle' : 'replace';
  const sel = clickLayerSelection(
    stateLayerSelection(state),
    state.layers[idx].id,
    mode,
    state.layers.map((l) => l.id)
  );
  const active = state.layers.findIndex((l) => l.id === sel.active);
  if (active !== state.activeLayerIdx) state.editMask = false;
  if (active >= 0) state.activeLayerIdx = active;
  setLayerSelection(sel);
  refreshLayerPanelUI();
}

/** Select › All Layers: every layer but the Background. */
function selectAllLayers() {
  const ids = allLayerIds(state.layers);
  if (!ids.length) return;
  if (!ids.includes(activeLayer()?.id)) {
    state.activeLayerIdx = state.layers.findIndex((l) => l.id === ids[ids.length - 1]);
    state.editMask = false;
  }
  setLayerSelection({ ids, active: activeLayer().id, anchor: null });
  refreshLayerPanelUI();
}

/** Select › Deselect Layers: no row stays selected; tools still edit the last active layer. */
function deselectLayers() {
  setLayerSelection({ ids: [], active: activeLayer()?.id ?? null, anchor: null });
  refreshLayerPanelUI();
}

/** Composite of `layers` over transparency, for the merge commands. */
function flattenLayersOnly(layers) {
  return flattenToCanvas(layers, null, canvasW(), canvasH(), { transparentBg: true });
}

function runMergePlan(label, plan) {
  if (plan.error) {
    showStatusMessage(`Could not ${label}: ${plan.error}`);
    return;
  }
  pushUndo(label);
  const { merged, removed } = applyMergePlan(state.layers, plan, flattenLayersOnly);
  for (const l of removed) removeLayerFromDOM(l);
  syncLayerMask(merged);
  state.activeLayerIdx = state.layers.indexOf(merged);
  state.editMask = false;
  setLayerSelection({ ids: [merged.id], active: merged.id, anchor: merged.id });
  refreshLayerPanelUI();
  scheduleComposite();
}

/** Layer › Merge Layers (Cmd+E): the selected layers, or Merge Down with one selected. */
function mergeLayers() {
  const ids = stateLayerSelection(state).ids;
  if (ids.length < 2) {
    mergeDown(state.activeLayerIdx);
    return;
  }
  runMergePlan('Merge Layers', mergeLayersPlan(state.layers, ids));
}

/** Layer › Merge Visible (Cmd+Shift+E): hidden layers stay as they are. */
function mergeVisible() {
  runMergePlan('Merge Visible', mergeVisiblePlan(state.layers));
}

/** Layer › Delete › Hidden Layers. */
function deleteHiddenLayers() {
  const plan = hiddenLayersPlan(state.layers);
  if (plan.error) {
    showStatusMessage(`Could not delete the hidden layers: ${plan.error}`);
    return;
  }
  if (!plan.remove.length) return;
  pushUndo('Delete Hidden Layers');
  const active = activeLayer();
  for (const l of removeLayersAt(state.layers, plan.remove)) removeLayerFromDOM(l);
  const kept = state.layers.indexOf(active);
  // The top layer becomes active when the active one went (delete_where).
  state.activeLayerIdx = kept >= 0 ? kept : state.layers.length - 1;
  if (kept < 0) state.editMask = false;
  refreshLayerPanelUI();
  scheduleComposite();
}

function setActiveLayer(idx) {
  if (idx !== state.activeLayerIdx) state.editMask = false;
  state.activeLayerIdx = idx;
  refreshLayerPanelUI();
}

function toggleLayerVisible(idx) {
  state.layers[idx].visible = !state.layers[idx].visible;
  syncLayerDOM(state.layers[idx]);
  refreshLayerPanelUI();
}

function setLayerOpacity(idx, opacity) {
  // The Background has no opacity: fading it turns it into Layer 0 (PhotoCraft layer.set).
  if (opacity < 1) unlockBackground(state.layers[idx]);
  state.layers[idx].opacity = opacity;
  syncLayerDOM(state.layers[idx]);
  refreshLayerPanelUI();
}

// The Layers panel Fill: field writes the same styles.fillOpacity as Blending Options.
function setLayerFillOpacity(idx, fill) {
  const layer = state.layers[idx];
  if (!canHaveStyle(layer)) return;
  pushUndo('Fill Opacity');
  setFillOpacity(layer, fill);
  syncLayerDOM(layer);
  syncCompositeView();
  refreshLayerPanelUI();
}

function setLayerBlendMode(idx, blendMode) {
  if (blendMode !== 'source-over') unlockBackground(state.layers[idx]);
  state.layers[idx].blendMode = blendMode;
  syncLayerDOM(state.layers[idx]);
  refreshLayerPanelUI();
}

// A Layers row dropped on another row takes that row's place in the stack.
// Onto a group's row it goes into the group (layer-groups.js moveLayerPlan).
function moveLayerTo(from, to) {
  // The Background stays at the bottom (keep_background_at_bottom).
  if (!canMoveLayer(state.layers, from, to)) return;
  const plan = moveLayerPlan(state.layers, from, to, isBackgroundLayer);
  if (!plan) return;
  pushUndo(to > from ? 'Move Layer Up' : 'Move Layer Down');
  const active = activeLayer();
  state.layers = applyMovePlan(plan);
  for (const l of state.layers) stackEl.insertBefore(l.canvas, layerInsertRef());
  state.activeLayerIdx = state.layers.indexOf(active);
  refreshLayerPanelUI();
  scheduleComposite();
}

// ── Arrange, Align, Distribute (paint/layer-arrange.js) ─────────────────────

function remountOrder(layers) {
  const active = activeLayer();
  state.layers = layers;
  for (const l of state.layers) stackEl.insertBefore(l.canvas, layerInsertRef());
  state.activeLayerIdx = state.layers.indexOf(active);
  refreshLayerPanelUI();
  scheduleComposite();
}

/** Layer › Arrange: Bring Forward (1), Send Backward (-1), to Front / Back (±Infinity). */
function arrangeLayer(delta) {
  const plan = arrangePlan(state.layers, state.activeLayerIdx, delta, isBackgroundLayer);
  if (!plan) {
    showStatusMessage("Could not arrange: the layer can't move further");
    return;
  }
  pushUndo('Arrange');
  remountOrder(applyArrangePlan(plan));
}

/** Layer › Arrange › Reverse: the selected layers trade places. */
function reverseLayers() {
  const plan = reversePlan(state.layers, stateLayerSelection(state).ids, isBackgroundLayer);
  if (plan.error) {
    showStatusMessage(`Could not reverse: ${plan.error}`);
    return;
  }
  pushUndo('Reverse');
  remountOrder(applyArrangePlan(plan));
}

// The pixel layers a move of layers[idx] shifts: the layer, or every pixel layer in a group.
function movedPixelLayers(idx) {
  return blockIndices(state.layers, idx)
    .map((i) => state.layers[i])
    .filter((l) => !isGroupLayer(l) && !isAdjustmentLayer(l));
}

// Selected top-level layers with content, bottom first: [{ id, rect }] (bounded_selection).
function boundedSelection() {
  const W = canvasW(),
    H = canvasH();
  const ids = topLevelIds(state.layers, stateLayerSelection(state).ids);
  return ids
    .map((id) => {
      const idx = state.layers.findIndex((l) => l.id === id);
      const rects = movedPixelLayers(idx).map((l) =>
        alphaBounds(l.ctx.getImageData(0, 0, W, H).data, W, H)
      );
      return { id, rect: unionBounds(rects) };
    })
    .filter((it) => it.rect);
}

// Shift every moved layer's pixels in one whole-stack undo row; refuses locked layers.
function applyLayerMoves(label, moves) {
  const W = canvasW(),
    H = canvasH();
  const work = moves
    .filter((m) => m.dx || m.dy)
    .flatMap((m) => {
      const idx = state.layers.findIndex((l) => l.id === m.id);
      return movedPixelLayers(idx).map((layer) => ({ layer, dx: m.dx, dy: m.dy }));
    });
  const stuck = work.find(
    ({ layer }) => isBackgroundLayer(layer) || positionLocked(state.layers, layer)
  );
  if (stuck) {
    showStatusMessage(
      `Could not ${label.toLowerCase()}: the layer "${stuck.layer.name}" is locked`
    );
    return;
  }
  if (!work.length) return;
  pushUndo(label);
  for (const { layer, dx, dy } of work) {
    const src = layer.ctx.getImageData(0, 0, W, H);
    const out = offsetLayerPixels(src.data, W, H, dx, dy);
    layer.ctx.putImageData(new ImageData(out, W, H), 0, 0);
  }
  refreshLayerPanelUI();
  scheduleComposite();
}

/** Layer › Align: to the selection, the canvas (one layer), or each other. */
function alignLayers(kind) {
  const items = boundedSelection();
  if (!items.length) {
    showStatusMessage('Could not align: the selected layers have no content');
    return;
  }
  const sel =
    state.sel?.mode === 'active' && state.sel.w >= 1 && state.sel.h >= 1 ? state.sel : null;
  const selection = sel ? { x0: sel.x, y0: sel.y, x1: sel.x + sel.w, y1: sel.y + sel.h } : null;
  const canvas = { x0: 0, y0: 0, x1: canvasW(), y1: canvasH() };
  const count = stateLayerSelection(state).ids.length;
  const target = alignTarget(items, selection, canvas, count);
  applyLayerMoves('Align', alignMoves(items, target, kind));
}

/** Layer › Distribute: three or more layers spaced evenly. */
function distributeLayers(kind) {
  const moves = distributeMoves(boundedSelection(), kind);
  if (!moves) {
    showStatusMessage('Could not distribute: it needs three or more layers with content');
    return;
  }
  applyLayerMoves('Distribute', moves);
}

// The Layers footer's mask button: from the selection when there is one, else reveal all;
// Alt inverts (PhotoCraft layer_menu_ui mask_button_command).
function addMaskFromPanel(alt) {
  const sel = state.sel.mode === 'active';
  if (sel) addLayerMask(alt ? 'hideSelection' : 'revealSelection');
  else addLayerMask(alt ? 'hideAll' : 'revealAll');
}

function flattenLayers() {
  pushUndo('Flatten');
  const flat = flattenToCanvas(state.layers, state.bgColor, canvasW(), canvasH());
  collapseStack().ctx.drawImage(flat, 0, 0);
  refreshLayerPanelUI();
}

/** Leaves one cleared pixel layer (the bottom one) for a flattened image; returns it. */
function collapseStack() {
  // Remove all layers except the first
  for (let i = state.layers.length - 1; i >= 1; i--) {
    removeLayerFromDOM(state.layers[i]);
  }
  state.layers.length = 1;
  state.layers[0].ctx.clearRect(0, 0, canvasW(), canvasH());
  // The flat image already carries every mask and adjustment.
  const base = state.layers[0];
  if (isAdjustmentLayer(base) || isGroupLayer(base)) {
    base.kind = 'pixel';
    delete base.adjustmentId;
    delete base.params;
    delete base.collapsed;
  }
  base.parentId = null;
  // Flattening leaves the opaque Background (PhotoCraft flatten_background.rs).
  base.name = BACKGROUND_NAME;
  base.background = true;
  // A hidden, faded or blended bottom layer would show the flat image differently.
  base.visible = true;
  base.opacity = 1;
  base.blendMode = 'source-over';
  syncLayerDOM(base);
  state.layers[0].mask = null;
  syncLayerMask(state.layers[0]);
  state.editMask = false;
  state.activeLayerIdx = 0;
  return base;
}

/** Crop canvas to the active selection bounding box (all layers + objects). */
function cropToSelection() {
  const sel = state.sel;
  if (sel.mode !== 'active' || sel.w < 1 || sel.h < 1) return;
  const sx = Math.max(0, Math.round(sel.x));
  const sy = Math.max(0, Math.round(sel.y));
  const sw = Math.min(Math.round(sel.w), canvasW() - sx);
  const sh = Math.min(Math.round(sel.h), canvasH() - sy);
  if (sw < 1 || sh < 1) return;
  cropCanvas(sx, sy, sw, sh);
}

/** Crop to the pending frame, then show the default frame again while the Crop tool stays. */
function commitCropFrame() {
  cropPendingFrame();
  ensureCropFrame();
}

/**
 * Crop to the Crop tool's pending frame, clamped to the canvas. No-op without a frame or with
 * only the untouched default frame.
 */
function cropPendingFrame() {
  const frame = state.cropFrame;
  if (!frame || state.cropDefault) return;
  const deg = cropNormalizedAngle(state.cropAngle || 0);
  const target = cropToolTarget(state);
  TOOLS.crop.cancel(ov, state);
  if (deg) cropTurnedCanvas(frame, deg);
  else {
    const box = cropClamp(frame, canvasW(), canvasH());
    if (!box) return;
    cropCanvas(box.x, box.y, box.w, box.h);
  }
  // W x H mode: the crop lands on exactly the target size, in the same 'Crop' undo step.
  if (target) resampleCanvas(target.w, target.h);
}

/**
 * Resample every layer and layer mask to w x h px through sample(img, w, h) without an undo
 * step of its own (the caller pushed one). Object centres scale with the canvas.
 */
function resampleCanvas(w, h, sample = resampleImageData) {
  const oldW = canvasW();
  const oldH = canvasH();
  if (oldW === w && oldH === h) return;
  const scaled = state.layers.map((layer) =>
    sample(layer.ctx.getImageData(0, 0, oldW, oldH), w, h)
  );
  const masks = state.layers.map((layer) =>
    layer.mask ? sample({ width: oldW, height: oldH, data: maskToRgba(layer.mask) }, w, h) : null
  );
  resizeStack(w, h);
  state.layers.forEach((layer, i) => {
    layer.ctx.clearRect(0, 0, w, h);
    layer.ctx.putImageData(new ImageData(scaled[i].data, w, h), 0, 0);
    if (masks[i]) {
      layer.mask = maskFromRgba(masks[i].data, 255);
      syncLayerMask(layer);
    }
  });
  const kx = w / oldW;
  const ky = h / oldH;
  for (const o of state.objects) {
    const nx = (o.x + o.w / 2) * kx - o.w / 2;
    const ny = (o.y + o.h / 2) * ky - o.h / 2;
    if (o.type === 'text') {
      o.canvasX = (o.canvasX ?? o.x) + nx - o.x;
      o.canvasY = (o.canvasY ?? o.y) + ny - o.y;
    }
    o.x = nx;
    o.y = ny;
  }
  scheduleAutosave(state, w, h);
  redrawObjects();
  refreshLayerPanelUI();
}

/**
 * Crop every layer and layer mask to `frame` turned deg degrees clockwise about its centre
 * (PhotoCraft rotated_crop), one 'Crop' undo step. The canvas becomes the frame's size; pixels
 * resample bilinearly, transparent where the image does not reach (masks reveal there).
 */
function cropTurnedCanvas(frame, deg) {
  commitSelection();
  pushUndo('Crop');
  const oldW = canvasW();
  const oldH = canvasH();
  const white = [255, 255, 255, 255];
  const turned = state.layers.map((layer) =>
    turnedCropImageData(layer.ctx.getImageData(0, 0, oldW, oldH), frame, deg)
  );
  const masks = state.layers.map((layer) =>
    layer.mask
      ? turnedCropImageData(
          { width: oldW, height: oldH, data: maskToRgba(layer.mask) },
          frame,
          deg,
          white
        )
      : null
  );
  const { width: W, height: H } = turned[0];
  resizeStack(W, H);
  state.layers.forEach((layer, i) => {
    layer.ctx.clearRect(0, 0, W, H);
    layer.ctx.putImageData(new ImageData(turned[i].data, W, H), 0, 0);
    if (masks[i]) {
      layer.mask = maskFromRgba(masks[i].data, 255);
      syncLayerMask(layer);
    }
  });
  // Objects keep their shape; their centres move into the frame's axes. Those fully outside drop.
  const fcx = (frame[0] + frame[2]) / 2;
  const fcy = (frame[1] + frame[3]) / 2;
  const r = (deg * Math.PI) / 180;
  const sn = Math.sin(r);
  const cs = Math.cos(r);
  const kept = [];
  for (const o of state.objects) {
    const dx = o.x + o.w / 2 - fcx;
    const dy = o.y + o.h / 2 - fcy;
    const nx = W / 2 + cs * dx + sn * dy - o.w / 2;
    const ny = H / 2 - sn * dx + cs * dy - o.h / 2;
    if (nx + o.w <= 0 || ny + o.h <= 0 || nx >= W || ny >= H) continue;
    if (o.type === 'text') {
      o.canvasX = (o.canvasX ?? o.x) + nx - o.x;
      o.canvasY = (o.canvasY ?? o.y) + ny - o.y;
    }
    o.x = nx;
    o.y = ny;
    kept.push(o);
  }
  state.objects = kept;
  setObjectSelection([]);
  state.sel.mode = 'none';
  state.sel.data = null;
  state.sel.mask = null;
  state.sel.baseData = null;
  scheduleAutosave(state, W, H);
  redrawObjects();
  refreshLayerPanelUI();
}

/**
 * Enter on the Perspective Crop quad (perspective_crop_ui.rs commit, image.perspectiveCrop):
 * every layer and layer mask maps through the quad onto an upright w x h canvas, one
 * 'Perspective Crop' undo step. w and h come from the Crop W x H fields, else the quad's mean
 * side lengths. A quad that is not convex stays for fixing.
 */
function commitPerspectiveCrop() {
  const quad = state.perspectiveQuad;
  if (!quad || !convexQuad(quad)) return;
  const opts = state.toolOptions.crop ?? {};
  const { w: W, h: H } = perspectiveCropSize(quad, opts.cropW, opts.cropH);
  TOOLS.perspectiveCrop.cancel(ov, state);
  commitSelection();
  pushUndo('Perspective Crop');
  const oldW = canvasW();
  const oldH = canvasH();
  const white = [255, 255, 255, 255];
  const mapped = state.layers.map((layer) =>
    perspectiveCropImageData(layer.ctx.getImageData(0, 0, oldW, oldH), quad, W, H)
  );
  const masks = state.layers.map((layer) =>
    layer.mask
      ? perspectiveCropImageData(
          { width: oldW, height: oldH, data: maskToRgba(layer.mask) },
          quad,
          W,
          H,
          white
        )
      : null
  );
  resizeStack(W, H);
  state.layers.forEach((layer, i) => {
    layer.ctx.clearRect(0, 0, W, H);
    layer.ctx.putImageData(new ImageData(mapped[i].data, W, H), 0, 0);
    if (masks[i]) {
      layer.mask = maskFromRgba(masks[i].data, 255);
      syncLayerMask(layer);
    }
  });
  // Objects keep their shape; their centres go through the quad's map. Those fully outside drop.
  const toOut = invertHomography(homographyFromQuad(quad, W, H));
  const kept = [];
  for (const o of state.objects) {
    const [cx, cy] = applyHomography(toOut, o.x + o.w / 2, o.y + o.h / 2);
    const nx = cx - o.w / 2;
    const ny = cy - o.h / 2;
    if (!(nx + o.w > 0 && ny + o.h > 0 && nx < W && ny < H)) continue;
    if (o.type === 'text') {
      o.canvasX = (o.canvasX ?? o.x) + nx - o.x;
      o.canvasY = (o.canvasY ?? o.y) + ny - o.y;
    }
    o.x = nx;
    o.y = ny;
    kept.push(o);
  }
  state.objects = kept;
  setObjectSelection([]);
  state.sel.mode = 'none';
  state.sel.data = null;
  state.sel.mask = null;
  state.sel.baseData = null;
  scheduleAutosave(state, W, H);
  redrawObjects();
  refreshLayerPanelUI();
}

// Image › Image Size…: every layer and mask resamples to width x height, one undo step.
function imageSize({ width, height, method }) {
  if (width === canvasW() && height === canvasH()) return;
  commitSelection();
  pushUndo('Image Size');
  resampleCanvas(width, height, (img, w, h) => resample(img, w, h, method));
  cancelCropFrame();
}

// Image › Trim…: crop every layer to the composite's trimBounds, one undo step.
// Image › Mode. Grayscale converts every pixel layer to its luma under one undo; RGB Color only
// changes the mode, so the gray pixels stay gray.
function setDocMode(mode) {
  mode = normalizeDocMode(mode);
  if (mode === state.docMode) return;
  commitSelection();
  pushUndo(mode === 'grayscale' ? 'Grayscale' : 'RGB Color');
  if (mode === 'grayscale') grayscaleLayers(state.layers);
  state.colorTable = null;
  applyDocMode(mode);
  scheduleComposite();
  refreshLayerPanelUI();
}

/** Sets the mode and makes the colors and swatches follow it. */
function applyDocMode(mode) {
  state.docMode = normalizeDocMode(mode);
  setColors({ fg: state.color, bg: state.bgColor });
  showPaletteMode(state.docMode, document, state.colorTable);
  updateDocTab(state);
}

/** A color the user picked, as the document mode allows (gray in Grayscale, a table entry…). */
function pickColor(hex) {
  return docColor(state.docMode, hex, state.colorTable);
}

/** The visible stack composited over white, as Indexed Color and Bitmap flatten it. */
function flattenedOverWhite() {
  const W = canvasW();
  const H = canvasH();
  return flattenToCanvas(state.layers, '#ffffff', W, H).getContext('2d').getImageData(0, 0, W, H);
}

/** Replaces the stack with one layer holding img and switches to mode (one stack undo). */
function flattenToMode(label, img, mode, table) {
  pushUndo(label);
  collapseStack().ctx.putImageData(img, 0, 0);
  state.colorTable = table;
  applyDocMode(mode);
  scheduleComposite();
  refreshLayerPanelUI();
}

// Image › Mode › Indexed Color…: flatten, then map every pixel to a color table entry.
function indexedColor(opts) {
  commitSelection();
  const img = flattenedOverWhite();
  let result;
  try {
    result = quantizeIndexed(img, opts);
  } catch (err) {
    showStatusMessage(err.message);
    return;
  }
  flattenToMode('Indexed Color', img, 'indexed', result.table);
}

// Image › Mode › Bitmap…: flatten the gray image to pure black and white.
function bitmapMode({ method }) {
  if (state.docMode !== 'grayscale') return;
  commitSelection();
  flattenToMode('Bitmap', toBitmap(flattenedOverWhite(), method), 'bitmap', null);
}

// Image › Mode › Color Table…: each pixel keeps its entry and takes the entry's new color.
function setColorTable(table) {
  const old = state.colorTable;
  if (state.docMode !== 'indexed' || !old || table.every((c, i) => c === old[i])) return;
  commitSelection();
  pushUndo('Color Table');
  const W = canvasW();
  const H = canvasH();
  for (const layer of state.layers) {
    if (isAdjustmentLayer(layer) || !layer.ctx) continue;
    layer.ctx.putImageData(recolorTable(layer.ctx.getImageData(0, 0, W, H), old, table), 0, 0);
  }
  state.colorTable = table.slice();
  applyDocMode('indexed');
  scheduleComposite();
  refreshLayerPanelUI();
}

// Image › Analysis › Set Measurement Scale… OK (analysis_cmds.rs set_scale). The Ruler's
// Use Measurement Scale readouts follow it.
function setMeasurementScale(fields) {
  const r = measurementScaleFromDialog(fields, state.measurementScale);
  if (r.error) {
    showStatusMessage(r.error);
    return;
  }
  state.measurementScale = r.scale;
  fileDoc.markDirty();
  refreshToolOptions();
}

function trim({ basedOn, sides }) {
  const W = canvasW();
  const H = canvasH();
  const r = trimBounds(state.sampleVisible(W, H), basedOn, sides);
  if (!r) {
    showStatusMessage('Nothing to trim to: every pixel would be trimmed away.');
    return;
  }
  if (r.x === 0 && r.y === 0 && r.w === W && r.h === H) return;
  commitSelection();
  pushUndo('Trim');
  cropStack(r.x, r.y, r.w, r.h);
  cancelCropFrame();
}

/** A one-line note in the status bar that clears itself. */
let statusMessageTimer = 0;
function showStatusMessage(text) {
  const el = document.getElementById('status-message');
  if (!el) return;
  el.textContent = text;
  el.hidden = false;
  clearTimeout(statusMessageTimer);
  statusMessageTimer = setTimeout(() => {
    el.hidden = true;
    el.textContent = '';
  }, 4000);
}

function cancelCropFrame() {
  if (state.cropFrame || state.cropDrag) TOOLS.crop.cancel(ov, state);
  ensureCropFrame();
}

/** The active selection's bounds { x, y, w, h }, or null. */
function selectionBox() {
  const sel = state.sel;
  if (sel.mode !== 'active' || !(sel.w > 0) || !(sel.h > 0)) return null;
  return { x: sel.x, y: sel.y, w: sel.w, h: sel.h };
}

/** While the Crop tool is active, frame the selection bounds or the canvas (ensure_frame). */
function ensureCropFrame() {
  if (state.tool !== 'crop') return;
  // The Crop Shield's Match Canvas colour (crop_shield.rs canvas_color): the pasteboard's.
  const bg = getComputedStyle(document.getElementById('canvas-area')).backgroundColor;
  const rgb = /rgba?\(\s*(\d+)[,\s]+(\d+)[,\s]+(\d+)/.exec(bg ?? '');
  if (rgb) state.canvasRgb = rgb.slice(1, 4).map(Number);
  TOOLS.crop.ensureFrame(ov, state, canvasW(), canvasH(), selectionBox());
}

/**
 * Leaving the Crop tool (crop_ui.rs commit_on_leave): an untouched default frame drops, any
 * other pending frame crops.
 */
function leaveCropTool() {
  if (state.cropFrame && !state.cropDefault && !state.cropDrag) cropPendingFrame();
  TOOLS.crop.cancel(ov, state);
}

/** Crop every layer, layer mask, and object to (sx, sy, sw, sh), one 'Crop' undo step. */
function cropCanvas(sx, sy, sw, sh) {
  // Stamp any floating content before cropping
  commitSelection();
  pushUndo('Crop');
  cropStack(sx, sy, sw, sh);
}

// cropCanvas without the commit and the undo row, for compound commands.
function cropStack(sx, sy, sw, sh) {
  state.historySource = new Map();
  for (const layer of state.layers) {
    const cropped = layer.ctx.getImageData(sx, sy, sw, sh);
    if (layer.mask) {
      const { width, height } = layer.canvas;
      layer.mask = cropMask(layer.mask, width, height, sx, sy, sw, sh);
    }
    layer.canvas.width = sw;
    layer.canvas.height = sh;
    layer.ctx.putImageData(cropped, 0, 0);
    if (layer.mask) syncLayerMask(layer);
    // The text keeps its place on the page: its anchor moves with the crop's origin.
    if (isTypeLayer(layer)) {
      layer.type = translateType(layer.type, -sx, -sy);
      layer.typeSize = [sw, sh];
    }
  }
  // Shift objects into the cropped frame; drop those fully outside
  const kept = [];
  for (const o of state.objects) {
    const nx = o.x - sx;
    const ny = o.y - sy;
    if (nx + o.w <= 0 || ny + o.h <= 0 || nx >= sw || ny >= sh) continue;
    o.x = nx;
    o.y = ny;
    if (o.type === 'text') {
      o.canvasX = (o.canvasX ?? o.x + sx) - sx;
      o.canvasY = (o.canvasY ?? o.y + sy) - sy;
    }
    kept.push(o);
  }
  state.objects = kept;
  setObjectSelection([]);
  overlayCanvas.width = sw;
  overlayCanvas.height = sh;
  if (objectsCanvas) {
    objectsCanvas.width = sw;
    objectsCanvas.height = sh;
  }
  stackEl.style.width = sw + 'px';
  stackEl.style.height = sh + 'px';
  // Clear selection — it no longer maps to the new canvas
  state.sel.mode = 'none';
  state.sel.data = null;
  state.sel.mask = null;
  state.sel.baseData = null;
  scheduleAutosave(state, sw, sh);
  redrawObjects();
  refreshLayerPanelUI();
}

// Image > Image Rotation (PhotoCraft image.rotation.arbitrary). deg is clockwise on screen.
function rotateCanvas(deg) {
  if (!Number.isFinite(deg) || Math.abs(deg) > 3600) return;
  // A full turn changes nothing and leaves no history row.
  if (Math.abs(((deg % 360) + 360) % 360) < 1e-9) return;
  commitSelection();
  pushUndo('Rotate Canvas');
  rotateStack(deg);
}

// Image › Image Rotation › Flip Canvas Horizontal / Vertical: every layer and mask mirrors.
function flipCanvas(horizontal) {
  commitSelection();
  pushUndo(horizontal ? 'Flip Canvas Horizontal' : 'Flip Canvas Vertical');
  const W = canvasW();
  const H = canvasH();
  // History Brush snapshots no longer line up with the mirrored pixels.
  state.historySource = new Map();
  for (const layer of state.layers) {
    const img = flipImageData(layer.ctx.getImageData(0, 0, W, H), horizontal);
    layer.ctx.putImageData(new ImageData(img.data, W, H), 0, 0);
    if (layer.mask) {
      const m = flipImageData({ width: W, height: H, data: maskToRgba(layer.mask) }, horizontal);
      layer.mask = maskFromRgba(m.data, 255);
      syncLayerMask(layer);
    }
  }
  // Objects keep their shape; their boxes mirror across the canvas.
  for (const o of state.objects) {
    const nx = horizontal ? W - o.x - o.w : o.x;
    const ny = horizontal ? o.y : H - o.y - o.h;
    if (o.type === 'text') {
      o.canvasX = (o.canvasX ?? o.x) + nx - o.x;
      o.canvasY = (o.canvasY ?? o.y) + ny - o.y;
    }
    o.x = nx;
    o.y = ny;
  }
  setObjectSelection([]);
  state.sel.mode = 'none';
  state.sel.data = null;
  state.sel.mask = null;
  state.sel.baseData = null;
  drawSelectionOverlay(state, ov);
  redrawObjects();
  refreshLayerPanelUI();
  scheduleComposite();
  scheduleAutosave(state, W, H);
}

// rotateCanvas without the commit and the undo row, for compound commands.
function rotateStack(deg) {
  const oldW = canvasW();
  const oldH = canvasH();
  const { width: W, height: H } = rotatedSize(oldW, oldH, deg);
  const bg = [...hexToRgb(state.bgColor), 255];
  const rotated = state.layers.map((layer) =>
    rotateImageData(
      layer.ctx.getImageData(0, 0, oldW, oldH),
      deg,
      isBackgroundLayer(layer) ? bg : null
    )
  );
  // Masks turn too; the corners the turn uncovers reveal.
  const white = [255, 255, 255, 255];
  const masks = state.layers.map((layer) =>
    layer.mask
      ? rotateImageData({ width: oldW, height: oldH, data: maskToRgba(layer.mask) }, deg, white)
      : null
  );
  resizeStack(W, H);
  state.layers.forEach((layer, i) => {
    layer.ctx.clearRect(0, 0, W, H);
    layer.ctx.putImageData(new ImageData(rotated[i].data, W, H), 0, 0);
    if (masks[i]) {
      layer.mask = maskFromRgba(masks[i].data, 255);
      syncLayerMask(layer);
    }
  });
  // Objects keep their shape; their centres turn with the canvas.
  const r = (deg * Math.PI) / 180;
  const sn = Math.sin(r);
  const cs = Math.cos(r);
  for (const o of state.objects) {
    const dx = o.x + o.w / 2 - oldW / 2;
    const dy = o.y + o.h / 2 - oldH / 2;
    const nx = W / 2 + cs * dx - sn * dy - o.w / 2;
    const ny = H / 2 + sn * dx + cs * dy - o.h / 2;
    if (o.type === 'text') {
      o.canvasX = (o.canvasX ?? o.x) + nx - o.x;
      o.canvasY = (o.canvasY ?? o.y) + ny - o.y;
    }
    o.x = nx;
    o.y = ny;
  }
  setObjectSelection([]);
  // The selection no longer maps to the turned canvas.
  state.sel.mode = 'none';
  state.sel.data = null;
  state.sel.mask = null;
  state.sel.baseData = null;
  drawSelectionOverlay(state, ov);
  redrawObjects();
  refreshLayerPanelUI();
  scheduleAutosave(state, W, H);
}

function openRotateModal() {
  document.getElementById('rotate-modal')?.classList.remove('hidden');
  /** @type {HTMLInputElement} */ (document.getElementById('rotate-angle'))?.focus();
}

function closeRotateModal() {
  document.getElementById('rotate-modal')?.classList.add('hidden');
}

function confirmRotateModal() {
  const angle = parseFloat(
    /** @type {HTMLInputElement} */ (document.getElementById('rotate-angle')).value
  );
  const dir = /** @type {HTMLSelectElement} */ (document.getElementById('rotate-direction')).value;
  if (!Number.isFinite(angle) || Math.abs(angle) > 3600) return;
  closeRotateModal();
  rotateCanvas(dir === 'ccw' ? -angle : angle);
}

// ── Free Transform (PhotoCraft edit.freeTransform) ───────────────────────────
// The selection's pixels (or the whole layer) float above the rest of the layer while the
// overlay shows the box. Enter commits with one undo row; Escape puts the original back.
// The box is the affine ft.t until a Skew, Distort, or Perspective drag makes it the quad
// ft.quad (corners TL, TR, BR, BL), which the source box then warps onto. Warp turns the box
// into ft.mesh, a 4 x 4 Bezier control grid (transform.js meshWarp); leaving Warp drops it.

const FT_HANDLE = 4;
const QUAD_MODES = new Set(['skew', 'distort', 'perspective']);

function freeTransformResult(ft) {
  // A smart object previews from its contents through the box's placement, never compounding.
  if (isSmartLayer(ft.layer)) {
    const m = freeTransformHomography(ft.box, ft.t, ft.quad);
    const smart = m ? transformSmart(ft.layer.smart, m) : ft.layer.smart;
    return renderSmart(smart, canvasW(), canvasH());
  }
  if (ft.mesh) return meshWarp(ft.source, ft.mesh, canvasW(), canvasH(), ft.box);
  if (ft.quad) return warpQuad(ft.source, ft.quad, canvasW(), canvasH(), ft.box);
  const affine = freeTransformAffine(ft.box, ft.t);
  return transformImageData(ft.source, ft.box, affine);
}

// The affine box becomes a quad where it stands.
function toQuad(ft) {
  ensureFreeTransformQuad(ft);
}

// Switch the box to or from Warp (transform_tool.rs enter_warp / leave_warp): the mesh starts
// on the box as it stands, and leaving Warp drops the mesh edits.
function setFreeTransformMode(ft, mode) {
  ft.mode = mode;
  ft.drag = null;
  if (mode !== 'warp') {
    ft.mesh = null;
    if (QUAD_MODES.has(mode)) toQuad(ft);
    return;
  }
  if (ft.mesh) return;
  const m = ft.quad ? quadHomography(ft.box, ft.quad) : freeTransformAffine(ft.box, ft.t);
  ft.mesh = meshFromBox(ft.box, m);
}

// The warp mesh on the overlay: the surface's outline and thirds, each anchor's handles, and
// the twelve grabbable points.
function drawWarpMesh(points) {
  const curve = (fixed, vertical) => {
    ov.beginPath();
    for (let k = 0; k <= 32; k++) {
      const [x, y] = vertical ? evalMesh(points, fixed, k / 32) : evalMesh(points, k / 32, fixed);
      if (k) ov.lineTo(x, y);
      else ov.moveTo(x, y);
    }
    ov.stroke();
  };
  for (const f of [0, 1 / 3, 2 / 3, 1]) {
    curve(f, true);
    curve(f, false);
  }
  const at = (i, j) => points[j * 4 + i];
  ov.beginPath();
  for (const [ai, aj, hi, hj] of [
    [0, 0, 1, 0],
    [0, 0, 0, 1],
    [3, 0, 2, 0],
    [3, 0, 3, 1],
    [0, 3, 1, 3],
    [0, 3, 0, 2],
    [3, 3, 2, 3],
    [3, 3, 3, 2]
  ]) {
    ov.moveTo(...at(ai, aj));
    ov.lineTo(...at(hi, hj));
  }
  ov.stroke();
  const hs = FT_HANDLE / state.zoom;
  points.forEach(([x, y], k) => {
    const i = k % 4;
    const j = Math.floor(k / 4);
    if (i % 3 && j % 3) return;
    const anchor = i % 3 === 0 && j % 3 === 0;
    const r = anchor ? hs : hs * 0.75;
    ov.beginPath();
    if (anchor) ov.rect(x - r, y - r, r * 2, r * 2);
    else ov.arc(x, y, r, 0, Math.PI * 2);
    ov.fill();
    ov.stroke();
  });
}

// Draw the transformed pixels onto the layer, then (when overlay) the box and handles.
function renderFreeTransform(ft, overlay = true) {
  const W = canvasW();
  const H = canvasH();
  const ctx = ft.layer.ctx;
  ctx.putImageData(new ImageData(new Uint8ClampedArray(ft.base.data), W, H), 0, 0);
  const tmp = document.createElement('canvas');
  tmp.width = W;
  tmp.height = H;
  tmp.getContext('2d').putImageData(new ImageData(freeTransformResult(ft).data, W, H), 0, 0);
  ctx.drawImage(tmp, 0, 0);
  if (!overlay) return;

  ov.clearRect(0, 0, overlayCanvas.width, overlayCanvas.height);
  drawFreeTransformBox(ft);
}

// Select › Transform Selection: the box moves the outline only. The ants show the mask as it
// would land (drawToolOverlay puts the box back over them while they march).
function renderTransformSelection(ft) {
  const W = canvasW();
  const H = canvasH();
  applySelectionWithMask(transformSelectionMask(ft.selMask, W, H, ft), W, H, null);
  ov.clearRect(0, 0, overlayCanvas.width, overlayCanvas.height);
  if (state.sel.mode === 'active') drawSelectionOverlay(state, ov);
  else drawFreeTransformBox(ft);
}

function drawFreeTransformBox(ft) {
  const corners = freeTransformCorners(ft);
  const lw = 1 / state.zoom;
  ov.save();
  ov.lineWidth = lw;
  ov.strokeStyle = '#1e90ff';
  if (ft.mesh) {
    ov.fillStyle = '#fff';
    drawWarpMesh(ft.mesh);
    ov.restore();
    return;
  }
  ov.beginPath();
  corners.forEach(([x, y], i) => (i ? ov.lineTo(x, y) : ov.moveTo(x, y)));
  ov.closePath();
  ov.stroke();
  const hs = FT_HANDLE / state.zoom;
  ov.fillStyle = '#fff';
  for (let i = 0; i < 4; i++) {
    const [ax, ay] = corners[i];
    const [bx, by] = corners[(i + 1) % 4];
    for (const [x, y] of [
      [ax, ay],
      [(ax + bx) / 2, (ay + by) / 2]
    ]) {
      ov.fillRect(x - hs, y - hs, hs * 2, hs * 2);
      ov.strokeRect(x - hs, y - hs, hs * 2, hs * 2);
    }
  }
  ov.restore();
}

// mode is null for Free Transform, or 'scale' / 'rotate' / 'skew' / 'distort' / 'perspective' /
// 'warp' for those Edit › Transform items.
function startFreeTransform(mode = null) {
  const smart = isSmartLayer(state.freeTransform ? state.freeTransform.layer : activeLayer());
  // A smart object's placement is a homography; a warp mesh is not one.
  if (smart && mode === 'warp') {
    showStatusMessage('Could not warp: the target layer is a smart object');
    return;
  }
  if (state.freeTransform) {
    setFreeTransformMode(state.freeTransform, mode);
    redrawFreeTransform(state.freeTransform);
    return;
  }
  if (refuseGroupTarget('transform', 'position')) return;
  pointer.commitTextInput();
  const layer = activeLayer();
  const W = canvasW();
  const H = canvasH();
  const sel = state.sel;
  const original = layer.ctx.getImageData(0, 0, W, H);
  // A smart object transforms whole, whatever is selected.
  const hasSel = sel.mode === 'active' && !smart;
  const mask = hasSel ? selectionToFullMask(sel, W, H) : null;
  // A smart object's box is its placed contents' bounds, so scaling about it round-trips.
  const box = smart ? smartBounds(layer.smart) : mask ? maskBBox(mask, W, H) : opaqueBBox(original);
  if (!box) return;
  // The Background's transparency is locked: what moves away leaves the background colour.
  const fill = isBackgroundLayer(layer) ? [...hexToRgb(state.bgColor), 255] : null;
  const { source, base } = liftForTransform(original, mask, fill);
  // A floating paste already sits on the layer; what it covers comes back from baseData.
  if (hasSel && sel.data && sel.baseData) base.data.set(sel.baseData.data);
  state.freeTransform = {
    layer,
    original,
    source,
    base,
    box,
    t: { ...IDENTITY_TRANSFORM },
    quad: null,
    mesh: null,
    savedSel: { ...sel },
    mode,
    drag: null
  };
  setFreeTransformMode(state.freeTransform, mode);
  state.sel = { ...sel, mode: 'none', data: null, mask: null, baseData: null, lassoPoly: null };
  state.drawing = false;
  renderFreeTransform(state.freeTransform);
}

// Select › Transform Selection (transform_tool.rs begin_selection): the Free Transform box on
// the selection's bounds, moving the mask and never the pixels.
function startTransformSelection() {
  if (state.freeTransform || state.sel.mode !== 'active') return;
  pointer.commitTextInput();
  const W = canvasW();
  const H = canvasH();
  if (state.sel.data && state.sel.baseData) stampFloatingSelection(state, activeCtx());
  const selMask = selectionToFullMask(state.sel, W, H);
  const box = maskBBox(selMask, W, H);
  if (!box) return;
  state.freeTransform = {
    selection: true,
    layer: null,
    selMask,
    box,
    t: { ...IDENTITY_TRANSFORM },
    quad: null,
    mesh: null,
    savedSel: { ...state.sel, data: null, baseData: null },
    mode: null,
    drag: null
  };
  state.drawing = false;
  renderTransformSelection(state.freeTransform);
}

function redrawFreeTransform(ft) {
  if (ft.selection) renderTransformSelection(ft);
  else renderFreeTransform(ft);
}

function endFreeTransform(commit) {
  const ft = state.freeTransform;
  if (!ft) return;
  state.freeTransform = null;
  const W = canvasW();
  const H = canvasH();
  if (ft.selection) {
    ov.clearRect(0, 0, overlayCanvas.width, overlayCanvas.height);
    overlayCanvas.style.cursor = TOOLS[state.tool]?.cursor ?? 'crosshair';
    if (commit) applySelectionWithMask(transformSelectionMask(ft.selMask, W, H, ft), W, H, null);
    else state.sel = ft.savedSel;
    drawSelectionOverlay(state, ov);
    return;
  }
  ft.layer.ctx.putImageData(ft.original, 0, 0);
  ov.clearRect(0, 0, overlayCanvas.width, overlayCanvas.height);
  overlayCanvas.style.cursor = TOOLS[state.tool]?.cursor ?? 'crosshair';
  if (!commit) {
    state.sel = ft.savedSel;
    drawSelectionOverlay(state, ov);
    return;
  }
  // pushUndo snapshots the active layer, so make sure that is the transformed one.
  if (activeLayer() !== ft.layer) {
    const idx = state.layers.indexOf(ft.layer);
    if (idx < 0) return;
    state.activeLayerIdx = idx;
  }
  // A warp is not a matrix, so Transform Again keeps the last one.
  const affine = ft.mesh
    ? null
    : ft.quad
    ? quadHomography(ft.box, ft.quad)
    : freeTransformAffine(ft.box, ft.t);
  // A whole-layer transform carries the linked pixel layers through the same matrix; type,
  // shape, and smart layers keep their own records, and locked layers stay.
  const partners =
    affine && ft.savedSel.mode !== 'active' && !isSmartLayer(ft.layer)
      ? linkedPartners(
          state.layers,
          ft.layer,
          (l) =>
            !isBackgroundLayer(l) &&
            !positionLocked(state.layers, l) &&
            !isTypeLayer(l) &&
            !isShapeLayer(l) &&
            !isSmartLayer(l)
        )
      : [];
  pushUndo(ft.mesh ? 'Warp' : 'Free Transform', partners.length > 0 || undefined);
  if (partners.length) {
    transformLinked(partners, affine, toImageData);
    scheduleComposite();
  }
  if (isSmartLayer(ft.layer)) {
    // The placement changes and the pixels render again from the contents.
    const m = freeTransformHomography(ft.box, ft.t, ft.quad);
    if (m) ft.layer.smart = transformSmart(ft.layer.smart, m);
    renderSmartLayer(ft.layer);
    state.sel = ft.savedSel;
    drawSelectionOverlay(state, ov);
  } else renderFreeTransform(ft, false);
  if (affine) state.lastTransform = { affine, nearest: false };
  refreshLayerPanelUI();
  scheduleAutosave(state, W, H);
}

// Pointer events while Free Transform owns the canvas — Adapter over transform.js Seam.
function freeTransformPointer(type, x, y, shift, mods = {}) {
  const ft = state.freeTransform;
  if (!ft) return;
  runFreeTransformPointer(
    ft,
    type,
    x,
    y,
    { ...mods, shift },
    {
      zoom: state.zoom,
      handlePx: FT_HANDLE,
      setCursor: (c) => {
        overlayCanvas.style.cursor = c;
      },
      redraw: redrawFreeTransform
    }
  );
}

// Ruler > Straighten Layer (PhotoCraft analysis_cmds.rs straighten). On the bottom layer, which
// rotateCanvas fills with the background colour, the whole canvas turns and crops to the largest
// inscribed rectangle; on any other layer the layer turns about the canvas centre at the same
// size. Either way the ruler clears.
function straightenLayer() {
  const deg = state.ruler ? straightenAngle(state.ruler) : 0;
  if (Math.abs(deg) < 1e-9) return;
  const layer = activeLayer();
  if (!layer?.ctx || refuseGroupTarget('straighten the layer', 'position')) return;
  if (layer === state.layers[0]) {
    commitSelection();
    pushUndo('Straighten', true);
    const w0 = canvasW();
    const h0 = canvasH();
    rotateStack(deg);
    const r = straightenCropRect(w0, h0, canvasW(), canvasH(), deg);
    cropStack(r.x, r.y, r.width, r.height);
    TOOLS.ruler.clear(ov, state);
    drawSelectionOverlay(state, ov);
    scheduleComposite();
    return;
  }
  pushUndo('Straighten');
  const W = canvasW();
  const H = canvasH();
  const turned = straightenImageData(layer.ctx.getImageData(0, 0, W, H), deg);
  layer.ctx.putImageData(new ImageData(turned.data, W, H), 0, 0);
  TOOLS.ruler.clear(ov, state);
  drawSelectionOverlay(state, ov);
  refreshLayerPanelUI();
  scheduleComposite();
  scheduleAutosave(state, W, H);
}

// ── Edit › Transform presets and Again ───────────────────────────────────────
// PhotoCraft extra_cmds.rs transform_preset: the active layer's selected pixels (or the whole
// layer) flip or turn about the centre of their own bounds, with nearest sampling; the canvas
// keeps its size (Image › Image Rotation turns the canvas). While a Free Transform box is open
// the presets turn the box instead (transform_tool.rs intercept).

const PRESET_LABELS = {
  rotate180: 'Rotate 180°',
  rotate90Cw: 'Rotate 90° Clockwise',
  rotate90Ccw: 'Rotate 90° Counter Clockwise',
  flipHorizontal: 'Flip Horizontal',
  flipVertical: 'Flip Vertical'
};

function transformPreset(kind) {
  const ft = state.freeTransform;
  if (ft) {
    // Not while warping: the mesh is the box (transform_tool.rs intercept).
    if (ft.mesh) return;
    if (ft.quad) ft.quad = presetQuad(ft.quad, kind);
    else ft.t = presetFreeTransform(ft.t, kind);
    redrawFreeTransform(ft);
    return;
  }
  transformActiveLayer(PRESET_LABELS[kind], (box) => transformPresetAffine(kind, box), true);
}

// Edit › Transform › Again (edit_cmds.rs transform_again): the last committed matrix, in
// document coordinates, on whatever is selected now.
function transformAgain() {
  const last = state.lastTransform;
  if (!last) return;
  transformActiveLayer('Transform Again', () => last.affine, last.nearest);
}

function transformActiveLayer(label, affineFor, nearest) {
  if (state.freeTransform) endFreeTransform(true);
  const layer = activeLayer();
  if (!layer?.ctx || isAdjustmentLayer(layer) || refuseGroupTarget('transform', 'position')) return;
  pointer.commitTextInput();
  const W = canvasW();
  const H = canvasH();
  if (isSmartLayer(layer)) {
    // The whole smart object turns or flips about its own bounds; its placement records it.
    const m = affineFor(smartBounds(layer.smart));
    pushUndo(label);
    layer.smart = transformSmart(layer.smart, m.length === 6 ? affineHomography(m) : m);
    renderSmartLayer(layer);
    state.lastTransform = { affine: m, nearest };
    refreshLayerPanelUI();
    scheduleComposite();
    scheduleAutosave(state, W, H);
    return;
  }
  const sel = state.sel;
  const hasSel = sel.mode === 'active';
  if (hasSel && sel.data && sel.baseData) stampFloatingSelection(state, layer.ctx);
  const original = layer.ctx.getImageData(0, 0, W, H);
  const mask = hasSel ? selectionToFullMask(sel, W, H) : null;
  const box = mask ? maskBBox(mask, W, H) : opaqueBBox(original);
  if (!box) return;
  const affine = affineFor(box);
  // The Background's transparency is locked: what moves away leaves the background colour.
  const fill = isBackgroundLayer(layer) ? [...hexToRgb(state.bgColor), 255] : null;
  pushUndo(label);
  const out = transformLayerPixels(original, mask, box, affine, { nearest, fill });
  layer.ctx.putImageData(new ImageData(out.data, W, H), 0, 0);
  if (mask) {
    const moved = transformMask(mask, W, H, box, affine);
    const b = maskBBox(moved, W, H);
    const rest = { data: null, baseData: null, lassoPoly: null, boundaryPixels: null };
    state.sel = b ? { ...sel, ...rest, ...b, mask: moved } : { ...sel, ...rest, mode: 'none' };
  }
  state.lastTransform = { affine, nearest };
  drawSelectionOverlay(state, ov);
  refreshLayerPanelUI();
  scheduleComposite();
  scheduleAutosave(state, W, H);
}

// ── Image upload ─────────────────────────────────────────────────────────────

function loadAnyFile(file) {
  const looksLikeProject =
    file.name?.toLowerCase().endsWith('.paintproj') || file.type === 'application/json';
  if (looksLikeProject) {
    readProjectFile(file)
      .then((data) => loadProjectData(data, file.name))
      .catch((err) => confirmDialog.openAlert('Could not open project: ' + err.message));
  } else if (file.type?.startsWith('image/')) {
    loadImageFile(file);
  }
}

function loadImageFile(file) {
  const url = URL.createObjectURL(file);
  const img = new Image();
  img.onload = () => {
    pushUndo('Upload');
    commitSelection();
    const origin = viewportPasteOrigin(
      img.naturalWidth || img.width,
      img.naturalHeight || img.height
    );
    const obj = createImageObjectFromImage(img, origin.x, origin.y);
    state.objects.push(obj);
    setObjectSelection([obj.id]);
    URL.revokeObjectURL(url);
    redrawObjects();
    setActiveTool('select');
    refreshLayerPanelUI();
  };
  img.src = url;
}

async function loadProjectData(data, fileName = null) {
  await deserializeProject(
    data,
    ({
      docName,
      width,
      height,
      layers,
      bgColor,
      fgColor,
      activeLayerIdx,
      objects,
      fileInfo,
      docMode,
      colorTable,
      measurementScale,
      count,
      samplers,
      notes,
      guides,
      channels,
      paths,
      layerComps
    }) => {
      state.docName = docName;
      state.fileInfo = fileInfo;
      updateDocTab(state);
      // Tear down current layers
      for (const l of state.layers) removeLayerFromDOM(l);
      state.layers = layers;
      state.activeLayerIdx = Math.min(activeLayerIdx, layers.length - 1);
      state.editMask = false;
      state.bgColor = bgColor;
      state.color = fgColor;
      state.activeColor = fgColor;
      state.objects = objects || [];
      setObjectSelection([]);
      state.undoStack = [];
      state.redoStack = [];
      // Resize stack DOM
      overlayCanvas.width = width;
      overlayCanvas.height = height;
      stackEl.style.width = width + 'px';
      stackEl.style.height = height + 'px';
      // Mount layers
      for (const layer of state.layers) insertLayerBefore(layer, stackEl, layerInsertRef());
      resetHistorySources();
      state.measurementScale = measurementScale;
      state.count = count;
      state.samplers = samplers ?? [];
      state.notes = notes ?? [];
      state.guides = guides;
      state.channels = channels ?? [];
      renderChannels();
      state.layerComps = layerComps ?? [];
      renderLayerComps();
      state.paths = paths ?? emptyPaths();
      renderPaths();
      if (objectsCanvas) {
        objectsCanvas.width = width;
        objectsCanvas.height = height;
      }
      updateUndoButtons();
      refreshLayerPanelUI();
      renderHistoryPanel();
      updateFgSwatch(state.color);
      state.onBgColorChange?.(state.bgColor);
      state.colorTable = colorTable;
      applyDocMode(docMode);
      redrawObjects();
    }
  );
  fileDoc.opened(fileName);
}

// ── Color history ─────────────────────────────────────────────────────────────

function addToColorHistory(hex) {
  state.colorHistory = [hex, ...state.colorHistory.filter((c) => c !== hex)].slice(0, 8);
  updateColorHistory(state.colorHistory, (picked) => {
    const color = pickColor(picked);
    state.color = color;
    state.activeColor = color;
    updateFgSwatch(color);
  });
}

/** Set foreground and background together (Default Colors, Switch Colors). */
function setColors({ fg, bg }) {
  fg = pickColor(fg);
  bg = pickColor(bg);
  state.color = fg;
  state.activeColor = fg;
  state.bgColor = bg;
  showColor('fg', fg);
  showColor('bg', bg);
}

// ── Pointer controller (lives in ./pointer.js) ───────────────────────────────

const pointer = createPointerController({
  state,
  overlayCanvas,
  ov,
  activeCtx,
  activeLayer,
  pushUndo,
  updateTransform,
  refreshLayerPanel: refreshLayerPanelUI,
  toView,
  areaSize
});

// ── Clear / new project ──────────────────────────────────────────────────────

// Edit > Define Pattern: the Pattern Stamp's pattern becomes the active layer's pixels under the
// selection's bounding box, or the whole layer with no selection. Not an undoable change.
function defineLayerPattern() {
  const ctx = activeCtx();
  const W = ctx.canvas.width,
    H = ctx.canvas.height;
  const mask = state.sel.mode === 'active' ? selectionToFullMask(state.sel, W, H) : null;
  const pattern = definePattern(ctx.getImageData(0, 0, W, H).data, W, H, mask);
  if (!pattern) return;
  addPattern(state, pattern);
  presetPanels.renderPatterns();
}

function clearCanvas() {
  if (refuseGroupTarget()) return;
  pushUndo('Clear');
  const ctx = activeCtx();
  ctx.fillStyle = state.bgColor;
  ctx.fillRect(0, 0, ctx.canvas.width, ctx.canvas.height);
  commitSelection();
  refreshLayerPanelUI();
}

function newProject() {
  const start = () => {
    resetToBlankDocument();
    fileDoc.reset();
  };
  if (!state.dirty) {
    start();
    return;
  }
  confirmDialog.openConfirm('Start a new project? Unsaved changes will be lost.', start);
}

function resetToBlankDocument() {
  for (const l of state.layers) removeLayerFromDOM(l);
  state.layers = [];
  state.undoStack = [];
  state.redoStack = [];
  state.activeLayerIdx = 0;
  state.editMask = false;
  state.docName = DEFAULT_DOC_NAME;
  state.fileInfo = normalizeFileInfo(null);
  state.docMode = 'rgb';
  state.colorTable = null;
  showPaletteMode('rgb');
  updateDocTab(state);
  const area = document.getElementById('canvas-area');
  const { W, H } = defaultCanvasSize(area);
  const layer0 = createLayer(BACKGROUND_NAME, W, H);
  layer0.background = true;
  layer0.ctx.fillStyle = state.bgColor;
  layer0.ctx.fillRect(0, 0, W, H);
  state.layers.push(layer0);
  insertLayerBefore(layer0, stackEl, layerInsertRef());
  if (objectsCanvas) {
    objectsCanvas.width = W;
    objectsCanvas.height = H;
  }
  overlayCanvas.width = W;
  overlayCanvas.height = H;
  stackEl.style.width = W + 'px';
  stackEl.style.height = H + 'px';
  state.objects = [];
  setObjectSelection([]);
  redrawObjects();
  resetHistorySources();
  updateUndoButtons();
  refreshLayerPanelUI();
  renderHistoryPanel();
  clearAutosave();
}

// ── Panel resize ─────────────────────────────────────────────────────────────

function initPanelResize() {
  const handle = document.getElementById('panel-resize-handle');
  if (!handle) return;
  const MIN_W = 120,
    MAX_W = 520;
  let startX = 0,
    startW = 0;

  handle.addEventListener('pointerdown', (e) => {
    e.preventDefault();
    startX = e.clientX;
    startW =
      parseInt(
        getComputedStyle(document.documentElement).getPropertyValue('--layer-panel-w'),
        10
      ) || 280;
    handle.setPointerCapture(e.pointerId);
    handle.classList.add('dragging');
  });

  handle.addEventListener('pointermove', (e) => {
    if (!handle.classList.contains('dragging')) return;
    // Drag left = wider panel (right panel grows leftward)
    const newW = Math.max(MIN_W, Math.min(MAX_W, startW + (startX - e.clientX)));
    document.documentElement.style.setProperty('--layer-panel-w', newW + 'px');
  });

  const stopDrag = () => handle.classList.remove('dragging');
  handle.addEventListener('pointerup', stopDrag);
  handle.addEventListener('pointercancel', stopDrag);
}

// ── Canvas pixel-size resize handle ──────────────────────────────────────────

const CANVAS_SIZE_MIN = 1;
const CANVAS_SIZE_MAX = 8000;

function initCanvasResizeHandle() {
  const handle = document.getElementById('canvas-resize-handle');
  const ghost = document.getElementById('canvas-resize-ghost');
  const label = document.getElementById('canvas-resize-label');
  if (!handle || !ghost) return;

  let dragging = false;
  let startClientX = 0;
  let startClientY = 0;
  let startW = 0;
  let startH = 0;
  let previewW = 0;
  let previewH = 0;

  function clampSize(n) {
    return Math.max(CANVAS_SIZE_MIN, Math.min(CANVAS_SIZE_MAX, Math.round(n)));
  }

  function showPreview(w, h) {
    ghost.classList.remove('hidden');
    ghost.style.width = w + 'px';
    ghost.style.height = h + 'px';
    if (label) {
      label.classList.remove('hidden');
      label.textContent = `${w} × ${h}`;
    }
    handle.setAttribute('aria-valuenow', String(w));
    handle.setAttribute('aria-valuetext', `${w} by ${h}`);
    const status = document.getElementById('status-coords');
    if (status) status.textContent = `${w} × ${h}`;
  }

  function hidePreview() {
    ghost.classList.add('hidden');
    label?.classList.add('hidden');
  }

  handle.addEventListener('pointerdown', (e) => {
    e.preventDefault();
    e.stopPropagation();
    dragging = true;
    startClientX = e.clientX;
    startClientY = e.clientY;
    startW = canvasW();
    startH = canvasH();
    previewW = startW;
    previewH = startH;
    handle.setPointerCapture(e.pointerId);
    handle.classList.add('dragging');
    showPreview(previewW, previewH);
  });

  handle.addEventListener('pointermove', (e) => {
    if (!dragging) return;
    const dx = (e.clientX - startClientX) / state.zoom;
    const dy = (e.clientY - startClientY) / state.zoom;
    previewW = clampSize(startW + dx);
    previewH = clampSize(startH + dy);
    showPreview(previewW, previewH);
  });

  function endDrag(e) {
    if (!dragging) return;
    dragging = false;
    handle.classList.remove('dragging');
    hidePreview();
    try {
      handle.releasePointerCapture(e.pointerId);
    } catch {
      /* already released */
    }
    if (previewW === startW && previewH === startH) return;
    commitSelection();
    pushUndo('Resize');
    resizeStack(previewW, previewH);
    scheduleAutosave(state, canvasW(), canvasH());
  }

  handle.addEventListener('pointerup', endDrag);
  handle.addEventListener('pointercancel', endDrag);
}

// ── Adjustments ──────────────────────────────────────────────────────────────
// Modal lifecycle (open / preview / cancel / commit) and the action-menu
// open/close helpers live in `./adjust-modal.js`. paint.js owns the wiring
// to its own state + helpers via this thin wrapper layer.

// Displace reads its map from a pixel layer. The map is read once per dialog (or Last Filter)
// so previews written into the active layer never feed back into the map.
let displaceMapCache = new Map();
setDisplaceMapSource({
  options: () =>
    state.layers
      .filter((l) => l.ctx && l.kind !== 'group' && l.kind !== 'adjustment')
      .map((l) => ({ value: String(l.id), label: l.name })),
  image: (value) => {
    if (!displaceMapCache.has(value)) {
      const layer = state.layers.find((l) => String(l.id) === String(value));
      const img = layer?.ctx
        ? layer.ctx.getImageData(0, 0, layer.canvas.width, layer.canvas.height)
        : null;
      displaceMapCache.set(value, img);
    }
    return displaceMapCache.get(value);
  }
});

// Lens Blur's Layer Mask depth map is the active layer's mask.
setLensDepthSource({ layerMask: () => activeLayer()?.mask ?? null });

function openAdjust(id) {
  if (refuseGroupTarget()) return;
  displaceMapCache = new Map();
  doOpenAdjust(id, state, {
    activeCtx,
    pushUndo,
    onPreview: scheduleComposite,
    onCommit: refreshLayerPanelUI,
    onApplied: (filterId, params) => {
      if (FILTER_IDS.has(filterId)) recordLastFilter(state, filterId, params);
    },
    swatches
  });
}

// Invert and Desaturate have no dialog in PhotoCraft (adjust_dialog has_dialog): they apply to
// the active layer, or the selection, as one history step.
function applyAdjustmentNow(id, params = {}) {
  const def = ADJUSTMENTS[id];
  if (!def || !activeLayer() || refuseGroupTarget()) return;
  displaceMapCache = new Map();
  const ctx = activeCtx();
  const W = ctx.canvas.width,
    H = ctx.canvas.height;
  const mask = state.sel.mode === 'active' ? selectionToFullMask(state.sel, W, H) : null;
  const img = ctx.getImageData(0, 0, W, H);
  pushUndo(def.label);
  def.apply(img, params, mask);
  ctx.putImageData(img, 0, 0);
  pullMaskEdit();
  scheduleComposite();
  refreshLayerPanelUI();
}

// Filter › Last Filter: the last Filter menu command again, with its settings, on the active
// layer or selection (PhotoCraft filters.rs last_filter).
function runLastFilter() {
  if (state.lastFilter) applyAdjustmentNow(state.lastFilter.id, { ...state.lastFilter.params });
}

// ── Filter › Blur Gallery (PhotoCraft blur_pins.rs) ─────────────────────────────
// The gallery owns the canvas while it is open: pins sit on the overlay, the side panel holds
// the selected pin's sliders, and the layer previews the blur. Enter applies it as one history
// row; Escape (or Cancel, or undo) puts the layer back. The bounds are the selection's box when
// there is one, and the selection limits the pixels it writes.

function startBlurGallery(kind) {
  if (state.blurGallery || refuseGroupTarget()) return;
  if (state.freeTransform) endFreeTransform(true);
  const layer = activeLayer();
  if (!layer?.ctx || isAdjustmentLayer(layer)) return;
  pointer.commitTextInput();
  const W = canvasW();
  const H = canvasH();
  const mask = state.sel.mode === 'active' ? selectionToFullMask(state.sel, W, H) : null;
  const box = mask ? maskBBox(mask, W, H) : null;
  const bounds = box
    ? { x0: box.x, y0: box.y, x1: box.x + box.w, y1: box.y + box.h }
    : { x0: 0, y0: 0, x1: W, y1: H };
  state.blurGallery = {
    g: newGallery(kind, bounds),
    layer,
    mask,
    original: layer.ctx.getImageData(0, 0, W, H),
    cache: new Map(),
    frame: 0
  };
  blurGalleryPanel.open(state.blurGallery.g);
  renderBlurGallery();
}

function blurGalleryImage(s) {
  const { width, height, data } = s.original;
  const img = new ImageData(new Uint8ClampedArray(data), width, height);
  applyBlurGallery(img, s.g, s.mask, s.cache);
  return img;
}

function drawBlurGalleryOverlay() {
  ov.clearRect(0, 0, overlayCanvas.width, overlayCanvas.height);
  if (state.blurGallery) drawGallery(ov, state.blurGallery.g, state.zoom);
}

// The preview follows the pins once a frame; the overlay follows them at once.
function renderBlurGallery() {
  const s = state.blurGallery;
  if (!s) return;
  drawBlurGalleryOverlay();
  if (s.frame) return;
  s.frame = requestAnimationFrame(() => {
    s.frame = 0;
    if (state.blurGallery !== s) return;
    s.layer.ctx.putImageData(blurGalleryImage(s), 0, 0);
    scheduleComposite();
  });
}

function endBlurGallery(commit) {
  const s = state.blurGallery;
  if (!s) return;
  state.blurGallery = null;
  if (s.frame) cancelAnimationFrame(s.frame);
  blurGalleryPanel.close();
  s.layer.ctx.putImageData(s.original, 0, 0);
  ov.clearRect(0, 0, overlayCanvas.width, overlayCanvas.height);
  if (state.sel.mode === 'active') drawSelectionOverlay(state, ov);
  if (commit) {
    // pushUndo snapshots the active layer, so make sure that is the blurred one.
    const idx = state.layers.indexOf(s.layer);
    if (idx >= 0) {
      state.activeLayerIdx = idx;
      pushUndo(GALLERY_KINDS[s.g.kind].label);
      s.layer.ctx.putImageData(blurGalleryImage(s), 0, 0);
      refreshLayerPanelUI();
      scheduleAutosave(state, canvasW(), canvasH());
    }
  }
  scheduleComposite();
}

function blurGalleryPointer(type, x, y) {
  const s = state.blurGallery;
  if (!s) return;
  blurGallerySessionPointer(s, type, x, y, state.zoom, {
    sync: (g) => blurGalleryPanel.sync(g),
    render: renderBlurGallery,
    drawOverlay: drawBlurGalleryOverlay
  });
}

// ── Filter › Liquify… (PhotoCraft liquify_ui.rs) ────────────────────────────────
// Like the Blur Gallery, Liquify owns the canvas while it is open: the brush edits a displacement
// field over the canvas, the layer previews the source resampled through it (only the rect the
// last dabs touched is redrawn), and the side panel holds the tools and brush options. OK or
// Enter applies it as one history row; Cancel, Escape, or undo with no stroke left restores the
// layer. Ctrl+Z inside Liquify takes back the last stroke. The selection limits what it writes.

function startLiquify() {
  if (state.liquify || refuseGroupTarget()) return;
  if (state.freeTransform) endFreeTransform(true);
  if (state.blurGallery) endBlurGallery(true);
  const layer = activeLayer();
  if (!layer?.ctx || isAdjustmentLayer(layer)) return;
  pointer.commitTextInput();
  const W = canvasW();
  const H = canvasH();
  const original = layer.ctx.getImageData(0, 0, W, H);
  state.liquify = {
    field: newLiquifyField({ x0: 0, y0: 0, x1: W, y1: H }),
    layer,
    mask: state.sel.mode === 'active' ? selectionToFullMask(state.sel, W, H) : null,
    original,
    work: new ImageData(new Uint8ClampedArray(original.data), W, H),
    history: [],
    dirty: null,
    frame: 0,
    down: null,
    hold: 0,
    at: null,
    freezeView: null
  };
  liquifyPanel.open(liquifyOptions);
  drawLiquifyOverlay();
}

// The node-resolution freeze mask as a red tint, scaled up onto the overlay.
function liquifyFreezeCanvas(s) {
  const f = s.field;
  if (!f.freeze.some((v) => v > 0)) return null;
  if (s.freezeView) return s.freezeView;
  const c = document.createElement('canvas');
  c.width = f.w;
  c.height = f.h;
  const img = new ImageData(f.w, f.h);
  for (let n = 0; n < f.freeze.length; n++) {
    img.data[n * 4] = 255;
    img.data[n * 4 + 3] = Math.round(f.freeze[n] * 128);
  }
  c.getContext('2d').putImageData(img, 0, 0);
  s.freezeView = c;
  return c;
}

function drawLiquifyOverlay() {
  const s = state.liquify;
  ov.clearRect(0, 0, overlayCanvas.width, overlayCanvas.height);
  if (!s) return;
  const view = liquifyFreezeCanvas(s);
  if (view) {
    const f = s.field;
    // Node i sits on pixel centre 0.5 + i × cell.
    ov.drawImage(view, 0.5 - f.cell / 2, 0.5 - f.cell / 2, f.w * f.cell, f.h * f.cell);
  }
  if (s.at) {
    ov.save();
    ov.lineWidth = 1 / state.zoom;
    ov.strokeStyle = '#ffffff';
    ov.beginPath();
    ov.arc(s.at[0], s.at[1], liquifyOptions.size / 2, 0, Math.PI * 2);
    ov.stroke();
    ov.restore();
  }
}

// The preview redraws the rect the field changed in once a frame.
function renderLiquify(rect) {
  const s = state.liquify;
  if (!s || !rect) return;
  const pad = liquifyRenderPad(s.field);
  s.dirty = unionRect(s.dirty, {
    x0: rect.x0 - pad,
    y0: rect.y0 - pad,
    x1: rect.x1 + pad,
    y1: rect.y1 + pad
  });
  if (s.frame) return;
  s.frame = requestAnimationFrame(() => {
    s.frame = 0;
    if (state.liquify !== s || !s.dirty) return;
    const W = canvasW();
    const H = canvasH();
    const r = {
      x0: Math.max(0, s.dirty.x0),
      y0: Math.max(0, s.dirty.y0),
      x1: Math.min(W, s.dirty.x1),
      y1: Math.min(H, s.dirty.y1)
    };
    s.dirty = null;
    if (r.x1 <= r.x0 || r.y1 <= r.y0) return;
    applyLiquify(s.original, s.work, s.field, s.mask, r);
    s.layer.ctx.putImageData(s.work, 0, 0, r.x0, r.y0, r.x1 - r.x0, r.y1 - r.y0);
    scheduleComposite();
  });
}

function endLiquify(commit) {
  const s = state.liquify;
  if (!s) return;
  state.liquify = null;
  if (s.frame) cancelAnimationFrame(s.frame);
  clearInterval(s.hold);
  liquifyPanel.close();
  s.layer.ctx.putImageData(s.original, 0, 0);
  ov.clearRect(0, 0, overlayCanvas.width, overlayCanvas.height);
  if (state.sel.mode === 'active') drawSelectionOverlay(state, ov);
  if (commit && s.field.d.some((v) => v !== 0)) {
    // pushUndo snapshots the active layer, so make sure that is the liquified one.
    const idx = state.layers.indexOf(s.layer);
    if (idx >= 0) {
      state.activeLayerIdx = idx;
      pushUndo('Liquify');
      const out = new ImageData(new Uint8ClampedArray(s.original.data), canvasW(), canvasH());
      s.layer.ctx.putImageData(applyLiquify(s.original, out, s.field, s.mask), 0, 0);
      refreshLayerPanelUI();
      scheduleAutosave(state, canvasW(), canvasH());
    }
  }
  scheduleComposite();
}

// Each stroke and whole-field button can be taken back inside Liquify (Ctrl+Z).
function liquifyCheckpoint(s) {
  s.history.push({ d: s.field.d.slice(), freeze: s.field.freeze.slice() });
  if (s.history.length > MAX_UNDO) s.history.shift();
}

function liquifyStepBack() {
  const s = state.liquify;
  if (!s) return;
  const last = s.history.pop();
  if (!last) {
    endLiquify(false);
    return;
  }
  s.field.d.set(last.d);
  s.field.freeze.set(last.freeze);
  s.freezeView = null;
  renderLiquify(s.field.bounds);
  drawLiquifyOverlay();
}

function liquifyGlobal(run) {
  const s = state.liquify;
  if (!s) return;
  liquifyCheckpoint(s);
  run(s.field);
  s.freezeView = null;
  renderLiquify(s.field.bounds);
  drawLiquifyOverlay();
}

function liquifyDabbed(s, rect) {
  if (liquifyOptions.tool === 'freeze' || liquifyOptions.tool === 'thaw') s.freezeView = null;
  else renderLiquify(rect);
  drawLiquifyOverlay();
}

function liquifyPointer(type, x, y, pressure = 1) {
  const s = state.liquify;
  if (!s) return;
  liquifySessionPointer(s, type, x, y, pressure, {
    options: liquifyOptions,
    checkpoint: liquifyCheckpoint,
    dabbed: liquifyDabbed,
    drawOverlay: drawLiquifyOverlay,
    setHold: (tick) => {
      clearInterval(s.hold);
      s.hold = setInterval(() => {
        if (state.liquify !== s || !s.down) return;
        tick();
      }, 40);
    },
    clearHold: () => {
      clearInterval(s.hold);
      s.hold = 0;
    }
  });
}

function liquifyKey(e) {
  const mod = e.ctrlKey || e.metaKey;
  const key = e.key.toLowerCase();
  if (e.key === 'Enter' || e.key === 'Escape') {
    endLiquify(e.key === 'Enter');
  } else if (mod && key === 'z') {
    liquifyStepBack();
  } else if (mod && key === 'i') {
    liquifyGlobal((f) => setFreezeAll(f, 'invert'));
  } else if (mod && key === 'd') {
    liquifyGlobal((f) => setFreezeAll(f, 'none'));
  } else if (mod || e.altKey) {
    return false;
  } else if (e.key === '[' || e.key === ']') {
    const size = liquifyOptions.size;
    liquifyOptions.size =
      e.key === '['
        ? Math.max(1, Math.min(Math.round(size * 0.9), size - 1))
        : Math.min(3000, Math.max(Math.round(size * 1.1), size + 1));
    liquifyPanel.sync(liquifyOptions);
    drawLiquifyOverlay();
  } else {
    const tool = LIQUIFY_TOOLS.find((t) => t.key === key);
    if (tool) {
      liquifyOptions.tool = tool.id;
      liquifyPanel.sync(liquifyOptions);
    }
  }
  return true;
}

// Edit › Fade…: blend the last filter, adjustment, or paint step back towards the pixels before
// it. The dialog previews on the layer; OK is its own history step.
let fadeSession = null;
function openFade() {
  if (!canFade(state)) return;
  const { entry, label } = state.fadeSource;
  const ctx = activeLayer().ctx;
  const after = ctx.getImageData(0, 0, ctx.canvas.width, ctx.canvas.height);
  fadeSession = { ctx, before: entry.data, after, label };
  fadeDialog.open(label);
}

function fadedImage({ ctx, before, after }, { opacity, mode }) {
  const img = ctx.createImageData(after.width, after.height);
  img.data.set(after.data);
  fadePixels(before.data, img.data, opacity, mode);
  return img;
}

function previewFade(p) {
  if (!fadeSession) return;
  fadeSession.ctx.putImageData(fadedImage(fadeSession, p), 0, 0);
  scheduleComposite();
}

function endFade(p) {
  const session = fadeSession;
  fadeSession = null;
  if (!session) return;
  session.ctx.putImageData(session.after, 0, 0);
  if (p) {
    pushUndo(`Fade ${session.label}`);
    session.ctx.putImageData(fadedImage(session, p), 0, 0);
  }
  scheduleComposite();
  refreshLayerPanelUI();
}

// Edit › Fill / Stroke on the active layer (or its mask), one history step. Fill covers the
// selection, or the whole layer with no selection; Stroke runs only with a selection.
function fillOrStroke(label, paint) {
  if (!activeLayer() || refuseGroupTarget()) return;
  const ctx = activeCtx();
  const W = ctx.canvas.width,
    H = ctx.canvas.height;
  const sel = state.sel;
  const mask = sel.mode === 'active' ? selectionToFullMask(sel, W, H) : null;
  if (label === 'Stroke' && !mask) return;
  pushUndo(label);
  // A float is already drawn on the layer; drop its baseData (see gradient).
  if (sel.data) {
    sel.data = null;
    sel.baseData = null;
  }
  const img = ctx.getImageData(0, 0, W, H);
  const keep =
    !editingMask() && transparencyLocked(state.layers, activeLayer()) ? img.data.slice() : null;
  paint(img, mask);
  if (keep) preserveAlpha(keep, img.data);
  ctx.putImageData(img, 0, 0);
  pullMaskEdit();
  scheduleComposite();
  refreshLayerPanelUI();
}

function fillLayer(params) {
  const colors = { fg: state.color, bg: state.bgColor, color: params.color };
  const src = fillContentsSource(params.contents, colors, state.pattern);
  fillOrStroke('Fill', (img, mask) => fillMask(img, mask, src, params));
}

function strokeSelection(params) {
  const rgba = fillContentsSource('color', { fg: params.color });
  fillOrStroke('Stroke', (img, mask) => strokeMask(img, mask, rgba, params));
}

// Image › Auto Tone / Auto Contrast / Auto Color: per-channel Levels from the active pixel layer's
// histograms, inside the selection when there is one (PhotoCraft auto_adjust).
const AUTO_LEVELS_LABELS = { tone: 'Auto Tone', contrast: 'Auto Contrast', color: 'Auto Color' };

function autoLevels(kind) {
  const layer = activeLayer();
  if (!layer?.ctx || isAdjustmentLayer(layer) || editingMask() || refuseGroupTarget()) return;
  const W = canvasW(),
    H = canvasH();
  const mask = state.sel.mode === 'active' ? selectionToFullMask(state.sel, W, H) : null;
  const img = layer.ctx.getImageData(0, 0, W, H);
  const params = autoLevelsParams(img, kind, mask);
  pushUndo(AUTO_LEVELS_LABELS[kind]);
  applyLevelsChannels(img, params, mask);
  layer.ctx.putImageData(img, 0, 0);
  scheduleComposite();
  refreshLayerPanelUI();
}

// ── Tool activation + options panel ──────────────────────────────────────────

// Tools that edit the targeted path; picking one shows it on the overlay.
const PATH_EDIT_TOOLS = new Set([
  'addAnchorPoint',
  'deleteAnchorPoint',
  'convertPoint',
  'pathSelection',
  'directSelection'
]);

function setActiveTool(id) {
  endFreeTransform(true);
  if (state.tool === 'polyLasso' && id !== 'polyLasso' && state.drawing) {
    TOOLS.polyLasso.cancel(ov, state);
  }
  if (state.tool === 'magneticLasso' && id !== 'magneticLasso' && state.drawing) {
    TOOLS.magneticLasso.cancel(ov, state);
  }
  if (id !== state.tool) endPenSubpath();
  if (state.tool === 'crop' && id !== 'crop') leaveCropTool();
  if (state.tool === 'perspectiveCrop' && id !== 'perspectiveCrop') {
    TOOLS.perspectiveCrop.cancel(ov, state);
  }
  // The ruler line and count markers show only while their tool is active; they stay in state.
  if (['ruler', 'count', 'colorSampler', 'note'].includes(state.tool) && id !== state.tool)
    ov.clearRect(0, 0, ov.canvas.width, ov.canvas.height);
  if (id === 'ruler' && state.tool !== 'ruler') drawRuler(ov, state);
  if (id === 'count' && state.tool !== 'count') drawCount(ov, state);
  if (id === 'colorSampler' && state.tool !== 'colorSampler') drawSamplers(ov, state);
  if (id === 'note' && state.tool !== 'note') drawNotes(ov, state);
  if (PATH_EDIT_TOOLS.has(id) && id !== state.tool) {
    state.pathAnchors = [];
    showTargetPath();
  }
  state.tool = id;
  ensureCropFrame();
  overlayCanvas.style.cursor = TOOLS[id].cursor;
  // Pull the tool's own size/fill into the global mirrors so existing
  // tool implementations keep working without each one rewriting.
  const opts = state.toolOptions[id] || {};
  if (typeof opts.size === 'number') state.brushSize = opts.size;
  if (typeof opts.fill === 'boolean') state.shapeFill = opts.fill;
  syncDockBrushSize();
  refreshToolOptions();
  brushPanel.refresh();
  presetPanels.refresh();
  // Guides take the Move tool's drags.
  guidesView.renderGuides();
  // The brush outline follows the tool's tip.
  extrasView.render();
  const toolButtons = document.getElementById('tool-buttons');
  if (toolButtons) selectToolbarTool(toolButtons, id);
}

let syncDockBrushSize = () => {};
let brushPanel = { refresh() {} };
let presetPanels = { refresh() {}, renderPatterns() {}, renderCloneSource() {} };

/**
 * What a Shape tool's options bar shows: the wells are the foreground and background; with a
 * shape layer active, its fill, stroke, and (for the same kind of shape) its geometry.
 */
function shapeOptionValues(id) {
  const layer = activeLayer();
  shapeOptionsLayer = layer?.id ?? null;
  const out = { fillColor: state.color, strokeColor: state.bgColor };
  if (!isShapeLayer(layer)) return out;
  const { fill, stroke, live } = layer.shape;
  out.fill = !!fill;
  if (fill) out.fillColor = fill;
  out.strokeWidth = stroke?.width ?? 0;
  if (stroke) Object.assign(out, { strokeColor: stroke.color, strokeAlign: stroke.align });
  const triangle = live?.kind === 'polygon' && live.sides === 3;
  if (id === 'rect' && live?.kind === 'rect') out.radius = live.radii[0];
  if (id === 'triangle' && triangle) out.radius = live.cornerRadius;
  if (id === 'polygon' && live?.kind === 'polygon' && !triangle) {
    Object.assign(out, { sides: live.sides, starRatio: Math.round(live.starRatio * 100) });
  }
  if (id === 'line' && live?.kind === 'line') out.weight = live.weight;
  return out;
}

// Fill, the stroke's width and alignment are one setting for every Shape tool (tool_options).
const SHAPE_SHARED_KEYS = ['fill', 'strokeWidth', 'strokeAlign'];

/** A Shape tool's options-bar edit: the next shape takes it, and so does the active shape layer. */
function setShapeOption(id, key, value) {
  if (key === 'fillColor') {
    state.color = state.activeColor = value;
    showColor('fg', value);
  } else if (key === 'strokeColor') {
    state.bgColor = value;
    showColor('bg', value);
  } else if (SHAPE_SHARED_KEYS.includes(key)) {
    for (const t of SHAPE_TOOLS) (state.toolOptions[t] ??= {})[key] = value;
  } else {
    state.toolOptions[id][key] = value;
  }
  editActiveShape(key, value);
}

function refreshToolOptions() {
  const container = document.getElementById('tool-options');
  if (!container) return;
  const id = state.tool;
  const schema = TOOL_OPTION_SCHEMA[id] || [];
  // Perspective Crop's W and H are the Crop tool's fields (perspective_crop_ui.rs options_bar).
  const cropSize =
    id === 'perspectiveCrop'
      ? { cropW: state.toolOptions.crop?.cropW ?? '', cropH: state.toolOptions.crop?.cropH ?? '' }
      : {};
  const values = {
    ...state.toolOptions[id],
    ...cropSize,
    selectionMode: state.selectionMode,
    cropStraighten: !!state.cropStraighten,
    ruler: state.ruler ?? null,
    measurementScale: state.measurementScale,
    count: state.count,
    countColor: activeCountColor(state.count),
    countEmpty: countTotal(state.count) === 0,
    samplers: state.samplers,
    samplersEmpty: state.samplers.length === 0,
    notes: state.notes,
    notesEmpty: state.notes.length === 0,
    noteSelected: String(state.noteSelected),
    noteText: state.notes[state.noteSelected]?.text ?? '',
    docSize: [canvasW(), canvasH()],
    canAlign: COMMANDS_BY_ID.get('layer.align.leftEdges').enabled(state),
    canDistribute: COMMANDS_BY_ID.get('layer.distribute.leftEdges').enabled(state),
    ...(isShapeTool(id) ? shapeOptionValues(id) : {})
  };
  renderToolOptions(
    schema,
    values,
    container,
    (key, value) => {
      if (key === 'selectionMode') {
        state.selectionMode = value;
        return;
      }
      if (key === 'cropStraighten') {
        TOOLS.crop.setStraighten(ov, state, value);
        return;
      }
      if (key === '_cropAction') {
        if (value === 'commit') commitCropFrame();
        else if (value === 'swap') TOOLS.crop.swap(ov, state);
        else if (value.startsWith('choose:')) TOOLS.crop.choose(ov, state, value.slice(7));
        else cancelCropFrame();
        return;
      }
      if (key === '_rulerAction') {
        if (value === 'straighten') straightenLayer();
        else TOOLS.ruler.clear(ov, state);
        return;
      }
      if (key === 'ruler') return;
      if (key === '_layerCommand') {
        const cmd = COMMANDS_BY_ID.get(value);
        if (cmd?.enabled(state)) cmd.run(commandCtx);
        return;
      }
      if (key === '_countAction') {
        TOOLS.count.clear(ov, state);
        return;
      }
      if (key === 'count' || key === 'countEmpty') return;
      if (key === '_samplerAction') {
        TOOLS.colorSampler.clear(ov, state);
        return;
      }
      if (key === 'samplers' || key === 'samplersEmpty') return;
      if (key === '_noteAction') {
        if (value === 'clear') state.notes = [];
        else state.notes = removeNote(state.notes, state.noteSelected);
        state.noteSelected = -1;
        drawNotes(ov, state);
        state.onNotesChange();
        return;
      }
      if (key === 'noteSelected') {
        state.noteSelected = Number(value);
        const n = state.notes[state.noteSelected];
        // A selected note's author and colour fill the bar (analysis_ui.rs show_note_options).
        if (n) Object.assign(state.toolOptions.note, { noteAuthor: n.author, noteColor: n.color });
        drawNotes(ov, state);
        refreshToolOptions();
        return;
      }
      if (key === 'noteText') {
        state.notes = setNote(state.notes, state.noteSelected, { text: value });
        fileDoc.markDirty();
        return;
      }
      if (key === 'noteAuthor' || key === 'noteColor') {
        // New notes take these; the selected note follows them too.
        state.toolOptions.note[key] = value;
        const patch = key === 'noteAuthor' ? { author: value } : { color: value };
        if (state.notes[state.noteSelected]) {
          state.notes = setNote(state.notes, state.noteSelected, patch);
          drawNotes(ov, state);
          fileDoc.markDirty();
        }
        return;
      }
      if (key === 'countColor') {
        state.count = setCountGroupColor(state.count, value);
        drawCount(ov, state);
        fileDoc.markDirty();
        return;
      }
      if (key === '_typeAction') {
        if (value === 'commit') pointer.commitTextInput();
        else cancelTextInput();
        return;
      }
      if (key === '_perspectiveCropAction') {
        if (value === 'commit') commitPerspectiveCrop();
        else TOOLS.perspectiveCrop.cancel(ov, state);
        return;
      }
      if (id === 'perspectiveCrop' && (key === 'cropW' || key === 'cropH')) {
        (state.toolOptions.crop ??= {})[key] = value;
        return;
      }
      if (isShapeTool(id)) {
        setShapeOption(id, key, value);
        return;
      }
      state.toolOptions[id][key] = value;
      if (id === 'crop' && ['ratio', 'cropW', 'cropH'].includes(key)) {
        TOOLS.crop.fitRatio(ov, state);
      }
      if (id === 'crop' && /^crop(Overlay|Shield)/.test(key)) TOOLS.crop.redraw(ov, state);
      if (id === 'perspectiveCrop' && key === 'pcropGrid') drawPerspectiveCrop(ov, state);
      if (key === 'rulerUseScale') refreshToolOptions();
      if (key === 'sampleSize') docPanels.refresh();
      if (key === 'size' && typeof value === 'number') {
        state.brushSize = value;
        syncDockBrushSize();
      }
      if (key === 'fill' && typeof value === 'boolean') state.shapeFill = value;
      if (isTypeTool(id)) styleTypeInput();
    },
    swatches()
  );
}

// ── Init ──────────────────────────────────────────────────────────────────────

function init() {
  initCanvas();

  // Inject state callbacks used by tools
  state.commitSelection = commitSelection;
  state.cropToSelection = cropToSelection;
  state.pushUndo = pushUndo;
  state.setPaths = setPaths;
  state.editingMask = editingMask;
  state.showStatusMessage = showStatusMessage;
  state.pullMaskEdit = pullMaskEdit;
  state.scheduleMaskPull = scheduleMaskPull;
  state.scheduleComposite = scheduleComposite;
  state.tryBeginMove = tryBeginMove;
  state.constrainLine = constrainLine;
  state.constrainSquare = constrainSquare;
  state.afterPlaceSelection = selectPlacedContent;
  state.activatePlacedSelection = (ctx, x, y, w, h, baseData, localMask) =>
    doActivatePlacedSelection(state, ctx, x, y, w, h, baseData, localMask);
  state.beginObjectSelect = beginObjectSelect;
  state.setActiveLayer = setActiveLayer;
  state.dragObjectSelect = dragObjectSelect;
  state.endObjectSelect = endObjectSelect;
  state.beginType = beginType;
  state.commitType = commitType;
  state.beginParagraph = beginParagraph;
  state.askRasterizeType = () => rasterizePrompt.open(RASTERIZE_TYPE_MESSAGE, rasterizeTypeLayer);
  state.askRasterizeShape = () =>
    rasterizePrompt.open(RASTERIZE_SHAPE_MESSAGE, rasterizeShapeLayer);
  state.addShapeLayer = addShapeLayer;
  state.freeTransformPointer = freeTransformPointer;
  state.blurGalleryPointer = blurGalleryPointer;
  state.liquifyPointer = liquifyPointer;
  state.commitTextObjectEdit = commitTextObjectEdit;
  state.doMagicWand = (ctx, x, y) => {
    const opts = state.toolOptions.magicWand || {};
    const tolerance = opts.tolerance ?? 32;
    const contiguous = opts.contiguous !== false;
    if (!opts.sampleAllLayers) return floodSelect(ctx, x, y, tolerance, contiguous);
    const { width, height } = ctx.canvas;
    return floodSelectImage(state.sampleVisible(width, height), x, y, tolerance, contiguous);
  };
  // PhotoCraft Sample All Layers / All Layers: the visible composite, not the active layer.
  state.sampleVisible = (width, height) =>
    flattenToCanvas(state.layers, state.bgColor, width, height, { transparentBg: true })
      .getContext('2d')
      .getImageData(0, 0, width, height);
  state.scanlineFill = scanlineFill;
  // The Ruler's X, Y, W, H, A, L1 readouts follow every change to the line.
  state.onRulerChange = () => {
    if (state.tool === 'ruler') refreshToolOptions();
  };
  // Count markers are document data: the readout follows them and the file is unsaved.
  state.onCountChange = () => {
    fileDoc.markDirty();
    if (state.tool === 'count') refreshToolOptions();
  };
  // Sample points and notes are document data too; the Info panel lists the points.
  state.onSamplersChange = () => {
    fileDoc.markDirty();
    docPanels.refresh();
    if (state.tool === 'colorSampler') refreshToolOptions();
  };
  state.onNotesChange = () => {
    fileDoc.markDirty();
    if (state.tool === 'note') refreshToolOptions();
  };
  state.drawToolOverlay = (o) => {
    if (state.freeTransform?.selection) drawFreeTransformBox(state.freeTransform);
    else TOOLS[state.tool]?.overlay?.(o, state);
  };
  // Selection tools commit via commitToolSelection (selection.js), not a state bag binder.

  // Toolbar
  buildToolbar(TOOLS, state, document.getElementById('tool-buttons'), (id) => {
    if (
      state.sel.mode !== 'none' &&
      ![
        'rectSelect',
        'ellipseSelect',
        'singleRowMarquee',
        'singleColumnMarquee',
        'lasso',
        'polyLasso',
        'magneticLasso',
        'quickSelection',
        'magicWand',
        'patch',
        'horizontalTypeMask',
        'verticalTypeMask',
        'pen',
        'freeformPen',
        'curvaturePen',
        'addAnchorPoint',
        'deleteAnchorPoint',
        'convertPoint',
        'pathSelection',
        'directSelection',
        'crop',
        'hand',
        'rotateView',
        'zoom',
        'ruler',
        'count',
        'colorSampler',
        'note',
        'pencil',
        'brush',
        'mixerBrush',
        'eraser',
        'magicEraser',
        'backgroundEraser',
        'fill',
        'gradient',
        'colorReplacement',
        'cloneStamp',
        'patternStamp',
        'healingBrush',
        'spotHealing',
        'historyBrush',
        'redEye',
        'dodge',
        'burn',
        'sponge',
        'blur',
        'sharpen',
        'smudge'
      ].includes(id)
    ) {
      commitSelection();
    }
    pointer.commitTextInput();
    setActiveTool(id);
  });

  // Initial tool-options panel for the default tool
  refreshToolOptions();

  // Palette
  buildPalette(
    state,
    document.getElementById('color-chips'),
    document.getElementById('palette-bar'),
    (picked) => {
      const color = pickColor(picked);
      state.color = color;
      state.activeColor = color;
      showColor('fg', color);
      addToColorHistory(color);
    },
    (picked) => {
      state.bgColor = pickColor(picked);
      showColor('bg', state.bgColor);
    },
    setColors
  );
  state.pickColor = pickColor;
  state.unlockBackground = unlockActiveBackground;

  // Eyedropper callbacks
  state.onColorChange = (color) => {
    state.activeColor = color;
    updateFgSwatch(color);
    addToColorHistory(color);
  };
  state.onBgColorChange = (color) => showColor('bg', color);
  // A Straighten line disarms the options-bar button.
  state.onCropStraighten = () => refreshToolOptions();
  state.onCropHistory = updateUndoButtons;

  // Canvas pointer events
  overlayCanvas.addEventListener('pointerdown', pointer.onPointerDown);
  overlayCanvas.addEventListener('pointermove', pointer.onPointerMove);
  overlayCanvas.addEventListener('pointerup', pointer.onPointerUp);
  overlayCanvas.addEventListener('pointerleave', (e) => {
    if (state.panning) {
      state.panning = false;
      overlayCanvas.style.cursor = TOOLS[state.tool]?.cursor ?? 'crosshair';
    }
    if (state.drawing) pointer.onPointerUp(e);
    extrasView.hover(null);
  });
  overlayCanvas.addEventListener('contextmenu', (e) => e.preventDefault());
  overlayCanvas.addEventListener('dblclick', (e) => {
    if (state.freeTransform) {
      endFreeTransform(true);
      return;
    }
    if (state.tool === 'polyLasso' && state.drawing) TOOLS.polyLasso.close(activeCtx(), ov, state);
    if (state.tool === 'curvaturePen' && state.drawing) {
      const r = overlayCanvas.getBoundingClientRect();
      const x = ((e.clientX - r.left) * overlayCanvas.width) / r.width;
      const y = ((e.clientY - r.top) * overlayCanvas.height) / r.height;
      TOOLS.curvaturePen.toggle(ov, state, x, y);
    }
    if (state.tool === 'magneticLasso' && state.drawing) {
      TOOLS.magneticLasso.close(activeCtx(), ov, state);
    }
    if (state.tool === 'crop' && state.cropFrame) {
      const r = overlayCanvas.getBoundingClientRect();
      const x = ((e.clientX - r.left) * overlayCanvas.width) / r.width;
      const y = ((e.clientY - r.top) * overlayCanvas.height) / r.height;
      const tol = CROP_HANDLE_PX / (state.zoom || 1);
      if (cropHitTurned(state.cropFrame, state.cropAngle || 0, x, y, tol) === 'inside') {
        commitCropFrame();
      }
    }
  });

  // Zoom via scroll wheel
  document.getElementById('canvas-area').addEventListener(
    'wheel',
    (e) => {
      e.preventDefault();
      zoomToward(e.clientX, e.clientY, e.deltaY < 0 ? 1.15 : 1 / 1.15);
    },
    { passive: false }
  );

  // Zoom buttons (header) and the View menu share these
  const zoomCentered = (factor) => {
    const area = document.getElementById('canvas-area');
    const r = area.getBoundingClientRect();
    zoomToward(r.left + r.width / 2, r.top + r.height / 2, factor);
  };
  const zoomReset = () => {
    state.zoom = 1;
    state.panX = 0;
    state.panY = 0;
    updateTransform();
  };
  const zoomActions = {
    'zoom-in': () => zoomCentered(1.25),
    'zoom-out': () => zoomCentered(1 / 1.25),
    'zoom-reset': zoomReset
  };
  for (const [kind, run] of Object.entries(zoomActions)) {
    document.getElementById(`btn-${kind}`)?.addEventListener('click', run);
  }

  // Menu bar: every item is a command in COMMANDS (paint/commands.js); commandCtx is the
  // Adapter Module (command-ctx.js). initMenuBar owns open / close / hover-switch.
  const uploadInput = document.getElementById('upload-input');
  const placeInput = document.getElementById('place-input');
  commandCtx = createCommandCtx({
    state,
    uploadInput,
    placeInput,
    openFilenameModal,
    downloadPNG,
    downloadJPEG,
    canvasW,
    canvasH,
    newProject,
    file: fileDoc,
    fileInfo: openFileInfo,
    exportLayersToFiles,
    deleteAllEmptyLayers,
    flattenAllLayerMasks,
    undo,
    redo,
    copySelection,
    activeCtx,
    copyMerged,
    pasteCommand,
    pasteClipboard,
    pasteIntoSelection,
    toggleLastState,
    clearCanvas,
    fillStrokeDialogs,
    shortcutsDialog,
    startFreeTransform,
    transformAgain,
    transformPreset,
    defineLayerPattern,
    autoLevels,
    openAdjust,
    startBlurGallery,
    startLiquify,
    applyAdjustmentNow,
    runLastFilter,
    openFade,
    imageSizeDialog,
    trimDialog,
    measurementScaleDialog,
    pointer,
    setActiveTool,
    setDocMode,
    indexedColorDialog,
    bitmapDialog,
    colorTableDialog,
    openResizeModalUI,
    rotateCanvas,
    openRotateModal,
    flipCanvas,
    cropToSelection,
    duplicateLayer,
    newLayerDialog,
    addLayer,
    layerFromBackground,
    backgroundFromLayer,
    layerVia,
    mergeDown,
    mergeLayers,
    mergeVisible,
    deleteHiddenLayers,
    selectAllLayers,
    deselectLayers,
    newGroup,
    groupLayers,
    ungroupLayers,
    toggleClippingMask,
    arrangeLayer,
    reverseLayers,
    alignLayers,
    distributeLayers,
    lockLayersDialog,
    activeLayer,
    lockLayers,
    openLayerStyle,
    copyLayerStyle,
    applyLayerStyleTo,
    toggleAllEffects,
    newAdjustmentLayer,
    newFillLayer,
    convertToSmartObject,
    convertSmartToLayers,
    rasterizeSmartObject,
    rasterizeTypeLayer,
    rasterizeShapeLayer,
    combineShapes,
    addVectorMask,
    deleteVectorMask,
    toggleVectorMask,
    rasterizeVectorMask,
    rasterizeLayers,
    defineCustomShapeFromPath,
    openWarpText,
    setTypeAntialias,
    setTypeOrientation,
    pasteLoremIpsum,
    convertTypeToParagraph,
    convertTypeToPoint,
    addLayerMask,
    maskFromTransparency,
    toggleLayerMask,
    removeLayerMask,
    selectAll,
    deselect,
    reselect,
    invertSelection,
    modifySelection,
    growSelection,
    colorRangeDialog,
    startTransformSelection,
    toggleQuickMask,
    selectionChannelDialog,
    togglePanel,
    zoomIn: zoomActions['zoom-in'],
    zoomOut: zoomActions['zoom-out'],
    zoomReset,
    setView,
    fitOnScreen,
    areaSize,
    fitLayersOnScreen,
    zoomViewCentered,
    updateTransform,
    refreshMenus: () => refreshMenus?.(),
    setScreenMode,
    toggleRulers,
    updateExtras,
    guideDialogs,
    guidesView,
    setGuides
  });
  // Leaving the browser's full screen (Esc) drops back to Standard Screen Mode.
  document.addEventListener('fullscreenchange', () => {
    if (!document.fullscreenElement && state.screenMode === 'fullScreen') {
      setScreenMode('standard');
    }
  });
  const menuBar = document.getElementById('menu-bar');
  if (menuBar) refreshMenus = buildMenuBar(menuBar, COMMANDS, { state, ctx: commandCtx });
  initMenuBar();

  // Filename modal
  document.getElementById('filename-ok')?.addEventListener('click', confirmFilenameModal);
  document.getElementById('filename-cancel')?.addEventListener('click', closeFilenameModal);
  document.getElementById('filename-input')?.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      confirmFilenameModal();
    }
    if (e.key === 'Escape') {
      e.preventDefault();
      closeFilenameModal();
    }
  });

  // Resize modal
  document.getElementById('resize-ok')?.addEventListener('click', () =>
    confirmResizeUI((W, H) => {
      commitSelection();
      pushUndo('Resize');
      resizeStack(W, H);
      scheduleAutosave(state, W, H);
    })
  );
  document.getElementById('resize-cancel')?.addEventListener('click', closeResizeModal);

  document
    .getElementById('btn-history-source')
    ?.addEventListener('click', () => snapshotHistorySource(activeLayer()));
  // PhotoCraft's toolbar Quick Mask button (square-dashed), under the color chips.
  const quickMaskBtn = document.getElementById('btn-quick-mask');
  if (quickMaskBtn) {
    quickMaskBtn.appendChild(iconSvg('square-dashed'));
    quickMaskBtn.addEventListener('click', toggleQuickMask);
  }
  document.getElementById('rotate-ok')?.addEventListener('click', confirmRotateModal);
  document.getElementById('rotate-cancel')?.addEventListener('click', closeRotateModal);
  document.getElementById('rotate-modal')?.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      confirmRotateModal();
    }
    if (e.key === 'Escape') {
      e.preventDefault();
      closeRotateModal();
    }
  });

  document.getElementById('adjust-ok')?.addEventListener('click', commitAdjust);
  document.getElementById('adjust-cancel')?.addEventListener('click', cancelAdjust);

  // File input change — triggered by "Open from Computer" in file menu
  uploadInput?.addEventListener('change', (e) => {
    if (e.target.files[0]) {
      loadAnyFile(e.target.files[0]);
      e.target.value = '';
    }
  });

  placeInput?.addEventListener('change', (e) => {
    const file = e.target.files[0];
    e.target.value = '';
    if (file) placeEmbeddedFile(file);
  });

  fillStrokeDialogs = initFillStrokeDialogs({
    foreground: () => state.color,
    onFill: fillLayer,
    onStroke: strokeSelection
  });
  shortcutsDialog = initShortcutsDialog(document, COMMANDS);
  imageSizeDialog = initImageSizeDialog({ size: () => [canvasW(), canvasH()], onOk: imageSize });
  trimDialog = initTrimDialog({ onOk: trim });
  const galleryHost = document.querySelector('.canvas-column') ?? document.body;
  blurGalleryPanel = initBlurGalleryPanel(galleryHost, {
    onChange: (key, value) => {
      if (state.blurGallery && setGalleryField(state.blurGallery.g, key, value)) {
        renderBlurGallery();
      }
    },
    onOk: () => endBlurGallery(true),
    onCancel: () => endBlurGallery(false)
  });
  liquifyPanel = initLiquifyPanel(galleryHost, {
    onTool: (tool) => {
      liquifyOptions.tool = tool;
      liquifyPanel.sync(liquifyOptions);
    },
    onOption: (key, value) => {
      const f = LIQUIFY_FIELDS.find((x) => x.key === key);
      liquifyOptions[key] = f ? Math.min(f.max, Math.max(f.min, value)) : value;
      drawLiquifyOverlay();
    },
    onReconstruct: () => liquifyGlobal((f) => reconstructAll(f, liquifyOptions.amount)),
    onRestoreAll: () => liquifyGlobal(restoreAll),
    onMask: (how) => liquifyGlobal((f) => setFreezeAll(f, how)),
    onOk: () => endLiquify(true),
    onCancel: () => endLiquify(false)
  });
  fadeDialog = initFadeDialog({
    onPreview: previewFade,
    onOk: endFade,
    onCancel: () => endFade(null)
  });
  channelOptionsDialog = initChannelOptionsDialog({
    channels: () => state.channels,
    onApply: (i, options) => {
      if (!state.channels[i]) return;
      pushUndo('Channel Options');
      state.channels = setChannelOptions(state.channels, i, options);
      renderChannels();
      syncChannelView();
    }
  });
  selectionChannelDialog = initSelectionChannelDialog({
    channels: () => state.channels,
    onSave: saveSelectionChannel,
    onLoad: loadSelectionChannel
  });
  colorRangeDialog = initColorRangeDialog({
    image: () => state.sampleVisible(canvasW(), canvasH()),
    foreground: () => state.color,
    onOk: colorRangeSelect
  });
  measurementScaleDialog = initMeasurementScaleDialog({ onOk: setMeasurementScale });
  guidesView = initGuides({
    state,
    W: canvasW,
    H: canvasH,
    toView,
    viewToClient,
    commit: ({ guides, label }) => setGuides(guides, label)
  });
  guideDialogs = initGuideDialogs({
    state,
    W: canvasW,
    H: canvasH,
    onNewGuide: (vertical, pos) => setGuides(addGuide(state.guides, vertical, pos), 'New Guide'),
    onLayout: (guides) => setGuides(guides, 'New Guide Layout'),
    onGrid: (grid) => updateExtras((s) => (s.grid = grid))
  });
  extrasView = initExtras({
    state,
    layerBounds: () => {
      const l = activeLayer();
      if (!l?.ctx) return null;
      return alphaBounds(l.ctx.getImageData(0, 0, canvasW(), canvasH()).data, canvasW(), canvasH());
    }
  });
  state.beginSnap = beginSnap;
  state.retargetSnap = retargetSnap;
  state.onSnapLines = (lines) => extrasView.renderSmart(lines);
  state.onCanvasHover = (x, y) => {
    extrasView.hover(x, y);
    docPanels.hover(x, y);
  };
  document
    .getElementById('canvas-area')
    .addEventListener('scroll', () => guidesView.renderRulers());
  window.addEventListener('resize', () => guidesView.renderRulers());
  guidesView.render();
  newLayerDialog = initNewLayerDialog();
  lockLayersDialog = initLockLayersDialog();
  rasterizePrompt = initRasterizePrompt();
  customShapeDialog = initCustomShapeDialog();
  renderShapes();
  warpTextDialog = initWarpTextDialog();
  layerStyleDialog = initLayerStyleDialog({
    // A new Pattern Overlay takes Edit › Define Pattern's tile, or the Pattern Stamp's stand-in.
    pattern: () => state.pattern ?? standInPattern(),
    swatches
  });
  fillLayerDialog = initFillLayerDialog({ swatches });
  indexedColorDialog = initIndexedColorDialog({ onOk: indexedColor });
  bitmapDialog = initBitmapDialog({ onOk: bitmapMode });
  colorTableDialog = initColorTableDialog({ onOk: setColorTable });

  // File Info modal
  document.getElementById('file-info-ok')?.addEventListener('click', confirmFileInfo);
  document.getElementById('file-info-cancel')?.addEventListener('click', closeFileInfo);
  document.getElementById('file-info-modal')?.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') closeFileInfo();
  });

  // Drag-drop onto canvas
  const area = document.getElementById('canvas-area');
  area.addEventListener('dragover', (e) => e.preventDefault());
  area.addEventListener('drop', (e) => {
    e.preventDefault();
    const file = e.dataTransfer.files[0];
    if (file) loadAnyFile(file);
  });

  // Text input
  const textInput = document.getElementById('text-input');
  textInput?.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') {
      cancelTextInput();
      e.preventDefault();
    }
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      pointer.commitTextInput();
    }
  });
  // A click elsewhere commits, except on the options bar's cancel, which throws the edit away.
  textInput?.addEventListener('blur', (e) => {
    if (/** @type {HTMLElement | null} */ (e.relatedTarget)?.id === 'opt-_typeCancel') return;
    pointer.commitTextInput();
  });

  // Right dock tabs, and the Brushes Size that drives the active tool's size
  initDock();
  initTooltips();
  propertiesPanel = initPropertiesPanel({
    activeLayer,
    size: () => [canvasW(), canvasH()],
    pushUndo,
    undoTop: () => state.undoStack.at(-1),
    swatches,
    onAdjustmentEdit: syncCompositeView,
    onMaskEdit(layer) {
      syncLayerMask(layer);
      syncCompositeView();
    },
    newAdjustmentLayer
  });
  typePanels = initTypePanels({
    families: TOOL_OPTION_SCHEMA.text.find((f) => f.key === 'family').options,
    read: typePanelRecord,
    onChange: setTypeFields
  });
  docPanels = initDocPanels({
    state,
    W: canvasW,
    H: canvasH,
    areaRect() {
      const area = document.getElementById('canvas-area');
      return {
        x: area.scrollLeft - stackEl.offsetLeft,
        y: area.scrollTop - stackEl.offsetTop,
        w: area.clientWidth,
        h: area.clientHeight
      };
    },
    showView(v) {
      applyView(state, v);
      updateTransform();
    },
    composite: () =>
      flattenToCanvas(state.layers, null, canvasW(), canvasH(), { transparentBg: true }),
    activeImage() {
      const l = activeLayer();
      return l?.ctx ? l.ctx.getImageData(0, 0, canvasW(), canvasH()) : null;
    }
  });
  docPanels.refresh();
  syncDockBrushSize = bindDockBrushSize(state, (size) => {
    const field = (TOOL_OPTION_SCHEMA[state.tool] || []).find((f) => f.key === 'size');
    const opts = state.toolOptions[state.tool];
    if (!field || !opts) return;
    opts.size = state.brushSize = Math.max(field.min, Math.min(field.max, size));
    syncDockBrushSize();
    refreshToolOptions();
  });

  brushPanel = initBrushPanel(state, {
    onBrushChange() {
      syncDockBrushSize();
      refreshToolOptions();
      extrasView.render();
    },
    selectTool: (id) => TOOLS[id] && setActiveTool(id),
    toolLabel: (id) => TOOLS[id]?.label ?? id
  });

  presetPanels = initPresetPanels(state, {
    colors: swatches,
    onGradientChange: refreshToolOptions,
    applyStyle: applyStyleToSelection
  });
  state.onCloneSourceChange = () => presetPanels.renderCloneSource();

  // Layer panel init
  refreshLayerPanelUI();
  renderHistoryPanel();

  // Keyboard shortcuts
  document.addEventListener('keydown', (e) => {
    const tag = document.activeElement.tagName;
    const inInput =
      tag === 'INPUT' ||
      tag === 'TEXTAREA' ||
      tag === 'SELECT' ||
      !!document.activeElement?.isContentEditable;

    // While typing in an input, only Escape is handled specially — leave
    // Ctrl+Z/A/C/V to the browser for text editing.
    if (inInput) {
      if (e.key === 'Escape' && cancelTextInput()) e.preventDefault();
      return;
    }

    if (state.liquify && liquifyKey(e)) {
      e.preventDefault();
      return;
    }
    if (state.blurGallery) {
      if (e.key === 'Enter' || e.key === 'Escape') {
        e.preventDefault();
        endBlurGallery(e.key === 'Enter');
        return;
      }
      if (e.key === 'Delete' || e.key === 'Backspace') {
        e.preventDefault();
        if (removeSelectedPin(state.blurGallery.g)) {
          blurGalleryPanel.sync(state.blurGallery.g);
          renderBlurGallery();
        }
        return;
      }
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'z') {
        e.preventDefault();
        endBlurGallery(false);
        return;
      }
    }
    if (state.freeTransform) {
      if (e.key === 'Enter' || e.key === 'Escape') {
        e.preventDefault();
        endFreeTransform(e.key === 'Enter');
        return;
      }
      // Undo while transforming cancels the transform.
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'z') {
        e.preventDefault();
        endFreeTransform(false);
        return;
      }
    }
    if (state.tool === 'crop' && state.cropFrame && (e.key === 'Enter' || e.key === 'Escape')) {
      e.preventDefault();
      const armed = state.cropStraighten;
      if (e.key === 'Enter') commitCropFrame();
      else cancelCropFrame();
      if (armed) refreshToolOptions();
      return;
    }

    if (
      state.tool === 'perspectiveCrop' &&
      (state.perspectiveQuad || state.perspectiveClicks?.length) &&
      (e.key === 'Enter' || e.key === 'Escape')
    ) {
      e.preventDefault();
      if (e.key === 'Enter') commitPerspectiveCrop();
      else TOOLS.perspectiveCrop.cancel(ov, state);
      return;
    }

    if (state.tool === 'magneticLasso' && state.drawing) {
      if (e.key === 'Enter' || e.key === 'Escape' || e.key === 'Backspace' || e.key === 'Delete') {
        e.preventDefault();
        if (e.key === 'Enter') TOOLS.magneticLasso.close(activeCtx(), ov, state);
        else if (e.key === 'Escape') TOOLS.magneticLasso.cancel(ov, state);
        else TOOLS.magneticLasso.removeAnchor(ov, state);
        return;
      }
    }

    const penKey = e.key === 'Enter' || e.key === 'Escape';
    if (PEN_SUBPATH_TOOLS.has(state.tool) && state.drawing && penKey) {
      e.preventDefault();
      endPenSubpath();
      return;
    }

    if (state.tool === 'polyLasso' && state.drawing) {
      if (e.key === 'Enter') {
        e.preventDefault();
        TOOLS.polyLasso.close(activeCtx(), ov, state);
        return;
      }
      if (e.key === 'Escape') {
        e.preventDefault();
        TOOLS.polyLasso.cancel(ov, state);
        return;
      }
    }

    // Menu shortcuts resolve through COMMANDS. Paste (Cmd+V) is left to the `paste` event so
    // OS image clipboard data is available.
    const cmd = commandForKey(e);
    if (cmd && cmd.id !== 'edit.paste') {
      e.preventDefault();
      if (cmd.enabled(state)) cmd.run(commandCtx);
      return;
    }

    if (e.key === 'Escape') {
      // Cancel text edit without saving if textarea open
      if (cancelTextInput()) {
        e.preventDefault();
        return;
      }
      // Rotate View: Esc puts the view back upright (rotate_view.rs).
      if (state.tool === 'rotateView' && state.viewRotation) {
        e.preventDefault();
        state.viewRotation = 0;
        updateTransform();
        return;
      }
      commitSelection();
      deselectObject();
      setActiveTool('select');
      return;
    }
    // PhotoCraft fill keys: Alt+Backspace fills with the foreground, Cmd/Ctrl+Backspace with the
    // background; adding Shift keeps transparency (shortcut_dispatch.rs edit.fillForeground…).
    if (e.key === 'Backspace' && (e.altKey || e.ctrlKey || e.metaKey) && activeLayer()) {
      e.preventDefault();
      const background = e.ctrlKey || e.metaKey;
      fillLayer({
        contents: background ? 'background' : 'foreground',
        preserveTransparency: e.shiftKey
      });
      return;
    }
    if (e.key === 'Delete' || e.key === 'Backspace') {
      e.preventDefault();
      if (deleteSelectedObject()) return;
      deleteSelection(activeCtx());
      return;
    }

    // Space mid-draw repositions the crop frame instead of panning (crop_ui.rs set_space).
    if (e.code === 'Space' && state.tool === 'crop' && state.cropDrag?.hit === 'draw') {
      e.preventDefault();
      TOOLS.crop.setSpace(ov, state, true);
      return;
    }
    if (e.code === 'Space' && !state.spaceDown) {
      state.spaceDown = true;
      overlayCanvas.style.cursor = 'grab';
      e.preventDefault();
      return;
    }

    // PhotoCraft's single-key D / X (no modifier); Ctrl/Cmd-D and -X are handled above.
    if (!e.ctrlKey && !e.metaKey && !e.altKey) {
      const key = e.key.toLowerCase();
      // Crop (crop_size.rs keys, swap): I is Front Image, X swaps W and H in W x H mode.
      if (state.tool === 'crop' && !state.cropDrag) {
        const wxh = state.toolOptions.crop?.ratio === CROP_WXH;
        if (key === 'i' || (key === 'x' && wxh)) {
          e.preventDefault();
          if (key === 'i') TOOLS.crop.choose(ov, state, CROP_FRONT);
          else TOOLS.crop.swap(ov, state);
          refreshToolOptions();
          return;
        }
        // crop_shield.rs keys: H toggles Show Cropped Area while a frame shows.
        if (key === 'h' && !e.shiftKey && state.cropFrame) {
          e.preventDefault();
          TOOLS.crop.toggleCroppedArea(ov, state);
          refreshToolOptions();
          return;
        }
        // crop_overlay.rs keys: O cycles the overlay, Shift+O its orientation.
        if (key === 'o') {
          e.preventDefault();
          if (e.shiftKey) TOOLS.crop.cycleOrientation(ov, state);
          else TOOLS.crop.cycleOverlay(ov, state);
          refreshToolOptions();
          return;
        }
      }
      // F cycles View › Screen Mode.
      if (key === 'f' && !e.shiftKey && !state.drawing) {
        e.preventDefault();
        setScreenMode(nextScreenMode(state.screenMode));
        return;
      }
      if (key === 'd' || key === 'x') {
        e.preventDefault();
        setColors(key === 'd' ? defaultColors() : swapColors(state.color, state.bgColor));
        return;
      }
      // PhotoCraft's `/` toggles Lock Transparent Pixels (extra_cmds.rs toggle_lock_transparency).
      if (e.key === '/' && !state.drawing) {
        e.preventDefault();
        toggleLockTransparency();
        return;
      }
    }

    // PhotoCraft tool keys: a letter picks its slot's tool, Shift+letter cycles the group.
    const toolButtons = document.getElementById('tool-buttons');
    const toolId =
      e.key === 'Escape'
        ? 'select'
        : !e.ctrlKey && !e.metaKey && !e.altKey && e.key.length === 1
        ? toolForKey(e.key, e.shiftKey, state.tool, (g) => slotTool(toolButtons, g))
        : null;
    if (toolId) {
      pointer.commitTextInput();
      if (
        state.sel.mode !== 'none' &&
        ![
          'rectSelect',
          'ellipseSelect',
          'singleRowMarquee',
          'singleColumnMarquee',
          'lasso',
          'polyLasso',
          'magneticLasso',
          'quickSelection',
          'magicWand',
          'patch',
          'horizontalTypeMask',
          'verticalTypeMask',
          'pen',
          'freeformPen',
          'curvaturePen',
          'addAnchorPoint',
          'deleteAnchorPoint',
          'convertPoint',
          'pathSelection',
          'directSelection',
          'crop',
          'hand',
          'rotateView',
          'zoom',
          'select'
        ].includes(toolId)
      )
        commitSelection();
      setActiveTool(toolId);
      return;
    }

    if ((e.key === '+' || e.key === '=') && !e.ctrlKey) {
      const a = document.getElementById('canvas-area'),
        r = a.getBoundingClientRect();
      zoomToward(r.left + r.width / 2, r.top + r.height / 2, 1.25);
    }
    if (e.key === '-' && !e.ctrlKey) {
      const a = document.getElementById('canvas-area'),
        r = a.getBoundingClientRect();
      zoomToward(r.left + r.width / 2, r.top + r.height / 2, 1 / 1.25);
    }
    if (e.key === '0' && !e.ctrlKey) {
      state.zoom = 1;
      state.panX = 0;
      state.panY = 0;
      updateTransform();
    }
  });

  document.addEventListener('keyup', (e) => {
    if (e.code === 'Space' && state.tool === 'crop' && state.cropSpace) {
      TOOLS.crop.setSpace(ov, state, false);
      return;
    }
    if (e.code === 'Space' && state.spaceDown) {
      state.spaceDown = false;
      if (!state.panning) {
        overlayCanvas.style.cursor = TOOLS[state.tool]?.cursor ?? 'crosshair';
      }
    }
  });

  updateUndoButtons();
  initPanelResize();
  initCanvasResizeHandle();

  // OS + in-app paste (must use the paste event so clipboardData images are available)
  document.addEventListener('paste', (e) => {
    const tag = document.activeElement?.tagName;
    const inInput =
      tag === 'INPUT' ||
      tag === 'TEXTAREA' ||
      tag === 'SELECT' ||
      document.activeElement?.isContentEditable;
    if (inInput) return;

    const items = e.clipboardData?.items;
    if (items) {
      for (const item of items) {
        if (item.type?.startsWith('image/')) {
          const file = item.getAsFile();
          if (file) {
            e.preventDefault();
            void pasteImageFile(file);
            return;
          }
        }
      }
    }
    if (state.clipboard) {
      e.preventDefault();
      pasteClipboard(activeCtx());
    }
  });
  startSelectionAnimation(state, ov);
  updateTransform();

  installOSBridge({
    state,
    getDims: () => ({ w: canvasW(), h: canvasH() }),
    activeCtx,
    pushUndo,
    refreshLayerPanel: refreshLayerPanelUI,
    closeFileMenu,
    loadProjectData
  });

  maybeOfferRestore();
}

function maybeOfferRestore() {
  const auto = readAutosave();
  if (!auto?.data) return;
  // Only offer if the autosaved project differs from a fresh empty canvas
  // (more than just the initial single blank layer).
  const layerCount = auto.data.layers?.length ?? 0;
  if (layerCount === 0) return;
  const ageMin = Math.round((Date.now() - (auto.savedAt ?? 0)) / 60000);
  const ageStr =
    ageMin < 1
      ? 'less than a minute ago'
      : ageMin === 1
      ? '1 minute ago'
      : ageMin < 60
      ? `${ageMin} minutes ago`
      : `${Math.round(ageMin / 60)} hour(s) ago`;
  confirmDialog.openConfirm(
    `Restore your previous Paint session from ${ageStr}?`,
    () => {
      loadProjectData(auto.data).catch((err) =>
        confirmDialog.openAlert('Restore failed: ' + err.message)
      );
    },
    () => clearAutosave()
  );
}

document.addEventListener('DOMContentLoaded', init);
