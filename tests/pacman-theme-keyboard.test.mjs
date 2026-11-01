import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { describe, it } from 'node:test';
import { contrastRatio, themeTokens } from '../scripts/theme-contrast.mjs';
import { clickMenuButton, uiOwnsKey } from '../pacman/js/ui-keys.js';

const root = new URL('..', import.meta.url);

function read(rel) {
  return readFileSync(new URL(rel, root), 'utf8');
}

const brand = themeTokens(read('brand.css'));
const pacmanCss = read('pacman/style.css');
const infiniteCss = read('pacman-infinite/style.css');
const pacmanHtml = read('pacman/index.html');
const infiniteHtml = read('pacman-infinite/index.html');

function ink(css, name) {
  const light = css.match(new RegExp(`--pac-ink-${name}:\\s*(#[0-9a-f]{6})`, 'i'));
  const darkBlock = css.slice(css.indexOf(":root[data-theme='dark']"));
  const dark = darkBlock.match(new RegExp(`--pac-ink-${name}:\\s*(#[0-9a-f]{6})`, 'i'));
  assert.ok(light && dark, `missing --pac-ink-${name}`);
  return { light: light[1], dark: dark[1] };
}

describe('pacman theme ink', () => {
  for (const [file, css] of [
    ['pacman', pacmanCss],
    ['pacman-infinite', infiniteCss]
  ]) {
    for (const name of ['yellow', 'cyan', 'red', 'pink', 'green']) {
      it(`${file} ${name} ink clears AA on both surfaces`, () => {
        const colors = ink(css, name);
        for (const surface of ['--surface-0', '--surface-1']) {
          const light = contrastRatio(colors.light, brand.light[surface]);
          const dark = contrastRatio(colors.dark, brand.dark[surface]);
          assert.ok(light >= 4.5, `light ${name} on ${surface} is ${light}`);
          assert.ok(dark >= 4.5, `dark ${name} on ${surface} is ${dark}`);
        }
      });
    }
  }

  it('yellow CTA keeps black text in both themes', () => {
    assert.match(pacmanCss, /--pac-fill:\s*#eab308/i);
    const ratio = contrastRatio('#000000', '#eab308');
    assert.ok(ratio >= 4.5, ratio);
  });

  it('success CTA flips its label with the theme', () => {
    assert.match(pacmanCss, /\.pac-cta-success\s*\{[^}]*color:\s*var\(--pure-white\)/);
    assert.match(
      pacmanCss,
      /data-theme='dark'\] \.pac-cta-success\s*\{[^}]*color:\s*var\(--surface-0\)/
    );
    assert.ok(contrastRatio('#ffffff', brand.light['--success']) >= 4.5);
    assert.ok(contrastRatio(brand.dark['--surface-0'], brand.dark['--success']) >= 4.5);
  });
});

describe('pacman keyboard chrome', () => {
  for (const [name, html] of [
    ['pacman', pacmanHtml],
    ['pacman-infinite', infiniteHtml]
  ]) {
    it(`${name} theme-color follows the dark default and can resolve light`, () => {
      assert.match(html, /name="theme-color" content="#0e1217"/);
      assert.match(html, /theme === 'light' \? '#fafafa' : '#0e1217'/);
    });

    it(`${name} camera control is a real button`, () => {
      assert.match(html, /<button[^>]*id="camera-toggle"/);
      assert.match(
        html,
        /id="camera-toggle"[^>]*type="button"|type="button"[^>]*id="camera-toggle"/
      );
    });

    it(`${name} start action is the initial focus target`, () => {
      assert.match(html, /data-initial-focus/);
    });
  }

  it('infinite difficulty is a radiogroup of buttons', () => {
    assert.match(infiniteHtml, /role="radiogroup"/);
    assert.equal(infiniteHtml.match(/role="radio"/g).length, 3);
  });

  it('does not borrow StepMania arrow classes', () => {
    assert.doesNotMatch(pacmanHtml, /text-sm-arrow/);
    assert.doesNotMatch(infiniteHtml, /text-sm-arrow/);
  });
});

describe('uiOwnsKey', () => {
  it('leaves page-background keys to the game', () => {
    const body = { nodeType: 1, closest: () => null };
    assert.equal(uiOwnsKey({ code: 'ArrowLeft', key: 'ArrowLeft', target: body }), false);
    assert.equal(uiOwnsKey({ code: 'Space', key: ' ', target: body }), false);
  });

  it('yields Space and Enter on a focused control', () => {
    const button = {
      nodeType: 1,
      closest: (sel) => (sel.includes('button') ? button : null)
    };
    assert.equal(uiOwnsKey({ code: 'Space', key: ' ', target: button }), true);
    assert.equal(uiOwnsKey({ code: 'Enter', key: 'Enter', target: button }), true);
  });

  it('yields arrows when the shared remote would move focus', () => {
    const previous = globalThis.window;
    globalThis.window = {
      heymingRemote: { arrowsMoveFocus: () => true }
    };
    try {
      assert.equal(uiOwnsKey({ code: 'ArrowUp', key: 'ArrowUp', target: { nodeType: 1 } }), true);
    } finally {
      if (previous === undefined) delete globalThis.window;
      else globalThis.window = previous;
    }
  });

  it('clicks the first visible menu button', () => {
    const clicked = [];
    const hidden = {
      closest: () => hidden
    };
    const shown = {
      closest: () => null,
      click: () => clicked.push('shown')
    };
    const doc = {
      getElementById: (id) => (id === 'restart-btn' ? hidden : shown)
    };
    const previous = globalThis.document;
    globalThis.document = doc;
    try {
      assert.equal(clickMenuButton(['restart-btn', 'back-to-menu-btn']), true);
      assert.deepEqual(clicked, ['shown']);
    } finally {
      globalThis.document = previous;
    }
  });
});
