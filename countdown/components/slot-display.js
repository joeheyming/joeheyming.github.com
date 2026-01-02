/**
 * Slot Machine Display - Spinning reels countdown
 */
import { BaseCountdownDisplay } from './base-display.js';
import { hostStyles, hiddenClass, combineStyles } from './shared-styles.js';

class SlotDisplay extends BaseCountdownDisplay {
  constructor() {
    super();
    this._prevValues = {};
  }

  render() {
    this.shadowRoot.innerHTML = `
      <style>
        ${combineStyles(hostStyles(160), hiddenClass)}

        .slot-machine {
          background: linear-gradient(145deg, #1a1a2e 0%, #16213e 100%);
          border: 4px solid #e94560;
          border-radius: 16px;
          padding: 20px 24px;
          box-shadow: 
            0 0 30px rgba(233, 69, 96, 0.3),
            inset 0 2px 10px rgba(0,0,0,0.5);
        }

        .slot-header {
          text-align: center;
          margin-bottom: 12px;
        }

        .slot-title {
          font-family: 'Bangers', cursive, sans-serif;
          font-size: 1rem;
          color: #fbbf24;
          text-shadow: 2px 2px 0 #e94560;
          letter-spacing: 0.1em;
        }

        .reels-container {
          display: flex;
          justify-content: center;
          align-items: center;
          gap: 6px;
        }

        .reel-group {
          display: flex;
          flex-direction: column;
          align-items: center;
          gap: 6px;
        }

        .reels {
          display: flex;
          gap: 3px;
        }

        .reel {
          width: clamp(28px, 8vw, 40px);
          height: clamp(44px, 12vw, 60px);
          background: linear-gradient(180deg, #0f0f23 0%, #1a1a2e 50%, #0f0f23 100%);
          border: 2px solid #333;
          border-radius: 6px;
          overflow: hidden;
          position: relative;
        }

        .reel::before,
        .reel::after {
          content: '';
          position: absolute;
          left: 0;
          right: 0;
          height: 30%;
          pointer-events: none;
          z-index: 2;
        }

        .reel::before {
          top: 0;
          background: linear-gradient(180deg, rgba(15,15,35,0.9) 0%, transparent 100%);
        }

        .reel::after {
          bottom: 0;
          background: linear-gradient(0deg, rgba(15,15,35,0.9) 0%, transparent 100%);
        }

        .reel-strip {
          position: absolute;
          width: 100%;
          transition: transform 0.5s cubic-bezier(0.17, 0.67, 0.12, 1);
        }

        .reel-number {
          height: clamp(44px, 12vw, 60px);
          display: flex;
          align-items: center;
          justify-content: center;
          font-family: 'Orbitron', monospace;
          font-size: clamp(1.2rem, 4vw, 1.8rem);
          font-weight: 700;
          color: #fff;
          text-shadow: 0 0 10px rgba(233, 69, 96, 0.8);
        }

        .reel.spinning .reel-strip {
          animation: spin 0.1s linear infinite;
        }

        @keyframes spin {
          0% { transform: translateY(0); }
          100% { transform: translateY(-60px); }
        }

        .reel-label {
          font-family: 'Outfit', sans-serif;
          font-size: 0.6rem;
          color: #e94560;
          text-transform: uppercase;
          letter-spacing: 0.1em;
        }

        .separator {
          font-family: 'Orbitron', monospace;
          font-size: clamp(1.2rem, 4vw, 1.8rem);
          color: #fbbf24;
          text-shadow: 0 0 10px rgba(251, 191, 36, 0.5);
          margin-top: -20px;
        }

        /* Lights decoration */
        .lights {
          display: flex;
          justify-content: center;
          gap: 8px;
          margin-top: 12px;
        }

        .light {
          width: 8px;
          height: 8px;
          border-radius: 50%;
          animation: blink 0.5s infinite alternate;
        }

        .light:nth-child(1) { background: #e94560; animation-delay: 0s; }
        .light:nth-child(2) { background: #fbbf24; animation-delay: 0.1s; }
        .light:nth-child(3) { background: #22d3ee; animation-delay: 0.2s; }
        .light:nth-child(4) { background: #a78bfa; animation-delay: 0.3s; }
        .light:nth-child(5) { background: #f472b6; animation-delay: 0.4s; }

        @keyframes blink {
          0% { opacity: 0.4; box-shadow: none; }
          100% { opacity: 1; box-shadow: 0 0 10px currentColor; }
        }

        @media (max-width: 400px) {
          .slot-machine {
            padding: 12px 16px;
          }
        }
      </style>

      <div class="slot-machine">
        <div class="slot-header">
          <div class="slot-title">⭐ COUNTDOWN ⭐</div>
        </div>

        <div class="reels-container">
          <div class="reel-group hidden" id="yearsGroup">
            <div class="reels" id="yearsReels"></div>
            <span class="reel-label" data-locale-key="units.years">${this.t('units.years')}</span>
          </div>
          <span class="separator hidden" id="yearsSep">:</span>

          <div class="reel-group">
            <div class="reels" id="daysReels"></div>
            <span class="reel-label" data-locale-key="units.days">${this.t('units.days')}</span>
          </div>
          <span class="separator">:</span>

          <div class="reel-group">
            <div class="reels" id="hoursReels"></div>
            <span class="reel-label" data-locale-key="units.hours">${this.t('units.hours')}</span>
          </div>
          <span class="separator">:</span>

          <div class="reel-group">
            <div class="reels" id="minsReels"></div>
            <span class="reel-label" data-locale-key="units.minutes">${this.t(
              'units.minutes'
            )}</span>
          </div>
          <span class="separator">:</span>

          <div class="reel-group">
            <div class="reels" id="secsReels"></div>
            <span class="reel-label" data-locale-key="units.seconds">${this.t(
              'units.seconds'
            )}</span>
          </div>
        </div>

        <div class="lights">
          <div class="light"></div>
          <div class="light"></div>
          <div class="light"></div>
          <div class="light"></div>
          <div class="light"></div>
        </div>
      </div>
    `;

    // Create reels
    this.createReels('years', 2);
    this.createReels('days', 3);
    this.createReels('hours', 2);
    this.createReels('mins', 2);
    this.createReels('secs', 2);

    // Cache element references
    this.yearsGroup = this.shadowRoot.getElementById('yearsGroup');
    this.yearsSep = this.shadowRoot.getElementById('yearsSep');
  }

  createReels(id, count) {
    const container = this.shadowRoot.getElementById(`${id}Reels`);
    for (let i = 0; i < count; i++) {
      const reel = document.createElement('div');
      reel.className = 'reel';
      reel.id = `${id}-${i}`;

      // Create strip with numbers 0-9 repeated
      const strip = document.createElement('div');
      strip.className = 'reel-strip';
      for (let n = 0; n <= 10; n++) {
        const num = document.createElement('div');
        num.className = 'reel-number';
        num.textContent = n % 10;
        strip.appendChild(num);
      }
      reel.appendChild(strip);
      container.appendChild(reel);

      this._prevValues[`${id}-${i}`] = '0';
    }
  }

  spinTo(reelId, digit) {
    const reel = this.shadowRoot.getElementById(reelId);
    if (!reel) return;

    const prevDigit = this._prevValues[reelId];
    if (prevDigit === digit) return;

    const strip = reel.querySelector('.reel-strip');
    const digitNum = parseInt(digit, 10);
    const height = reel.offsetHeight;

    // Spin animation
    reel.classList.add('spinning');

    setTimeout(() => {
      reel.classList.remove('spinning');
      strip.style.transform = `translateY(-${digitNum * height}px)`;
      this._prevValues[reelId] = digit;
    }, 200 + Math.random() * 200);
  }

  _onUpdate(data) {
    const { years = 0, totalDays, hours, minutes, seconds } = data;
    const daysRemaining = this.getDaysRemaining(years, totalDays);

    // Show/hide years
    this.toggleYearsVisibility(this.yearsGroup, this.yearsSep, years > 0);

    const yearsStr = String(years).padStart(2, '0');
    const daysStr = String(daysRemaining).padStart(3, '0');
    const hoursStr = String(hours).padStart(2, '0');
    const minsStr = String(minutes).padStart(2, '0');
    const secsStr = String(seconds).padStart(2, '0');

    // Update each reel
    for (let i = 0; i < 2; i++) {
      this.spinTo(`years-${i}`, yearsStr[i]);
    }
    for (let i = 0; i < 3; i++) {
      this.spinTo(`days-${i}`, daysStr[i]);
    }
    for (let i = 0; i < 2; i++) {
      this.spinTo(`hours-${i}`, hoursStr[i]);
      this.spinTo(`mins-${i}`, minsStr[i]);
      this.spinTo(`secs-${i}`, secsStr[i]);
    }
  }
}

customElements.define('slot-display', SlotDisplay);
export default SlotDisplay;
