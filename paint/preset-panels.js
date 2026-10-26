// Paint — the preset panels (PhotoCraft crates/ui-egui/src/preset_panels.rs): Gradients and
// Patterns (tabs of the Color group), Styles (a section of the Layers panel), and Clone Source (a
// section of the Brushes panel). Clicking a gradient sets the Gradient tool's preset, a pattern
// becomes the Pattern Stamp / fill pattern, and a style is applied to the selected layers.

import { GRADIENT_PRESET_GROUPS, swatchBackground } from './gradient-presets.js';
import { STYLE_PRESET_GROUPS } from './style-presets.js';
import {
  DEFAULT_CLONE_TRANSFORM,
  cloneSourceOffset,
  cloneTransformOf,
  setCloneOffset,
  setCloneTransform
} from './clone-source.js';

/** gradient.presets.select: the Gradient tool paints preset `group/name` from now on. */
export function selectGradientPreset(state, value) {
  state.toolOptions.gradient ||= {};
  state.toolOptions.gradient.preset = value;
}

/** Edit › Define Pattern adds to the Patterns panel and makes the new pattern current. */
export function addPattern(state, pattern) {
  state.patterns ||= [];
  const entry = { name: `Pattern ${state.patterns.length + 1}`, pattern };
  state.patterns.push(entry);
  state.pattern = pattern;
  return entry;
}

/** pattern.presets.select: the Patterns panel entry at index becomes the current pattern. */
export function selectPattern(state, index) {
  const entry = state.patterns?.[index];
  if (!entry) return false;
  state.pattern = entry.pattern;
  return true;
}

/** The active Clone Source record, created on first use. */
export function cloneSourceOf(state) {
  state.clone ||= { source: null, offset: null, anchor: null };
  state.clone.transform = cloneTransformOf(state.clone.transform);
  return state.clone;
}

function el(doc, tag, props = {}, kids = []) {
  const node = doc.createElement(tag);
  Object.assign(node, props);
  for (const k of kids) node.append(k);
  return node;
}

function patternThumb(doc, pattern) {
  const c = doc.createElement('canvas');
  c.width = pattern.width;
  c.height = pattern.height;
  c.className = 'pattern-thumb';
  const ctx = c.getContext?.('2d');
  if (ctx?.createImageData) {
    const img = ctx.createImageData(pattern.width, pattern.height);
    img.data.set(pattern.data);
    ctx.putImageData(img, 0, 0);
  }
  return c;
}

// The Clone Source grid: [key, label, unit] rows, PhotoCraft's X / Y / W / H / A.
const CLONE_FIELDS = [
  ['x', 'X', 'px'],
  ['y', 'Y', 'px'],
  ['width', 'W', '%'],
  ['height', 'H', '%'],
  ['rotation', 'A', '°']
];

/**
 * Fill the preset panels. hooks: colors() → [fg, bg] for gradient swatches, onGradientChange()
 * after a gradient is picked, applyStyle(preset, add) for a Styles click. Returns
 * { refresh, renderPatterns, renderCloneSource }.
 */
export function initPresetPanels(state, hooks = {}, doc = globalThis.document) {
  const {
    colors = () => ['#000000', '#ffffff'],
    onGradientChange = () => {},
    applyStyle = () => {}
  } = hooks;
  const gradientPanel = doc.getElementById('panel-gradients');
  const patternPanel = doc.getElementById('panel-patterns');
  const styleList = doc.getElementById('style-preset-list');
  const cloneBox = doc.getElementById('clone-source-fields');

  function renderGradients() {
    if (!gradientPanel) return;
    const [fg, bg] = colors();
    const current = state.toolOptions.gradient?.preset;
    gradientPanel.replaceChildren();
    for (const g of GRADIENT_PRESET_GROUPS) {
      const grid = el(doc, 'div', { className: 'preset-grid' });
      for (const p of g.presets) {
        const value = `${g.name}/${p.name}`;
        const btn = el(doc, 'button', { type: 'button', className: 'preset-swatch', title: p.name });
        btn.dataset.gradient = value;
        btn.setAttribute('aria-label', p.name);
        btn.setAttribute('aria-pressed', String(value === current));
        btn.style.backgroundImage = swatchBackground(p, fg, bg);
        btn.addEventListener('click', () => {
          selectGradientPreset(state, value);
          renderGradients();
          onGradientChange();
        });
        grid.append(btn);
      }
      gradientPanel.append(el(doc, 'div', { className: 'preset-group-name', textContent: g.name }));
      gradientPanel.append(grid);
    }
  }

  function renderPatterns() {
    if (!patternPanel) return;
    patternPanel.replaceChildren();
    const list = state.patterns ?? [];
    if (!list.length) {
      patternPanel.append(
        el(doc, 'p', { className: 'panel-empty', textContent: 'Edit › Define Pattern adds one' })
      );
      return;
    }
    const grid = el(doc, 'div', { className: 'preset-grid' });
    list.forEach((entry, i) => {
      const btn = el(doc, 'button', { type: 'button', className: 'preset-swatch', title: entry.name });
      btn.dataset.pattern = String(i);
      btn.setAttribute('aria-label', entry.name);
      btn.setAttribute('aria-pressed', String(entry.pattern === state.pattern));
      btn.append(patternThumb(doc, entry.pattern));
      btn.addEventListener('click', () => {
        selectPattern(state, i);
        renderPatterns();
      });
      grid.append(btn);
    });
    patternPanel.append(grid);
  }

  function renderStyles() {
    if (!styleList) return;
    styleList.replaceChildren();
    for (const g of STYLE_PRESET_GROUPS) {
      for (const p of g.presets) {
        const btn = el(doc, 'button', {
          type: 'button',
          className: 'preset-item',
          textContent: p.name
        });
        btn.dataset.style = `${g.name}/${p.name}`;
        btn.title = `${g.name}: ${p.name} (Shift-click adds)`;
        btn.addEventListener('click', (e) => applyStyle(p, !!e.shiftKey));
        styleList.append(el(doc, 'li', {}, [btn]));
      }
    }
  }

  const cloneInputs = new Map();
  let cloneLine = null;

  function buildCloneSource() {
    if (!cloneBox) return;
    cloneBox.replaceChildren();
    cloneLine = el(doc, 'p', { className: 'clone-source-line' });
    cloneBox.append(cloneLine);
    const grid = el(doc, 'div', { className: 'clone-source-grid' });
    for (const [key, label, unit] of CLONE_FIELDS) {
      const input = el(doc, 'input', { type: 'number', step: '1', id: `clone-source-${key}` });
      input.dataset.clone = key;
      cloneInputs.set(key, input);
      input.addEventListener('change', () => editClone(key, Number(input.value)));
      grid.append(
        el(doc, 'label', { className: 'clone-source-field' }, [
          el(doc, 'span', { textContent: `${label}:` }),
          input,
          el(doc, 'span', { className: 'clone-source-unit', textContent: unit })
        ])
      );
    }
    cloneBox.append(grid);
    const checks = el(doc, 'div', { className: 'clone-source-checks' });
    for (const [key, label] of [
      ['linked', 'Maintain aspect ratio'],
      ['flipH', 'Flip Horizontal'],
      ['flipV', 'Flip Vertical']
    ]) {
      const cb = el(doc, 'input', { type: 'checkbox', id: `clone-source-${key}` });
      cb.dataset.clone = key;
      cloneInputs.set(key, cb);
      cb.addEventListener('change', () => editClone(key, cb.checked));
      checks.append(el(doc, 'label', { className: 'brush-setting-row' }, [cb, ` ${label}`]));
    }
    cloneBox.append(checks);
    const reset = el(doc, 'button', {
      type: 'button',
      className: 'preset-new',
      id: 'clone-source-reset',
      textContent: 'Reset Transform'
    });
    reset.addEventListener('click', () => {
      const clone = cloneSourceOf(state);
      clone.transform = { ...DEFAULT_CLONE_TRANSFORM, linked: clone.transform.linked };
      renderCloneSource();
    });
    cloneBox.append(reset);
  }

  function editClone(key, value) {
    const clone = cloneSourceOf(state);
    if (key === 'x' || key === 'y') {
      const off = cloneSourceOffset(clone);
      if (off && Number.isFinite(value)) {
        setCloneOffset(clone, key === 'x' ? value : off.x, key === 'y' ? value : off.y);
      }
    } else if (typeof value === 'boolean' || Number.isFinite(value)) {
      clone.transform = setCloneTransform(clone.transform, { [key]: value });
    }
    renderCloneSource();
  }

  function renderCloneSource() {
    if (!cloneBox) return;
    const clone = cloneSourceOf(state);
    const off = cloneSourceOffset(clone);
    if (cloneLine) {
      cloneLine.textContent = clone.source
        ? `Source: ${clone.source.x}, ${clone.source.y}`
        : 'Source: not set (Alt-click with Clone Stamp)';
    }
    const t = clone.transform;
    const values = { x: off?.x ?? 0, y: off?.y ?? 0, ...t };
    for (const [key, input] of cloneInputs) {
      if (input.type === 'checkbox') input.checked = !!values[key];
      else {
        input.value = String(Math.round(values[key] * 10) / 10);
        if (key === 'x' || key === 'y') input.disabled = !off;
      }
    }
  }

  renderGradients();
  renderPatterns();
  renderStyles();
  buildCloneSource();
  renderCloneSource();
  return {
    refresh() {
      renderGradients();
      renderPatterns();
      renderCloneSource();
    },
    renderGradients,
    renderPatterns,
    renderCloneSource
  };
}
