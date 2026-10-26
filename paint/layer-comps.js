// Window › Layer Comps (PhotoCraft comps_ui.rs panel, doc comps.rs LayerComp). A comp records
// every layer's visibility and appearance (opacity, blend mode) so a person can switch between
// versions of the document. Paint layers are full-canvas pixels with no offset, so there is no
// Position option. Comps and comp lists are never mutated; every op returns new objects.

import { iconSvg } from './icons.js';

/** Capture `layers` as a comp named `name`. `flags` picks what applyComp restores. */
export function captureComp(layers, name, flags = {}) {
  return {
    name,
    applyVisibility: flags.applyVisibility !== false,
    applyAppearance: flags.applyAppearance !== false,
    states: layers.map((l) => ({
      id: l.id,
      visible: l.visible !== false,
      opacity: l.opacity,
      blendMode: l.blendMode
    }))
  };
}

/**
 * New layer records with `comp` applied: same ids and order, other fields shared. Layers the comp
 * does not record are returned unchanged.
 */
export function applyComp(layers, comp) {
  const byId = new Map(comp.states.map((s) => [s.id, s]));
  return layers.map((l) => {
    const s = byId.get(l.id);
    if (!s) return l;
    return {
      ...l,
      ...(comp.applyVisibility ? { visible: s.visible } : {}),
      ...(comp.applyAppearance ? { opacity: s.opacity, blendMode: s.blendMode } : {})
    };
  });
}

/** The next default comp name ('Layer Comp 1', 'Layer Comp 2', …). */
export function nextCompName(comps) {
  const used = new Set(comps.map((c) => c.name));
  let n = comps.length + 1;
  while (used.has(`Layer Comp ${n}`)) n++;
  return `Layer Comp ${n}`;
}

/** Comps for .paintproj: layer ids become indices into `layers` (ids are not saved). */
export function serializeComps(comps, layers) {
  if (!comps?.length) return null;
  const index = new Map(layers.map((l, i) => [l.id, i]));
  return comps.map((c) => ({
    name: c.name,
    applyVisibility: c.applyVisibility,
    applyAppearance: c.applyAppearance,
    states: c.states
      .filter((s) => index.has(s.id))
      .map((s) => ({
        layer: index.get(s.id),
        visible: s.visible,
        opacity: s.opacity,
        blendMode: s.blendMode
      }))
  }));
}

/** Comps from .paintproj against the loaded `layers`; older files have none. */
export function deserializeComps(saved, layers) {
  if (!Array.isArray(saved)) return [];
  return saved
    .filter((c) => c && Array.isArray(c.states))
    .map((c) => ({
      name: typeof c.name === 'string' && c.name ? c.name : 'Layer Comp',
      applyVisibility: c.applyVisibility !== false,
      applyAppearance: c.applyAppearance !== false,
      states: c.states
        .filter((s) => Number.isInteger(s?.layer) && layers[s.layer])
        .map((s) => ({
          id: layers[s.layer].id,
          visible: s.visible !== false,
          opacity: Number.isFinite(s.opacity) ? s.opacity : 1,
          blendMode: typeof s.blendMode === 'string' ? s.blendMode : 'source-over'
        }))
    }));
}

/**
 * The Layer Comps panel: a Last Document State row, one row per comp (aria-selected on
 * opts.applied; a click runs opts.onApply(index)), and a footer with New Layer Comp
 * (opts.onNew) and Delete Layer Comp (opts.onDelete(opts.selected), disabled without one).
 */
export function renderLayerCompsPanel(container, comps, opts) {
  const doc = container.ownerDocument;
  container.textContent = '';
  const list = doc.createElement('div');
  list.className = 'comp-list';
  list.setAttribute('role', 'listbox');
  list.setAttribute('aria-label', 'Layer Comps');
  const row = (name, selected, onClick) => {
    const el = doc.createElement('div');
    el.className = 'comp-row';
    el.setAttribute('role', 'option');
    el.setAttribute('aria-selected', String(selected));
    const marker = doc.createElement('span');
    marker.className = 'comp-marker';
    if (selected) marker.appendChild(iconSvg('check', 12, doc));
    const label = doc.createElement('span');
    label.className = 'comp-name';
    label.textContent = name;
    el.append(marker, label);
    el.addEventListener('click', onClick);
    list.appendChild(el);
    return el;
  };
  row('Last Document State', opts.applied == null, () => opts.onLastState?.()).classList.add(
    'comp-last'
  );
  comps.forEach((c, i) => {
    row(c.name, opts.applied === i, () => opts.onApply(i)).dataset.comp = String(i);
  });
  container.appendChild(list);
  if (!comps.length) {
    const hint = doc.createElement('p');
    hint.className = 'panel-empty';
    hint.textContent =
      'Capture the visibility and style of every layer with + below, then switch between versions.';
    container.appendChild(hint);
  }
  const footer = doc.createElement('div');
  footer.className = 'layer-panel-footer';
  const selected = opts.selected != null && !!comps[opts.selected];
  const buttons = [
    ['new', 'plus', 'New Layer Comp', false, () => opts.onNew()],
    ['delete', 'trash', 'Delete Layer Comp', !selected, () => opts.onDelete(opts.selected)]
  ];
  for (const [action, icon, title, disabled, run] of buttons) {
    const btn = doc.createElement('button');
    btn.type = 'button';
    btn.className = 'layer-footer-btn';
    btn.dataset.action = action;
    btn.title = title;
    btn.setAttribute('aria-label', title);
    btn.appendChild(iconSvg(icon, 16, doc));
    btn.disabled = disabled;
    btn.addEventListener('click', run);
    footer.appendChild(btn);
  }
  container.appendChild(footer);
}
