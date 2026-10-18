import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';
import { stradellaCellForKey, isStradellaKey } from '../play/accordion/stradella-keys.js';
import { renderStradella } from '../play/accordion/stradella.js';

const STANDARD_120 = { rowCount: 6, colCount: 20 };

describe('stradellaCellForKey', () => {
  it('maps each keyboard row to a bass row, starting at the top-left button', () => {
    assert.deepEqual(stradellaCellForKey('Digit1', false, STANDARD_120), { row: 0, col: 0 });
    assert.deepEqual(stradellaCellForKey('Digit2', false, STANDARD_120), { row: 0, col: 1 });
    assert.deepEqual(stradellaCellForKey('KeyQ', false, STANDARD_120), { row: 1, col: 0 });
    assert.deepEqual(stradellaCellForKey('KeyA', false, STANDARD_120), { row: 2, col: 0 });
    assert.deepEqual(stradellaCellForKey('KeyZ', false, STANDARD_120), { row: 3, col: 0 });
    assert.deepEqual(stradellaCellForKey('Slash', false, STANDARD_120), { row: 3, col: 9 });
  });

  it('Shift swaps major for dom 7 and minor for dim 7, leaving the note rows', () => {
    assert.deepEqual(stradellaCellForKey('KeyA', true, STANDARD_120), { row: 4, col: 0 });
    assert.deepEqual(stradellaCellForKey('KeyX', true, STANDARD_120), { row: 5, col: 1 });
    assert.deepEqual(stradellaCellForKey('Digit1', true, STANDARD_120), { row: 0, col: 0 });
    assert.deepEqual(stradellaCellForKey('KeyQ', true, STANDARD_120), { row: 1, col: 0 });
  });

  it('returns null for keys outside the rendered grid', () => {
    const tiny = { rowCount: 2, colCount: 4 };
    assert.equal(stradellaCellForKey('KeyA', false, tiny), null);
    assert.equal(stradellaCellForKey('Digit5', false, tiny), null);
    assert.equal(stradellaCellForKey('KeyZ', true, { rowCount: 5, colCount: 20 }), null);
    assert.equal(stradellaCellForKey('Space', false, STANDARD_120), null);
  });

  it('follows the visual top-left when the grid is flipped', () => {
    const grid = { rowCount: 6, colCount: 20 };
    assert.deepEqual(stradellaCellForKey('Digit1', false, { ...grid, flip: 'horizontal' }), {
      row: 0,
      col: 19
    });
    assert.deepEqual(stradellaCellForKey('Digit1', false, { ...grid, flip: 'vertical' }), {
      row: 5,
      col: 0
    });
    assert.deepEqual(stradellaCellForKey('Digit1', false, { ...grid, flip: 'both' }), {
      row: 5,
      col: 19
    });
  });
});

describe('Shift chord swap', () => {
  it('turns a held major into a 7th and a held minor into a diminished, then back', () => {
    const dom = new JSDOM('<!doctype html><html><body></body></html>');
    globalThis.window = dom.window;
    globalThis.document = dom.window.document;
    globalThis.HTMLElement = dom.window.HTMLElement;

    const root = document.createElement('div');
    document.body.appendChild(root);
    const stradella = renderStradella(root, {
      initialLayout: 'standard',
      size: '120',
      onPress() {},
      onRelease() {}
    });

    const sounding = () =>
      [...root.querySelectorAll('.stradella-button.active')].map((btn) =>
        btn.getAttribute('aria-label')
      );

    stradella.keyDown('KeyA', false);
    stradella.keyDown('KeyZ', false);
    stradella.keyDown('Digit1', false);
    assert.deepEqual(sounding(), ['Counter-bass A♯', 'Major A♯', 'Minor A♯']);

    stradella.setShift(true);
    assert.deepEqual(sounding(), ['Counter-bass A♯', 'Dom 7 A♯', 'Dim 7 A♯']);

    stradella.setShift(false);
    assert.deepEqual(sounding(), ['Counter-bass A♯', 'Major A♯', 'Minor A♯']);

    stradella.keyUp('KeyA');
    stradella.keyUp('KeyZ');
    stradella.keyUp('Digit1');
    assert.deepEqual(sounding(), []);
  });

  it('restores a minor that had no diminished button while Shift was held', () => {
    const dom = new JSDOM('<!doctype html><html><body></body></html>');
    globalThis.document = dom.window.document;
    globalThis.window = dom.window;
    globalThis.HTMLElement = dom.window.HTMLElement;

    const root = document.createElement('div');
    document.body.appendChild(root);
    const stradella = renderStradella(root, {
      initialLayout: 'eastern',
      size: '120',
      onPress() {},
      onRelease() {}
    });
    const sounding = () =>
      [...root.querySelectorAll('.stradella-button.active')].map((btn) => btn.dataset.row);

    stradella.keyDown('KeyZ', false);
    assert.deepEqual(sounding(), ['minor']);
    stradella.setShift(true);
    assert.deepEqual(sounding(), []);
    stradella.setShift(false);
    assert.deepEqual(sounding(), ['minor']);
    stradella.keyUp('KeyZ');
    assert.deepEqual(sounding(), []);
  });
});

describe('isStradellaKey', () => {
  it('claims the four grid rows only', () => {
    assert.equal(isStradellaKey('KeyM'), true);
    assert.equal(isStradellaKey('Digit0'), true);
    assert.equal(isStradellaKey('BracketLeft'), false);
    assert.equal(isStradellaKey('ArrowLeft'), false);
  });
});
