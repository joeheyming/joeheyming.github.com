// Paint — File menu, filename modal, resize modal, and download helpers.

import { flattenToCanvas } from './layers.js';
import { drawObjectsOnto } from './objects.js';
import { closeMenus } from './menu-bar.js';
import { fileInfoTextEntries, insertPngText } from './file-extras.js';

function exportFlattenOpts(state, transparentBg) {
  return {
    transparentBg,
    objects: state.objects,
    drawObjects: drawObjectsOnto
  };
}

export function closeFileMenu() {
  closeMenus();
}

let filenameModalCallback = /** @type {((name: string) => void) | null} */ (null);

export function openFilenameModal(suggested, onConfirm) {
  const modal = document.getElementById('filename-modal');
  const input = /** @type {HTMLInputElement} */ (document.getElementById('filename-input'));
  input.value = suggested;
  filenameModalCallback = onConfirm;
  modal?.classList.remove('hidden');
  setTimeout(() => {
    input.focus();
    const dot = suggested.lastIndexOf('.');
    input.setSelectionRange(0, dot > 0 ? dot : suggested.length);
  }, 50);
}

export function confirmFilenameModal() {
  const filename = /** @type {HTMLInputElement} */ (
    document.getElementById('filename-input')
  ).value.trim();
  if (!filename) return;
  const cb = filenameModalCallback;
  closeFilenameModal();
  cb?.(filename);
}

export function closeFilenameModal() {
  document.getElementById('filename-modal')?.classList.add('hidden');
  filenameModalCallback = null;
}

export function openResizeModal(currentW, currentH) {
  const modal = document.getElementById('resize-modal');
  /** @type {HTMLInputElement} */ (document.getElementById('resize-w')).value = String(currentW);
  /** @type {HTMLInputElement} */ (document.getElementById('resize-h')).value = String(currentH);
  modal?.classList.remove('hidden');
}

export function closeResizeModal() {
  document.getElementById('resize-modal')?.classList.add('hidden');
}

/** @param {(W: number, H: number) => void} onApply */
export function confirmResize(onApply) {
  const W = parseInt(
    /** @type {HTMLInputElement} */ (document.getElementById('resize-w')).value,
    10
  );
  const H = parseInt(
    /** @type {HTMLInputElement} */ (document.getElementById('resize-h')).value,
    10
  );
  if (!W || !H || W < 1 || H < 1 || W > 8000 || H > 8000) return;
  onApply(W, H);
  closeResizeModal();
}

/** A canvas as PNG bytes with the document's File Info written as tEXt chunks. */
export async function canvasPngBlob(canvas, fileInfo) {
  const blob = await new Promise((resolve) => canvas.toBlob(resolve, 'image/png'));
  const entries = fileInfoTextEntries(fileInfo);
  if (!blob || !entries.length) return blob;
  const bytes = insertPngText(new Uint8Array(await blob.arrayBuffer()), entries);
  return new Blob([bytes], { type: 'image/png' });
}

export function downloadBlob(blob, filename) {
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.download = filename;
  link.href = url;
  link.click();
  setTimeout(() => URL.revokeObjectURL(url), 5000);
}

export async function downloadPNG(filename, state, w, h) {
  const flat = flattenToCanvas(state.layers, state.bgColor, w, h, exportFlattenOpts(state, true));
  const blob = await canvasPngBlob(flat, state.fileInfo);
  if (blob) downloadBlob(blob, filename);
  window.heymingAchievements?.unlockForCurrentApp('canvas-exported');
}

/**
 * Export › Layers to Files: one PNG per visible pixel layer, on a transparent canvas with its
 * own opacity, blend mode, and mask. files is layersToFilesList(state.layers, docName).
 */
export async function downloadLayerFiles(files, state, w, h) {
  for (const { layerIdx, fileName } of files) {
    const layer = state.layers[layerIdx];
    const flat = flattenToCanvas([layer], state.bgColor, w, h, { transparentBg: true });
    const blob = await canvasPngBlob(flat, state.fileInfo);
    if (blob) downloadBlob(blob, fileName);
  }
}

/** The visible composite on transparency, objects included (Edit › Copy Merged). */
export function mergedCanvas(state, w, h) {
  return flattenToCanvas(state.layers, state.bgColor, w, h, exportFlattenOpts(state, true));
}

/** Flatten layers to a PNG Blob (same path as downloadPNG). */
export function exportPNGBlob(state, w, h) {
  const flat = flattenToCanvas(state.layers, state.bgColor, w, h, exportFlattenOpts(state, true));
  return new Promise((resolve) => {
    flat.toBlob((blob) => resolve(blob), 'image/png');
  });
}

export function downloadJPEG(filename, state, w, h) {
  const flat = flattenToCanvas(state.layers, state.bgColor, w, h, exportFlattenOpts(state, false));
  const link = document.createElement('a');
  link.download = filename;
  link.href = flat.toDataURL('image/jpeg', 0.92);
  link.click();
}
