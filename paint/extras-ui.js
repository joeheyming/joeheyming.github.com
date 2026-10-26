// Paint — the View › Show overlays on screen (PhotoCraft rulers.rs draw_grid, pixel_grid.rs,
// snap_ui.rs draw_smart_guides, and the brush outline cursor).
//
// #extras-layer sits in the canvas stack, so everything in it pans, zooms, and turns with the
// document; widths of 1 / zoom keep the lines one screen pixel wide. The grid and the pixel grid
// are CSS gradients sized in document pixels. Layer Edges outlines the active layer's pixels;
// smart guides are the magenta alignment lines a Move drag reports; Brush Preview is a circle the
// size of the brush under the pointer. Pixel Art Preview turns the stack's canvases pixelated.
// Which overlays show is paint/snap.js.

import { gridStep, pixelGridVisible, shows } from './snap.js';

// Tools that paint with a round tip of toolOptions[tool].size.
const BRUSH_TOOLS = new Set([
  'pencil',
  'brush',
  'mixerBrush',
  'colorReplacement',
  'eraser',
  'backgroundEraser',
  'cloneStamp',
  'patternStamp',
  'healingBrush',
  'spotHealing',
  'historyBrush',
  'dodge',
  'burn',
  'sponge',
  'blur',
  'sharpen',
  'smudge'
]);

/** The brush outline diameter for the tool in use, or null when it paints no round tip. */
export function brushPreviewSize(state) {
  if (!BRUSH_TOOLS.has(state.tool)) return null;
  const size = state.toolOptions?.[state.tool]?.size;
  return Number.isFinite(size) && size > 0 ? size : null;
}

/**
 * @param {{
 *   state: any,
 *   layerBounds: () => ({ x0: number, y0: number, x1: number, y1: number } | null),
 *   doc?: Document
 * }} deps
 */
export function initExtras({ state, layerBounds, doc = document }) {
  const layer = doc.getElementById('extras-layer');
  const stack = doc.getElementById('canvas-stack');
  const make = (cls) => {
    const el = doc.createElement('div');
    el.className = cls;
    el.hidden = true;
    layer?.appendChild(el);
    return el;
  };
  const pixelGrid = make('extras-pixel-grid');
  const grid = make('extras-grid');
  const edges = make('extras-layer-edges');
  const smart = make('extras-smart-guides');
  const brush = make('extras-brush-preview');
  let hover = null;

  function renderGrid() {
    const z = Math.max(state.zoom, 1e-4);
    layer?.style.setProperty('--extras-w', `${1 / z}px`);
    grid.hidden = !shows(state, 'grid');
    if (!grid.hidden) {
      const major = state.grid?.every ?? 72;
      const minor = gridStep(state.grid);
      grid.style.setProperty('--grid-major', `${major}px`);
      grid.style.setProperty('--grid-minor', `${minor}px`);
    }
    pixelGrid.hidden = !pixelGridVisible(state);
    stack?.classList.toggle('pixel-art-preview', !!state.pixelArtPreview);
  }

  function renderEdges() {
    const b = shows(state, 'layerEdges') ? layerBounds() : null;
    edges.hidden = !b;
    if (!b) return;
    Object.assign(edges.style, {
      left: `${b.x0}px`,
      top: `${b.y0}px`,
      width: `${b.x1 - b.x0}px`,
      height: `${b.y1 - b.y0}px`
    });
  }

  function renderSmart(lines = []) {
    smart.replaceChildren();
    const on = shows(state, 'smartGuides') && lines.length > 0;
    smart.hidden = !on;
    if (!on) return;
    for (const l of lines) {
      const el = doc.createElement('div');
      el.className = `smart-guide ${l.vertical ? 'smart-guide-v' : 'smart-guide-h'}`;
      Object.assign(
        el.style,
        l.vertical
          ? { left: `${l.pos}px`, top: `${l.from}px`, height: `${l.to - l.from}px` }
          : { top: `${l.pos}px`, left: `${l.from}px`, width: `${l.to - l.from}px` }
      );
      smart.appendChild(el);
    }
  }

  function renderBrush() {
    const size = hover && shows(state, 'brushPreview') ? brushPreviewSize(state) : null;
    brush.hidden = size == null;
    if (size == null) return;
    Object.assign(brush.style, {
      left: `${hover[0] - size / 2}px`,
      top: `${hover[1] - size / 2}px`,
      width: `${size}px`,
      height: `${size}px`
    });
  }

  return {
    render() {
      if (layer) layer.hidden = state.extras === false;
      renderGrid();
      renderEdges();
      renderBrush();
    },
    renderEdges,
    renderSmart,
    /** The pointer is over the document at (x, y), or left it (null). */
    hover(x, y) {
      hover = x == null ? null : [x, y];
      renderBrush();
    }
  };
}
