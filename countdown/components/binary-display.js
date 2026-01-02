/**
 * Binary Countdown Display Web Component
 * Shows time remaining as a row of LED lights in binary
 */
import { BaseCountdownDisplay } from './base-display.js';
import { hostStyles, hiddenClass, combineStyles } from './shared-styles.js';

class BinaryDisplay extends BaseCountdownDisplay {
  constructor() {
    super();
    this._bits = 32; // 32 bits can represent ~136 years in seconds
    this._lastData = null;
  }

  render() {
    this.shadowRoot.innerHTML = `
      <style>
        ${combineStyles(hostStyles(140), hiddenClass)}

        .binary-container {
          display: flex;
          flex-direction: column;
          align-items: center;
          gap: 16px;
          padding: 24px 32px;
          background: linear-gradient(145deg, #0a0a0a 0%, #1a1a1a 100%);
          border-radius: 12px;
          border: 2px solid #333;
          box-shadow: inset 0 2px 10px rgba(0,0,0,0.5);
          width: 100%;
          max-width: 600px;
        }

        .led-row {
          display: flex;
          gap: 3px;
          flex-wrap: wrap;
          justify-content: center;
          max-width: 100%;
        }

        .led {
          width: 14px;
          height: 14px;
          border-radius: 50%;
          background: #1a1a1a;
          border: 1px solid #333;
          box-shadow: inset 0 1px 3px rgba(0,0,0,0.5);
          transition: all 0.15s ease;
          flex-shrink: 0;
        }

        /* Gradient colors for LEDs when on - using CSS custom properties */
        .led.on {
          box-shadow: 
            0 0 8px var(--led-color),
            0 0 16px var(--led-glow),
            inset 0 1px 2px rgba(255,255,255,0.3);
        }

        /* Byte separators */
        .led:nth-child(8n) {
          margin-right: 6px;
        }

        .info {
          display: flex;
          flex-direction: column;
          align-items: center;
          gap: 8px;
        }

        .decimal-value {
          font-family: 'Orbitron', monospace;
          font-size: 1.5rem;
          font-weight: 700;
          color: #22c55e;
          text-shadow: 0 0 20px rgba(34, 197, 94, 0.5);
        }

        .label {
          font-family: 'Outfit', sans-serif;
          font-size: 0.75rem;
          color: #64748b;
          text-transform: uppercase;
          letter-spacing: 0.1em;
        }

        .binary-string {
          font-family: 'Fira Code', monospace;
          font-size: 0.7rem;
          color: #4ade80;
          letter-spacing: 1px;
          word-break: break-all;
          text-align: center;
          max-width: 400px;
          opacity: 0.7;
        }

        .time-breakdown {
          display: flex;
          gap: 16px;
          font-family: 'Outfit', sans-serif;
          font-size: 0.8rem;
          color: #94a3b8;
        }

        .time-unit {
          display: flex;
          align-items: baseline;
          gap: 4px;
        }

        .time-value {
          color: #f8fafc;
          font-weight: 600;
        }

        @media (max-width: 500px) {
          .led {
            width: 10px;
            height: 10px;
          }
          .led:nth-child(8n) {
            margin-right: 4px;
          }
          .binary-container {
            padding: 16px;
          }
          .led-row {
            gap: 2px;
          }
        }

        @media (max-width: 400px) {
          .led {
            width: 8px;
            height: 8px;
          }
          .led:nth-child(8n) {
            margin-right: 3px;
          }
          .led-row {
            gap: 1px;
          }
          .binary-container {
            padding: 12px;
          }
          .binary-string {
            font-size: 0.6rem;
            max-width: 300px;
          }
          .time-breakdown {
            gap: 8px;
            font-size: 0.7rem;
          }
        }
      </style>

      <div class="binary-container">
        <div class="led-row" id="ledRow"></div>
        
        <div class="info">
          <div class="decimal-value" id="decimalValue">0</div>
          <div class="label" data-locale-key="units.secondsRemaining">${this.t(
            'units.secondsRemaining'
          )}</div>
        </div>

        <div class="binary-string" id="binaryString">0</div>

        <div class="time-breakdown" id="breakdown"></div>
      </div>
    `;

    // Create LED elements with gradient colors
    const ledRow = this.shadowRoot.getElementById('ledRow');
    const colors = this.getGradientColors(this._bits);

    for (let i = 0; i < this._bits; i++) {
      const led = document.createElement('div');
      led.className = 'led';
      led.id = `bit-${this._bits - 1 - i}`;

      // Set gradient color for this LED
      const color = colors[i];
      led.style.setProperty('--led-color', color.main);
      led.style.setProperty('--led-glow', color.glow);
      led.dataset.colorMain = color.main;
      led.dataset.colorLight = color.light;

      ledRow.appendChild(led);
    }

    // Cache element references
    this.decimalValueEl = this.shadowRoot.getElementById('decimalValue');
    this.binaryStringEl = this.shadowRoot.getElementById('binaryString');
    this.breakdownEl = this.shadowRoot.getElementById('breakdown');
  }

  getGradientColors(count) {
    // Rainbow gradient from red -> orange -> yellow -> green -> cyan -> blue -> purple
    const colors = [];
    for (let i = 0; i < count; i++) {
      const hue = (i / count) * 300; // 0 to 300 degrees (red to magenta)
      const main = `hsl(${hue}, 80%, 55%)`;
      const light = `hsl(${hue}, 90%, 70%)`;
      const glow = `hsla(${hue}, 80%, 55%, 0.5)`;
      colors.push({ main, light, glow });
    }
    return colors;
  }

  updateBreakdown(data) {
    const { totalDays, hours, minutes, seconds } = data;
    const d = this.t('units.daysShort');
    const h = this.t('units.hoursShort');
    const m = this.t('units.minutesShort');
    const s = this.t('units.secondsShort');
    this.breakdownEl.innerHTML =
      `<span class="time-unit"><span class="time-value">${totalDays}</span>${d}</span>` +
      `<span class="time-unit"><span class="time-value">${hours}</span>${h}</span>` +
      `<span class="time-unit"><span class="time-value">${minutes}</span>${m}</span>` +
      `<span class="time-unit"><span class="time-value">${seconds}</span>${s}</span>`;
  }

  _onUpdate(data) {
    this._lastData = data;
    const { totalSeconds } = data;

    // Update LEDs
    const binaryStr = totalSeconds.toString(2).padStart(this._bits, '0');
    for (let i = 0; i < this._bits; i++) {
      const led = this.shadowRoot.getElementById(`bit-${this._bits - 1 - i}`);
      if (led) {
        const isOn = binaryStr[i] === '1';
        led.classList.toggle('on', isOn);

        // Apply gradient background when on
        if (isOn) {
          const main = led.dataset.colorMain;
          const light = led.dataset.colorLight;
          led.style.background = `radial-gradient(circle at 30% 30%, ${light} 0%, ${main} 60%)`;
        } else {
          led.style.background = '#1a1a1a';
        }
      }
    }

    // Update decimal display
    this.updateValue(this.decimalValueEl, totalSeconds.toLocaleString());

    // Update binary string with spaces every 8 bits
    const formattedBinary = binaryStr.match(/.{1,8}/g).join(' ');
    this.updateValue(this.binaryStringEl, formattedBinary);

    // Update time breakdown with localized labels
    this.updateBreakdown(data);
  }

  // Override to also update breakdown when locale changes
  updateLabels() {
    super.updateLabels();
    if (this._lastData) {
      this.updateBreakdown(this._lastData);
    }
  }
}

customElements.define('binary-display', BinaryDisplay);
export default BinaryDisplay;
