// Score Panel Web Component - ES Module
// Encapsulates the score display UI and scoring utilities

import { adoptSharedStyles } from './sharedStyles.js';
import { createComponentProxy } from './componentProxy.js';
import { SCORING, TAP_NOTE_POINTS } from './judgmentPolicy.js';

export { SCORING, TAP_NOTE_POINTS };

// ============================================================================
// SCORING UTILITIES (pure functions)
// ============================================================================

/**
 * Grade thresholds and colors for dance-points percentage. Ordered most
 * generous → strictest so the iteration in calculateGrade can stop on
 * first match.
 *
 * Thresholds for AA / A roughly follow StepMania `_fallback` theme. B / C
 * / D are slightly stricter (we want the recovery curve to feel less
 * forgiving than the canonical fallback, but never harsher than the
 * `default` theme).
 *
 * AAAA collapses with what SM calls "AAA" in `_fallback` because
 * `GradeTier01IsAllW2s` is false in that theme — both fire at 100% DP.
 * Since 100% DP under our 3/2/1/0/0 weighting requires all perfects
 * anyway, we expose just one top tier (AAAA).
 */
export const GRADE_THRESHOLDS = [
  { minPercent: 100, letter: 'AAAA', color: '#FFD700' },
  { minPercent: 93, letter: 'AA', color: '#C0C0C0' },
  { minPercent: 80, letter: 'A', color: '#10B981' },
  { minPercent: 70, letter: 'B', color: '#3B82F6' },
  { minPercent: 60, letter: 'C', color: '#F59E0B' },
  { minPercent: 50, letter: 'D', color: '#EF4444' },
  { minPercent: 0, letter: 'F', color: '#7F1D1D' }
];

/**
 * Calculate dance points from tap note scores.
 *
 * Uses the canonical StepMania `_fallback` weighting (3/2/1/0/0). The max
 * is `totalNotes * 3`, so 100% DP requires every note to be a Perfect.
 *
 * @param {number[]} tapNoteScores - Array of [perfect, great, good, bad, miss, mine]
 * @returns {{earned: number, max: number, percentage: number}}
 */
export function calculateDancePoints(tapNoteScores) {
  const [perfect, great, good, bad, miss] = tapNoteScores;
  const totalNotes = tapNoteScores.reduce((sum, count) => sum + count, 0);

  const earned = perfect * 3 + great * 2 + good * 1 + bad * 0 + miss * 0;
  const max = totalNotes * 3;
  const percentage = max > 0 ? (earned / max) * 100 : 0;

  return { earned, max, percentage };
}

/**
 * Calculate the grade based on tap note scores.
 *
 * @param {number[]} tapNoteScores - Array of [perfect, great, good, bad, miss, mine]
 * @param {number} _totalNotes - Total notes (accepted for API compat; recomputed inside calculateDancePoints)
 * @returns {{letter: string, color: string, dpPercentage: string}}
 */
// eslint-disable-next-line no-unused-vars
export function calculateGrade(tapNoteScores, _totalNotes) {
  const { percentage } = calculateDancePoints(tapNoteScores);
  const dpPercentage = percentage.toFixed(2);

  for (const threshold of GRADE_THRESHOLDS) {
    if (percentage >= threshold.minPercent) {
      return { letter: threshold.letter, color: threshold.color, dpPercentage };
    }
  }

  // Theoretically unreachable: the last threshold has minPercent=0. Kept
  // as a defensive fallback so a NaN/negative DP doesn't return undefined.
  return { letter: 'F', color: '#7F1D1D', dpPercentage };
}

/**
 * Calculate score percentage from points
 * @param {number} actualPoints - Points earned
 * @param {number} noteCount - Total number of notes
 * @returns {number} Percentage (0-100)
 */
export function calculateScorePercentage(actualPoints, noteCount) {
  const maxPoints = TAP_NOTE_POINTS[0] * noteCount;
  if (maxPoints === 0) return 0;
  return Math.max(0, (actualPoints / maxPoints) * 100);
}

/**
 * Format a percentage for display
 * @param {number} percentage - The percentage value
 * @returns {string} Formatted percentage string (e.g., "95.50%")
 */
export function formatPercentage(percentage) {
  return percentage.toFixed(2) + '%';
}

/**
 * Create a shareable score message
 * @param {Object} scoreData - Score data object
 * @param {Object} songInfo - Song info object
 * @returns {string} Formatted score message
 */
export function createScoreMessage(scoreData, songInfo) {
  const [perfect, great, good, bad, miss] = scoreData.tapNoteScores;
  const grade = calculateGrade(scoreData.tapNoteScores, scoreData.totalNotes);

  const score = scoreData.score ? scoreData.score.toLocaleString() : '0';
  const maxCombo = scoreData.maxCombo || 0;

  // Tag the URL so arrivals can be attributed back to the score-share surface
  // (`shared=1&share_source=stepmania_score`). buildSharedUrl falls back to the
  // raw URL when window/URL isn't available (e.g. server-side or older shells).
  const shareUrl =
    typeof window !== 'undefined'
      ? typeof window.buildSharedUrl === 'function'
        ? window.buildSharedUrl('stepmania_score')
        : window.location.href
      : '';

  return `I just played "${songInfo.title}" on StepMania with ${songInfo.difficulty}${songInfo.difficultyRating} difficulty!

Grade: ${grade.letter} | Accuracy: ${scoreData.percentage}
Score: ${score} | Max Combo: ${maxCombo}

Perfect: ${perfect} | Great: ${great} | Good: ${good} | Bad: ${bad} | Miss: ${miss}

${shareUrl}`;
}

// ============================================================================
// SCORE PANEL WEB COMPONENT
// ============================================================================

/**
 * Score labels and their corresponding colors
 */
const SCORE_LABELS = [
  { name: 'Marvelous', color: 'var(--sm-judgment-marvelous)' },
  { name: 'Perfect', color: 'var(--sm-judgment-perfect)' },
  { name: 'Great', color: 'var(--sm-judgment-great)' },
  { name: 'Good', color: 'var(--sm-judgment-good)' },
  { name: 'Boo', color: 'var(--sm-judgment-boo)' },
  { name: 'Miss', color: 'var(--sm-judgment-miss)' }
];

// SSR-safe base: in browsers extends the real HTMLElement; under
// node --test (where pure-function exports get imported) falls back to a
// no-op class so the file's module evaluation doesn't crash. The custom-
// element registration below is similarly guarded.
const HTMLElementBase = typeof HTMLElement !== 'undefined' ? HTMLElement : class {};

class ScorePanelElement extends HTMLElementBase {
  /** @type {ScorePanelElement|null} */
  static _instance = null;

  /**
   * Get the singleton instance of the score panel
   * @returns {ScorePanelElement|null}
   */
  static get() {
    if (!ScorePanelElement._instance) {
      ScorePanelElement._instance = document.getElementById('score-panel');
    }
    return ScorePanelElement._instance;
  }

  constructor() {
    super();
    this.attachShadow({ mode: 'open' });

    // Internal state
    this._scores = [0, 0, 0, 0, 0, 0];
    this._percentage = '0.00%';
    this._noteCount = 0;
    this._actualPoints = 0;

    // Combo state
    this._combo = 0;
    this._maxCombo = 0;
    this._multiplier = 1;
    this._score = 0;
  }

  connectedCallback() {
    this.render();
    adoptSharedStyles(this.shadowRoot);
  }

  /**
   * Render the score panel UI
   */
  render() {
    this.shadowRoot.innerHTML = `
      <style>
        :host {
          display: block;
        }
        /* Score card chrome: solid brand surface-1 (no violet wash). The
         * percent-score text uses an identity cyan→violet clip — that
         * stays as BRAND.md permits a wordmark-style gradient for hero
         * numbers. */
        .score-container {
          background: var(--surface-1);
          border-radius: 0.75rem;
          padding: 1rem;
          border: 1px solid var(--hairline-strong);
        }
        .stats-row {
          display: flex;
          justify-content: space-between;
          margin-bottom: 0.75rem;
          gap: 0.5rem;
        }
        .stat-box {
          flex: 1;
          text-align: center;
          padding: 0.5rem;
          background: var(--surface-2);
          border: 1px solid var(--hairline);
          border-radius: 0.5rem;
        }
        .stat-label {
          font-size: 0.625rem;
          text-transform: uppercase;
          color: var(--text-2);
          margin-bottom: 0.25rem;
        }
        .stat-value {
          font-weight: 700;
          font-size: 1rem;
        }
        .stat-value.combo {
          color: var(--warning);
        }
        .stat-value.multiplier {
          color: var(--success);
        }
        .stat-value.score {
          color: var(--accent-primary);
        }
        .percent-score {
          font-size: 1.875rem;
          font-weight: 700;
          text-align: center;
          background: linear-gradient(to right, var(--sm-percent-lo), var(--sm-percent-hi));
          -webkit-background-clip: text;
          background-clip: text;
          color: transparent;
          margin-bottom: 0.75rem;
        }
        .score-list {
          display: flex;
          flex-direction: column;
          gap: 0.5rem;
        }
        .score-row {
          display: flex;
          justify-content: space-between;
          align-items: center;
          padding: 0.5rem 0.75rem;
          background: var(--surface-2);
          border: 1px solid var(--hairline);
          border-radius: 0.5rem;
        }
        .score-label {
          font-weight: 600;
        }
        .score-value {
          color: var(--text-1);
          font-weight: 700;
        }
        .score-row.updated {
          animation: flash 0.3s ease-out;
        }
        @keyframes flash {
          0% { background: var(--accent-primary-soft); }
          100% { background: var(--surface-2); }
        }
      </style>
      
      <div class="score-container">
        <div class="percent-score" id="percent">${this._percentage}</div>
        
        <div class="stats-row">
          <div class="stat-box">
            <div class="stat-label">Combo</div>
            <div class="stat-value combo" id="combo">${this._combo}</div>
          </div>
          <div class="stat-box">
            <div class="stat-label">Multi</div>
            <div class="stat-value multiplier" id="multiplier">${this._multiplier}x</div>
          </div>
          <div class="stat-box">
            <div class="stat-label">Score</div>
            <div class="stat-value score" id="gamified-score">${this._score.toLocaleString()}</div>
          </div>
        </div>
        
        <div class="score-list">
          ${SCORE_LABELS.map(
            (label, i) => `
            <div class="score-row" id="row-${i}">
              <span class="score-label" style="color: ${label.color}">${label.name}</span>
              <span class="score-value" id="score-${i}">${this._scores[i]}</span>
            </div>
          `
          ).join('')}
        </div>
      </div>
    `;
  }

  /**
   * Update a specific score and refresh the percentage
   * @param {number} scoreIndex - The score index (0-5) that changed
   * @param {number[]} scores - Full array of current scores
   * @param {number} actualPoints - Current total points
   * @param {number} noteCount - Total number of notes
   * @param {Object} comboData - Optional combo data { combo, multiplier, score, maxCombo }
   */
  update(scoreIndex, scores, actualPoints, noteCount, comboData = {}) {
    this._scores = [...scores];
    this._actualPoints = actualPoints;
    this._noteCount = noteCount;

    // Update combo data if provided
    if (comboData.combo !== undefined) this._combo = comboData.combo;
    if (comboData.multiplier !== undefined) this._multiplier = comboData.multiplier;
    if (comboData.score !== undefined) this._score = comboData.score;
    if (comboData.maxCombo !== undefined) this._maxCombo = comboData.maxCombo;

    // Calculate percentage using shared utility
    this._percentage = formatPercentage(calculateScorePercentage(actualPoints, noteCount));

    // Update the specific score element
    const scoreEl = this.shadowRoot.getElementById(`score-${scoreIndex}`);
    if (scoreEl) {
      scoreEl.textContent = scores[scoreIndex];

      // Add flash animation
      const row = this.shadowRoot.getElementById(`row-${scoreIndex}`);
      if (row) {
        row.classList.remove('updated');
        void row.offsetWidth; // Trigger reflow
        row.classList.add('updated');
      }
    }

    // Update percentage
    const percentEl = this.shadowRoot.getElementById('percent');
    if (percentEl) {
      percentEl.textContent = this._percentage;
    }

    // Update combo display
    this._updateComboDisplay();
  }

  /**
   * Update combo-related display elements
   * @private
   */
  _updateComboDisplay() {
    const comboEl = this.shadowRoot.getElementById('combo');
    if (comboEl) {
      comboEl.textContent = this._combo;
    }

    const multiplierEl = this.shadowRoot.getElementById('multiplier');
    if (multiplierEl) {
      multiplierEl.textContent = `${this._multiplier}x`;
    }

    const scoreEl = this.shadowRoot.getElementById('gamified-score');
    if (scoreEl) {
      scoreEl.textContent = this._score.toLocaleString();
    }
  }

  /**
   * Update just the percentage display (e.g., for mine hits)
   * @param {number} actualPoints - Current total points
   * @param {number} noteCount - Total number of notes
   * @param {Object} comboData - Optional combo data { combo, score, maxCombo }
   */
  updatePercent(actualPoints, noteCount, comboData = {}) {
    this._actualPoints = actualPoints;
    this._noteCount = noteCount;

    // Update combo data if provided
    if (comboData.combo !== undefined) this._combo = comboData.combo;
    if (comboData.score !== undefined) this._score = comboData.score;
    if (comboData.maxCombo !== undefined) this._maxCombo = comboData.maxCombo;

    // Calculate percentage using shared utility
    this._percentage = formatPercentage(calculateScorePercentage(actualPoints, noteCount));

    const percentEl = this.shadowRoot.getElementById('percent');
    if (percentEl) {
      percentEl.textContent = this._percentage;
    }

    // Update combo display
    this._updateComboDisplay();
  }

  /**
   * Reset all scores to zero
   */
  reset() {
    this._scores = [0, 0, 0, 0, 0, 0];
    this._percentage = '0.00%';
    this._actualPoints = 0;
    this._combo = 0;
    this._maxCombo = 0;
    this._multiplier = 1;
    this._score = 0;

    // Update all score elements
    for (let i = 0; i < 6; i++) {
      const scoreEl = this.shadowRoot.getElementById(`score-${i}`);
      if (scoreEl) {
        scoreEl.textContent = '0';
      }
    }

    // Update percentage
    const percentEl = this.shadowRoot.getElementById('percent');
    if (percentEl) {
      percentEl.textContent = '0.00%';
    }

    // Update combo display
    this._updateComboDisplay();
  }

  /**
   * Get the current scores array
   * @returns {number[]}
   */
  get scores() {
    return [...this._scores];
  }

  /**
   * Get the current percentage string
   * @returns {string}
   */
  get percentage() {
    return this._percentage;
  }

  /**
   * Get the total notes counted
   * @returns {number}
   */
  get totalNotes() {
    return this._scores.reduce((sum, count) => sum + count, 0);
  }
}

// Register the web component
if (typeof customElements !== 'undefined') {
  customElements.define('score-panel', ScorePanelElement);
}

// Create proxy for singleton access: ScorePanel.update(...) instead of ScorePanel.get()?.update(...)
export const ScorePanel = createComponentProxy(ScorePanelElement);

export default ScorePanel;
