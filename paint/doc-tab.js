// Document tab (PhotoCraft's tab title): "<name> @ <zoom>% (RGB/8)", with "*" while dirty.
// A Grayscale document reads "(Gray/8)"; in Quick Mask it reads "(Quick Mask/8)".

import { docModeTag } from './image-mode.js';

export const DEFAULT_DOC_NAME = 'Untitled-1';

export function docTabText(name, zoom, dirty = false, mode = 'rgb', quickMask = false) {
  const tag = quickMask ? 'Quick Mask/8' : docModeTag(mode);
  return `${name || DEFAULT_DOC_NAME} @ ${Math.round(zoom * 100)}% (${tag})${dirty ? '*' : ''}`;
}

export function updateDocTab(state, el = document.getElementById('doc-tab-title')) {
  if (el) el.textContent = docTabText(
      state.docName,
      state.zoom,
      state.dirty,
      state.docMode,
      !!state.quickMask
    );
}
