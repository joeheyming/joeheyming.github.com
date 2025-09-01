// Difficulty Selector Web Component
class DifficultySelectorElement extends HTMLElement {
  constructor() {
    super();
    this.selectedDifficulty = null;
    this.charts = [];
    this.onChangeCallback = null;
    this.layout = this.getAttribute('layout') || 'vertical'; // Default to vertical
    this.attachShadow({ mode: 'open' });
  }

  connectedCallback() {
    this.render();
    this.bindEvents();
  }

  render() {
    const isHorizontal = this.layout === 'horizontal';

    this.shadowRoot.innerHTML = `
      <style>
        :host {
          display: block;
          width: 100%;
        }
        
        .difficulty-selector {
          display: ${isHorizontal ? 'flex' : 'block'};
          flex-direction: ${isHorizontal ? 'row' : 'column'};
          align-items: ${isHorizontal ? 'center' : 'flex-start'};
          gap: ${isHorizontal ? '1rem' : '0'};
          margin-bottom: 1.5rem;
        }
        
        .difficulty-selector.hidden {
          display: none;
        }
        
        .difficulty-title {
          font-size: ${isHorizontal ? '1rem' : '1.25rem'};
          font-weight: bold;
          color: white;
          margin-bottom: ${isHorizontal ? '0' : '1rem'};
          text-align: ${isHorizontal ? 'left' : 'center'};
          white-space: nowrap;
          display: ${isHorizontal ? 'flex' : 'block'};
          align-items: center;
          height: ${isHorizontal ? '100%' : 'auto'};
        }
        
        .difficulty-select {
          width: ${isHorizontal ? 'auto' : '100%'};
          max-width: ${isHorizontal ? '200px' : '300px'};
          margin: ${isHorizontal ? '0' : '0 auto'};
          display: block;
          padding: 0.75rem 1rem;
          font-size: 1rem;
          font-weight: bold;
          color: white;
          background: linear-gradient(to right, #3b82f6, #2563eb);
          border: 2px solid rgba(139, 92, 246, 0.3);
          border-radius: 0.5rem;
          cursor: pointer;
          transition: all 0.2s;
          outline: none;
        }
        
        .difficulty-select:hover {
          background: linear-gradient(to right, #2563eb, #1d4ed8);
          border-color: rgba(139, 92, 246, 0.6);
          transform: scale(1.02);
        }
        
        .difficulty-select:focus {
          border-color: rgba(0, 245, 255, 0.6);
          box-shadow: 0 0 0 3px rgba(0, 245, 255, 0.2);
        }
        
        .difficulty-select option {
          background: #1f2937;
          color: white;
          padding: 0.5rem;
        }
        
        .difficulty-select option:hover {
          background: #374151;
        }
      </style>
      
      <div class="difficulty-selector" id="difficulty-selector">
        <select class="difficulty-select" id="difficulty-select">
          <option value="">Choose a difficulty...</option>
        </select>
      </div>
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
    select.innerHTML = '<option value="">Choose a difficulty...</option>';

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

    // Call the onChange callback if provided
    if (this.onChangeCallback && typeof this.onChangeCallback === 'function') {
      this.onChangeCallback(chartIndex, this.charts[chartIndex]);
    }
  }
}

// Register the web component
customElements.define('difficulty-selector', DifficultySelectorElement);

// Make globally accessible for backward compatibility
window.DifficultySelector = DifficultySelectorElement;
