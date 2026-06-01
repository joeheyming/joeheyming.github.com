// <piano-hero-game-over-modal> — end-of-song summary screen. Shown only
// when the song completes in play-along mode (Watch mode has nothing to
// score against). Offers Retry or Pick another song.

import { JUDGMENT_LABELS } from './judgment-policy.js';
import { calculateGrade, calculateRawScore, calculateDancePoints } from './scoring.js';

class GameOverModalElement extends HTMLElement {
  /** @type {GameOverModalElement | null} */
  static _instance = null;

  static get() {
    if (!GameOverModalElement._instance) {
      GameOverModalElement._instance = document.querySelector('piano-hero-game-over-modal');
    }
    return GameOverModalElement._instance;
  }

  constructor() {
    super();
    this.attachShadow({ mode: 'open' });
    this._onRetry = null;
    this._onPickAnother = null;
  }

  connectedCallback() {
    this.render();
    this.bindEvents();
    this.hidden = true;
  }

  setHandlers({ onRetry, onPickAnother }) {
    this._onRetry = onRetry || null;
    this._onPickAnother = onPickAnother || null;
  }

  /**
   * @param {Object} args
   * @param {number[]} args.tapNoteScores
   * @param {number} args.totalNotes
   * @param {number} args.maxCombo
   * @param {string} args.songLabel
   */
  show({ tapNoteScores, totalNotes, maxCombo, songLabel }) {
    if (!this.shadowRoot.firstChild) return;
    const grade = calculateGrade(tapNoteScores, totalNotes);
    const score = calculateRawScore(tapNoteScores);
    const dp = calculateDancePoints(tapNoteScores);

    const root = this.shadowRoot;
    root.getElementById('song-label').textContent = songLabel || 'Song complete';
    root.getElementById('grade').textContent = grade.letter;
    root.getElementById('grade').style.color = grade.color;
    root.getElementById('percent').textContent = `${grade.dpPercentage}%`;
    root.getElementById('score').textContent = String(score);
    root.getElementById('maxcombo').textContent = String(maxCombo || 0);
    root.getElementById('dp').textContent = `${dp.earned.toFixed(1)} / ${dp.max}`;

    const tally = root.getElementById('tally');
    tally.innerHTML = '';
    for (let i = 0; i < JUDGMENT_LABELS.length; i++) {
      const row = document.createElement('div');
      row.className = `t-row t-${i}`;
      row.innerHTML = `
        <span class="t-label">${JUDGMENT_LABELS[i]}</span>
        <span class="t-count">${tapNoteScores[i] || 0}</span>
      `;
      tally.appendChild(row);
    }

    this.hidden = false;
  }

  hide() {
    this.hidden = true;
  }

  render() {
    this.shadowRoot.innerHTML = `
      <style>
        :host { display: block; }
        :host([hidden]) { display: none; }
        .scrim {
          position: fixed; inset: 0;
          background: rgba(15, 23, 42, 0.85);
          backdrop-filter: blur(6px);
          -webkit-backdrop-filter: blur(6px);
          z-index: 999990;
          display: flex; align-items: center; justify-content: center;
          padding: 24px;
          font-family: system-ui, -apple-system, "Inter", sans-serif;
        }
        .modal {
          background: #0f172a;
          color: #e2e8f0;
          border: 1px solid #1e293b;
          border-radius: 16px;
          padding: 24px 28px;
          width: min(440px, 100%);
          text-align: center;
          box-shadow: 0 30px 60px -10px rgba(0,0,0,0.6);
        }
        .song-label {
          font-size: 13px; color: #94a3b8; margin-bottom: 8px;
        }
        .grade {
          font-size: 64px; font-weight: 900; line-height: 1;
          margin: 6px 0 12px;
        }
        .percent { font-size: 20px; font-weight: 700; color: #e2e8f0; }
        .stats {
          display: grid; grid-template-columns: repeat(2, 1fr);
          gap: 8px 16px;
          padding: 14px 0;
          border-top: 1px solid #1e293b;
          border-bottom: 1px solid #1e293b;
          margin: 14px 0;
        }
        .stat {
          display: flex; justify-content: space-between;
          font-size: 13px;
        }
        .stat .label { color: #94a3b8; }
        .stat .value { color: #e2e8f0; font-weight: 600; }

        #tally { margin: 12px 0; }
        .t-row {
          display: flex; justify-content: space-between;
          font-size: 13px; padding: 2px 6px;
        }
        .t-label { color: #cbd5e1; }
        .t-count { color: #e2e8f0; font-weight: 600; }
        .t-0 .t-label { color: #fbbf24; }
        .t-1 .t-label { color: #34d399; }
        .t-2 .t-label { color: #60a5fa; }
        .t-3 .t-label { color: #fb923c; }
        .t-4 .t-label { color: #f87171; }

        .actions { display: flex; gap: 8px; margin-top: 16px; justify-content: center; }
        button {
          background: #1e293b; color: #e2e8f0;
          border: 1px solid #334155; border-radius: 8px;
          padding: 10px 20px; font: inherit; font-weight: 600;
          cursor: pointer;
        }
        button:hover { border-color: #6366f1; }
        button.primary { background: #6366f1; border-color: #6366f1; color: white; }
        button.primary:hover { background: #4f46e5; }
      </style>
      <div class="scrim">
        <div class="modal" role="dialog" aria-modal="true" aria-labelledby="grade">
          <div class="song-label" id="song-label">Song complete</div>
          <div class="grade" id="grade">—</div>
          <div class="percent" id="percent">0.00%</div>
          <div class="stats">
            <div class="stat"><span class="label">Score</span><span id="score" class="value">0</span></div>
            <div class="stat"><span class="label">Max combo</span><span id="maxcombo" class="value">0</span></div>
            <div class="stat"><span class="label">Dance points</span><span id="dp" class="value">0 / 0</span></div>
          </div>
          <div id="tally"></div>
          <div class="actions">
            <button id="pick" type="button">Pick another</button>
            <button id="retry" class="primary" type="button">Retry</button>
          </div>
        </div>
      </div>
    `;
  }

  bindEvents() {
    this.shadowRoot.getElementById('retry').addEventListener('click', () => {
      if (this._onRetry) this._onRetry();
      this.hide();
    });
    this.shadowRoot.getElementById('pick').addEventListener('click', () => {
      if (this._onPickAnother) this._onPickAnother();
      this.hide();
    });
  }
}

customElements.define('piano-hero-game-over-modal', GameOverModalElement);

export { GameOverModalElement };
