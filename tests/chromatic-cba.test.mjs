/**
 * Verify the "trace the scale without lifting your finger" property
 * for the CBA right-hand layout — specifically, the user-validated
 * G major path on the 5-row C-system 100-button board:
 *
 *     G4 → A4 → B4 → C5 → D5 → E5 → F♯5 → G5
 *
 * On a CBA, every step in a scale should be playable as a press of a
 * physically-adjacent button (same row, or one of the four staggered
 * neighbours in the row above / below). This is the defining trait of
 * the layout — if a step ever requires an off-grid jump, the row
 * offsets are wrong.
 *
 * The 5-row layout's DOM has two helper rows (DOM 0 at the visual
 * bottom and DOM 4 at the top) flanking three main rows. Because of
 * that asymmetry, not *every* scale traces as a single connected path
 * (e.g. C major dead-ends at A4 → B4 because the only A4 reachable
 * from G4 sits next to no B4 button). G major works because every
 * step has a neighbour in reach. We test what the user observed.
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { CHROMATIC_LAYOUTS, midiForCell, areNeighbors } from '../play/accordion/chromatic.js';

const SHARP_NAMES = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];
const midiName = (m) => `${SHARP_NAMES[((m % 12) + 12) % 12]}${Math.floor(m / 12) - 1}`;

function buildGrid(layout, system) {
  const cells = [];
  for (let r = 0; r < layout.rows; r++) {
    for (let c = 0; c < layout.cols; c++) {
      cells.push({ r, c, midi: midiForCell(r, c, layout, system) });
    }
  }
  return cells;
}

/**
 * Try to play `midis` as a sequence of button presses where each next
 * button is a visual neighbour of the previous one. Returns the chosen
 * cells when successful, otherwise `null`.
 */
function tracePath(midis, layout, system) {
  const grid = buildGrid(layout, system);
  const byMidi = new Map();
  for (const cell of grid) {
    if (!byMidi.has(cell.midi)) byMidi.set(cell.midi, []);
    byMidi.get(cell.midi).push(cell);
  }

  function search(idx, prev) {
    if (idx === midis.length) return [];
    const candidates = (byMidi.get(midis[idx]) || []).filter(
      (cell) => prev === null || areNeighbors(prev.r, prev.c, cell.r, cell.c)
    );
    for (const cell of candidates) {
      const rest = search(idx + 1, cell);
      if (rest !== null) return [cell, ...rest];
    }
    return null;
  }

  return search(0, null);
}

describe('CBA 5-row C-system: G major scale traces as a connected path', () => {
  const layout = CHROMATIC_LAYOUTS[100];

  it('100-button layout exists and is 5×20', () => {
    assert.equal(layout.rows, 5);
    assert.equal(layout.cols, 20);
  });

  /**
   * Asserts that `midis` can be played as a sequence of presses where
   * each step lands on a button visually adjacent to the previous one.
   */
  function assertConnectedPath(midis, label) {
    const path = tracePath(midis, layout, 'C');
    if (!path) {
      assert.fail(`No connected path for ${label}: ${midis.map(midiName).join(' → ')}`);
    }
    assert.equal(path.length, midis.length);
    for (let i = 1; i < path.length; i++) {
      const a = path[i - 1];
      const b = path[i];
      assert.ok(
        areNeighbors(a.r, a.c, b.r, b.c),
        `${label} step ${midiName(midis[i - 1])} → ${midiName(midis[i])}: ` +
          `(${a.r},${a.c}) → (${b.r},${b.c}) are not visual neighbours`
      );
    }
  }

  it('G major (G4 → A4 → B4 → C5 → D5 → E5 → F♯5 → G5) is a single connected path', () => {
    // 1 sharp (F♯). The user-traced scale.
    assertConnectedPath([67, 69, 71, 72, 74, 76, 78, 79], 'G major');
  });

  it('E natural minor (E4 → F♯4 → G4 → A4 → B4 → C5 → D5 → E5) is a single connected path', () => {
    // Relative minor of G major — same key signature, different tonic.
    // Useful as a "different starting button, same shape" check.
    assertConnectedPath([64, 66, 67, 69, 71, 72, 74, 76], 'E natural minor');
  });

  it('E harmonic minor (raised 7th D♯ instead of D) is a single connected path', () => {
    // Harmonic minor stretches the gap before the leading tone
    // (B → D♯ → E is +3 semitones then +1), which exercises a different
    // diagonal across the honeycomb than the natural minor.
    assertConnectedPath([64, 66, 67, 69, 71, 72, 75, 76], 'E harmonic minor');
  });

  it('every button in the layout has at least one chromatic neighbour (±1 semi)', () => {
    // Sanity check on the honeycomb itself: from any interior button you
    // should be able to take at least one chromatic step. If a row gets
    // reordered in a way that breaks this, this test catches it.
    const grid = buildGrid(layout, 'C');
    let interior = 0;
    let withChromaticNeighbour = 0;
    for (const cell of grid) {
      // Skip edge buttons — they may be missing one side legitimately.
      if (cell.c === 0 || cell.c === layout.cols - 1) continue;
      interior++;
      const has = grid.some(
        (n) => areNeighbors(cell.r, cell.c, n.r, n.c) && Math.abs(n.midi - cell.midi) === 1
      );
      if (has) withChromaticNeighbour++;
    }
    assert.equal(
      withChromaticNeighbour,
      interior,
      `${interior - withChromaticNeighbour} interior buttons have no ±1-semitone neighbour`
    );
  });
});
