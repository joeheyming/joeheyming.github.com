// Paint — Window › panel commands (PhotoCraft menu_catalog.rs Window, dock.rs toggle).
//
// A panel is shown when its dock tab is the selected tab of a visible group, and the Window menu
// checks it then. Picking a shown panel closes its tab (the group's next open tab comes forward,
// or the group goes when none is left); picking a closed or covered one reopens its tab, brings
// it to the front, and focuses it.

import { selectDockTab } from './dock.js';

// Every dock tab, by its Window menu id suffix (window.panel.<name>), in catalog order.
export const DOCK_PANELS = [
  'adjustments',
  'brushes',
  'channels',
  'character',
  'color',
  'gradients',
  'histogram',
  'history',
  'info',
  'layerComps',
  'layers',
  'navigator',
  'paragraph',
  'paths',
  'patterns',
  'properties',
  'shapes',
  'swatches'
];

// Brush Settings, Tool Presets, and Clone Source are sections of the Brushes panel and Styles one
// of the Layers panel (#section-<name>, a <details>; PhotoCraft floats them): shown when the host
// tab is in front and the section is open.
export const DOCK_SECTIONS = {
  brushSettings: 'brushes',
  toolPresets: 'brushes',
  cloneSource: 'brushes',
  styles: 'layers'
};

const sectionOf = (name, doc) =>
  Object.hasOwn(DOCK_SECTIONS, name) ? (doc?.getElementById(`section-${name}`) ?? null) : null;

// Dock element ids are kebab case (layerComps → #tab-layer-comps).
const domId = (name) => name.replace(/[A-Z]/g, (c) => `-${c.toLowerCase()}`);

function partsOf(name, doc) {
  const tab = doc?.getElementById(`tab-${domId(name)}`) ?? null;
  return {
    tab,
    panel: doc?.getElementById(`panel-${domId(name)}`) ?? null,
    group: tab?.closest('.dock-group') ?? null
  };
}

function isDomDoc(doc) {
  return !!doc && typeof doc.getElementById === 'function';
}

/** True when panel `name` is open and in front in the dock. */
export function panelShown(name, doc = globalThis.document) {
  if (!isDomDoc(doc)) return false;
  const section = sectionOf(name, doc);
  if (section) return section.open && panelShown(DOCK_SECTIONS[name], doc);
  const { tab, panel, group } = partsOf(name, doc);
  return !!tab && !!panel && !tab.hidden && !panel.hidden && !group?.hidden;
}

/** Open panel `name` in its group, in front, and focus its tab. */
export function showDockPanel(name, doc = globalThis.document) {
  if (!isDomDoc(doc)) return false;
  const section = sectionOf(name, doc);
  if (section) {
    if (!showDockPanel(DOCK_SECTIONS[name], doc)) return false;
    section.open = true;
    section.querySelector('summary')?.focus?.();
    return true;
  }
  const { tab, group } = partsOf(name, doc);
  if (!tab) return false;
  tab.hidden = false;
  if (group) group.hidden = false;
  selectDockTab(tab);
  tab.focus?.();
  return true;
}

/** Close panel `name`: its tab goes; the group's next open tab comes forward, or the group goes. */
export function hideDockPanel(name, doc = globalThis.document) {
  if (!isDomDoc(doc)) return;
  const section = sectionOf(name, doc);
  if (section) {
    section.open = false;
    return;
  }
  const { tab, panel, group } = partsOf(name, doc);
  if (!tab) return;
  const front = tab.getAttribute('aria-selected') === 'true';
  tab.hidden = true;
  tab.setAttribute('aria-selected', 'false');
  if (panel) panel.hidden = true;
  const list = tab.closest('[role="tablist"]');
  const next = [...(list?.querySelectorAll('[role="tab"]') ?? [])].find((t) => !t.hidden);
  if (!next) {
    if (group) group.hidden = true;
  } else if (front) {
    selectDockTab(next);
  }
}

/** Window › <panel>: hide it when shown, else show it. Returns whether it is shown after. */
export function toggleDockPanel(name, doc = globalThis.document) {
  if (panelShown(name, doc)) {
    hideDockPanel(name, doc);
    return false;
  }
  return showDockPanel(name, doc);
}
