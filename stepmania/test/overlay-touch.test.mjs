// The loading overlay's four setup methods, checked against every screen.
// The expected allows live here. The overlay is driven through its own
// methods, so a later edit that skips the touch table still fails.

import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { JSDOM } from 'jsdom';

const dom = new JSDOM('<!doctype html><body></body>', {
  url: 'https://joeheyming.github.io/stepmania/',
  pretendToBeVisual: true
});
const { window } = dom;

globalThis.window = window;
globalThis.document = window.document;
globalThis.HTMLElement = window.HTMLElement;
globalThis.Element = window.Element;
globalThis.Node = window.Node;
globalThis.customElements = window.customElements;
globalThis.KeyboardEvent = window.KeyboardEvent;
globalThis.MouseEvent = window.MouseEvent;
globalThis.Event = window.Event;
globalThis.getComputedStyle = window.getComputedStyle.bind(window);

await import('../js/loading-overlay.js');

/** @type {Array<[string, boolean]>} */
const screens = [
  ['hidden', true],
  ['loading', true],
  ['error', true],
  ['ready', true],
  ['ready', false]
];

/**
 * @param {string} state
 * @param {boolean} audioReady
 * @returns {boolean}
 */
function allowsProgress(state, audioReady) {
  if (state === 'hidden') return false;
  if (state === 'ready' && audioReady) return false;
  return true;
}

/**
 * @param {string} state
 * @returns {boolean}
 */
function allowsTitle(state) {
  return state !== 'ready';
}

/**
 * @param {string} state
 * @param {boolean} audioReady
 * @returns {'refuse' | 'defer' | 'start'}
 */
function playEffect(state, audioReady) {
  if (state !== 'ready') return 'refuse';
  return audioReady ? 'start' : 'defer';
}

/**
 * @param {string} state
 * @returns {boolean}
 */
function allowsAudio(state) {
  return state === 'ready';
}

/**
 * @param {string} state
 * @param {boolean} audioReady
 */
function screenLabel(state, audioReady) {
  if (state === 'ready' && !audioReady) return 'ready, audio still coming';
  return state;
}

/**
 * A rendered overlay on one screen. Non-ready screens have audio marked
 * not-ready so a mistaken markAudioReady is visible.
 * @param {string} state
 * @param {boolean} audioReady
 */
function open(state, audioReady) {
  const el = window.document.createElement('loading-overlay');
  /** @type {string[]} */
  const plays = [];
  const onPlay = () => {
    plays.push('play');
  };
  if (state === 'loading') {
    el.showLoading('Original', 'Getting the chart');
  } else if (state === 'error') {
    el.showError('Original', 'Broke', { onRetry() {}, onBack() {} });
  } else if (state === 'ready') {
    el.showReadyToPlay({
      songTitle: 'Original',
      audioReady,
      onPlay,
      charts: [{ difficulty: 'Hard', rating: 12 }]
    });
  } else {
    el.showLoading('Original', 'Getting the chart');
    el.hide();
  }
  if (state !== 'ready') {
    el._onPlay = onPlay;
    el._audioReady = false;
  }
  return { el, plays };
}

/**
 * @param {Element} el
 * @param {string} id
 * @returns {string}
 */
function text(el, id) {
  return el.shadowRoot.getElementById(id).textContent;
}

describe('loading overlay setup', () => {
  it('covers every screen, including ready while the audio is still coming', () => {
    assert.deepEqual(
      screens.map(([state, audioReady]) => screenLabel(state, audioReady)),
      ['hidden', 'loading', 'error', 'ready', 'ready, audio still coming']
    );
  });

  for (const [state, audioReady] of screens) {
    const label = screenLabel(state, audioReady);

    it('updateProgress on ' + label, () => {
      const { el } = open(state, audioReady);
      const before = text(el, 'status');
      el.updateProgress('Rewritten status');
      assert.equal(el.state, state);
      assert.equal(
        text(el, 'status'),
        allowsProgress(state, audioReady) ? 'Rewritten status' : before
      );
    });

    it('setTitle on ' + label, () => {
      const { el } = open(state, audioReady);
      el.setTitle('Rewritten title');
      assert.equal(el.state, state);
      assert.equal(text(el, 'title'), allowsTitle(state) ? 'Rewritten title' : 'Original');
    });

    it('playSelected on ' + label, () => {
      const { el, plays } = open(state, audioReady);
      el.playSelected();
      assert.equal(el.state, state);
      const effect = playEffect(state, audioReady);
      assert.equal(plays.length, effect === 'start' ? 1 : 0);
      assert.equal(el._playWhenReady, effect === 'defer');
      if (effect !== 'start') assert.equal(el._audioReady, state === 'ready' ? audioReady : false);
    });

    it('markAudioReady on ' + label, () => {
      const { el, plays } = open(state, audioReady);
      const before = text(el, 'status');
      el.markAudioReady();
      assert.equal(el.state, state);
      assert.equal(plays.length, 0);
      if (allowsAudio(state)) {
        assert.equal(el._audioReady, true);
        assert.equal(el._playWhenReady, false);
        assert.equal(text(el, 'status'), '');
        const playBtn = el.shadowRoot.getElementById('play-btn');
        assert.equal(playBtn.disabled, false);
      } else {
        assert.equal(el._audioReady, false);
        assert.equal(text(el, 'status'), before);
      }
    });
  }

  it('a deferred start begins when the audio arrives', () => {
    const { el, plays } = open('ready', false);
    el.playSelected();
    assert.equal(plays.length, 0);
    assert.equal(el._playWhenReady, true);
    el.markAudioReady();
    assert.equal(plays.length, 1);
    assert.equal(el.state, 'ready');
    assert.equal(el._playWhenReady, false);
    assert.equal(el.shadowRoot.getElementById('play-btn').disabled, false);
    assert.equal(el.shadowRoot.getElementById('play-btn').textContent, 'Start · Hard 12');
  });

  it('a blank title does not replace the loading title', () => {
    const { el } = open('loading', true);
    el.setTitle('   ');
    assert.equal(text(el, 'title'), 'Original');
    assert.equal(el.state, 'loading');
  });
});
