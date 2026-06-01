// <piano-hero-score-panel> — live HUD for play-along mode.
//
// Shows: combo, current grade, dance-points percentage, and a tiny
// per-judgment tally (Perfect / Great / Good / Bad / Miss). Hidden in
// Watch mode.

import { JUDGMENT_LABELS } from './judgment-policy.js';
import { calculateGrade, calculateRawScore } from './scoring.js';

class ScorePanelElement extends HTMLElement {
  static get() {
    return document.querySelector('piano-hero-score-panel');
  }

  constructor() {
    super();
    this.attachShadow({ mode: 'open' });
  }

  connectedCallback() {
    this.render();
  }

  /**
   * @param {Object} args
   * @param {number[]} args.tapNoteScores
   * @param {number} args.totalNotes
   * @param {number} args.combo
   * @param {number} args.maxCombo
   */
  update({ tapNoteScores, totalNotes, combo, maxCombo }) {
    if (!this.shadowRoot.firstChild) return;
    const grade = calculateGrade(tapNoteScores, totalNotes);
    const score = calculateRawScore(tapNoteScores);
    const root = this.shadowRoot;
    root.getElementById('grade').textContent = grade.letter;
    root.getElementById('grade').style.color = grade.color;
    root.getElementById('percent').textContent = `${grade.dpPercentage}%`;
    root.getElementById('combo').textContent = String(combo || 0);
    root.getElementById('maxcombo').textContent = String(maxCombo || 0);
    root.getElementById('score').textContent = String(score);
    for (let i = 0; i < JUDGMENT_LABELS.length; i++) {
      const cell = root.getElementById(`tally-${i}`);
      if (cell) cell.textContent = String(tapNoteScores[i] || 0);
    }
  }

  render() {
    const tallyRows = JUDGMENT_LABELS.map(
      (label, i) => `
        <div class="tally-row">
          <span class="tally-label tally-${i}">${label}</span>
          <span id="tally-${i}" class="tally-count">0</span>
        </div>
      `
    ).join('');

    this.shadowRoot.innerHTML = `
      <style>
        :host {
          position: fixed;
          top: 70px; right: 20px;
          z-index: 999970;
          font-family: system-ui, -apple-system, "Inter", sans-serif;
        }
        :host([hidden]) { display: none; }
        .panel {
          background: rgba(15, 23, 42, 0.85);
          color: #e2e8f0;
          backdrop-filter: blur(6px);
          -webkit-backdrop-filter: blur(6px);
          padding: 12px 16px;
          border-radius: 12px;
          border: 1px solid #1e293b;
          min-width: 180px;
          font-variant-numeric: tabular-nums;
        }
        .row {
          display: flex; align-items: baseline; justify-content: space-between;
          gap: 12px; padding: 2px 0;
        }
        .label {
          font-size: 11px; text-transform: uppercase; letter-spacing: 0.08em;
          color: #94a3b8;
        }
        .grade { font-size: 30px; font-weight: 800; line-height: 1; }
        .percent, .score { font-size: 14px; font-weight: 700; color: #e2e8f0; }
        .combo { font-size: 22px; font-weight: 700; color: #fbbf24; }
        .divider { height: 1px; background: #1e293b; margin: 8px 0; }

        .tally-row {
          display: flex; justify-content: space-between;
          font-size: 12px; padding: 1px 0;
        }
        .tally-label { color: #cbd5e1; }
        .tally-count { font-weight: 600; color: #e2e8f0; }
        .tally-0 { color: #fbbf24; }
        .tally-1 { color: #34d399; }
        .tally-2 { color: #60a5fa; }
        .tally-3 { color: #fb923c; }
        .tally-4 { color: #f87171; }
      </style>
      <div class="panel">
        <div class="row">
          <span class="label">Grade</span>
          <span id="grade" class="grade">—</span>
        </div>
        <div class="row">
          <span class="label">Score</span>
          <span id="score" class="score">0</span>
        </div>
        <div class="row">
          <span class="label">Dance %</span>
          <span id="percent" class="percent">0.00%</span>
        </div>
        <div class="row">
          <span class="label">Combo</span>
          <span id="combo" class="combo">0</span>
        </div>
        <div class="row">
          <span class="label">Best</span>
          <span id="maxcombo">0</span>
        </div>
        <div class="divider"></div>
        ${tallyRows}
      </div>
    `;
  }
}

customElements.define('piano-hero-score-panel', ScorePanelElement);

export { ScorePanelElement };
