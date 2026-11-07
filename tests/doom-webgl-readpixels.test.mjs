import assert from 'node:assert/strict';
import { test } from 'node:test';
import { fileURLToPath, pathToFileURL } from 'node:url';
import path from 'node:path';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const MODULE_URL = pathToFileURL(path.join(ROOT, 'doom/webgl-readpixels.js')).href;

const GL_RGB = 0x1907;
const GL_RGBA = 0x1908;
const GL_UNSIGNED_BYTE = 0x1401;
const GL_PACK_ALIGNMENT = 0x0d05;

async function loadModule() {
  return import(`${MODULE_URL}?test=${Date.now()}-${Math.random()}`);
}

/**
 * A stand-in context. RGBA reads paint pixel (col, row) as [col, row, 9, 255].
 * @param {number} [alignment]
 */
function fakeContext(alignment = 1) {
  const calls = [];
  const stores = [];
  const proto = {
    readPixels(x, y, width, height, format, type, dst) {
      calls.push({ x, y, width, height, format, type, dst });
      if (!(dst instanceof Uint8Array)) return;
      for (let row = 0; row < height; row++) {
        for (let col = 0; col < width; col++) {
          const i = (row * width + col) * 4;
          dst[i] = col;
          dst[i + 1] = row;
          dst[i + 2] = 9;
          dst[i + 3] = 255;
        }
      }
    },
    getParameter(pname) {
      return pname === GL_PACK_ALIGNMENT ? alignment : 0;
    },
    pixelStorei(pname, value) {
      stores.push([pname, value]);
      if (pname === GL_PACK_ALIGNMENT) alignment = value;
    }
  };
  return { proto, calls, stores, alignment: () => alignment };
}

test('RGB reads are fetched as RGBA and packed without the alpha byte', async () => {
  const { installWebGLReadPixelsShim } = await loadModule();
  const { proto, calls } = fakeContext(1);
  installWebGLReadPixelsShim([proto]);

  const heap = new Uint8Array(16);
  heap.fill(0xab);
  proto.readPixels(0, 0, 2, 2, GL_RGB, GL_UNSIGNED_BYTE, heap, 4);

  assert.equal(calls.length, 1);
  assert.equal(calls[0].format, GL_RGBA);
  assert.equal(calls[0].type, GL_UNSIGNED_BYTE);
  assert.ok(calls[0].dst instanceof Uint8Array);
  assert.notEqual(calls[0].dst, heap);
  assert.deepEqual([...heap], [0xab, 0xab, 0xab, 0xab, 0, 0, 9, 1, 0, 9, 0, 1, 9, 1, 1, 9]);
});

test('pack alignment 4 pads each RGB row', async () => {
  const { installWebGLReadPixelsShim } = await loadModule();
  const { proto, stores } = fakeContext(4);
  installWebGLReadPixelsShim([proto]);

  const heap = new Uint8Array(8);
  heap.fill(0xab);
  proto.readPixels(0, 0, 1, 2, GL_RGB, GL_UNSIGNED_BYTE, heap, 0);

  assert.deepEqual([...heap], [0, 0, 9, 0xab, 0, 1, 9, 0xab]);
  assert.deepEqual(stores, [
    [GL_PACK_ALIGNMENT, 1],
    [GL_PACK_ALIGNMENT, 4]
  ]);
});

test('RGBA reads are passed through unchanged', async () => {
  const { installWebGLReadPixelsShim } = await loadModule();
  const { proto, calls } = fakeContext(1);
  installWebGLReadPixelsShim([proto]);

  const heap = new Uint8Array(8);
  proto.readPixels(1, 2, 2, 1, GL_RGBA, GL_UNSIGNED_BYTE, heap, 0);

  assert.equal(calls.length, 1);
  assert.equal(calls[0].format, GL_RGBA);
  assert.equal(calls[0].dst, heap);
  assert.deepEqual([...heap], [0, 0, 9, 255, 1, 0, 9, 255]);
});

test('installing twice does not pack the pixels twice', async () => {
  const { installWebGLReadPixelsShim } = await loadModule();
  const { proto } = fakeContext(1);
  installWebGLReadPixelsShim([proto]);
  installWebGLReadPixelsShim([proto]);

  const heap = new Uint8Array(6);
  proto.readPixels(0, 0, 2, 1, GL_RGB, GL_UNSIGNED_BYTE, heap, 0);
  assert.deepEqual([...heap], [0, 0, 9, 1, 0, 9]);
});
