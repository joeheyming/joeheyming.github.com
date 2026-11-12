// Engine scripts. The 700 KB uzdoom.js parse blocks the main thread, so
// it stays unloaded until a launch asks for it. Cross-origin isolation is
// still required before it runs; if COI never arrives the promise rejects
// and coi.js has already shown the error. module-stub.js must already
// have installed window.Module, which uzdoom.js merges into.

import { loadScriptsInOrder, once } from '/shared/lazy.js';
import { UZDoomCOI } from './coi.js';

export const ENGINE_SCRIPTS = [
  new URL('./uzdoom-melt.js', import.meta.url).href,
  new URL('./uzdoom.js', import.meta.url).href
];

/** Load melt and uzdoom.js once, after COI. Later calls share the promise. */
export const ensureEngine = once(async () => {
  await UZDoomCOI.whenReady();
  await loadScriptsInOrder(ENGINE_SCRIPTS);
});
