/**
 * Ball Drop Display - NYC Times Square style ball drop countdown
 */
import { BaseCountdownDisplay } from './base-display.js';
import { hostStyles, hiddenClass, combineStyles } from './shared-styles.js';

class BallDropDisplay extends BaseCountdownDisplay {
  render() {
    this.shadowRoot.innerHTML = `
      <style>
        ${combineStyles(hostStyles(320), hiddenClass)}

        .balldrop-container {
          display: flex;
          flex-direction: column;
          align-items: center;
          gap: 16px;
          position: relative;
        }

        .tower {
          position: relative;
          width: 80px;
          height: 220px;
          display: flex;
          flex-direction: column;
          align-items: center;
        }

        /* The pole */
        .pole {
          position: absolute;
          left: 50%;
          transform: translateX(-50%);
          width: 8px;
          height: 100%;
          background: linear-gradient(90deg, 
            #374151 0%, 
            #6b7280 30%, 
            #9ca3af 50%, 
            #6b7280 70%, 
            #374151 100%);
          border-radius: 4px;
          box-shadow: 0 0 10px rgba(0, 0, 0, 0.5);
        }

        /* Pole segments/lights */
        .pole::before {
          content: '';
          position: absolute;
          left: -4px;
          right: -4px;
          top: 0;
          bottom: 0;
          background: repeating-linear-gradient(
            180deg,
            transparent 0px,
            transparent 18px,
            rgba(245, 158, 11, 0.3) 18px,
            rgba(245, 158, 11, 0.3) 22px
          );
        }

        /* Top cap */
        .top-cap {
          position: absolute;
          top: -8px;
          left: 50%;
          transform: translateX(-50%);
          width: 20px;
          height: 16px;
          background: linear-gradient(180deg, #fbbf24, #f59e0b);
          border-radius: 4px 4px 0 0;
          box-shadow: 0 0 15px rgba(251, 191, 36, 0.6);
        }

        /* The ball */
        .ball-track {
          position: absolute;
          left: 50%;
          transform: translateX(-50%);
          top: 10px;
          bottom: 30px;
          width: 4px;
        }

        .ball {
          position: absolute;
          left: 50%;
          transform: translateX(-50%);
          width: 52px;
          height: 52px;
          border-radius: 50%;
          background: radial-gradient(circle at 30% 30%, 
            #fef3c7 0%, 
            #fcd34d 20%, 
            #f59e0b 50%, 
            #d97706 80%, 
            #b45309 100%);
          box-shadow: 
            0 0 30px rgba(251, 191, 36, 0.8),
            0 0 60px rgba(245, 158, 11, 0.5),
            0 0 100px rgba(245, 158, 11, 0.3),
            inset -8px -8px 20px rgba(0, 0, 0, 0.3),
            inset 8px 8px 20px rgba(255, 255, 255, 0.3);
          transition: top 0.5s ease-out;
          z-index: 10;
        }

        /* Glitter overlay */
        .ball::before {
          content: '';
          position: absolute;
          inset: 4px;
          border-radius: 50%;
          background: 
            radial-gradient(circle at 20% 20%, rgba(255,255,255,0.8) 0%, transparent 8%),
            radial-gradient(circle at 60% 25%, rgba(255,255,255,0.6) 0%, transparent 6%),
            radial-gradient(circle at 80% 40%, rgba(255,255,255,0.7) 0%, transparent 5%),
            radial-gradient(circle at 35% 70%, rgba(255,255,255,0.5) 0%, transparent 7%),
            radial-gradient(circle at 70% 75%, rgba(255,255,255,0.6) 0%, transparent 6%),
            radial-gradient(circle at 15% 50%, rgba(255,255,255,0.4) 0%, transparent 5%);
          animation: sparkle 2s ease-in-out infinite;
        }

        /* Animated sparkles */
        .ball::after {
          content: '✦';
          position: absolute;
          font-size: 8px;
          color: white;
          text-shadow: 0 0 10px white;
          animation: twinkle 1.5s ease-in-out infinite;
          top: 5px;
          left: 10px;
        }

        @keyframes sparkle {
          0%, 100% { opacity: 0.8; transform: rotate(0deg); }
          50% { opacity: 1; transform: rotate(5deg); }
        }

        @keyframes twinkle {
          0%, 100% { opacity: 0.3; transform: scale(1); }
          50% { opacity: 1; transform: scale(1.5); }
        }

        /* Sparkle particles */
        .sparkles {
          position: absolute;
          inset: -20px;
          pointer-events: none;
        }

        .sparkle {
          position: absolute;
          width: 4px;
          height: 4px;
          background: white;
          border-radius: 50%;
          box-shadow: 0 0 6px 2px rgba(251, 191, 36, 0.8);
          animation: float-sparkle 3s ease-in-out infinite;
        }

        .sparkle:nth-child(1) { top: 10%; left: 20%; animation-delay: 0s; }
        .sparkle:nth-child(2) { top: 30%; left: 80%; animation-delay: 0.5s; }
        .sparkle:nth-child(3) { top: 50%; left: 10%; animation-delay: 1s; }
        .sparkle:nth-child(4) { top: 70%; left: 90%; animation-delay: 1.5s; }
        .sparkle:nth-child(5) { top: 20%; left: 60%; animation-delay: 0.3s; }
        .sparkle:nth-child(6) { top: 80%; left: 30%; animation-delay: 0.8s; }

        @keyframes float-sparkle {
          0%, 100% { opacity: 0; transform: translateY(0) scale(0); }
          10% { opacity: 1; transform: translateY(-5px) scale(1); }
          90% { opacity: 1; transform: translateY(-15px) scale(1); }
          100% { opacity: 0; transform: translateY(-20px) scale(0); }
        }

        /* Base/Buildings silhouette */
        .base {
          position: absolute;
          bottom: 0;
          left: 50%;
          transform: translateX(-50%);
          display: flex;
          align-items: flex-end;
          gap: 2px;
        }

        .building {
          background: linear-gradient(180deg, #1f2937, #111827);
          border-radius: 2px 2px 0 0;
        }

        .building:nth-child(1) { width: 12px; height: 25px; }
        .building:nth-child(2) { width: 8px; height: 35px; }
        .building:nth-child(3) { width: 14px; height: 45px; }
        .building:nth-child(4) { width: 10px; height: 30px; }
        .building:nth-child(5) { width: 12px; height: 40px; }

        /* Building windows */
        .building::before {
          content: '';
          position: absolute;
          inset: 4px;
          background: repeating-linear-gradient(
            0deg,
            transparent 0px,
            transparent 4px,
            rgba(251, 191, 36, 0.2) 4px,
            rgba(251, 191, 36, 0.2) 6px
          );
        }

        /* Time display */
        .time-display {
          display: flex;
          flex-direction: column;
          align-items: center;
          gap: 8px;
          background: rgba(15, 23, 42, 0.8);
          padding: 16px 24px;
          border-radius: 16px;
          border: 2px solid rgba(251, 191, 36, 0.3);
          box-shadow: 
            0 0 30px rgba(251, 191, 36, 0.2),
            inset 0 0 20px rgba(0, 0, 0, 0.3);
        }

        .countdown-row {
          display: flex;
          align-items: center;
          gap: 6px;
        }

        .time-block {
          display: flex;
          flex-direction: column;
          align-items: center;
          min-width: 48px;
        }

        .time-value {
          font-family: 'Orbitron', monospace;
          font-size: 1.6rem;
          font-weight: 700;
          color: #fcd34d;
          text-shadow: 
            0 0 10px rgba(251, 191, 36, 0.8),
            0 0 20px rgba(251, 191, 36, 0.4);
          line-height: 1.2;
        }

        .time-label {
          font-family: 'Outfit', sans-serif;
          font-size: 0.55rem;
          color: #9ca3af;
          text-transform: uppercase;
          letter-spacing: 0.1em;
        }

        .separator {
          font-family: 'Orbitron', monospace;
          font-size: 1.4rem;
          color: #f59e0b;
          opacity: 0.6;
          animation: blink 1s infinite;
          padding-bottom: 14px;
        }

        @keyframes blink {
          0%, 100% { opacity: 0.6; }
          50% { opacity: 0.2; }
        }

        .progress-text {
          font-family: 'Outfit', sans-serif;
          font-size: 0.75rem;
          color: #d97706;
          text-transform: uppercase;
          letter-spacing: 0.15em;
        }

        /* Final seconds excitement */
        .ball.final-countdown {
          animation: pulse-ball 0.5s ease-in-out infinite;
        }

        @keyframes pulse-ball {
          0%, 100% { 
            transform: translateX(-50%) scale(1);
            box-shadow: 
              0 0 30px rgba(251, 191, 36, 0.8),
              0 0 60px rgba(245, 158, 11, 0.5);
          }
          50% { 
            transform: translateX(-50%) scale(1.05);
            box-shadow: 
              0 0 50px rgba(251, 191, 36, 1),
              0 0 100px rgba(245, 158, 11, 0.8);
          }
        }

        @media (max-width: 400px) {
          .tower {
            height: 180px;
            width: 60px;
          }
          .ball {
            width: 40px;
            height: 40px;
          }
          .time-display {
            padding: 12px 16px;
          }
          .time-value {
            font-size: 1.3rem;
          }
          .time-block {
            min-width: 38px;
          }
        }
      </style>

      <div class="balldrop-container">
        <div class="tower">
          <div class="top-cap"></div>
          <div class="pole"></div>
          <div class="ball" id="ball">
            <div class="sparkles">
              <div class="sparkle"></div>
              <div class="sparkle"></div>
              <div class="sparkle"></div>
              <div class="sparkle"></div>
              <div class="sparkle"></div>
              <div class="sparkle"></div>
            </div>
          </div>
          <div class="base">
            <div class="building"></div>
            <div class="building"></div>
            <div class="building"></div>
            <div class="building"></div>
            <div class="building"></div>
          </div>
        </div>

        <div class="time-display">
          <div class="countdown-row">
            <div class="time-block hidden" id="yearsBlock">
              <span class="time-value" id="yearsValue">0</span>
              <span class="time-label" data-locale-key="units.years">${this.t('units.years')}</span>
            </div>
            <span class="separator hidden" id="yearsSep">:</span>
            <div class="time-block" id="daysBlock">
              <span class="time-value" id="daysValue">0</span>
              <span class="time-label" data-locale-key="units.days">${this.t('units.days')}</span>
            </div>
            <span class="separator">:</span>
            <div class="time-block">
              <span class="time-value" id="hoursValue">00</span>
              <span class="time-label" data-locale-key="units.hours">${this.t('units.hours')}</span>
            </div>
            <span class="separator">:</span>
            <div class="time-block">
              <span class="time-value" id="minutesValue">00</span>
              <span class="time-label" data-locale-key="units.minutes">${this.t(
                'units.minutes'
              )}</span>
            </div>
            <span class="separator">:</span>
            <div class="time-block">
              <span class="time-value" id="secondsValue">00</span>
              <span class="time-label" data-locale-key="units.seconds">${this.t(
                'units.seconds'
              )}</span>
            </div>
          </div>
          <div class="progress-text" id="progressText">Ball Drop</div>
        </div>
      </div>
    `;

    // Cache element references
    this.ball = this.shadowRoot.getElementById('ball');
    this.yearsBlock = this.shadowRoot.getElementById('yearsBlock');
    this.yearsSep = this.shadowRoot.getElementById('yearsSep');
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

    // Calculate ball position so ball's bottom touches top of buildings at 100%
    // Tower: 220px, Ball: 52px, Tallest building: 45px
    // Building top = 220 - 45 = 175px from top
    // Ball bottom should reach 175px, so ball top = 175 - 52 = 123px at 100%
    const startTop = 10;
    const endTop = 123; // Ball's bottom touches building tops
    const trackHeight = endTop - startTop; // 113px travel distance
    const ballTop = startTop + (percentElapsed / 100) * trackHeight;
    this.ball.style.top = `${ballTop}px`;

    // Add excitement animation when close to completion
    const remaining = 100 - (percentElapsed || 0);
    if (remaining < 5 && totalDays === 0 && hours === 0 && minutes === 0) {
      this.ball.classList.add('final-countdown');
    } else {
      this.ball.classList.remove('final-countdown');
    }

    // Update years visibility
    this.toggleYearsVisibility(this.yearsBlock, this.yearsSep, years > 0);
    this.updateValue(this.yearsValueEl, String(years));

    // Update time values
    this.updateValue(this.daysValueEl, String(daysRemaining));
    this.updateValue(this.hoursValueEl, String(hours).padStart(2, '0'));
    this.updateValue(this.minutesValueEl, String(minutes).padStart(2, '0'));
    this.updateValue(this.secondsValueEl, String(seconds).padStart(2, '0'));

    // Update progress text
    if (remaining <= 0) {
      this.progressText.textContent = '🎉 Happy New Year! 🎉';
    } else if (remaining < 1) {
      this.progressText.textContent = 'Almost there!';
    } else {
      this.progressText.textContent = `${remaining.toFixed(1)}% until drop`;
    }
  }
}

customElements.define('balldrop-display', BallDropDisplay);
export default BallDropDisplay;
