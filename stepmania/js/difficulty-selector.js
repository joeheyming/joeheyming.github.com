// Difficulty Selector Web Component - ES Module
import { adoptSharedStyles } from './sharedStyles.js';
import { createComponentProxy } from './componentProxy.js';

/**
 * Get difficulty from URL as a number (or null)
 * @returns {number|null}
 */
export function getDifficultyFromURL() {
  const params = new URLSearchParams(window.location.search);
  const difficulty = params.get('difficulty');
  return difficulty !== null ? parseInt(difficulty) : null;
}

class DifficultySelectorElement extends HTMLElement {
  /** @type {DifficultySelectorElement|null} */
  static _instance = null;

  /**
   * Get the singleton instance of the difficulty selector
   * @returns {DifficultySelectorElement|null}
   */
  static get() {
    if (!DifficultySelectorElement._instance) {
      DifficultySelectorElement._instance = document.getElementById('main-difficulty-selector');
    }
    return DifficultySelectorElement._instance;
  }

  constructor() {
    super();
    this.selectedDifficulty = null;
    this.charts = [];
    this.onChangeCallback = null;
    this.attachShadow({ mode: 'open' });
  }

  connectedCallback() {
    this.render();
    this.bindEvents();
    adoptSharedStyles(this.shadowRoot);
  }

  render() {
    this.shadowRoot.innerHTML = `
      <span class="difficulty-selector" id="difficulty-selector">
        <select class="difficulty-select" id="difficulty-select">
          <option value="">Difficulty</option>
        </select>
      </span>
    `;
  }

  bindEvents() {
    // Listen for custom events from parent
    this.addEventListener('setCharts', (event) => {
      this.setCharts(event.detail.charts);
    });

    this.addEventListener('selectDifficulty', (event) => {
      this.selectDifficultyByIndex(event.detail.index);
    });

    this.addEventListener('reset', () => {
      this.reset();
    });
  }

  // Public API methods
  setCharts(charts) {
    this.charts = charts;
    this.renderDifficultyOptions();
    if (charts && charts.length > 0) {
      this.show();
    } else {
      this.hide();
    }
  }

  /**
   * Sync difficulty selection from URL parameter
   * @returns {number|null} The selected difficulty index, or null if not synced
   */
  syncFromURL() {
    const difficultyIndex = getDifficultyFromURL();
    if (difficultyIndex === null) return null;

    if (difficultyIndex >= 0 && difficultyIndex < this.charts.length) {
      this.selectDifficultyByIndex(difficultyIndex);
      return difficultyIndex;
    }
    return null;
  }

  setOnChange(callback) {
    this.onChangeCallback = callback;
  }

  selectDifficultyByIndex(index) {
    const select = this.shadowRoot.getElementById('difficulty-select');
    if (select && index >= 0 && index < this.charts.length) {
      select.value = index;
      this.handleDifficultySelection(index);
    }
  }

  show() {
    this.shadowRoot.getElementById('difficulty-selector').classList.remove('hidden');
  }

  hide() {
    this.shadowRoot.getElementById('difficulty-selector').classList.add('hidden');
  }

  reset() {
    this.selectedDifficulty = null;
    this.charts = [];
    this.hide();

    // Reset select element
    const select = this.shadowRoot.getElementById('difficulty-select');
    if (select) {
      select.value = '';
    }
  }

  getSelectedDifficulty() {
    return this.selectedDifficulty;
  }

  getSelectedChart() {
    if (this.selectedDifficulty !== null && this.charts[this.selectedDifficulty]) {
      return this.charts[this.selectedDifficulty];
    }
    return null;
  }

  // Private methods
  renderDifficultyOptions() {
    const select = this.shadowRoot.getElementById('difficulty-select');
    select.innerHTML = '<option value="">Level</option>';

    // Create difficulty options if charts are available
    if (this.charts && this.charts.length > 0) {
      this.charts.forEach((chart, index) => {
        const option = document.createElement('option');
        option.value = index;
        option.textContent = `${chart.difficulty} (${chart.rating})`;
        select.appendChild(option);
      });
    } else {
      // Add a disabled option when no charts are available
      const option = document.createElement('option');
      option.value = '';
      option.textContent = 'No difficulties available';
      option.disabled = true;
      select.appendChild(option);
    }

    // Add change event listener
    select.addEventListener('change', (event) => {
      const selectedIndex = parseInt(event.target.value);
      if (!isNaN(selectedIndex) && selectedIndex >= 0) {
        this.handleDifficultySelection(selectedIndex);
      }
    });
  }

  handleDifficultySelection(chartIndex) {
    this.selectedDifficulty = chartIndex;

    // Track analytics event
    if (this.charts[chartIndex]) {
      const chart = this.charts[chartIndex];
      if (typeof window.trackEvent === 'function') {
        window.trackEvent(
          'difficulty_change',
          'StepMania',
          `${chart.difficulty} (${chart.rating})`
        );
      }
    }

    // Call the onChange callback if provided
    if (this.onChangeCallback && typeof this.onChangeCallback === 'function') {
      this.onChangeCallback(chartIndex, this.charts[chartIndex]);
    }
  }
}

// Register the web component
customElements.define('difficulty-selector', DifficultySelectorElement);

// Create proxy for singleton access
export const DifficultySelector = createComponentProxy(DifficultySelectorElement);

export default DifficultySelector;
