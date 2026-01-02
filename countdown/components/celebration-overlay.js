/**
 * Celebration Overlay Web Component
 * Displays fireworks, celebration message, and YouTube video when countdown completes
 */
import YouTubePlayer from './youtube-player.js';
import { localeService } from '../i18n/locale-service.js';

class CelebrationOverlay extends HTMLElement {
  constructor() {
    super();
    this.attachShadow({ mode: 'open' });
    this._isVisible = false;
    this._videoId = null;
  }

  static get observedAttributes() {
    return ['message', 'video-id'];
  }

  get videoId() {
    return this._videoId || this.getAttribute('video-id') || YouTubePlayer.VIDEOS.CELEBRATION;
  }

  set videoId(val) {
    this._videoId = val;
    if (val) {
      this.setAttribute('video-id', val);
    } else {
      this.removeAttribute('video-id');
    }
  }

  get message() {
    const defaultMsg = `🎉 ${localeService.str('ui.momentArrived')} 🎉`;
    return this.getAttribute('message') || defaultMsg;
  }

  set message(val) {
    this.setAttribute('message', val);
    this.updateMessage();
  }

  get isVisible() {
    return this._isVisible;
  }

  async connectedCallback() {
    await localeService.ready();
    this.render();
    this.setupEventListeners();

    // Subscribe to locale changes
    this._unsubscribe = localeService.subscribe(() => this.updateLabels());
  }

  disconnectedCallback() {
    if (this._unsubscribe) this._unsubscribe();
    this.cleanup();
  }

  updateLabels() {
    if (this.dismissBtn) {
      this.dismissBtn.textContent = localeService.str('ui.dismiss');
    }
    if (this.closeBtn) {
      this.closeBtn.title = localeService.str('ui.close');
    }
  }

  attributeChangedCallback(name, oldValue, newValue) {
    if (name === 'message' && oldValue !== newValue) {
      this.updateMessage();
    }
    if (name === 'video-id' && oldValue !== newValue) {
      this._videoId = newValue;
    }
  }

  render() {
    this.shadowRoot.innerHTML = `
      <style>
        :host {
          display: none;
          position: fixed;
          top: 0;
          left: 0;
          right: 0;
          bottom: 0;
          z-index: 1000;
        }

        :host([visible]) {
          display: flex;
        }

        .overlay {
          position: absolute;
          top: 0;
          left: 0;
          right: 0;
          bottom: 0;
          background: rgba(3, 7, 18, 0.95);
          display: flex;
          flex-direction: column;
          align-items: center;
          padding: 40px 20px;
          cursor: pointer;
          overflow: hidden;
        }

        .message {
          font-family: 'Orbitron', monospace;
          font-size: clamp(1.5rem, 6vw, 3rem);
          font-weight: 700;
          text-align: center;
          background: linear-gradient(135deg, #f59e0b, #fbbf24, #fff, #fbbf24, #f59e0b);
          background-size: 200% 200%;
          -webkit-background-clip: text;
          -webkit-text-fill-color: transparent;
          background-clip: text;
          animation: shimmer 2s linear infinite;
          margin-bottom: 24px;
          z-index: 5;
        }

        .youtube-slot {
          flex: 1;
          width: min(800px, 90vw);
          max-height: 60vh;
          display: flex;
          align-items: center;
          justify-content: center;
          z-index: 5;
        }

        .dismiss-btn {
          background: rgba(245, 158, 11, 0.15);
          border: 1px solid #f59e0b;
          color: #fbbf24;
          padding: 14px 40px;
          border-radius: 12px;
          font-family: 'Outfit', sans-serif;
          font-size: 1rem;
          font-weight: 500;
          cursor: pointer;
          transition: all 0.3s cubic-bezier(0.4, 0, 0.2, 1);
          margin-top: 24px;
          z-index: 5;
        }

        .dismiss-btn:hover {
          background: linear-gradient(135deg, #f59e0b, #fbbf24);
          color: #030712;
          transform: translateY(-2px);
          box-shadow: 0 8px 24px rgba(245, 158, 11, 0.4);
        }

        .close-btn {
          position: absolute;
          top: 20px;
          right: 20px;
          background: rgba(245, 158, 11, 0.15);
          border: 1px solid rgba(245, 158, 11, 0.3);
          color: #fbbf24;
          width: 44px;
          height: 44px;
          border-radius: 50%;
          cursor: pointer;
          display: flex;
          align-items: center;
          justify-content: center;
          transition: all 0.2s ease;
          z-index: 10;
        }

        .close-btn:hover {
          background: rgba(245, 158, 11, 0.25);
          border-color: #f59e0b;
        }

        .close-btn svg {
          width: 20px;
          height: 20px;
        }

        @keyframes shimmer {
          0% { background-position: 0% 50%; }
          100% { background-position: 200% 50%; }
        }

        /* Firework particles */
        .firework-particle {
          position: fixed;
          width: var(--size, 6px);
          height: var(--size, 6px);
          border-radius: 50%;
          pointer-events: none;
          z-index: 1001;
          animation: fireworkExplode var(--duration, 1.5s) cubic-bezier(0.25, 0.46, 0.45, 0.94) forwards;
          box-shadow: 0 0 6px currentColor, 0 0 12px currentColor;
        }

        @keyframes fireworkExplode {
          0% {
            transform: translate(0, 0) scale(1);
            opacity: 1;
          }
          20% { opacity: 1; }
          100% {
            transform: translate(var(--tx), var(--ty)) scale(0);
            opacity: 0;
          }
        }

        /* Firework rocket trail */
        .firework-rocket {
          position: fixed;
          width: 4px;
          height: 20px;
          background: linear-gradient(to top, transparent, var(--color));
          pointer-events: none;
          z-index: 1000;
          animation: rocketLaunch var(--duration, 0.8s) ease-out forwards;
          border-radius: 2px;
        }

        @keyframes rocketLaunch {
          0% {
            transform: translateY(0);
            opacity: 1;
          }
          100% {
            transform: translateY(var(--distance, -300px));
            opacity: 0;
          }
        }

        /* Sparkle effect */
        .firework-sparkle {
          position: fixed;
          width: 3px;
          height: 3px;
          background: #fff;
          border-radius: 50%;
          pointer-events: none;
          z-index: 1002;
          animation: sparkle 0.6s ease-out forwards;
          box-shadow: 0 0 4px #fff, 0 0 8px #fff;
        }

        @keyframes sparkle {
          0% {
            transform: scale(1);
            opacity: 1;
          }
          100% {
            transform: scale(0);
            opacity: 0;
          }
        }

        /* Center flash */
        .center-flash {
          position: fixed;
          width: 20px;
          height: 20px;
          border-radius: 50%;
          pointer-events: none;
          z-index: 1003;
          animation: flashBurst 0.3s ease-out forwards;
        }

        @keyframes flashBurst {
          0% {
            transform: translate(-50%, -50%) scale(1);
            opacity: 1;
          }
          100% {
            transform: translate(-50%, -50%) scale(4);
            opacity: 0;
          }
        }
      </style>

      <div class="overlay" id="overlay">
        <button class="close-btn" id="closeBtn" title="${localeService.str('ui.close')}">
          <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2">
            <path stroke-linecap="round" stroke-linejoin="round" d="M6 18L18 6M6 6l12 12" />
          </svg>
        </button>
        <div class="message" id="message">${this.message}</div>
        <div class="youtube-slot"><slot name="youtube"></slot></div>
        <button class="dismiss-btn" id="dismissBtn">${localeService.str('ui.dismiss')}</button>
      </div>
    `;

    this.overlayEl = this.shadowRoot.getElementById('overlay');
    this.messageEl = this.shadowRoot.getElementById('message');
    this.dismissBtn = this.shadowRoot.getElementById('dismissBtn');
    this.closeBtn = this.shadowRoot.getElementById('closeBtn');
  }

  updateMessage() {
    if (this.messageEl) {
      this.messageEl.textContent = this.message;
    }
  }

  setupEventListeners() {
    this.dismissBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      this.hide();
    });

    this.closeBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      this.hide();
    });

    this.overlayEl.addEventListener('click', (e) => {
      if (e.target === this.overlayEl) {
        this.hide();
      }
    });
  }

  show() {
    // Clean up any existing celebration first (in case show is called while already showing)
    this.cleanup();

    this._isVisible = true;
    this.setAttribute('visible', '');
    this.launchFireworks();
    this.loadYouTube();
    this.dispatchEvent(new CustomEvent('celebration-show', { bubbles: true, composed: true }));
  }

  hide() {
    this.cleanup();
    this._isVisible = false;
    this.removeAttribute('visible');
    this.dispatchEvent(new CustomEvent('celebration-dismiss', { bubbles: true, composed: true }));
  }

  cleanup() {
    // Stop any pending firework timeouts
    if (this._fireworkTimeouts) {
      this._fireworkTimeouts.forEach((t) => clearTimeout(t));
      this._fireworkTimeouts = [];
    }

    // Remove any existing firework particles
    const selectors = '.firework-rocket, .firework-particle, .firework-sparkle, .center-flash';
    this.shadowRoot.querySelectorAll(selectors).forEach((el) => el.remove());

    // Remove YouTube iframe
    this.unloadYouTube();
  }

  loadYouTube() {
    // Create YouTube player in light DOM for compatibility
    const player = document.createElement('youtube-player');
    player.slot = 'youtube';
    player.id = 'celebration-youtube';
    player.setAttribute('bordered', '');
    player.style.cssText = `
      width: min(800px, 90vw);
      aspect-ratio: 16 / 9;
    `;

    this.appendChild(player);
    player.play(this.videoId, true);
  }

  unloadYouTube() {
    const player = this.querySelector('#celebration-youtube');
    if (player) {
      player.stop();
      player.remove();
    }
  }

  getRandomColorPalette() {
    return CelebrationOverlay.COLOR_PALETTES[
      Math.floor(Math.random() * CelebrationOverlay.COLOR_PALETTES.length)
    ];
  }

  launchFireworks() {
    this._fireworkTimeouts = [];
    const fireworkCount = 18;
    for (let i = 0; i < fireworkCount; i++) {
      const timeout = setTimeout(() => {
        if (this._isVisible) {
          const palette = this.getRandomColorPalette();
          this.launchSingleFirework(palette);
        }
      }, i * 400 + Math.random() * 200);
      this._fireworkTimeouts.push(timeout);
    }
  }

  launchSingleFirework(colorPalette) {
    const startX = Math.random() * 80 + 10;
    const targetY = Math.random() * 40 + 15;

    const rocket = document.createElement('div');
    rocket.className = 'firework-rocket';
    rocket.style.left = `${startX}%`;
    rocket.style.bottom = '0';
    rocket.style.setProperty('--color', colorPalette[0]);
    rocket.style.setProperty('--distance', `-${window.innerHeight * (1 - targetY / 100)}px`);
    rocket.style.setProperty('--duration', '0.6s');
    this.shadowRoot.appendChild(rocket);

    const rocketTimeout = setTimeout(() => {
      rocket.remove();
      if (this._isVisible) {
        this.createExplosion(startX, targetY, colorPalette);
      }
    }, 550);
    this._fireworkTimeouts.push(rocketTimeout);
  }

  createExplosion(x, y, colorPalette) {
    const particleCount = 40 + Math.floor(Math.random() * 20);
    const explosionRadius = 120 + Math.random() * 80;

    for (let i = 0; i < particleCount; i++) {
      const angle = (Math.PI * 2 * i) / particleCount + (Math.random() - 0.5) * 0.3;
      const velocity = explosionRadius * (0.5 + Math.random() * 0.5);
      const tx = Math.cos(angle) * velocity;
      const ty = Math.sin(angle) * velocity + velocity * 0.3;

      const particle = document.createElement('div');
      particle.className = 'firework-particle';
      particle.style.left = `${x}%`;
      particle.style.top = `${y}%`;
      particle.style.backgroundColor =
        colorPalette[Math.floor(Math.random() * colorPalette.length)];
      particle.style.color = colorPalette[0];
      particle.style.setProperty('--tx', `${tx}px`);
      particle.style.setProperty('--ty', `${ty}px`);
      particle.style.setProperty('--size', `${3 + Math.random() * 5}px`);
      particle.style.setProperty('--duration', `${1 + Math.random() * 0.8}s`);

      this.shadowRoot.appendChild(particle);

      if (Math.random() > 0.6) {
        const sparkleTimeout = setTimeout(() => {
          if (this._isVisible) {
            this.createSparkle(x, y, tx * 0.5, ty * 0.5);
          }
        }, 200 + Math.random() * 300);
        this._fireworkTimeouts.push(sparkleTimeout);
      }

      const particleTimeout = setTimeout(() => particle.remove(), 2000);
      this._fireworkTimeouts.push(particleTimeout);
    }

    this.createCenterFlash(x, y, colorPalette[1]);
  }

  createSparkle(baseX, baseY, offsetX, offsetY) {
    const sparkle = document.createElement('div');
    sparkle.className = 'firework-sparkle';
    sparkle.style.left = `calc(${baseX}% + ${offsetX}px)`;
    sparkle.style.top = `calc(${baseY}% + ${offsetY}px)`;
    this.shadowRoot.appendChild(sparkle);
    setTimeout(() => sparkle.remove(), 600);
  }

  createCenterFlash(x, y, color) {
    const flash = document.createElement('div');
    flash.className = 'center-flash';
    flash.style.left = `${x}%`;
    flash.style.top = `${y}%`;
    flash.style.background = `radial-gradient(circle, #fff 0%, ${color} 40%, transparent 70%)`;
    this.shadowRoot.appendChild(flash);
    setTimeout(() => flash.remove(), 300);
  }
}

// Static color palettes for fireworks
CelebrationOverlay.COLOR_PALETTES = [
  ['#ff6b6b', '#ee5a5a', '#ff8787'],
  ['#ffd93d', '#ffec59', '#ffe066'],
  ['#6bcb77', '#4ade80', '#86efac'],
  ['#4d96ff', '#60a5fa', '#93c5fd'],
  ['#ff6bd6', '#f472b6', '#ff8de6'],
  ['#a855f7', '#c084fc', '#d8b4fe'],
  ['#f59e0b', '#fbbf24', '#fcd34d']
];

customElements.define('celebration-overlay', CelebrationOverlay);
export default CelebrationOverlay;
