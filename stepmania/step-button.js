// StepMania Button Web Component
class StepButton extends HTMLElement {
  constructor() {
    super();
    this.attachShadow({ mode: 'open' });
  }

  connectedCallback() {
    this.render();
    this.setupEventListeners();
  }

  static get observedAttributes() {
    return ['direction', 'color', 'id'];
  }

  attributeChangedCallback(name, oldValue, newValue) {
    if (oldValue !== newValue) {
      this.render();
    }
  }

  render() {
    const direction = this.getAttribute('direction') || 'up';
    const color = this.getAttribute('color') || 'green';
    const buttonId = this.getAttribute('id') || 'button0';

    const colorMap = {
      green: {
        bg: 'from-green-400 to-green-600',
        border: 'border-green-300',
        hover:
          'hover:shadow-green-400/70 hover:border-green-200 hover:from-green-300 hover:to-green-500',
        active: 'active:from-green-500 active:to-green-700',
        inner: 'from-green-200 to-green-400'
      },
      red: {
        bg: 'from-red-400 to-red-600',
        border: 'border-red-300',
        hover: 'hover:shadow-red-400/70 hover:border-red-200 hover:from-red-300 hover:to-red-500',
        active: 'active:from-red-500 active:to-red-700',
        inner: 'from-red-200 to-red-400'
      },
      blue: {
        bg: 'from-blue-400 to-blue-600',
        border: 'border-blue-300',
        hover:
          'hover:shadow-blue-400/70 hover:border-blue-200 hover:from-blue-300 hover:to-blue-500',
        active: 'active:from-blue-500 active:to-blue-700',
        inner: 'from-blue-200 to-blue-400'
      },
      yellow: {
        bg: 'from-yellow-400 to-yellow-600',
        border: 'border-yellow-300',
        hover:
          'hover:shadow-yellow-400/70 hover:border-yellow-200 hover:from-yellow-300 hover:to-yellow-500',
        active: 'active:from-yellow-500 active:to-yellow-700',
        inner: 'from-yellow-200 to-yellow-400'
      }
    };

    const colors = colorMap[color] || colorMap.green;
    const arrowSymbol = this.getArrowSymbol(direction);

    this.shadowRoot.innerHTML = `
      <style>
        :host {
          display: block;
        }
        
        .button {
          width: 44px;
          height: 44px;
          background: linear-gradient(to bottom right, var(--bg-from), var(--bg-to));
          border: 2px solid var(--border-color);
          border-radius: 8px;
          box-shadow: 0 4px 6px -1px rgba(0, 0, 0, 0.1);
          cursor: pointer;
          user-select: none;
          position: relative;
          transition: all 0.15s ease;
          transform: translateZ(0);
        }

        .button:hover {
          box-shadow: 0 20px 25px -5px var(--hover-shadow);
          border-color: var(--hover-border);
          background: linear-gradient(to bottom right, var(--hover-from), var(--hover-to));
          transform: scale(1.1);
        }

        .button:active {
          transform: scale(0.9);
          box-shadow: inset 0 4px 8px rgba(0, 0, 0, 0.3);
          background: linear-gradient(to bottom right, var(--active-from), var(--active-to));
        }

        .button-pressed {
          transform: scale(0.85) !important;
          box-shadow: inset 0 4px 8px rgba(0, 0, 0, 0.3) !important;
          filter: brightness(0.8) !important;
        }

        .inner-glow {
          position: absolute;
          inset: 4px;
          background: linear-gradient(to bottom right, var(--inner-from), var(--inner-to));
          border-radius: 6px;
          opacity: 0.6;
        }

        .arrow {
          position: absolute;
          inset: 0;
          display: flex;
          align-items: center;
          justify-content: center;
          color: white;
          font-weight: bold;
          font-size: 14px;
        }

        @media (min-width: 768px) {
          .button {
            width: 48px;
            height: 48px;
          }
          
          .arrow {
            font-size: 16px;
          }
        }

        @media (prefers-reduced-motion: reduce) {
          .button {
            transition: none;
          }
        }
      </style>

      <div class="button" id="${buttonId}">
        <div class="inner-glow"></div>
        <div class="arrow">${arrowSymbol}</div>
      </div>
    `;

    // Set CSS custom properties
    const button = this.shadowRoot.querySelector('.button');
    button.style.setProperty('--bg-from', this.getComputedValue(colors.bg.split(' ')[0]));
    button.style.setProperty('--bg-to', this.getComputedValue(colors.bg.split(' ')[1]));
    button.style.setProperty('--border-color', this.getComputedValue(colors.border));
    button.style.setProperty('--hover-shadow', this.getComputedValue(colors.hover.split(' ')[0]));
    button.style.setProperty('--hover-border', this.getComputedValue(colors.hover.split(' ')[1]));
    button.style.setProperty('--hover-from', this.getComputedValue(colors.hover.split(' ')[2]));
    button.style.setProperty('--hover-to', this.getComputedValue(colors.hover.split(' ')[3]));
    button.style.setProperty('--active-from', this.getComputedValue(colors.active.split(' ')[0]));
    button.style.setProperty('--active-to', this.getComputedValue(colors.active.split(' ')[1]));
    button.style.setProperty('--inner-from', this.getComputedValue(colors.inner.split(' ')[0]));
    button.style.setProperty('--inner-to', this.getComputedValue(colors.inner.split(' ')[1]));
  }

  getArrowSymbol(direction) {
    const symbols = {
      up: '↑',
      down: '↓',
      left: '←',
      right: '→'
    };
    return symbols[direction] || '↑';
  }

  getComputedValue(tailwindClass) {
    // Convert Tailwind classes to CSS values
    const colorMap = {
      'from-green-400': '#4ade80',
      'to-green-600': '#16a34a',
      'border-green-300': '#86efac',
      'hover:shadow-green-400/70': 'rgba(74, 222, 128, 0.7)',
      'hover:border-green-200': '#bbf7d0',
      'hover:from-green-300': '#86efac',
      'hover:to-green-500': '#22c55e',
      'active:from-green-500': '#22c55e',
      'active:to-green-700': '#15803d',
      'from-green-200': '#bbf7d0',
      'to-green-400': '#4ade80',

      'from-red-400': '#f87171',
      'to-red-600': '#dc2626',
      'border-red-300': '#fca5a5',
      'hover:shadow-red-400/70': 'rgba(248, 113, 113, 0.7)',
      'hover:border-red-200': '#fecaca',
      'hover:from-red-300': '#fca5a5',
      'hover:to-red-500': '#ef4444',
      'active:from-red-500': '#ef4444',
      'active:to-red-700': '#b91c1c',
      'from-red-200': '#fecaca',
      'to-red-400': '#f87171',

      'from-blue-400': '#60a5fa',
      'to-blue-600': '#2563eb',
      'border-blue-300': '#93c5fd',
      'hover:shadow-blue-400/70': 'rgba(96, 165, 250, 0.7)',
      'hover:border-blue-200': '#bfdbfe',
      'hover:from-blue-300': '#93c5fd',
      'hover:to-blue-500': '#3b82f6',
      'active:from-blue-500': '#3b82f6',
      'active:to-blue-700': '#1d4ed8',
      'from-blue-200': '#bfdbfe',
      'to-blue-400': '#60a5fa',

      'from-yellow-400': '#facc15',
      'to-yellow-600': '#ca8a04',
      'border-yellow-300': '#fde047',
      'hover:shadow-yellow-400/70': 'rgba(250, 204, 21, 0.7)',
      'hover:border-yellow-200': '#fef3c7',
      'hover:from-yellow-300': '#fde047',
      'hover:to-yellow-500': '#eab308',
      'active:from-yellow-500': '#eab308',
      'active:to-yellow-700': '#a16207',
      'from-yellow-200': '#fef3c7',
      'to-yellow-400': '#facc15'
    };

    return colorMap[tailwindClass] || tailwindClass;
  }

  setupEventListeners() {
    const button = this.shadowRoot.querySelector('.button');
    const buttonId = this.getAttribute('id') || 'button0';

    // Click event
    button.addEventListener('click', () => {
      this.dispatchEvent(
        new CustomEvent('stepButtonClick', {
          detail: { buttonId, direction: this.getAttribute('direction') },
          bubbles: true,
          composed: true
        })
      );
    });

    // Touch events for mobile
    button.addEventListener('touchstart', (e) => {
      e.preventDefault();
      this.dispatchEvent(
        new CustomEvent('stepButtonClick', {
          detail: { buttonId, direction: this.getAttribute('direction') },
          bubbles: true,
          composed: true
        })
      );
    });
  }

  // Method to add pressed feedback
  addPressedFeedback() {
    const button = this.shadowRoot.querySelector('.button');
    button.classList.add('button-pressed');
    setTimeout(() => {
      button.classList.remove('button-pressed');
    }, 150);
  }
}

// Register the web component
customElements.define('step-button', StepButton);
