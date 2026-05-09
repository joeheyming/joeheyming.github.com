/**
 * Renders the chromatic-step vertical grid + horizontal volume thirds
 * inside the theremin pad. Re-call on root/range change.
 */
import { midiToName, NOTE_NAMES } from '../shared/audio.js';
import { getMidiRange } from './scale.js';

export const renderGrid = (gridEl, { root, range }) => {
  gridEl.innerHTML = '';
  const { startMidi, endMidi } = getMidiRange({ root, range });
  const span = endMidi - startMidi;

  // Vertical lines at every chromatic step. Highlight the root and any C.
  for (let m = startMidi; m <= endMidi; m++) {
    const xNorm = (m - startMidi) / span;
    const line = document.createElement('div');
    line.className = 'theremin-grid-line vertical';
    if (m % 12 === root) line.classList.add('is-root');
    else if (m % 12 === 0) line.classList.add('is-c');
    line.style.left = `${(xNorm * 100).toFixed(3)}%`;
    gridEl.appendChild(line);

    // Label only at root or octave boundaries — labelling every semitone
    // is unreadable, especially on phones.
    const isRoot = m % 12 === root;
    const isC = m % 12 === 0;
    if (isRoot || (isC && range <= 4)) {
      const label = document.createElement('div');
      label.className = 'theremin-grid-label';
      if (isRoot) label.classList.add('is-root');
      label.textContent = isRoot ? `${NOTE_NAMES[root]}${Math.floor(m / 12) - 1}` : midiToName(m);
      label.style.left = `${(xNorm * 100).toFixed(3)}%`;
      // Edge labels would normally bleed off the pad with the default
      // -50% centring transform — pin them to their respective edges
      // so the leftmost C is left-aligned and the rightmost C is
      // right-aligned.
      if (m === startMidi) label.classList.add('is-edge-left');
      else if (m === endMidi) label.classList.add('is-edge-right');
      gridEl.appendChild(label);
    }
  }

  // Horizontal lines at quarter intervals — visual anchors for volume.
  for (let i = 1; i < 4; i++) {
    const line = document.createElement('div');
    line.className = 'theremin-grid-line horizontal';
    line.style.top = `${(i * 25).toFixed(0)}%`;
    gridEl.appendChild(line);
  }
};
