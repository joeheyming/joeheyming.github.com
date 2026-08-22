// doom/play-help.js — the dismissable "How to play" card.
//
// The card covers the bottom-left of the canvas, so returning players need
// to be able to put it away and have it stay away. Storage can throw in
// private mode; the card must still toggle when it does.

import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { JSDOM } from 'jsdom';

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), '..');
const source = readFileSync(join(repoRoot, 'doom/play-help.js'), 'utf8');

const MARKUP = `<!doctype html><html><body>
  <aside id="playHelp" class="play-help">
    <button type="button" id="playHelpClose">x</button>
    <p class="play-help-title">How to play</p>
  </aside>
  <button type="button" id="playHelpOpen" class="play-help-open" hidden>Controls</button>
</body></html>`;

/** Fresh document + storage, then run play-help.js against it. */
function boot({ seedHidden = false, brokenStorage = false } = {}) {
  const dom = new JSDOM(MARKUP, { url: 'https://joeheyming.github.io/doom/' });
  const { window } = dom;

  if (brokenStorage) {
    Object.defineProperty(window, 'localStorage', {
      get() {
        throw new Error('storage disabled');
      }
    });
  } else if (seedHidden) {
    window.localStorage.setItem('doom:play-help-hidden', '1');
  }

  new Function('window', 'document', source)(window, window.document);

  const $ = (id) => window.document.getElementById(id);
  return { window, card: $('playHelp'), closeBtn: $('playHelpClose'), openBtn: $('playHelpOpen') };
}

describe('doom play-help card', () => {
  let ctx;
  beforeEach(() => {
    ctx = boot();
  });

  it('starts visible for a first-time player', () => {
    assert.equal(ctx.card.hidden, false);
    assert.equal(ctx.openBtn.hidden, true);
  });

  it('hides the card and offers the Controls chip when dismissed', () => {
    ctx.closeBtn.click();
    assert.equal(ctx.card.hidden, true);
    assert.equal(ctx.openBtn.hidden, false);
  });

  it('persists the dismissal so it survives a reload', () => {
    ctx.closeBtn.click();
    assert.equal(ctx.window.localStorage.getItem('doom:play-help-hidden'), '1');

    const reloaded = boot({ seedHidden: true });
    assert.equal(reloaded.card.hidden, true);
    assert.equal(reloaded.openBtn.hidden, false);
  });

  it('restores the card and clears the flag when brought back', () => {
    ctx.closeBtn.click();
    ctx.openBtn.click();
    assert.equal(ctx.card.hidden, false);
    assert.equal(ctx.openBtn.hidden, true);
    assert.equal(ctx.window.localStorage.getItem('doom:play-help-hidden'), null);
  });

  it('still toggles when localStorage throws', () => {
    const broken = boot({ brokenStorage: true });
    assert.equal(broken.card.hidden, false);
    broken.closeBtn.click();
    assert.equal(broken.card.hidden, true);
    assert.equal(broken.openBtn.hidden, false);
  });
});
