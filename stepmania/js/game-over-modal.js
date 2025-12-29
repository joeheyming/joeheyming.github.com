// Game Over Modal Web Component - ES Module
// Encapsulates the end-of-song modal display and interactions

import { adoptSharedStyles } from './sharedStyles.js';
import { createComponentProxy } from './componentProxy.js';
import gameState from './gameState.js';
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
    percentage
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

  const currentSongData = gameState.getCurrentSongData();
  if (currentSongData) {
    songTitle = currentSongData.title || songTitle;

    const currentSongKey = gameState.getCurrentSongKey();
    const parsedData = gameState.getParsedSong(currentSongKey);

    const currentDifficulty = gameState.getCurrentDifficulty();
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

    // Host animation styles; content styles from components.css via adoptSharedStyles
    this.shadowRoot.innerHTML = `
      <style>
        :host { animation: gameOverFadeIn 0.3s ease-out; }
        @keyframes gameOverFadeIn {
          from { opacity: 0; }
          to { opacity: 1; }
        }
      </style>
      <div class="game-over-content">
        <h2>🎵 Song Complete!</h2>

        <div class="score-box">
          <div class="grade" style="color: ${this._grade.color}">${this._grade.letter}</div>
          <div class="percentage">${this._percentage}</div>
          <div class="notes">${this._totalNotes} notes</div>
          <div class="points">${this._totalPoints} points</div>
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
   */
  show(options = {}) {
    this._onRestart = options.onRestart || null;
    this._onClose = options.onClose || null;

    // Update score data
    const { scores, totalNotes, percentage } = getScoreDataInternal();
    this._grade = calculateGrade(scores, totalNotes);
    this._percentage = percentage;
    this._totalNotes = totalNotes;
    this._totalPoints = gameState.getActualPoints();

    // Track analytics event
    if (typeof window.trackEvent === 'function') {
      window.trackEvent('song_complete', 'StepMania', `Song Complete - ${percentage}`, totalNotes);
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
