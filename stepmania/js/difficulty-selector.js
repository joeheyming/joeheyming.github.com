// Difficulty Selector Web Component - ES Module
import { adoptSharedStyles } from './sharedStyles.js';
import { createComponentProxy } from './componentProxy.js';
import { scoreboard } from './scoreboard.js';

const SCOPE = 'stepmania';

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
    /** @type {string|null} Song key for PB lookups (null = skip the chip) */
    this.songKey = null;
    this.attachShadow({ mode: 'open' });
  }

  connectedCallback() {
    this.render();
    this.bindEvents();
    adoptSharedStyles(this.shadowRoot);
  }

  render() {
    // The <label> stays in the DOM but is visually hidden — the <select>
    // already exposes `aria-label="Difficulty"` for screen readers, and a
    // visible label above the pill was making this control taller than
    // the adjacent buttons and breaking row alignment.
    this.shadowRoot.innerHTML = `
      <span class="difficulty-selector" id="difficulty-selector">
        <label class="difficulty-label sr-only" for="difficulty-select">Difficulty</label>
        <select class="difficulty-select" id="difficulty-select" aria-label="Difficulty">
          <option value="">Difficulty</option>
        </select>
      </span>
    `;
  }

  bindEvents() {
    // Listen for custom events from parent
    this.addEventListener('setCharts', (event) => {
      this.setCharts(event.detail.charts, event.detail.songKey);
    });

    this.addEventListener('selectDifficulty', (event) => {
      this.selectDifficultyByIndex(event.detail.index);
    });

    this.addEventListener('reset', () => {
      this.reset();
    });
  }

  // Public API methods
  /**
   * @param {Array} charts
   * @param {string|null} [songKey] - Stable song key for PB lookups.
   *   When provided, each option label is decorated with the player's PB
   *   for that chart (e.g. "Hard (12) · PB 94.2%"). Omit/pass null to
   *   keep the dropdown PB-free (used by tests / contexts without a song).
   */
  setCharts(charts, songKey = null) {
    this.charts = charts;
    this.songKey = songKey || null;
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
    select.innerHTML = '<option value="">Difficulty</option>';

    // Create difficulty options if charts are available
    if (this.charts && this.charts.length > 0) {
      this.charts.forEach((chart, index) => {
        const option = document.createElement('option');
        option.value = index;
        option.textContent = this._labelForChart(chart, index);
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

  /**
   * Format the dropdown label for a single chart. When a song key has been
   * supplied (i.e. setCharts was called from the real app path, not a
   * test), append the player's PB if one exists. Native <option> elements
   * don't support markup, so this is plain text — the gold star suffix is
   * deliberately compact so it doesn't blow out the dropdown width on
   * mobile.
   *
   * @private
   * @param {{difficulty: string, rating: number|string}} chart
   * @param {number} index
   * @returns {string}
   */
  _labelForChart(chart, index) {
    const base = `${chart.difficulty} (${chart.rating})`;
    if (!this.songKey) return base;
    const pb = scoreboard.getPB(SCOPE, this.songKey, index, chart.difficulty);
    if (!pb) return base;
    return `${base} · PB ${pb.percent.toFixed(1)}% ${pb.grade}`;
  }

  handleDifficultySelection(chartIndex) {
    this.selectedDifficulty = chartIndex;

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
