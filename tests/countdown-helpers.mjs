import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

export const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

/** shared-styles.js as a classic script, so jsdom's eval gets its helpers as globals. */
export function sharedHelpersSource() {
  return readFileSync(path.join(ROOT, 'countdown/components/shared-styles.js'), 'utf8')
    .replace(/^export default .*$/m, '')
    .replace(/^export function /gm, 'function ')
    .replace(/^export const /gm, 'var ');
}

/** A countdown component file with its imports removed and its class put on window. */
export function componentSource(relativePath, className) {
  return readFileSync(path.join(ROOT, relativePath), 'utf8')
    .replace(/^import [\s\S]*?;\n/gm, '')
    .replace(new RegExp(`^export default ${className};?$`, 'm'), '')
    .replace(/^export (class|function|const) /gm, '$1 ')
    .concat(`\nwindow.${className} = ${className};\n`);
}
