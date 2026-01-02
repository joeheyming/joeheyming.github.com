/**
 * Hourglass Display - Visual hourglass with animated sand
 */
import { BaseCountdownDisplay } from './base-display.js';
import { hostStyles, combineStyles } from './shared-styles.js';

class HourglassDisplay extends BaseCountdownDisplay {
  constructor() {
    super();
    this._animationFrame = null;
    this._particles = [];
    this._showStream = true;
  }

  render() {
    this.shadowRoot.innerHTML = `
      <style>
        ${combineStyles(hostStyles(280))}

        .hourglass-wrapper {
          display: flex;
          flex-direction: column;
          align-items: center;
          gap: 16px;
        }

        .hourglass {
          position: relative;
          width: 140px;
          height: 220px;
          filter: drop-shadow(0 10px 20px rgba(0,0,0,0.4));
        }

        .glass {
          position: absolute;
          width: 100%;
          height: 100%;
        }

        /* Ornate wooden frame */
        .frame-top, .frame-bottom {
          position: absolute;
          left: -5px;
          right: -5px;
          height: 14px;
          background: linear-gradient(180deg, 
            #c9a66b 0%, 
            #8b6914 15%,
            #5c4813 50%, 
            #8b6914 85%,
            #c9a66b 100%
          );
          border-radius: 6px;
          box-shadow: 
            0 2px 4px rgba(0,0,0,0.4),
            inset 0 1px 0 rgba(255,255,255,0.2),
            inset 0 -1px 0 rgba(0,0,0,0.3);
        }

        .frame-top::before, .frame-bottom::before {
          content: '';
          position: absolute;
          left: 10px;
          right: 10px;
          height: 2px;
          background: linear-gradient(90deg, transparent, rgba(255,215,0,0.3), transparent);
        }

        .frame-top::before { top: 3px; }
        .frame-bottom::before { bottom: 3px; }

        .frame-top { top: 0; }
        .frame-bottom { bottom: 0; }

        /* Decorative end caps */
        .frame-cap {
          position: absolute;
          width: 8px;
          height: 14px;
          background: linear-gradient(180deg, #c9a66b, #5c4813, #c9a66b);
          border-radius: 2px;
        }

        .frame-top .frame-cap-left { left: 2px; top: 0; }
        .frame-top .frame-cap-right { right: 2px; top: 0; }

        /* Glass bulbs with proper hourglass shape */
        .bulb-top, .bulb-bottom {
          position: absolute;
          left: 8px;
          right: 8px;
          height: 43%;
          background: linear-gradient(135deg, 
            rgba(255,255,255,0.12) 0%,
            rgba(255,255,255,0.05) 50%,
            rgba(255,255,255,0.08) 100%
          );
          overflow: hidden;
        }

        .bulb-top {
          top: 14px;
          clip-path: polygon(
            0% 0%, 100% 0%, 100% 5%, 85% 20%, 60% 70%, 55% 90%,
            52% 100%, 48% 100%, 45% 90%, 40% 70%, 15% 20%, 0% 5%
          );
          border-radius: 8px 8px 0 0;
        }

        .bulb-bottom {
          bottom: 14px;
          clip-path: polygon(
            48% 0%, 52% 0%, 55% 10%, 60% 30%, 85% 80%,
            100% 95%, 100% 100%, 0% 100%, 0% 95%, 15% 80%, 40% 30%, 45% 10%
          );
          border-radius: 0 0 8px 8px;
        }

        /* Glass shine effect */
        .glass-shine {
          position: absolute;
          width: 20%;
          height: 35%;
          border-radius: 50%;
          pointer-events: none;
        }

        .bulb-top .glass-shine {
          top: 8%;
          left: 18%;
          background: linear-gradient(160deg, 
            rgba(255,255,255,0.35) 0%, 
            rgba(255,255,255,0.05) 60%,
            transparent 100%
          );
        }

        .bulb-bottom .glass-shine {
          top: 15%;
          left: 20%;
          width: 15%;
          height: 25%;
          background: linear-gradient(160deg, 
            rgba(255,255,255,0.2) 0%, 
            rgba(255,255,255,0.03) 60%,
            transparent 100%
          );
        }

        /* Sand containers */
        .sand-top-container {
          position: absolute;
          bottom: 0;
          left: 0;
          right: 0;
          height: 100%;
          overflow: hidden;
          clip-path: polygon(
            5% 5%, 95% 5%, 82% 25%, 58% 75%, 54% 92%, 46% 92%, 42% 75%, 18% 25%
          );
        }

        .sand-top {
          position: absolute;
          bottom: 0;
          left: 0;
          right: 0;
          background: linear-gradient(180deg, #f59e0b 0%, #d97706 40%, #b45309 100%);
          transition: height 1s ease;
        }

        .sand-bottom-container {
          position: absolute;
          bottom: 0;
          left: 0;
          right: 0;
          height: 100%;
          overflow: hidden;
          clip-path: polygon(
            46% 8%, 54% 8%, 58% 25%, 82% 75%, 95% 95%, 5% 95%, 18% 75%, 42% 25%
          );
        }

        .sand-bottom {
          position: absolute;
          bottom: 0;
          left: 0;
          right: 0;
          background: linear-gradient(180deg, #d97706 0%, #b45309 50%, #92400e 100%);
          transition: height 1s ease;
        }

        .sand-bottom::before {
          content: '';
          position: absolute;
          top: -6px;
          left: 50%;
          transform: translateX(-50%);
          width: 0;
          height: 0;
          border-left: 10px solid transparent;
          border-right: 10px solid transparent;
          border-bottom: 8px solid #d97706;
        }

        /* Falling sand stream */
        .sand-stream {
          position: absolute;
          left: 50%;
          top: 42%;
          width: 4px;
          height: 16%;
          background: linear-gradient(180deg, 
            #fbbf24 0%, #f59e0b 40%, #d97706 70%, rgba(217, 119, 6, 0.4) 100%
          );
          transform: translateX(-50%);
          border-radius: 2px;
          animation: stream 0.15s infinite ease-in-out;
        }

        @keyframes stream {
          0%, 100% { opacity: 1; transform: translateX(-50%) scaleY(1); }
          50% { opacity: 0.85; transform: translateX(-50%) scaleY(0.97); }
        }

        /* Glass neck */
        .neck {
          position: absolute;
          left: 50%;
          top: 50%;
          width: 10px;
          height: 24px;
          transform: translate(-50%, -50%);
          background: linear-gradient(90deg,
            rgba(255,255,255,0.05) 0%,
            rgba(255,255,255,0.15) 30%,
            rgba(255,255,255,0.15) 70%,
            rgba(255,255,255,0.05) 100%
          );
          border-radius: 4px;
          border: 1px solid rgba(255,255,255,0.12);
        }

        /* Canvas for particles */
        .particles-canvas {
          position: absolute;
          top: 0;
          left: 0;
          width: 100%;
          height: 100%;
          pointer-events: none;
        }

        /* Time display */
        .time-display {
          display: flex;
          gap: 8px;
          font-family: 'Orbitron', monospace;
        }

        .time-unit {
          display: flex;
          flex-direction: column;
          align-items: center;
          gap: 4px;
        }

        .time-value {
          font-size: 1.2rem;
          font-weight: 700;
          color: #fbbf24;
          text-shadow: 0 0 10px rgba(251, 191, 36, 0.5);
        }

        .time-label {
          font-size: 0.6rem;
          color: #94a3b8;
          text-transform: uppercase;
        }

        .time-separator {
          color: #64748b;
          font-size: 1.2rem;
          margin-top: 4px;
        }
      </style>

      <div class="hourglass-wrapper">
        <div class="hourglass">
          <div class="glass">
            <div class="frame-top">
              <div class="frame-cap frame-cap-left"></div>
              <div class="frame-cap frame-cap-right"></div>
            </div>
            <div class="bulb-top">
              <div class="glass-shine"></div>
              <div class="sand-top-container">
                <div class="sand-top" id="sandTop" style="height: 80%"></div>
              </div>
            </div>
            <div class="neck"></div>
            <div class="sand-stream" id="sandStream"></div>
            <div class="bulb-bottom">
              <div class="glass-shine"></div>
              <div class="sand-bottom-container">
                <div class="sand-bottom" id="sandBottom" style="height: 20%"></div>
              </div>
            </div>
            <div class="frame-bottom"></div>
          </div>
          <canvas class="particles-canvas" id="particlesCanvas" width="140" height="220"></canvas>
        </div>

        <div class="time-display">
          <div class="time-unit" id="daysUnit">
            <span class="time-value" id="daysValue">0</span>
            <span class="time-label" data-locale-key="units.days">${this.t('units.days')}</span>
          </div>
          <span class="time-separator">:</span>
          <div class="time-unit">
            <span class="time-value" id="hoursValue">0</span>
            <span class="time-label" data-locale-key="units.hours">${this.t('units.hours')}</span>
          </div>
          <span class="time-separator">:</span>
          <div class="time-unit">
            <span class="time-value" id="minutesValue">0</span>
            <span class="time-label" data-locale-key="units.minutes">${this.t(
              'units.minutes'
            )}</span>
          </div>
          <span class="time-separator">:</span>
          <div class="time-unit">
            <span class="time-value" id="secondsValue">0</span>
            <span class="time-label" data-locale-key="units.seconds">${this.t(
              'units.seconds'
            )}</span>
          </div>
        </div>
      </div>
    `;

    // Cache element references
    this.sandTop = this.shadowRoot.getElementById('sandTop');
    this.sandBottom = this.shadowRoot.getElementById('sandBottom');
    this.sandStream = this.shadowRoot.getElementById('sandStream');
    this.daysValueEl = this.shadowRoot.getElementById('daysValue');
    this.hoursValueEl = this.shadowRoot.getElementById('hoursValue');
    this.minutesValueEl = this.shadowRoot.getElementById('minutesValue');
    this.secondsValueEl = this.shadowRoot.getElementById('secondsValue');

    // Start the particle animation
    this.startAnimation();
  }

  startAnimation() {
    const canvas = this.shadowRoot.getElementById('particlesCanvas');
    const ctx = canvas.getContext('2d');
    const centerX = 70;
    const neckY = 110;

    const animate = () => {
      ctx.clearRect(0, 0, canvas.width, canvas.height);

      // Add new particles (sand grains falling)
      if (Math.random() < 0.4 && this._showStream) {
        this._particles.push({
          x: centerX + (Math.random() - 0.5) * 6,
          y: neckY,
          vx: (Math.random() - 0.5) * 0.8,
          vy: Math.random() * 2.5 + 1.5,
          size: Math.random() * 2 + 0.8,
          life: 1,
          color: Math.random() > 0.3 ? '#fbbf24' : '#d97706'
        });
      }

      // Update and draw particles
      this._particles = this._particles.filter((p) => {
        p.x += p.vx;
        p.y += p.vy;
        p.vy += 0.15; // gravity
        p.life -= 0.015;

        if (p.life <= 0 || p.y > 200) return false;

        ctx.beginPath();
        ctx.arc(p.x, p.y, p.size, 0, Math.PI * 2);
        const alpha = p.life * 0.9;
        ctx.fillStyle =
          p.color === '#fbbf24' ? `rgba(251, 191, 36, ${alpha})` : `rgba(217, 119, 6, ${alpha})`;
        ctx.fill();

        return true;
      });

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
    const { years = 0, totalDays, hours, minutes, seconds, percentElapsed } = data;
    const daysRemaining = this.getDaysRemaining(years, totalDays);

    // Update sand levels based on progress
    const remaining = 100 - (percentElapsed || 0);
    const elapsed = percentElapsed || 0;

    // Top sand depletes as time passes
    const topHeight = Math.max(remaining * 0.85, 0);
    this.sandTop.style.height = `${topHeight}%`;

    // Bottom sand accumulates
    const bottomHeight = Math.min(elapsed * 0.75 + 8, 85);
    this.sandBottom.style.height = `${bottomHeight}%`;

    // Hide/show stream based on remaining sand
    const showStream = remaining > 1;
    this.sandStream.style.display = showStream ? 'block' : 'none';
    this.sandStream.style.opacity = remaining < 10 ? remaining / 10 : 1;
    this._showStream = showStream;

    // Update time display
    const daysDisplay = years > 0 ? `${years}y ${daysRemaining}` : String(daysRemaining);
    this.updateValue(this.daysValueEl, daysDisplay);
    this.updateValue(this.hoursValueEl, String(hours).padStart(2, '0'));
    this.updateValue(this.minutesValueEl, String(minutes).padStart(2, '0'));
    this.updateValue(this.secondsValueEl, String(seconds).padStart(2, '0'));
  }
}

customElements.define('hourglass-display', HourglassDisplay);
export default HourglassDisplay;
