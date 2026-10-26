// History panel footer — Delete current state and Create new snapshot (history_cmds.rs)

/**
 * Delete the current state: step back once past it and drop every redo state after it
 * (delete_state). Null when only the opened state is left.
 */
export function deleteStatePlan(undoCount, redoCount) {
  if (!(undoCount > 0)) return null;
  return { undoSteps: 1, clearRedo: true, dropped: 1 + (redoCount > 0 ? redoCount : 0) };
}

/** The next free `Snapshot N` name, counting from 1 and skipping names in use. */
export function nextSnapshotName(snapshots = []) {
  const used = new Set(snapshots.map((s) => s.name));
  let n = 1;
  while (used.has(`Snapshot ${n}`)) n++;
  return `Snapshot ${n}`;
}

/**
 * Runs the delete-state plan on `history` ({ undoStack, redoStack }): step(from, to) moves one
 * entry across (paint.js stepHistory). False when only the opened state is left.
 */
export function deleteCurrentState(history, step) {
  const plan = deleteStatePlan(history.undoStack.length, history.redoStack.length);
  if (!plan) return false;
  for (let i = 0; i < plan.undoSteps && history.undoStack.length; i++) {
    step(history.undoStack, history.redoStack);
  }
  if (plan.clearRedo) history.redoStack = [];
  return true;
}

/** A new list with `Snapshot N` of `stack` appended; the old list is left alone. */
export function addSnapshot(snapshots, stack) {
  return [...snapshots, { name: nextSnapshotName(snapshots), stack }];
}

/**
 * Restores snapshot `i`: pushUndo(name, true) records a whole-stack state first, then
 * remount(stack) rebuilds the layers. False when there is no such snapshot.
 */
export function restoreSnapshot(snapshots, i, { pushUndo, remount }) {
  const snap = snapshots[i];
  if (!snap) return false;
  pushUndo(snap.name, true);
  remount(snap.stack);
  return true;
}
