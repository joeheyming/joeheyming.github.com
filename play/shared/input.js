/**
 * Shared keyboard-instrument input handler.
 *
 * Wires up:
 *   - QWERTY → notes via the Keyboard's `midiForKbd`
 *   - ←/→ and [/] for octave shift
 *   - Tab + Enter/Space on focused keys to play accessibly
 *   - Space (without focused key) toggles sustain
 *   - Window blur clears stuck notes
 *   - Window focus resumes a suspended AudioContext
 */
import { resumeIfSuspended } from './audio.js';

export function attachKeyboardInput({
  keyboard,
  synth,
  sustainEl,
  announceNote,
  shiftOctave,
}) {
  const heldKeys = new Map();
  const focusHeld = new Set();

  const focusedKeyMidi = () => {
    const el = document.activeElement;
    if (!el || !el.classList || !el.classList.contains('piano-key')) return null;
    return Number(el.dataset.midi);
  };

  const playNote = (midi) => {
    keyboard.pressVisual(midi, true);
    synth.noteOn(midi);
    announceNote(midi);
  };

  const releaseNote = (midi) => {
    keyboard.pressVisual(midi, false);
    if (!sustainEl?.checked) synth.noteOff(midi);
    else keyboard.addToSustain(midi);
  };

  document.addEventListener('keydown', (event) => {
    if (event.repeat) return;
    const target = event.target;
    const isFormField =
      target instanceof HTMLElement &&
      ['INPUT', 'TEXTAREA', 'SELECT'].includes(target.tagName);
    if (isFormField && target.type !== 'checkbox' && target.type !== 'range') return;

    if (event.key === 'Enter') {
      const midi = focusedKeyMidi();
      if (midi != null && !focusHeld.has(midi)) {
        focusHeld.add(midi);
        playNote(midi);
        event.preventDefault();
        return;
      }
    }

    if (event.key === 'ArrowLeft' || event.key === '[') {
      shiftOctave?.(-1);
      event.preventDefault();
      return;
    }
    if (event.key === 'ArrowRight' || event.key === ']') {
      shiftOctave?.(+1);
      event.preventDefault();
      return;
    }
    if (event.code === 'Space') {
      const midi = focusedKeyMidi();
      if (midi != null && !focusHeld.has(midi)) {
        focusHeld.add(midi);
        playNote(midi);
        event.preventDefault();
        return;
      }
      if (sustainEl && !sustainEl.checked) {
        sustainEl.checked = true;
        keyboard.setSustain(true);
      }
      event.preventDefault();
      return;
    }

    const midi = keyboard.midiForKbd(event.key);
    if (midi == null) return;
    if (heldKeys.has(event.key)) return;
    heldKeys.set(event.key, midi);
    playNote(midi);
    event.preventDefault();
  });

  document.addEventListener('keyup', (event) => {
    if (event.key === 'Enter' || event.code === 'Space') {
      const midi = focusedKeyMidi();
      if (midi != null && focusHeld.has(midi)) {
        focusHeld.delete(midi);
        releaseNote(midi);
        if (event.code === 'Space') return;
      }
    }
    if (event.code === 'Space') {
      if (sustainEl) {
        sustainEl.checked = false;
        keyboard.setSustain(false);
      }
      return;
    }
    const midi = heldKeys.get(event.key);
    if (midi == null) return;
    heldKeys.delete(event.key);
    releaseNote(midi);
  });

  window.addEventListener('blur', () => {
    heldKeys.clear();
    focusHeld.clear();
    synth.allOff();
    keyboard.clearActiveVisuals();
  });

  window.addEventListener('focus', () => {
    resumeIfSuspended();
  });
}
