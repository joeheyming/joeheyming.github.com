// File loader — wires drag-and-drop and the hidden <input type="file">
// button to the MidiManager singleton. The drop overlay is a single
// fixed-position element appended to <body> so it works regardless of
// what the user is dragging over.
//
// MIDI MIME types (`audio/midi`, `audio/x-midi`) are unreliable across
// platforms (Chrome on macOS often reports an empty type for .mid),
// so we filter primarily on the `.mid` / `.midi` extension. MIME is a
// secondary signal.

import midiManager from './midi-manager.js';

const ACCEPTED_EXTENSIONS = ['.mid', '.midi'];
const ACCEPTED_MIME = new Set(['audio/midi', 'audio/x-midi', 'audio/sp-midi']);

/**
 * Decide whether a File / DataTransferItem looks like a MIDI we should
 * try to parse. Extension wins; MIME is a fallback for picker entries
 * where the OS happened to populate it.
 */
function looksLikeMidi(name, type) {
  if (typeof name === 'string') {
    const lower = name.toLowerCase();
    for (const ext of ACCEPTED_EXTENSIONS) {
      if (lower.endsWith(ext)) return true;
    }
  }
  if (typeof type === 'string' && ACCEPTED_MIME.has(type.toLowerCase())) return true;
  return false;
}

/** True if a DragEvent's dataTransfer plausibly contains files. */
function isFileDrag(ev) {
  const dt = ev.dataTransfer;
  if (!dt) return false;
  if (dt.types) {
    for (const t of dt.types) {
      if (t === 'Files' || t === 'application/x-moz-file') return true;
    }
  }
  return false;
}

/**
 * Pull the first MIDI-looking File out of a FileList.
 * @param {FileList | File[] | null | undefined} files
 * @returns {File | null}
 */
function firstMidiFile(files) {
  if (!files) return null;
  for (let i = 0; i < files.length; i++) {
    const f = files[i];
    if (looksLikeMidi(f.name, f.type)) return f;
  }
  return null;
}

/** Build the fixed-position drop-target overlay if it's not already there. */
function ensureOverlay() {
  let overlay = document.querySelector('.piano-hero-drop-overlay');
  if (overlay) return overlay;
  overlay = document.createElement('div');
  overlay.className = 'piano-hero-drop-overlay';
  overlay.setAttribute('aria-hidden', 'true');
  overlay.innerHTML = `
    <div class="drop-card">
      <div class="drop-icon">🎼</div>
      <div class="drop-title">Drop MIDI to play</div>
      <div class="drop-sub">.mid / .midi files</div>
    </div>
  `;
  document.body.appendChild(overlay);
  return overlay;
}

/**
 * Attach drag-drop listeners to the page. Idempotent — calling twice
 * leaves the original listeners in place.
 *
 * @param {{ onError?: (message: string) => void }} [opts]
 */
export function attachDropTarget(opts = {}) {
  if (window._pianoHeroDropAttached) return;
  window._pianoHeroDropAttached = true;
  ensureOverlay();

  const onError = (msg) => {
    if (typeof opts.onError === 'function') opts.onError(msg);
    else console.warn('[piano-hero]', msg);
  };

  let dragDepth = 0;

  const handleDragEnter = (ev) => {
    if (!isFileDrag(ev)) return;
    ev.preventDefault();
    dragDepth += 1;
    document.body.classList.add('dragging');
  };

  const handleDragOver = (ev) => {
    if (!isFileDrag(ev)) return;
    ev.preventDefault();
    if (ev.dataTransfer) ev.dataTransfer.dropEffect = 'copy';
  };

  const handleDragLeave = (ev) => {
    if (!isFileDrag(ev)) return;
    ev.preventDefault();
    dragDepth = Math.max(0, dragDepth - 1);
    if (dragDepth === 0) document.body.classList.remove('dragging');
  };

  const handleDrop = async (ev) => {
    if (!isFileDrag(ev)) return;
    ev.preventDefault();
    dragDepth = 0;
    document.body.classList.remove('dragging');

    const files = ev.dataTransfer ? ev.dataTransfer.files : null;
    if (!files || files.length === 0) {
      onError('No file received from drop');
      return;
    }
    const midiFile = firstMidiFile(files);
    if (!midiFile) {
      onError('That file does not look like a MIDI (.mid / .midi)');
      return;
    }
    try {
      await midiManager.loadFromFile(midiFile);
    } catch (err) {
      onError(err && err.message ? err.message : 'Failed to load MIDI');
    }
  };

  // window-level so a drop anywhere on the page works, including over
  // the keyboard or score panel.
  window.addEventListener('dragenter', handleDragEnter);
  window.addEventListener('dragover', handleDragOver);
  window.addEventListener('dragleave', handleDragLeave);
  window.addEventListener('drop', handleDrop);
}

/**
 * Wire up the hidden <input type="file"> picker. Calling code should
 * trigger `.click()` on the input from a user-gesture handler.
 *
 * @param {HTMLInputElement} inputEl
 * @param {{ onError?: (message: string) => void }} [opts]
 */
export function attachFilePicker(inputEl, opts = {}) {
  if (!inputEl) return;
  const onError = (msg) => {
    if (typeof opts.onError === 'function') opts.onError(msg);
    else console.warn('[piano-hero]', msg);
  };

  inputEl.addEventListener('change', async () => {
    const file = firstMidiFile(inputEl.files);
    // Reset so picking the same file twice still fires `change`.
    inputEl.value = '';
    if (!file) {
      onError('Pick a .mid or .midi file');
      return;
    }
    try {
      await midiManager.loadFromFile(file);
    } catch (err) {
      onError(err && err.message ? err.message : 'Failed to load MIDI');
    }
  });
}

/**
 * Programmatically open the file picker. Call from a user-gesture handler.
 * @param {HTMLInputElement} inputEl
 */
export function openFilePicker(inputEl) {
  if (inputEl) inputEl.click();
}
