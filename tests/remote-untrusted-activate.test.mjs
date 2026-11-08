import assert from 'node:assert/strict';
import { test } from 'node:test';
import { JSDOM } from 'jsdom';
import { pathToFileURL, fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const HREF = pathToFileURL(join(dirname(fileURLToPath(import.meta.url)), '..', 'remote.js')).href;

test('an untrusted Enter activates the focused control', async () => {
  const dom = new JSDOM('<!doctype html><body><button id="go">Go</button></body>', {
    url: 'https://joeheyming.github.io/'
  });
  globalThis.window = dom.window;
  globalThis.document = dom.window.document;
  globalThis.getComputedStyle = dom.window.getComputedStyle.bind(dom.window);
  await import(HREF + '?remote-untrusted=1');

  let clicks = 0;
  const button = dom.window.document.getElementById('go');
  button.addEventListener('click', () => {
    clicks += 1;
  });
  button.focus();
  button.dispatchEvent(
    new dom.window.KeyboardEvent('keydown', {
      key: 'Enter',
      bubbles: true,
      cancelable: true
    })
  );
  assert.equal(clicks, 1);

  button.dispatchEvent(
    new dom.window.KeyboardEvent('keydown', {
      key: ' ',
      bubbles: true,
      cancelable: true
    })
  );
  assert.equal(clicks, 1);

  let backs = 0;
  dom.window.history.back = () => {
    backs += 1;
  };
  button.dispatchEvent(
    new dom.window.KeyboardEvent('keydown', {
      key: 'Escape',
      bubbles: true,
      cancelable: true
    })
  );
  assert.equal(backs, 1);

  button.addEventListener('keydown', (event) => event.preventDefault(), { once: true });
  button.dispatchEvent(
    new dom.window.KeyboardEvent('keydown', {
      key: 'Escape',
      bubbles: true,
      cancelable: true
    })
  );
  assert.equal(backs, 1);

  const field = dom.window.document.createElement('input');
  field.value = 'zelda';
  dom.window.document.body.appendChild(field);
  field.focus();
  field.dispatchEvent(
    new dom.window.KeyboardEvent('keydown', {
      key: 'Escape',
      bubbles: true,
      cancelable: true
    })
  );
  assert.equal(backs, 1);

  const dialog = dom.window.document.createElement('div');
  dialog.setAttribute('role', 'dialog');
  dialog.setAttribute('aria-modal', 'true');
  dom.window.document.body.appendChild(dialog);
  button.focus();
  button.dispatchEvent(
    new dom.window.KeyboardEvent('keydown', {
      key: 'Escape',
      bubbles: true,
      cancelable: true
    })
  );
  assert.equal(backs, 1);

  dom.window.close();
});
