/**
 * Tests for the subtitle controller in the watch view.
 *
 * Focuses on the synchronous UI surface — the offset slider/readout
 * loop, the CC button toggle, episode-change teardown, and dispose.
 *
 * The network-bound paths (Stremio search, SRT→VTT conversion) live
 * in `../subtitles.js` and are unit-tested there with pure fixtures.
 * The controller's auto-load and language-menu paths talk to the
 * real `searchSubtitles` here; we steer around them by either
 * configuring an unloaded preference (no auto-load) or omitting the
 * imdbId on the show (the menu refuses to open at all).
 */

import { describe, it, beforeEach, afterEach, mock } from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';

import { createSubtitleController } from './subtitle-controller.js';

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
  globalThis.URL = w.URL;
  globalThis.URL.createObjectURL = () => 'blob:test/fake';
  globalThis.URL.revokeObjectURL = () => {};
}

/** A show with NO imdbId — the menu refuses to open, auto-load is a no-op. */
/** @type {ShowConfig} */
const noImdbShow = {
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

/**
 * Build the minimal subtitle DOM that mount() would normally hand
 * the controller. Returns the wrap element + a refs bundle.
 */
function buildDom() {
  const subsWrap = document.createElement('div');
  subsWrap.className = 'tv-subs-wrap';
  const subsBtn = document.createElement('button');
  subsBtn.textContent = 'CC';
  const subsMenu = document.createElement('div');
  subsMenu.className = 'tv-subs-menu hidden';
  subsWrap.appendChild(subsBtn);
  subsWrap.appendChild(subsMenu);

  const subsSyncWrap = document.createElement('div');
  subsSyncWrap.className = 'tv-subs-sync hidden';
  const subsSyncSlider = document.createElement('input');
  subsSyncSlider.type = 'range';
  subsSyncSlider.min = '-10';
  subsSyncSlider.max = '10';
  subsSyncSlider.step = '0.5';
  subsSyncSlider.value = '0';
  const subsSyncReadout = document.createElement('button');
  subsSyncReadout.type = 'button';
  subsSyncReadout.textContent = '0.0s';
  subsSyncWrap.appendChild(subsSyncSlider);
  subsSyncWrap.appendChild(subsSyncReadout);

  document.body.appendChild(subsWrap);
  document.body.appendChild(subsSyncWrap);

  return {
    dom: { subsBtn, subsMenu, subsWrap, subsSyncWrap, subsSyncSlider, subsSyncReadout }
  };
}

function makeCtrl(overrides = {}) {
  const { dom: domRefs } = buildDom();
  const video = document.createElement('video');
  const prefs = { autoplayNext: true, shuffle: false, subtitleLang: null };
  const savedPrefs = [];
  const flashed = [];
  const ctrl = createSubtitleController({
    video,
    show: noImdbShow,
    prefs,
    savePrefs: (p) => savedPrefs.push({ ...p }),
    flash: (m) => flashed.push(m),
    dom: domRefs,
    ...overrides
  });
  return { ctrl, video, prefs, savedPrefs, flashed, dom: domRefs };
}

beforeEach(setupDom);
afterEach(() => {
  if (dom) dom.window.close();
});

describe('createSubtitleController — offset slider', () => {
  it('dragging the slider updates the offset readout', () => {
    const { dom: d } = makeCtrl();
    d.subsSyncSlider.value = '2.5';
    d.subsSyncSlider.dispatchEvent(new window.Event('input'));
    assert.equal(d.subsSyncReadout.textContent, '+2.5s');
    assert.ok(d.subsSyncReadout.classList.contains('is-shifted'));
  });

  it('negative offsets render with the U+2212 minus sign', () => {
    const { dom: d } = makeCtrl();
    d.subsSyncSlider.value = '-1.5';
    d.subsSyncSlider.dispatchEvent(new window.Event('input'));
    assert.equal(d.subsSyncReadout.textContent, '−1.5s');
  });

  it('clicking the readout resets the offset to zero', () => {
    const { dom: d } = makeCtrl();
    d.subsSyncSlider.value = '4';
    d.subsSyncSlider.dispatchEvent(new window.Event('input'));
    d.subsSyncReadout.click();
    assert.equal(d.subsSyncReadout.textContent, '0.0s');
    assert.equal(d.subsSyncReadout.classList.contains('is-shifted'), false);
    assert.equal(d.subsSyncSlider.value, '0');
  });

  it('offset is clamped to the [-30, 30] range', () => {
    const { ctrl } = makeCtrl();
    // Drive offset via the slider with out-of-bounds values.
    const { dom: d } = makeCtrl();
    d.subsSyncSlider.min = '-100';
    d.subsSyncSlider.max = '100';
    d.subsSyncSlider.value = '999';
    d.subsSyncSlider.dispatchEvent(new window.Event('input'));
    assert.equal(d.subsSyncReadout.textContent, '+30.0s');
    d.subsSyncSlider.value = '-999';
    d.subsSyncSlider.dispatchEvent(new window.Event('input'));
    assert.equal(d.subsSyncReadout.textContent, '−30.0s');
    ctrl.dispose();
  });

  it('offset is rounded to one decimal (0.1s grain)', () => {
    const { dom: d } = makeCtrl();
    d.subsSyncSlider.value = '1.234';
    d.subsSyncSlider.dispatchEvent(new window.Event('input'));
    assert.equal(d.subsSyncReadout.textContent, '+1.2s');
  });

  it('getOffset() reflects the current slider-driven value', () => {
    const { ctrl, dom: d } = makeCtrl();
    d.subsSyncSlider.value = '3';
    d.subsSyncSlider.dispatchEvent(new window.Event('input'));
    assert.equal(ctrl.getOffset(), 3);
  });
});

describe('createSubtitleController — menu toggle', () => {
  it('CC button click is a no-op when the show has no imdbId', () => {
    const { dom: d } = makeCtrl();
    d.subsBtn.click();
    // openSubsMenu bails on the imdbId check, so the menu stays hidden.
    assert.ok(d.subsMenu.classList.contains('hidden'));
  });

  it('outside click hides the menu', () => {
    const { dom: d } = makeCtrl();
    // Force-open the menu so we can verify outside-click closes it.
    d.subsMenu.classList.remove('hidden');
    d.subsBtn.setAttribute('aria-expanded', 'true');
    const elsewhere = document.createElement('div');
    document.body.appendChild(elsewhere);
    elsewhere.dispatchEvent(new window.Event('click', { bubbles: true }));
    assert.ok(d.subsMenu.classList.contains('hidden'));
    assert.equal(d.subsBtn.getAttribute('aria-expanded'), 'false');
  });
});

describe('createSubtitleController — setEpisode', () => {
  it('setEpisode resets the CC button label and active state', () => {
    const { ctrl, dom: d } = makeCtrl();
    // Simulate an active language state by mutating the DOM directly.
    d.subsBtn.textContent = 'CC EN';
    d.subsBtn.classList.add('is-active');
    ctrl.setEpisode(ep(1, 1));
    assert.equal(d.subsBtn.textContent, 'CC');
    assert.equal(d.subsBtn.classList.contains('is-active'), false);
  });

  it('setEpisode hides the sync slider section', () => {
    const { ctrl, dom: d } = makeCtrl();
    d.subsSyncWrap.classList.remove('hidden');
    ctrl.setEpisode(ep(1, 1));
    assert.ok(d.subsSyncWrap.classList.contains('hidden'));
  });

  it('setEpisode preserves the subtitle offset across episodes', () => {
    const { ctrl, dom: d } = makeCtrl();
    d.subsSyncSlider.value = '2';
    d.subsSyncSlider.dispatchEvent(new window.Event('input'));
    ctrl.setEpisode(ep(1, 2));
    // Offset is intentionally session-persistent — the user dialled
    // it in for this source release and we expect the value to carry.
    assert.equal(ctrl.getOffset(), 2);
  });

  it('setEpisode(null) just clears state without throwing', () => {
    const { ctrl } = makeCtrl();
    ctrl.setEpisode(null);
    // No assertion beyond "did not throw" — null is the defensive entry.
  });
});

describe('createSubtitleController — dispose', () => {
  it('dispose removes slider, readout, and outside-click listeners', () => {
    const { ctrl, dom: d } = makeCtrl();
    ctrl.dispose();

    // Slider input no longer affects the readout.
    d.subsSyncSlider.value = '5';
    d.subsSyncSlider.dispatchEvent(new window.Event('input'));
    assert.equal(d.subsSyncReadout.textContent, '0.0s');

    // Readout click no longer changes state.
    d.subsSyncSlider.value = '7';
    d.subsSyncReadout.click();
    assert.equal(d.subsSyncSlider.value, '7'); // unchanged
  });

  it('getActiveLang returns null when no track was ever attached', () => {
    const { ctrl } = makeCtrl();
    assert.equal(ctrl.getActiveLang(), null);
  });
});
