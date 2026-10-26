// Paint — File › Save, Save As…, Save a Copy…, Revert, and Close (PhotoCraft file commands).
//
// A .paintproj download stands in for PhotoCraft's native file. The document keeps
//   state.fileName      the name Save writes to (null until the first save or a project open),
//   state.dirty         set by pushUndo, cleared by Save / Save As / Revert / open / close,
//   state.fileSnapshot  the last opened or saved project, in memory, for Revert (or null).
// paint.js supplies the side effects so tests can drive this module with stubs.

export const PROJECT_EXT = '.paintproj';

/** The download name for a document name: 'Untitled-1' → 'Untitled-1.paintproj'. */
export function projectFileName(name) {
  const base = String(name || '').trim() || 'Untitled-1';
  return base.toLowerCase().endsWith(PROJECT_EXT) ? base : base + PROJECT_EXT;
}

/** The document name for a file name: 'photo.paintproj' → 'photo'. */
export function docNameFromFile(fileName) {
  const name = String(fileName || '');
  return name.toLowerCase().endsWith(PROJECT_EXT) ? name.slice(0, -PROJECT_EXT.length) : name;
}

/** PhotoCraft's window title puts '*' in front of a dirty document's title. */
export function dirtyTitle(title, dirty) {
  return dirty ? `*${title}` : title;
}

/**
 * @param {object} io
 * @param {any} io.state
 * @param {() => any} io.serialize            the project data to download
 * @param {(data: any, fileName: string) => void} io.download
 * @param {(suggested: string, onConfirm: (name: string) => void) => void} io.askName
 * @param {() => any} io.takeSnapshot          in-memory copy of the document for Revert
 * @param {(snapshot: any) => void} io.restoreSnapshot
 * @param {(label: string) => void} io.pushUndo
 * @param {(message: string, onOk: () => void) => void} io.confirm  in-app confirm (not window.confirm)
 * @param {() => void} io.resetDocument       swap in a new blank document
 * @param {() => void} [io.onChange]          name or dirty flag changed
 */
export function createFileDocument(io) {
  const { state } = io;
  const changed = () => io.onChange?.();

  function setClean() {
    state.dirty = false;
    state.fileSnapshot = io.takeSnapshot();
    changed();
  }

  function writeTo(fileName) {
    state.fileName = projectFileName(fileName);
    state.docName = docNameFromFile(state.fileName);
    io.download(io.serialize(), state.fileName);
    setClean();
  }

  return {
    markDirty() {
      if (state.dirty) return;
      state.dirty = true;
      changed();
    },

    /** A project file was opened (fileName) or a session restored (null): it is the Revert point. */
    opened(fileName = null) {
      state.fileName = fileName ? projectFileName(fileName) : null;
      setClean();
    },

    /** A new blank document: no file, nothing to revert to. */
    reset() {
      state.fileName = null;
      state.dirty = false;
      state.fileSnapshot = null;
      changed();
    },

    save() {
      if (!state.fileName) {
        this.saveAs();
        return;
      }
      writeTo(state.fileName);
    },

    saveAs() {
      io.askName(projectFileName(state.fileName || state.docName), (name) => writeTo(name));
    },

    /** Downloads the document under another name; the name and the dirty flag stay. */
    saveACopy() {
      const base = docNameFromFile(state.fileName || projectFileName(state.docName));
      io.askName(projectFileName(`${base} copy`), (name) =>
        io.download(io.serialize(), projectFileName(name))
      );
    },

    canRevert() {
      return state.fileSnapshot != null;
    },

    revert() {
      if (!state.fileSnapshot) return;
      io.pushUndo('Revert');
      io.restoreSnapshot(state.fileSnapshot);
      state.dirty = false;
      changed();
    },

    close() {
      const finish = () => {
        io.resetDocument();
        this.reset();
      };
      if (!state.dirty) {
        finish();
        return true;
      }
      io.confirm(`Close “${state.docName}”? Unsaved changes will be lost.`, finish);
      return false;
    }
  };
}
