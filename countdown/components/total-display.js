/**
 * Total Seconds Countdown Display Web Component
 * Shows total seconds remaining with alternatives
 */
import { BaseCountdownDisplay } from './base-display.js';
import { hostStyles, hiddenClass, combineStyles } from './shared-styles.js';

class TotalDisplay extends BaseCountdownDisplay {
  render() {
    this.shadowRoot.innerHTML = `
      <style>
        ${combineStyles(hostStyles(120), hiddenClass)}

        .total-display {
          text-align: center;
        }

        .total-value {
          font-family: 'Orbitron', monospace;
          font-size: clamp(2rem, 8vw, 4rem);
          font-weight: 700;
          color: #f8fafc;
          text-shadow: 0 0 40px rgba(245, 158, 11, 0.4);
          display: block;
          letter-spacing: 2px;
        }

        .total-unit {
          font-size: 1rem;
          color: #f59e0b;
          margin-left: 8px;
          font-family: 'Outfit', sans-serif;
        }

        .total-alt {
          color: #64748b;
          font-size: 0.85rem;
          margin-top: 12px;
          font-family: 'Outfit', sans-serif;
        }
      </style>

      <div class="total-display">
        <span class="total-value" id="value">0</span>
        <span class="total-unit" data-locale-key="units.seconds">${this.t('units.seconds')}</span>
      </div>
      <p class="total-alt" id="alt"></p>
    `;

    this.valueEl = this.shadowRoot.getElementById('value');
    this.altEl = this.shadowRoot.getElementById('alt');
  }

  _onUpdate(data) {
    const { totalSeconds } = data;
    const totalMins = Math.floor(totalSeconds / 60);
    const totalHours = Math.floor(totalSeconds / 3600);

    const minutesWord = this.t('units.minutes');
    const hoursWord = this.t('units.hours');

    this.updateValue(this.valueEl, totalSeconds.toLocaleString());
    this.altEl.textContent = `${totalMins.toLocaleString()} ${minutesWord} • ${totalHours.toLocaleString()} ${hoursWord}`;
  }
}

customElements.define('total-display', TotalDisplay);
export default TotalDisplay;
