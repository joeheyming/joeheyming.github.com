// Paint — the command table (PhotoCraft crates/engine/src/commands.rs: everything is a command).
//
// Each command is { id, label, menu, shortcut, enabled(state), run(ctx) }. ids, labels, menu
// paths, and default shortcuts come from PhotoCraft's catalog (paint/menu-catalog.js); a
// command only names what differs. Paint-only commands that have no catalog id give their own
// label and menu and sit `after` a catalog id. The menu bar (paint/menu-bar.js buildMenuBar)
// and the Ctrl/Cmd keyboard handler in paint.js (commandForKey) both read this table.
//
// run(ctx) gets the app's actions object from paint.js; enabled(state) and checked(state) get
// the app state. `attrs` keeps the DOM ids and data attributes older code and tests look for.

import { CATALOG } from './menu-catalog.js';
import { TOOLS } from './tools.js';
import { canMergeDown } from './layers.js';
import { isAdjustmentLayer } from './adjustment-layers.js';
import { FILL_LAYER_TYPES, isFillLayer } from './fill-layers.js';
import { isSmartLayer } from './smart-objects.js';
import { TYPE_ANTIALIAS, TYPE_ORIENTATIONS, isTypeLayer } from './type-layers.js';
import { isShapeLayer } from './shapes.js';
import { targetPath } from './paths.js';
import { COMBINE_SHAPE_OPS } from './combine-shapes.js';
import { canRasterize } from './rasterize.js';
import { isBackgroundLayer } from './layer-new.js';
import { allLayerIds, stateLayerSelection } from './layer-multi.js';
import { isGroupLayer, topLevelIds } from './layer-groups.js';
import { ALIGN_KINDS, DISTRIBUTE_KINDS } from './layer-arrange.js';
import { canClip, clipKeyReleases } from './layer-locks.js';
import { EFFECT_KINDS, canHaveStyle, hasLayerStyle } from './layer-style.js';
import { ADJUSTMENTS } from './adjustments.js';
import { GALLERY_KINDS } from './blur-gallery.js';
import { canFade, lastFilterLabel } from './fade.js';
import { hasGuides } from './guides.js';
import { DOCK_PANELS, DOCK_SECTIONS, panelShown } from './window-panels.js';
import {
  DEFAULT_SHOW,
  DEFAULT_SNAP_TO,
  SHOW_KEYS,
  SNAP_TO_KEYS,
  showAll,
  snapToAll,
  toggleExtras,
  togglePixelArtPreview,
  toggleShow,
  toggleSnap,
  toggleSnapTo
} from './snap.js';

// A few ids appear twice (Keyboard Shortcuts… is in Edit and Window › Workspace); the first row
// is the command's home.
const CATALOG_BY_ID = new Map();
for (const r of CATALOG) if (r[3] !== '---' && !CATALOG_BY_ID.has(r[3])) CATALOG_BY_ID.set(r[3], r);

const always = () => true;

/**
 * @param {string} id
 * @param {(ctx: any) => void} run
 * @param {object} [opts]
 */
function command(id, run, opts = {}) {
  const row = CATALOG_BY_ID.get(id);
  if (!row && !opts.menu) throw new Error(`command ${id} is not in the catalog and has no menu`);
  return {
    id,
    label: opts.label ?? row[1],
    menu: opts.menu ?? row[0].split(' > '),
    shortcut: opts.shortcut !== undefined ? opts.shortcut : row?.[2] ?? null,
    aliases: opts.aliases ?? [],
    after: opts.after ?? null,
    attrs: opts.attrs ?? {},
    enabled: opts.enabled ?? always,
    checked: opts.checked ?? null,
    labelFor: opts.labelFor ?? null,
    radio: opts.radio ?? false,
    run
  };
}

function activeLayer(state) {
  return state.layers?.[state.activeLayerIdx] ?? null;
}

// Crop frame history greys Undo / Redo out on its own stacks (crop_ui.rs is_enabled).
function historyEnabled(state, which) {
  const crop = state.tool === 'crop' ? TOOLS.crop.historyEnabled(state, which) : null;
  if (crop !== null) return crop;
  return (which === 'redo' ? state.redoStack : state.undoStack)?.length > 0;
}

// Toggle Last State is refused while a crop frame or Free Transform owns history.
function toggleLastStateEnabled(state) {
  if (state.freeTransform) return false;
  if (state.tool === 'crop' && TOOLS.crop.historyEnabled(state, 'undo') !== null) return false;
  return state.undoStack?.length > 0 || state.redoStack?.length > 0;
}

// The selected layers a layer style can go on (pixel layers).
const styleTargets = (state) => {
  const ids = new Set(stateLayerSelection(state).ids);
  return (state.layers ?? []).filter((l) => ids.has(l.id) && canHaveStyle(l));
};

const hasMask = (state) => !!activeLayer(state)?.mask;
// A group has no pixels and no mask here: pixel and mask commands skip it.
const pixelTarget = (state) => {
  const layer = activeLayer(state);
  return (
    !!layer &&
    !isAdjustmentLayer(layer) &&
    !isFillLayer(layer) &&
    !isSmartLayer(layer) &&
    !isTypeLayer(layer) &&
    !isShapeLayer(layer) &&
    !isGroupLayer(layer)
  );
};
// Convert to Smart Object takes the selected top-level layers; groups and adjustment layers stay.
const convertibleToSmart = (state) => {
  const layers = state.layers ?? [];
  const ids = topLevelIds(layers, stateLayerSelection(state).ids);
  const picked = layers.filter((l) => ids.includes(l.id));
  return picked.length > 0 && !picked.some((l) => isGroupLayer(l) || isAdjustmentLayer(l));
};
const smartActive = (state) => isSmartLayer(activeLayer(state));
const typeActive = (state) => isTypeLayer(activeLayer(state));
const shapeActive = (state) => isShapeLayer(activeLayer(state));
// Define Custom Shape takes the target path, else the active shape layer's path.
const hasShapePath = (state) =>
  !!targetPath(state.paths ?? null)?.subpaths?.some((sp) => sp.anchors.length) ||
  shapeActive(state);
// Combine Shapes: two or more selected shape layers merge; one shape layer needs two components.
const canCombineShapes = (state) => {
  const layer = activeLayer(state);
  if (!isShapeLayer(layer)) return false;
  const ids = new Set(stateLayerSelection(state).ids);
  const shapes = (state.layers ?? []).filter((l) => ids.has(l.id) && isShapeLayer(l));
  return shapes.length > 1 || layer.shape.path.subpaths.length > 1;
};
// A shape layer's path is already its vector mask (vector_cmds.rs vector_mask_add).
const canAddVectorMask = (state) => {
  const layer = activeLayer(state);
  return !!layer && !layer.vectorMask && !isShapeLayer(layer) && !isGroupLayer(layer);
};
const hasVectorMask = (state) => !!activeLayer(state)?.vectorMask;
const hasTargetPath = (state) =>
  !!targetPath(state.paths ?? null)?.subpaths?.some((sp) => sp.anchors.length);
const canAddMask = (state) => !hasMask(state) && !isGroupLayer(activeLayer(state));
// An adjustment or fill layer keeps its mask; it can only be disabled.
const maskRemovable = (state) =>
  hasMask(state) && !isAdjustmentLayer(activeLayer(state)) && !isFillLayer(activeLayer(state));

// PhotoCraft catalog suffix → Paint ADJUSTMENTS id, in PhotoCraft's New Adjustment Layer order.
const ADJUSTMENT_LAYER_COMMANDS = [
  ['brightnessContrast', 'brightness'],
  ['levels', 'levels'],
  ['curves', 'curves'],
  ['exposure', 'exposure'],
  ['vibrance', 'vibrance'],
  ['hueSaturation', 'hsl'],
  ['colorBalance', 'colorBalance'],
  ['blackWhite', 'blackWhite'],
  ['photoFilter', 'photoFilter'],
  ['channelMixer', 'channelMixer'],
  ['colorLookup', 'colorLookup'],
  ['invert', 'invert'],
  ['posterize', 'posterize'],
  ['threshold', 'threshold'],
  ['gradientMap', 'gradientMap'],
  ['selectiveColor', 'selectiveColor']
];

// Image › Adjustments: the same sixteen plus Shadows/Highlights, Desaturate, Replace Color and
// Equalize. Invert, Desaturate and Equalize apply at once, the others open the adjustment
// dialog (PhotoCraft adjust_dialog has_dialog).
const IMAGE_ADJUSTMENT_COMMANDS = [
  ...ADJUSTMENT_LAYER_COMMANDS,
  ['shadowsHighlights', 'shadowsHighlights'],
  ['desaturate', 'desaturate'],
  ['replaceColor', 'replaceColor'],
  ['equalize', 'equalize']
];
const NO_DIALOG_ADJUSTMENTS = new Set(['invert', 'desaturate', 'equalize']);

const hasSelection = (state) =>
  state.sel?.mode === 'active' && state.sel.w >= 1 && state.sel.h >= 1;

// Paste Into / Outside need pixels on the clipboard and a selection to mask them to.
const canPasteInto = (state) => !!state.clipboard?.data && hasSelection(state);

// Layer › Arrange: catalog suffix → steps among the layer's siblings (commands.rs arrange). The
// Background never moves.
const ARRANGE_COMMANDS = [
  ['bringToFront', Infinity],
  ['bringForward', 1],
  ['sendBackward', -1],
  ['sendToBack', -Infinity]
];
const canArrange = (state) => {
  const layer = activeLayer(state);
  return !!layer && !isBackgroundLayer(layer);
};

// Edit › Transform's fixed turns and flips (PhotoCraft extra_cmds.rs transform_preset).
const TRANSFORM_PRESETS = [
  ['rotate180', null],
  ['rotate90Cw', null],
  ['rotate90Ccw', null],
  ['flipHorizontal', 'btn-flip-h'],
  ['flipVertical', 'btn-flip-v']
];

// The transforms move a pixel layer's pixels; an adjustment layer has none.
const canTransformLayer = pixelTarget;

// PhotoCraft Filter catalog id → Paint ADJUSTMENTS id. Each opens the adjustment dialog (or runs
// the one-shot filter); the menu bar orders them by the catalog.
const FILTER_COMMANDS = [
  ['blur.average', 'average'],
  ['blur.blur', 'blur'],
  ['blur.blurMore', 'blurMore'],
  ['blur.boxBlur', 'boxBlur'],
  ['blur.gaussianBlur', 'gaussianBlur'],
  ['blur.lensBlur', 'lensBlur'],
  ['blur.motionBlur', 'motionBlur'],
  ['blur.radialBlur', 'radialBlur'],
  ['blur.shapeBlur', 'shapeBlur'],
  ['blur.smartBlur', 'smartBlur'],
  ['blur.surfaceBlur', 'surfaceBlur'],
  ['distort.displace', 'displace'],
  ['distort.pinch', 'pinch'],
  ['distort.polarCoordinates', 'polarCoordinates'],
  ['distort.ripple', 'ripple'],
  ['distort.shear', 'shear'],
  ['distort.spherize', 'spherize'],
  ['distort.twirl', 'twirl'],
  ['distort.wave', 'wave'],
  ['distort.zigZag', 'zigZag'],
  ['noise.addNoise', 'addNoise'],
  ['noise.despeckle', 'despeckle'],
  ['noise.dustAndScratches', 'dustScratches'],
  ['noise.median', 'median'],
  ['pixelate.colorHalftone', 'colorHalftone'],
  ['pixelate.crystallize', 'crystallize'],
  ['pixelate.facet', 'facet'],
  ['pixelate.fragment', 'fragment'],
  ['pixelate.mezzotint', 'mezzotint'],
  ['pixelate.mosaic', 'pixelate'],
  ['pixelate.pointillize', 'pointillize'],
  ['render.clouds', 'clouds'],
  ['render.differenceClouds', 'differenceClouds'],
  ['render.fibers', 'fibers'],
  ['render.lensFlare', 'lensFlare'],
  ['render.lightingEffects', 'lightingEffects'],
  ['sharpen.sharpen', 'sharpen'],
  ['sharpen.sharpenEdges', 'sharpenEdges'],
  ['sharpen.sharpenMore', 'sharpenMore'],
  ['sharpen.smartSharpen', 'smartSharpen'],
  ['sharpen.unsharpMask', 'unsharpMask'],
  ['stylize.diffuse', 'diffuse'],
  ['stylize.emboss', 'emboss'],
  ['stylize.extrude', 'extrude'],
  ['stylize.findEdges', 'findEdges'],
  ['stylize.oilPaint', 'oilPaint'],
  ['stylize.solarize', 'solarize'],
  ['stylize.tiles', 'tiles'],
  ['stylize.traceContour', 'traceContour'],
  ['stylize.wind', 'wind'],
  ['video.deInterlace', 'deInterlace'],
  ['video.ntscColors', 'ntscColors'],
  ['other.custom', 'custom'],
  ['other.highPass', 'highPass'],
  ['other.hsbHsl', 'hsbHsl'],
  ['other.maximum', 'maximum'],
  ['other.minimum', 'minimum'],
  ['other.offset', 'offset']
];

export const COMMANDS = [
  // File
  command('file.new', (ctx) => ctx.newProject(), { attrs: { 'data-file': 'new' } }),
  command('file.open', (ctx) => ctx.openFile(), { attrs: { 'data-file': 'open-computer' } }),
  command('file.close', (ctx) => ctx.file.close(), { attrs: { 'data-file': 'close' } }),
  command('file.save', (ctx) => ctx.file.save(), { attrs: { 'data-file': 'save' } }),
  command('file.saveAs', (ctx) => ctx.file.saveAs(), { attrs: { 'data-file': 'save-as' } }),
  command('file.saveACopy', (ctx) => ctx.file.saveACopy(), {
    attrs: { 'data-file': 'save-a-copy' }
  }),
  command('file.revert', (ctx) => ctx.file.revert(), {
    enabled: (state) => state.fileSnapshot != null,
    attrs: { 'data-file': 'revert' }
  }),
  command('file.export.quickExportAsPng', (ctx) => ctx.exportPng(), {
    attrs: { 'data-file': 'save-png' }
  }),
  command('file.export.layersToFiles', (ctx) => ctx.exportLayersToFiles(), {
    attrs: { 'data-file': 'layers-to-files' }
  }),
  command('file.placeEmbedded', (ctx) => ctx.placeEmbedded(), {
    attrs: { 'data-file': 'place-embedded' }
  }),
  command('file.scripts.deleteAllEmptyLayers', (ctx) => ctx.deleteAllEmptyLayers(), {
    attrs: { 'data-file': 'delete-empty-layers' }
  }),
  command('file.scripts.flattenAllMasks', (ctx) => ctx.flattenAllMasks(), {
    attrs: { 'data-file': 'flatten-all-masks' }
  }),
  command('file.fileInfo', (ctx) => ctx.fileInfo(), { attrs: { 'data-file': 'file-info' } }),
  command('file.export.quickExportAsJpeg', (ctx) => ctx.exportJpeg(), {
    label: 'Quick Export as JPEG',
    menu: ['File', 'Export'],
    after: 'file.export.quickExportAsPng',
    attrs: { 'data-file': 'save-jpeg' }
  }),

  // Edit
  command('edit.undo', (ctx) => ctx.undo(), {
    shortcut: 'Cmd+Z',
    enabled: (state) => historyEnabled(state, 'undo'),
    attrs: { id: 'btn-undo' }
  }),
  command('edit.redo', (ctx) => ctx.redo(), {
    shortcut: 'Cmd+Shift+Z',
    aliases: ['Cmd+Y'],
    enabled: (state) => historyEnabled(state, 'redo'),
    attrs: { id: 'btn-redo' }
  }),
  command('edit.toggleLastState', (ctx) => ctx.toggleLastState(), {
    enabled: toggleLastStateEnabled
  }),
  command('edit.fade', (ctx) => ctx.openFade(), { enabled: canFade }),
  command('edit.cut', (ctx) => ctx.cut(), { shortcut: 'Cmd+X' }),
  command('edit.copy', (ctx) => ctx.copy(), { shortcut: 'Cmd+C' }),
  command('edit.copyMerged', (ctx) => ctx.copyMerged()),
  // Cmd+V reaches paint.js as the `paste` event (OS image data); the menu item runs ctx.paste.
  command('edit.paste', (ctx) => ctx.paste(), { shortcut: 'Cmd+V' }),
  command('edit.pasteSpecial.pasteInPlace', (ctx) => ctx.pasteInPlace(), {
    enabled: (state) => state.clipboard?.x != null
  }),
  command('edit.pasteSpecial.pasteInto', (ctx) => ctx.pasteInto(false), {
    enabled: canPasteInto
  }),
  command('edit.pasteSpecial.pasteOutside', (ctx) => ctx.pasteInto(true), {
    enabled: canPasteInto
  }),
  command('edit.clear', (ctx) => ctx.clearLayer(), { attrs: { id: 'btn-clear' } }),
  // Shift+Backspace opens Fill too (PhotoCraft shortcuts.rs); Stroke needs a selection here.
  command('edit.fill', (ctx) => ctx.openFill(), {
    aliases: ['Shift+Backspace'],
    enabled: (state) => !!activeLayer(state)
  }),
  command('edit.stroke', (ctx) => ctx.openStroke(), { enabled: hasSelection }),
  command('edit.freeTransform', (ctx) => ctx.freeTransform(), {
    attrs: { id: 'btn-free-transform' }
  }),
  command('edit.transform.again', (ctx) => ctx.transformAgain(), {
    enabled: (state) => !!state.lastTransform && canTransformLayer(state)
  }),
  command('edit.transform.scale', (ctx) => ctx.freeTransform('scale'), {
    enabled: canTransformLayer
  }),
  command('edit.transform.rotate', (ctx) => ctx.freeTransform('rotate'), {
    enabled: canTransformLayer
  }),
  // Skew / Distort / Perspective / Warp open the box in that mode (PhotoCraft TransformMode).
  ...['skew', 'distort', 'perspective', 'warp'].map((mode) =>
    command(`edit.transform.${mode}`, (ctx) => ctx.freeTransform(mode), {
      enabled: canTransformLayer
    })
  ),
  ...TRANSFORM_PRESETS.map(([suffix, id]) =>
    command(`edit.transform.${suffix}`, (ctx) => ctx.transformPreset(suffix), {
      enabled: canTransformLayer,
      attrs: id ? { id } : {}
    })
  ),
  command('edit.definePattern', (ctx) => ctx.definePattern(), {
    attrs: { id: 'btn-define-pattern' }
  }),
  // Edit › Define Custom Shape… (edit_menu_cmds.rs define_custom_shape): the path joins the
  // Shapes panel and the Custom Shape tool's list under the name given.
  command('edit.defineCustomShape', (ctx) => ctx.defineCustomShape(), {
    enabled: hasShapePath
  }),
  command('edit.keyboardShortcuts', (ctx) => ctx.openKeyboardShortcuts()),
  command('edit.preferences.guidesGridAndSlices', (ctx) => ctx.gridPreferences()),

  // Image
  // Image › Mode: Bitmap, Grayscale, Indexed Color and RGB Color are one radio group; 8
  // Bits/Channel is the only depth. Bitmap needs Grayscale; Color Table needs Indexed Color.
  command('image.mode.bitmap', (ctx) => ctx.bitmapMode(), {
    radio: true,
    checked: (state) => state.docMode === 'bitmap',
    enabled: (state) => state.docMode === 'grayscale' || state.docMode === 'bitmap'
  }),
  command('image.mode.grayscale', (ctx) => ctx.setDocMode('grayscale'), {
    radio: true,
    checked: (state) => state.docMode === 'grayscale'
  }),
  command('image.mode.indexedColor', (ctx) => ctx.indexedColor(), {
    radio: true,
    checked: (state) => state.docMode === 'indexed',
    enabled: (state) => state.docMode !== 'bitmap'
  }),
  command('image.mode.rgb', (ctx) => ctx.setDocMode('rgb'), {
    radio: true,
    checked: (state) => !['grayscale', 'indexed', 'bitmap'].includes(state.docMode)
  }),
  command('image.mode.bits8', () => {}, { radio: true, checked: always }),
  command('image.mode.colorTable', (ctx) => ctx.colorTable(), {
    enabled: (state) => state.docMode === 'indexed' && state.colorTable?.length > 0
  }),
  ...IMAGE_ADJUSTMENT_COMMANDS.map(([suffix, id]) =>
    command(
      `image.adjustments.${suffix}`,
      (ctx) => (NO_DIALOG_ADJUSTMENTS.has(id) ? ctx.applyAdjustmentNow(id) : ctx.openAdjust(id)),
      { attrs: { 'data-adjust': id } }
    )
  ),
  command('image.autoTone', (ctx) => ctx.autoLevels('tone'), { attrs: { id: 'btn-auto-tone' } }),
  command('image.autoContrast', (ctx) => ctx.autoLevels('contrast'), {
    attrs: { id: 'btn-auto-contrast' }
  }),
  command('image.autoColor', (ctx) => ctx.autoLevels('color'), {
    attrs: { id: 'btn-auto-color' }
  }),
  command('image.analysis.setMeasurementScale', (ctx) => ctx.setMeasurementScale()),
  command('image.analysis.countTool', (ctx) => ctx.selectTool('count'), {
    checked: (state) => state.tool === 'count'
  }),
  command('image.imageSize', (ctx) => ctx.imageSize(), { attrs: { id: 'btn-image-size' } }),
  command('image.canvasSize', (ctx) => ctx.canvasSize(), { attrs: { id: 'btn-resize' } }),
  command('image.imageRotation.180', (ctx) => ctx.rotateCanvas(180), {
    attrs: { id: 'btn-rotate-180' }
  }),
  command('image.imageRotation.90cw', (ctx) => ctx.rotateCanvas(90), {
    attrs: { id: 'btn-rotate-cw' }
  }),
  command('image.imageRotation.90ccw', (ctx) => ctx.rotateCanvas(-90), {
    attrs: { id: 'btn-rotate-ccw' }
  }),
  command('image.rotation.arbitrary', (ctx) => ctx.rotateArbitrary(), {
    attrs: { id: 'btn-rotate-arbitrary' }
  }),
  command('image.imageRotation.flipCanvasHorizontal', (ctx) => ctx.flipCanvas(true), {
    attrs: { id: 'btn-flip-canvas-h' }
  }),
  command('image.imageRotation.flipCanvasVertical', (ctx) => ctx.flipCanvas(false), {
    attrs: { id: 'btn-flip-canvas-v' }
  }),
  command('image.crop', (ctx) => ctx.cropToSelection(), {
    enabled: hasSelection,
    attrs: { id: 'btn-crop' }
  }),
  command('image.trim', (ctx) => ctx.trim(), { attrs: { id: 'btn-trim' } }),

  // Layer
  command('layer.new.layer', (ctx) => ctx.newLayer(), { attrs: { 'data-layer': 'new' } }),
  command('layer.new.layerFromBackground', (ctx) => ctx.layerFromBackground(), {
    enabled: (state) => isBackgroundLayer(state.layers?.[0]),
    attrs: { 'data-layer': 'from-background' }
  }),
  command('layer.new.backgroundFromLayer', (ctx) => ctx.backgroundFromLayer(), {
    enabled: (state) => !isBackgroundLayer(state.layers?.[0]) && pixelTarget(state),
    attrs: { 'data-layer': 'background-from-layer' }
  }),
  command('layer.new.group', (ctx) => ctx.newGroup(), { attrs: { 'data-layer': 'new-group' } }),
  command('layer.new.groupFromLayers', (ctx) => ctx.groupFromLayers(), {
    enabled: (state) => stateLayerSelection(state).ids.length > 0,
    attrs: { 'data-layer': 'group-from-layers' }
  }),
  command('layer.new.layerViaCopy', (ctx) => ctx.layerVia(false), {
    enabled: (state) => !!activeLayer(state) && !isGroupLayer(activeLayer(state)),
    attrs: { 'data-layer': 'via-copy' }
  }),
  command('layer.new.layerViaCut', (ctx) => ctx.layerVia(true), {
    enabled: pixelTarget,
    attrs: { 'data-layer': 'via-cut' }
  }),
  command('layer.duplicate', (ctx) => ctx.duplicateLayer(), {
    attrs: { 'data-layer': 'duplicate' }
  }),
  ...FILL_LAYER_TYPES.map(({ id, type }) =>
    command(`layer.newFillLayer.${id}`, (ctx) => ctx.newFillLayer(type), {
      attrs: { 'data-layer': `fill-${type}` }
    })
  ),
  ...ADJUSTMENT_LAYER_COMMANDS.map(([suffix, id]) =>
    command(`layer.newAdjustmentLayer.${suffix}`, (ctx) => ctx.newAdjustmentLayer(id), {
      attrs: { 'data-layer': `adjust-${id}` }
    })
  ),
  command('layer.layerMask.revealAll', (ctx) => ctx.addLayerMask('revealAll'), {
    enabled: canAddMask,
    attrs: { 'data-layer': 'mask-reveal-all' }
  }),
  command('layer.layerMask.hideAll', (ctx) => ctx.addLayerMask('hideAll'), {
    enabled: canAddMask,
    attrs: { 'data-layer': 'mask-hide-all' }
  }),
  command('layer.layerMask.revealSelection', (ctx) => ctx.addLayerMask('revealSelection'), {
    enabled: canAddMask,
    attrs: { 'data-layer': 'mask-reveal-selection' }
  }),
  command('layer.layerMask.hideSelection', (ctx) => ctx.addLayerMask('hideSelection'), {
    enabled: (state) => canAddMask(state) && hasSelection(state),
    attrs: { 'data-layer': 'mask-hide-selection' }
  }),
  command('layer.layerMask.fromTransparency', (ctx) => ctx.maskFromTransparency(), {
    enabled: (state) => canAddMask(state) && pixelTarget(state),
    attrs: { 'data-layer': 'mask-from-transparency' }
  }),
  command('layer.layerMask.delete', (ctx) => ctx.removeLayerMask(false), {
    enabled: maskRemovable,
    attrs: { 'data-layer': 'mask-delete' }
  }),
  command('layer.layerMask.apply', (ctx) => ctx.removeLayerMask(true), {
    enabled: maskRemovable,
    attrs: { 'data-layer': 'mask-apply' }
  }),
  command('layer.layerMask.enabled', (ctx) => ctx.toggleLayerMask(), {
    enabled: hasMask,
    checked: (state) => hasMask(state) && activeLayer(state).maskEnabled !== false,
    attrs: { 'data-layer': 'mask-toggle' }
  }),
  // Layer › Vector Mask (vector_cmds.rs vector_mask_add / delete / toggle): the path's
  // anti-aliased coverage hides the layer outside it.
  command('layer.vectorMask.revealAll', (ctx) => ctx.addVectorMask('revealAll'), {
    enabled: canAddVectorMask,
    attrs: { 'data-layer': 'vector-mask-reveal-all' }
  }),
  command('layer.vectorMask.hideAll', (ctx) => ctx.addVectorMask('hideAll'), {
    enabled: canAddVectorMask,
    attrs: { 'data-layer': 'vector-mask-hide-all' }
  }),
  command('layer.vectorMask.currentPath', (ctx) => ctx.addVectorMask('path'), {
    enabled: (state) => canAddVectorMask(state) && hasTargetPath(state),
    attrs: { 'data-layer': 'vector-mask-current-path' }
  }),
  command('layer.vectorMask.delete', (ctx) => ctx.deleteVectorMask(), {
    enabled: hasVectorMask,
    attrs: { 'data-layer': 'vector-mask-delete' }
  }),
  command('layer.vectorMask.enabled', (ctx) => ctx.toggleVectorMask(), {
    enabled: hasVectorMask,
    checked: (state) => hasVectorMask(state) && activeLayer(state).vectorMask.enabled !== false,
    attrs: { 'data-layer': 'vector-mask-toggle' }
  }),
  // Layer › Matting: Defringe opens its Width dialog; the mattes apply at once.
  command('layer.matting.defringe', (ctx) => ctx.openAdjust('defringe'), {
    enabled: pixelTarget,
    attrs: { 'data-layer': 'defringe' }
  }),
  command('layer.matting.removeBlackMatte', (ctx) => ctx.applyAdjustmentNow('removeBlackMatte'), {
    enabled: pixelTarget,
    attrs: { 'data-layer': 'remove-black-matte' }
  }),
  command('layer.matting.removeWhiteMatte', (ctx) => ctx.applyAdjustmentNow('removeWhiteMatte'), {
    enabled: pixelTarget,
    attrs: { 'data-layer': 'remove-white-matte' }
  }),
  // Layer › Smart Objects (smart_cmds.rs): the contents stay; the canvas renders from them.
  command('layer.smartObjects.convertToSmartObject', (ctx) => ctx.convertToSmartObject(), {
    enabled: convertibleToSmart,
    attrs: { 'data-layer': 'convert-to-smart' }
  }),
  command('layer.smartObjects.newSmartObjectViaCopy', (ctx) => ctx.newSmartObjectViaCopy(), {
    enabled: smartActive,
    attrs: { 'data-layer': 'smart-via-copy' }
  }),
  command('layer.smartObjects.convertToLayers', (ctx) => ctx.convertSmartToLayers(), {
    enabled: smartActive,
    attrs: { 'data-layer': 'smart-to-layers' }
  }),
  command('layer.smartObjects.rasterize', (ctx) => ctx.rasterizeSmartObject(), {
    enabled: smartActive,
    attrs: { 'data-layer': 'rasterize-smart' }
  }),
  // Type › Rasterize Type Layer and Layer › Rasterize › Type (enable_rules.rs): the type layer
  // becomes a pixel layer as it looks now; its text is no longer editable.
  command('type.rasterizeTypeLayer', (ctx) => ctx.rasterizeTypeLayer(), {
    enabled: typeActive,
    attrs: { 'data-type': 'rasterize' }
  }),
  // Type › Convert to Paragraph Text / Point Text (canvas_tool_menu.rs): point text gets a box
  // around its bounds; paragraph text's wrapped lines become hard breaks.
  command('type.convertToParagraphText', (ctx) => ctx.convertTypeToParagraph(), {
    enabled: (state) =>
      typeActive(state) &&
      !activeLayer(state).type.box &&
      activeLayer(state).type.orientation === 'horizontal'
  }),
  command('type.convertToPointText', (ctx) => ctx.convertTypeToPoint(), {
    enabled: (state) => typeActive(state) && !!activeLayer(state).type.box
  }),
  // Type › Warp Text… (warp_text_dialog.rs): a preset bend on the active type layer, which
  // stays editable text.
  command('type.warpText', (ctx) => ctx.openWarpText(), {
    enabled: typeActive,
    attrs: { 'data-type': 'warp-text' }
  }),
  // Type › Panels: the Character and Paragraph dock tabs, as Window › Character / Paragraph.
  ...['character', 'paragraph'].map((name) =>
    command(`type.panels.${name}`, (ctx) => ctx.togglePanel(name), {
      checked: () => panelShown(name)
    })
  ),
  // Type › Anti-Alias and Orientation (type_extra_cmds.rs): radio items on the active type layer.
  ...TYPE_ANTIALIAS.map((mode) =>
    command(`type.antiAlias.${mode}`, (ctx) => ctx.setTypeAntialias(mode), {
      radio: true,
      enabled: typeActive,
      checked: (state) => typeActive(state) && activeLayer(state).type.antialias === mode
    })
  ),
  ...TYPE_ORIENTATIONS.map((o) =>
    command(`type.orientation.${o}`, (ctx) => ctx.setTypeOrientation(o), {
      radio: true,
      enabled: typeActive,
      checked: (state) => typeActive(state) && activeLayer(state).type.orientation === o
    })
  ),
  // At the caret while typing, into the active type layer, else a new type layer.
  command('type.pasteLoremIpsum', (ctx) => ctx.pasteLoremIpsum()),
  command('layer.rasterize.type', (ctx) => ctx.rasterizeTypeLayer(), {
    enabled: typeActive,
    attrs: { 'data-layer': 'rasterize-type' }
  }),
  // Layer › Rasterize › Shape: the shape layer becomes a pixel layer as it looks now.
  command('layer.rasterize.shape', (ctx) => ctx.rasterizeShapeLayer(), {
    enabled: shapeActive,
    attrs: { 'data-layer': 'rasterize-shape' }
  }),
  // Layer › Rasterize › Vector Mask: multiplied into the pixel mask (vector_mask_rasterize).
  command('layer.rasterize.vectorMask', (ctx) => ctx.rasterizeVectorMask(), {
    enabled: hasVectorMask,
    attrs: { 'data-layer': 'rasterize-vector-mask' }
  }),
  // Layer › Rasterize › Layer / All Layers (extra_cmds.rs rasterize, rasterize_all): every
  // selected (or every) type, shape, fill, and Smart Object layer and vector mask, one step.
  command('layer.rasterize.layer', (ctx) => ctx.rasterizeLayers(false), {
    enabled: (state) => {
      const ids = new Set(stateLayerSelection(state).ids);
      return (state.layers ?? []).some((l) => ids.has(l.id) && canRasterize(l));
    },
    attrs: { 'data-layer': 'rasterize-layer' }
  }),
  command('layer.rasterize.allLayers', (ctx) => ctx.rasterizeLayers(true), {
    enabled: (state) => {
      const layers = state.layers ?? [];
      return !(layers.length === 1 && isBackgroundLayer(layers[0]));
    },
    attrs: { 'data-layer': 'rasterize-all-layers' }
  }),
  // Layer › Combine Shapes (vector_cmds.rs combine_shapes): several selected shape layers merge
  // into the top-most; one layer's components above the first take the operation.
  ...COMBINE_SHAPE_OPS.map(([suffix, op]) =>
    command(`layer.combineShapes.${suffix}`, (ctx) => ctx.combineShapes(op), {
      enabled: canCombineShapes,
      attrs: { 'data-layer': `combine-${suffix}` }
    })
  ),
  command('layer.combineShapes.mergeShapeComponents', (ctx) => ctx.combineShapes(null), {
    enabled: shapeActive,
    attrs: { 'data-layer': 'combine-merge-components' }
  }),
  // PhotoCraft's engine binds Cmd+G / Shift+Cmd+G (commands.rs, extra_cmds.rs).
  command('layer.groupLayers', (ctx) => ctx.groupLayers(), {
    shortcut: 'Cmd+G',
    enabled: (state) => stateLayerSelection(state).ids.length > 0,
    attrs: { 'data-layer': 'group-layers' }
  }),
  command('layer.ungroupLayers', (ctx) => ctx.ungroupLayers(), {
    shortcut: 'Cmd+Shift+G',
    enabled: (state) => isGroupLayer(activeLayer(state)),
    attrs: { 'data-layer': 'ungroup-layers' }
  }),
  // Photoshop's one Create / Release item: it reads Release Clipping Mask when every layer it
  // would clip already clips (menus.rs, shortcut_dispatch.rs clip_key_releases).
  command('layer.createClippingMask', (ctx) => ctx.toggleClippingMask(), {
    labelFor: (state) =>
      clipKeyReleases(state.layers ?? [], stateLayerSelection(state).ids)
        ? 'Release Clipping Mask'
        : 'Create Clipping Mask',
    enabled: (state) =>
      clipKeyReleases(state.layers ?? [], stateLayerSelection(state).ids) ||
      (state.layers ?? []).some(
        (l, i) =>
          stateLayerSelection(state).ids.includes(l.id) && canClip(state.layers ?? [], i)
      ),
    attrs: { 'data-layer': 'clipping-mask' }
  }),
  // Photoshop's Lock All Layers key; PhotoCraft's catalog leaves Lock Layers… unbound.
  command('layer.lockLayers', (ctx) => ctx.lockLayers(), {
    shortcut: 'Cmd+/',
    enabled: (state) => stateLayerSelection(state).ids.length > 0,
    attrs: { 'data-layer': 'lock-layers' }
  }),
  command('layer.layerStyle.blendingOptions', (ctx) => ctx.openLayerStyle('blendingOptions'), {
    enabled: (state) => canHaveStyle(activeLayer(state)),
    attrs: { 'data-layer-style': 'blendingOptions' }
  }),
  ...EFFECT_KINDS.map((kind) =>
    command(`layer.layerStyle.${kind}`, (ctx) => ctx.openLayerStyle(kind), {
      enabled: (state) => canHaveStyle(activeLayer(state)),
      attrs: { 'data-layer-style': kind }
    })
  ),
  command('layer.layerStyle.copyLayerStyle', (ctx) => ctx.copyLayerStyle(), {
    enabled: (state) => hasLayerStyle(activeLayer(state))
  }),
  command('layer.layerStyle.pasteLayerStyle', (ctx) => ctx.pasteLayerStyle(), {
    enabled: (state) => !!state.styleClipboard && styleTargets(state).length > 0
  }),
  command('layer.layerStyle.clear', (ctx) => ctx.clearLayerStyle(), {
    enabled: (state) => styleTargets(state).some(hasLayerStyle)
  }),
  // Photoshop's one item reads Show All Effects once every style is hidden.
  command('layer.layerStyle.hideAllEffects', (ctx) => ctx.toggleAllEffects(), {
    labelFor: (state) => {
      const styled = (state.layers ?? []).filter(hasLayerStyle);
      return styled.length && styled.every((l) => l.styles.enabled === false)
        ? 'Show All Effects'
        : 'Hide All Effects';
    },
    enabled: (state) => (state.layers ?? []).some(hasLayerStyle)
  }),
  ...ARRANGE_COMMANDS.map(([suffix, delta]) =>
    command(`layer.arrange.${suffix}`, (ctx) => ctx.arrangeLayer(delta), {
      enabled: canArrange
    })
  ),
  command('layer.arrange.reverse', (ctx) => ctx.reverseLayers(), {
    enabled: (state) => topLevelIds(state.layers ?? [], stateLayerSelection(state).ids).length >= 2
  }),
  ...ALIGN_KINDS.map((kind) =>
    command(`layer.align.${kind}`, (ctx) => ctx.alignLayers(kind), {
      enabled: (state) => stateLayerSelection(state).ids.length >= 1
    })
  ),
  ...DISTRIBUTE_KINDS.map((kind) =>
    command(`layer.distribute.${kind}`, (ctx) => ctx.distributeLayers(kind), {
      enabled: (state) => stateLayerSelection(state).ids.length >= 3
    })
  ),
  command('layer.mergeLayers', (ctx) => ctx.mergeLayers(), {
    // Several selected layers merge; one merges down (layer_multi_cmds.rs merge_layers).
    enabled: (state) =>
      stateLayerSelection(state).ids.length > 1 ||
      canMergeDown(state.layers ?? [], state.activeLayerIdx),
    attrs: { 'data-layer': 'merge-down' }
  }),
  command('layer.mergeVisible', (ctx) => ctx.mergeVisible(), {
    enabled: (state) => (state.layers ?? []).filter((l) => l.visible).length > 1,
    attrs: { 'data-layer': 'merge-visible' }
  }),
  command('layer.delete.hiddenLayers', (ctx) => ctx.deleteHiddenLayers(), {
    enabled: (state) => (state.layers ?? []).some((l) => !l.visible),
    attrs: { 'data-layer': 'delete-hidden' }
  }),

  // Select
  command('select.all', (ctx) => ctx.selectAll(), { attrs: { 'data-select': 'all' } }),
  command('select.deselect', (ctx) => ctx.deselect(), { attrs: { 'data-select': 'deselect' } }),
  command('select.reselect', (ctx) => ctx.reselect(), {
    enabled: (state) => state.lastSelMask != null,
    attrs: { 'data-select': 'reselect' }
  }),
  command('select.allLayers', (ctx) => ctx.selectAllLayers(), {
    enabled: (state) => allLayerIds(state.layers ?? []).length > 0,
    attrs: { 'data-select': 'all-layers' }
  }),
  command('select.deselectLayers', (ctx) => ctx.deselectLayers(), {
    attrs: { 'data-select': 'deselect-layers' }
  }),
  command('select.inverse', (ctx) => ctx.invertSelection(), {
    shortcut: 'Cmd+Shift+I',
    attrs: { 'data-select': 'inverse' }
  }),
  command('select.modify.border', (ctx) => ctx.modifySelection('border'), {
    enabled: hasSelection,
    attrs: { 'data-select': 'border' }
  }),
  command('select.modify.smooth', (ctx) => ctx.modifySelection('smooth'), {
    enabled: hasSelection,
    attrs: { 'data-select': 'smooth' }
  }),
  command('select.modify.expand', (ctx) => ctx.modifySelection('expand'), {
    attrs: { 'data-select': 'expand' }
  }),
  command('select.modify.contract', (ctx) => ctx.modifySelection('contract'), {
    attrs: { 'data-select': 'contract' }
  }),
  command('select.modify.feather', (ctx) => ctx.modifySelection('feather'), {
    attrs: { 'data-select': 'feather' }
  }),
  command('select.colorRange', (ctx) => ctx.colorRange(), {
    enabled: (state) => !!activeLayer(state),
    attrs: { 'data-select': 'color-range' }
  }),
  command('select.transformSelection', (ctx) => ctx.transformSelection(), {
    enabled: (state) => hasSelection(state) && !state.freeTransform,
    attrs: { 'data-select': 'transform-selection' }
  }),
  command('select.grow', (ctx) => ctx.growSelection(true), {
    enabled: hasSelection,
    attrs: { 'data-select': 'grow' }
  }),
  command('select.similar', (ctx) => ctx.growSelection(false), {
    enabled: hasSelection,
    attrs: { 'data-select': 'similar' }
  }),
  command('select.editInQuickMaskMode', (ctx) => ctx.toggleQuickMask(), {
    enabled: (state) => !state.freeTransform,
    checked: (state) => !!state.quickMask,
    attrs: { 'data-select': 'quick-mask' }
  }),
  command('select.loadSelection', (ctx) => ctx.loadSelection(), {
    enabled: (state) => !state.quickMask && (state.channels ?? []).length > 0,
    attrs: { 'data-select': 'load-selection' }
  }),
  command('select.saveSelection', (ctx) => ctx.saveSelection(), {
    enabled: (state) => !state.quickMask && hasSelection(state),
    attrs: { 'data-select': 'save-selection' }
  }),

  // Filter
  command('filter.lastFilter', (ctx) => ctx.runLastFilter(), {
    enabled: (state) => !!state.lastFilter && pixelTarget(state),
    labelFor: (state) => lastFilterLabel(state, ADJUSTMENTS)
  }),
  ...FILTER_COMMANDS.map(([suffix, id]) =>
    command(`filter.${suffix}`, (ctx) => ctx.openAdjust(id), { attrs: { 'data-filter': id } })
  ),
  ...['field', 'iris', 'tilt', 'spin'].map((kind) =>
    command(GALLERY_KINDS[kind].command, (ctx) => ctx.openBlurGallery(kind), {
      enabled: pixelTarget,
      attrs: { 'data-filter': `blurGallery-${kind}` }
    })
  ),
  command('filter.liquify', (ctx) => ctx.openLiquify(), {
    enabled: pixelTarget,
    attrs: { 'data-filter': 'liquify' }
  }),
  command('filter.render.relight', (ctx) => ctx.openAdjust('relight'), {
    label: 'Relight…',
    menu: ['Filter', 'Render'],
    after: 'filter.render.lightingEffects',
    attrs: { 'data-filter': 'relight' }
  }),

  // View
  command('view.zoomIn', (ctx) => ctx.zoomIn(), { attrs: { 'data-view': 'zoom-in' } }),
  command('view.zoomOut', (ctx) => ctx.zoomOut(), { attrs: { 'data-view': 'zoom-out' } }),
  command('view.fitOnScreen', (ctx) => ctx.fitOnScreen()),
  command('view.fitLayersOnScreen', (ctx) => ctx.fitLayersOnScreen()),
  command('view.actualPixels', (ctx) => ctx.zoomReset(), { attrs: { 'data-view': 'zoom-reset' } }),
  command('view.twoHundredPercent', (ctx) => ctx.zoomTo(2)),
  command('view.flipHorizontal', (ctx) => ctx.flipView(), { checked: (state) => !!state.viewFlip }),
  ...['standard', 'fullScreenWithMenuBar', 'fullScreen'].map((mode) =>
    command(`view.screenMode.${mode}`, (ctx) => ctx.setScreenMode(mode), {
      radio: true,
      checked: (state) => (state.screenMode ?? 'standard') === mode
    })
  ),
  command('view.show.guides', (ctx) => ctx.updateExtras((s) => toggleShow(s, 'guides')), {
    checked: (state) => state.showGuides !== false
  }),
  command('view.extras', (ctx) => ctx.updateExtras(toggleExtras), {
    checked: (state) => state.extras !== false
  }),
  ...SHOW_KEYS.map((k) =>
    command(`view.show.${k}`, (ctx) => ctx.updateExtras((s) => toggleShow(s, k)), {
      checked: (state) => !!(state.show ?? DEFAULT_SHOW)[k]
    })
  ),
  command('view.show.all', (ctx) => ctx.updateExtras(showAll)),
  command('view.snap', (ctx) => ctx.updateExtras(toggleSnap), {
    checked: (state) => state.snap !== false
  }),
  ...SNAP_TO_KEYS.map((k) =>
    command(`view.snapTo.${k}`, (ctx) => ctx.updateExtras((s) => toggleSnapTo(s, k)), {
      checked: (state) => !!(state.snapTo ?? DEFAULT_SNAP_TO)[k]
    })
  ),
  command('view.snapTo.all', (ctx) => ctx.updateExtras((s) => snapToAll(s))),
  command('view.pixelArtPreview', (ctx) => ctx.updateExtras(togglePixelArtPreview), {
    checked: (state) => !!state.pixelArtPreview
  }),
  command('view.rulers', (ctx) => ctx.toggleRulers(), { checked: (state) => !!state.showRulers }),
  command('view.lockGuides', (ctx) => ctx.toggleLockGuides(), {
    checked: (state) => !!state.guidesLocked
  }),
  command('view.clearGuides', (ctx) => ctx.clearGuides(), {
    enabled: (state) => hasGuides(state.guides)
  }),
  command('view.newGuide', (ctx) => ctx.newGuide()),
  command('view.newGuideLayout', (ctx) => ctx.newGuideLayout()),

  // Window
  ...[...DOCK_PANELS, ...Object.keys(DOCK_SECTIONS)].map((name) =>
    command(`window.panel.${name}`, (ctx) => ctx.togglePanel(name), {
      checked: () => panelShown(name),
      attrs: { 'data-window': name }
    })
  )
];

// The ADJUSTMENTS ids the Filter menu runs; their dialogs' OK records state.lastFilter.
export const FILTER_IDS = new Set([...FILTER_COMMANDS.map((r) => r[1]), 'relight']);

export const COMMANDS_BY_ID = new Map(COMMANDS.map((c) => [c.id, c]));

const MODIFIERS = ['Cmd', 'Ctrl', 'Alt', 'Shift'];

/** Canonical form of a catalog shortcut ('Shift+Cmd+z' → 'Cmd+Shift+Z'). Ctrl counts as Cmd. */
export function normalizeShortcut(shortcut) {
  const parts = shortcut.split('+');
  // A trailing '+' key (Cmd++) splits into an empty last part.
  const key = parts.pop() || '+';
  const mods = new Set(parts.filter(Boolean).map((m) => (m === 'Ctrl' ? 'Cmd' : m)));
  return [...MODIFIERS.filter((m) => mods.has(m)), key.length === 1 ? key.toUpperCase() : key].join(
    '+'
  );
}

const CODE_KEYS = {
  Equal: '=',
  Minus: '-',
  BracketLeft: '[',
  BracketRight: ']',
  Semicolon: ';',
  Quote: "'",
  Comma: ',',
  Period: '.',
  Slash: '/',
  Backslash: '\\',
  Backquote: '`'
};

/** The canonical shortcut a keydown event spells, or null for a bare modifier press. */
export function eventShortcut(e) {
  let key;
  const code = e.code ?? '';
  if (/^Key[A-Z]$/.test(code)) key = code.slice(3);
  else if (/^Digit\d$/.test(code)) key = code.slice(5);
  else if (CODE_KEYS[code]) key = CODE_KEYS[code];
  else key = e.key?.length === 1 ? e.key.toUpperCase() : e.key;
  if (!key || ['Control', 'Meta', 'Alt', 'Shift'].includes(key)) return null;
  const mods = [];
  if (e.ctrlKey || e.metaKey) mods.push('Cmd');
  if (e.altKey) mods.push('Alt');
  if (e.shiftKey) mods.push('Shift');
  return [...mods, key].join('+');
}

/** The command whose shortcut (or alias) a keydown event matches, or null. */
export function commandForKey(e, commands = COMMANDS) {
  const pressed = eventShortcut(e);
  if (!pressed) return null;
  for (const cmd of commands) {
    for (const s of [cmd.shortcut, ...cmd.aliases]) {
      if (s && normalizeShortcut(s) === pressed) return cmd;
    }
  }
  return null;
}

/** How a menu shows a shortcut: ⌘⇧Z on a Mac, Ctrl+Shift+Z elsewhere. */
export function formatShortcut(shortcut, mac) {
  const parts = normalizeShortcut(shortcut).split('+');
  const key = parts.pop();
  if (!mac) return [...parts.map((m) => (m === 'Cmd' ? 'Ctrl' : m)), key].join('+');
  const sym = { Cmd: '⌘', Alt: '⌥', Shift: '⇧' };
  // Mac menus order the symbols ⌥⇧⌘.
  return (
    ['Alt', 'Shift', 'Cmd']
      .filter((m) => parts.includes(m))
      .map((m) => sym[m])
      .join('') + key
  );
}
