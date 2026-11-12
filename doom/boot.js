// Picker boot. The flavor picker needs none of the loader, input, moddb,
// or proxy code: flavor-controller.js imports the loader on launch, and
// the loader brings touch and gamepad input with it. Manual mode is the
// loader's own panel plus the mod browser, so it loads them up front.

import { loadScript, preloadOnIntent } from '/shared/lazy.js';
import { mountDoomChat } from './live-chat-mount.js';

const LAUNCH_MODULES = [
  './uzdoom-loader.js',
  './engine.js',
  './touch-input.js',
  './gamepad-input.js',
  './uzdoom-loader-engine.js'
].map((spec) => new URL(spec, import.meta.url).href);

const manual = new URLSearchParams(window.location.search).get('manual');
if (manual === '1' || manual === 'browse') {
  // The mod browser fetches through window.proxyService and reads the
  // archive and IWAD globals, so those publish first.
  loadScript('/proxy.js')
    .then(() => import('./uzdoom-loader.js'))
    .then(() => import('./moddb-archive.js'))
    .then(() => import('./moddb-iwad.js'))
    .then(() => import('./moddb-browser.js'))
    .catch((err) => {
      console.warn('[doom] manual mode did not load:', err);
    });
} else {
  for (const id of ['flavorPicker', 'cleanHero']) {
    const el = document.getElementById(id);
    if (el) preloadOnIntent(el, LAUNCH_MODULES, { module: true });
  }
}

const whenIdle = window.requestIdleCallback || ((fn) => setTimeout(fn, 1));
whenIdle(() => {
  void mountDoomChat();
});
