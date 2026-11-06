import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

const ORT_BUNDLE =
  'https://cdn.jsdelivr.net/npm/onnxruntime-web@1.22.0-dev.20250409-89f8206ba4/dist/ort.webgpu.bundle.min.mjs';

describe('imagine import map', () => {
  it('resolves both ONNX specifiers to one WebGPU bundle', () => {
    const html = readFileSync(path.join(ROOT, 'imagine/index.html'), 'utf8');
    const raw = html.match(/<script type="importmap">([\s\S]*?)<\/script>/);
    assert.ok(raw, 'import map present');
    const map = JSON.parse(raw[1]);
    assert.equal(map.imports['onnxruntime-common'], ORT_BUNDLE);
    assert.equal(map.imports['onnxruntime-web'], ORT_BUNDLE);
    assert.equal(map.imports['onnxruntime-web/webgpu'], ORT_BUNDLE);
    assert.match(
      map.imports['@huggingface/transformers'],
      /@huggingface\/transformers@3\.8\.1\/dist\/transformers\.web\.js$/
    );
  });
});
