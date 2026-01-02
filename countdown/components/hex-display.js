/**
 * Hexadecimal Display - Time in hex format for the nerdy
 */
import { BaseCountdownDisplay } from './base-display.js';
import { hostStyles, hiddenClass, combineStyles } from './shared-styles.js';

class HexDisplay extends BaseCountdownDisplay {
  render() {
    this.shadowRoot.innerHTML = `
      <style>
        ${combineStyles(hostStyles(140), hiddenClass)}

        .hex-container {
          background: #0a0a0a;
          border: 2px solid #22c55e;
          border-radius: 8px;
          padding: 20px 32px;
          font-family: 'Fira Code', 'Courier New', monospace;
          box-shadow: 
            0 0 20px rgba(34, 197, 94, 0.2),
            inset 0 0 30px rgba(0, 0, 0, 0.5);
          min-width: 320px;
        }

        .terminal-header {
          display: flex;
          align-items: center;
          gap: 8px;
          margin-bottom: 12px;
          padding-bottom: 8px;
          border-bottom: 1px solid #333;
        }

        .terminal-dot {
          width: 8px;
          height: 8px;
          border-radius: 50%;
        }

        .terminal-dot.red { background: #ef4444; }
        .terminal-dot.yellow { background: #fbbf24; }
        .terminal-dot.green { background: #22c55e; }

        .terminal-title {
          font-size: 0.7rem;
          color: #666;
          margin-left: auto;
        }

        .hex-row {
          display: flex;
          align-items: center;
          margin: 8px 0;
        }

        .prompt {
          color: #22c55e;
          margin-right: 8px;
        }

        .label {
          color: #64748b;
          min-width: 80px;
        }

        .hex-value {
          color: #22d3ee;
          font-weight: 600;
          font-size: 1.1rem;
        }

        .prefix {
          color: #a78bfa;
        }

        .decimal {
          color: #666;
          font-size: 0.8rem;
          margin-left: 12px;
        }

        .total-row {
          margin-top: 16px;
          padding-top: 12px;
          border-top: 1px dashed #333;
        }

        .total-value {
          color: #f472b6;
          font-size: 1.2rem;
        }

        .blink {
          animation: blink 1s step-end infinite;
        }

        @keyframes blink {
          0%, 100% { opacity: 1; }
          50% { opacity: 0; }
        }

        @media (max-width: 400px) {
          .hex-container {
            padding: 12px 16px;
            min-width: auto;
          }
          .label {
            min-width: 60px;
            font-size: 0.8rem;
          }
          .decimal {
            display: none;
          }
        }
      </style>

      <div class="hex-container">
        <div class="terminal-header">
          <div class="terminal-dot red"></div>
          <div class="terminal-dot yellow"></div>
          <div class="terminal-dot green"></div>
          <span class="terminal-title">countdown.hex</span>
        </div>

        <div class="hex-row hidden" id="yearsRow">
          <span class="prompt">❯</span>
          <span class="label" data-locale-key="units.years" data-locale-suffix=":">${this.t(
            'units.years'
          )}:</span>
          <span class="hex-value"><span class="prefix">0x</span><span id="yearsHex">00</span></span>
          <span class="decimal" id="yearsDec">(0)</span>
        </div>

        <div class="hex-row">
          <span class="prompt">❯</span>
          <span class="label" data-locale-key="units.days" data-locale-suffix=":">${this.t(
            'units.days'
          )}:</span>
          <span class="hex-value"><span class="prefix">0x</span><span id="daysHex">000</span></span>
          <span class="decimal" id="daysDec">(0)</span>
        </div>

        <div class="hex-row">
          <span class="prompt">❯</span>
          <span class="label" data-locale-key="units.hours" data-locale-suffix=":">${this.t(
            'units.hours'
          )}:</span>
          <span class="hex-value"><span class="prefix">0x</span><span id="hoursHex">00</span></span>
          <span class="decimal" id="hoursDec">(0)</span>
        </div>

        <div class="hex-row">
          <span class="prompt">❯</span>
          <span class="label" data-locale-key="units.minutes" data-locale-suffix=":">${this.t(
            'units.minutes'
          )}:</span>
          <span class="hex-value"><span class="prefix">0x</span><span id="minutesHex">00</span></span>
          <span class="decimal" id="minutesDec">(0)</span>
        </div>

        <div class="hex-row">
          <span class="prompt">❯</span>
          <span class="label" data-locale-key="units.seconds" data-locale-suffix=":">${this.t(
            'units.seconds'
          )}:</span>
          <span class="hex-value"><span class="prefix">0x</span><span id="secondsHex">00</span></span>
          <span class="decimal" id="secondsDec">(0)</span>
        </div>

        <div class="hex-row total-row">
          <span class="prompt">❯</span>
          <span class="label" data-locale-key="units.totalSeconds" data-locale-suffix=":">${this.t(
            'units.totalSeconds'
          )}:</span>
          <span class="hex-value total-value"><span class="prefix">0x</span><span id="totalHex">0</span></span>
        </div>
      </div>
    `;

    // Cache element references
    this.yearsRow = this.shadowRoot.getElementById('yearsRow');
    this.yearsHex = this.shadowRoot.getElementById('yearsHex');
    this.yearsDec = this.shadowRoot.getElementById('yearsDec');
    this.daysHex = this.shadowRoot.getElementById('daysHex');
    this.daysDec = this.shadowRoot.getElementById('daysDec');
    this.hoursHex = this.shadowRoot.getElementById('hoursHex');
    this.hoursDec = this.shadowRoot.getElementById('hoursDec');
    this.minutesHex = this.shadowRoot.getElementById('minutesHex');
    this.minutesDec = this.shadowRoot.getElementById('minutesDec');
    this.secondsHex = this.shadowRoot.getElementById('secondsHex');
    this.secondsDec = this.shadowRoot.getElementById('secondsDec');
    this.totalHex = this.shadowRoot.getElementById('totalHex');
  }

  toHex(num, pad = 2) {
    return num.toString(16).toUpperCase().padStart(pad, '0');
  }

  _onUpdate(data) {
    const { years = 0, totalDays, hours, minutes, seconds, totalSeconds } = data;
    const daysRemaining = this.getDaysRemaining(years, totalDays);

    // Years
    this.toggleYearsVisibility(this.yearsRow, null, years > 0);
    if (years > 0) {
      this.updateValue(this.yearsHex, this.toHex(years));
      this.yearsDec.textContent = `(${years})`;
    }

    // Days
    this.updateValue(this.daysHex, this.toHex(daysRemaining, 3));
    this.daysDec.textContent = `(${daysRemaining})`;

    // Hours
    this.updateValue(this.hoursHex, this.toHex(hours));
    this.hoursDec.textContent = `(${hours})`;

    // Minutes
    this.updateValue(this.minutesHex, this.toHex(minutes));
    this.minutesDec.textContent = `(${minutes})`;

    // Seconds
    this.updateValue(this.secondsHex, this.toHex(seconds));
    this.secondsDec.textContent = `(${seconds})`;

    // Total seconds
    this.updateValue(this.totalHex, this.toHex(totalSeconds, 8));
  }
}

customElements.define('hex-display', HexDisplay);
export default HexDisplay;
