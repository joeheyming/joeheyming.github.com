/**
 * Standard Countdown Display Web Component
 * Shows Years : Days : Hours : Minutes : Seconds
 */
import { BaseCountdownDisplay } from './base-display.js';
import {
  hostStyles,
  hiddenClass,
  fullscreenStyles,
  mobileGridStyles,
  combineStyles
} from './shared-styles.js';

class StandardDisplay extends BaseCountdownDisplay {
  render() {
    this.shadowRoot.innerHTML = `
      <style>
        ${combineStyles(hostStyles(120), hiddenClass, fullscreenStyles)}

        .countdown-grid {
          display: flex;
          justify-content: center;
          align-items: flex-start;
          gap: 8px;
        }

        .time-unit {
          display: flex;
          flex-direction: column;
          align-items: center;
          min-width: 90px;
          flex-shrink: 0;
        }

        .time-unit.years {
          min-width: 80px;
        }

        .time-unit.days {
          min-width: 120px;
        }

        .time-value {
          font-family: 'Share Tech Mono', ui-monospace, 'Menlo', monospace;
          font-size: clamp(2.5rem, 10vw, 5rem);
          font-weight: 700;
          color: #f8fafc;
          line-height: 1;
          text-shadow: 0 0 40px rgba(245, 158, 11, 0.4);
          font-variant-numeric: tabular-nums;
          letter-spacing: 0.05em;
        }

        :host-context(.countdown-display.fullscreen) .time-value {
          font-size: clamp(4rem, 12vw, 8rem);
        }

        .time-label {
          font-size: 0.8rem;
          color: #64748b;
          text-transform: uppercase;
          letter-spacing: 0.15em;
          margin-top: 8px;
          font-family: 'Outfit', sans-serif;
        }

        :host-context(.countdown-display.fullscreen) .time-label {
          font-size: 1.1rem;
          margin-top: 16px;
        }

        .time-separator {
          font-family: 'Orbitron', monospace;
          font-size: clamp(2rem, 6vw, 3.5rem);
          color: #f59e0b;
          opacity: 0.6;
          animation: blink 1s infinite;
          flex-shrink: 0;
          padding: 0 4px;
          line-height: 1;
          align-self: center;
          margin-bottom: 24px;
        }

        :host-context(.countdown-display.fullscreen) .time-separator {
          font-size: clamp(3rem, 8vw, 5rem);
          margin-bottom: 40px;
        }

        @keyframes blink {
          0%, 100% { opacity: 0.6; }
          50% { opacity: 0.2; }
        }

        /* Mobile styles - must come AFTER base styles */
        ${mobileGridStyles}
      </style>

      <div class="countdown-grid">
        <div class="time-unit years hidden" id="yearsUnit">
          <span class="time-value" id="years">0</span>
          <span class="time-label" data-locale-key="units.years">${this.t('units.years')}</span>
        </div>
        <div class="time-separator hidden" id="yearsSeparator">:</div>
        <div class="time-unit days">
          <span class="time-value" id="days">000</span>
          <span class="time-label" data-locale-key="units.days">${this.t('units.days')}</span>
        </div>
        <div class="time-separator">:</div>
        <div class="time-unit">
          <span class="time-value" id="hours">00</span>
          <span class="time-label" data-locale-key="units.hours">${this.t('units.hours')}</span>
        </div>
        <div class="time-separator">:</div>
        <div class="time-unit">
          <span class="time-value" id="minutes">00</span>
          <span class="time-label" data-locale-key="units.minutes">${this.t('units.minutes')}</span>
        </div>
        <div class="time-separator">:</div>
        <div class="time-unit">
          <span class="time-value" id="seconds">00</span>
          <span class="time-label" data-locale-key="units.seconds">${this.t('units.seconds')}</span>
        </div>
      </div>
    `;

    // Cache element references
    this.yearsUnit = this.shadowRoot.getElementById('yearsUnit');
    this.yearsSeparator = this.shadowRoot.getElementById('yearsSeparator');
    this.yearsEl = this.shadowRoot.getElementById('years');
    this.daysEl = this.shadowRoot.getElementById('days');
    this.hoursEl = this.shadowRoot.getElementById('hours');
    this.minutesEl = this.shadowRoot.getElementById('minutes');
    this.secondsEl = this.shadowRoot.getElementById('seconds');
  }

  _onUpdate(data) {
    const { years, days, totalDays, hours, minutes, seconds } = data;
    const showYears = years > 0;

    this.toggleYearsVisibility(this.yearsUnit, this.yearsSeparator, showYears);

    if (showYears) {
      this.updateValue(this.yearsEl, String(years));
      this.updateValue(this.daysEl, String(days).padStart(3, '0'));
    } else {
      this.updateValue(this.daysEl, String(totalDays).padStart(3, '0'));
    }

    this.updateValue(this.hoursEl, String(hours).padStart(2, '0'));
    this.updateValue(this.minutesEl, String(minutes).padStart(2, '0'));
    this.updateValue(this.secondsEl, String(seconds).padStart(2, '0'));
  }
}

customElements.define('standard-display', StandardDisplay);
export default StandardDisplay;
