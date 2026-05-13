// Project save/load — serializes the canvas state (size, layers, blend modes,
// opacity, names, color settings) into a JSON-friendly object whose layer
// pixels are stored as PNG data URLs. Round-trips losslessly through
// download/upload AND through localStorage autosave (subject to quota).

import { createLayer } from './layers.js';

const PROJECT_VERSION = 1;
const AUTOSAVE_KEY = 'paint.autosave.v1';
// localStorage caps tend to be ~5MB. Don't bother if the serialized payload
// crosses this — we'd just throw a QuotaExceededError. PNG data URLs are
// base64 (4/3 inflation) so this leaves headroom.
const AUTOSAVE_MAX_BYTES = 4 * 1024 * 1024;

export function serializeProject(state, canvasW, canvasH) {
  return {
    version: PROJECT_VERSION,
    width: canvasW,
    height: canvasH,
    bgColor: state.bgColor,
    fgColor: state.color,
    activeLayerIdx: state.activeLayerIdx,
    layers: state.layers.map(layer => ({
      name: layer.name,
      opacity: layer.opacity,
      visible: layer.visible,
      blendMode: layer.blendMode || 'source-over',
      dataUrl: layer.canvas.toDataURL('image/png'),
    })),
  };
}

// Restore a serialized project into the live state.
// `apply` is a callback the caller provides to swap in the new layers and
// rewire DOM/UI. Signature: apply({ width, height, layers, bgColor, fgColor, activeLayerIdx })
export async function deserializeProject(data, apply) {
  if (!data || data.version !== PROJECT_VERSION) {
    throw new Error('Unknown project version: ' + data?.version);
  }
  const { width, height, layers, bgColor, fgColor, activeLayerIdx } = data;
  const built = await Promise.all(layers.map(async (l, i) => {
    const layer = createLayer(l.name || `Layer ${i + 1}`, width, height);
    layer.opacity = typeof l.opacity === 'number' ? l.opacity : 1;
    layer.visible = l.visible !== false;
    layer.blendMode = l.blendMode || 'source-over';
    if (l.dataUrl) {
      const img = await loadImage(l.dataUrl);
      layer.ctx.drawImage(img, 0, 0);
    }
    return layer;
  }));
  apply({
    width, height,
    bgColor: bgColor || '#ffffff',
    fgColor: fgColor || '#000000',
    activeLayerIdx: typeof activeLayerIdx === 'number' ? activeLayerIdx : 0,
    layers: built,
  });
}

function loadImage(src) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = reject;
    img.src = src;
  });
}

// ── File download / upload ───────────────────────────────────────────────────

export function downloadProject(data, filename = 'paint.paintproj') {
  const blob = new Blob([JSON.stringify(data)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  link.click();
  setTimeout(() => URL.revokeObjectURL(url), 5000);
}

export async function readProjectFile(file) {
  const text = await file.text();
  return JSON.parse(text);
}

// ── Autosave (localStorage) ──────────────────────────────────────────────────

let autosaveTimer = null;

export function scheduleAutosave(state, canvasW, canvasH, delayMs = 800) {
  if (autosaveTimer) clearTimeout(autosaveTimer);
  autosaveTimer = setTimeout(() => doAutosave(state, canvasW, canvasH), delayMs);
}

function doAutosave(state, canvasW, canvasH) {
  try {
    const data = serializeProject(state, canvasW, canvasH);
    const json = JSON.stringify({ savedAt: Date.now(), data });
    if (json.length > AUTOSAVE_MAX_BYTES) {
      // Too big to fit — drop any prior autosave so we don't restore a stale one.
      try { localStorage.removeItem(AUTOSAVE_KEY); } catch {}
      return;
    }
    localStorage.setItem(AUTOSAVE_KEY, json);
  } catch (e) {
    // Quota exceeded or storage disabled — fail silently.
  }
}

export function readAutosave() {
  try {
    const raw = localStorage.getItem(AUTOSAVE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    return parsed; // { savedAt, data }
  } catch {
    return null;
  }
}

export function clearAutosave() {
  try { localStorage.removeItem(AUTOSAVE_KEY); } catch {}
}
