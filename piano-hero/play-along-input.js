// Play-along input adapter — sibling of /play/shared/input.js.
//
// /play/shared/input.js routes QWERTY keydowns straight to synth.noteOn,
// which is the wrong shape for a rhythm game (the player is hitting the
// timing target, not free-playing the synth). This adapter does both:
//
//   - Always plays the note + lights up the matching on-screen key, so
//     the user gets free-play feedback in every mode (Watch, Paused,
//     Play-along — same UX as the /play/piano page).
//   - In play-along + playing only, also forwards `(midi, songTime)` to
//     the engine's judgment system for scoring.
//
// Sources:
//   1. Computer keyboard — uses `keyboard.midiForKbd(rawKey)`, the same
//      method the free-play /play/piano page uses. That ties QWERTY to
//      the visible keyboard's `startMidi`: pressing `z` always lights up
//      and plays the leftmost visible key, which is what users expect
//      from a Synthesia-style mapping.
//   2. Web MIDI — reuses /play/shared/midi.js so plug-in keyboards work
//      out of the box and the MIDI status pill lights up consistently.

import { setupMidi } from '/play/shared/midi.js';
import clock from './clock.js';
import gameState from './game-state.js';
import { PianoSynth } from '/play/shared/piano-synth.js';

/**
 * Wire computer-keyboard + Web MIDI to a judgment callback.
 *
 * @param {Object} args
 * @param {(midi: number, songTime: number) => void} args.onPress
 * @param {HTMLElement} [args.midiStatusEl]   For the MIDI status pill.
 * @param {PianoSynth} [args.synth]           Optional synth — if provided,
 *        every press plays the note (free-play feedback in every mode).
 *        When omitted, presses are silent.
 * @param {{ pressVisual: (midi:number, on:boolean) => void,
 *           midiForKbd: (rawKey:string) => number|null,
 *           clearActiveVisuals?: () => void }} args.keyboard
 *        Required Keyboard from /play/shared/keyboard.js. Drives both
 *        the QWERTY → MIDI translation (so the lowest QWERTY note maps
 *        to the leftmost visible key) and the on-screen `.active`
 *        highlight on every press.
 */
export function attachPlayAlongInput({ onPress, midiStatusEl, synth, keyboard }) {
  // event.key -> midi (so keyup releases the right note even if the
  // user shifts their fingers between keydown and keyup).
  const heldKeys = new Map();
  // midi -> count of active sources (QWERTY + Web MIDI may both fire
  // the same midi simultaneously; we only release visual/audio when the
  // last source lets go).
  const heldMidis = new Map();

  const press = (midi) => {
    if (synth) synth.noteOn(midi);
    if (keyboard) keyboard.pressVisual(midi, true);
    if (gameState.mode === 'play-along' && gameState.status === 'playing') {
      onPress(midi, clock.now());
    }
  };

  const release = (midi) => {
    if (synth) synth.noteOff(midi);
    if (keyboard) keyboard.pressVisual(midi, false);
  };

  // ---------- Computer keyboard --------------------------------------

  document.addEventListener('keydown', (event) => {
    if (event.repeat) return;
    const target = event.target;
    const isFormField =
      target instanceof HTMLElement &&
      ['INPUT', 'TEXTAREA', 'SELECT'].includes(target.tagName);
    if (isFormField) return;

    const midi = keyboard.midiForKbd(event.key);
    if (midi == null) return;
    if (heldKeys.has(event.key)) return;
    heldKeys.set(event.key, midi);
    const prev = heldMidis.get(midi) || 0;
    heldMidis.set(midi, prev + 1);
    // Only fire press once — if the same midi is already held by another
    // source (e.g. Web MIDI), we just bump the refcount and skip the
    // duplicate noteOn / visual.
    if (prev === 0) press(midi);
    event.preventDefault();
  });

  document.addEventListener('keyup', (event) => {
    const midi = heldKeys.get(event.key);
    if (midi == null) return;
    heldKeys.delete(event.key);
    const count = (heldMidis.get(midi) || 1) - 1;
    if (count <= 0) {
      heldMidis.delete(midi);
      release(midi);
    } else {
      heldMidis.set(midi, count);
    }
  });

  window.addEventListener('blur', () => {
    heldKeys.clear();
    for (const midi of heldMidis.keys()) {
      if (synth) synth.noteOff(midi);
    }
    heldMidis.clear();
    if (keyboard && keyboard.clearActiveVisuals) keyboard.clearActiveVisuals();
  });

  // ---------- Web MIDI ----------------------------------------------

  setupMidi({
    statusEl: midiStatusEl,
    onNoteOn: (midi /* , velocity */) => {
      const prev = heldMidis.get(midi) || 0;
      heldMidis.set(midi, prev + 1);
      if (prev === 0) press(midi);
    },
    onNoteOff: (midi) => {
      const count = (heldMidis.get(midi) || 1) - 1;
      if (count <= 0) {
        heldMidis.delete(midi);
        release(midi);
      } else {
        heldMidis.set(midi, count);
      }
    }
  });
}
