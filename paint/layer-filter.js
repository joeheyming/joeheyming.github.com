// The Layers panel's filter row (PhotoCraft layer_filter_ui.rs): a Kind / Name / Mode dropdown and
// the controls for that type. Filtering is a view of the panel only; it never changes the stack.

import { PASS_THROUGH, isGroupLayer } from './layer-groups.js';

// The kinds the Kind filter toggles, with PhotoCraft's icon and tooltip for each button.
export const FILTER_KINDS = [
  { kind: 'pixel', icon: 'image', tip: 'Filter for pixel layers' },
  { kind: 'adjustment', icon: 'adjustment-layer', tip: 'Filter for adjustment layers' },
  { kind: 'type', icon: 'type', tip: 'Filter for type layers' },
  { kind: 'shape', icon: 'square', tip: 'Filter for shape layers' },
  { kind: 'smart', icon: 'app-window', tip: 'Filter for smart objects' }
];

export function defaultLayerFilter() {
  return { by: 'kind', kinds: [], name: '', mode: 'source-over' };
}

// The Kind filter's name for a layer ('' for groups, which no kind matches).
export function layerFilterKind(layer) {
  if (isGroupLayer(layer)) return '';
  const kind = layer.kind || 'pixel';
  if (kind === 'fill') return 'adjustment';
  return kind;
}

// Like Photoshop, Mode always filters (by Normal at first); Kind and Name only once a kind is
// toggled or some text is typed.
export function layerFilterActive(filter) {
  if (!filter) return false;
  if (filter.by === 'mode') return true;
  if (filter.by === 'name') return (filter.name || '').trim() !== '';
  return (filter.kinds || []).length > 0;
}

export function layerFilterShows(filter, layer) {
  if (!layerFilterActive(filter)) return true;
  if (filter.by === 'name') {
    return (layer.name || '').toLowerCase().includes(filter.name.trim().toLowerCase());
  }
  if (filter.by === 'mode') {
    const mode = layer.blendMode || (isGroupLayer(layer) ? PASS_THROUGH : 'source-over');
    return mode === (filter.mode || 'source-over');
  }
  return filter.kinds.includes(layerFilterKind(layer));
}
