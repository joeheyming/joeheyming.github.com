import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { IMAGE_MODELS, IMAGINE_DEFAULT_MODEL } from '../imagine/diffusion-adapter.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

describe('imagine models', () => {
  it('offers Janus-Pro by default and SD-Turbo with a seed', () => {
    assert.equal(IMAGINE_DEFAULT_MODEL, 'janus-pro-1b');
    assert.deepEqual(Object.keys(IMAGE_MODELS), ['janus-pro-1b', 'sd-turbo']);
    assert.equal(IMAGE_MODELS['janus-pro-1b'].supportsSeed, false);
    assert.equal(IMAGE_MODELS['janus-pro-1b'].sizePx, 384);
    assert.equal(IMAGE_MODELS['sd-turbo'].supportsSeed, true);
    assert.equal(IMAGE_MODELS['sd-turbo'].supportsImage, true);
    assert.equal(IMAGE_MODELS['janus-pro-1b'].supportsImage, false);
    assert.equal(IMAGE_MODELS['sd-turbo'].sizePx, 512);
    assert.equal(IMAGE_MODELS['sd-turbo'].runtime, 'web-txt2img');
  });

  it('hides the seed controls until a seed-capable model is selected', () => {
    const html = readFileSync(path.join(ROOT, 'imagine/index.html'), 'utf8');
    assert.match(html, /id="imagine-model"/);
    assert.match(html, /id="imagine-seed-label"[\s\S]*?hidden/);
    assert.match(html, /id="imagine-seed-random"[\s\S]*?hidden/);
    const js = readFileSync(path.join(ROOT, 'imagine/index.js'), 'utf8');
    assert.match(js, /els\.seedLabel\.hidden = !info\.supportsSeed/);
    assert.match(html, /id="imagine-source"[\s\S]*?hidden/);
    assert.match(js, /els\.source\.hidden = !info\.supportsImage/);
    assert.match(html, /id="imagine-use-source-btn"/);
    assert.match(js, /els\.useSourceBtn\.addEventListener\('click', useCurrentAsSource\)/);
  });
});
