/**
 * diff.js — Side-by-side diff editor between any two open paths. Uses
 * Monaco's built-in diff editor.
 */

import { detectLanguage } from './editor.js';

export class DiffView {
  constructor(container, host) {
    this.container = container;
    this.host = host;
    this.diffEditor = null;
  }

  ensure() {
    if (this.diffEditor) return this.diffEditor;
    this.diffEditor = this.host.monaco.editor.createDiffEditor(this.container, {
      readOnly: false,
      automaticLayout: true,
      enableSplitViewResizing: true,
      renderSideBySide: true,
      theme: this.host.themeName,
      minimap: { enabled: false }
    });
    return this.diffEditor;
  }

  show(leftPath, rightPath) {
    const leftEntry = this.host.models.get(leftPath);
    const rightEntry = this.host.models.get(rightPath);
    if (!leftEntry || !rightEntry) return;
    const editor = this.ensure();

    // Diff editor needs distinct models — clone using `inmemory:` URIs in a
    // diff-only namespace so we don't fight with the main editor.
    const monaco = this.host.monaco;
    const safe = (p) => p.replace(/[^a-zA-Z0-9_.\-/]/g, '_');
    const leftUri = monaco.Uri.parse('inmemory:/__diff/L/' + safe(leftPath));
    const rightUri = monaco.Uri.parse('inmemory:/__diff/R/' + safe(rightPath));

    const cur = editor.getModel() || {};
    if (cur.original && !cur.original.isDisposed()) cur.original.dispose();
    if (cur.modified && !cur.modified.isDisposed()) cur.modified.dispose();

    const lang = detectLanguage(rightPath);
    editor.setModel({
      original: monaco.editor.createModel(leftEntry.model.getValue(), lang, leftUri),
      modified: monaco.editor.createModel(rightEntry.model.getValue(), lang, rightUri)
    });
  }

  dispose() {
    if (!this.diffEditor) return;
    const cur = this.diffEditor.getModel() || {};
    if (cur.original && !cur.original.isDisposed()) cur.original.dispose();
    if (cur.modified && !cur.modified.isDisposed()) cur.modified.dispose();
    this.diffEditor.dispose();
    this.diffEditor = null;
  }
}
