/**
 * Snapshot-based undo/redo for the score model.
 */
export function createHistory(limit = 100) {
  const undoStack = [];
  const redoStack = [];

  return {
    /** Push current snapshot before a mutation. */
    push(snapshot) {
      undoStack.push(snapshot);
      if (undoStack.length > limit) undoStack.shift();
      redoStack.length = 0;
    },
    canUndo() {
      return undoStack.length > 0;
    },
    canRedo() {
      return redoStack.length > 0;
    },
    /**
     * @param {object} current - snapshot of state before undo
     * @returns {object|null} previous snapshot
     */
    undo(current) {
      if (!undoStack.length) return null;
      redoStack.push(current);
      return undoStack.pop();
    },
    redo(current) {
      if (!redoStack.length) return null;
      undoStack.push(current);
      return redoStack.pop();
    },
    clear() {
      undoStack.length = 0;
      redoStack.length = 0;
    }
  };
}
