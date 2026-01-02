/**
 * Bar Chart Display - Shows countdown as animated horizontal bars
 */
import { BaseCountdownDisplay } from './base-display.js';
import { hostStyles, hiddenClass, combineStyles } from './shared-styles.js';

class BarDisplay extends BaseCountdownDisplay {
  render() {
    this.shadowRoot.innerHTML = `
      <style>
        ${combineStyles(hostStyles(180), hiddenClass)}
        
        :host {
          width: 100%;
        }

        .bar-container {
          width: 100%;
          max-width: 600px;
          display: flex;
          flex-direction: column;
          gap: 16px;
          padding: 20px;
        }

        :host-context(.countdown-display.fullscreen) .bar-container {
          max-width: 900px;
          gap: 24px;
          padding: 30px;
        }

        .bar-row {
          display: grid;
          grid-template-columns: 80px 1fr 60px;
          align-items: center;
          gap: 16px;
        }

        :host-context(.countdown-display.fullscreen) .bar-row {
          grid-template-columns: 120px 1fr 80px;
          gap: 24px;
        }

        .bar-label {
          font-family: 'Outfit', sans-serif;
          font-size: 0.85rem;
          color: #94a3b8;
          text-transform: uppercase;
          letter-spacing: 0.1em;
          text-align: right;
        }

        :host-context(.countdown-display.fullscreen) .bar-label {
          font-size: 1.2rem;
        }

        .bar-track {
          height: 28px;
          background: rgba(255, 255, 255, 0.1);
          border-radius: 14px;
          overflow: hidden;
          position: relative;
        }

        :host-context(.countdown-display.fullscreen) .bar-track {
          height: 48px;
          border-radius: 24px;
        }

        .bar-fill {
          height: 100%;
          border-radius: 14px;
          transition: width 0.3s ease;
          position: relative;
          overflow: hidden;
        }

        :host-context(.countdown-display.fullscreen) .bar-fill {
          border-radius: 24px;
        }

        .bar-fill::after {
          content: '';
          position: absolute;
          top: 0;
          left: 0;
          right: 0;
          height: 50%;
          background: linear-gradient(180deg, rgba(255,255,255,0.3) 0%, transparent 100%);
          border-radius: 14px 14px 0 0;
        }

        :host-context(.countdown-display.fullscreen) .bar-fill::after {
          border-radius: 24px 24px 0 0;
        }

        .bar-years .bar-fill {
          background: linear-gradient(90deg, #9333ea 0%, #c084fc 100%);
          box-shadow: 0 0 20px rgba(147, 51, 234, 0.5);
        }

        .bar-days .bar-fill {
          background: linear-gradient(90deg, #d97706 0%, #fbbf24 100%);
          box-shadow: 0 0 20px rgba(217, 119, 6, 0.5);
        }

        .bar-hours .bar-fill {
          background: linear-gradient(90deg, #0891b2 0%, #22d3ee 100%);
          box-shadow: 0 0 20px rgba(8, 145, 178, 0.5);
        }

        .bar-minutes .bar-fill {
          background: linear-gradient(90deg, #7c3aed 0%, #a78bfa 100%);
          box-shadow: 0 0 20px rgba(124, 58, 237, 0.5);
        }

        .bar-seconds .bar-fill {
          background: linear-gradient(90deg, #db2777 0%, #f472b6 100%);
          box-shadow: 0 0 20px rgba(219, 39, 119, 0.5);
          animation: pulse 1s infinite;
        }

        @keyframes pulse {
          0%, 100% { opacity: 1; }
          50% { opacity: 0.85; }
        }

        .bar-value {
          font-family: 'Orbitron', monospace;
          font-size: 1.1rem;
          font-weight: 600;
          color: #f8fafc;
          text-align: left;
        }

        :host-context(.countdown-display.fullscreen) .bar-value {
          font-size: 1.8rem;
        }

        @media (max-width: 400px) {
          .bar-row {
            grid-template-columns: 50px 1fr 40px;
            gap: 8px;
          }
          .bar-label {
            font-size: 0.65rem;
          }
          .bar-value {
            font-size: 0.85rem;
          }
        }
      </style>

      <div class="bar-container">
        <div class="bar-row bar-years hidden" id="yearsRow">
          <span class="bar-label" data-locale-key="units.years">${this.t('units.years')}</span>
          <div class="bar-track">
            <div class="bar-fill" id="yearsFill" style="width: 0%"></div>
          </div>
          <span class="bar-value" id="yearsValue">0</span>
        </div>

        <div class="bar-row bar-days">
          <span class="bar-label" data-locale-key="units.days">${this.t('units.days')}</span>
          <div class="bar-track">
            <div class="bar-fill" id="daysFill" style="width: 0%"></div>
          </div>
          <span class="bar-value" id="daysValue">0</span>
        </div>

        <div class="bar-row bar-hours">
          <span class="bar-label" data-locale-key="units.hours">${this.t('units.hours')}</span>
          <div class="bar-track">
            <div class="bar-fill" id="hoursFill" style="width: 0%"></div>
          </div>
          <span class="bar-value" id="hoursValue">0</span>
        </div>

        <div class="bar-row bar-minutes">
          <span class="bar-label" data-locale-key="units.minutes">${this.t('units.minutes')}</span>
          <div class="bar-track">
            <div class="bar-fill" id="minutesFill" style="width: 0%"></div>
          </div>
          <span class="bar-value" id="minutesValue">0</span>
        </div>

        <div class="bar-row bar-seconds">
          <span class="bar-label" data-locale-key="units.seconds">${this.t('units.seconds')}</span>
          <div class="bar-track">
            <div class="bar-fill" id="secondsFill" style="width: 0%"></div>
          </div>
          <span class="bar-value" id="secondsValue">0</span>
        </div>
      </div>
    `;

    // Cache element references
    this.yearsRow = this.shadowRoot.getElementById('yearsRow');
    this.yearsFill = this.shadowRoot.getElementById('yearsFill');
    this.yearsValueEl = this.shadowRoot.getElementById('yearsValue');
    this.daysFill = this.shadowRoot.getElementById('daysFill');
    this.daysValueEl = this.shadowRoot.getElementById('daysValue');
    this.hoursFill = this.shadowRoot.getElementById('hoursFill');
    this.hoursValueEl = this.shadowRoot.getElementById('hoursValue');
    this.minutesFill = this.shadowRoot.getElementById('minutesFill');
    this.minutesValueEl = this.shadowRoot.getElementById('minutesValue');
    this.secondsFill = this.shadowRoot.getElementById('secondsFill');
    this.secondsValueEl = this.shadowRoot.getElementById('secondsValue');
  }

  _onUpdate(data) {
    const { years = 0, totalDays, hours, minutes, seconds } = data;
    const daysRemaining = this.getDaysRemaining(years, totalDays);

    // Years
    this.toggleYearsVisibility(this.yearsRow, null, years > 0);
    if (years > 0) {
      this.updateValue(this.yearsValueEl, String(years));
      this.yearsFill.style.width = `${(years % 10) * 10}%`;
    }

    // Days
    this.updateValue(this.daysValueEl, String(daysRemaining));
    this.daysFill.style.width = `${(daysRemaining / 365) * 100}%`;

    // Hours
    this.updateValue(this.hoursValueEl, String(hours));
    this.hoursFill.style.width = `${(hours / 24) * 100}%`;

    // Minutes
    this.updateValue(this.minutesValueEl, String(minutes));
    this.minutesFill.style.width = `${(minutes / 60) * 100}%`;

    // Seconds
    this.updateValue(this.secondsValueEl, String(seconds));
    this.secondsFill.style.width = `${(seconds / 60) * 100}%`;
  }
}

customElements.define('bar-display', BarDisplay);
export default BarDisplay;
