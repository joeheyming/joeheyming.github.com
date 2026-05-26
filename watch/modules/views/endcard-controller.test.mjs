/**
 * Tests for the end-card controller in the watch view.
 *
 * Exercises the controller's externally-observable behavior:
 * `video` `ended` triggers the card with the right copy, the Play
 * Next button advances, Replay seeks the video back to zero, Back
 * navigates out, the backdrop click cancels the autoplay countdown
 * without dismissing the card, and `dispose()` cleans up listeners.
 *
 * Uses JSDOM (same pattern as `tests/uzdoom-lifecycle.test.mjs`)
 * plus fake timers for the countdown path. Network/IDB are not
 * involved — the controller is pure DOM + closures.
 */

import { describe, it, beforeEach, afterEach, mock } from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';

import { createEndCardController } from './endcard-controller.js';

/** @typedef {import('../catalog.js').Episode} Episode */
/** @typedef {import('../shows.js').ShowConfig} ShowConfig */

let dom;

/**
 * Stand up a fresh JSDOM realm + a minimal end-card DOM tree that
 * matches what `watch-view.js mount()` builds. Every test gets its
 * own realm so timers, listeners, and element identity stay isolated.
 */
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
}

function buildDom() {
  const make = (tag, klass) => {
    const el = document.createElement(tag);
    if (klass) el.className = klass;
    return el;
  };
  const endCard = make('div', 'tv-endcard hidden');
  const endThumb = make('div', 'tv-endcard-thumb');
  const endTitle = make('h3', 'tv-endcard-title');
  const endSub = make('p', 'tv-endcard-sub');
  const endEyebrow = make('p', 'tv-endcard-eyebrow');
  const endPlayBtn = make('button', 'tv-endcard-btn--primary');
  const endReplayBtn = make('button');
  const endShareBtn = make('button');
  const endBackBtn = make('button');
  const endCountdown = make('p', 'tv-endcard-countdown hidden');
  document.body.appendChild(endCard);
  return {
    endCard,
    endThumb,
    endTitle,
    endSub,
    endEyebrow,
    endPlayBtn,
    endReplayBtn,
    endShareBtn,
    endBackBtn,
    endCountdown
  };
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
function ep(season, episode, extras = {}) {
  return {
    season,
    episode,
    title: `Ep ${season}-${episode}`,
    file: `s${season}e${episode}.mp4`,
    url: `http://x/s${season}e${episode}.mp4`,
    archiveUrl: '',
    image: '',
    ...extras
  };
}

beforeEach(setupDom);
afterEach(() => {
  if (dom) dom.window.close();
});

describe('createEndCardController', () => {
  it('does not show the card until the video ends', () => {
    const elements = buildDom();
    const video = document.createElement('video');
    createEndCardController({
      video,
      show: fakeShow,
      dom: elements,
      flash: () => {},
      resolveNext: () => null,
      shouldAutoplay: () => false,
      onAdvance: () => {},
      onNavigateBack: () => {},
      shareCurrent: async () => true
    });
    assert.ok(elements.endCard.classList.contains('hidden'));
  });

  it('shows the card with the next episode on `video` ended', () => {
    const elements = buildDom();
    const video = document.createElement('video');
    const next = ep(1, 2, { title: 'Bart the Genius', image: '' });
    createEndCardController({
      video,
      show: fakeShow,
      dom: elements,
      flash: () => {},
      resolveNext: () => next,
      shouldAutoplay: () => false,
      onAdvance: () => {},
      onNavigateBack: () => {},
      shareCurrent: async () => true
    });
    video.dispatchEvent(new window.Event('ended'));
    assert.equal(elements.endCard.classList.contains('hidden'), false);
    assert.equal(elements.endEyebrow.textContent, 'Up next');
    assert.equal(elements.endTitle.textContent, 'Bart the Genius');
    assert.match(elements.endSub.textContent || '', /S01E02/);
    assert.equal(elements.endPlayBtn.classList.contains('hidden'), false);
  });

  it('falls back to "Episode ended" copy when there is no next episode', () => {
    const elements = buildDom();
    const video = document.createElement('video');
    createEndCardController({
      video,
      show: fakeShow,
      dom: elements,
      flash: () => {},
      resolveNext: () => null,
      shouldAutoplay: () => false,
      onAdvance: () => {},
      onNavigateBack: () => {},
      shareCurrent: async () => true
    });
    video.dispatchEvent(new window.Event('ended'));
    assert.equal(elements.endEyebrow.textContent, 'Episode ended');
    assert.match(elements.endTitle.textContent || '', /last one/);
    // Play-next button hides when there's nothing to advance to.
    assert.ok(elements.endPlayBtn.classList.contains('hidden'));
  });

  it('uses the show emoji as a thumb placeholder when no image is provided', () => {
    const elements = buildDom();
    const video = document.createElement('video');
    createEndCardController({
      video,
      show: fakeShow,
      dom: elements,
      flash: () => {},
      resolveNext: () => ep(1, 2),
      shouldAutoplay: () => false,
      onAdvance: () => {},
      onNavigateBack: () => {},
      shareCurrent: async () => true
    });
    video.dispatchEvent(new window.Event('ended'));
    assert.ok(elements.endThumb.classList.contains('is-empty'));
    assert.equal(elements.endThumb.textContent, '🍩');
  });

  it('Play Next button calls onAdvance with the queued next episode', () => {
    const elements = buildDom();
    const video = document.createElement('video');
    const next = ep(2, 1);
    const onAdvance = mock.fn();
    createEndCardController({
      video,
      show: fakeShow,
      dom: elements,
      flash: () => {},
      resolveNext: () => next,
      shouldAutoplay: () => false,
      onAdvance,
      onNavigateBack: () => {},
      shareCurrent: async () => true
    });
    video.dispatchEvent(new window.Event('ended'));
    elements.endPlayBtn.click();
    assert.equal(onAdvance.mock.callCount(), 1);
    assert.equal(onAdvance.mock.calls[0].arguments[0], next);
    // Card is hidden again after advancing.
    assert.ok(elements.endCard.classList.contains('hidden'));
  });

  it('Replay seeks the video back to zero and hides the card', () => {
    const elements = buildDom();
    const video = document.createElement('video');
    // jsdom video.play returns undefined by default; stub so the
    // controller's `if (typeof p.catch === 'function')` branch sees no promise.
    video.play = mock.fn(() => undefined);
    createEndCardController({
      video,
      show: fakeShow,
      dom: elements,
      flash: () => {},
      resolveNext: () => ep(1, 2),
      shouldAutoplay: () => false,
      onAdvance: () => {},
      onNavigateBack: () => {},
      shareCurrent: async () => true
    });
    video.dispatchEvent(new window.Event('ended'));
    video.currentTime = 1234;
    elements.endReplayBtn.click();
    assert.equal(video.currentTime, 0);
    assert.equal(video.play.mock.callCount(), 1);
    assert.ok(elements.endCard.classList.contains('hidden'));
  });

  it('Back button calls onNavigateBack and hides the card', () => {
    const elements = buildDom();
    const video = document.createElement('video');
    const onNavigateBack = mock.fn();
    createEndCardController({
      video,
      show: fakeShow,
      dom: elements,
      flash: () => {},
      resolveNext: () => ep(1, 2),
      shouldAutoplay: () => false,
      onAdvance: () => {},
      onNavigateBack,
      shareCurrent: async () => true
    });
    video.dispatchEvent(new window.Event('ended'));
    elements.endBackBtn.click();
    assert.equal(onNavigateBack.mock.callCount(), 1);
    assert.ok(elements.endCard.classList.contains('hidden'));
  });

  it('Share button flashes SHARED on success and SHARE FAILED otherwise', async () => {
    const elements = buildDom();
    const video = document.createElement('video');
    const flashed = [];
    let result = true;
    createEndCardController({
      video,
      show: fakeShow,
      dom: elements,
      flash: (msg) => flashed.push(msg),
      resolveNext: () => ep(1, 2),
      shouldAutoplay: () => false,
      onAdvance: () => {},
      onNavigateBack: () => {},
      shareCurrent: async () => result
    });
    video.dispatchEvent(new window.Event('ended'));
    elements.endShareBtn.click();
    // shareCurrent is async; let the microtask + the await resolve.
    await new Promise((r) => setTimeout(r, 0));
    assert.deepEqual(flashed, ['SHARED']);

    result = false;
    elements.endShareBtn.click();
    await new Promise((r) => setTimeout(r, 0));
    assert.deepEqual(flashed, ['SHARED', 'SHARE FAILED']);
  });

  it('does not show a countdown when shouldAutoplay() returns false', () => {
    const elements = buildDom();
    const video = document.createElement('video');
    createEndCardController({
      video,
      show: fakeShow,
      dom: elements,
      flash: () => {},
      resolveNext: () => ep(1, 2),
      shouldAutoplay: () => false,
      onAdvance: () => {},
      onNavigateBack: () => {},
      shareCurrent: async () => true
    });
    video.dispatchEvent(new window.Event('ended'));
    assert.ok(elements.endCountdown.classList.contains('hidden'));
  });

  it('starts an 8-second countdown when shouldAutoplay() returns true', (t) => {
    const elements = buildDom();
    const video = document.createElement('video');
    t.mock.timers.enable({ apis: ['setInterval'] });
    createEndCardController({
      video,
      show: fakeShow,
      dom: elements,
      flash: () => {},
      resolveNext: () => ep(1, 2),
      shouldAutoplay: () => true,
      onAdvance: () => {},
      onNavigateBack: () => {},
      shareCurrent: async () => true
    });
    video.dispatchEvent(new window.Event('ended'));
    assert.equal(elements.endCountdown.classList.contains('hidden'), false);
    assert.match(elements.endCountdown.textContent || '', /Playing in 8s/);
    t.mock.timers.tick(1000);
    assert.match(elements.endCountdown.textContent || '', /Playing in 7s/);
  });

  it('autoplay countdown calls onAdvance after 8 ticks and hides the card', (t) => {
    const elements = buildDom();
    const video = document.createElement('video');
    const next = ep(3, 4);
    const onAdvance = mock.fn();
    t.mock.timers.enable({ apis: ['setInterval'] });
    createEndCardController({
      video,
      show: fakeShow,
      dom: elements,
      flash: () => {},
      resolveNext: () => next,
      shouldAutoplay: () => true,
      onAdvance,
      onNavigateBack: () => {},
      shareCurrent: async () => true
    });
    video.dispatchEvent(new window.Event('ended'));
    t.mock.timers.tick(8000);
    assert.equal(onAdvance.mock.callCount(), 1);
    assert.equal(onAdvance.mock.calls[0].arguments[0], next);
    assert.ok(elements.endCard.classList.contains('hidden'));
  });

  it('backdrop click cancels the countdown but leaves the card visible', (t) => {
    const elements = buildDom();
    const video = document.createElement('video');
    const onAdvance = mock.fn();
    t.mock.timers.enable({ apis: ['setInterval'] });
    createEndCardController({
      video,
      show: fakeShow,
      dom: elements,
      flash: () => {},
      resolveNext: () => ep(1, 2),
      shouldAutoplay: () => true,
      onAdvance,
      onNavigateBack: () => {},
      shareCurrent: async () => true
    });
    video.dispatchEvent(new window.Event('ended'));
    // Click the backdrop (event.target === endCard). Using the
    // synthetic Event constructor sets target via dispatch.
    const evt = new window.Event('click', { bubbles: false });
    Object.defineProperty(evt, 'target', { value: elements.endCard });
    elements.endCard.dispatchEvent(evt);
    // Card stays visible, countdown is cancelled and updated.
    assert.equal(elements.endCard.classList.contains('hidden'), false);
    assert.match(elements.endCountdown.textContent || '', /cancelled/i);
    // Even if we wait the full 8s now, onAdvance never fires.
    t.mock.timers.tick(10_000);
    assert.equal(onAdvance.mock.callCount(), 0);
  });

  it('hide() collapses the card and cancels any running countdown', (t) => {
    const elements = buildDom();
    const video = document.createElement('video');
    const onAdvance = mock.fn();
    t.mock.timers.enable({ apis: ['setInterval'] });
    const ctrl = createEndCardController({
      video,
      show: fakeShow,
      dom: elements,
      flash: () => {},
      resolveNext: () => ep(1, 2),
      shouldAutoplay: () => true,
      onAdvance,
      onNavigateBack: () => {},
      shareCurrent: async () => true
    });
    video.dispatchEvent(new window.Event('ended'));
    ctrl.hide();
    assert.ok(elements.endCard.classList.contains('hidden'));
    t.mock.timers.tick(10_000);
    assert.equal(onAdvance.mock.callCount(), 0);
  });

  it('dispose() detaches the `ended` listener so a future end does nothing', () => {
    const elements = buildDom();
    const video = document.createElement('video');
    const ctrl = createEndCardController({
      video,
      show: fakeShow,
      dom: elements,
      flash: () => {},
      resolveNext: () => ep(1, 2),
      shouldAutoplay: () => false,
      onAdvance: () => {},
      onNavigateBack: () => {},
      shareCurrent: async () => true
    });
    ctrl.dispose();
    video.dispatchEvent(new window.Event('ended'));
    assert.ok(elements.endCard.classList.contains('hidden'));
  });
});
