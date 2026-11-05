import { describe, it, before } from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';

describe('stepmania ready and loading screens', () => {
  /** @type {HTMLElement & { showReadyToPlay: Function, showError: Function, showLoading: Function, updateProgress: Function, markAudioReady: Function, shadowRoot: ShadowRoot }} */
  let overlay;

  before(async () => {
    const dom = new JSDOM('<!doctype html><html><body></body></html>', {
      url: 'https://localhost:8443/stepmania/'
    });
    globalThis.window = dom.window;
    globalThis.document = dom.window.document;
    globalThis.HTMLElement = dom.window.HTMLElement;
    globalThis.Element = dom.window.Element;
    globalThis.customElements = dom.window.customElements;
    globalThis.getComputedStyle = dom.window.getComputedStyle.bind(dom.window);
    Object.defineProperty(dom.window.ShadowRoot.prototype, 'adoptedStyleSheets', {
      configurable: true,
      get() {
        return this._adoptedStyleSheets || [];
      },
      set(sheets) {
        this._adoptedStyleSheets = sheets;
      }
    });
    globalThis.CSSStyleSheet = class {
      async replace() {}
    };
    globalThis.fetch = async () => new Response('/* test */');
    await import('../stepmania/js/loading-overlay.js');
    overlay = /** @type {typeof overlay} */ (document.createElement('loading-overlay'));
    document.body.appendChild(overlay);
  });

  it('puts the song name above the charts and one start button', () => {
    overlay.showReadyToPlay({
      songTitle: 'Megascorcher',
      artist: 'Machinae Supremacy',
      charts: [
        { difficulty: 'Easy', rating: 4 },
        { difficulty: 'Expert', rating: 10 }
      ],
      currentDifficulty: 1
    });
    const root = overlay.shadowRoot;
    assert.equal(root.getElementById('title').textContent, 'Megascorcher');
    assert.equal(root.getElementById('artist').textContent, 'Machinae Supremacy');
    assert.equal(root.getElementById('play-btn').textContent, 'Start · Expert 10');
    assert.equal(root.querySelectorAll('.chart-choice').length, 2);
    assert.equal(
      root.querySelector('.chart-choice[data-index="1"]').getAttribute('aria-pressed'),
      'true'
    );
    assert.equal(root.getElementById('browse-btn'), null);
    assert.equal(root.getElementById('ready-back-btn').textContent, 'Pick a different song');

    root.querySelector('.chart-choice[data-index="0"]').click();
    assert.equal(root.getElementById('play-btn').textContent, 'Start · Easy 4');
    assert.equal(
      root.querySelector('.chart-choice[data-index="0"]').getAttribute('aria-pressed'),
      'true'
    );
  });

  it('leaves the ready screen alone once it is up', () => {
    overlay.updateProgress('Setting up visuals...');
    assert.equal(overlay.shadowRoot.getElementById('title').textContent, 'Megascorcher');
    assert.equal(overlay.shadowRoot.getElementById('status').textContent, '');
  });

  it('offers retry for a download failure and only a way out for a chart failure', () => {
    overlay.showError('Download failed', 'The audio never arrived.', { allowRetry: true });
    assert.equal(
      overlay.shadowRoot.getElementById('retry-btn').classList.contains('hidden'),
      false
    );
    overlay.showError("This chart can't be played here", 'Doubles only.', { allowRetry: false });
    assert.equal(overlay.shadowRoot.getElementById('retry-btn').classList.contains('hidden'), true);
    assert.equal(
      overlay.shadowRoot.getElementById('back-btn').classList.contains('btn-solid'),
      true
    );
  });

  it('names the song while it loads and does not focus the escape button', () => {
    overlay.showLoading('Xepher', 'Getting the chart');
    const root = overlay.shadowRoot;
    assert.equal(root.getElementById('title').textContent, 'Xepher');
    assert.equal(root.getElementById('status').textContent, 'Getting the chart');
    assert.equal(root.getElementById('progress-bar'), null);
    assert.notEqual(root.activeElement, root.getElementById('loading-browse-btn'));
  });

  it('shows the charts before the audio arrives and keeps the chosen difficulty', () => {
    overlay.showReadyToPlay({
      songTitle: 'Xepher',
      artist: 'Tatsh',
      charts: [
        { difficulty: 'Heavy', rating: 12 },
        { difficulty: 'Challenge', rating: 16 }
      ],
      currentDifficulty: 0,
      audioReady: false
    });
    const root = overlay.shadowRoot;
    assert.equal(root.querySelectorAll('.chart-choice').length, 2);
    assert.equal(root.getElementById('play-btn').disabled, true);
    assert.equal(root.getElementById('play-btn').textContent, 'Getting the audio…');
    assert.equal(root.getElementById('status').textContent, 'Getting the audio');

    root.querySelector('.chart-choice[data-index="1"]').click();
    assert.equal(root.getElementById('play-btn').textContent, 'Getting the audio…');
    assert.equal(
      root.querySelector('.chart-choice[data-index="1"]').getAttribute('aria-pressed'),
      'true'
    );

    overlay.updateProgress('Trying another download');
    assert.equal(root.getElementById('status').textContent, 'Trying another download');

    overlay.markAudioReady();
    assert.equal(root.getElementById('play-btn').disabled, false);
    assert.equal(root.getElementById('play-btn').textContent, 'Start · Challenge 16');
    assert.equal(root.getElementById('status').classList.contains('hidden'), true);
  });
});
