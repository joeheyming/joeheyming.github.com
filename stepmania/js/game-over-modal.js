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

    // Host animation styles; content styles from components/game-over.css via adoptSharedStyles
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
          <!-- No data-event here: _shareScore() fires game_over_share_score with a richer label (song title). Previously both the data-event delegate and _shareScore fired, double-counting taps. -->
          <button class="share-btn">
            🎉 Share Your Score!
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

  async _shareScore() {
    const scoreData = getScoreData();
    const songInfo = getCurrentSongInfo();
    const message = createScoreMessage(scoreData, songInfo);
    const shareBtn = this.shadowRoot.querySelector('.share-btn');

    // Track share attempt
    if (typeof window.trackEvent === 'function') {
      window.trackEvent('game_over_share_score', 'StepMania', `Share Score - ${songInfo.title}`);
    }

    // Try Web Share API first (mobile-friendly and more prominent)
    if (navigator.share && window.isSecureContext) {
      try {
        // Tag the shared URL so arrivals fire `shared_link_arrival` in GA.
        const shareUrl =
          typeof window.buildSharedUrl === 'function'
            ? window.buildSharedUrl('stepmania_score')
            : window.location.href;
        const shareData = {
          title: `StepMania Score: ${songInfo.title}`,
          text: message,
          url: shareUrl
        };

        await navigator.share(shareData);

        // Success feedback
        if (shareBtn) {
          const originalText = shareBtn.textContent;
          shareBtn.textContent = '✓ Shared!';
          shareBtn.style.backgroundColor = '#10b981';
          setTimeout(() => {
            shareBtn.textContent = originalText;
            shareBtn.style.backgroundColor = '';
          }, 2000);
        }
        return;
      } catch (err) {
        // User cancelled or share failed, fall through to clipboard
        if (err.name === 'AbortError') {
          return; // User cancelled, don't show error
        }
        // Continue to clipboard fallback
      }
    }

    // Fallback to clipboard
    try {
      await copyToClipboard(message);

      if (shareBtn) {
        const originalText = shareBtn.textContent;
        shareBtn.textContent = '✓ Copied!';
        shareBtn.style.backgroundColor = '#10b981';

        // Show a more prominent success message
        this._showShareSuccess(message);

        setTimeout(() => {
          shareBtn.textContent = originalText;
          shareBtn.style.backgroundColor = '';
        }, 2000);
      }
    } catch (err) {
      console.error('Failed to share score:', err);

      if (shareBtn) {
        const originalText = shareBtn.textContent;
        shareBtn.textContent = '✗ Failed';
        shareBtn.style.backgroundColor = '#ef4444';

        setTimeout(() => {
          shareBtn.textContent = originalText;
          shareBtn.style.backgroundColor = '';
        }, 2000);
      }
    }
  }

  _showShareSuccess(message) {
    // Create a temporary success message overlay
    const successOverlay = document.createElement('div');
    successOverlay.style.cssText = `
      position: fixed;
      top: 50%;
      left: 50%;
      transform: translate(-50%, -50%);
      background: #1f2937;
      border: 2px solid #10b981;
      border-radius: 0.5rem;
      padding: 1.5rem;
      max-width: 90%;
      max-height: 80vh;
      overflow-y: auto;
      z-index: 10000;
      box-shadow: 0 20px 25px -5px rgba(0, 0, 0, 0.5);
    `;

    successOverlay.innerHTML = `
      <div style="text-align: center; color: white;">
        <div style="font-size: 2rem; margin-bottom: 0.5rem;">✓</div>
        <h3 style="margin: 0 0 1rem 0; color: #10b981;">Score Copied!</h3>
        <p style="margin: 0 0 1rem 0; color: #d1d5db; font-size: 0.875rem;">
          Your score has been copied to clipboard. Paste it anywhere to share!
        </p>
        <div style="background: #374151; padding: 1rem; border-radius: 0.25rem; margin-bottom: 1rem; text-align: left; font-family: monospace; font-size: 0.75rem; color: #d1d5db; white-space: pre-wrap; word-break: break-word;">
          ${message.substring(0, 200)}${message.length > 200 ? '...' : ''}
        </div>
        <button id="close-share-success" style="
          background: #2563eb;
          color: white;
          border: none;
          padding: 0.5rem 1.5rem;
          border-radius: 0.25rem;
          cursor: pointer;
          font-weight: 600;
        ">Got it!</button>
      </div>
    `;

    document.body.appendChild(successOverlay);

    const closeBtn = successOverlay.querySelector('#close-share-success');
    const closeOverlay = () => {
      successOverlay.remove();
    };

    closeBtn.addEventListener('click', closeOverlay);
    successOverlay.addEventListener('click', (e) => {
      if (e.target === successOverlay) closeOverlay();
    });

    // Auto-close after 5 seconds
    setTimeout(closeOverlay, 5000);
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
