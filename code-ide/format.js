/**
 * format.js — Prettier wrapper. Picks the right parser/plugins for a language.
 * Falls back to Monaco's built-in formatter if Prettier doesn't handle the
 * language.
 */

import { prettierParserFor } from './editor.js';

function plugins() {
  return [
    window.prettierPlugins?.estree,
    window.prettierPlugins?.babel,
    window.prettierPlugins?.typescript,
    window.prettierPlugins?.postcss,
    window.prettierPlugins?.html,
    window.prettierPlugins?.markdown
  ].filter(Boolean);
}

export async function formatWithPrettier(source, language) {
  const parser = prettierParserFor(language);
  if (!parser || !window.prettier) return null;
  try {
    return await window.prettier.format(source, {
      parser,
      plugins: plugins(),
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
