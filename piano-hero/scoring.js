// Pure scoring utilities — modeled on stepmania/js/score-panel.js's
// dance-points + grade calculation. Used by the score panel HUD and the
// game-over modal.

import { JUDGMENT_INDEX } from './judgment-policy.js';

/**
 * Grade thresholds and colors based on dance-points percentage. Top entry
 * carries an additional `perfectsRequired` flag so we can distinguish
 * AAAA (every note perfect) from AAA (100% dance points but at least one
 * Great).
 */
export const GRADE_THRESHOLDS = [
  { minPercent: 100, perfectsRequired: true, letter: 'AAAA', color: '#FFD700' },
  { minPercent: 100, perfectsRequired: false, letter: 'AAA', color: '#FFD700' },
  { minPercent: 93, letter: 'AA', color: '#C0C0C0' },
  { minPercent: 80, letter: 'A', color: '#10B981' },
  { minPercent: 70, letter: 'B', color: '#3B82F6' },
  { minPercent: 60, letter: 'C', color: '#F59E0B' },
  { minPercent: 50, letter: 'D', color: '#EF4444' },
  { minPercent: 0, letter: 'F', color: '#7F1D1D' }
];

/**
 * Calculate dance points from a tally of judgment counts.
 *
 * @param {number[]} tapNoteScores - Indexed by JUDGMENT_INDEX:
 *                                    [perfect, great, good, bad, miss]
 * @returns {{ earned: number, max: number, percentage: number }}
 */
export function calculateDancePoints(tapNoteScores) {
  const perfect = tapNoteScores[JUDGMENT_INDEX.PERFECT] || 0;
  const great = tapNoteScores[JUDGMENT_INDEX.GREAT] || 0;
  const good = tapNoteScores[JUDGMENT_INDEX.GOOD] || 0;
  const totalNotes = tapNoteScores.reduce((sum, count) => sum + (count || 0), 0);

  // Stepmania-style weighting: perfect=2, great=1, good=0.5, bad/miss=0.
  // Max points = 2 per note (i.e. all perfects).
  const earned = perfect * 2 + great * 1 + good * 0.5;
  const max = totalNotes * 2;
  const percentage = max > 0 ? (earned / max) * 100 : 0;

  return { earned, max, percentage };
}

/**
 * Compute the grade based on tap note scores.
 *
 * @param {number[]} tapNoteScores - [perfect, great, good, bad, miss]
 * @param {number} totalNotes      - Total notes in the chart.
 * @returns {{ letter: string, color: string, dpPercentage: string }}
 */
export function calculateGrade(tapNoteScores, totalNotes) {
  const perfect = tapNoteScores[JUDGMENT_INDEX.PERFECT] || 0;
  const { percentage } = calculateDancePoints(tapNoteScores);

  if (percentage === 100 && perfect === totalNotes) {
    return { letter: 'AAAA', color: '#FFD700', dpPercentage: '100.00' };
  }
  if (percentage === 100) {
    return { letter: 'AAA', color: '#FFD700', dpPercentage: '100.00' };
  }

  for (const threshold of GRADE_THRESHOLDS) {
    if (threshold.perfectsRequired) continue;
    if (percentage >= threshold.minPercent) {
      return {
        letter: threshold.letter,
        color: threshold.color,
        dpPercentage: percentage.toFixed(2)
      };
    }
  }

  return { letter: 'F', color: '#7F1D1D', dpPercentage: percentage.toFixed(2) };
}

/**
 * Compute total raw points awarded.
 * @param {number[]} tapNoteScores
 * @returns {number}
 */
export function calculateRawScore(tapNoteScores) {
  // Imported lazily to avoid a circular import — judgment-policy depends
  // on no scoring.
  // (Note: at module-load time both files are imported; this lazy access
  // pattern keeps things simple if the dep order ever flips.)
  let total = 0;
  // Inline weights to avoid extra import — mirrors TAP_NOTE_POINTS.
  const POINTS = [3, 3, 2, 1, 0];
  for (let i = 0; i < tapNoteScores.length && i < POINTS.length; i++) {
    total += (tapNoteScores[i] || 0) * POINTS[i];
  }
  return total;
}
