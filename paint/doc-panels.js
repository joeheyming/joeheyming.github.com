// Paint — the Navigator | Histogram | Info dock group (PhotoCraft panels.rs navigator and
// info_panel, tone.rs histogram_panel).
//
// Navigator: the document fitted in its box with an 8-point inset, a red rectangle over the part
// the canvas area shows, and a log-scale zoom slider. A click or drag on the preview centres the
// view on that document point. Info: R, G, B and H, S, B of the composite pixel under the
// pointer, its X / Y, the selection's W / H, and one #n R G B column per Color Sampler point.
// Histogram: the active layer's composite or one channel, redrawn after each history step.
// The math is pure; initDocPanels wires the DOM.

import {
  ZOOM_MAX,
  ZOOM_MIN,
  ZOOM_STEP,
  anchorView,
  clampZoom,
  viewOf,
  viewToDoc,
  zoomAt
} from './view.js';
import { iconSvg } from './icons.js';
import { levelsHistograms, levelsMedian } from './adjustments.js';
import { channelHistogram, drawHistogram } from './adjust-modal.js';
import { panelShown } from './window-panels.js';
import { samplerReadouts } from './samplers.js';

const NAV_INSET = 8;

/** The W × H document fitted in a boxW × boxH preview: { x, y, w, h, s, boxW, boxH }. */
export function navigatorFit(boxW, boxH, W, H, inset = NAV_INSET) {
  const iw = Math.max(1, boxW - 2 * inset),
    ih = Math.max(1, boxH - 2 * inset);
  const s = Math.min(iw / Math.max(1, W), ih / Math.max(1, H));
  const w = W * s,
    h = H * s;
  return { x: (boxW - w) / 2, y: (boxH - h) / 2, w, h, s, boxW, boxH };
}

/**
 * The visible-area rectangle in preview pixels: the canvas area `area` ({ x, y, w, h } in view
 * points) mapped back to the document, boxed, scaled by `fit`, and clipped to the preview box.
 */
export function navigatorViewRect(v, W, H, area, fit) {
  const corners = [
    [area.x, area.y],
    [area.x + area.w, area.y],
    [area.x, area.y + area.h],
    [area.x + area.w, area.y + area.h]
  ].map(([vx, vy]) => viewToDoc(v, W, H, vx, vy));
  const xs = corners.map((c) => fit.x + c[0] * fit.s);
  const ys = corners.map((c) => fit.y + c[1] * fit.s);
  const x0 = Math.max(0, Math.min(...xs)),
    y0 = Math.max(0, Math.min(...ys));
  const x1 = Math.min(fit.boxW, Math.max(...xs)),
    y1 = Math.min(fit.boxH, Math.max(...ys));
  return { x: x0, y: y0, w: Math.max(0, x1 - x0), h: Math.max(0, y1 - y0) };
}

/** A preview point → the document point under it, clamped to the document. */
export function navigatorDocPoint(fit, px, py, W, H) {
  return [
    Math.max(0, Math.min(W, (px - fit.x) / fit.s)),
    Math.max(0, Math.min(H, (py - fit.y) / fit.s))
  ];
}

/** The view with the canvas area's centre over document point `doc`, zoom unchanged. */
export function navigatorCenter(v, W, H, area, doc) {
  return anchorView(v, W, H, doc, [area.x + area.w / 2, area.y + area.h / 2], v.zoom);
}

// The zoom slider is log2 of the zoom over the whole zoom range.
export const NAV_SLIDER_MIN = Math.log2(ZOOM_MIN);
export const NAV_SLIDER_MAX = Math.log2(ZOOM_MAX);

export function sliderToZoom(value) {
  return clampZoom(2 ** value);
}

export function zoomToSlider(zoom) {
  return Math.log2(clampZoom(zoom));
}

/** One Zoom In (dir 1) or Zoom Out (dir -1) step, the same factor as View › Zoom In / Out. */
export function navigatorZoomStep(zoom, dir) {
  return clampZoom(zoom * ZOOM_STEP ** dir);
}

/** The zoom for typed text like `150` or `150%`, clamped; null when it is not a positive number. */
export function parseZoomPercent(text) {
  const t = String(text).trim().replace(/%$/, '').trim();
  if (!t) return null;
  const n = Number(t);
  if (!Number.isFinite(n) || n <= 0) return null;
  return clampZoom(n / 100);
}

/** The slider's zoom about the canvas area's centre. */
export function navigatorZoom(v, W, H, area, zoom) {
  return zoomAt(v, W, H, area.x + area.w / 2, area.y + area.h / 2, zoom);
}

/** 0..255 RGB → [hue°, saturation %, brightness %], each rounded (Photoshop's HSB readout). */
export function rgbToHsb(r, g, b) {
  const max = Math.max(r, g, b),
    min = Math.min(r, g, b);
  const d = max - min;
  let h = 0;
  if (d > 0) {
    if (max === r) h = ((g - b) / d) % 6;
    else if (max === g) h = (b - r) / d + 2;
    else h = (r - g) / d + 4;
    h *= 60;
    if (h < 0) h += 360;
  }
  const s = max === 0 ? 0 : d / max;
  return [Math.round(h) % 360, Math.round(s * 100), Math.round((max / 255) * 100)];
}

/**
 * The Info readout: rgba is the composite pixel under the pointer (null when off the canvas),
 * pos the integer pixel, size the selection's { w, h } or null. Missing values read '—'.
 */
export function infoReadout(rgba, pos, size) {
  const dash = '—';
  const hsb = rgba && rgbToHsb(rgba[0], rgba[1], rgba[2]);
  return {
    color: [
      ['R', rgba ? String(rgba[0]) : dash],
      ['G', rgba ? String(rgba[1]) : dash],
      ['B', rgba ? String(rgba[2]) : dash]
    ],
    hsb: [
      ['H', hsb ? `${hsb[0]}°` : dash],
      ['S', hsb ? `${hsb[1]}%` : dash],
      ['B', hsb ? `${hsb[2]}%` : dash]
    ],
    pos: [
      ['X', pos ? String(pos[0]) : dash],
      ['Y', pos ? String(pos[1]) : dash]
    ],
    size: [
      ['W', size ? String(Math.round(size.w)) : dash],
      ['H', size ? String(Math.round(size.h)) : dash]
    ]
  };
}

/** Mean, Std Dev, Median, and Pixels of one 256-bin histogram. */
export function histogramStats(h) {
  let n = 0,
    sum = 0,
    sq = 0;
  for (let i = 0; i < 256; i++) {
    n += h[i];
    sum += i * h[i];
    sq += i * i * h[i];
  }
  const mean = n ? sum / n : 0;
  const dev = n ? Math.sqrt(Math.max(0, sq / n - mean * mean)) : 0;
  return { mean, dev, median: n ? levelsMedian(h) : 0, pixels: n };
}

/** The Histogram panel's bins for `channel` ('rgb', 'red', 'green', 'blue') of an ImageData. */
export function layerHistogram(imgData, channel) {
  return channelHistogram(levelsHistograms(imgData), channel);
}

function el(doc, tag, cls, text) {
  const e = doc.createElement(tag);
  if (cls) e.className = cls;
  if (text != null) e.textContent = text;
  return e;
}

/**
 * Fill the three panels. deps: state, W(), H(), areaRect() (the canvas area in view points),
 * showView(v) (writes the view and redraws), composite() (the flattened document canvas),
 * activeImage() (the active layer's ImageData or null). Returns { refresh, invalidate, hover }:
 * refresh() redraws the shown panels, invalidate() marks the pixels changed (after a history
 * step), hover(x, y) is the pointer's document point (null off the canvas).
 */
export function initDocPanels(deps, doc = document) {
  const { state, W, H } = deps;
  const navPanel = doc.getElementById('panel-navigator');
  const histPanel = doc.getElementById('panel-histogram');
  const infoPanel = doc.getElementById('panel-info');
  if (!navPanel || !histPanel || !infoPanel) {
    return { refresh() {}, invalidate() {}, hover() {} };
  }

  // Navigator
  navPanel.replaceChildren();
  const nav = el(doc, 'div', 'navigator');
  const preview = el(doc, 'canvas', 'navigator-preview');
  preview.width = 220;
  preview.height = 150;
  preview.setAttribute('aria-label', 'Navigator preview');
  const zoomRow = el(doc, 'div', 'navigator-zoom');
  // PhotoCraft's row: the zoom typed in percent, Zoom Out, the slider, Zoom In.
  const pct = /** @type {HTMLInputElement} */ (el(doc, 'input', 'navigator-pct'));
  pct.type = 'text';
  pct.setAttribute('aria-label', 'Zoom percentage');
  const zoomBtn = (cls, label, icon) => {
    const b = /** @type {HTMLButtonElement} */ (el(doc, 'button', cls));
    b.type = 'button';
    b.title = label;
    b.setAttribute('aria-label', label);
    b.append(iconSvg(icon, 14, doc));
    return b;
  };
  const zoomOut = zoomBtn('navigator-zoom-out', 'Zoom Out', 'minus');
  const zoomIn = zoomBtn('navigator-zoom-in', 'Zoom In', 'plus');
  const slider = /** @type {HTMLInputElement} */ (el(doc, 'input', 'navigator-slider'));
  slider.type = 'range';
  slider.min = String(NAV_SLIDER_MIN);
  slider.max = String(NAV_SLIDER_MAX);
  slider.step = '0.01';
  slider.setAttribute('aria-label', 'Zoom');
  zoomRow.append(pct, zoomOut, slider, zoomIn);
  nav.append(preview, zoomRow);
  navPanel.append(nav);

  // Histogram
  histPanel.replaceChildren();
  const hist = el(doc, 'div', 'histogram-panel');
  const channel = /** @type {HTMLSelectElement} */ (el(doc, 'select', 'histogram-channel'));
  channel.setAttribute('aria-label', 'Channel');
  for (const [value, label] of [
    ['rgb', 'RGB'],
    ['red', 'Red'],
    ['green', 'Green'],
    ['blue', 'Blue']
  ]) {
    const o = el(doc, 'option', null, label);
    o.value = value;
    channel.append(o);
  }
  const histCanvas = el(doc, 'canvas', 'histogram-graph');
  histCanvas.width = 256;
  histCanvas.height = 90;
  const stats = el(doc, 'dl', 'histogram-stats');
  hist.append(channel, histCanvas, stats);
  histPanel.append(hist);

  // Info
  infoPanel.replaceChildren();
  const info = el(doc, 'div', 'info-panel');
  infoPanel.append(info);

  // The composite canvas and its ImageData, until the next history step.
  let flat = null;
  let pixels = null;
  let hoverAt = null;
  let navDrag = false;

  const zoomPercentText = () => `${Math.round(state.zoom * 100)}%`;
  const fitNow = () => navigatorFit(preview.width, preview.height, W(), H());

  function drawNavigator() {
    const fit = fitNow();
    if (doc.activeElement !== pct) pct.value = zoomPercentText();
    slider.value = String(zoomToSlider(state.zoom));
    const g = preview.getContext('2d');
    if (!g) return;
    g.clearRect(0, 0, preview.width, preview.height);
    flat ??= deps.composite();
    if (flat) g.drawImage(flat, fit.x, fit.y, fit.w, fit.h);
    const r = navigatorViewRect(viewOf(state), W(), H(), deps.areaRect(), fit);
    g.strokeStyle = 'rgb(255, 84, 84)';
    g.lineWidth = 1.5;
    g.strokeRect(r.x, r.y, r.w, r.h);
  }

  function drawHistogramPanel() {
    const img = deps.activeImage();
    const h = img ? layerHistogram(img, channel.value) : new Array(256).fill(0);
    drawHistogram(histCanvas, h);
    const s = histogramStats(h);
    stats.replaceChildren();
    for (const [k, v] of [
      ['Mean', s.mean.toFixed(2)],
      ['Std Dev', s.dev.toFixed(2)],
      ['Median', String(s.median)],
      ['Pixels', String(s.pixels)]
    ]) {
      stats.append(el(doc, 'dt', null, k), el(doc, 'dd', null, v));
    }
  }

  function drawInfo() {
    const w = W(),
      h = H();
    const inside =
      !!hoverAt && hoverAt[0] >= 0 && hoverAt[1] >= 0 && hoverAt[0] < w && hoverAt[1] < h;
    let rgba = null;
    const points = state.samplers ?? [];
    if (inside || points.length) {
      flat ??= deps.composite();
      pixels ??= flat?.getContext('2d')?.getImageData(0, 0, w, h) ?? null;
    }
    if (inside) {
      if (pixels) {
        const i = (hoverAt[1] * w + hoverAt[0]) * 4;
        rgba = [pixels.data[i], pixels.data[i + 1], pixels.data[i + 2], pixels.data[i + 3]];
      }
    }
    const sel = state.sel?.mode === 'active' && state.sel.w > 0 ? state.sel : null;
    const r = infoReadout(rgba, inside ? hoverAt : null, sel);
    info.replaceChildren();
    for (const rows of [r.color, r.hsb, r.pos, r.size]) {
      const col = el(doc, 'dl', 'info-col');
      for (const [k, v] of rows) col.append(el(doc, 'dt', null, `${k}:`), el(doc, 'dd', null, v));
      info.append(col);
    }
    if (!pixels) return;
    const size = Number(state.toolOptions?.colorSampler?.sampleSize ?? 1);
    for (const { number, rgb } of samplerReadouts(pixels, points, size)) {
      const col = el(doc, 'dl', 'info-col info-sampler');
      col.append(el(doc, 'dt', null, `#${number}`), el(doc, 'dd', null, ''));
      ['R', 'G', 'B'].forEach((k, i) => {
        col.append(el(doc, 'dt', null, `${k}:`), el(doc, 'dd', null, String(rgb[i])));
      });
      info.append(col);
    }
  }

  function refresh() {
    if (panelShown('navigator', doc)) drawNavigator();
    if (panelShown('histogram', doc)) drawHistogramPanel();
    if (panelShown('info', doc)) drawInfo();
  }

  let queued = false;
  function invalidate() {
    flat = null;
    pixels = null;
    if (queued) return;
    queued = true;
    // After the change the history row was pushed for has landed.
    setTimeout(() => {
      queued = false;
      refresh();
    }, 0);
  }

  function centreAt(e) {
    const rect = preview.getBoundingClientRect();
    const sx = preview.width / (rect.width || preview.width);
    const sy = preview.height / (rect.height || preview.height);
    const fit = fitNow();
    const px = (e.clientX - rect.left) * sx,
      py = (e.clientY - rect.top) * sy;
    const p = navigatorDocPoint(fit, px, py, W(), H());
    deps.showView(navigatorCenter(viewOf(state), W(), H(), deps.areaRect(), p));
  }

  preview.addEventListener('pointerdown', (e) => {
    navDrag = true;
    preview.setPointerCapture?.(e.pointerId);
    centreAt(e);
  });
  preview.addEventListener('pointermove', (e) => {
    if (navDrag) centreAt(e);
  });
  const endDrag = () => {
    navDrag = false;
  };
  preview.addEventListener('pointerup', endDrag);
  preview.addEventListener('pointercancel', endDrag);
  slider.addEventListener('input', () => {
    const v = navigatorZoom(viewOf(state), W(), H(), deps.areaRect(), sliderToZoom(+slider.value));
    deps.showView(v);
  });
  const showZoom = (zoom) => {
    deps.showView(navigatorZoom(viewOf(state), W(), H(), deps.areaRect(), zoom));
  };
  zoomOut.addEventListener('click', () => showZoom(navigatorZoomStep(state.zoom, -1)));
  zoomIn.addEventListener('click', () => showZoom(navigatorZoomStep(state.zoom, 1)));
  pct.addEventListener('change', () => {
    const zoom = parseZoomPercent(pct.value);
    if (zoom != null) showZoom(zoom);
    pct.value = zoomPercentText();
  });
  pct.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') pct.blur();
  });
  channel.addEventListener('change', drawHistogramPanel);
  for (const name of ['navigator', 'histogram', 'info']) {
    doc.getElementById(`tab-${name}`)?.addEventListener('click', refresh);
  }
  // A stroke's pixels land after its history row; redraw once the pointer lifts.
  doc.defaultView?.addEventListener('pointerup', () => invalidate());

  function hover(x, y) {
    hoverAt = x == null ? null : [Math.floor(x), Math.floor(y)];
    if (panelShown('info', doc)) drawInfo();
  }

  return { refresh, invalidate, hover };
}
