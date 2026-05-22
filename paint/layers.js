// Layer management

let nextLayerId = 1;

// Blend modes mapped to canvas globalCompositeOperation values.
// CSS mix-blend-mode uses the same names (with 'normal' = 'source-over').
export const BLEND_MODES = [
  { value: 'source-over',  label: 'Normal' },
  { value: 'multiply',     label: 'Multiply' },
  { value: 'screen',       label: 'Screen' },
  { value: 'overlay',      label: 'Overlay' },
  { value: 'darken',       label: 'Darken' },
  { value: 'lighten',      label: 'Lighten' },
  { value: 'color-dodge',  label: 'Color Dodge' },
  { value: 'color-burn',   label: 'Color Burn' },
  { value: 'hard-light',   label: 'Hard Light' },
  { value: 'soft-light',   label: 'Soft Light' },
  { value: 'difference',   label: 'Difference' },
  { value: 'exclusion',    label: 'Exclusion' },
  { value: 'hue',          label: 'Hue' },
  { value: 'saturation',   label: 'Saturation' },
  { value: 'color',        label: 'Color' },
  { value: 'luminosity',   label: 'Luminosity' },
];

function blendCssValue(mode) {
  return mode === 'source-over' ? 'normal' : mode;
}

export function createLayer(name, w, h) {
  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  canvas.className = 'layer-canvas';
  canvas.dataset.layerId = nextLayerId;
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  return {
    id: nextLayerId++,
    name,
    canvas,
    ctx,
    opacity: 1,
    visible: true,
    blendMode: 'source-over',
  };
}

export function insertLayerBefore(layer, stackEl, refEl) {
  stackEl.insertBefore(layer.canvas, refEl);
  syncLayerDOM(layer);
}

export function removeLayerFromDOM(layer) {
  layer.canvas.remove();
}

export function syncLayerDOM(layer) {
  layer.canvas.style.opacity = layer.opacity;
  layer.canvas.style.display = layer.visible ? 'block' : 'none';
  layer.canvas.style.mixBlendMode = blendCssValue(layer.blendMode || 'source-over');
}

// Returns a flat offscreen canvas compositing all visible layers,
// applying each layer's blendMode via globalCompositeOperation.
export function flattenToCanvas(layers, bgColor, w, h, opts = {}) {
  const flat = document.createElement('canvas');
  flat.width = w; flat.height = h;
  const flatCtx = flat.getContext('2d', { willReadFrequently: true });
  if (opts.transparentBg !== true) {
    flatCtx.fillStyle = bgColor;
    flatCtx.fillRect(0, 0, w, h);
  }
  for (const layer of layers) {
    if (!layer.visible) continue;
    flatCtx.globalAlpha = layer.opacity;
    flatCtx.globalCompositeOperation = layer.blendMode || 'source-over';
    flatCtx.drawImage(layer.canvas, 0, 0);
  }
  flatCtx.globalAlpha = 1;
  flatCtx.globalCompositeOperation = 'source-over';
  return flat;
}

export function renderLayerPanel(layers, activeIdx, container, callbacks) {
  container.innerHTML = '';

  const list = document.createElement('div');
  list.className = 'layer-list';

  // Render top-to-bottom (last in array = top visually)
  for (let i = layers.length - 1; i >= 0; i--) {
    const layer = layers[i];
    const isActive = i === activeIdx;

    const row = document.createElement('div');
    row.className = 'layer-row' + (isActive ? ' active' : '');

    const visBtn = document.createElement('button');
    visBtn.className = 'layer-vis-btn';
    visBtn.title = 'Toggle visibility';
    visBtn.textContent = layer.visible ? '👁' : '◌';
    visBtn.addEventListener('click', e => { e.stopPropagation(); callbacks.onToggleVisible(i); });

    const thumb = document.createElement('canvas');
    thumb.className = 'layer-thumb';
    thumb.width = 32; thumb.height = 24;
    drawLayerThumb(thumb, layer);

    const nameWrap = document.createElement('div');
    nameWrap.className = 'layer-name-wrap';

    const nameEl = document.createElement('span');
    nameEl.className = 'layer-name';
    nameEl.textContent = layer.name;
    nameEl.title = 'Click to rename';
    nameEl.addEventListener('dblclick', e => {
      e.stopPropagation();
      const val = prompt('Layer name:', layer.name);
      if (val !== null && val.trim()) {
        layer.name = val.trim();
        callbacks.onRename(i, layer.name);
      }
    });

    const blendEl = document.createElement('select');
    blendEl.className = 'layer-blend';
    blendEl.title = 'Blend mode';
    blendEl.setAttribute('aria-label', `${layer.name} blend mode`);
    for (const { value, label } of BLEND_MODES) {
      const opt = document.createElement('option');
      opt.value = value;
      opt.textContent = label;
      if ((layer.blendMode || 'source-over') === value) opt.selected = true;
      blendEl.appendChild(opt);
    }
    blendEl.addEventListener('change', e => {
      e.stopPropagation();
      callbacks.onBlendModeChange(i, e.target.value);
    });
    blendEl.addEventListener('click', e => e.stopPropagation());

    const opacityEl = document.createElement('input');
    opacityEl.type = 'range';
    opacityEl.min = '0'; opacityEl.max = '100';
    opacityEl.value = Math.round(layer.opacity * 100);
    opacityEl.className = 'layer-opacity';
    opacityEl.title = `Opacity: ${Math.round(layer.opacity * 100)}%`;
    opacityEl.setAttribute('aria-label', `${layer.name} opacity`);
    opacityEl.addEventListener('input', e => {
      e.stopPropagation();
      callbacks.onOpacityChange(i, parseInt(e.target.value, 10) / 100);
    });
    opacityEl.addEventListener('click', e => e.stopPropagation());

    nameWrap.appendChild(nameEl);
    nameWrap.appendChild(blendEl);
    nameWrap.appendChild(opacityEl);

    const moveWrap = document.createElement('div');
    moveWrap.className = 'layer-move-wrap';

    const upBtn = document.createElement('button');
    upBtn.className = 'layer-move-btn';
    upBtn.textContent = '↑';
    upBtn.title = 'Move layer up';
    upBtn.disabled = i === layers.length - 1;
    upBtn.addEventListener('click', e => { e.stopPropagation(); callbacks.onMoveUp(i); });

    const downBtn = document.createElement('button');
    downBtn.className = 'layer-move-btn';
    downBtn.textContent = '↓';
    downBtn.title = 'Move layer down';
    downBtn.disabled = i === 0;
    downBtn.addEventListener('click', e => { e.stopPropagation(); callbacks.onMoveDown(i); });

    const delBtn = document.createElement('button');
    delBtn.className = 'layer-del-btn';
    delBtn.title = 'Delete layer';
    delBtn.textContent = '×';
    delBtn.disabled = layers.length <= 1;
    delBtn.addEventListener('click', e => { e.stopPropagation(); callbacks.onDelete(i); });

    moveWrap.appendChild(upBtn);
    moveWrap.appendChild(downBtn);
    moveWrap.appendChild(delBtn);

    row.appendChild(visBtn);
    row.appendChild(thumb);
    row.appendChild(nameWrap);
    row.appendChild(moveWrap);
    row.addEventListener('click', () => callbacks.onActivate(i));

    list.appendChild(row);
  }

  container.appendChild(list);

  const footer = document.createElement('div');
  footer.className = 'layer-panel-footer';

  const addBtn = document.createElement('button');
  addBtn.className = 'layer-add-btn';
  addBtn.textContent = '+ Add Layer';
  addBtn.addEventListener('click', callbacks.onAdd);

  const flatBtn = document.createElement('button');
  flatBtn.className = 'layer-add-btn';
  flatBtn.textContent = '⬇ Flatten';
  flatBtn.title = 'Flatten all visible layers into one';
  flatBtn.addEventListener('click', callbacks.onFlatten);

  footer.appendChild(addBtn);
  footer.appendChild(flatBtn);
  container.appendChild(footer);
}

function drawLayerThumb(thumbCanvas, layer) {
  const tc = thumbCanvas.getContext('2d');
  tc.clearRect(0, 0, thumbCanvas.width, thumbCanvas.height);
  // Checkerboard for transparency
  tc.fillStyle = '#888';
  for (let y = 0; y < thumbCanvas.height; y += 4) {
    for (let x = (y / 4 % 2) * 4; x < thumbCanvas.width; x += 8) {
      tc.fillRect(x, y, 4, 4);
    }
  }
  tc.fillStyle = '#ccc';
  for (let y = 0; y < thumbCanvas.height; y += 4) {
    for (let x = ((y / 4 + 1) % 2) * 4; x < thumbCanvas.width; x += 8) {
      tc.fillRect(x, y, 4, 4);
    }
  }
  tc.globalAlpha = layer.opacity;
  tc.drawImage(layer.canvas, 0, 0, thumbCanvas.width, thumbCanvas.height);
  tc.globalAlpha = 1;
}

export function refreshLayerThumbs(layers, container) {
  const thumbs = container.querySelectorAll('.layer-thumb');
  // thumbs are rendered in reverse order (top layer first)
  const reversed = [...layers].reverse();
  thumbs.forEach((thumb, i) => {
    if (reversed[i]) drawLayerThumb(thumb, reversed[i]);
  });
}
