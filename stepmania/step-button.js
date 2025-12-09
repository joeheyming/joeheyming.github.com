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
        bg: 'from-cyan-300 to-blue-400',
        border: 'border-black',
        hover: 'hover:shadow-cyan-300/80 hover:border-black hover:from-cyan-200 hover:to-blue-300',
        active: 'active:from-cyan-400 active:to-blue-500',
        inner: 'from-cyan-100 to-blue-200'
      },
      red: {
        bg: 'from-pink-300 to-red-400',
        border: 'border-black',
        hover: 'hover:shadow-pink-300/80 hover:border-black hover:from-pink-200 hover:to-red-300',
        active: 'active:from-pink-400 active:to-red-500',
        inner: 'from-pink-100 to-red-200'
      },
      blue: {
        bg: 'from-cyan-300 to-blue-400',
        border: 'border-black',
        hover: 'hover:shadow-cyan-300/80 hover:border-black hover:from-cyan-200 hover:to-blue-300',
        active: 'active:from-cyan-400 active:to-blue-500',
        inner: 'from-cyan-100 to-blue-200'
      },
      yellow: {
        bg: 'from-pink-300 to-red-400',
        border: 'border-black',
        hover: 'hover:shadow-pink-300/80 hover:border-black hover:from-pink-200 hover:to-red-300',
        active: 'active:from-pink-400 active:to-red-500',
        inner: 'from-pink-100 to-red-200'
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
          width: 60px;
          height: 60px;
          background: linear-gradient(135deg, var(--bg-from) 0%, var(--bg-to) 50%, var(--bg-from) 100%);
          border: 3px solid var(--border-color);
          border-radius: 12px;
          box-shadow: 
            0 4px 6px -1px rgba(0, 0, 0, 0.1),
            inset 0 1px 0 rgba(255, 255, 255, 0.3),
            inset 0 -1px 0 rgba(0, 0, 0, 0.2);
          cursor: pointer;
          user-select: none;
          position: relative;
          transition: all 0.15s ease;
          transform: translateZ(0);
        }

        .button:hover {
          box-shadow: 
            0 20px 25px -5px var(--hover-shadow),
            inset 0 1px 0 rgba(255, 255, 255, 0.4),
            inset 0 -1px 0 rgba(0, 0, 0, 0.3);
          border-color: var(--hover-border);
          background: linear-gradient(135deg, var(--hover-from) 0%, var(--hover-to) 50%, var(--hover-from) 100%);
          transform: scale(1.1);
        }

        .button:active {
          transform: scale(0.9);
          box-shadow: 
            inset 0 4px 8px rgba(0, 0, 0, 0.3),
            inset 0 1px 0 rgba(255, 255, 255, 0.2);
          background: linear-gradient(135deg, var(--active-from) 0%, var(--active-to) 50%, var(--active-from) 100%);
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
        }

        .arrow-image {
          width: 40px;
          height: 40px;
          background-image: url('img/down-target.png');
          background-size: 120px 40px; /* 3 frames * 40px each */
          background-repeat: no-repeat;
          background-position: 0 0; /* Show first frame */
          transition: transform 0.15s ease;
        }

        @media (min-width: 768px) {
          .button {
            width: 64px;
            height: 64px;
          }
          
          .arrow-image {
            width: 48px;
            height: 48px;
            background-size: 144px 48px; /* 3 frames * 48px each */
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
    // Use the existing down button image and rotate it for different directions
    const rotations = {
      up: 'rotate(180deg)',
      down: 'rotate(0deg)',
      left: 'rotate(90deg)',
      right: 'rotate(-90deg)'
    };
    return `<div class="arrow-image" style="transform: ${rotations[direction]}"></div>`;
  }

  getComputedValue(tailwindClass) {
    // Convert Tailwind classes to CSS values - Metallic Dance Pad Colors
    const colorMap = {
      // Metallic Blue (Up/Down arrows) - Shiny metallic blue gradient
      'from-cyan-300': '#00bcd4',
      'to-blue-400': '#1976d2',
      'border-black': '#000000',
      'hover:shadow-cyan-300/80': 'rgba(0, 188, 212, 0.8)',
      'hover:border-black': '#000000',
      'hover:from-cyan-200': '#26c6da',
      'hover:to-blue-300': '#42a5f5',
      'active:from-cyan-400': '#00acc1',
      'active:to-blue-500': '#1565c0',
      'from-cyan-100': '#b2ebf2',
      'to-blue-200': '#90caf9',

      // Metallic Red/Pink (Left/Right arrows) - Shiny metallic red gradient
      'from-pink-300': '#e91e63',
      'to-red-400': '#d32f2f',
      'hover:shadow-pink-300/80': 'rgba(233, 30, 99, 0.8)',
      'hover:from-pink-200': '#f06292',
      'hover:to-red-300': '#ef5350',
      'active:from-pink-400': '#c2185b',
      'active:to-red-500': '#c62828',
      'from-pink-100': '#f8bbd9',
      'to-red-200': '#ffcdd2'
    };

    return colorMap[tailwindClass] || tailwindClass;
  }

  setupEventListeners() {
    const button = this.shadowRoot.querySelector('.button');
    const buttonId = this.getAttribute('id') || 'button0';
    const direction = this.getAttribute('direction') || 'up';

    const handleClick = () => {
      this.dispatchEvent(
        new CustomEvent('stepButtonClick', {
          detail: { buttonId, direction },
          bubbles: true,
          composed: true
        })
      );
    };

    // Click event
    button.addEventListener('click', handleClick);

    // Touch events for mobile
    button.addEventListener('touchstart', (e) => {
      e.preventDefault();
      handleClick();
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
