/**
 * Percentage Countdown Display Web Component
 * Shows time elapsed as a percentage
 */
import { BaseCountdownDisplay } from './base-display.js';
import { hostStyles, combineStyles } from './shared-styles.js';

class PercentageDisplay extends BaseCountdownDisplay {
  render() {
    this.shadowRoot.innerHTML = `
      <style>
        ${combineStyles(hostStyles(120))}

        .percentage-display {
          display: flex;
          align-items: baseline;
          gap: 8px;
        }

        .percentage-value {
          font-family: 'Orbitron', monospace;
          font-size: clamp(3rem, 12vw, 6rem);
          font-weight: 700;
          color: #f8fafc;
          text-shadow: 0 0 40px rgba(245, 158, 11, 0.4);
        }

        .percentage-symbol {
          font-family: 'Orbitron', monospace;
          font-size: clamp(1.5rem, 5vw, 2.5rem);
          color: #f59e0b;
        }

        .percentage-label {
          color: #64748b;
          font-size: 0.9rem;
          margin-top: 8px;
          font-family: 'Outfit', sans-serif;
        }
      </style>

      <div class="percentage-display">
        <span class="percentage-value" id="value">0.0000</span>
        <span class="percentage-symbol">%</span>
      </div>
      <p class="percentage-label">time elapsed</p>
    `;

    this.valueEl = this.shadowRoot.getElementById('value');
  }

  _onUpdate(data) {
    const { percentElapsed } = data;
    this.updateValue(this.valueEl, percentElapsed.toFixed(4));
  }
}

customElements.define('percentage-display', PercentageDisplay);
export default PercentageDisplay;
