// Class tokens the StepMania page puts on light-DOM nodes. The Tailwind CDN
// rebuilds its entire stylesheet the first time it sees a class it has not
// seen before, so the page lists these on one element before that first build.

import { readFileSync, readdirSync, statSync } from 'node:fs';
import path from 'node:path';

const CLASS_ATTR = /class\s*=\s*(?:"([^"]*)"|'([^']*)'|`([^`]*)`)/gs;
const CLASS_LIST = /classList\.(?:add|remove|toggle)\(([^)]*)\)/g;
const CLASS_NAME = /\.className\s*=\s*(?:"([^"]*)"|'([^']*)'|`([^`]*)`)/g;
const TOKEN = /^-?[A-Za-z_][A-Za-z0-9_:./%[\]-]*$/;

/**
 * @param {string} text
 * @param {Set<string>} into
 */
function addTokens(text, into) {
  for (const raw of text.split(/\s+/)) {
    const token = raw.trim();
    if (!token || token.length >= 80 || !TOKEN.test(token)) continue;
    // `tone-${name}` leaves the unfinished prefix `tone-`. It is not a class.
    if (/[-/:.]$/.test(token)) continue;
    into.add(token);
  }
}

/**
 * Static pieces of a class string, plus string literals inside ${}.
 * @param {string} body
 * @param {Set<string>} into
 */
function addClassText(body, into) {
  for (const part of body.split(/\$\{[^}]*\}/)) addTokens(part, into);
  for (const interp of body.match(/\$\{[^}]*\}/g) || []) {
    for (const quoted of interp.match(/'([^'\\]*)'|"([^"\\]*)"/g) || []) {
      addTokens(quoted.slice(1, -1), into);
    }
  }
}

/**
 * @param {string} text
 * @param {Set<string>} into
 */
function collectFromSource(text, into) {
  for (const match of text.matchAll(CLASS_ATTR))
    addClassText(match[1] ?? match[2] ?? match[3] ?? '', into);
  for (const match of text.matchAll(CLASS_LIST)) {
    for (const quoted of match[1].match(/'([^'\\]*)'|"([^"\\]*)"/g) || []) {
      addTokens(quoted.slice(1, -1), into);
    }
  }
  for (const match of text.matchAll(CLASS_NAME)) {
    addClassText(match[1] ?? match[2] ?? match[3] ?? '', into);
  }
}

/**
 * @param {string} dir
 * @param {string[]} out
 */
function walk(dir, out) {
  for (const name of readdirSync(dir)) {
    if (name === 'test' || name === 'node_modules') continue;
    const full = path.join(dir, name);
    if (statSync(full).isDirectory()) walk(full, out);
    else if (/\.(html|js|mjs)$/.test(name)) out.push(full);
  }
  return out;
}

/**
 * @param {string} stepmaniaDir
 * @returns {string[]}
 */
export function collectStepmaniaClasses(stepmaniaDir) {
  /** @type {Set<string>} */
  const tokens = new Set();
  for (const file of walk(stepmaniaDir, [])) {
    let text = readFileSync(file, 'utf8');
    if (file.endsWith(`${path.sep}index.html`)) {
      text = text.replace(/<div id="sm-tailwind-safelist"[\s\S]*?<\/div>/, '');
    }
    collectFromSource(text, tokens);
  }
  return [...tokens].sort();
}
