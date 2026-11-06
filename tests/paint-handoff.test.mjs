import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { HANDOFF_TTL_MS, isFreshHandoff } from '../paint-handoff.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const NOW = 1_700_000_000_000;

describe('paint handoff freshness', () => {
  const blob = new Blob(['png'], { type: 'image/png' });

  it('accepts a staged image inside the TTL', () => {
    assert.equal(isFreshHandoff({ blob, fileName: 'a.png', createdAt: NOW }, NOW), true);
    assert.equal(
      isFreshHandoff({ blob, fileName: 'a.png', createdAt: NOW - HANDOFF_TTL_MS }, NOW),
      true
    );
  });

  it('rejects an expired staged image', () => {
    assert.equal(
      isFreshHandoff({ blob, fileName: 'a.png', createdAt: NOW - HANDOFF_TTL_MS - 1 }, NOW),
      false
    );
  });

  it('rejects a record from the future (clock skew or corruption)', () => {
    assert.equal(isFreshHandoff({ blob, fileName: 'a.png', createdAt: NOW + 5000 }, NOW), false);
  });

  it('rejects empty, malformed, or non-blob records', () => {
    assert.equal(isFreshHandoff(null, NOW), false);
    assert.equal(isFreshHandoff(undefined, NOW), false);
    assert.equal(isFreshHandoff('png', NOW), false);
    assert.equal(isFreshHandoff({ fileName: 'a.png', createdAt: NOW }, NOW), false);
    assert.equal(isFreshHandoff({ blob: 'not-a-blob', createdAt: NOW }, NOW), false);
    assert.equal(isFreshHandoff({ blob, fileName: 'a.png', createdAt: 'soon' }, NOW), false);
  });
});

describe('imagine hands off to paint', () => {
  it('has an Open in Paint button next to Download', () => {
    const html = readFileSync(path.join(ROOT, 'imagine/index.html'), 'utf8');
    const download = html.indexOf('id="imagine-download-btn"');
    const paint = html.indexOf('id="imagine-paint-btn"');
    const reuse = html.indexOf('id="imagine-reuse-btn"');
    assert.ok(download > 0 && paint > download && reuse > paint);
  });

  it('paint boots by placing a staged image after the restore prompt', () => {
    const js = readFileSync(path.join(ROOT, 'paint/paint.js'), 'utf8');
    assert.match(js, /import \{ takeStagedImage \} from '\/paint-handoff\.js'/);
    assert.match(js, /\.then\(\(\) => placeStagedImage\(\)\)/);
    assert.match(js, /\(\) => \{\s*clearAutosave\(\);\s*void placeStagedImage\(\);\s*\}/);
  });
});
