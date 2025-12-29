// StepMania Button Web Component - ES Module
import { adoptSharedStyles } from './sharedStyles.js';

export class StepButton extends HTMLElement {
  constructor() {
    super();
    this.attachShadow({ mode: 'open' });
  }

  connectedCallback() {
    this.render();
    this.setupEventListeners();
    adoptSharedStyles(this.shadowRoot);
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
      <div class="step-button" id="${buttonId}">
        <div class="inner-glow"></div>
        <div class="arrow">${arrowSymbol}</div>
      </div>
    `;

    const button = this.shadowRoot.querySelector('.step-button');
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
    const rotations = {
      up: 'rotate(180deg)',
      down: 'rotate(0deg)',
      left: 'rotate(90deg)',
      right: 'rotate(-90deg)'
    };
    return `<div class="arrow-image" style="transform: ${rotations[direction]}"></div>`;
  }

  getComputedValue(tailwindClass) {
    const colorMap = {
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
    const button = this.shadowRoot.querySelector('.step-button');
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

    button.addEventListener('click', handleClick);

    button.addEventListener('touchstart', (e) => {
      e.preventDefault();
      handleClick();
    });
  }

  addPressedFeedback() {
    const button = this.shadowRoot.querySelector('.step-button');
    button.classList.add('button-pressed');
    setTimeout(() => {
      button.classList.remove('button-pressed');
    }, 150);
  }
}

// Register the web component
customElements.define('step-button', StepButton);

// Export
export default StepButton;
