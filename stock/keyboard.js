// Stock Ticker — global keyboard shortcuts.
// Pure factory: returns a single keydown handler bound to the supplied actions.

import { RANGES } from './state.js';

/**
 * @param {{
 *   getState: () => any,
 *   $search: HTMLInputElement,
 *   $log: HTMLInputElement,
 *   $normalize: HTMLInputElement,
 *   $indicatorsMenu: HTMLElement,
 *   $helpModal: HTMLElement,
 *   saveState: () => void,
 *   refreshAll: () => void,
 *   renderChart: () => void,
 *   renderTypeButtons: () => void,
 *   renderRangeButtons: () => void,
 *   renderIndicatorsMenu: () => void,
 *   applyMode: () => void,
 * }} ctx
 */
export function createKeyboardHandler(ctx) {
  return function onKeydown(e) {
    if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) {
      return;
    }
    if (e.metaKey || e.ctrlKey || e.altKey) return;
    const state = ctx.getState();
    const key = e.key;
    if (key === '/') {
      e.preventDefault();
      ctx.$search.focus();
    } else if (key === 'r' || key === 'R') {
      ctx.refreshAll();
    } else if (key === 'l' || key === 'L') {
      state.logScale = !state.logScale;
      ctx.$log.checked = state.logScale;
      ctx.saveState();
      ctx.renderChart();
    } else if (key === '%') {
      state.normalize = !state.normalize;
      ctx.$normalize.checked = state.normalize;
      ctx.saveState();
      ctx.renderChart();
    } else if (key === 'v' || key === 'V') {
      state.showVolume = !state.showVolume;
      ctx.saveState();
      ctx.renderIndicatorsMenu();
      ctx.renderChart();
    } else if (key === 'i' || key === 'I') {
      ctx.$indicatorsMenu.classList.toggle('hidden');
    } else if (key === '?') {
      ctx.$helpModal.classList.remove('hidden');
    } else if (key === 'Escape') {
      ctx.$helpModal.classList.add('hidden');
      ctx.$indicatorsMenu.classList.add('hidden');
    } else if (key === 'c' || key === 'C') {
      state.chartType = 'line';
      ctx.saveState();
      ctx.renderTypeButtons();
      ctx.renderChart();
    } else if (key === 'a' || key === 'A') {
      state.chartType = 'area';
      ctx.saveState();
      ctx.renderTypeButtons();
      ctx.renderChart();
    } else if (key === 'k' || key === 'K') {
      state.chartType = 'candle';
      ctx.saveState();
      ctx.renderTypeButtons();
      ctx.renderChart();
    } else if (key === 'm' || key === 'M') {
      const modes = /** @type {const} */ (['chart', 'heatmap', 'portfolio']);
      const idx = modes.indexOf(state.mode);
      state.mode = modes[(idx + 1) % modes.length];
      ctx.saveState();
      ctx.applyMode();
    } else if (/^[1-8]$/.test(key)) {
      const r = RANGES[parseInt(key, 10) - 1];
      if (r) {
        state.range = r.id;
        ctx.saveState();
        ctx.renderRangeButtons();
        ctx.refreshAll();
      }
    }
  };
}
