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
 * Grade thresholds and colors for dance point percentage
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
 * Calculate dance points from tap note scores
 * @param {number[]} tapNoteScores - Array of [perfect, great, good, bad, miss, mine]
 * @returns {{earned: number, max: number, percentage: number}}
 */
export function calculateDancePoints(tapNoteScores) {
  const [perfect, great, good, bad, miss] = tapNoteScores;
  const totalNotes = tapNoteScores.reduce((sum, count) => sum + count, 0);

  const earned = perfect * 2 + great * 1 + good * 0.5 + bad * 0 + miss * 0;
  const max = totalNotes * 2;
  const percentage = max > 0 ? (earned / max) * 100 : 0;

  return { earned, max, percentage };
}

/**
 * Calculate the grade based on tap note scores
 * @param {number[]} tapNoteScores - Array of [perfect, great, good, bad, miss, mine]
 * @param {number} totalNotes - Total number of notes
 * @returns {{letter: string, color: string, dpPercentage: string}}
 */
export function calculateGrade(tapNoteScores, totalNotes) {
  const [perfect] = tapNoteScores;
  const { percentage } = calculateDancePoints(tapNoteScores);

  // Check for AAAA (all perfects)
  if (percentage === 100 && perfect === totalNotes) {
    return { letter: 'AAAA', color: '#FFD700', dpPercentage: '100.00' };
  }

  // Check for AAA (100% but not all perfects)
  if (percentage === 100) {
    return { letter: 'AAA', color: '#FFD700', dpPercentage: '100.00' };
  }

  // Find matching grade threshold
  for (const threshold of GRADE_THRESHOLDS) {
    if (threshold.perfectsRequired) continue; // Skip AAAA, already handled
    if (percentage >= threshold.minPercent) {
      return {
        letter: threshold.letter,
        color: threshold.color,
        dpPercentage: percentage.toFixed(2)
      };
    }
  }

  // Fallback to F
  return { letter: 'F', color: '#7F1D1D', dpPercentage: percentage.toFixed(2) };
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
  { name: 'Marvelous', color: 'rgb(216, 180, 254)' }, // purple-300
  { name: 'Perfect', color: 'rgb(147, 197, 253)' }, // blue-300
  { name: 'Great', color: 'rgb(134, 239, 172)' }, // green-300
  { name: 'Good', color: 'rgb(253, 224, 71)' }, // yellow-300
  { name: 'Boo', color: 'rgb(253, 186, 116)' }, // orange-300
  { name: 'Miss', color: 'rgb(252, 165, 165)' } // red-300
];

class ScorePanelElement extends HTMLElement {
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
          background: var(--surface-1, #15151b);
          border-radius: 0.75rem;
          padding: 1rem;
          border: 1px solid var(--hairline-strong, rgba(255, 255, 255, 0.14));
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
          background: var(--surface-2, #1f1f27);
          border: 1px solid var(--hairline, rgba(255, 255, 255, 0.08));
          border-radius: 0.5rem;
        }
        .stat-label {
          font-size: 0.625rem;
          text-transform: uppercase;
          color: rgba(255, 255, 255, 0.6);
          margin-bottom: 0.25rem;
        }
        .stat-value {
          font-weight: 700;
          font-size: 1rem;
        }
        .stat-value.combo {
          color: #fbbf24;
        }
        .stat-value.multiplier {
          color: #34d399;
        }
        .stat-value.score {
          color: #60a5fa;
        }
        .percent-score {
          font-size: 1.875rem;
          font-weight: 700;
          text-align: center;
          background: linear-gradient(to right, #00d4ff, #a855f7);
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
          background: var(--surface-2, #1f1f27);
          border: 1px solid var(--hairline, rgba(255, 255, 255, 0.08));
          border-radius: 0.5rem;
        }
        .score-label {
          font-weight: 600;
        }
        .score-value {
          color: white;
          font-weight: 700;
        }
        .score-row.updated {
          animation: flash 0.3s ease-out;
        }
        @keyframes flash {
          0% { background: var(--accent-primary-soft, rgba(124, 92, 255, 0.25)); }
          100% { background: var(--surface-2, #1f1f27); }
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
customElements.define('score-panel', ScorePanelElement);

// Create proxy for singleton access: ScorePanel.update(...) instead of ScorePanel.get()?.update(...)
export const ScorePanel = createComponentProxy(ScorePanelElement);

export default ScorePanel;
