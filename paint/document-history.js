// Document History Module — capture / step / push policy behind a ports Seam.
// paint.js is the Adapter: it supplies remount, side-effect hooks, and session commits.

import { isStackUndoLabel, snapshotStack } from './stack-history.js';

export const MAX_UNDO = 50;

/**
 * One undo entry from the document slice: stack snapshot or single-layer pixels, plus
 * channels / paths / guides / objects / quick mask / doc mode.
 *
 * @param {object} doc
 * @param {{ label: string, stack?: boolean, layerId?: number|null,
 *   snapshotStack: Function, layerSnapshot: Function, cloneObjects: Function }} opts
 * @returns {object|null}
 */
export function captureHistoryEntry(doc, opts) {
  const {
    label,
    stack = false,
    layerId = null,
    snapshotStack: snapStack,
    layerSnapshot,
    cloneObjects
  } = opts;
  const entry = {
    label,
    docMode: doc.docMode,
    colorTable: doc.colorTable,
    objects: cloneObjects(doc.objects),
    selectedObjectIds: doc.selectedObjectIds.slice(),
    selectedObjectId: doc.selectedObjectId,
    // Channel / path / guide lists are never mutated in place, so the array is the snapshot.
    channels: doc.channels,
    paths: doc.paths,
    guides: doc.guides,
    quickMask: doc.quickMask ? doc.quickMask.levels.slice() : null
  };
  if (stack) {
    entry.stack = snapStack(doc.layers, doc.activeLayerIdx);
    return entry;
  }
  const target = doc.layers.find((l) => l.id === layerId);
  return target ? { ...entry, layerId, ...layerSnapshot(target) } : null;
}

/**
 * Pop `from`, push a fresh capture of the live doc onto `to`, restore `entry` via ports.
 * @returns {boolean}
 */
export function stepHistoryStacks(from, to, doc, ports) {
  const entry = from.pop();
  const back = captureHistoryEntry(doc, {
    label: entry.label,
    stack: !!entry.stack,
    layerId: entry.layerId,
    snapshotStack: ports.snapshotStack,
    layerSnapshot: ports.layerSnapshot,
    cloneObjects: ports.cloneObjects
  });
  if (!back) return false;
  to.push(back);
  applyHistoryEntry(doc, entry, ports);
  return true;
}

/**
 * Restore one history entry onto `doc` through ports (DOM remount, panel refresh hooks).
 */
export function applyHistoryEntry(doc, entry, ports) {
  if (entry.stack) ports.remountStack(entry.stack);
  else {
    const layer = doc.layers.find((l) => l.id === entry.layerId);
    if (layer) ports.restoreLayerSnapshot(layer, entry);
  }
  const tableChanged = (entry.colorTable ?? null) !== doc.colorTable;
  doc.colorTable = entry.colorTable ?? null;
  if (entry.docMode && (entry.docMode !== doc.docMode || tableChanged)) {
    ports.applyDocMode(entry.docMode);
  }
  if (entry.channels) {
    doc.channels = entry.channels;
    ports.onChannelsRestored?.();
  }
  if (entry.paths) {
    doc.paths = entry.paths;
    ports.onPathsRestored?.();
  }
  if (entry.guides) {
    doc.guides = entry.guides;
    ports.onGuidesRestored?.();
  }
  if (entry.quickMask) ports.onQuickMaskRestored?.(entry.quickMask);
  if (entry.objects) {
    doc.objects = entry.objects;
    ports.onObjectsRestored?.(
      entry.selectedObjectIds || (entry.selectedObjectId != null ? [entry.selectedObjectId] : [])
    );
  }
}

/**
 * History controller: owns push / undo / redo / jump policy. Ports supply document access
 * and the Adapter-side session / UI hooks.
 *
 * @param {object} ports
 * @param {() => object} ports.getDoc
 * @param {() => number|null} ports.activeLayerId
 * @param {() => void} [ports.commitOpenSessions]
 * @param {Function} ports.layerSnapshot
 * @param {Function} ports.restoreLayerSnapshot
 * @param {Function} ports.remountStack
 * @param {Function} ports.cloneObjects
 * @param {Function} [ports.snapshotStack]
 * @param {(label: string) => boolean} [ports.isStackUndoLabel]
 * @param {(mode: string) => void} ports.applyDocMode
 * @param {() => void} [ports.onChannelsRestored]
 * @param {() => void} [ports.onPathsRestored]
 * @param {() => void} [ports.onGuidesRestored]
 * @param {(levels: Uint8Array) => void} [ports.onQuickMaskRestored]
 * @param {(ids: number[]) => void} [ports.onObjectsRestored]
 * @param {(label: string) => void} [ports.noteFadeStep]
 * @param {() => void} [ports.onPushed]
 * @param {() => void} [ports.onStepped]
 * @param {() => boolean} [ports.beforeUndo] — true = handled (skip stack undo)
 * @param {() => boolean} [ports.beforeRedo]
 * @param {number} [ports.maxUndo]
 */
export function createHistoryController(ports) {
  const maxUndo = ports.maxUndo ?? MAX_UNDO;
  const snap = ports.snapshotStack ?? snapshotStack;
  const isStack = ports.isStackUndoLabel ?? isStackUndoLabel;

  const entryPorts = () => ({
    snapshotStack: snap,
    layerSnapshot: ports.layerSnapshot,
    restoreLayerSnapshot: ports.restoreLayerSnapshot,
    remountStack: ports.remountStack,
    cloneObjects: ports.cloneObjects,
    applyDocMode: ports.applyDocMode,
    onChannelsRestored: ports.onChannelsRestored,
    onPathsRestored: ports.onPathsRestored,
    onGuidesRestored: ports.onGuidesRestored,
    onQuickMaskRestored: ports.onQuickMaskRestored,
    onObjectsRestored: ports.onObjectsRestored
  });

  function captureEntry(label, stack, layerId) {
    return captureHistoryEntry(ports.getDoc(), {
      label,
      stack,
      layerId,
      snapshotStack: snap,
      layerSnapshot: ports.layerSnapshot,
      cloneObjects: ports.cloneObjects
    });
  }

  function stepHistory(from, to) {
    return stepHistoryStacks(from, to, ports.getDoc(), entryPorts());
  }

  function pushUndo(label = 'Draw', stack = isStack(label)) {
    ports.commitOpenSessions?.();
    const doc = ports.getDoc();
    const entry = captureEntry(label, stack, ports.activeLayerId());
    if (!entry) return;
    doc.undoStack.push(entry);
    if (doc.undoStack.length > maxUndo) doc.undoStack.shift();
    ports.noteFadeStep?.(label);
    doc.redoStack = [];
    ports.onPushed?.();
  }

  function undo() {
    if (ports.beforeUndo?.()) return;
    const doc = ports.getDoc();
    if (!doc.undoStack.length) return;
    if (!stepHistory(doc.undoStack, doc.redoStack)) {
      ports.onStepped?.();
      return;
    }
    ports.onStepped?.();
  }

  function redo() {
    if (ports.beforeRedo?.()) return;
    const doc = ports.getDoc();
    if (!doc.redoStack.length) return;
    if (!stepHistory(doc.redoStack, doc.undoStack)) {
      ports.onStepped?.();
      return;
    }
    ports.onStepped?.();
  }

  function jumpUndo(steps) {
    const doc = ports.getDoc();
    for (let i = 0; i < steps && doc.undoStack.length; i++) {
      stepHistory(doc.undoStack, doc.redoStack);
    }
    ports.onStepped?.();
  }

  function jumpRedo(steps) {
    const doc = ports.getDoc();
    for (let i = 0; i < steps && doc.redoStack.length; i++) {
      stepHistory(doc.redoStack, doc.undoStack);
    }
    ports.onStepped?.();
  }

  return { pushUndo, undo, redo, jumpUndo, jumpRedo, stepHistory, captureEntry };
}
