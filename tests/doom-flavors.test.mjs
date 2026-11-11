// Doom flavor picker wiring: every named flavor in the controller must
// have a picker card, a mode-switch allowlist entry, and switcher items.

import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { describe, it } from 'node:test';
import { fileURLToPath } from 'node:url';
import { JSDOM } from 'jsdom';
import path from 'node:path';
import vm from 'node:vm';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const html = readFileSync(path.join(ROOT, 'doom/index.html'), 'utf8');
const controller = readFileSync(path.join(ROOT, 'doom/flavor-controller.js'), 'utf8');
const modeSwitch = readFileSync(path.join(ROOT, 'doom/mode-switch.js'), 'utf8');
const catalog = readFileSync(path.join(ROOT, 'doom/flavors.js'), 'utf8');

function mountFlavors() {
  const dom = new JSDOM(
    '<!DOCTYPE html><html><head></head><body>' +
      '<section id="flavorPicker"></section>' +
      '<div class="flavor-switch-menu"><div class="flavor-switch-sep"></div></div>' +
      '<div class="flavor-switch-menu"><div class="flavor-switch-sep"></div></div>' +
      '</body></html>',
    { url: 'https://joeheyming.github.io/doom/', runScripts: 'outside-only' }
  );
  vm.runInContext(catalog, dom.getInternalVMContext());
  dom.window.DoomFlavors.mount(dom.window.document);
  return dom;
}

function sliceFlavor(id, nextId) {
  const start = catalog.indexOf("id: '" + id + "'");
  const end = nextId ? catalog.indexOf("id: '" + nextId + "'") : catalog.length;
  assert.ok(start > -1 && end > start, id);
  return catalog.slice(start, end);
}

describe('doom flavors', () => {
  it('builds a card and both switchers from the flavor list', () => {
    const dom = mountFlavors();
    const doc = dom.window.document;
    const ids = dom.window.DOOM_FLAVORS.map((flavor) => flavor.id);
    assert.ok(ids.includes('sigil') && ids.includes('sigil2') && ids.includes('witching'));
    assert.match(html, /src="flavors\.js"/);
    assert.match(modeSwitch, /DOOM_FLAVORS/);
    assert.match(controller, /DoomFlavors\.mount/);
    for (const id of ids) {
      assert.equal(doc.querySelectorAll(`[data-flavor="${id}"]`).length, 1, id);
      assert.equal(doc.querySelectorAll(`[data-switch="${id}"]`).length, 2, id);
    }
    const focus = doc.querySelector('[data-initial-focus]');
    assert.equal(focus && focus.getAttribute('data-flavor'), 'classic');
  });

  it('pushes ?flavor= so Back returns to the picker', async () => {
    const dom = mountFlavors();
    dom.window.UZDoomLoader = {
      primeWith() {
        return Promise.resolve();
      },
      launch() {}
    };
    dom.window.fetch = () => Promise.reject(new Error('no network'));
    const backed = new Promise((resolve) => {
      dom.window.addEventListener('popstate', () => resolve(dom.window.location.search), {
        once: true
      });
    });
    vm.runInContext(controller, dom.getInternalVMContext());
    dom.window.document.dispatchEvent(new dom.window.Event('DOMContentLoaded'));
    const before = dom.window.history.length;
    dom.window.document.querySelector('[data-flavor="mario"]').click();
    assert.equal(dom.window.location.pathname, '/doom/');
    assert.equal(dom.window.location.search, '?flavor=mario');
    assert.ok(dom.window.history.length > before, 'picker stays in history behind the flavor');
    dom.window.history.back();
    assert.equal(await backed, '');
  });

  it('keeps MarioDoom on Freedoom Phase 1 and fetches Mayhem maps', () => {
    const mario = sliceFlavor('mario', 'mayhem');
    assert.match(mario, /modUrl: MOD_BASE \+ 'mariodoom\.pk3'/);
    assert.doesNotMatch(mario, /freedoom2/);
    assert.doesNotMatch(mario, /mayhem17/);
    const mayhem = sliceFlavor('mayhem', 'metroid');
    assert.match(mayhem, /bundledIwad: 'freedoom2\.wad'/);
    assert.match(mayhem, /mayhem17\.zip/);
    const wadOrder = mayhem.indexOf('mayhem17.wad');
    const updateOrder = mayhem.indexOf('mayhem17_updatev1.wad');
    assert.ok(wadOrder > -1 && updateOrder > wadOrder, 'update wad loads after the campaign');
    const gitignore = readFileSync(path.join(ROOT, '.gitignore'), 'utf8');
    assert.match(gitignore, /^\*\.wad$/m);
    assert.equal(existsSync(path.join(ROOT, 'doom/mayhem17.wad')), false);
  });

  it('fetches Batman DOOM as a wad plus its DeHackEd patch', () => {
    const batman = sliceFlavor('batman', 'zombies');
    assert.match(batman, /bundledIwad: 'freedoom2\.wad'/);
    assert.match(batman, /themes\/batman\/batman\.zip/);
    assert.match(batman, /label: 'batman\.zip'/);
    const wadOrder = batman.indexOf('batman.wad');
    const dehOrder = batman.indexOf('batman.deh');
    assert.ok(wadOrder > -1 && dehOrder > wadOrder, 'dehacked loads after the wad');
    assert.doesNotMatch(batman, /dehacked\.exe/);
    assert.equal(existsSync(path.join(ROOT, 'doom/batman.wad')), false);
    assert.match(controller, /zip\.label \|\| 'map pack'/);
  });

  it('fetches Sigil and Witching Hour without stacking the two Sigil wads', () => {
    const sigil = sliceFlavor('sigil', 'sigil2');
    const sigil2 = sliceFlavor('sigil2', 'witching');
    const witching = sliceFlavor('witching');
    assert.match(sigil, /sigil_v1_23\.zip/);
    assert.match(sigil, /SIGIL_V1_23\.wad/);
    assert.doesNotMatch(sigil, /SIGIL_II/);
    assert.doesNotMatch(sigil, /freedoom2/);
    assert.match(sigil2, /sigil_ii_v1_0\.zip/);
    assert.match(sigil2, /SIGIL_II_V1_0\.WAD/);
    assert.match(witching, /witchinghour\.zip/);
    assert.match(witching, /bundledIwad: 'freedoom2\.wad'/);
    assert.equal(existsSync(path.join(ROOT, 'doom/SIGIL_V1_23.wad')), false);
  });

  it('fetches Pokémon DOOM from the inner archive zip, not the video bundle', () => {
    const pokemon = sliceFlavor('pokemon');
    assert.match(pokemon, /bundledIwad: 'freedoom2\.wad'/);
    assert.match(
      pokemon,
      /archive\.org\/download\/pokemon-doom-wad\/pokemon-doom-wad\.zip\/pokemon-doom-wad\.zip/
    );
    assert.match(pokemon, /pkmnv9r\.wad/);
    assert.doesNotMatch(pokemon, /Read Me/);
    assert.doesNotMatch(pokemon, /\.mp4/);
    assert.equal(existsSync(path.join(ROOT, 'doom/pkmnv9r.wad')), false);
  });

  it('fetches the short block and Roblox maps without their unfinished extras', () => {
    const doomcraft = sliceFlavor('doomcraft', 'lego');
    const lego = sliceFlavor('lego', 'blockfort');
    const fort = sliceFlavor('blockfort', 'roblox');
    const roblox = sliceFlavor('roblox', 'pokemon');
    assert.match(doomcraft, /dmcraft\.zip/);
    assert.match(doomcraft, /DMCRAFT\.wad/);
    assert.match(lego, /legob-sp\.zip/);
    assert.match(lego, /legob-sp\.wad/);
    assert.match(fort, /bfremade\.zip/);
    assert.match(fort, /Music&Textures\.pk3/);
    const pk3 = fort.indexOf('Music&Textures.pk3');
    const wad = fort.indexOf('BDremade.wad');
    assert.ok(pk3 > -1 && wad > pk3, 'textures load before the map');
    assert.match(roblox, /spykid\.zip/);
    assert.match(roblox, /spykid\.wad/);
    for (const record of [doomcraft, lego, fort, roblox]) {
      assert.match(record, /bundledIwad: 'freedoom2\.wad'/);
    }
  });

  it('fetches the Zombies campaign as a wad plus its DeHackEd patch', () => {
    const zombies = sliceFlavor('zombies', 'sigil');
    assert.match(zombies, /bundledIwad: 'freedoom2\.wad'/);
    assert.match(zombies, /v-z\/zombies\.zip/);
    assert.match(zombies, /label: 'zombies\.zip'/);
    const wadOrder = zombies.indexOf('zombie.wad');
    const dehOrder = zombies.indexOf('zombie.deh');
    assert.ok(wadOrder > -1 && dehOrder > wadOrder, 'dehacked loads after the wad');
    assert.doesNotMatch(zombies, /\.exe/);
    assert.equal(existsSync(path.join(ROOT, 'doom/zombie.wad')), false);
  });

  it('fetches gameplay pk3s from the pinned commit and leaves them out of the tree', () => {
    const gitignore = readFileSync(path.join(ROOT, '.gitignore'), 'utf8');
    const mods = [
      'LegendOfDoom-1.1.0.pk3',
      'mariodoom.pk3',
      'met2.pk3',
      'Castlevania.ipk3',
      'sonicdoom-legacy.pk3'
    ];
    assert.match(catalog, /73875b5e91f8780dd663c6620f5e530f110eddda/);
    assert.match(catalog, /raw\.githubusercontent\.com\/joeheyming\/joeheyming\.github\.com\//);
    for (const name of mods) {
      assert.match(gitignore, new RegExp('^/doom/' + name.replace(/\./g, '\\.') + '$', 'm'), name);
      assert.equal(existsSync(path.join(ROOT, 'doom', name)), false, name);
    }
    assert.match(sliceFlavor('sonic', 'batman'), /MOD_BASE \+ 'sonicdoom-legacy\.pk3'/);
    assert.match(sliceFlavor('sonic', 'batman'), /bundledIwad: 'freedoom2\.wad'/);
    assert.match(sliceFlavor('castlevania', 'sonic'), /iwadUrl: MOD_BASE \+ 'Castlevania\.ipk3'/);
    assert.equal(existsSync(path.join(ROOT, 'doom/uzdoom.pk3')), true);
  });

  it('redirects /sonic-doom/ to the flavor URL and keeps it noindex', () => {
    const stub = readFileSync(path.join(ROOT, 'sonic-doom/index.html'), 'utf8');
    assert.match(stub, /noindex/);
    assert.match(stub, /flavor=sonic/);
    assert.match(stub, /location\.replace/);
  });

  it('counts a flavor click before the engine starts, and the analytics event after', () => {
    assert.match(
      controller,
      /function trackLaunchWhenPlaying[\s\S]*state\.phase === 'playing'[\s\S]*trackDoomEvent\(\s*'doom_engine_launched'/
    );
    assert.match(controller, /trackLaunchWhenPlaying\(flavor, 'autolaunch', tStart\)/);
    assert.match(controller, /trackLaunchWhenPlaying\(flavor, 'picker', tStart\)/);
    const handler = controller.slice(
      controller.indexOf('function trackLaunchWhenPlaying'),
      controller.indexOf('function waitForLoader')
    );
    assert.doesNotMatch(handler, /recordDoomPlay/);
    const cardClick = controller.slice(
      controller.indexOf("card.addEventListener('click'"),
      controller.indexOf('await primeFlavor')
    );
    assert.match(cardClick, /recordDoomClick\(flavor\)/);
    const heroClick = controller.slice(
      controller.indexOf("btn.addEventListener('click'"),
      controller.indexOf("trackLaunchWhenPlaying(flavor, 'autolaunch'")
    );
    assert.match(heroClick, /recordDoomClick\(flavor\)/);
    assert.equal(
      (controller.match(/trackDoomEvent\(\s*'doom_engine_launched'/g) || []).length,
      1,
      'the lifecycle subscriber should be the only success-event emitter'
    );
  });
});
