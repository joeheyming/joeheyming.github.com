import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const css =
  readFileSync(new URL('../paint/style.css', import.meta.url), 'utf8') +
  '\n' +
  readFileSync(new URL('../paint/dock.css', import.meta.url), 'utf8');
const brand = readFileSync(new URL('../brand.css', import.meta.url), 'utf8');

/** Declarations of the first top-level rule whose selector list is exactly `selector`. */
function rule(selector) {
  const esc = selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const m = css.match(new RegExp(`(?:^|\\n)${esc}\\s*\\{([^}]*)\\}`));
  assert.ok(m, `missing rule ${selector}`);
  const decls = {};
  for (const part of m[1].replace(/\/\*[\s\S]*?\*\//g, '').split(';')) {
    const i = part.indexOf(':');
    if (i > 0) decls[part.slice(0, i).trim()] = part.slice(i + 1).trim();
  }
  return decls;
}

const layout = rule('.paint-layout');

/** Resolve var() chains against the .paint-layout overrides. */
function resolve(value) {
  let v = value;
  for (let i = 0; i < 10; i++) {
    const m = v.match(/^var\((--[\w-]+)\)$/);
    if (!m) return v.toLowerCase();
    assert.ok(m[1] in layout, `${m[1]} is not set on .paint-layout`);
    v = layout[m[1]];
  }
  return v;
}

test('.paint-layout sets the PhotoCraft Pro palette', () => {
  assert.equal(layout['--pc-panel'], '#323232');
  assert.equal(layout['--pc-surround'], '#262626');
  assert.equal(layout['--pc-border'], '#4a4a4a');
  assert.equal(layout['--pc-text'], '#e8e8e8');
  assert.equal(layout['--pc-accent'], '#378ef0');
  assert.equal(resolve(layout['--bg-2']), '#323232');
  assert.equal(resolve(layout['--bg-1']), '#262626');
  assert.equal(resolve(layout['--border']), '#4a4a4a');
  assert.equal(resolve(layout['--fg']), '#e8e8e8');
  assert.equal(resolve(layout['--accent']), '#378ef0');
  assert.equal(resolve(layout['--accent-primary']), '#378ef0');
  assert.equal(resolve(layout.background), '#262626');
  assert.equal(resolve(layout.color), '#e8e8e8');
});

test('panels, tool column, menu bar, options bar, and status bar are #323232', () => {
  for (const sel of ['.left-panel', '.dock', '.menu-bar', '.options-bar', '.status-bar']) {
    assert.equal(resolve(rule(sel).background), '#323232', sel);
  }
});

test('tab strips and the canvas surround are #262626', () => {
  assert.equal(resolve(rule('.doc-tab').background), '#262626');
  assert.equal(resolve(rule('.dock-tabs').background), '#262626');
  assert.equal(resolve(rule('#canvas-area').background), '#262626');
});

test('borders are #4a4a4a and the active tool uses the accent', () => {
  for (const sel of ['.dock', '.status-bar', '.doc-tab']) {
    const d = rule(sel);
    const border = d['border-left'] || d['border-top'] || d['border-bottom'] || d.border;
    assert.match(border, /var\(--border\)/, sel);
  }
  const active = rule('.tool-btn.active');
  assert.equal(resolve(active['border-color']), '#378ef0');
});

test('the canvas keeps a checkerboard behind transparent pixels', () => {
  const stack = rule('.canvas-stack');
  assert.match(stack['background-image'], /linear-gradient/);
});

test('brand.css is not given the PhotoCraft palette', () => {
  assert.doesNotMatch(brand, /#323232|#378ef0/i);
  assert.doesNotMatch(css, /^:root\s*\{[^}]*#323232/m);
});
