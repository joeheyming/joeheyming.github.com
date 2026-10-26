import { test } from 'node:test';
import assert from 'node:assert/strict';

// createLayer needs document.createElement('canvas') with a 2D context.
// A tiny ImageData-backed stub keeps this test browser-free.
function fakeCanvas() {
  const canvas = {
    width: 0,
    height: 0,
    className: '',
    dataset: {},
    style: {},
    pixels: null,
    getContext() {
      return ctx;
    }
  };
  const ensure = () => {
    if (!canvas.pixels || canvas.pixels.length !== canvas.width * canvas.height * 4) {
      canvas.pixels = new Uint8ClampedArray(canvas.width * canvas.height * 4);
    }
  };
  const ctx = {
    getImageData(x, y, w, h) {
      ensure();
      return { width: w, height: h, data: canvas.pixels.slice() };
    },
    putImageData(img) {
      ensure();
      canvas.pixels.set(img.data);
    },
    globalAlpha: 1,
    globalCompositeOperation: 'source-over',
    saved: [],
    drawCalls: [],
    save() {
      this.saved.push([this.globalAlpha, this.globalCompositeOperation]);
    },
    restore() {
      [this.globalAlpha, this.globalCompositeOperation] = this.saved.pop();
    },
    // Straight-alpha source-over; other modes are only recorded.
    drawImage(srcCanvas) {
      ensure();
      this.drawCalls.push({ alpha: this.globalAlpha, op: this.globalCompositeOperation });
      const s = srcCanvas.pixels;
      const d = canvas.pixels;
      for (let i = 0; i < d.length; i += 4) {
        const sa = (s[i + 3] / 255) * this.globalAlpha;
        const da = d[i + 3] / 255;
        const oa = sa + da * (1 - sa);
        for (let c = 0; c < 3; c++) {
          d[i + c] = oa ? (s[i + c] * sa + d[i + c] * da * (1 - sa)) / oa : 0;
        }
        d[i + 3] = oa * 255;
      }
    }
  };
  return canvas;
}

globalThis.document = { createElement: () => fakeCanvas() };

const { createLayer, copyLayerContents, compositeLayerOnto, canMergeDown } = await import(
  '../paint/layers.js'
);

test('copyLayerContents copies pixels and layer properties, leaving the source intact', () => {
  const src = createLayer('Layer 1', 4, 3);
  const img = src.ctx.getImageData(0, 0, 4, 3);
  for (let i = 0; i < img.data.length; i++) img.data[i] = (i * 7) % 256;
  src.ctx.putImageData(img, 0, 0);
  src.opacity = 0.4;
  src.visible = false;
  src.blendMode = 'multiply';
  const srcBefore = src.ctx.getImageData(0, 0, 4, 3).data;

  const copy = createLayer(`${src.name} copy`, 4, 3);
  copyLayerContents(src, copy);

  assert.equal(copy.name, 'Layer 1 copy');
  assert.notEqual(copy.id, src.id);
  assert.deepEqual(copy.ctx.getImageData(0, 0, 4, 3).data, srcBefore);
  assert.equal(copy.opacity, 0.4);
  assert.equal(copy.visible, false);
  assert.equal(copy.blendMode, 'multiply');

  // Editing the copy does not touch the source
  const edit = copy.ctx.getImageData(0, 0, 4, 3);
  edit.data.fill(255);
  copy.ctx.putImageData(edit, 0, 0);
  assert.deepEqual(src.ctx.getImageData(0, 0, 4, 3).data, srcBefore);
  assert.equal(src.opacity, 0.4);
  assert.equal(src.blendMode, 'multiply');
});

function fillLayer(layer, rgba) {
  const { width, height } = layer.canvas;
  const img = layer.ctx.getImageData(0, 0, width, height);
  for (let i = 0; i < img.data.length; i += 4) img.data.set(rgba, i);
  layer.ctx.putImageData(img, 0, 0);
}

test('compositeLayerOnto blends the source onto the destination with its opacity and mode', () => {
  const dst = createLayer('Bottom', 2, 2);
  const src = createLayer('Top', 2, 2);
  fillLayer(dst, [0, 0, 255, 255]);
  fillLayer(src, [255, 0, 0, 255]);
  src.opacity = 0.5;
  src.blendMode = 'multiply';

  const out = compositeLayerOnto(src, dst);

  assert.equal(out, dst);
  assert.deepEqual(dst.ctx.drawCalls, [{ alpha: 0.5, op: 'multiply' }]);
  // Context state is restored after the merge
  assert.equal(dst.ctx.globalAlpha, 1);
  assert.equal(dst.ctx.globalCompositeOperation, 'source-over');

  src.blendMode = 'source-over';
  fillLayer(dst, [0, 0, 255, 255]);
  compositeLayerOnto(src, dst);
  const px = dst.ctx.getImageData(0, 0, 2, 2).data;
  assert.deepEqual([...px.slice(0, 4)], [128, 0, 128, 255]);
});

test('compositeLayerOnto leaves the destination unchanged for a hidden source', () => {
  const dst = createLayer('Bottom', 2, 2);
  const src = createLayer('Top', 2, 2);
  fillLayer(dst, [10, 20, 30, 255]);
  fillLayer(src, [255, 255, 255, 255]);
  src.visible = false;
  const before = dst.ctx.getImageData(0, 0, 2, 2).data;

  compositeLayerOnto(src, dst);

  assert.deepEqual(dst.ctx.getImageData(0, 0, 2, 2).data, before);
  assert.equal(dst.ctx.drawCalls.length, 0);
});

test('canMergeDown is false for the bottom layer and out-of-range indexes', () => {
  const layers = [createLayer('A', 1, 1), createLayer('B', 1, 1)];
  assert.equal(canMergeDown(layers, 0), false);
  assert.equal(canMergeDown(layers, 1), true);
  assert.equal(canMergeDown(layers, 2), false);
  assert.equal(canMergeDown(layers, -1), false);
  assert.equal(canMergeDown([layers[0]], 0), false);
});
