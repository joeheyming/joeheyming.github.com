// Paint — File menu, filename modal, resize modal, and download helpers.

import { flattenToCanvas } from './layers.js';
import { serializeProject, downloadProject } from './project.js';

export function toggleFileMenu() {
  const list = document.getElementById('file-menu-list');
  const btn = document.getElementById('btn-file');
  if (!list) return;
  const willOpen = list.classList.contains('hidden');
  list.classList.toggle('hidden', !willOpen);
  btn?.setAttribute('aria-expanded', String(willOpen));
}

export function closeFileMenu() {
  document.getElementById('file-menu-list')?.classList.add('hidden');
  document.getElementById('btn-file')?.setAttribute('aria-expanded', 'false');
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

export function downloadPNG(filename, state, w, h) {
  const flat = flattenToCanvas(state.layers, state.bgColor, w, h, { transparentBg: true });
  const link = document.createElement('a');
  link.download = filename;
  link.href = flat.toDataURL('image/png');
  link.click();
}

export function downloadJPEG(filename, state, w, h) {
  const flat = flattenToCanvas(state.layers, state.bgColor, w, h);
  const link = document.createElement('a');
  link.download = filename;
  link.href = flat.toDataURL('image/jpeg', 0.92);
  link.click();
}

export function downloadProjectFile(filename, state, w, h) {
  const data = serializeProject(state, w, h);
  downloadProject(data, filename);
}
