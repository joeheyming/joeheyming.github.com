// Static view of what a page downloads before any interaction: its
// non-async <script src> tags, inline module imports, and every static
// `import ... from` / `export ... from` they reach, plus the shared chrome
// /site.js inserts on load. Dynamic import() and scripts injected later are
// the lazy part and are not followed.

import { existsSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { JSDOM } from 'jsdom';
import { SHARED_SCRIPTS } from '../scripts/site-boot.mjs';

export const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

const STATIC_IMPORT =
  /^\s*(?:import|export)\s+(?:type\s+)?(?:[\w$*{}\s,]+?\s+from\s+)?['"]([^'"]+)['"]/gm;

/**
 * @param {string} source
 * @returns {string[]}
 */
export function staticImportSpecifiers(source) {
  const withoutBlockComments = source.replace(/\/\*[\s\S]*?\*\//g, '');
  const specs = [];
  for (const match of withoutBlockComments.matchAll(STATIC_IMPORT)) specs.push(match[1]);
  return specs;
}

/**
 * Resolve a script or import specifier to a repo file, or null when it is
 * cross-origin, bare, or missing. A bare name is a relative URL in an HTML
 * src attribute but a package name in a module import.
 * @param {string} spec
 * @param {string} fromDir absolute directory of the referencing file
 * @param {boolean} [bareIsRelative]
 * @returns {string | null}
 */
export function resolveLocal(spec, fromDir, bareIsRelative = false) {
  if (/^[a-z]+:/i.test(spec) || spec.startsWith('//')) return null;
  const clean = spec.split(/[?#]/)[0];
  let file;
  if (clean.startsWith('/')) file = path.join(ROOT, clean);
  else if (clean.startsWith('.') || bareIsRelative) file = path.resolve(fromDir, clean);
  else return null;
  if (existsSync(file) && statSync(file).isDirectory()) file = path.join(file, 'index.js');
  return existsSync(file) ? file : null;
}

/**
 * @param {string} pagePath repo-relative page directory or HTML file, e.g. 'doom/'
 * @returns {{ file: string, bytes: number }[]} eager files sorted by size, largest first
 */
export function eagerScripts(pagePath) {
  const htmlFile = pagePath.endsWith('.html')
    ? path.join(ROOT, pagePath)
    : path.join(ROOT, pagePath, 'index.html');
  const htmlDir = path.dirname(htmlFile);
  const { document } = new JSDOM(readFileSync(htmlFile, 'utf8')).window;

  /** @type {Set<string>} */
  const seen = new Set();
  /** @type {string[]} */
  const queue = [];

  /**
   * @param {string} spec
   * @param {string} fromDir
   * @param {boolean} followImports
   * @param {boolean} [fromHtml]
   */
  function add(spec, fromDir, followImports, fromHtml = false) {
    const file = resolveLocal(spec, fromDir, fromHtml);
    if (!file || seen.has(file)) return;
    seen.add(file);
    if (followImports) queue.push(file);
  }

  for (const script of document.querySelectorAll('script')) {
    const type = script.getAttribute('type') || '';
    if (type && type !== 'module' && type !== 'text/javascript') continue;
    const isModule = type === 'module';
    const src = script.getAttribute('src');
    if (src) {
      if (script.hasAttribute('async')) continue;
      add(src, htmlDir, isModule, true);
      // /site.js inserts the shared chrome at once; count it as eager.
      if (src === '/site.js') {
        const skip = (script.getAttribute('data-skip') || '').split(/\s+/);
        for (const name of SHARED_SCRIPTS) {
          if (!skip.includes(name)) add(`/${name}.js`, htmlDir, false, true);
        }
      }
    } else if (isModule) {
      for (const spec of staticImportSpecifiers(script.textContent || '')) add(spec, htmlDir, true);
    }
  }

  while (queue.length) {
    const file = /** @type {string} */ (queue.shift());
    const source = readFileSync(file, 'utf8');
    for (const spec of staticImportSpecifiers(source)) add(spec, path.dirname(file), true);
  }

  return [...seen]
    .map((file) => ({ file: path.relative(ROOT, file), bytes: statSync(file).size }))
    .sort((a, b) => b.bytes - a.bytes);
}

/**
 * @param {{ bytes: number }[]} files
 * @returns {number}
 */
export function totalBytes(files) {
  return files.reduce((sum, f) => sum + f.bytes, 0);
}
