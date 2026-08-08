// Verifies posts/textfilter.js CDN remapping and live model classify.
// Needs network (esm.sh + model weights) and Chromium.

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';
import { TOXICITY_URL } from '../posts/textfilter.js';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');

/**
 * @param {number} port
 * @returns {Promise<http.Server>}
 */
function servePosts(port) {
  const postsDir = path.join(ROOT, 'posts');
  const server = http.createServer(async (req, res) => {
    const urlPath = (req.url || '/').split('?')[0];
    if (urlPath === '/' || urlPath === '/harness.html') {
      res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
      res.end('<!doctype html><title>textfilter harness</title>');
      return;
    }
    if (urlPath === '/textfilter.js') {
      const body = await readFile(path.join(postsDir, 'textfilter.js'));
      res.writeHead(200, { 'content-type': 'text/javascript; charset=utf-8' });
      res.end(body);
      return;
    }
    res.writeHead(404);
    res.end('not found');
  });
  return new Promise((resolve, reject) => {
    server.listen(port, '127.0.0.1', () => resolve(server));
    server.on('error', reject);
  });
}

describe('posts/textfilter.js', () => {
  it('esm.sh stub remaps toxicity onto tfjs-core/converter 4.22.0', async () => {
    const res = await fetch(TOXICITY_URL);
    assert.equal(res.ok, true, `HTTP ${res.status} for ${TOXICITY_URL}`);
    const stub = await res.text();
    assert.match(stub, /@tensorflow\/tfjs-core@4\.22\.0/);
    assert.match(stub, /@tensorflow\/tfjs-converter@4\.22\.0/);
    assert.doesNotMatch(stub, /@tensorflow\/tfjs-core@\^1/);
  });

  it('loads in Chromium and blocks toxic text', { timeout: 120_000 }, async () => {
    const port = 18765;
    const server = await servePosts(port);
    const browser = await chromium.launch();
    try {
      const page = await browser.newPage();
      await page.goto(`http://127.0.0.1:${port}/harness.html`);
      const result = await page.evaluate(async () => {
        const mod = await import('/textfilter.js');
        const safe = await mod.matchingToxicityLabels('Have a nice day');
        const toxic = await mod.matchingToxicityLabels('you are an idiot and I hate you');
        let blocked = false;
        try {
          await mod.assertTextSafe('you are an idiot and I hate you');
        } catch {
          blocked = true;
        }
        return { safe, toxic, blocked };
      });
      assert.deepEqual(result.safe, []);
      assert.ok(result.toxic.includes('toxicity'), JSON.stringify(result.toxic));
      assert.equal(result.blocked, true);
    } finally {
      await browser.close();
      await new Promise((resolve) => server.close(resolve));
    }
  });
});
