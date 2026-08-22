// The <share-button> label once rendered invisible on /periodic-speller/,
// where the button sits inside a gradient <h1> that sets
// `-webkit-text-fill-color: transparent`. That property is inherited and
// crosses the shadow boundary, so the shadow DOM needs its own reset.
//
// This used to be a 25-page Playwright sweep. Inheritance is a browser
// guarantee, so the thing actually worth pinning is that share.js still
// ships the reset — that is a source-level fact, checked here.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { JSDOM } from 'jsdom';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

/** Renders a <share-button> in jsdom and returns its shadow root. */
function renderShareButton() {
  const dom = new JSDOM('<!doctype html><html><body></body></html>', {
    runScripts: 'outside-only',
    url: 'https://joeheyming.github.io/periodic-speller/'
  });

  // The related-projects widget in share.js fetches apps-registry.json on
  // load. It is irrelevant to the button's styling; stub it so the test
  // does not depend on the network or log a failed load.
  dom.window.fetch = () => Promise.resolve({ ok: true, json: () => Promise.resolve([]) });
  // Related-projects may load registry-path; CE tests do not need it.
  dom.window.HeymingRegistryPath = {
    resolveAppIdFromLocation: () => 'periodic-speller'
  };

  dom.window.eval(readFileSync(path.join(ROOT, 'share.js'), 'utf8'));

  const element = dom.window.document.createElement('share-button');
  dom.window.document.body.appendChild(element);

  return element.shadowRoot;
}

test('share-button resets the inherited text fill color on :host', () => {
  const shadowRoot = renderShareButton();
  assert.ok(shadowRoot, 'share-button should attach a shadow root');

  const css = shadowRoot.querySelector('style')?.textContent ?? '';
  const hostRule = /:host\s*\{([^}]*)\}/.exec(css);

  assert.ok(hostRule, ':host rule should exist in the shadow styles');
  assert.match(
    hostRule[1],
    /-webkit-text-fill-color:\s*currentColor/i,
    ':host must reset -webkit-text-fill-color so gradient-text ancestors cannot ' +
      'make the label invisible'
  );
});

test('share-button renders a labelled button', () => {
  const shadowRoot = renderShareButton();
  const button = shadowRoot.querySelector('.share-btn');

  assert.ok(button, 'shadow root should contain the share button');
  assert.ok((button.textContent || '').trim().length > 0, 'button should carry a visible label');
});
