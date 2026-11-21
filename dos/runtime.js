// js-dos and JSZip are only needed once a game is packed or launched.
// Loading them with the catalog was a multi-second main-thread task.

const JSZIP_SRC = 'https://cdn.jsdelivr.net/npm/jszip@3.10.1/dist/jszip.min.js';
const JSDOS_SRC = 'https://cdn.jsdelivr.net/npm/js-dos@8.3.20/dist/js-dos.js';

async function loadInOrder(srcs) {
  const { loadScriptsInOrder } = await import('/shared/lazy.js');
  return loadScriptsInOrder(srcs);
}

export function ensureJsZip() {
  return loadInOrder([JSZIP_SRC]);
}

export function ensureDosRuntime() {
  return loadInOrder([JSZIP_SRC, JSDOS_SRC]);
}
