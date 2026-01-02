/**
 * Roman Numerals Display - Shows countdown in Roman numerals
 * Now with proper locale support for labels
 */
import { BaseCountdownDisplay } from './base-display.js';
import { hostStyles, hiddenClass, combineStyles } from './shared-styles.js';

class RomanDisplay extends BaseCountdownDisplay {
  render() {
    this.shadowRoot.innerHTML = `
      <style>
        ${combineStyles(hostStyles(140), hiddenClass)}

        .roman-container {
          display: flex;
          justify-content: center;
          align-items: flex-start;
          gap: clamp(16px, 5vw, 40px);
          flex-wrap: wrap;
          padding: 20px;
        }

        .roman-unit {
          display: flex;
          flex-direction: column;
          align-items: center;
          gap: 8px;
        }

        .roman-value {
          font-family: 'Cinzel', 'Times New Roman', serif;
          font-size: clamp(1.5rem, 5vw, 2.5rem);
          font-weight: 700;
          color: #fbbf24;
          text-shadow: 
            0 0 20px rgba(251, 191, 36, 0.4),
            2px 2px 4px rgba(0, 0, 0, 0.5);
          letter-spacing: 0.05em;
          text-align: center;
        }

        /* Fixed widths to prevent layout shift */
        .roman-unit.years .roman-value { width: 80px; }
        .roman-unit.days .roman-value { width: 130px; }
        .roman-unit.hours .roman-value { width: 80px; }
        .roman-unit.minutes .roman-value { width: 100px; }
        .roman-unit.seconds .roman-value { width: 100px; }

        .roman-label {
          font-family: 'Cinzel', serif;
          font-size: 0.7rem;
          color: #a78bfa;
          text-transform: uppercase;
          letter-spacing: 0.2em;
        }

        .separator {
          font-family: 'Cinzel', serif;
          font-size: clamp(1.5rem, 5vw, 2.5rem);
          color: #64748b;
          margin-top: -4px;
        }

        /* Laurel wreath decoration */
        .wreath {
          position: relative;
        }

        .wreath::before,
        .wreath::after {
          content: '🌿';
          position: absolute;
          top: 50%;
          transform: translateY(-50%);
          font-size: 1.5rem;
          opacity: 0.6;
        }

        .wreath::before {
          left: -30px;
          transform: translateY(-50%) scaleX(-1);
        }

        .wreath::after {
          right: -30px;
        }

        @media (max-width: 500px) {
          .roman-container {
            gap: 8px;
          }
          .wreath::before,
          .wreath::after {
            display: none;
          }
          .roman-unit.years .roman-value { width: 60px; }
          .roman-unit.days .roman-value { width: 90px; }
          .roman-unit.hours .roman-value { width: 60px; }
          .roman-unit.minutes .roman-value { width: 70px; }
          .roman-unit.seconds .roman-value { width: 70px; }
        }
      </style>

      <div class="roman-container">
        <div class="roman-unit years hidden" id="yearsUnit">
          <div class="roman-value wreath" id="yearsValue">–</div>
          <span class="roman-label" data-locale-key="units.years">${this.t('units.years')}</span>
        </div>
        <span class="separator hidden" id="yearsSep">·</span>
        
        <div class="roman-unit days">
          <div class="roman-value" id="daysValue">–</div>
          <span class="roman-label" data-locale-key="units.days">${this.t('units.days')}</span>
        </div>
        <span class="separator">·</span>
        
        <div class="roman-unit hours">
          <div class="roman-value" id="hoursValue">–</div>
          <span class="roman-label" data-locale-key="units.hours">${this.t('units.hours')}</span>
        </div>
        <span class="separator">·</span>
        
        <div class="roman-unit minutes">
          <div class="roman-value" id="minutesValue">–</div>
          <span class="roman-label" data-locale-key="units.minutes">${this.t(
            'units.minutes'
          )}</span>
        </div>
        <span class="separator">·</span>
        
        <div class="roman-unit seconds">
          <div class="roman-value" id="secondsValue">–</div>
          <span class="roman-label" data-locale-key="units.seconds">${this.t(
            'units.seconds'
          )}</span>
        </div>
      </div>
    `;

    // Cache element references
    this.yearsUnit = this.shadowRoot.getElementById('yearsUnit');
    this.yearsSep = this.shadowRoot.getElementById('yearsSep');
    this.yearsValueEl = this.shadowRoot.getElementById('yearsValue');
    this.daysValueEl = this.shadowRoot.getElementById('daysValue');
    this.hoursValueEl = this.shadowRoot.getElementById('hoursValue');
    this.minutesValueEl = this.shadowRoot.getElementById('minutesValue');
    this.secondsValueEl = this.shadowRoot.getElementById('secondsValue');
  }

  toRoman(num) {
    if (num === 0) return '–'; // Em dash for zero
    if (num > 3999) return num.toString(); // Too large for standard Roman

    const romanNumerals = [
      ['M', 1000],
      ['CM', 900],
      ['D', 500],
      ['CD', 400],
      ['C', 100],
      ['XC', 90],
      ['L', 50],
      ['XL', 40],
      ['X', 10],
      ['IX', 9],
      ['V', 5],
      ['IV', 4],
      ['I', 1]
    ];

    let result = '';
    for (const [numeral, value] of romanNumerals) {
      while (num >= value) {
        result += numeral;
        num -= value;
      }
    }
    return result;
  }

  _onUpdate(data) {
    const { years = 0, totalDays, hours, minutes, seconds } = data;
    const showYears = years > 0;
    const daysRemaining = this.getDaysRemaining(years, totalDays);

    this.toggleYearsVisibility(this.yearsUnit, this.yearsSep, showYears);

    if (showYears) {
      this.updateValue(this.yearsValueEl, this.toRoman(years));
    }

    this.updateValue(this.daysValueEl, this.toRoman(daysRemaining));
    this.updateValue(this.hoursValueEl, this.toRoman(hours));
    this.updateValue(this.minutesValueEl, this.toRoman(minutes));
    this.updateValue(this.secondsValueEl, this.toRoman(seconds));
  }
}

customElements.define('roman-display', RomanDisplay);
export default RomanDisplay;
