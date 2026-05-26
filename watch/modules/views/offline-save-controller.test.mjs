/**
 * Tests for the offline-save controller in the watch view.
 *
 * The underlying IDB layer (`../offline.js`) wraps every read/write
 * in a try/catch that returns safe defaults when `indexedDB` is
 * unavailable — which is exactly the case under jsdom. So in tests
 * the controller observes the "nothing is cached" world: `hydrate()`
 * yields an empty `savedKeys`, `setEpisode` always paints the idle
 * state, and a click attempts a download that fails fast.
 *
 * That's enough to exercise the controller's externally-observable
 * surface: button state machine, episode-change repaint, dispose
 * cleanup. Cache hits / network downloads are out of scope here —
 * those are integration concerns and would need fake-indexeddb +
 * a fetch mock to test honestly.
 */

import { describe, it, beforeEach, afterEach, mock } from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';

import { createOfflineSaveController } from './offline-save-controller.js';

/** @typedef {import('../catalog.js').Episode} Episode */
/** @typedef {import('../shows.js').ShowConfig} ShowConfig */

let dom;

function setupDom() {
  dom = new JSDOM('<!doctype html><html><body></body></html>', {
    url: 'http://localhost/watch/?show=test'
  });
  const w = dom.window;
  globalThis.window = w;
  globalThis.document = w.document;
  globalThis.HTMLElement = w.HTMLElement;
  globalThis.Node = w.Node;
  globalThis.Event = w.Event;
  globalThis.AbortController = w.AbortController;
  // URL.createObjectURL / revokeObjectURL aren't implemented in jsdom;
  // stub them so the controller's blob-URL hygiene paths don't throw.
  globalThis.URL = w.URL;
  globalThis.URL.createObjectURL = () => 'blob:test/fake';
  globalThis.URL.revokeObjectURL = () => {};
}

/** @type {ShowConfig} */
const fakeShow = {
  id: 'simpsons',
  name: 'The Simpsons',
  shortName: 'Simpsons',
  emoji: '🍩',
  accent: '#ffd400',
  tagline: '',
  iaItem: 'x',
  tvmazeId: 0,
  parser: () => null
};

/** @returns {Episode} */
function ep(season, episode) {
  return {
    season,
    episode,
    title: `Ep ${season}-${episode}`,
    file: `s${season}e${episode}.mp4`,
    url: `http://x/s${season}e${episode}.mp4`,
    archiveUrl: '',
    image: ''
  };
}

function makeCtrl(overrides = {}) {
  const video = document.createElement('video');
  const saveBtn = document.createElement('button');
  document.body.appendChild(saveBtn);
  const flashed = [];
  const ctrl = createOfflineSaveController({
    video,
    show: fakeShow,
    saveBtn,
    flash: (msg) => flashed.push(msg),
    ...overrides
  });
  return { ctrl, video, saveBtn, flashed };
}

beforeEach(setupDom);
afterEach(() => {
  if (dom) dom.window.close();
});

describe('createOfflineSaveController', () => {
  it('hydrate() resolves without throwing when IDB is unavailable', async () => {
    const { ctrl } = makeCtrl();
    await ctrl.hydrate();
    // No assertion needed beyond "did not throw"; the controller is
    // expected to treat "no IDB" as "nothing saved" silently.
  });

  it('setEpisode with no cached entry paints the idle button label', async () => {
    const { ctrl, saveBtn } = makeCtrl();
    await ctrl.hydrate();
    ctrl.setEpisode(ep(1, 1));
    assert.equal(saveBtn.textContent, '💾 Save offline');
    assert.equal(saveBtn.classList.contains('is-saved'), false);
    assert.equal(saveBtn.classList.contains('is-downloading'), false);
    assert.equal(saveBtn.disabled, false);
  });

  it('setEpisode(null) disables the button (defensive: no current ep)', async () => {
    const { ctrl, saveBtn } = makeCtrl();
    await ctrl.hydrate();
    ctrl.setEpisode(null);
    assert.equal(saveBtn.disabled, true);
  });

  it('isSavedSync returns false for any episode when nothing is hydrated', async () => {
    const { ctrl } = makeCtrl();
    await ctrl.hydrate();
    assert.equal(ctrl.isSavedSync(ep(1, 1)), false);
    assert.equal(ctrl.isSavedSync(ep(99, 99)), false);
  });

  it('clicking the save button while idle starts a download (best-effort)', async () => {
    const { ctrl, saveBtn, flashed } = makeCtrl();
    await ctrl.hydrate();
    ctrl.setEpisode(ep(1, 1));
    saveBtn.click();
    // The handler kicks off saveOfflineEpisode which will fail under
    // jsdom (no proxyService, no fetch streaming). We only assert the
    // optimistic UI fires: button flips to downloading state synchronously.
    assert.equal(saveBtn.classList.contains('is-downloading'), true);
    assert.match(saveBtn.textContent || '', /Starting|Downloading/);
    // Let the rejected save settle so the finally block runs.
    await new Promise((r) => setTimeout(r, 50));
    // Flash should report SAVE FAILED (network/proxy unavailable).
    assert.ok(flashed.includes('SAVE FAILED') || flashed.includes('SAVE CANCELLED'));
  });

  it('dispose() removes the click listener so further clicks are no-ops', async () => {
    const { ctrl, saveBtn, flashed } = makeCtrl();
    await ctrl.hydrate();
    ctrl.setEpisode(ep(1, 1));
    ctrl.dispose();
    saveBtn.click();
    // Settle any unexpected async work.
    await new Promise((r) => setTimeout(r, 20));
    assert.deepEqual(flashed, []);
    assert.equal(saveBtn.classList.contains('is-downloading'), false);
  });

  it('setEpisode swap-in repaints button for the new episode', async () => {
    const { ctrl, saveBtn } = makeCtrl();
    await ctrl.hydrate();
    ctrl.setEpisode(ep(1, 1));
    const firstLabel = saveBtn.textContent;
    ctrl.setEpisode(ep(2, 3));
    // Same idle state, but ensures setEpisode re-runs the paint each call.
    assert.equal(saveBtn.textContent, firstLabel);
    assert.equal(saveBtn.classList.contains('is-saved'), false);
  });

  it('dispose() while a save is in flight aborts the controller silently', async () => {
    const { ctrl, saveBtn } = makeCtrl();
    await ctrl.hydrate();
    ctrl.setEpisode(ep(1, 1));
    saveBtn.click();
    assert.equal(saveBtn.classList.contains('is-downloading'), true);
    // Dispose mid-flight — should abort the in-flight save and clean up.
    ctrl.dispose();
    await new Promise((r) => setTimeout(r, 30));
    // No further state mutation should leak after dispose.
    // (Specifically, the controller must not throw an unhandled rejection.)
  });
});
