/**
 * Fretboard renderer + pointer playback for the Strings page.
 *
 * Owns:
 *   - The DOM under `#fretboard` (.fretboard-grid, .fretboard-inlays,
 *     .fretboard-string rows, .fret-cell cells).
 *   - The `cellEls` map (string-fret → cell element), used by both this
 *     module (pointer dispatch) and the chord builder (highlight + barre
 *     overlay positioning).
 *   - The `chordShapeCells` set — populated by the chord builder so it
 *     can later un-highlight everything it touched; cleared here on
 *     every rebuild.
 *   - Pointer events on the fretboard: tap-to-pluck on the cell the
 *     pointer is over, via PointerSurface with scroll-gesture deferral
 *     so a horizontal swipe (native pan-x) never accidentally fires a note.
 *
 * Exports a controller factory so the orchestrator can pass in shared
 * state (the engine, the active-instrument accessor, the now-playing
 * label) without this module reaching for module-level globals.
 */
import { midiToName } from '../shared/audio.js';
import { createPointerSurface } from '../shared/pointer-surface.js';
import { midiAtCell } from './instruments.js';

/**
 * @param {object} deps
 * @param {HTMLElement} deps.fretboardEl  The `#fretboard` container.
 * @param {HTMLInputElement} deps.showNotesEl  The "Show notes" checkbox.
 * @param {HTMLElement} deps.nowPlaying  The "Now playing" status label.
 * @param {{ pluck(midi: number): boolean }} deps.engine  Audio engine.
 * @param {Map<string, HTMLElement>} deps.cellEls  Shared cell-element map.
 * @param {Set<HTMLElement>} deps.chordShapeCells  Shared chord-shape highlight set.
 * @param {() => object} deps.getActiveInstrument  Returns the live instrument config.
 */
export function createFretboardController({
  fretboardEl,
  showNotesEl,
  nowPlaying,
  engine,
  cellEls,
  chordShapeCells,
  getActiveInstrument
}) {
  let nowPlayingTimer = null;

  const announceNote = (midi) => {
    nowPlaying.textContent = midiToName(midi);
    nowPlaying.classList.add('active');
    clearTimeout(nowPlayingTimer);
    nowPlayingTimer = setTimeout(() => nowPlaying.classList.remove('active'), 350);
  };

  const flashCell = (stringIdx, fret) => {
    const el = cellEls.get(`${stringIdx}-${fret}`);
    if (!el) return;
    el.classList.add('active');
    setTimeout(() => el.classList.remove('active'), 280);
  };

  const playFret = (stringIdx, fret) => {
    const instrument = getActiveInstrument();
    const midi = midiAtCell(instrument, stringIdx, fret);
    if (midi == null) return;
    if (!engine.pluck(midi)) return;
    flashCell(stringIdx, fret);
    announceNote(midi);
  };

  const pluckFromCell = (cell) => {
    if (!cell || cell.classList.contains('unavailable')) return;
    const stringIdx = Number(cell.dataset.string);
    const fret = Number(cell.dataset.fret);
    playFret(stringIdx, fret);
  };

  function build() {
    const instrument = getActiveInstrument();
    fretboardEl.innerHTML = '';
    cellEls.clear();
    chordShapeCells.clear();
    fretboardEl.classList.toggle('hide-notes', !showNotesEl.checked);

    const { tuning, fretCount, singleDots, doubleDots, paired } = instrument;

    // Expose the fret count to CSS so the grid columns and the neck
    // min-width can scale with it (used by the horizontal-scroll layout
    // on narrow screens).
    fretboardEl.style.setProperty('--fret-count', String(fretCount));

    // Inner wrapper: holds the inlay overlay + string rows and owns the
    // `min-width` that drives horizontal scrolling. Putting both children
    // in the same containing block keeps the absolutely-positioned inlay
    // aligned with the string rows when the neck is wider than the viewport.
    const grid = document.createElement('div');
    grid.className = 'fretboard-grid';
    fretboardEl.appendChild(grid);

    // Inlay overlay sits *behind* the strings (z-index: 0) so the position
    // dots show through the fretboard wood without colliding with note
    // labels.
    const inlays = document.createElement('div');
    inlays.className = 'fretboard-inlays';
    inlays.setAttribute('aria-hidden', 'true');
    const addInlay = (fret, isDouble) => {
      const slot = document.createElement('div');
      slot.className = isDouble ? 'inlay double' : 'inlay';
      slot.style.gridColumn = String(fret);
      // Force every inlay into the single explicit row (the grid was
      // creating a 0/11px implicit row 2 for the double inlay, which
      // collapsed both 12th-fret dots to the bottom edge).
      slot.style.gridRow = '1';
      inlays.appendChild(slot);
    };
    singleDots.forEach((f) => addInlay(f, false));
    doubleDots.forEach((f) => addInlay(f, true));
    grid.appendChild(inlays);

    tuning.forEach((str, stringIdx) => {
      const row = document.createElement('div');
      row.className = 'fretboard-string' + (paired ? ' paired' : '');
      row.style.setProperty('--string-thickness', `${str.thickness}px`);
      const startFret = str.startFret || 0;
      // `--start-offset` shifts the string line right by N fret columns so
      // banjo's drone string doesn't render its line through the
      // unavailable cells (frets 0..startFret-1).
      if (startFret > 0) row.style.setProperty('--start-offset', String(startFret));

      for (let fret = 0; fret <= fretCount; fret++) {
        const cell = document.createElement('div');
        const isUnavailable = fret < startFret;
        const isStartOfDrone = fret === startFret && startFret > 0;
        // For "short" drone strings (banjo 5th), we don't render the
        // leftmost cells as `.open` — they get `.unavailable` instead so
        // the standard nut bar + open-string label don't appear above
        // unplayable cells. The drone's actual start cell (fret 5) gets
        // its own `.drone-start` adornment.
        const isOpen = fret === 0 && !isUnavailable;
        cell.className = 'fret-cell';
        if (isOpen) cell.classList.add('open');
        if (isUnavailable) cell.classList.add('unavailable');
        if (isStartOfDrone) cell.classList.add('drone-start');
        cell.dataset.string = String(stringIdx);
        cell.dataset.fret = String(fret);

        if (!isUnavailable) {
          const midi = str.midi + (fret - startFret);
          cell.dataset.midi = String(midi);
          const labelText =
            isOpen || isStartOfDrone ? str.name : midiToName(midi).replace(/\d+$/, '');
          const labelSpan = document.createElement('span');
          labelSpan.className = 'note';
          labelSpan.textContent = labelText;
          cell.appendChild(labelSpan);
        }

        row.appendChild(cell);
        cellEls.set(`${stringIdx}-${fret}`, cell);
      }

      grid.appendChild(row);
    });
  }

  // Cross-cell-drag + tap-vs-pan-x: PointerSurface owns tracking and
  // scroll-gesture deferral. hitTest skips unavailable (drone) cells so
  // a press there never commits a pluck.
  createPointerSurface(fretboardEl, {
    deferScrollOnTouch: true,
    hitTest: (x, y) => {
      const el = document.elementFromPoint(x, y);
      if (!el || !el.closest) return null;
      const cell = el.closest('.fret-cell');
      if (!cell || cell.classList.contains('unavailable')) return null;
      return cell;
    },
    onEnter: (cell) => {
      pluckFromCell(cell);
    }
  });

  return { build, playFret, flashCell, announceNote };
}
