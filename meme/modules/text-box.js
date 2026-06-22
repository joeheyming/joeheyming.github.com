// modules/text-box.js
//
// Renders an on-canvas text-box overlay element AND the matching
// sidebar editor card. Both stay in sync with the central state via
// subscribe() — the overlay does the visual positioning, the sidebar
// does the property editing.

import * as store from './state.js';
import { makeDraggable, makeResize, makeRotate } from './interactions.js';

const FONTS = [
  { value: 'Impact', label: 'Impact (classic meme)' },
  { value: 'Arial Black, sans-serif', label: 'Arial Black' },
  { value: 'Helvetica, Arial, sans-serif', label: 'Helvetica' },
  { value: '"Comic Sans MS", cursive', label: 'Comic Sans' },
  { value: 'Georgia, serif', label: 'Georgia' },
  { value: '"Times New Roman", Times, serif', label: 'Times' },
  { value: '"Courier New", Courier, monospace', label: 'Courier' },
  { value: '"Brush Script MT", cursive', label: 'Brush Script' }
];

/** Create the on-stage overlay element for a text box. */
export function createBoxOverlay(box, overlayEl, stageEl) {
  const el = document.createElement('div');
  el.className = 'text-box';
  el.dataset.id = box.id;

  const inner = document.createElement('div');
  inner.className = 'text-box-inner';
  el.appendChild(inner);

  const handleResize = document.createElement('div');
  handleResize.className = 'text-box-handle handle-resize';
  el.appendChild(handleResize);

  const handleRotate = document.createElement('div');
  handleRotate.className = 'text-box-handle handle-rotate';
  el.appendChild(handleRotate);

  const handleDelete = document.createElement('div');
  handleDelete.className = 'text-box-handle handle-delete';
  handleDelete.textContent = '×';
  handleDelete.title = 'Delete this text box';
  el.appendChild(handleDelete);

  overlayEl.appendChild(el);

  // ---------- Interactions ----------

  // Single-click anywhere on the box (not on a handle) selects it.
  // editor.js will then auto-focus the matching sidebar textarea and
  // scroll it into view — that's the canonical place to edit text.
  el.addEventListener('pointerdown', (e) => {
    if (e.target.closest('.text-box-handle')) return;
    store.setSelection('box', box.id);
  });

  // Drag the box body
  makeDraggable(
    el,
    stageEl,
    () => {
      const b = store.get().boxes.find((x) => x.id === box.id);
      return { x: b.x, y: b.y };
    },
    ({ x, y }) => {
      store.updateBox(box.id, {
        x: clamp(x, -0.5, 1),
        y: clamp(y, -0.5, 1)
      });
    }
  );

  // Resize from bottom-right
  makeResize(
    handleResize,
    stageEl,
    () => {
      const b = store.get().boxes.find((x) => x.id === box.id);
      return { x: b.x, y: b.y, w: b.w, h: b.h };
    },
    ({ w, h }) => store.updateBox(box.id, { w, h })
  );

  // Rotate from top
  makeRotate(handleRotate, el, stageEl, (deg) => store.updateBox(box.id, { rotation: deg }));

  // Delete
  handleDelete.addEventListener('click', (e) => {
    e.stopPropagation();
    store.removeBox(box.id);
  });

  return el;
}

/** Update an overlay element's visual position/style from a box record. */
export function applyBoxStyles(el, box, naturalSize) {
  el.style.left = box.x * 100 + '%';
  el.style.top = box.y * 100 + '%';
  el.style.width = box.w * 100 + '%';
  el.style.height = box.h * 100 + '%';
  el.style.transform = `rotate(${box.rotation}deg)`;

  const inner = el.querySelector('.text-box-inner');
  if (!inner) return;

  if (box.text) {
    inner.removeAttribute('data-placeholder');
    inner.style.color = box.color;
    inner.textContent = box.text;
  } else {
    inner.setAttribute('data-placeholder', '');
    inner.style.color = 'rgba(255,255,255,0.45)';
    inner.textContent = 'Click to edit';
  }

  // Font sizing is fractional of natural image height; here we convert
  // to a px size relative to the stage's CSS height so it visually
  // matches what the exported canvas will produce.
  const stage = el.parentElement.parentElement;
  const stageCssHeight = stage?.getBoundingClientRect().height || 1;
  const pxFontSize = box.fontSize * stageCssHeight;
  const pxStroke = box.strokeWidth * stageCssHeight;

  inner.style.fontFamily = box.fontFamily;
  inner.style.fontSize = pxFontSize + 'px';
  inner.style.fontWeight = box.bold ? '900' : 'normal';
  inner.style.fontStyle = box.italic ? 'italic' : 'normal';
  inner.style.textTransform = box.uppercase ? 'uppercase' : 'none';
  inner.style.textAlign = box.align;
  inner.style.justifyContent =
    box.align === 'left' ? 'flex-start' : box.align === 'right' ? 'flex-end' : 'center';
  inner.style.webkitTextStroke = `${pxStroke}px ${box.strokeColor}`;
  inner.style.paintOrder = 'stroke fill';
}

/** Build a sidebar editor card for a box. */
export function createBoxSidebar(box, listEl) {
  const item = document.createElement('li');
  item.className = 'box-item';
  item.dataset.id = box.id;

  item.innerHTML = `
    <div class="box-item-header">
      <span class="box-handle">Text</span>
      <button type="button" class="box-delete" title="Delete this box" aria-label="Delete box">×</button>
    </div>
    <textarea data-field="text" rows="2" placeholder="Type your meme text…"></textarea>
    <div class="box-controls">
      <label class="box-controls-row-full">
        <span>Font</span>
        <select data-field="fontFamily">
          ${FONTS.map((f) => `<option value="${f.value}">${f.label}</option>`).join('')}
        </select>
      </label>
      <label>
        <span>Size</span>
        <input type="number" data-field="fontSize" min="1" max="40" step="1" />
      </label>
      <label>
        <span>Rotation</span>
        <input type="number" data-field="rotation" step="1" />
      </label>
      <label>
        <span>Color</span>
        <input type="color" data-field="color" />
      </label>
      <label>
        <span>Stroke</span>
        <input type="color" data-field="strokeColor" />
      </label>
      <label>
        <span>Stroke px</span>
        <input type="number" data-field="strokeWidth" min="0" max="2" step="0.05" />
      </label>
      <label>
        <span>Align</span>
        <select data-field="align">
          <option value="left">Left</option>
          <option value="center">Center</option>
          <option value="right">Right</option>
        </select>
      </label>
      <div class="box-toggles">
        <button type="button" data-toggle="bold" title="Bold">B</button>
        <button type="button" data-toggle="italic" title="Italic">I</button>
        <button type="button" data-toggle="uppercase" title="UPPERCASE">A</button>
      </div>
    </div>
  `;

  listEl.appendChild(item);

  // Wire up handlers
  item.querySelector('.box-delete').addEventListener('click', (e) => {
    e.stopPropagation();
    store.removeBox(box.id);
  });

  item.addEventListener('click', () => store.setSelection('box', box.id));

  item.querySelectorAll('[data-field]').forEach((input) => {
    input.addEventListener('input', () => {
      const field = input.dataset.field;
      let value = input.value;
      // Numeric fields are stored as numbers in state. The display unit
      // for fontSize is "% of image height", so we convert.
      if (field === 'fontSize') {
        value = parseFloat(value) / 100;
      } else if (field === 'strokeWidth') {
        value = parseFloat(value) / 100;
      } else if (field === 'rotation') {
        value = parseFloat(value);
      }
      store.updateBox(box.id, { [field]: value });
    });
  });

  item.querySelectorAll('[data-toggle]').forEach((btn) => {
    btn.addEventListener('click', () => {
      const key = btn.dataset.toggle;
      const current = store.get().boxes.find((b) => b.id === box.id);
      if (!current) return;
      store.updateBox(box.id, { [key]: !current[key] });
    });
  });

  return item;
}

/** Update sidebar card values to match a box record. */
export function applySidebarValues(item, box) {
  const textArea = item.querySelector('[data-field="text"]');
  if (document.activeElement !== textArea) textArea.value = box.text;
  item.querySelector('[data-field="fontFamily"]').value = box.fontFamily;
  item.querySelector('[data-field="fontSize"]').value = Math.round(box.fontSize * 100);
  item.querySelector('[data-field="rotation"]').value = Math.round(box.rotation);
  item.querySelector('[data-field="color"]').value = box.color;
  item.querySelector('[data-field="strokeColor"]').value = box.strokeColor;
  item.querySelector('[data-field="strokeWidth"]').value = (box.strokeWidth * 100).toFixed(1);
  item.querySelector('[data-field="align"]').value = box.align;
  item.querySelector('[data-toggle="bold"]').classList.toggle('is-on', box.bold);
  item.querySelector('[data-toggle="italic"]').classList.toggle('is-on', box.italic);
  item.querySelector('[data-toggle="uppercase"]').classList.toggle('is-on', box.uppercase);
}

// ---------- Helpers ----------

function clamp(v, lo, hi) {
  return Math.max(lo, Math.min(hi, v));
}

export { FONTS };
