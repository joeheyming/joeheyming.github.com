/**
 * Analog Clock Countdown Display Web Component
 * Shows time as circular progress rings
 */
import { BaseCountdownDisplay } from './base-display.js';
import { hostStyles, hiddenClass, combineStyles } from './shared-styles.js';

class AnalogDisplay extends BaseCountdownDisplay {
  render() {
    this.shadowRoot.innerHTML = `
      <style>
        ${combineStyles(hostStyles(200), hiddenClass)}

        .analog-clock {
          display: flex;
          justify-content: center;
          align-items: center;
          gap: clamp(12px, 4vw, 32px);
          flex-wrap: wrap;
          padding: 20px;
        }

        .ring-container {
          position: relative;
          display: flex;
          flex-direction: column;
          align-items: center;
          gap: 8px;
        }

        .ring {
          position: relative;
          width: clamp(70px, 18vw, 100px);
          height: clamp(70px, 18vw, 100px);
        }

        .ring svg {
          width: 100%;
          height: 100%;
          transform: rotate(-90deg);
        }

        .ring-bg {
          fill: none;
          stroke: rgba(255, 255, 255, 0.1);
          stroke-width: 6;
        }

        .ring-progress {
          fill: none;
          stroke-width: 6;
          stroke-linecap: round;
          transition: stroke-dashoffset 0.3s ease;
        }

        .ring-years .ring-progress { stroke: url(#gradientYears); }
        .ring-days .ring-progress { stroke: url(#gradientDays); }
        .ring-hours .ring-progress { stroke: url(#gradientHours); }
        .ring-minutes .ring-progress { stroke: url(#gradientMinutes); }
        .ring-seconds .ring-progress { stroke: url(#gradientSeconds); }

        .ring-value {
          position: absolute;
          top: 50%;
          left: 50%;
          transform: translate(-50%, -50%);
          font-family: 'Orbitron', monospace;
          font-size: clamp(1.2rem, 4vw, 1.8rem);
          font-weight: 700;
          color: #f8fafc;
          text-shadow: 0 2px 8px rgba(0, 0, 0, 0.5);
        }

        .ring-label {
          font-family: 'Outfit', sans-serif;
          font-size: 0.7rem;
          color: #94a3b8;
          text-transform: uppercase;
          letter-spacing: 0.1em;
        }

        /* Glow effects */
        .ring-years .ring-value { color: #c084fc; text-shadow: 0 0 20px rgba(192, 132, 252, 0.5); }
        .ring-days .ring-value { color: #f59e0b; text-shadow: 0 0 20px rgba(245, 158, 11, 0.5); }
        .ring-hours .ring-value { color: #22d3ee; text-shadow: 0 0 20px rgba(34, 211, 238, 0.5); }
        .ring-minutes .ring-value { color: #a78bfa; text-shadow: 0 0 20px rgba(167, 139, 250, 0.5); }
        .ring-seconds .ring-value { color: #f472b6; text-shadow: 0 0 20px rgba(244, 114, 182, 0.5); }

        /* Seconds pulse animation */
        .ring-seconds .ring-progress {
          filter: drop-shadow(0 0 4px rgba(244, 114, 182, 0.6));
        }

        @media (max-width: 500px) {
          .analog-clock {
            gap: 16px;
            padding: 10px;
          }
          .ring {
            width: 65px;
            height: 65px;
          }
          .ring-value {
            font-size: 1rem;
          }
        }
      </style>

      <!-- SVG Gradients -->
      <svg width="0" height="0" style="position: absolute;">
        <defs>
          <linearGradient id="gradientYears" x1="0%" y1="0%" x2="100%" y2="100%">
            <stop offset="0%" stop-color="#c084fc" />
            <stop offset="100%" stop-color="#9333ea" />
          </linearGradient>
          <linearGradient id="gradientDays" x1="0%" y1="0%" x2="100%" y2="100%">
            <stop offset="0%" stop-color="#fbbf24" />
            <stop offset="100%" stop-color="#f59e0b" />
          </linearGradient>
          <linearGradient id="gradientHours" x1="0%" y1="0%" x2="100%" y2="100%">
            <stop offset="0%" stop-color="#22d3ee" />
            <stop offset="100%" stop-color="#0891b2" />
          </linearGradient>
          <linearGradient id="gradientMinutes" x1="0%" y1="0%" x2="100%" y2="100%">
            <stop offset="0%" stop-color="#a78bfa" />
            <stop offset="100%" stop-color="#7c3aed" />
          </linearGradient>
          <linearGradient id="gradientSeconds" x1="0%" y1="0%" x2="100%" y2="100%">
            <stop offset="0%" stop-color="#f472b6" />
            <stop offset="100%" stop-color="#ec4899" />
          </linearGradient>
        </defs>
      </svg>

      <div class="analog-clock">
        <div class="ring-container ring-years hidden" id="yearsContainer">
          <div class="ring">
            <svg viewBox="0 0 100 100">
              <circle class="ring-bg" cx="50" cy="50" r="42"></circle>
              <circle class="ring-progress" id="yearsProgress" cx="50" cy="50" r="42" 
                      stroke-dasharray="263.89" stroke-dashoffset="263.89"></circle>
            </svg>
            <div class="ring-value" id="yearsValue">0</div>
          </div>
          <span class="ring-label" data-locale-key="units.years">${this.t('units.years')}</span>
        </div>

        <div class="ring-container ring-days">
          <div class="ring">
            <svg viewBox="0 0 100 100">
              <circle class="ring-bg" cx="50" cy="50" r="42"></circle>
              <circle class="ring-progress" id="daysProgress" cx="50" cy="50" r="42" 
                      stroke-dasharray="263.89" stroke-dashoffset="263.89"></circle>
            </svg>
            <div class="ring-value" id="daysValue">0</div>
          </div>
          <span class="ring-label" data-locale-key="units.days">${this.t('units.days')}</span>
        </div>

        <div class="ring-container ring-hours">
          <div class="ring">
            <svg viewBox="0 0 100 100">
              <circle class="ring-bg" cx="50" cy="50" r="42"></circle>
              <circle class="ring-progress" id="hoursProgress" cx="50" cy="50" r="42" 
                      stroke-dasharray="263.89" stroke-dashoffset="263.89"></circle>
            </svg>
            <div class="ring-value" id="hoursValue">0</div>
          </div>
          <span class="ring-label" data-locale-key="units.hours">${this.t('units.hours')}</span>
        </div>

        <div class="ring-container ring-minutes">
          <div class="ring">
            <svg viewBox="0 0 100 100">
              <circle class="ring-bg" cx="50" cy="50" r="42"></circle>
              <circle class="ring-progress" id="minutesProgress" cx="50" cy="50" r="42" 
                      stroke-dasharray="263.89" stroke-dashoffset="263.89"></circle>
            </svg>
            <div class="ring-value" id="minutesValue">0</div>
          </div>
          <span class="ring-label" data-locale-key="units.minutes">${this.t('units.minutes')}</span>
        </div>

        <div class="ring-container ring-seconds">
          <div class="ring">
            <svg viewBox="0 0 100 100">
              <circle class="ring-bg" cx="50" cy="50" r="42"></circle>
              <circle class="ring-progress" id="secondsProgress" cx="50" cy="50" r="42" 
                      stroke-dasharray="263.89" stroke-dashoffset="263.89"></circle>
            </svg>
            <div class="ring-value" id="secondsValue">0</div>
          </div>
          <span class="ring-label" data-locale-key="units.seconds">${this.t('units.seconds')}</span>
        </div>
      </div>
    `;

    // Cache element references
    this.yearsContainer = this.shadowRoot.getElementById('yearsContainer');
    this.yearsValueEl = this.shadowRoot.getElementById('yearsValue');
    this.daysValueEl = this.shadowRoot.getElementById('daysValue');
    this.hoursValueEl = this.shadowRoot.getElementById('hoursValue');
    this.minutesValueEl = this.shadowRoot.getElementById('minutesValue');
    this.secondsValueEl = this.shadowRoot.getElementById('secondsValue');
  }

  setProgress(elementId, value, max) {
    const circle = this.shadowRoot.getElementById(elementId);
    if (!circle) return;

    const circumference = 2 * Math.PI * 42; // r=42
    const progress = value / max;
    const offset = circumference * (1 - progress);
    circle.style.strokeDashoffset = offset;
  }

  _onUpdate(data) {
    const { years = 0, totalDays, hours, minutes, seconds } = data;
    const showYears = years > 0;
    const daysRemaining = this.getDaysRemaining(years, totalDays);

    // Show/hide years
    this.toggleYearsVisibility(this.yearsContainer, null, showYears);

    // Update values
    this.updateValue(this.yearsValueEl, String(years));
    this.updateValue(this.daysValueEl, String(daysRemaining));
    this.updateValue(this.hoursValueEl, String(hours));
    this.updateValue(this.minutesValueEl, String(minutes));
    this.updateValue(this.secondsValueEl, String(seconds));

    // Update progress rings
    this.setProgress('yearsProgress', years % 10, 10);
    this.setProgress('daysProgress', daysRemaining, 365);
    this.setProgress('hoursProgress', hours, 24);
    this.setProgress('minutesProgress', minutes, 60);
    this.setProgress('secondsProgress', seconds, 60);
  }
}

customElements.define('analog-display', AnalogDisplay);
export default AnalogDisplay;
