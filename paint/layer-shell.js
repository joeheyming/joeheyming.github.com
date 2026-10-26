// Pixel layer shell — canvas + id + shared fields. Kind Modules wrap this; the Layers panel
// consumes finished layers. No kind imports here (avoids cycles with fill/type/shape/…).

let nextLayerId = 1;

/** Reset id counter (tests). */
export function resetLayerIds(next = 1) {
  nextLayerId = next;
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
    // 'pixel', 'adjustment', 'fill', 'smart', 'type', 'shape', or 'group' — set by kind factories.
    kind: 'pixel',
    parentId: null,
    canvas,
    ctx,
    opacity: 1,
    visible: true,
    blendMode: 'source-over',
    background: false,
    clipped: false,
    locks: { transparency: false, pixels: false, position: false, all: false },
    mask: null,
    maskEnabled: true,
    maskCanvas: null,
    maskCtx: null,
    maskUrl: null,
    vectorMask: null,
    styles: null
  };
}
