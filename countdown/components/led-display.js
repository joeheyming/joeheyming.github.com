/**
 * LED Dot Matrix Display - Retro LED sign style
 */
import { BaseCountdownDisplay } from './base-display.js';
import { localeService } from '../i18n/locale-service.js';

// 5x7 LED patterns for digits 0-9
const DIGIT_PATTERNS = {
  0: ['01110', '10001', '10011', '10101', '11001', '10001', '01110'],
  1: ['00100', '01100', '00100', '00100', '00100', '00100', '01110'],
  2: ['01110', '10001', '00001', '00110', '01000', '10000', '11111'],
  3: ['01110', '10001', '00001', '00110', '00001', '10001', '01110'],
  4: ['00010', '00110', '01010', '10010', '11111', '00010', '00010'],
  5: ['11111', '10000', '11110', '00001', '00001', '10001', '01110'],
  6: ['00110', '01000', '10000', '11110', '10001', '10001', '01110'],
  7: ['11111', '00001', '00010', '00100', '01000', '01000', '01000'],
  8: ['01110', '10001', '10001', '01110', '10001', '10001', '01110'],
  9: ['01110', '10001', '10001', '01111', '00001', '00010', '01100'],
  ':': ['00000', '00100', '00100', '00000', '00100', '00100', '00000']
};

class LedDisplay extends BaseCountdownDisplay {
  constructor() {
    super();
    this._lastData = null;
  }

  getLabel(unit) {
    const label = localeService.str(`units.${unit}`);
    // Abbreviate if longer than 4 chars
    return label.length > 4 ? label.substring(0, 3) : label;
  }

  render() {
    this.shadowRoot.innerHTML = `
      <style>
        :host {
          display: block;
          min-height: 160px;
          width: 100%;
          text-align: center;
        }

        .led-housing {
          background: linear-gradient(145deg, #1a1a1a 0%, #0a0a0a 100%);
          border: 3px solid #333;
          border-radius: 8px;
          padding: 12px 16px;
          box-shadow: 
            inset 0 2px 10px rgba(0,0,0,0.8),
            0 4px 20px rgba(0,0,0,0.5);
          display: inline-flex;
          justify-content: center;
          overflow-x: auto;
          max-width: 100%;
        }

        .led-grid {
          display: inline-flex;
          gap: 6px;
          align-items: center;
          flex-wrap: nowrap;
        }

        .digit-matrix {
          display: grid;
          grid-template-columns: repeat(5, 1fr);
          grid-template-rows: repeat(7, 1fr);
          gap: 1px;
        }

        .led {
          width: 3px;
          height: 3px;
          border-radius: 50%;
          background: #1a0a0a;
          box-shadow: inset 0 1px 2px rgba(0,0,0,0.5);
          transition: all 0.1s ease;
        }

        .led.on {
          background: #ff3333;
          box-shadow: 
            0 0 4px #ff3333,
            0 0 8px #ff3333,
            0 0 12px rgba(255, 51, 51, 0.5);
        }

        .led.on.amber {
          background: #ffaa00;
          box-shadow: 
            0 0 4px #ffaa00,
            0 0 8px #ffaa00,
            0 0 12px rgba(255, 170, 0, 0.5);
        }

        .led.on.green {
          background: #00ff44;
          box-shadow: 
            0 0 4px #00ff44,
            0 0 8px #00ff44,
            0 0 12px rgba(0, 255, 68, 0.5);
        }

        .separator {
          display: flex;
          flex-direction: column;
          gap: 6px;
          padding: 0 2px;
        }

        .sep-dot {
          width: 3px;
          height: 3px;
          border-radius: 50%;
          background: #ffaa00;
          box-shadow: 0 0 6px #ffaa00;
          animation: blink 1s infinite;
        }

        @keyframes blink {
          0%, 100% { opacity: 1; }
          50% { opacity: 0.3; }
        }

        .unit-group {
          display: flex;
          flex-direction: column;
          align-items: center;
        }

        .unit-digits {
          display: flex;
          gap: 1px;
        }

        .label {
          font-family: 'Courier New', monospace;
          font-size: 0.55rem;
          color: #666;
          text-transform: uppercase;
          letter-spacing: 0.05em;
          margin-top: 6px;
        }

        @media (max-width: 500px) {
          .led-housing {
            padding: 8px 10px;
          }
          .led-grid {
            gap: 4px;
          }
          .led {
            width: 2px;
            height: 2px;
          }
          .sep-dot {
            width: 2px;
            height: 2px;
          }
        }
      </style>

      <div class="led-housing">
        <div class="led-grid" id="ledGrid"></div>
      </div>
    `;

    // Cache element reference
    this.ledGrid = this.shadowRoot.getElementById('ledGrid');
  }

  createDigitMatrix(digit, colorClass = '') {
    const pattern = DIGIT_PATTERNS[digit] || DIGIT_PATTERNS['0'];
    const matrix = document.createElement('div');
    matrix.className = 'digit-matrix';

    for (let row = 0; row < 7; row++) {
      for (let col = 0; col < 5; col++) {
        const led = document.createElement('div');
        led.className = 'led';
        if (pattern[row][col] === '1') {
          led.classList.add('on');
          if (colorClass) {
            led.classList.add(colorClass);
          }
        }
        matrix.appendChild(led);
      }
    }

    return matrix;
  }

  createSeparator() {
    const sep = document.createElement('div');
    sep.className = 'separator';
    sep.innerHTML = '<div class="sep-dot"></div><div class="sep-dot"></div>';
    return sep;
  }

  createUnitGroup(value, numDigits, label, colorClass = '') {
    const group = document.createElement('div');
    group.className = 'unit-group';

    const digits = document.createElement('div');
    digits.className = 'unit-digits';

    const valueStr = String(value).padStart(numDigits, '0');
    for (const d of valueStr) {
      digits.appendChild(this.createDigitMatrix(d, colorClass));
    }

    const labelEl = document.createElement('span');
    labelEl.className = 'label';
    labelEl.textContent = label;

    group.appendChild(digits);
    group.appendChild(labelEl);

    return group;
  }

  _onUpdate(data) {
    this._lastData = data;
    const { years = 0, totalDays, hours, minutes, seconds } = data;
    const daysRemaining = this.getDaysRemaining(years, totalDays);

    this.ledGrid.innerHTML = '';

    // Years (if present, 2 digits, amber)
    if (years > 0) {
      this.ledGrid.appendChild(this.createUnitGroup(years, 2, this.getLabel('years'), 'amber'));
      this.ledGrid.appendChild(this.createSeparator());
    }

    // Days (3 digits, amber)
    this.ledGrid.appendChild(
      this.createUnitGroup(daysRemaining, 3, this.getLabel('days'), 'amber')
    );
    this.ledGrid.appendChild(this.createSeparator());

    // Hours (2 digits, green)
    this.ledGrid.appendChild(this.createUnitGroup(hours, 2, this.getLabel('hours'), 'green'));
    this.ledGrid.appendChild(this.createSeparator());

    // Minutes (2 digits, red)
    this.ledGrid.appendChild(this.createUnitGroup(minutes, 2, this.getLabel('minutes'), ''));
    this.ledGrid.appendChild(this.createSeparator());

    // Seconds (2 digits, red)
    this.ledGrid.appendChild(this.createUnitGroup(seconds, 2, this.getLabel('seconds'), ''));
  }

  // Override to re-render display when locale changes
  updateLabels() {
    if (this._lastData) {
      this._onUpdate(this._lastData);
    }
  }
}

customElements.define('led-display', LedDisplay);
export default LedDisplay;
