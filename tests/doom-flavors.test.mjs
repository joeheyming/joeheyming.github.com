// Doom flavor picker wiring: every named flavor in the controller must
// have a picker card, a mode-switch allowlist entry, and switcher items.

import assert from 'node:assert/strict';
import { existsSync, readFileSync, statSync } from 'node:fs';
import { describe, it } from 'node:test';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const html = readFileSync(path.join(ROOT, 'doom/index.html'), 'utf8');
const controller = readFileSync(path.join(ROOT, 'doom/flavor-controller.js'), 'utf8');
const modeSwitch = readFileSync(path.join(ROOT, 'doom/mode-switch.js'), 'utf8');

const EXPECTED = ['classic', 'freedoom', 'legend', 'mario', 'metroid', 'castlevania', 'sonic'];

describe('doom flavors', () => {
  it('lists sonic alongside the other flavors in mode-switch, controller, and HTML', () => {
    for (const flavor of EXPECTED) {
      assert.match(modeSwitch, new RegExp(`\\b${flavor}: 1`));
      assert.match(controller, new RegExp(`${flavor}: \\{`));
      assert.match(html, new RegExp(`data-flavor="${flavor}"`));
      const switchHits = html.match(new RegExp(`data-switch="${flavor}"`, 'g')) || [];
      assert.equal(switchHits.length, 2, `${flavor} should appear in both flavor switcher menus`);
    }
  });

  it('ships the Sonic Legacy PK3 next to the other bundled mods', () => {
    const pk3 = path.join(ROOT, 'doom/sonicdoom-legacy.pk3');
    assert.equal(existsSync(pk3), true);
    const bytes = statSync(pk3).size;
    assert.ok(bytes > 10 * 1024 * 1024, 'PK3 should be a real archive, not a stub');
    assert.ok(bytes < 80 * 1024 * 1024, 'PK3 must stay under GitHub 100 MB limit');
    assert.match(controller, /modUrl: 'sonicdoom-legacy\.pk3'/);
    assert.match(controller, /bundledIwad: 'freedoom2\.wad'/);
  });

  it('redirects /sonic-doom/ to the flavor URL and keeps it noindex', () => {
    const stub = readFileSync(path.join(ROOT, 'sonic-doom/index.html'), 'utf8');
    assert.match(stub, /noindex/);
    assert.match(stub, /flavor=sonic/);
    assert.match(stub, /location\.replace/);
  });
});
