/**
 * Thermometer Display - Vertical gauge showing countdown progress
 */
import { BaseCountdownDisplay } from './base-display.js';
import { hostStyles, hiddenClass, combineStyles } from './shared-styles.js';

class ThermometerDisplay extends BaseCountdownDisplay {
  render() {
    this.shadowRoot.innerHTML = `
      <style>
        ${combineStyles(hostStyles(260), hiddenClass)}

        .thermo-container {
          display: flex;
          align-items: center;
          gap: 24px;
        }

        .thermometer {
          position: relative;
          width: 50px;
          height: 200px;
        }

        /* Tube */
        .tube {
          position: absolute;
          left: 50%;
          transform: translateX(-50%);
          width: 24px;
          height: 160px;
          top: 0;
          background: rgba(255, 255, 255, 0.1);
          border: 3px solid rgba(255, 255, 255, 0.2);
          border-radius: 12px 12px 0 0;
          overflow: hidden;
        }

        .tube-fill {
          position: absolute;
          bottom: 0;
          left: 0;
          right: 0;
          background: linear-gradient(180deg, 
            #ef4444 0%, 
            #f97316 25%, 
            #fbbf24 50%, 
            #22c55e 75%,
            #22d3ee 100%);
          transition: height 0.5s ease;
          border-radius: 0 0 8px 8px;
        }

        .tube-fill::after {
          content: '';
          position: absolute;
          left: 2px;
          top: 0;
          bottom: 0;
          width: 6px;
          background: linear-gradient(90deg, rgba(255,255,255,0.3), transparent);
          border-radius: 3px;
        }

        /* Bulb */
        .bulb {
          position: absolute;
          bottom: 0;
          left: 50%;
          transform: translateX(-50%);
          width: 44px;
          height: 44px;
          background: #ef4444;
          border: 3px solid rgba(255, 255, 255, 0.2);
          border-radius: 50%;
          box-shadow: 
            inset -5px -5px 15px rgba(0,0,0,0.3),
            inset 5px 5px 15px rgba(255,255,255,0.1),
            0 0 20px rgba(239, 68, 68, 0.4);
        }

        .bulb::after {
          content: '';
          position: absolute;
          top: 8px;
          left: 8px;
          width: 10px;
          height: 10px;
          background: rgba(255,255,255,0.4);
          border-radius: 50%;
        }

        /* Scale marks */
        .scale {
          position: absolute;
          right: -8px;
          top: 0;
          height: 160px;
          display: flex;
          flex-direction: column;
          justify-content: space-between;
        }

        .mark {
          display: flex;
          align-items: center;
          gap: 4px;
        }

        .mark-line {
          width: 8px;
          height: 2px;
          background: rgba(255, 255, 255, 0.3);
        }

        .mark-label {
          font-family: 'Outfit', sans-serif;
          font-size: 0.6rem;
          color: #64748b;
        }

        /* Time info */
        .time-info {
          display: flex;
          flex-direction: column;
          gap: 12px;
        }

        .time-row {
          display: flex;
          align-items: baseline;
          gap: 8px;
        }

        .time-value {
          font-family: 'Orbitron', monospace;
          font-size: 1.8rem;
          font-weight: 700;
          color: #f8fafc;
          min-width: 80px;
          text-align: right;
        }

        .time-label {
          font-family: 'Outfit', sans-serif;
          font-size: 0.8rem;
          color: #94a3b8;
          text-transform: uppercase;
        }

        .progress-text {
          font-family: 'Outfit', sans-serif;
          font-size: 1.2rem;
          color: #fbbf24;
          text-align: center;
          margin-top: 8px;
        }

        @media (max-width: 400px) {
          .thermo-container {
            gap: 16px;
          }
          .thermometer {
            height: 160px;
          }
          .tube {
            height: 120px;
          }
          .scale {
            height: 120px;
          }
        }
      </style>

      <div class="thermo-container">
        <div class="thermometer">
          <div class="tube">
            <div class="tube-fill" id="tubeFill" style="height: 50%"></div>
          </div>
          <div class="scale">
            <div class="mark"><div class="mark-line"></div><span class="mark-label">100%</span></div>
            <div class="mark"><div class="mark-line"></div><span class="mark-label">75%</span></div>
            <div class="mark"><div class="mark-line"></div><span class="mark-label">50%</span></div>
            <div class="mark"><div class="mark-line"></div><span class="mark-label">25%</span></div>
            <div class="mark"><div class="mark-line"></div><span class="mark-label">0%</span></div>
          </div>
          <div class="bulb"></div>
        </div>

        <div class="time-info">
          <div class="time-row hidden" id="yearsRow">
            <span class="time-value" id="yearsValue">0</span>
            <span class="time-label" data-locale-key="units.years">${this.t('units.years')}</span>
          </div>
          <div class="time-row">
            <span class="time-value" id="daysValue">0</span>
            <span class="time-label" data-locale-key="units.days">${this.t('units.days')}</span>
          </div>
          <div class="time-row">
            <span class="time-value" id="hoursValue">0</span>
            <span class="time-label" data-locale-key="units.hours">${this.t('units.hours')}</span>
          </div>
          <div class="time-row">
            <span class="time-value" id="minutesValue">0</span>
            <span class="time-label" data-locale-key="units.minutes">${this.t(
              'units.minutes'
            )}</span>
          </div>
          <div class="time-row">
            <span class="time-value" id="secondsValue">0</span>
            <span class="time-label" data-locale-key="units.seconds">${this.t(
              'units.seconds'
            )}</span>
          </div>
          <div class="progress-text" id="progressText">50% remaining</div>
        </div>
      </div>
    `;

    // Cache element references
    this.tubeFill = this.shadowRoot.getElementById('tubeFill');
    this.yearsRow = this.shadowRoot.getElementById('yearsRow');
    this.yearsValueEl = this.shadowRoot.getElementById('yearsValue');
    this.daysValueEl = this.shadowRoot.getElementById('daysValue');
    this.hoursValueEl = this.shadowRoot.getElementById('hoursValue');
    this.minutesValueEl = this.shadowRoot.getElementById('minutesValue');
    this.secondsValueEl = this.shadowRoot.getElementById('secondsValue');
    this.progressText = this.shadowRoot.getElementById('progressText');
  }

  _onUpdate(data) {
    const { years = 0, totalDays, hours, minutes, seconds, percentElapsed } = data;
    const daysRemaining = this.getDaysRemaining(years, totalDays);
    const remaining = 100 - (percentElapsed || 0);

    // Update thermometer fill (inverted - full = more time remaining)
    this.tubeFill.style.height = `${remaining}%`;

    // Update years visibility
    this.toggleYearsVisibility(this.yearsRow, null, years > 0);
    this.updateValue(this.yearsValueEl, String(years));

    // Update values
    this.updateValue(this.daysValueEl, String(daysRemaining));
    this.updateValue(this.hoursValueEl, String(hours));
    this.updateValue(this.minutesValueEl, String(minutes));
    this.updateValue(this.secondsValueEl, String(seconds));

    // Update progress text
    this.progressText.textContent = `${remaining.toFixed(1)}% remaining`;
  }
}

customElements.define('thermometer-display', ThermometerDisplay);
export default ThermometerDisplay;
