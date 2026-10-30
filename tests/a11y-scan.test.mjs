import assert from 'node:assert/strict';
import { test } from 'node:test';

import { auditHtml } from '../scripts/a11y-scan.mjs';

const sound = `<!doctype html>
<html lang="en">
  <head><title>Sound page</title></head>
  <body>
    <main>
      <h1>Sound page</h1>
      <button type="button">Play</button>
      <a href="/os/">Open the OS</a>
      <img src="cat.png" alt="A cat">
      <label>Name <input type="text"></label>
    </main>
  </body>
</html>`;

const broken = `<!doctype html>
<html>
  <head></head>
  <body>
    <img src="cat.png">
    <button type="button"></button>
    <a href="/os/"></a>
    <input type="text">
  </body>
</html>`;

test('a named page passes the rules axe can check without layout', async () => {
  const hits = await auditHtml(sound, 'sound/index.html');
  assert.deepEqual(
    hits.map((hit) => hit.id),
    []
  );
});

test('unnamed controls, images, and a missing title are reported', async () => {
  const hits = await auditHtml(broken, 'broken/index.html');
  const ids = hits.map((hit) => hit.id).sort();
  for (const id of ['button-name', 'document-title', 'image-alt', 'label', 'link-name']) {
    assert.ok(ids.includes(id), id);
  }
  const button = hits.find((hit) => hit.id === 'button-name');
  assert.equal(button && button.impact, 'critical');
  assert.equal(button && button.file, 'broken/index.html');
});

test('a script mention inside a comment does not hide the title', async () => {
  const hits = await auditHtml(
    `<!doctype html>
<html lang="en">
  <head>
    <!-- loaded via <script> below. -->
    <script src="/analytics.js"></script>
    <title>Still here</title>
  </head>
  <body><main><h1>Still here</h1></main></body>
</html>`,
    'home/index.html'
  );
  assert.equal(
    hits.some((hit) => hit.id === 'document-title'),
    false
  );
});

test('page scripts are not executed', async () => {
  const hits = await auditHtml(
    `${sound}<script>throw new Error('should not run')</script>`,
    'sound/index.html'
  );
  assert.deepEqual(
    hits.map((hit) => hit.id),
    []
  );
});
