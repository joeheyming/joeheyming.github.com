import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { describe, it } from 'node:test';
import { contrastRatio, themeTokens } from '../scripts/theme-contrast.mjs';

const root = new URL('..', import.meta.url);

function read(rel) {
  return readFileSync(new URL(rel, root), 'utf8');
}

const brand = themeTokens(read('brand.css'));
const doomCss = read('doom/styles/base.css');
const doomHtml = read('doom/index.html');
const classicHtml = read('doom/classic/index.html');
const controller = read('doom/flavor-controller.js');

const INKS = [
  'blood',
  'freedoom',
  'legend',
  'mario',
  'metroid',
  'castlevania',
  'sonic',
  'bone',
  'fire',
  'life',
  'moddb'
];

function ink(name) {
  const light = doomCss.match(new RegExp(`--doom-ink-${name}:\\s*(#[0-9a-f]{6})`, 'i'));
  const darkBlock = doomCss.slice(doomCss.indexOf(":root[data-theme='dark']"));
  const dark = darkBlock.match(new RegExp(`--doom-ink-${name}:\\s*(#[0-9a-f]{6})`, 'i'));
  assert.ok(light && dark, `missing --doom-ink-${name}`);
  return { light: light[1], dark: dark[1] };
}

describe('doom theme ink', () => {
  for (const name of INKS) {
    it(`${name} ink clears AA on both page surfaces`, () => {
      const colors = ink(name);
      for (const surface of ['--surface-0', '--surface-1']) {
        const light = contrastRatio(colors.light, brand.light[surface]);
        const dark = contrastRatio(colors.dark, brand.dark[surface]);
        assert.ok(light >= 4.5, `light ${name} on ${surface} is ${light}`);
        assert.ok(dark >= 4.5, `dark ${name} on ${surface} is ${dark}`);
      }
    });

    it(`${name} hover label clears AA on the ink fill`, () => {
      const colors = ink(name);
      const onLight = contrastRatio('#ffffff', colors.light);
      const onDark = contrastRatio('#000000', colors.dark);
      assert.ok(onLight >= 4.5, onLight);
      assert.ok(onDark >= 4.5, onDark);
    });
  }

  it('canvas overlay ink stays light on the dark overlay', () => {
    assert.match(doomCss, /--doom-overlay-ink:\s*#e6edf3/i);
    assert.ok(contrastRatio('#e6edf3', '#141418') >= 4.5);
    assert.ok(contrastRatio('#c5cdd6', '#141418') >= 4.5);
  });

  it('disabled labels use text-2 on surface-2', () => {
    assert.match(doomCss, /--doom-disabled-text:\s*var\(--text-2\)/);
    for (const theme of ['light', 'dark']) {
      const ratio = contrastRatio(brand[theme]['--text-2'], brand[theme]['--surface-2']);
      assert.ok(ratio >= 4.5, `${theme} ${ratio}`);
    }
  });
});

describe('doom keyboard chrome', () => {
  for (const [name, html] of [
    ['doom', doomHtml],
    ['classic', classicHtml]
  ]) {
    it(`${name} theme-color follows the dark default and can resolve light`, () => {
      assert.match(html, /name="theme-color" content="#0e1217"/);
      assert.match(html, /theme === 'light' \? '#fafafa' : '#0e1217'/);
    });
  }

  it('the first flavor card is the initial focus target', () => {
    assert.match(doomHtml, /data-flavor="classic"[^>]*data-initial-focus/);
  });

  it('launch and relaunch controls are real buttons', () => {
    assert.match(doomHtml, /id="cleanLaunchBtn" type="button"/);
    assert.match(doomHtml, /id="relaunchBtn" type="button"/);
    assert.match(doomHtml, /id="useFreedoomBtn" type="button"/);
  });

  it('focus moves to a card or the launch button once it can be used', () => {
    assert.match(controller, /function focusIdle/);
    assert.match(controller, /focusIdle\(cards\[0\]\)/);
    assert.match(controller, /focusIdle\(btn\)/);
  });

  it('an open options menu keeps arrows inside it', () => {
    assert.match(controller, /menu\.setAttribute\('role', 'dialog'\)/);
    assert.match(controller, /menu\.setAttribute\('aria-modal', 'true'\)/);
  });
});
