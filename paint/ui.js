// UI helpers — toolbar, palette, color history, status

import { swatchBackground } from './gradient-presets.js';
import { iconSvg } from './icons.js';
import { docColor } from './image-mode.js';
import { TOOL_GROUPS, toolKey } from './tool-groups.js';

export const PALETTE_COLORS = [
  '#000000',
  '#3d3d3d',
  '#7f7f7f',
  '#c0c0c0',
  '#ffffff',
  '#8b4513',
  '#a52a2a',
  '#dc143c',
  '#ff0000',
  '#ff6600',
  '#ffa500',
  '#ffd700',
  '#ffff00',
  '#adff2f',
  '#008000',
  '#00ff00',
  '#006400',
  '#00ffff',
  '#00bfff',
  '#1e90ff',
  '#0000ff',
  '#000080',
  '#4b0082',
  '#8a2be2',
  '#ff00ff',
  '#ff1493',
  '#ff69b4',
  '#ffa07a'
];

// A press held this long on a slot opens its flyout (PhotoCraft panels.rs, as in Photoshop).
export const FLYOUT_HOLD_MS = 300;

// Tool column container → its tool definitions, and the containers whose close listeners are bound.
const toolbarDefs = new WeakMap();
const toolbarDocs = new WeakSet();

/**
 * Fill the tool column: one .tool-btn per TOOL_GROUPS slot showing the slot's current tool, with
 * a corner triangle (.has-flyout) when the slot holds more than one. Right-click or a
 * FLYOUT_HOLD_MS press opens the slot's .tool-flyout, a menu of its tools (icon, PhotoCraft name,
 * key); picking one makes it the slot's tool and calls onChange(id).
 */
export function buildToolbar(toolDefs, state, container, onChange, groups = TOOL_GROUPS) {
  container.innerHTML = '';
  toolbarDefs.set(container, toolDefs);
  const doc = container.ownerDocument;
  const closeAll = () => {
    for (const f of container.querySelectorAll('.tool-flyout')) f.hidden = true;
    for (const b of container.querySelectorAll('.tool-btn[aria-expanded]')) {
      b.setAttribute('aria-expanded', 'false');
    }
  };
  const pick = (id) => {
    closeAll();
    selectToolbarTool(container, id);
    onChange(id);
  };
  groups.forEach((ids, g) => {
    const tools = ids.filter((id) => toolDefs[id]);
    if (!tools.length) return;
    const slot = doc.createElement('div');
    slot.className = 'tool-slot';
    const btn = doc.createElement('button');
    btn.className = 'tool-btn';
    btn.dataset.group = String(g);
    slot.appendChild(btn);
    setSlotTool(btn, toolDefs, tools.includes(state.tool) ? state.tool : tools[0]);
    btn.classList.toggle('active', tools.includes(state.tool));
    btn.addEventListener('click', () => {
      if (btn.dataset.held) {
        delete btn.dataset.held;
        return;
      }
      pick(btn.dataset.tool);
    });
    container.appendChild(slot);
    if (tools.length < 2) return;

    btn.classList.add('has-flyout');
    btn.setAttribute('aria-haspopup', 'menu');
    btn.setAttribute('aria-expanded', 'false');
    const flyout = doc.createElement('div');
    flyout.className = 'tool-flyout';
    flyout.setAttribute('role', 'menu');
    flyout.setAttribute('aria-label', `${toolDefs[tools[0]].label} tools`);
    flyout.hidden = true;
    for (const id of tools) {
      const item = doc.createElement('button');
      item.className = 'tool-flyout-item';
      item.dataset.tool = id;
      item.setAttribute('role', 'menuitemradio');
      item.setAttribute('aria-checked', String(id === btn.dataset.tool));
      const name = doc.createElement('span');
      name.className = 'tool-flyout-name';
      name.textContent = `${toolDefs[id].label} Tool`;
      const key = doc.createElement('span');
      key.className = 'tool-flyout-key';
      key.textContent = toolKey(id);
      item.append(iconSvg(toolDefs[id].icon, 16), name, key);
      item.addEventListener('click', () => pick(id));
      flyout.appendChild(item);
    }
    slot.appendChild(flyout);

    const open = () => {
      const wasOpen = !flyout.hidden;
      closeAll();
      if (wasOpen) return;
      const r = btn.getBoundingClientRect();
      flyout.style.left = `${r.right + 2}px`;
      flyout.style.top = `${r.top}px`;
      flyout.hidden = false;
      btn.setAttribute('aria-expanded', 'true');
    };
    btn.addEventListener('contextmenu', (e) => {
      e.preventDefault();
      open();
    });
    let timer = 0;
    const cancelHold = () => clearTimeout(timer);
    btn.addEventListener('pointerdown', (e) => {
      if (e.button !== 0) return;
      cancelHold();
      timer = setTimeout(() => {
        btn.dataset.held = '1';
        open();
      }, FLYOUT_HOLD_MS);
    });
    btn.addEventListener('pointerup', cancelHold);
    btn.addEventListener('pointerleave', cancelHold);
  });
  // A press outside the open flyout and its button, or Escape, closes it.
  if (!toolbarDocs.has(container)) {
    toolbarDocs.add(container);
    doc.addEventListener('pointerdown', (e) => {
      if (!e.target.closest?.('.tool-slot')) closeAll();
    });
    doc.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') closeAll();
    });
  }
}

function setSlotTool(btn, toolDefs, id) {
  const tool = toolDefs[id];
  btn.dataset.tool = id;
  const key = toolKey(id);
  btn.title = key ? `${tool.label} Tool (${key})` : `${tool.label} Tool`;
  btn.setAttribute('aria-label', tool.label);
  btn.replaceChildren(iconSvg(tool.icon));
}

/** Make `id` its slot's tool and that slot's button the active one. */
export function selectToolbarTool(container, id) {
  const toolDefs = toolbarDefs.get(container);
  for (const btn of container.querySelectorAll('.tool-btn')) {
    const items = [...btn.parentElement.querySelectorAll('.tool-flyout-item')];
    const owns = btn.dataset.tool === id || items.some((i) => i.dataset.tool === id);
    btn.classList.toggle('active', owns);
    if (!owns) continue;
    if (btn.dataset.tool !== id) setSlotTool(btn, toolDefs, id);
    for (const i of items) i.setAttribute('aria-checked', String(i.dataset.tool === id));
  }
}

/** The tool slot `group` currently shows, or undefined. */
export function slotTool(container, group) {
  return container.querySelector(`.tool-btn[data-group="${group}"]`)?.dataset.tool;
}

/**
 * Show `color` as the foreground ('fg') or background ('bg') everywhere it
 * appears: the tool-column chip, its hidden color input, the dock's
 * Color tab, and any options-bar gradient swatch.
 */
export function showColor(which, color) {
  const chip = document.getElementById(`${which}-swatch`);
  if (chip) chip.style.background = color;
  const inp = document.getElementById(`${which}-color-input`);
  if (inp) inp.value = color;
  const dockChip = document.getElementById(`color-${which}-chip`);
  if (dockChip) dockChip.style.background = color;
  const dockValue = document.getElementById(`color-${which}-value`);
  if (dockValue) dockValue.textContent = color.toUpperCase();
  for (const box of document.querySelectorAll('.tool-opt-swatch-box')) {
    swatchRepaint.get(box)?.(which, color);
  }
}

/** PhotoCraft tools.defaultColors: black foreground on a white background. */
export function defaultColors() {
  return { fg: '#000000', bg: '#ffffff' };
}

/** PhotoCraft tools.swapColors: foreground and background trade places. */
export function swapColors(fg, bg) {
  return { fg: bg, bg: fg };
}

// Options-bar gradient swatch box → repaint(which, color), and options container →
// teardown functions run before the next render (document listeners).
const swatchRepaint = new WeakMap();
const optionCleanup = new WeakMap();

/**
 * Fill the tool column's color chips (overlapping FG/BG squares, with Default
 * Colors and Switch Colors over them) and the dock's Swatches tab, and point
 * the Color tab rows at the color inputs. onSetColors({ fg, bg }) sets both.
 */
export function buildPalette(state, chips, container, onFgChange, onBgChange, onSetColors) {
  chips.innerHTML = '';
  container.innerHTML = '';

  // FG/BG swatches
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
  fgInput.type = 'color';
  fgInput.id = 'fg-color-input';
  fgInput.value = state.color;
  fgInput.className = 'hidden-color-input';
  fgInput.setAttribute('aria-label', 'Foreground color');

  const bgInput = document.createElement('input');
  bgInput.type = 'color';
  bgInput.id = 'bg-color-input';
  bgInput.value = state.bgColor;
  bgInput.className = 'hidden-color-input';
  bgInput.setAttribute('aria-label', 'Background color');

  fgSwatch.addEventListener('click', () => fgInput.click());
  bgSwatch.addEventListener('click', () => bgInput.click());
  fgInput.addEventListener('input', (e) => {
    showColor('fg', e.target.value);
    onFgChange(e.target.value);
  });
  bgInput.addEventListener('input', (e) => {
    showColor('bg', e.target.value);
    onBgChange(e.target.value);
  });

  // PhotoCraft draws these over the chips: Default Colors left, Switch Colors right.
  const chipButton = (cls, label, icon, colors) => {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = `fb-chip-btn ${cls}`;
    btn.title = label;
    btn.setAttribute('aria-label', label);
    btn.appendChild(iconSvg(icon, 13));
    btn.addEventListener('click', () => onSetColors?.(colors()));
    return btn;
  };
  chips.appendChild(chipButton('fb-default', 'Default Colors (D)', 'copy', () => defaultColors()));
  chips.appendChild(
    chipButton('fb-swap', 'Switch Colors (X)', 'arrow-left-right', () =>
      swapColors(state.color, state.bgColor)
    )
  );
  chips.appendChild(bgSwatch);
  chips.appendChild(fgSwatch);
  chips.appendChild(fgInput);
  chips.appendChild(bgInput);

  const fgRow = document.getElementById('color-fg-row');
  if (fgRow) fgRow.onclick = () => fgInput.click();
  const bgRow = document.getElementById('color-bg-row');
  if (bgRow) bgRow.onclick = () => bgInput.click();
  showColor('fg', state.color);
  showColor('bg', state.bgColor);

  // Color swatches
  const swatchGrid = document.createElement('div');
  swatchGrid.className = 'swatch-grid';
  for (const color of PALETTE_COLORS) {
    const sw = document.createElement('button');
    sw.className = 'color-swatch';
    sw.dataset.color = color;
    sw.style.background = color;
    sw.title = color;
    sw.setAttribute('aria-label', `Color ${color}`);
    sw.addEventListener('click', () => {
      showColor('fg', color);
      onFgChange(color);
    });
    sw.addEventListener('contextmenu', (e) => {
      e.preventDefault();
      showColor('bg', color);
      onBgChange(color);
    });
    swatchGrid.appendChild(sw);
  }
  container.appendChild(swatchGrid);

  // Color history placeholder
  const sep = document.createElement('div');
  sep.className = 'palette-sep';
  container.appendChild(sep);
  const historyRow = document.createElement('div');
  historyRow.id = 'color-history';
  historyRow.className = 'color-history';
  historyRow.title = 'Recent colors';
  container.appendChild(historyRow);
}

/**
 * Image › Mode: the swatch grid shows each color as the mode holds it (gray in Grayscale, the
 * nearest entry of `table` in Indexed Color, black or white in Bitmap).
 */
export function showPaletteMode(mode, root = document, table = null) {
  for (const sw of root.querySelectorAll('.color-swatch[data-color]')) {
    sw.style.background = docColor(mode, sw.dataset.color, table);
  }
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
  showColor('fg', color);
}

/** Update pointer coords and optional live W×H (selection / object resize). */
export function updateStatus(x, y, size) {
  const el = document.getElementById('status-coords');
  if (el) el.textContent = `${Math.round(x)}, ${Math.round(y)}`;
  const sizeEl = document.getElementById('status-size');
  if (!sizeEl) return;
  if (size && size.w >= 1 && size.h >= 1) {
    sizeEl.textContent = `${Math.round(size.w)} × ${Math.round(size.h)}`;
    sizeEl.hidden = false;
  } else {
    sizeEl.textContent = '';
    sizeEl.hidden = true;
  }
}

// Render the per-tool option strip from a schema. Calls onChange(key, value)
// whenever any control changes. colors is the app's [fg, bg] for gradient
// swatches. Returns nothing.
export function renderToolOptions(schema, values, container, onChange, colors = []) {
  const [fg = '#000000', bg = '#ffffff'] = colors;
  for (const dispose of optionCleanup.get(container) ?? []) dispose();
  const cleanup = [];
  optionCleanup.set(container, cleanup);
  container.innerHTML = '';
  if (!schema || schema.length === 0) {
    container.classList.add('empty');
    return;
  }
  container.classList.remove('empty');
  // A select's onSelect / an iconAction's patch rewrites other keys; re-render to show them.
  const vals = { ...values };
  const applyPatch = (patch) => {
    for (const [k, v] of Object.entries(patch)) {
      vals[k] = v;
      onChange(k, v);
    }
    renderToolOptions(schema, vals, container, onChange, colors);
  };
  // A select that another field's disabledWhen / shownWhen reads re-renders the bar.
  const reacts = new Set(
    schema.flatMap((o) => [o.disabledWhen?.key, o.shownWhen?.key]).filter(Boolean)
  );
  // disabledWhen is { key, value } or { key, values: [...] }.
  const disabled = (opt) => {
    if (opt.disabled === true) return true;
    const when = opt.disabledWhen;
    if (!when) return false;
    const v = vals[when.key] ?? schema.find((o) => o.key === when.key)?.default;
    return when.values ? when.values.includes(v) : v === when.value;
  };

  // shownWhen { key, value }: the field is listed only while that key matches.
  const shown = (opt) => {
    const when = opt.shownWhen;
    if (!when) return true;
    return (vals[when.key] ?? schema.find((o) => o.key === when.key)?.default) === when.value;
  };

  for (const opt of schema) {
    // The options bar is controls only (PhotoCraft); a sentence of help text is never drawn.
    if (opt.type === 'hint' || !shown(opt)) continue;
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

      input.addEventListener('input', (e) => {
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
      input.disabled = disabled(opt);

      input.addEventListener('change', (e) => onChange(opt.key, e.target.checked));

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
      // optionsFrom(vals) lists options that follow the document (the Note tool's Notes list).
      const options = opt.optionsFrom ? opt.optionsFrom(vals) : opt.options;
      // extraOption(cur) lists a current value that is not one of the options.
      const extra = options.some((o) => o.value === cur) ? null : opt.extraOption?.(cur);
      select.disabled = disabled(opt);
      for (const o of extra ? [...options, extra] : options) {
        const optEl = document.createElement('option');
        optEl.value = o.value;
        optEl.textContent = o.label;
        if (o.value === cur) optEl.selected = true;
        select.appendChild(optEl);
      }
      select.addEventListener('change', (e) => {
        const v = e.target.value;
        if (!opt.onSelect && !reacts.has(opt.key)) return onChange(opt.key, v);
        // A patch that sets the select's own key is applied as is, in its own key order.
        const patch = opt.onSelect?.(v, vals);
        applyPatch(patch && opt.key in patch ? patch : { [opt.key]: v, ...patch });
      });

      wrap.appendChild(label);
      wrap.appendChild(select);
    } else if (opt.type === 'number') {
      const label = document.createElement('label');
      label.textContent = opt.label;
      label.htmlFor = 'opt-' + opt.key;

      const input = document.createElement('input');
      input.type = 'number';
      input.id = 'opt-' + opt.key;
      input.min = String(opt.min);
      input.max = String(opt.max);
      input.step = String(opt.step ?? 1);
      input.value = String(vals[opt.key] ?? opt.default);
      input.disabled = disabled(opt);
      input.addEventListener('input', (e) => {
        const v = parseFloat(e.target.value);
        if (!Number.isFinite(v)) return;
        vals[opt.key] = Math.min(opt.max, Math.max(opt.min, v));
        onChange(opt.key, vals[opt.key]);
      });

      wrap.appendChild(label);
      wrap.appendChild(input);
    } else if (opt.type === 'text') {
      // A free text field (Crop W x H); the value stays a string, empty allowed.
      const label = document.createElement('label');
      label.textContent = opt.label;
      label.htmlFor = 'opt-' + opt.key;

      const input = document.createElement('input');
      input.type = 'text';
      input.id = 'opt-' + opt.key;
      input.inputMode = opt.inputMode ?? 'decimal';
      input.size = opt.size ?? 5;
      input.disabled = disabled(opt);
      if (opt.title) input.title = opt.title;
      input.value = String(vals[opt.key] ?? opt.default ?? '');
      input.addEventListener('input', (e) => {
        vals[opt.key] = e.target.value;
        onChange(opt.key, e.target.value);
      });

      wrap.appendChild(label);
      wrap.appendChild(input);
    } else if (opt.type === 'color') {
      // A colour well (the Crop Shield's custom colour); the value is '#rrggbb'.
      const label = document.createElement('label');
      label.textContent = opt.label;
      label.htmlFor = 'opt-' + opt.key;

      const input = document.createElement('input');
      input.type = 'color';
      input.id = 'opt-' + opt.key;
      input.value = String(vals[opt.key] ?? opt.default);
      input.disabled = disabled(opt);
      input.addEventListener('input', (e) => {
        vals[opt.key] = e.target.value;
        onChange(opt.key, e.target.value);
      });

      wrap.appendChild(label);
      wrap.appendChild(input);
    } else if (opt.type === 'iconAction') {
      // PhotoCraft icons::button: a one-shot icon button (the marquee's swap arrows).
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.id = 'opt-' + opt.key;
      btn.className = 'tool-opt-icon';
      btn.title = opt.title;
      btn.setAttribute('aria-label', opt.title);
      btn.disabled = disabled(opt);
      // pressedKey: a toggle lit while vals[pressedKey] is set (Crop's Straighten).
      if (opt.pressedKey) btn.setAttribute('aria-pressed', String(!!vals[opt.pressedKey]));
      btn.appendChild(iconSvg(opt.icon, 16));
      btn.addEventListener('click', () => applyPatch(opt.patch(vals)));
      wrap.appendChild(btn);
    } else if (opt.type === 'action') {
      // PhotoCraft widgets::secondary_button: a one-shot text button (Front Image, Clear).
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.id = 'opt-' + opt.key;
      btn.className = 'tool-opt-button';
      btn.textContent = opt.label;
      if (opt.title) btn.title = opt.title;
      btn.disabled = disabled(opt);
      btn.addEventListener('click', () => applyPatch(opt.patch(vals)));
      wrap.appendChild(btn);
    } else if (opt.type === 'iconButtons') {
      // PhotoCraft's icon toggle row (Gradient Shape): one checked button at a time.
      const group = document.createElement('div');
      group.id = 'opt-' + opt.key;
      group.className = 'tool-opt-icons';
      group.setAttribute('role', 'radiogroup');
      group.setAttribute('aria-label', opt.label);
      const cur = values[opt.key] ?? opt.default;
      const buttons = opt.options.map((o) => {
        const btn = document.createElement('button');
        btn.type = 'button';
        btn.className = 'tool-opt-icon';
        btn.setAttribute('role', 'radio');
        btn.title = o.title;
        btn.setAttribute('aria-label', o.title);
        btn.setAttribute('aria-checked', String(o.value === cur));
        btn.appendChild(iconSvg(o.icon, 16));
        btn.addEventListener('click', () => {
          for (const b of buttons) b.setAttribute('aria-checked', String(b === btn));
          onChange(opt.key, o.value);
        });
        group.appendChild(btn);
        return btn;
      });
      wrap.appendChild(group);
    } else if (opt.type === 'iconMenu') {
      wrap.appendChild(iconMenuControl(opt, vals, applyPatch, cleanup));
    } else if (opt.type === 'gradientSwatch') {
      // PhotoCraft gradient_ui preset_swatch: a swatch button that opens the preset list.
      wrap.appendChild(
        gradientSwatchControl(opt, values[opt.key] ?? opt.default, fg, bg, onChange, cleanup)
      );
    } else if (opt.type === 'readout') {
      // PhotoCraft analysis_ui.rs readout: a dim label and a read-only value (Ruler X, Y, ...).
      const label = document.createElement('span');
      label.className = 'tool-opt-readout-label';
      label.textContent = opt.label;
      const out = document.createElement('output');
      out.id = 'opt-' + opt.key;
      out.className = 'tool-opt-value';
      out.textContent = opt.text(vals);
      wrap.appendChild(label);
      wrap.appendChild(out);
    }

    container.appendChild(wrap);
  }
}

// PhotoCraft align_bar.rs: an icon button opening a menu of icon-and-name rows in sections
// ({ label, prefix, when, items: [[kind, icon, label]] }). A row sends { _layerCommand: prefix +
// kind } and is disabled while vals[when] is false.
function iconMenuControl(opt, vals, applyPatch, cleanup) {
  const box = document.createElement('div');
  box.className = 'action-menu';
  const btn = document.createElement('button');
  btn.type = 'button';
  btn.id = 'opt-' + opt.key;
  btn.className = 'tool-opt-icon';
  btn.title = opt.title;
  btn.setAttribute('aria-label', opt.title);
  btn.setAttribute('aria-haspopup', 'menu');
  btn.setAttribute('aria-expanded', 'false');
  btn.appendChild(iconSvg(opt.icon, 16));

  const list = document.createElement('div');
  list.className = 'action-menu-list hidden';
  list.setAttribute('role', 'menu');
  list.setAttribute('aria-label', opt.title);
  const setOpen = (open) => {
    list.classList.toggle('hidden', !open);
    btn.setAttribute('aria-expanded', String(open));
  };
  opt.sections.forEach((section, k) => {
    if (k) {
      const sep = document.createElement('div');
      sep.className = 'action-menu-sep';
      list.appendChild(sep);
    }
    const group = document.createElement('div');
    group.setAttribute('role', 'group');
    group.setAttribute('aria-label', section.label);
    for (const [kind, icon, label] of section.items) {
      const item = document.createElement('button');
      item.type = 'button';
      item.className = 'action-menu-item';
      item.setAttribute('role', 'menuitem');
      item.dataset.command = section.prefix + kind;
      item.disabled = vals[section.when] === false;
      item.appendChild(iconSvg(icon, 16));
      const name = document.createElement('span');
      name.className = 'menu-label';
      name.textContent = label;
      item.appendChild(name);
      item.addEventListener('click', () => {
        setOpen(false);
        applyPatch({ _layerCommand: item.dataset.command });
      });
      group.appendChild(item);
    }
    list.appendChild(group);
  });

  btn.addEventListener('click', () => setOpen(list.classList.contains('hidden')));
  const doc = box.ownerDocument;
  const onOutside = (e) => {
    if (!box.contains(e.target)) setOpen(false);
  };
  doc.addEventListener('pointerdown', onOutside);
  cleanup.push(() => doc.removeEventListener('pointerdown', onOutside));
  box.appendChild(btn);
  box.appendChild(list);
  return box;
}

function gradientSwatchControl(opt, initial, fg, bg, onChange, cleanup) {
  let cur = initial;
  const find = (v) => opt.options.find((o) => o.value === v) ?? opt.options[0];
  const box = document.createElement('div');
  box.className = 'tool-opt-swatch-box';

  const btn = document.createElement('button');
  btn.type = 'button';
  btn.id = 'opt-' + opt.key;
  btn.className = 'tool-opt-swatch';
  btn.setAttribute('aria-haspopup', 'listbox');
  btn.setAttribute('aria-expanded', 'false');
  const showCurrent = () => {
    const o = find(cur);
    btn.title = o.label;
    btn.setAttribute('aria-label', `${opt.label}: ${o.label}`);
    btn.style.backgroundImage = swatchBackground(o.preset, fg, bg);
  };

  const list = document.createElement('div');
  list.className = 'tool-opt-swatch-list';
  list.setAttribute('role', 'listbox');
  list.setAttribute('aria-label', opt.label);
  list.hidden = true;

  const setOpen = (open) => {
    list.hidden = !open;
    btn.setAttribute('aria-expanded', String(open));
  };

  const items = [];
  let groupEl = null;
  for (const o of opt.options) {
    if (!groupEl || groupEl.dataset.group !== o.group) {
      groupEl = document.createElement('div');
      groupEl.className = 'tool-opt-swatch-group';
      groupEl.setAttribute('role', 'group');
      groupEl.setAttribute('aria-label', o.group);
      groupEl.dataset.group = o.group;
      list.appendChild(groupEl);
    }
    const item = document.createElement('div');
    item.className = 'tool-opt-swatch-item';
    item.setAttribute('role', 'option');
    item.tabIndex = 0;
    item.title = o.label;
    item.dataset.value = o.value;
    item.setAttribute('aria-selected', String(o.value === cur));
    item.style.backgroundImage = swatchBackground(o.preset, fg, bg);
    const choose = () => {
      cur = o.value;
      for (const it of items) it.setAttribute('aria-selected', String(it === item));
      showCurrent();
      setOpen(false);
      onChange(opt.key, o.value);
      btn.focus();
    };
    item.addEventListener('click', choose);
    item.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' || e.key === ' ') {
        e.preventDefault();
        choose();
      }
    });
    groupEl.appendChild(item);
    items.push(item);
  }

  btn.addEventListener('click', () => setOpen(list.hidden));
  box.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && !list.hidden) {
      e.preventDefault();
      e.stopPropagation();
      setOpen(false);
      btn.focus();
    }
  });

  // Clicking anywhere outside the control closes an open list.
  const doc = box.ownerDocument;
  const onOutside = (e) => {
    if (!list.hidden && !box.contains(e.target)) setOpen(false);
  };
  doc.addEventListener('pointerdown', onOutside);
  cleanup.push(() => doc.removeEventListener('pointerdown', onOutside));

  // showColor repaints the button and every list swatch for the new foreground / background.
  swatchRepaint.set(box, (which, color) => {
    if (which === 'fg') fg = color;
    else bg = color;
    for (const item of items) {
      item.style.backgroundImage = swatchBackground(find(item.dataset.value).preset, fg, bg);
    }
    showCurrent();
  });

  showCurrent();
  box.appendChild(btn);
  box.appendChild(list);
  return box;
}
