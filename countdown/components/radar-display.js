/**
 * Radar Display - Sonar-style countdown with sweeping hand
 */
import { BaseCountdownDisplay } from './base-display.js';
import { hostStyles, combineStyles } from './shared-styles.js';

class RadarDisplay extends BaseCountdownDisplay {
  constructor() {
    super();
    this._animationFrame = null;
    this._angle = 0;
    this._lastData = null;
  }

  render() {
    this.shadowRoot.innerHTML = `
      <style>
        ${combineStyles(hostStyles(280))}

        .radar-container {
          position: relative;
          width: clamp(200px, 50vw, 280px);
          height: clamp(200px, 50vw, 280px);
        }

        .radar-screen {
          position: absolute;
          width: 100%;
          height: 100%;
          border-radius: 50%;
          background: radial-gradient(circle, #0a1628 0%, #020617 100%);
          border: 4px solid #1e3a5f;
          box-shadow: 
            0 0 30px rgba(34, 211, 238, 0.2),
            inset 0 0 60px rgba(0, 0, 0, 0.8);
          overflow: hidden;
        }

        /* Grid circles */
        .grid-circle {
          position: absolute;
          border: 1px solid rgba(34, 211, 238, 0.15);
          border-radius: 50%;
          top: 50%;
          left: 50%;
          transform: translate(-50%, -50%);
        }

        .grid-circle:nth-child(1) { width: 25%; height: 25%; }
        .grid-circle:nth-child(2) { width: 50%; height: 50%; }
        .grid-circle:nth-child(3) { width: 75%; height: 75%; }
        .grid-circle:nth-child(4) { width: 95%; height: 95%; }

        /* Grid lines */
        .grid-line {
          position: absolute;
          background: rgba(34, 211, 238, 0.1);
          top: 50%;
          left: 50%;
        }

        .grid-line.horizontal {
          width: 100%;
          height: 1px;
          transform: translate(-50%, -50%);
        }

        .grid-line.vertical {
          width: 1px;
          height: 100%;
          transform: translate(-50%, -50%);
        }

        /* Sweep hand */
        .sweep {
          position: absolute;
          top: 50%;
          left: 50%;
          width: 50%;
          height: 2px;
          transform-origin: left center;
          background: linear-gradient(90deg, #22d3ee 0%, transparent 100%);
          box-shadow: 0 0 10px #22d3ee;
        }

        /* Sweep trail */
        .sweep-trail {
          position: absolute;
          top: 0;
          left: 0;
          width: 100%;
          height: 100%;
          background: conic-gradient(
            from var(--sweep-angle, 0deg),
            rgba(34, 211, 238, 0.3) 0deg,
            transparent 30deg
          );
          border-radius: 50%;
        }

        /* Center dot */
        .center {
          position: absolute;
          top: 50%;
          left: 50%;
          width: 12px;
          height: 12px;
          transform: translate(-50%, -50%);
          background: #22d3ee;
          border-radius: 50%;
          box-shadow: 0 0 20px #22d3ee;
          z-index: 10;
        }

        /* Time display in center */
        .time-display {
          position: absolute;
          top: 50%;
          left: 50%;
          transform: translate(-50%, -50%);
          text-align: center;
          z-index: 5;
        }

        .time-main {
          font-family: 'Orbitron', monospace;
          font-size: clamp(1.2rem, 4vw, 1.6rem);
          font-weight: 700;
          color: #22d3ee;
          text-shadow: 0 0 10px rgba(34, 211, 238, 0.8);
          letter-spacing: 0.05em;
        }

        .time-sub {
          font-family: 'Outfit', sans-serif;
          font-size: 0.7rem;
          color: #64748b;
          margin-top: 4px;
        }

        /* Cardinal labels */
        .cardinal {
          position: absolute;
          font-family: 'Orbitron', monospace;
          font-size: 0.6rem;
          color: rgba(34, 211, 238, 0.5);
        }

        .cardinal.n { top: 8px; left: 50%; transform: translateX(-50%); }
        .cardinal.e { right: 8px; top: 50%; transform: translateY(-50%); }
        .cardinal.s { bottom: 8px; left: 50%; transform: translateX(-50%); }
        .cardinal.w { left: 8px; top: 50%; transform: translateY(-50%); }
      </style>

      <div class="radar-container">
        <div class="radar-screen">
          <div class="grid-circle"></div>
          <div class="grid-circle"></div>
          <div class="grid-circle"></div>
          <div class="grid-circle"></div>
          <div class="grid-line horizontal"></div>
          <div class="grid-line vertical"></div>
          
          <div class="sweep-trail" id="sweepTrail"></div>
          <div class="sweep" id="sweep"></div>
          <div class="center"></div>

          <span class="cardinal n">D</span>
          <span class="cardinal e">H</span>
          <span class="cardinal s">M</span>
          <span class="cardinal w">S</span>

          <div class="time-display">
            <div class="time-main" id="timeMain">00:00:00</div>
            <div class="time-sub" id="timeSub">0 days</div>
          </div>
        </div>
      </div>
    `;

    // Cache element references
    this.sweep = this.shadowRoot.getElementById('sweep');
    this.sweepTrail = this.shadowRoot.getElementById('sweepTrail');
    this.timeMain = this.shadowRoot.getElementById('timeMain');
    this.timeSub = this.shadowRoot.getElementById('timeSub');

    // Start the sweep animation
    this.startSweep();
  }

  startSweep() {
    const animate = () => {
      this._angle = (this._angle + 2) % 360;
      this.sweep.style.transform = `rotate(${this._angle}deg)`;
      this.sweepTrail.style.setProperty('--sweep-angle', `${this._angle}deg`);
      this._animationFrame = requestAnimationFrame(animate);
    };

    animate();
  }

  disconnectedCallback() {
    super.disconnectedCallback();
    if (this._animationFrame) {
      cancelAnimationFrame(this._animationFrame);
    }
  }

  _onUpdate(data) {
    this._lastData = data;
    const { years = 0, totalDays, hours, minutes, seconds } = data;
    const daysRemaining = this.getDaysRemaining(years, totalDays);

    const timeStr = `${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}:${String(
      seconds
    ).padStart(2, '0')}`;
    this.updateValue(this.timeMain, timeStr);

    const daysWord = this.t(totalDays === 1 ? 'units.day' : 'units.days');
    let subText = `${totalDays} ${daysWord}`;
    if (years > 0) {
      subText = `${years}y ${daysRemaining}d`;
    }
    this.timeSub.textContent = subText;
  }

  // Override to update display when locale changes
  updateLabels() {
    super.updateLabels();
    if (this._lastData) {
      this._onUpdate(this._lastData);
    }
  }
}

customElements.define('radar-display', RadarDisplay);
export default RadarDisplay;
