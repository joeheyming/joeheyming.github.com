/**
 * format.js — Prettier wrapper. Picks the right parser/plugins for a language.
 * Falls back to Monaco's built-in formatter if Prettier doesn't handle the
 * language.
 */

import { prettierParserFor } from './editor.js';

const PRETTIER_PLUGIN_BASE = 'https://unpkg.com/prettier@3.2.5/plugins/';

/** @type {Record<string, string[]>} */
const PLUGINS_FOR_PARSER = {
  babel: ['estree', 'babel'],
  typescript: ['estree', 'typescript'],
  json: ['estree', 'babel'],
  css: ['postcss'],
  html: ['html'],
  markdown: ['markdown']
};

/** @type {Map<string, Promise<void>>} */
const pluginLoads = new Map();

/**
 * UMD plugins prefer AMD `define` when Monaco has installed one, and then
 * fail to register. Hide it for the duration of this script's evaluation.
 * @param {string} name
 * @returns {Promise<void>}
 */
function loadPrettierPlugin(name) {
  const existing = pluginLoads.get(name);
  if (existing) return existing;
  const promise = new Promise((resolve, reject) => {
    const previousDefine = window.define;
    window.define = undefined;
    const script = document.createElement('script');
    script.src = `${PRETTIER_PLUGIN_BASE}${name}.js`;
    const restore = () => {
      window.define = previousDefine;
    };
    script.onload = () => {
      restore();
      resolve();
    };
    script.onerror = () => {
      restore();
      pluginLoads.delete(name);
      reject(new Error(`Could not load the Prettier ${name} plugin`));
    };
    document.head.appendChild(script);
  });
  pluginLoads.set(name, promise);
  return promise;
}

/**
 * @param {string} parser
 * @returns {Promise<unknown[]>}
 */
async function pluginsFor(parser) {
  const names = PLUGINS_FOR_PARSER[parser] || [];
  for (const name of names) {
    if (window.prettierPlugins?.[name]) continue;
    await loadPrettierPlugin(name);
  }
  return names.map((name) => window.prettierPlugins?.[name]).filter(Boolean);
}

export async function formatWithPrettier(source, language) {
  const parser = prettierParserFor(language);
  if (!parser || !window.prettier) return null;
  try {
    const plugins = await pluginsFor(parser);
    return await window.prettier.format(source, {
      parser,
      plugins,
      printWidth: 100,
      tabWidth: 2,
      singleQuote: language === 'json' ? false : true,
      trailingComma: 'es5',
      semi: true
    });
  } catch (err) {
    console.warn('[code-ide] prettier failed', err);
    throw err;
  }
}

export function canPrettier(language) {
  return !!prettierParserFor(language);
}
