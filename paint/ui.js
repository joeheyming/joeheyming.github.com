// UI helpers — toolbar, palette, color history, status

export const PALETTE_COLORS = [
  '#000000', '#3d3d3d', '#7f7f7f', '#c0c0c0', '#ffffff', '#8b4513', '#a52a2a',
  '#dc143c', '#ff0000', '#ff6600', '#ffa500', '#ffd700', '#ffff00', '#adff2f',
  '#008000', '#00ff00', '#006400', '#00ffff', '#00bfff', '#1e90ff', '#0000ff',
  '#000080', '#4b0082', '#8a2be2', '#ff00ff', '#ff1493', '#ff69b4', '#ffa07a',
];

export function buildToolbar(toolDefs, state, container, onChange) {
  container.innerHTML = '';
  for (const [id, tool] of Object.entries(toolDefs)) {
    const btn = document.createElement('button');
    btn.className = 'tool-btn';
    btn.dataset.tool = id;
    btn.title = `${tool.label} (${getShortcut(id)})`;
    btn.setAttribute('aria-label', tool.label);
    btn.textContent = tool.icon;
    if (id === state.tool) btn.classList.add('active');
    btn.addEventListener('click', () => {
      container.querySelectorAll('.tool-btn').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      onChange(id);
    });
    container.appendChild(btn);
  }
}

function getShortcut(id) {
  const map = { pencil:'P', brush:'B', eraser:'E', spray:'S', fill:'F',
    eyedropper:'I', text:'T', line:'L', rect:'R', ellipse:'O',
    rectSelect:'M', lasso:'G', magicWand:'W' };
  return map[id] ?? '';
}

export function buildPalette(state, container, onFgChange, onBgChange) {
  container.innerHTML = '';

  // FG/BG swatches
  const fbWrap = document.createElement('div');
  fbWrap.className = 'fb-wrap';

  const bgSwatch = document.createElement('button');
  bgSwatch.className = 'fb-swatch bg-swatch';
  bgSwatch.title = 'Background color (right-click canvas)';
  bgSwatch.setAttribute('aria-label', 'Background color');
  bgSwatch.style.background = state.bgColor;
  bgSwatch.id = 'bg-swatch';

  const fgSwatch = document.createElement('button');
  fgSwatch.className = 'fb-swatch fg-swatch';
  fgSwatch.title = 'Foreground color';
  fgSwatch.setAttribute('aria-label', 'Foreground color');
  fgSwatch.style.background = state.color;
  fgSwatch.id = 'fg-swatch';

  const fgInput = document.createElement('input');
  fgInput.type = 'color'; fgInput.id = 'fg-color-input';
  fgInput.value = state.color; fgInput.className = 'hidden-color-input';
  fgInput.setAttribute('aria-label', 'Foreground color');

  const bgInput = document.createElement('input');
  bgInput.type = 'color'; bgInput.id = 'bg-color-input';
  bgInput.value = state.bgColor; bgInput.className = 'hidden-color-input';
  bgInput.setAttribute('aria-label', 'Background color');

  fgSwatch.addEventListener('click', () => fgInput.click());
  bgSwatch.addEventListener('click', () => bgInput.click());
  fgInput.addEventListener('input', e => { fgSwatch.style.background = e.target.value; onFgChange(e.target.value); });
  bgInput.addEventListener('input', e => { bgSwatch.style.background = e.target.value; onBgChange(e.target.value); });

  fbWrap.appendChild(bgSwatch);
  fbWrap.appendChild(fgSwatch);
  fbWrap.appendChild(fgInput);
  fbWrap.appendChild(bgInput);
  container.appendChild(fbWrap);

  const sep = document.createElement('div'); sep.className = 'palette-sep'; container.appendChild(sep);

  // Color swatches
  const swatchGrid = document.createElement('div');
  swatchGrid.className = 'swatch-grid';
  for (const color of PALETTE_COLORS) {
    const sw = document.createElement('button');
    sw.className = 'color-swatch';
    sw.style.background = color;
    sw.title = color;
    sw.setAttribute('aria-label', `Color ${color}`);
    sw.addEventListener('click', () => {
      document.getElementById('fg-swatch').style.background = color;
      document.getElementById('fg-color-input').value = color;
      onFgChange(color);
    });
    sw.addEventListener('contextmenu', e => {
      e.preventDefault();
      document.getElementById('bg-swatch').style.background = color;
      document.getElementById('bg-color-input').value = color;
      onBgChange(color);
    });
    swatchGrid.appendChild(sw);
  }
  container.appendChild(swatchGrid);

  // Color history placeholder
  const sep2 = document.createElement('div'); sep2.className = 'palette-sep'; container.appendChild(sep2);
  const historyRow = document.createElement('div');
  historyRow.id = 'color-history'; historyRow.className = 'color-history';
  historyRow.title = 'Recent colors';
  container.appendChild(historyRow);
}

export function updateColorHistory(history, onSelect) {
  const el = document.getElementById('color-history');
  if (!el) return;
  el.innerHTML = '';
  for (const color of history) {
    const sw = document.createElement('button');
    sw.className = 'color-swatch history-swatch';
    sw.style.background = color;
    sw.title = color;
    sw.addEventListener('click', () => onSelect(color));
    el.appendChild(sw);
  }
}

export function updateFgSwatch(color) {
  const el = document.getElementById('fg-swatch');
  if (el) el.style.background = color;
  const inp = document.getElementById('fg-color-input');
  if (inp) inp.value = color;
}

export function updateStatus(x, y) {
  const el = document.getElementById('status-coords');
  if (el) el.textContent = `${Math.round(x)}, ${Math.round(y)}`;
}

// Render the per-tool option strip from a schema. Calls onChange(key, value)
// whenever any control changes. Returns nothing.
export function renderToolOptions(schema, values, container, onChange) {
  container.innerHTML = '';
  if (!schema || schema.length === 0) {
    container.classList.add('empty');
    return;
  }
  container.classList.remove('empty');

  for (const opt of schema) {
    const wrap = document.createElement('div');
    wrap.className = 'tool-opt tool-opt-' + opt.type;

    if (opt.type === 'range') {
      const label = document.createElement('label');
      label.textContent = opt.label;
      label.htmlFor = 'opt-' + opt.key;

      const input = document.createElement('input');
      input.type = 'range';
      input.id = 'opt-' + opt.key;
      input.min = String(opt.min);
      input.max = String(opt.max);
      input.step = String(opt.step ?? 1);
      input.value = String(values[opt.key] ?? opt.default);
      input.title = `${opt.label}: ${input.value}`;

      const display = document.createElement('span');
      display.className = 'tool-opt-value';
      display.textContent = input.value;

      input.addEventListener('input', e => {
        const v = parseFloat(e.target.value);
        display.textContent = String(v);
        input.title = `${opt.label}: ${v}`;
        onChange(opt.key, v);
      });

      wrap.appendChild(label);
      wrap.appendChild(input);
      wrap.appendChild(display);
    } else if (opt.type === 'checkbox') {
      const label = document.createElement('label');
      label.htmlFor = 'opt-' + opt.key;

      const input = document.createElement('input');
      input.type = 'checkbox';
      input.id = 'opt-' + opt.key;
      input.checked = Boolean(values[opt.key] ?? opt.default);

      input.addEventListener('change', e => onChange(opt.key, e.target.checked));

      label.appendChild(input);
      label.appendChild(document.createTextNode(' ' + opt.label));
      wrap.appendChild(label);
    } else if (opt.type === 'select') {
      const label = document.createElement('label');
      label.textContent = opt.label;
      label.htmlFor = 'opt-' + opt.key;

      const select = document.createElement('select');
      select.id = 'opt-' + opt.key;
      const cur = values[opt.key] ?? opt.default;
      for (const o of opt.options) {
        const optEl = document.createElement('option');
        optEl.value = o.value;
        optEl.textContent = o.label;
        if (o.value === cur) optEl.selected = true;
        select.appendChild(optEl);
      }
      select.addEventListener('change', e => onChange(opt.key, e.target.value));

      wrap.appendChild(label);
      wrap.appendChild(select);
    } else if (opt.type === 'hint') {
      // Static help text — no input. Used for showing modifier-key legends.
      wrap.classList.add('tool-opt-hint');
      wrap.textContent = opt.text;
      if (opt.title) wrap.title = opt.title;
    }

    container.appendChild(wrap);
  }
}
