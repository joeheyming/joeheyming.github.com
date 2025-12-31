// Game Over Modal Web Component - ES Module
// Encapsulates the end-of-song modal display and interactions

import { adoptSharedStyles } from './sharedStyles.js';
import { createComponentProxy } from './componentProxy.js';
import gameState from './gameState.js';
import { songManager } from './songManager.js';
import { calculateGrade, createScoreMessage, ScorePanel } from './score-panel.js';
import { getURLParam } from './urlUtils.js';

// ============================================================================
// UTILITY FUNCTIONS
// ============================================================================

/**
 * Copy text to clipboard (with fallback for older browsers)
 * @param {string} text - Text to copy
 * @returns {Promise<void>}
 */
async function copyToClipboard(text) {
  if (navigator.clipboard && window.isSecureContext) {
    await navigator.clipboard.writeText(text);
  } else {
    const input = document.createElement('input');
    input.value = text;
    document.body.appendChild(input);
    input.select();
    const success = document.execCommand('copy', true, text);
    document.body.removeChild(input);

    if (!success) {
      throw new Error('Failed to copy text');
    }
  }
}

/**
 * Get current score data from the ScorePanel/gameState
 * @returns {{scores: number[], totalNotes: number, percentage: string}}
 */
function getScoreDataInternal() {
  const percentage = ScorePanel.percentage || '0.00%';
  const scores = gameState.getTapNoteScores();
  const totalNotes = scores.reduce((sum, count) => sum + count, 0);
  return { scores, totalNotes, percentage };
}

/**
 * Get current score data for sharing/display
 * @returns {Object} Score data object
 */
export function getScoreData() {
  const { scores, totalNotes, percentage } = getScoreDataInternal();

  return {
    tapNoteScores: scores,
    actualPoints: gameState.getActualPoints(),
    totalNotes,
    percentage,
    score: gameState.getScore(),
    maxCombo: gameState.getMaxCombo()
  };
}

/**
 * Get current song info for display
 * @returns {Object} Song info object
 */
export function getCurrentSongInfo() {
  const song = getURLParam('song');

  let songTitle = song || 'Unknown Song';
  let difficultyName = 'Unknown';
  let difficultyRating = '';

  const currentSongData = songManager.getCurrentSongData();
  if (currentSongData) {
    songTitle = currentSongData.title || songTitle;

    const parsedData = songManager.getCurrentParsedData();
    const currentDifficulty = songManager.getCurrentDifficulty();
    if (parsedData && parsedData.charts && currentDifficulty !== null) {
      const chart = parsedData.charts[currentDifficulty];
      if (chart) {
        difficultyName = chart.difficulty || difficultyName;
        difficultyRating = chart.rating ? ` (${chart.rating})` : '';
      }
    }
  }

  return {
    title: songTitle,
    difficulty: difficultyName,
    difficultyRating
  };
}

// ============================================================================
// WEB COMPONENT
// ============================================================================

class GameOverModalElement extends HTMLElement {
  /** @type {GameOverModalElement|null} */
  static _instance = null;

  /**
   * Get the singleton instance of the game over modal
   * @returns {GameOverModalElement|null}
   */
  static get() {
    if (!GameOverModalElement._instance) {
      GameOverModalElement._instance = document.getElementById('game-over-modal');
    }
    return GameOverModalElement._instance;
  }

  constructor() {
    super();
    this.attachShadow({ mode: 'open' });

    // Internal state
    this._visible = false;
    this._grade = { letter: 'A', color: '#10B981' };
    this._percentage = '0.00%';
    this._totalNotes = 0;
    this._totalPoints = 0;

    // Callbacks
    this._onRestart = null;
    this._onClose = null;
  }

  connectedCallback() {
    this.render();
  }

  render() {
    // Toggle visibility via CSS class (styles in screen.css)
    this.classList.toggle('visible', this._visible);

    const title = this._failed ? '💔 Song Failed!' : '🎵 Song Complete!';
    const titleColor = this._failed ? 'color: #ef4444;' : '';
    const failedBadge = this._failed
      ? '<div class="failed-badge" style="background: #ef4444; color: white; padding: 4px 12px; border-radius: 999px; font-size: 12px; margin-bottom: 8px;">Health Depleted</div>'
      : '';

    // Host animation styles; content styles from components.css via adoptSharedStyles
    this.shadowRoot.innerHTML = `
      <style>
        :host { animation: gameOverFadeIn 0.3s ease-out; }
        @keyframes gameOverFadeIn {
          from { opacity: 0; }
          to { opacity: 1; }
        }
        .stats-row {
          display: flex;
          justify-content: center;
          gap: 1rem;
          margin-top: 0.5rem;
        }
        .stat-item {
          text-align: center;
        }
        .stat-label {
          font-size: 0.75rem;
          color: rgba(255, 255, 255, 0.6);
          text-transform: uppercase;
        }
        .stat-value {
          font-size: 1.25rem;
          font-weight: bold;
        }
        .stat-value.score { color: #60a5fa; }
        .stat-value.combo { color: #fbbf24; }
      </style>
      <div class="game-over-content">
        <h2 style="${titleColor}">${title}</h2>
        ${failedBadge}

        <div class="score-box">
          <div class="grade" style="color: ${this._grade.color}">${this._grade.letter}</div>
          <div class="percentage">${this._percentage}</div>
          <div class="stats-row">
            <div class="stat-item">
              <div class="stat-label">Score</div>
              <div class="stat-value score">${(this._score || 0).toLocaleString()}</div>
            </div>
            <div class="stat-item">
              <div class="stat-label">Max Combo</div>
              <div class="stat-value combo">${this._maxCombo || 0}</div>
            </div>
          </div>
          <div class="notes">${this._totalNotes} notes</div>
        </div>

        <div class="buttons">
          <button class="share-btn" data-event="game_over_share_score" data-event-category="StepMania" data-event-label="Share Score">
            📊 Share Score
          </button>
          <button class="restart-btn" data-event="game_over_restart" data-event-category="StepMania" data-event-label="Play Again">
            🔄 Play Again
          </button>
          <button class="close-btn" data-event="game_over_close" data-event-category="StepMania" data-event-label="Close Game Over">
            ✕ Close
          </button>
        </div>
      </div>
    `;

    adoptSharedStyles(this.shadowRoot);
    this._bindEvents();
  }

  _bindEvents() {
    const shareBtn = this.shadowRoot.querySelector('.share-btn');
    const restartBtn = this.shadowRoot.querySelector('.restart-btn');
    const closeBtn = this.shadowRoot.querySelector('.close-btn');

    shareBtn?.addEventListener('click', () => this._shareScore());
    restartBtn?.addEventListener('click', () => this._restart());
    closeBtn?.addEventListener('click', () => this.hide());
  }

  _shareScore() {
    const scoreData = getScoreData();
    const songInfo = getCurrentSongInfo();
    const message = createScoreMessage(scoreData, songInfo);
    const shareBtn = this.shadowRoot.querySelector('.share-btn');

    copyToClipboard(message)
      .then(() => {
        if (!shareBtn) return;
        const originalText = shareBtn.textContent;
        shareBtn.textContent = '✓ Copied!';
        shareBtn.style.backgroundColor = '#10b981';

        setTimeout(() => {
          shareBtn.textContent = originalText;
          shareBtn.style.backgroundColor = '';
        }, 2000);
      })
      .catch(() => {
        if (!shareBtn) return;
        const originalText = shareBtn.textContent;
        shareBtn.textContent = '✗ Failed';
        shareBtn.style.backgroundColor = '#ef4444';

        setTimeout(() => {
          shareBtn.textContent = originalText;
          shareBtn.style.backgroundColor = '';
        }, 2000);
      });
  }

  _restart() {
    this.hide();
    if (this._onRestart) {
      this._onRestart();
    }
  }

  /**
   * Show the game over modal
   * @param {Object} options - Options object
   * @param {Function} options.onRestart - Callback when restart is clicked
   * @param {Function} options.onClose - Callback when modal is closed
   * @param {boolean} options.failed - Whether the player failed (health depleted)
   */
  show(options = {}) {
    this._onRestart = options.onRestart || null;
    this._onClose = options.onClose || null;
    this._failed = options.failed || false;

    // Update score data
    const { scores, totalNotes, percentage } = getScoreDataInternal();
    this._grade = calculateGrade(scores, totalNotes);
    this._percentage = percentage;
    this._totalNotes = totalNotes;
    this._totalPoints = gameState.getActualPoints();
    this._score = gameState.getScore();
    this._maxCombo = gameState.getMaxCombo();

    // Track analytics event
    if (typeof window.trackEvent === 'function') {
      const status = this._failed ? 'Failed' : 'Complete';
      window.trackEvent('song_complete', 'StepMania', `Song ${status} - ${percentage}`, totalNotes);
    }

    this._visible = true;
    this.render();
  }

  /**
   * Hide the game over modal
   */
  hide() {
    this._visible = false;
    this.render();

    if (this._onClose) {
      this._onClose();
    }
  }

  // Getters for external access
  get visible() {
    return this._visible;
  }
}

// Register the web component
customElements.define('game-over-modal', GameOverModalElement);

// Create proxy for singleton access
export const GameOverModal = createComponentProxy(GameOverModalElement);

export default GameOverModal;
