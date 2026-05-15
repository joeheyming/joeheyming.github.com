// Strings page — chord-shape painter.
// Owns the persistent visual highlight for the selected voicing: per-cell
// `.in-chord` discs + finger-number badges, the barre overlay (amber pill),
// the root-cell overlay (red disc with the actual root-note label), and the
// muted-string × markers. Lives as a controller so the orchestrator can
// instantiate one per page and call `paintChordShape` / `clearChordShape`.

import { ROOTS, assignFingers, detectBarre } from './chords.js';
import { midiAtCell } from './instruments.js';

/**
 * @param {{
 *   fretboardEl: HTMLElement,
 *   cellEls: Map<string, HTMLElement>,
 *   chordShapeCells: Set<HTMLElement>,
 *   getActiveInstrument: () => any,
 * }} ctx
 */
export function createChordShapePainter(ctx) {
  const { fretboardEl, cellEls, chordShapeCells, getActiveInstrument } = ctx;

  // Overlays for the barre (amber pill across barred strings) and the
  // root cell (red disc, on top of the barre). Both live as siblings of
  // the .fret-cell elements inside .fretboard-grid so they can fight a
  // shared z-index battle (the strings row has its own z-index that's
  // strictly below these — that's why we can't render either one as a
  // pseudo-element of the cell itself).
  let barreOverlayEl = null;
  let rootOverlayEl = null;

  const removeBarreOverlay = () => {
    if (barreOverlayEl && barreOverlayEl.parentNode) {
      barreOverlayEl.parentNode.removeChild(barreOverlayEl);
    }
    barreOverlayEl = null;
  };

  const removeRootOverlay = () => {
    if (rootOverlayEl && rootOverlayEl.parentNode) {
      rootOverlayEl.parentNode.removeChild(rootOverlayEl);
    }
    rootOverlayEl = null;
  };

  const clearChordShape = () => {
    chordShapeCells.forEach((el) => {
      el.classList.remove('in-chord', 'in-chord-root', 'in-chord-open', 'muted');
      delete el.dataset.finger;
      const badge = el.querySelector('.finger-badge');
      if (badge) badge.remove();
    });
    chordShapeCells.clear();
    removeBarreOverlay();
    removeRootOverlay();
  };

  /**
   * Position the barre overlay across the cells the index finger covers.
   *
   * The overlay lives inside `.fretboard-grid` (which absolutely-positions
   * its inlay layer the same way) so we can use the cell DOM rects to
   * compute the bar's geometry without re-implementing the grid maths in
   * CSS. Re-derived on every paint so window resizes / orientation
   * changes naturally re-place it on the next paint pass.
   */
  const drawBarreOverlay = (barre) => {
    removeBarreOverlay();
    if (!barre) return;
    const grid = fretboardEl.querySelector('.fretboard-grid');
    if (!grid) return;
    const fromCell = cellEls.get(`${barre.fromString}-${barre.fret}`);
    const toCell = cellEls.get(`${barre.toString}-${barre.fret}`);
    if (!fromCell || !toCell) return;
    const gridRect = grid.getBoundingClientRect();
    const fromRect = fromCell.getBoundingClientRect();
    const toRect = toCell.getBoundingClientRect();
    // The bar spans from the higher string row's top (smaller stringIdx
    // = top of the array but visually lower? No — string 0 = highest
    // pitch = top row of the fretboard since we render high-first).
    // fromString < toString in our array, so fromCell is visually above
    // toCell, hence we span fromCell.top → toCell.bottom.
    const top = Math.min(fromRect.top, toRect.top) - gridRect.top;
    const bottom = Math.max(fromRect.bottom, toRect.bottom) - gridRect.top;
    const left = fromRect.left - gridRect.left;
    const width = fromRect.width;

    const el = document.createElement('div');
    el.className = 'chord-barre';
    el.style.top = `${top + 4}px`;
    el.style.height = `${bottom - top - 8}px`;
    el.style.left = `${left + 6}px`;
    el.style.width = `${width - 12}px`;
    el.setAttribute('aria-hidden', 'true');
    // The "1" label sits on the left end so it doesn't collide with finger
    // badges on cells that aren't part of the barre. Label uses the
    // actual barring finger (usually 1, but chord-data has finger 3 / 4
    // mini-barres for some open shapes like Am add9 or "open Am+").
    const fingerLabel = barre.finger || 1;
    el.innerHTML = `<span class="chord-barre-label">${fingerLabel}</span>`;
    grid.appendChild(el);
    barreOverlayEl = el;
  };

  const setFingerBadge = (cell, label) => {
    let badge = cell.querySelector('.finger-badge');
    if (!badge) {
      badge = document.createElement('span');
      badge.className = 'finger-badge';
      cell.appendChild(badge);
    }
    badge.textContent = label;
  };

  /**
   * Render the root marker on top of the barre overlay (and on top of
   * any cell-level chord-tone disc). Same DOM-rect approach as the
   * barre — read the cell's bounding rect, position an overlay element
   * inside .fretboard-grid.
   *
   * The label is the actual ROOT NOTE NAME (e.g. "C", "F♯", "B♭") rather
   * than a generic "R" — non-musicians found "R" confusing, and showing
   * the note tells the player both "this is the root" (via the red
   * colour) AND "you're playing a C", which doubles as a sanity check
   * against the chord name. The fretting finger number sits as a small
   * superscript so the player still knows which finger to use.
   */
  const drawRootOverlay = (rootCell, fingerNumber, rootName) => {
    removeRootOverlay();
    if (!rootCell) return;
    const grid = fretboardEl.querySelector('.fretboard-grid');
    if (!grid) return;
    const gridRect = grid.getBoundingClientRect();
    const rect = rootCell.getBoundingClientRect();
    const top = rect.top - gridRect.top + 3;
    const left = rect.left - gridRect.left + 5;
    const width = rect.width - 10;
    const height = rect.height - 6;

    const el = document.createElement('div');
    el.className = 'chord-root-marker';
    el.style.top = `${top}px`;
    el.style.left = `${left}px`;
    el.style.width = `${width}px`;
    el.style.height = `${height}px`;
    el.setAttribute('aria-hidden', 'true');
    const label = rootName || 'R';
    if (fingerNumber && fingerNumber > 0) {
      el.innerHTML = `<span class="chord-root-marker-label">${label}<small>${fingerNumber}</small></span>`;
    } else {
      el.innerHTML = `<span class="chord-root-marker-label">${label}</span>`;
    }
    grid.appendChild(el);
    rootOverlayEl = el;
  };

  /**
   * Highlight the chord shape on the fretboard and leave it in place.
   *
   * - Fretted cells get `.in-chord` (purple disc) plus a finger-number
   *   badge (1-4). The lowest-pitch root copy also gets `.in-chord-root`
   *   (amber disc) and an `R` label so the tonal centre pops visually.
   * - Open chord-tone cells get `.in-chord-open` (just a small ○ marker
   *   on the label cell — no full-cell tint, since the player isn't
   *   fingering anything).
   * - Muted strings get `.muted` (big × on the label cell).
   * - If the shape is a barre, draw a horizontal pill across the index
   *   finger's strings via `drawBarreOverlay`.
   */
  const paintChordShape = (frets, rootPc, providedFingers) => {
    clearChordShape();
    const activeInstrument = getActiveInstrument();
    // Prefer chord-data fingers (textbook-vetted) when the voicing
    // carries them; only fall back to the heuristic for algorithmic
    // voicings (banjo / mandolin / uke C♯ / F♯).
    const fingers = providedFingers || assignFingers(frets, activeInstrument.tuning);
    const barre = detectBarre(frets, activeInstrument.tuning, providedFingers);

    // Track the lowest-pitch sounding root (the bass-voice copy that
    // anchors the chord). We use actual MIDI pitch rather than array
    // index because banjo's 5th-string drone is a HIGH-pitched g4
    // appended to the end of the tuning array — the array-index
    // heuristic would mistakenly mark the drone as the bass root.
    let bestRootMidi = Number.POSITIVE_INFINITY;
    let bestRootStringIdx = -1;
    let bestRootFret = -1;

    frets.forEach((fret, stringIdx) => {
      const startFret = activeInstrument.tuning[stringIdx].startFret || 0;
      if (fret < 0) {
        // Muted: × goes on the open-string label cell (or the
        // drone's startFret cell, since that's where the string label
        // lives for drones).
        const labelCell = cellEls.get(`${stringIdx}-${startFret}`);
        if (labelCell) {
          labelCell.classList.add('muted');
          chordShapeCells.add(labelCell);
        }
        return;
      }
      if (fret === startFret) {
        // Open chord tone — covers regular open strings (fret 0) AND
        // drone strings ringing at their startFret (e.g. banjo's 5th
        // string at fret 5). Either way: no finger, just a small ○
        // marker on the label/drone-start cell.
        const openCell = cellEls.get(`${stringIdx}-${startFret}`);
        if (openCell) {
          openCell.classList.add('in-chord-open');
          chordShapeCells.add(openCell);
        }
      } else {
        const cell = cellEls.get(`${stringIdx}-${fret}`);
        if (!cell) return;
        cell.classList.add('in-chord');
        chordShapeCells.add(cell);
        const finger = fingers[stringIdx];
        if (finger > 0) setFingerBadge(cell, String(finger));
      }

      const midi = midiAtCell(activeInstrument, stringIdx, fret);
      if (midi != null && midi % 12 === rootPc && midi < bestRootMidi) {
        bestRootMidi = midi;
        bestRootStringIdx = stringIdx;
        bestRootFret = fret;
      }
    });

    if (bestRootStringIdx >= 0) {
      const rootCell = cellEls.get(`${bestRootStringIdx}-${bestRootFret}`);
      if (rootCell) {
        rootCell.classList.remove('in-chord', 'in-chord-open');
        rootCell.classList.add('in-chord-root');
        const finger = fingers[bestRootStringIdx];
        const rootStartFret = activeInstrument.tuning[bestRootStringIdx].startFret || 0;
        const isOpenRoot = bestRootFret === rootStartFret;
        // Display name for the root note ("C", "F♯", "B♭", …) — the
        // ROOTS table already uses the prettier Unicode accidentals.
        const rootName = ROOTS.find((r) => r.pc === rootPc)?.name || '';
        // Drop any finger-number badge that may have been added when
        // the cell was first painted as `.in-chord` — the overlay
        // takes over visual responsibility now.
        const stale = rootCell.querySelector('.finger-badge');
        if (stale) stale.remove();
        // Order matters: barre first, then root on top, so the red
        // disc visibly punches through the amber bar.
        drawBarreOverlay(barre);
        if (!isOpenRoot) drawRootOverlay(rootCell, finger, rootName);
        return;
      }
    }

    drawBarreOverlay(barre);
  };

  return { paintChordShape, clearChordShape };
}
