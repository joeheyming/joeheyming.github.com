import { initGraphMode } from './graph-mode.js';

const MODE_KEY = 'calculator-mode';

/** @typedef {'standard' | 'graph'} CalcMode */

/** @type {CalcMode} */
let currentMode = 'standard';

/**
 * @param {CalcMode} mode
 */
function setMode(mode) {
  currentMode = mode;
  const app = document.getElementById('calc-app');
  const panelStandard = document.getElementById('calc-panel-standard');
  const panelGraph = document.getElementById('calc-panel-graph');
  const tabs = document.querySelectorAll('.calc-mode-tab');

  document.body.classList.toggle('calc-page--standard', mode === 'standard');
  document.body.classList.toggle('calc-page--graph', mode === 'graph');
  app?.classList.toggle('calc-app--standard', mode === 'standard');
  app?.classList.toggle('calc-app--graph', mode === 'graph');

  if (panelStandard) {
    panelStandard.hidden = mode !== 'standard';
  }
  if (panelGraph) {
    panelGraph.hidden = mode !== 'graph';
  }

  tabs.forEach((tab) => {
    const tabMode = tab.getAttribute('data-mode');
    const active = tabMode === mode;
    tab.classList.toggle('calc-mode-tab--active', active);
    tab.setAttribute('aria-selected', active ? 'true' : 'false');
  });

  try {
    localStorage.setItem(MODE_KEY, mode);
  } catch {
    /* private browsing */
  }

  if (mode === 'graph' && graphRedraw) {
    graphRedraw();
  }
}

/** @type {(() => void) | null} */
let graphRedraw = null;

/**
 * @param {(action: string) => void} applyCalcAction
 */
function initializeStandardKeyboard(applyCalcAction) {
  /** @type {Record<string, string>} */
  const keyMap = {
    0: '0',
    1: '1',
    2: '2',
    3: '3',
    4: '4',
    5: '5',
    6: '6',
    7: '7',
    8: '8',
    9: '9',
    '+': '+',
    '-': '-',
    '*': '*',
    '/': '/',
    '.': '.',
    '=': '=',
    '%': 'percent'
  };

  document.addEventListener('keydown', (e) => {
    if (currentMode !== 'standard') {
      return;
    }
    const tag = /** @type {HTMLElement} */ (e.target).tagName;
    if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') {
      return;
    }
    if (e.ctrlKey || e.metaKey || e.altKey) {
      return;
    }

    let action = null;
    if (e.key === 'Enter') {
      action = '=';
    } else if (e.key === 'Escape') {
      action = 'clear';
    } else if (e.key === 'Backspace') {
      action = 'backspace';
    } else if (e.key in keyMap) {
      action = keyMap[e.key];
    }

    if (!action) {
      return;
    }

    e.preventDefault();
    applyCalcAction(action);
  });
}

function initializeCalculator() {
  const display = document.querySelector('#calc-display');
  const buttons = document.querySelectorAll('.calculator-button');

  if (!display) {
    return;
  }

  let currentValue = '0';
  let previousValue = null;
  /** @type {string | null} */
  let operation = null;
  let waitingForOperand = false;

  function updateDisplay() {
    display.textContent = currentValue;
  }

  /**
   * @param {string} value
   */
  function applyCalcAction(value) {
    if ('0123456789'.includes(value)) {
      if (waitingForOperand) {
        currentValue = value;
        waitingForOperand = false;
      } else {
        currentValue = currentValue === '0' ? value : currentValue + value;
      }
      updateDisplay();
    } else if (value === '.') {
      if (waitingForOperand) {
        currentValue = '0.';
        waitingForOperand = false;
        updateDisplay();
      } else if (currentValue.indexOf('.') === -1) {
        currentValue += '.';
        updateDisplay();
      }
    } else if (value === 'backspace') {
      if (waitingForOperand) {
        return;
      }
      if (currentValue.length <= 1) {
        currentValue = '0';
      } else {
        currentValue = currentValue.slice(0, -1);
      }
      updateDisplay();
    } else if (['+', '-', '*', '/'].includes(value)) {
      if (previousValue !== null && !waitingForOperand) {
        calculate();
      }

      previousValue = parseFloat(currentValue);
      operation = value;
      waitingForOperand = true;
    } else if (value === '=') {
      calculate();
    } else if (value === 'clear') {
      currentValue = '0';
      previousValue = null;
      operation = null;
      waitingForOperand = false;
      updateDisplay();
    } else if (value === 'sign') {
      currentValue = (parseFloat(currentValue) * -1).toString();
      updateDisplay();
    } else if (value === 'percent') {
      currentValue = (parseFloat(currentValue) / 100).toString();
      updateDisplay();
    }
  }

  buttons.forEach((button) => {
    button.addEventListener('click', () => {
      const value = button.getAttribute('data-calc');
      if (value) {
        applyCalcAction(value);
      }
    });
  });

  function calculate() {
    if (previousValue !== null && operation && !waitingForOperand) {
      const current = parseFloat(currentValue);
      const previous = previousValue;

      let result;
      switch (operation) {
        case '+':
          result = previous + current;
          break;
        case '-':
          result = previous - current;
          break;
        case '*':
          result = previous * current;
          break;
        case '/':
          result = current !== 0 ? previous / current : 0;
          break;
        default:
          return;
      }

      currentValue = result.toString();
      previousValue = null;
      operation = null;
      waitingForOperand = true;
      updateDisplay();
    }
  }

  initializeStandardKeyboard(applyCalcAction);
}

function initializeModeSwitch() {
  document.querySelectorAll('.calc-mode-tab').forEach((tab) => {
    tab.addEventListener('click', () => {
      const mode = tab.getAttribute('data-mode');
      if (mode === 'standard' || mode === 'graph') {
        setMode(mode);
      }
    });
  });

  /** @type {CalcMode} */
  let initial = 'standard';
  try {
    const stored = localStorage.getItem(MODE_KEY);
    if (stored === 'graph' || stored === 'standard') {
      initial = stored;
    }
  } catch {
    /* ignore */
  }
  setMode(initial);
}

document.addEventListener('DOMContentLoaded', () => {
  initializeCalculator();
  const graphPanel = document.getElementById('calc-panel-graph');
  if (graphPanel) {
    const api = initGraphMode(graphPanel);
    if (api?.redraw) {
      graphRedraw = api.redraw;
    }
  }
  initializeModeSwitch();
});
