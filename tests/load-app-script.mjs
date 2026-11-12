// Run the site's classic scripts in jsdom the way a page would.
//
// Classic scripts publish `window.*` globals and are evaluated with
// `window.eval`. A site-absolute dynamic import such as
// `import('/shared/lazy.js')` cannot resolve inside jsdom, so the source is
// rewritten to call `window.__appImport`, which serves modules from the
// `imports` map. The default `/shared/lazy.js` evaluates requested scripts
// from the repo, so lazy paths run the real files.

import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { JSDOM } from 'jsdom';
import { ROOT } from './import-graph-helpers.mjs';

/** @type {Map<string, string>} */
const sources = new Map();

/**
 * Repo file contents, read once per test process.
 * @param {string} rel repo-relative or site-absolute path
 */
export function readSource(rel) {
  const key = rel.replace(/^\//, '');
  let src = sources.get(key);
  if (src === undefined) {
    src = readFileSync(join(ROOT, key), 'utf8');
    sources.set(key, src);
  }
  return src;
}

/**
 * @param {string} src
 */
function routeImports(src) {
  return src.replace(/\bimport\((?=\s*['"]\/)/g, 'window.__appImport(');
}

/**
 * Evaluate classic scripts in order, as parser-inserted tags would run.
 * @param {import('jsdom').DOMWindow} window
 * @param {...string} files repo-relative or site-absolute paths
 */
export function loadClassic(window, ...files) {
  for (const file of files) window.eval(routeImports(readSource(file)));
}

/**
 * A `/shared/lazy.js` stand-in that evaluates scripts from the repo and
 * records what was loaded or preloaded.
 * @param {import('jsdom').DOMWindow} window
 */
function jsdomLazy(window) {
  /** @type {Map<string, Promise<void>>} */
  const loaded = new Map();
  /** @param {string} src */
  const loadScript = (src) => {
    const path = new URL(src, window.location.href).pathname;
    let p = loaded.get(path);
    if (!p) {
      p = existsSync(join(ROOT, path))
        ? Promise.resolve().then(() => {
            window.__loadedScripts.push(path);
            loadClassic(window, path);
          })
        : Promise.reject(new Error('no such script: ' + path));
      loaded.set(path, p);
    }
    return p;
  };
  return {
    loadScript,
    /** @param {string[]} srcs */
    async loadScriptsInOrder(srcs) {
      for (const src of srcs) await loadScript(src);
    },
    /** @template T @param {() => Promise<T>} load */
    once(load) {
      /** @type {Promise<T> | null} */
      let p = null;
      return () => (p ??= load().catch((e) => ((p = null), Promise.reject(e))));
    },
    /** @param {string[]} urls */
    preload(urls) {
      window.__preloaded.push(...urls);
    },
    /** @param {EventTarget} target @param {string[]} urls */
    preloadOnIntent(target, urls) {
      const fire = () => {
        target.removeEventListener('pointerover', fire);
        target.removeEventListener('keydown', fire);
        window.__preloaded.push(...urls);
      };
      target.addEventListener('pointerover', fire);
      target.addEventListener('keydown', fire);
      return fire;
    }
  };
}

/**
 * A jsdom window ready for classic app scripts: `matchMedia` and
 * `WebAssembly` present, and site-absolute imports routed through
 * `imports` (which overrides the default `/shared/lazy.js`).
 * @param {string} html
 * @param {{ url?: string, imports?: Record<string, object> }} [opts]
 */
export function appWindow(html, opts = {}) {
  const { window } = new JSDOM(html, {
    runScripts: 'outside-only',
    url: opts.url ?? 'https://joeheyming.github.io/'
  });
  if (typeof window.WebAssembly === 'undefined') window.WebAssembly = WebAssembly;
  if (typeof window.matchMedia !== 'function') {
    window.matchMedia = () => ({
      matches: false,
      addEventListener() {},
      removeEventListener() {}
    });
  }
  window.__loadedScripts = [];
  window.__preloaded = [];
  /** @type {Record<string, object>} */
  const imports = { '/shared/lazy.js': jsdomLazy(window), ...opts.imports };
  /** @param {string} spec */
  window.__appImport = (spec) =>
    spec in imports
      ? Promise.resolve(imports[spec])
      : Promise.reject(new Error('not available in jsdom: ' + spec));
  return window;
}
