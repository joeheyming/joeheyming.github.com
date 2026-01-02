/**
 * Decimal Days Countdown Display Web Component
 * Shows total days remaining as a decimal number
 */
import { BaseCountdownDisplay } from './base-display.js';
import { hostStyles, hiddenClass, combineStyles } from './shared-styles.js';

class DecimalDisplay extends BaseCountdownDisplay {
  render() {
    this.shadowRoot.innerHTML = `
      <style>
        ${combineStyles(hostStyles(120), hiddenClass)}

        .decimal-display {
          text-align: center;
        }

        .decimal-value {
          font-family: 'Orbitron', monospace;
          font-size: clamp(2.5rem, 10vw, 5rem);
          font-weight: 700;
          color: #f8fafc;
          text-shadow: 0 0 40px rgba(245, 158, 11, 0.4);
          display: block;
        }

        .decimal-unit {
          font-size: 1rem;
          color: #64748b;
          margin-top: 8px;
          display: block;
          font-family: 'Outfit', sans-serif;
        }
      </style>

      <div class="decimal-display">
        <span class="decimal-value" id="value">0.00000</span>
        <span class="decimal-unit" data-locale-key="units.daysRemaining">${this.t(
          'units.daysRemaining'
        )}</span>
      </div>
    `;

    this.valueEl = this.shadowRoot.getElementById('value');
  }

  _onUpdate(data) {
    const { totalDaysDecimal } = data;
    this.updateValue(this.valueEl, totalDaysDecimal.toFixed(5));
  }
}

customElements.define('decimal-display', DecimalDisplay);
export default DecimalDisplay;
