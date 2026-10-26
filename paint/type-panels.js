// Paint — the Character and Paragraph panels (PhotoCraft type_panels_ui.rs), one dock group.
//
// Character: font family, style, size, leading (0 is Auto), tracking, colour, Faux Bold and Faux
// Italic. Paragraph: align left / center / right / justify, the three indents, and space before
// / after. Both read the record read() returns (the active type layer, else the Type tool's
// options) and hand every change to onChange(patch) as type-record keys.

import { iconSvg } from './icons.js';
import { TYPE_ALIGNS } from './type-layers.js';

// Character › Style, as the record's bold / italic pair.
export const TYPE_STYLES = [
  { value: 'regular', label: 'Regular', bold: false, italic: false },
  { value: 'italic', label: 'Italic', bold: false, italic: true },
  { value: 'bold', label: 'Bold', bold: true, italic: false },
  { value: 'boldItalic', label: 'Bold Italic', bold: true, italic: true }
];

/** The Style a record shows. */
export function typeStyleOf(t) {
  return TYPE_STYLES.find((s) => s.bold === !!t.bold && s.italic === !!t.italic).value;
}

/** The patch a Style choice makes. */
export function typeStylePatch(value) {
  const s = TYPE_STYLES.find((st) => st.value === value) ?? TYPE_STYLES[0];
  return { bold: s.bold, italic: s.italic };
}

const CHARACTER_NUMBERS = [
  { key: 'size', label: 'Size', min: 1, unit: 'px' },
  { key: 'leading', label: 'Leading', min: 0, unit: 'px', title: '0 is Auto' },
  { key: 'tracking', label: 'Tracking', unit: '‰' }
];

const PARAGRAPH_NUMBERS = [
  { key: 'indentLeft', label: 'Indent Left' },
  { key: 'indentRight', label: 'Indent Right' },
  { key: 'indentFirst', label: 'Indent First Line' },
  { key: 'spaceBefore', label: 'Space Before' },
  { key: 'spaceAfter', label: 'Space After' }
];

const ALIGN_TITLES = {
  left: 'Left align text',
  center: 'Center text',
  right: 'Right align text',
  justify: 'Justify last left'
};

function select(doc, key, options) {
  const el = doc.createElement('select');
  el.dataset.typeKey = key;
  for (const o of options) {
    const opt = doc.createElement('option');
    opt.value = o.value;
    opt.textContent = o.label;
    el.append(opt);
  }
  return el;
}

function row(doc, label, control) {
  const el = doc.createElement('label');
  el.className = 'type-panel-row';
  const span = doc.createElement('span');
  span.textContent = label;
  el.append(span, control);
  return el;
}

function numberInput(doc, f, onChange) {
  const input = doc.createElement('input');
  input.type = 'number';
  input.dataset.typeKey = f.key;
  if (f.min != null) input.min = String(f.min);
  input.step = '1';
  if (f.title) input.title = f.title;
  input.addEventListener('change', () => {
    const v = parseFloat(input.value);
    if (Number.isFinite(v)) onChange({ [f.key]: f.min != null ? Math.max(f.min, v) : v });
  });
  return input;
}

function checkbox(doc, key, label, onChange) {
  const input = doc.createElement('input');
  input.type = 'checkbox';
  input.dataset.typeKey = key;
  input.addEventListener('change', () => onChange({ [key]: input.checked }));
  const el = doc.createElement('label');
  el.className = 'type-panel-check';
  const span = doc.createElement('span');
  span.textContent = label;
  el.append(input, span);
  return el;
}

/**
 * Fill #panel-character and #panel-paragraph. families is [{ value, label }]. Returns
 * { render } to call whenever the active layer or the type options change.
 */
export function initTypePanels({ doc = globalThis.document, families, read, onChange }) {
  const character = doc?.getElementById('panel-character');
  const paragraph = doc?.getElementById('panel-paragraph');
  if (!character || !paragraph) return { render() {} };

  const charBody = doc.createElement('div');
  charBody.className = 'type-panel';
  const family = select(doc, 'family', families);
  family.addEventListener('change', () => onChange({ family: family.value }));
  const style = select(doc, 'style', TYPE_STYLES);
  style.addEventListener('change', () => onChange(typeStylePatch(style.value)));
  const color = doc.createElement('input');
  color.type = 'color';
  color.dataset.typeKey = 'color';
  color.addEventListener('change', () => onChange({ color: color.value }));
  charBody.append(
    row(doc, 'Font', family),
    row(doc, 'Style', style),
    ...CHARACTER_NUMBERS.map((f) => row(doc, f.label, numberInput(doc, f, onChange))),
    row(doc, 'Color', color),
    checkbox(doc, 'fauxBold', 'Faux Bold', onChange),
    checkbox(doc, 'fauxItalic', 'Faux Italic', onChange)
  );
  character.replaceChildren(charBody);

  const paraBody = doc.createElement('div');
  paraBody.className = 'type-panel';
  const aligns = doc.createElement('div');
  aligns.className = 'type-panel-aligns';
  aligns.setAttribute('role', 'group');
  aligns.setAttribute('aria-label', 'Alignment');
  for (const a of TYPE_ALIGNS) {
    const btn = doc.createElement('button');
    btn.type = 'button';
    btn.className = 'type-panel-align';
    btn.dataset.align = a;
    btn.title = ALIGN_TITLES[a];
    btn.setAttribute('aria-label', ALIGN_TITLES[a]);
    btn.innerHTML = iconSvg(`align-${a}`, 16);
    btn.addEventListener('click', () => onChange({ align: a }));
    aligns.append(btn);
  }
  paraBody.append(
    aligns,
    ...PARAGRAPH_NUMBERS.map((f) => row(doc, f.label, numberInput(doc, f, onChange)))
  );
  paragraph.replaceChildren(paraBody);

  function render() {
    const t = read();
    const fields = [character, paragraph].flatMap((p) => [...p.querySelectorAll('[data-type-key]')]);
    for (const el of fields) {
      const key = el.dataset.typeKey;
      if (key === 'style') el.value = typeStyleOf(t);
      else if (el.type === 'checkbox') el.checked = !!t[key];
      else if (doc.activeElement !== el) el.value = String(t[key]);
    }
    for (const btn of aligns.querySelectorAll('[data-align]')) {
      btn.setAttribute('aria-pressed', String(btn.dataset.align === t.align));
    }
  }
  render();
  return { render };
}
