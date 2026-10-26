import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const read = (name) => readFileSync(new URL(`../paint/${name}`, import.meta.url), 'utf8');

test('index.html loads dock.css and panels.css after style.css', () => {
  const html = read('index.html');
  const style = html.indexOf('href="style.css"');
  const dock = html.indexOf('href="dock.css"');
  const panels = html.indexOf('href="panels.css"');
  assert.ok(style > 0 && dock > style && panels > dock);
});

test('dock shell lives in dock.css; layers and history live in panels.css', () => {
  const style = read('style.css');
  const dock = read('dock.css');
  const panels = read('panels.css');

  assert.match(dock, /\n\.dock \{/);
  assert.match(dock, /\n\.dock-group-fill \{/);
  assert.match(dock, /\n\.dock-tabs \{/);
  assert.match(dock, /\n\.color-values \{/);

  assert.match(panels, /#panel-layers:not\(\[hidden\]\) \{/);
  assert.match(panels, /\n\.layer-list \{/);
  assert.match(panels, /\n\.history-list \{/);
  assert.match(panels, /\n\.channel-list \{/);
  assert.match(panels, /\n\.path-list \{/);

  // Layout chrome stays in style; panel Modules do not.
  assert.doesNotMatch(style, /\n\.layer-list \{/);
  assert.doesNotMatch(style, /\n\.history-list \{/);
  assert.doesNotMatch(style, /\n\.channel-list \{/);
  assert.doesNotMatch(style, /\n\.path-list \{/);
  // Top-level dock shell (mobile media queries may still hide .dock).
  assert.doesNotMatch(style, /\n\.dock \{/);
  assert.doesNotMatch(style, /\n\.dock-group-fill \{/);
});
