/**
 * Flip Clock Countdown Display Web Component
 * Retro mechanical flip clock with animated cards
 */
import { BaseCountdownDisplay } from './base-display.js';
import { hostStyles, hiddenClass, combineStyles } from './shared-styles.js';

class FlipDisplay extends BaseCountdownDisplay {
  constructor() {
    super();
    this._currentValues = {};
    this._showYears = false;
  }

  render() {
    this.shadowRoot.innerHTML = `
      <style>
        ${combineStyles(hostStyles(160), hiddenClass)}

        /* Retro clock housing */
        .clock-housing {
          background: linear-gradient(145deg, #2a1810 0%, #1a0f0a 50%, #0d0705 100%);
          border: 3px solid #3d2517;
          border-radius: 16px;
          padding: 24px 32px;
          box-shadow:
            inset 0 2px 4px rgba(255, 200, 150, 0.1),
            0 8px 32px rgba(0, 0, 0, 0.6),
            0 2px 8px rgba(0, 0, 0, 0.4);
          position: relative;
        }

        .screw {
          position: absolute;
          width: 8px;
          height: 8px;
          background: radial-gradient(circle at 30% 30%, #a08060 0%, #5a4030 60%, #3a2518 100%);
          border-radius: 50%;
          box-shadow: inset 0 1px 2px rgba(0,0,0,0.6);
        }

        .screw::after {
          content: '';
          position: absolute;
          top: 50%;
          left: 50%;
          transform: translate(-50%, -50%);
          width: 5px;
          height: 1px;
          background: #2a1810;
        }

        .screw-tl { top: 10px; left: 10px; }
        .screw-tr { top: 10px; right: 10px; }
        .screw-bl { bottom: 10px; left: 10px; }
        .screw-br { bottom: 10px; right: 10px; }

        .flip-clock {
          display: flex;
          justify-content: center;
          align-items: flex-start;
          gap: 8px;
          flex-wrap: wrap;
        }

        .flip-group {
          display: flex;
          flex-direction: column;
          align-items: center;
          gap: 6px;
        }

        .flip-cards {
          display: flex;
          gap: 3px;
        }

        .flip-label {
          font-family: 'Courier New', monospace;
          font-size: 0.65rem;
          color: #c4a882;
          text-transform: uppercase;
          letter-spacing: 0.15em;
          text-shadow: 0 1px 2px rgba(0,0,0,0.8);
        }

        .flip-card {
          position: relative;
          width: clamp(38px, 10vw, 48px);
          height: clamp(56px, 14vw, 70px);
          font-family: 'Courier New', monospace;
          font-size: clamp(1.4rem, 4vw, 1.9rem);
          font-weight: 700;
          perspective: 400px;
        }

        /* Static display - always visible */
        .card-face {
          position: absolute;
          width: 100%;
          height: 50%;
          overflow: hidden;
          display: flex;
          justify-content: center;
          backface-visibility: hidden;
        }

        .card-top {
          top: 0;
          background: linear-gradient(180deg, #1a1a1a 0%, #0d0d0d 100%);
          border-radius: 4px 4px 0 0;
          align-items: flex-end;
          border-bottom: 2px solid #000;
          color: #ffe066;
          text-shadow: 0 0 10px rgba(255, 224, 102, 0.5);
          box-shadow:
            inset 0 1px 0 rgba(255,255,255,0.05),
            inset 0 -1px 3px rgba(0,0,0,0.5);
        }

        .card-top .digit {
          transform: translateY(50%);
        }

        .card-bottom {
          bottom: 0;
          background: linear-gradient(180deg, #0a0a0a 0%, #050505 100%);
          border-radius: 0 0 4px 4px;
          align-items: flex-start;
          color: #ffd633;
          text-shadow: 0 0 10px rgba(255, 214, 51, 0.4);
          box-shadow:
            inset 0 2px 4px rgba(0,0,0,0.8),
            0 2px 4px rgba(0,0,0,0.4);
        }

        .card-bottom .digit {
          transform: translateY(-50%);
        }

        /* Center split line shadow effect */
        .flip-card::after {
          content: '';
          position: absolute;
          top: 50%;
          left: 0;
          right: 0;
          height: 3px;
          background: linear-gradient(180deg, 
            transparent 0%, 
            rgba(0,0,0,0.8) 40%, 
            #000 50%, 
            rgba(0,0,0,0.4) 60%, 
            transparent 100%);
          z-index: 5;
          pointer-events: none;
        }

        /* Flip animation layers */
        .flip-top {
          position: absolute;
          top: 0;
          width: 100%;
          height: 50%;
          background: linear-gradient(180deg, #1a1a1a 0%, #0d0d0d 100%);
          border-radius: 4px 4px 0 0;
          border-bottom: 2px solid #000;
          overflow: hidden;
          display: flex;
          justify-content: center;
          align-items: flex-end;
          color: #ffe066;
          text-shadow: 0 0 10px rgba(255, 224, 102, 0.5);
          transform-origin: bottom;
          z-index: 10;
          backface-visibility: hidden;
          box-shadow: inset 0 1px 0 rgba(255,255,255,0.05);
        }

        .flip-top .digit {
          transform: translateY(50%);
        }

        .flip-bottom {
          position: absolute;
          bottom: 0;
          width: 100%;
          height: 50%;
          background: linear-gradient(180deg, #0a0a0a 0%, #050505 100%);
          border-radius: 0 0 4px 4px;
          overflow: hidden;
          display: flex;
          justify-content: center;
          align-items: flex-start;
          color: #ffd633;
          text-shadow: 0 0 10px rgba(255, 214, 51, 0.4);
          transform-origin: top;
          transform: rotateX(90deg);
          z-index: 10;
          backface-visibility: hidden;
        }

        .flip-bottom .digit {
          transform: translateY(-50%);
        }

        /* Initially hide flip elements */
        .flip-card .flip-top,
        .flip-card .flip-bottom {
          display: none;
        }

        /* Show and animate when flipping */
        .flip-card.flipping .flip-top,
        .flip-card.flipping .flip-bottom {
          display: flex;
        }

        .flip-card.flipping .flip-top {
          animation: flipTopDown 0.25s ease-in forwards;
        }

        .flip-card.flipping .flip-bottom {
          animation: flipBottomDown 0.25s 0.25s ease-out forwards;
        }

        @keyframes flipTopDown {
          0% { transform: rotateX(0deg); }
          100% { transform: rotateX(-90deg); }
        }

        @keyframes flipBottomDown {
          0% { transform: rotateX(90deg); }
          100% { transform: rotateX(0deg); }
        }

        .separator {
          font-family: 'Courier New', monospace;
          font-size: clamp(1.4rem, 4vw, 1.9rem);
          font-weight: bold;
          color: #ff6b35;
          margin-top: 16px;
          text-shadow: 0 0 8px rgba(255, 107, 53, 0.6);
          animation: pulse 1s infinite;
        }

        @keyframes pulse {
          0%, 100% { opacity: 1; }
          50% { opacity: 0.4; }
        }

        /* Brand plate */
        .brand-plate {
          margin-top: 12px;
          padding: 4px 16px;
          background: linear-gradient(180deg, #5a4a3a 0%, #3a2a1a 100%);
          border-radius: 3px;
          border: 1px solid #6a5a4a;
          box-shadow: inset 0 1px 0 rgba(255,255,255,0.1);
        }

        .brand-text {
          font-family: 'Times New Roman', serif;
          font-size: 0.55rem;
          font-style: italic;
          color: #d4c4a8;
          letter-spacing: 0.2em;
          text-transform: uppercase;
        }

        @media (max-width: 600px) {
          .clock-housing {
            padding: 16px 20px;
            border-radius: 12px;
          }
          .flip-clock {
            gap: 4px;
          }
          .separator {
            margin-top: 12px;
          }
          .screw { width: 6px; height: 6px; }
          .screw-tl, .screw-bl { left: 8px; }
          .screw-tr, .screw-br { right: 8px; }
          .screw-tl, .screw-tr { top: 8px; }
          .screw-bl, .screw-br { bottom: 8px; }
        }
      </style>

      <div class="clock-housing">
        <div class="screw screw-tl"></div>
        <div class="screw screw-tr"></div>
        <div class="screw screw-bl"></div>
        <div class="screw screw-br"></div>
        
        <div class="flip-clock">
          <div class="flip-group hidden" id="years-group">
            <div class="flip-cards" id="years-cards"></div>
            <span class="flip-label" data-locale-key="units.years">${this.t('units.years')}</span>
          </div>
          <span class="separator hidden" id="years-sep">:</span>
          
          <div class="flip-group">
            <div class="flip-cards" id="days-cards"></div>
            <span class="flip-label" data-locale-key="units.days">${this.t('units.days')}</span>
          </div>
          <span class="separator">:</span>
          <div class="flip-group">
            <div class="flip-cards" id="hours-cards"></div>
            <span class="flip-label" data-locale-key="units.hours">${this.t('units.hours')}</span>
          </div>
          <span class="separator">:</span>
          <div class="flip-group">
            <div class="flip-cards" id="minutes-cards"></div>
            <span class="flip-label" data-locale-key="units.minutes">${this.t(
              'units.minutes'
            )}</span>
          </div>
          <span class="separator">:</span>
          <div class="flip-group">
            <div class="flip-cards" id="seconds-cards"></div>
            <span class="flip-label" data-locale-key="units.seconds">${this.t(
              'units.seconds'
            )}</span>
          </div>
        </div>
        
        <div class="brand-plate">
          <span class="brand-text">Precision Time Co.</span>
        </div>
      </div>
    `;

    // Create the cards
    this.createCards('years', 2);
    this.createCards('days', 3);
    this.createCards('hours', 2);
    this.createCards('minutes', 2);
    this.createCards('seconds', 2);

    // Cache element references
    this.yearsGroup = this.shadowRoot.getElementById('years-group');
    this.yearsSep = this.shadowRoot.getElementById('years-sep');
  }

  createCards(unit, count) {
    const container = this.shadowRoot.getElementById(`${unit}-cards`);
    if (!container) return;

    for (let i = 0; i < count; i++) {
      const cardId = `${unit}-${i}`;
      const card = document.createElement('div');
      card.className = 'flip-card';
      card.id = cardId;
      card.innerHTML = `
        <div class="card-face card-top"><span class="digit">0</span></div>
        <div class="card-face card-bottom"><span class="digit">0</span></div>
        <div class="flip-top"><span class="digit">0</span></div>
        <div class="flip-bottom"><span class="digit">0</span></div>
      `;
      container.appendChild(card);
      this._currentValues[cardId] = '0';
    }
  }

  flipCard(cardId, newValue) {
    const card = this.shadowRoot.getElementById(cardId);
    if (!card) return;

    const oldValue = this._currentValues[cardId];
    if (oldValue === newValue) return;

    // Set up the flip animation
    card.querySelector('.flip-top .digit').textContent = oldValue;
    card.querySelector('.flip-bottom .digit').textContent = newValue;
    card.querySelector('.card-bottom .digit').textContent = newValue;

    // Start animation
    card.classList.remove('flipping');
    void card.offsetWidth;
    card.classList.add('flipping');

    // After animation completes
    setTimeout(() => {
      card.querySelector('.card-top .digit').textContent = newValue;
      card.classList.remove('flipping');
      this._currentValues[cardId] = newValue;
    }, 500);
  }

  setCardInstant(cardId, value) {
    const card = this.shadowRoot.getElementById(cardId);
    if (!card) return;

    card.querySelector('.card-top .digit').textContent = value;
    card.querySelector('.card-bottom .digit').textContent = value;
    this._currentValues[cardId] = value;
  }

  _onUpdate(data) {
    const { years = 0, totalDays, hours, minutes, seconds } = data;
    const shouldShowYears = years > 0;

    // Show/hide years
    if (shouldShowYears !== this._showYears) {
      this._showYears = shouldShowYears;
      this.toggleYearsVisibility(this.yearsGroup, this.yearsSep, shouldShowYears);
    }

    // Calculate days remaining
    const daysRemaining = this.getDaysRemaining(years, totalDays);

    const yearsStr = String(years).padStart(2, '0');
    const daysStr = String(daysRemaining).padStart(3, '0');
    const hoursStr = String(hours).padStart(2, '0');
    const minutesStr = String(minutes).padStart(2, '0');
    const secondsStr = String(seconds).padStart(2, '0');

    // Check if this is first update
    const isFirstUpdate = Object.values(this._currentValues).every((v) => v === '0');

    // Update years if showing
    if (shouldShowYears) {
      for (let i = 0; i < 2; i++) {
        if (isFirstUpdate) {
          this.setCardInstant(`years-${i}`, yearsStr[i]);
        } else {
          this.flipCard(`years-${i}`, yearsStr[i]);
        }
      }
    }

    // Update each digit
    for (let i = 0; i < 3; i++) {
      if (isFirstUpdate) {
        this.setCardInstant(`days-${i}`, daysStr[i]);
      } else {
        this.flipCard(`days-${i}`, daysStr[i]);
      }
    }
    for (let i = 0; i < 2; i++) {
      if (isFirstUpdate) {
        this.setCardInstant(`hours-${i}`, hoursStr[i]);
        this.setCardInstant(`minutes-${i}`, minutesStr[i]);
        this.setCardInstant(`seconds-${i}`, secondsStr[i]);
      } else {
        this.flipCard(`hours-${i}`, hoursStr[i]);
        this.flipCard(`minutes-${i}`, minutesStr[i]);
        this.flipCard(`seconds-${i}`, secondsStr[i]);
      }
    }
  }
}

customElements.define('flip-display', FlipDisplay);
export default FlipDisplay;
