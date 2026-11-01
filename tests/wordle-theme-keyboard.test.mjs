import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { describe, it } from 'node:test';
import { contrastRatio } from '../scripts/theme-contrast.mjs';

const root = new URL('..', import.meta.url);

function read(rel) {
  return readFileSync(new URL(rel, root), 'utf8');
}

const css = read('wordle-finder/index.css');
const html = read('wordle-finder/index.html');
const page = read('wordle-finder/index.js');
const game = read('wordle-finder/wordle-game.js');

function token(name) {
  const match = css.match(new RegExp(`--wordle-${name}:\\s*(#[0-9a-f]{6})`, 'i'));
  assert.ok(match, name);
  return match[1];
}

describe('wordle tile colors', () => {
  it('green, yellow, and gray tiles clear AA', () => {
    const green = contrastRatio('#ffffff', token('green'));
    const yellow = contrastRatio('#1a1a1a', token('yellow'));
    const gray = contrastRatio('#ffffff', token('gray'));
    assert.ok(green >= 4.5, green);
    assert.ok(yellow >= 4.5, yellow);
    assert.ok(gray >= 4.5, gray);
  });

  it('gray tiles keep white text when the page theme flips', () => {
    assert.match(css, /\.play-letter\.incorrect\s*\{[^}]*color:\s*var\(--wordle-text-on-tile\)/);
    assert.match(css, /input\.incorrect\s*\{[^}]*color:\s*var\(--wordle-text-on-tile\)/);
    assert.match(
      css,
      /\.included-stat-wrong-spot\s*\{[^}]*color:\s*var\(--wordle-text-on-tile-dark\)/
    );
  });
});

describe('wordle keyboard and short layout', () => {
  it('theme-color follows the dark default and can resolve light', () => {
    assert.match(html, /name="theme-color" content="#0e1217"/);
    assert.match(html, /theme === 'light' \? '#fafafa' : '#0e1217'/);
  });

  it('play mode fits a short window and focuses New Game', () => {
    assert.match(css, /body\.wordle-playing\s*\{[^}]*height:\s*100svh/);
    assert.match(css, /--play-room:/);
    assert.match(page, /function focusWordleStart/);
    assert.match(page, /focusWordleStart\(\)/);
  });

  it('a mode select keeps letter keys for itself', () => {
    assert.match(game, /tagName === 'SELECT'/);
  });

  it('the date control follows the page theme', () => {
    assert.match(css, /input\.wordle-date\s*\{[^}]*color-scheme:\s*light/);
    assert.match(css, /data-theme='dark'\] input\.wordle-date\s*\{[^}]*color-scheme:\s*dark/);
  });
});
