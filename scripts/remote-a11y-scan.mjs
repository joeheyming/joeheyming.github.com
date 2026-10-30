#!/usr/bin/env node
/**
 * Scan pages for controls a TV remote cannot operate.
 *
 * The Heyming OS Android TV shell moves the D-pad with Chromium spatial
 * navigation, which only lands on focusable elements (links, buttons,
 * inputs, and tabindex >= 0). OK and Play call element.click() on whatever
 * is focused. On the Watch player URL, Play sends "k" instead.
 *
 * This is not a WCAG audit. axe would not catch these.
 *
 *   node scripts/remote-a11y-scan.mjs
 *   node scripts/remote-a11y-scan.mjs --json
 *
 * Exit 1 when any control is unreachable. Informational notes (play key,
 * D-pad handlers) do not fail the run.
 */
import { existsSync, readFileSync, readdirSync } from 'fs';
import { dirname, join, relative, resolve } from 'path';
import { fileURLToPath } from 'url';
import { JSDOM } from 'jsdom';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');

const SKIP_DIRS = new Set(['node_modules', '.git', 'tests', 'coverage', 'dist']);

/** Tags the remote can focus without an author tabindex. */
const NATIVE_FOCUSABLE = new Set(['button', 'input', 'select', 'textarea', 'summary']);

/**
 * Roles that are controls. Without tabindex they are still skipped by
 * spatial navigation.
 */
const INTERACTIVE_ROLES = new Set([
  'button',
  'checkbox',
  'link',
  'menuitem',
  'menuitemcheckbox',
  'menuitemradio',
  'option',
  'radio',
  'slider',
  'switch',
  'tab',
  'treeitem'
]);

/** One surface, not a list of controls. A tabindex would not reveal items inside. */
const SURFACE_TAGS = new Set([
  'audio',
  'body',
  'canvas',
  'head',
  'html',
  'iframe',
  'path',
  'script',
  'style',
  'svg',
  'video'
]);

/**
 * @typedef {Object} Finding
 * @property {'error'|'info'} severity
 * @property {'unreachable-click'|'unreachable-role'|'play-key'|'dpad-captured'} kind
 * @property {string} file
 * @property {number|null} line
 * @property {string} [id]
 * @property {string} message
 */

/**
 * @param {string} source
 * @returns {string}
 */
export function maskComments(source) {
  let out = '';
  let i = 0;
  /** @type {'code'|'sq'|'dq'|'tpl'|'line'|'block'} */
  let mode = 'code';
  while (i < source.length) {
    const c = source[i];
    const n = source[i + 1];
    if (mode === 'line') {
      if (c === '\n') {
        mode = 'code';
        out += c;
      } else {
        out += ' ';
      }
      i += 1;
      continue;
    }
    if (mode === 'block') {
      if (c === '*' && n === '/') {
        out += '  ';
        i += 2;
        mode = 'code';
        continue;
      }
      out += c === '\n' ? '\n' : ' ';
      i += 1;
      continue;
    }
    if (mode === 'sq' || mode === 'dq' || mode === 'tpl') {
      out += c;
      if (c === '\\' && n !== undefined) {
        out += n;
        i += 2;
        continue;
      }
      if (
        (mode === 'sq' && c === "'") ||
        (mode === 'dq' && c === '"') ||
        (mode === 'tpl' && c === '`')
      ) {
        mode = 'code';
      }
      i += 1;
      continue;
    }
    if (c === '/' && n === '/') {
      mode = 'line';
      out += '  ';
      i += 2;
      continue;
    }
    if (c === '/' && n === '*') {
      mode = 'block';
      out += '  ';
      i += 2;
      continue;
    }
    if (c === "'") mode = 'sq';
    else if (c === '"') mode = 'dq';
    else if (c === '`') mode = 'tpl';
    out += c;
    i += 1;
  }
  return out;
}

/**
 * @param {Element} el
 * @returns {boolean}
 */
export function isFocusable(el) {
  const tag = el.tagName.toLowerCase();
  if (tag === 'a' && el.hasAttribute('href')) return true;
  if (tag === 'input') {
    const type = (el.getAttribute('type') || 'text').toLowerCase();
    return type !== 'hidden';
  }
  if (NATIVE_FOCUSABLE.has(tag)) return true;
  if (el.getAttribute('contenteditable') && el.getAttribute('contenteditable') !== 'false') {
    return true;
  }
  const ti = el.getAttribute('tabindex');
  if (ti === null) return false;
  const trimmed = ti.trim();
  if (trimmed === '') return false;
  return Number(trimmed) >= 0;
}

/**
 * @param {string} html
 * @param {string} file
 * @returns {Finding[]}
 */
export function scanHtml(html, file) {
  const dom = new JSDOM(html);
  /** @type {Finding[]} */
  const findings = [];
  const elements = dom.window.document.querySelectorAll('*');
  for (const el of elements) {
    const tag = el.tagName.toLowerCase();
    if (SURFACE_TAGS.has(tag) || tag === 'label') continue;
    const onclick = el.getAttribute('onclick');
    const role = (el.getAttribute('role') || '').toLowerCase();
    const interactive = INTERACTIVE_ROLES.has(role);
    if (!onclick && !interactive) continue;
    if (isFocusable(el)) continue;
    const ti = el.getAttribute('tabindex');
    if (ti !== null && ti.trim() === '-1') continue;
    const id = el.id || '';
    const kind = onclick ? 'unreachable-click' : 'unreachable-role';
    const why = onclick
      ? 'has an onclick handler and is not focusable'
      : `has role="${role}" and is not focusable`;
    findings.push({
      severity: 'error',
      kind,
      file,
      id,
      line: locateHtml(html, el, onclick),
      message: describeElement(tag, id, el.getAttribute('class')) + ' ' + why
    });
  }
  return findings;
}

/**
 * @param {string} html
 * @returns {Map<string, { focusable: boolean, tag: string }>}
 */
export function indexHtmlIds(html) {
  const dom = new JSDOM(html);
  /** @type {Map<string, { focusable: boolean, tag: string }>} */
  const ids = new Map();
  for (const el of dom.window.document.querySelectorAll('[id]')) {
    ids.set(el.id, { focusable: isFocusable(el), tag: el.tagName.toLowerCase() });
  }
  return ids;
}

/**
 * @param {string} source
 * @param {string} file
 * @param {Map<string, { focusable: boolean, tag: string }>} [htmlIds]
 * @returns {{ findings: Finding[], focusableIds: Set<string> }}
 */
export function analyzeScript(source, file, htmlIds = new Map()) {
  const lines = maskComments(source).split('\n');
  const focusableIds = collectFocusableIds(lines);
  /** @type {Finding[]} */
  const findings = [];

  for (const binding of findBindings(lines)) {
    const end = bindingEnd(lines, binding.name, binding.start);
    const windowText = lines.slice(binding.start, end).join('\n');
    const html = binding.id ? htmlIds.get(binding.id) : undefined;
    // An id that is not in the page HTML was created in script. Its own
    // createElement binding is what says whether it is focusable.
    if (binding.id && !html) continue;
    const tag = binding.tag || (html ? html.tag : 'element');
    if (
      binding.id &&
      (nameHasTabIndex(windowText, binding.name) ||
        (tag === 'a' && nameHasHref(windowText, binding.name)))
    ) {
      focusableIds.add(binding.id);
    }
    const madeFocusable =
      NATIVE_FOCUSABLE.has(tag) ||
      (html && html.focusable) ||
      (binding.id !== '' && focusableIds.has(binding.id)) ||
      nameHasTabIndex(windowText, binding.name) ||
      (tag === 'a' && nameHasHref(windowText, binding.name));
    if (madeFocusable || SURFACE_TAGS.has(tag)) continue;
    // A full-screen dismiss layer should not join the D-pad order.
    if (isDismissLayer(binding.name, binding.id)) continue;

    for (const site of clickSites(lines, binding.name, binding.start, end)) {
      if (clickIsNotAControl(lines, site, end)) continue;
      const where = binding.id ? `#${binding.id}` : binding.name;
      findings.push({
        severity: 'error',
        kind: 'unreachable-click',
        file,
        id: binding.id || '',
        line: site + 1,
        message: `${tag} ${where} is given a click listener and is not focusable`
      });
    }
  }

  return { findings, focusableIds };
}

/**
 * @param {string} source
 * @param {string} file
 * @returns {Finding|null}
 */
export function scanDpad(source, file) {
  const lines = maskComments(source).split('\n');
  const joined = lines.join('\n');
  if (!/(document|window)\.addEventListener\(\s*['"]keydown['"]/.test(joined)) return null;
  if (!/preventDefault\s*\(/.test(joined)) return null;
  // Players often switch on e.key.toLowerCase(), so the source says "arrowleft".
  if (!/arrow(?:left|right|up|down)/i.test(joined)) return null;
  let line = null;
  for (let i = 0; i < lines.length; i += 1) {
    if (/(document|window)\.addEventListener\(\s*['"]keydown['"]/.test(lines[i])) {
      line = i + 1;
      break;
    }
  }
  return {
    severity: 'info',
    kind: 'dpad-captured',
    file,
    line,
    message:
      "Arrow keys are preventDefault'd from a document or window keydown listener. If that listener is unconditional, the D-pad cannot move focus."
  };
}

/**
 * @param {string} html
 * @returns {boolean}
 */
export function pageHasPlayControl(html) {
  const dom = new JSDOM(html);
  const nodes = dom.window.document.querySelectorAll(
    'button, a[href], input[type="button"], input[type="submit"], [role="button"]'
  );
  for (const el of nodes) {
    if (namesPlay(el)) return true;
  }
  return false;
}

/**
 * @param {{ html: string, htmlFile: string, scripts: { file: string, source: string }[] }} page
 * @returns {Finding[]}
 */
export function scanPageSources(page) {
  const htmlIds = indexHtmlIds(page.html);
  /** @type {Finding[]} */
  const findings = [];
  const focusableIds = new Set();
  let handlesMediaKey = false;
  for (const script of page.scripts) {
    if (/MediaPlayPause|\bMediaPlay\b|\bMediaPause\b/.test(script.source)) handlesMediaKey = true;
    const analyzed = analyzeScript(script.source, script.file, htmlIds);
    findings.push(...analyzed.findings);
    for (const id of analyzed.focusableIds) focusableIds.add(id);
    const dpad = scanDpad(script.source, script.file);
    if (dpad) findings.push(dpad);
  }
  for (const finding of scanHtml(page.html, page.htmlFile)) {
    if (finding.id && focusableIds.has(finding.id)) continue;
    findings.push(finding);
  }
  if (pageHasPlayControl(page.html) && !handlesMediaKey && !page.mediaKeysHandled) {
    findings.push({
      severity: 'info',
      kind: 'play-key',
      file: page.htmlFile,
      line: null,
      message:
        'Has a play control and does not listen for MediaPlay or MediaPlayPause. The remote Play key clicks the focused element, so Play does nothing unless that control is already focused.'
    });
  }
  return findings;
}

/**
 * @param {string} root
 * @returns {Finding[]}
 */
export function scanSite(root) {
  /** @type {Finding[]} */
  const findings = [];
  const mediaKeysHandled = siteHandlesMediaKeys(root);
  for (const htmlPath of listIndexHtml(root)) {
    const scripts = listPageScripts(htmlPath, root).map((file) => ({
      file: relative(root, file),
      source: readFileSync(file, 'utf8')
    }));
    findings.push(
      ...scanPageSources({
        html: readFileSync(htmlPath, 'utf8'),
        htmlFile: relative(root, htmlPath),
        scripts,
        mediaKeysHandled
      })
    );
  }
  findings.sort(compareFindings);
  return findings;
}

/**
 * @param {Finding[]} findings
 * @returns {string}
 */
export function reportText(findings) {
  const errors = findings.filter((f) => f.severity === 'error');
  const play = findings.filter((f) => f.kind === 'play-key');
  const dpad = findings.filter((f) => f.kind === 'dpad-captured');
  const lines = [
    'Remote control scan',
    '',
    'The TV app moves the D-pad between focusable elements only.',
    'OK clicks the focused element. Play sends MediaPlayPause, then',
    'clicks the focused element if the page does not handle it.',
    'On the Watch player, Play sends the "k" key.',
    '',
    `Unreachable controls: ${errors.length}`
  ];
  for (const finding of errors) lines.push(`  ${formatWhere(finding)}  ${finding.message}`);
  lines.push('');
  lines.push(
    `Play key: ${play.length} page(s) have a play control and ignore the remote Play key unless it is focused.`
  );
  for (const finding of play) lines.push(`  ${finding.file}`);
  lines.push('');
  lines.push(
    `D-pad captured: ${dpad.length} script(s) preventDefault arrow keys from document or window.`
  );
  for (const finding of dpad) lines.push(`  ${formatWhere(finding)}`);
  return lines.join('\n');
}

/**
 * @param {string} root
 * @returns {string[]}
 */
function listIndexHtml(root) {
  /** @type {string[]} */
  const files = [];
  function walk(dir) {
    for (const ent of readdirSync(dir, { withFileTypes: true })) {
      if (ent.name.startsWith('.')) continue;
      const full = join(dir, ent.name);
      if (ent.isDirectory()) {
        if (SKIP_DIRS.has(ent.name)) continue;
        walk(full);
      } else if (ent.name === 'index.html') {
        files.push(full);
      }
    }
  }
  walk(root);
  return files;
}

/**
 * Scripts that belong to one page. Nested apps (a subfolder with its own
 * index.html) are scanned on their own. The repo root does not recurse,
 * or the home page would claim every app.
 *
 * @param {string} htmlPath
 * @param {string} root
 * @returns {string[]}
 */
function listPageScripts(htmlPath, root) {
  const dir = dirname(htmlPath);
  if (resolve(dir) === resolve(root)) {
    return readdirSync(dir)
      .filter((name) => name.endsWith('.js') && !name.endsWith('.min.js'))
      .map((name) => join(dir, name));
  }
  /** @type {string[]} */
  const files = [];
  function walk(current) {
    for (const ent of readdirSync(current, { withFileTypes: true })) {
      if (ent.name.startsWith('.')) continue;
      const full = join(current, ent.name);
      if (ent.isDirectory()) {
        if (SKIP_DIRS.has(ent.name)) continue;
        if (existsSync(join(full, 'index.html'))) continue;
        walk(full);
      } else if (ent.name.endsWith('.js') && !ent.name.endsWith('.min.js')) {
        files.push(full);
      }
    }
  }
  walk(dir);
  return files;
}

/**
 * @param {string[]} lines
 * @returns {Set<string>}
 */
function collectFocusableIds(lines) {
  const ids = new Set();
  const text = lines.join('\n');
  const patterns = [
    /getElementById\(\s*['"]([^'"]+)['"]\s*\)\s*\.tabIndex\s*=\s*(?:0|[1-9]\d*)\b/g,
    /querySelector\(\s*['"]#([^'"]+)['"]\s*\)\s*\.tabIndex\s*=\s*(?:0|[1-9]\d*)\b/g,
    /getElementById\(\s*['"]([^'"]+)['"]\s*\)\s*\.setAttribute\(\s*['"]tabindex['"]\s*,\s*['"]?(?:0|[1-9]\d*)\b/g,
    /querySelector\(\s*['"]#([^'"]+)['"]\s*\)\s*\.setAttribute\(\s*['"]tabindex['"]\s*,\s*['"]?(?:0|[1-9]\d*)\b/g
  ];
  for (const re of patterns) {
    for (const match of text.matchAll(re)) ids.add(match[1]);
  }
  return ids;
}

/**
 * @param {string[]} lines
 * @returns {{ name: string, tag: string, id: string, start: number }[]}
 */
function findBindings(lines) {
  /** @type {{ name: string, tag: string, id: string, start: number }[]} */
  const bindings = [];
  const createRe =
    /(?:(?:const|let|var)\s+)?((?:[A-Za-z_$][\w$]*\.)*[A-Za-z_$][\w$]*)\s*=\s*[A-Za-z_$][\w$.]*\.createElement\(\s*['"]([A-Za-z0-9-]+)['"]\s*\)/;
  const idRe =
    /(?:(?:const|let|var)\s+)?((?:[A-Za-z_$][\w$]*\.)*[A-Za-z_$][\w$]*)\s*=\s*[A-Za-z_$][\w$.]*\.(?:getElementById\(\s*['"]([^'"]+)['"]|querySelector\(\s*['"]#([^'"\s.]+)['"])/;
  for (let i = 0; i < lines.length; i += 1) {
    const created = lines[i].match(createRe);
    if (created) {
      bindings.push({ name: created[1], tag: created[2].toLowerCase(), id: '', start: i });
      continue;
    }
    const lookedUp = lines[i].match(idRe);
    if (lookedUp) {
      bindings.push({
        name: lookedUp[1],
        tag: '',
        id: lookedUp[2] || lookedUp[3],
        start: i
      });
    }
  }
  return bindings;
}

/**
 * @param {string[]} lines
 * @param {string} name
 * @param {number} start
 * @returns {number}
 */
function bindingEnd(lines, name, start) {
  const esc = escapeRegExp(name);
  const re = new RegExp(
    `(?:(?:const|let|var)\\s+${esc}\\b)|(?:(?:^|[^\\w$.])${esc}\\s*=\\s*[A-Za-z_$][\\w$.]*\\.(?:createElement|getElementById|querySelector)\\()`
  );
  for (let i = start + 1; i < lines.length; i += 1) {
    if (re.test(lines[i])) return i;
  }
  return lines.length;
}

/**
 * @param {string[]} lines
 * @param {string} name
 * @param {number} start
 * @param {number} end
 * @returns {number[]}
 */
function clickSites(lines, name, start, end) {
  const esc = escapeRegExp(name);
  const direct = new RegExp(
    `(?:^|[^\\w$.])${esc}\\.addEventListener\\(\\s*['"]click['"]|(?:^|[^\\w$.])${esc}\\.onclick\\s*=`
  );
  const head = new RegExp(`(?:^|[^\\w$.])${esc}\\.addEventListener\\s*\\(`);
  /** @type {number[]} */
  const sites = [];
  for (let i = start; i < end; i += 1) {
    if (direct.test(lines[i])) {
      sites.push(i);
      continue;
    }
    if (!head.test(lines[i])) continue;
    const chunk = lines.slice(i, Math.min(end, i + 3)).join('\n');
    if (/\(\s*['"]click['"]/.test(chunk) || /,\s*['"]click['"]/.test(chunk)) sites.push(i);
  }
  return sites;
}

/**
 * Clicks that are not a control the D-pad should land on: event delegation,
 * and handlers whose only job is to stop the click from bubbling.
 *
 * @param {string[]} lines
 * @param {number} site
 * @param {number} end
 * @returns {boolean}
 */
function clickIsNotAControl(lines, site, end) {
  const chunk = listenerChunk(lines, site, end);
  if (/\.target\b|\.closest\s*\(/.test(chunk)) return true;
  if (isStopPropagationOnly(chunk)) return true;
  const named = lines[site].match(
    /addEventListener\(\s*['"]click['"]\s*,\s*([A-Za-z_$][\w$]*)\s*[,)]/
  );
  if (!named) return false;
  return functionUsesTarget(lines, named[1]);
}

/**
 * @param {string} chunk
 * @returns {boolean}
 */
/**
 * The listener attached on this line, not the code that follows it.
 * A later call in the same function must not make a stopPropagation
 * click look like a control.
 *
 * @param {string[]} lines
 * @param {number} site
 * @param {number} end
 * @returns {string}
 */
function listenerChunk(lines, site, end) {
  let depth = 0;
  let started = false;
  /** @type {string[]} */
  const out = [];
  const last = Math.min(end, site + 20);
  for (let i = site; i < last; i += 1) {
    const line = lines[i];
    out.push(line);
    for (const ch of line) {
      if (ch === '{') {
        depth += 1;
        started = true;
      } else if (ch === '}') {
        depth -= 1;
      }
    }
    if (started && depth <= 0) break;
  }
  return out.join('\n');
}

/**
 * @param {string} chunk
 * @returns {boolean}
 */
function isStopPropagationOnly(chunk) {
  if (!/stopPropagation\s*\(/.test(chunk)) return false;
  const without = chunk
    .replace(/function\s*\([^)]*\)\s*\{/g, '')
    .replace(/stopPropagation\s*\(\s*\)/g, '')
    .replace(/addEventListener\s*\([^)]*\)/g, '');
  return !/[A-Za-z_$][\w$]*\s*\(/.test(without);
}

/**
 * @param {string[]} lines
 * @param {string} name
 * @returns {boolean}
 */
function functionUsesTarget(lines, name) {
  const esc = escapeRegExp(name);
  const startRe = new RegExp(`(?:function\\s+${esc}\\b)|(?:(?:const|let|var)\\s+${esc}\\s*=)`);
  for (let i = 0; i < lines.length; i += 1) {
    if (!startRe.test(lines[i])) continue;
    const body = lines.slice(i, i + 40).join('\n');
    if (/\.target\b|\.closest\s*\(/.test(body)) return true;
  }
  return false;
}

/**
 * remote.js handles MediaPlayPause on every page when analytics.js loads it.
 *
 * @param {string} root
 * @returns {boolean}
 */
function siteHandlesMediaKeys(root) {
  const remotePath = join(root, 'remote.js');
  const analyticsPath = join(root, 'analytics.js');
  if (!existsSync(remotePath) || !existsSync(analyticsPath)) return false;
  const remote = readFileSync(remotePath, 'utf8');
  const analytics = readFileSync(analyticsPath, 'utf8');
  return /MediaPlayPause/.test(remote) && /remote\.js/.test(analytics);
}

/**
 * @param {string} text
 * @param {string} name
 * @returns {boolean}
 */
function nameHasTabIndex(text, name) {
  const esc = escapeRegExp(name);
  const prop = new RegExp(`(?:^|[^\\w$.])${esc}\\.tabIndex\\s*=\\s*(?:0|[1-9]\\d*)\\b`);
  const attr = new RegExp(
    `(?:^|[^\\w$.])${esc}\\.setAttribute\\(\\s*['"]tabindex['"]\\s*,\\s*['"]?(?:0|[1-9]\\d*)\\b`
  );
  return prop.test(text) || attr.test(text);
}

/**
 * @param {string} text
 * @param {string} name
 * @returns {boolean}
 */
function nameHasHref(text, name) {
  const esc = escapeRegExp(name);
  const re = new RegExp(`(?:^|[^\\w$.])${esc}\\.(?:href\\s*=|setAttribute\\(\\s*['"]href['"])`);
  return re.test(text);
}

/**
 * @param {Element} el
 * @returns {boolean}
 */
function namesPlay(el) {
  const idClass = `${el.id || ''} ${el.getAttribute('class') || ''}`;
  if (
    /(?:^|[\s_-])(btn-play|play-btn|playbtn|btnplay|play-pause|playpause|pause-btn|btn-pause|pausebtn)(?:$|[\s_-])/i.test(
      idClass
    )
  ) {
    return true;
  }
  const label = `${el.getAttribute('aria-label') || ''} ${el.getAttribute('title') || ''}`;
  if (/^(?:play|pause)(?:\s*\/\s*(?:play|pause))?$/i.test(label.trim())) return true;
  const text = (el.textContent || '').replace(/\s+/g, ' ').trim();
  if (text.length > 48) return false;
  // "Play" and "⏸ Pause" are transport controls. "Play again" and
  // "Play NES games" are ordinary buttons the D-pad can already reach.
  return /^(?:[\s▶►⏸⏯⏩⏪🎵]*)(play|pause)(?:\s*\/\s*(play|pause))?\s*$/i.test(text);
}

/**
 * Click-outside backdrops. Focusing them traps the D-pad on an empty layer.
 *
 * @param {string} name
 * @param {string} id
 * @returns {boolean}
 */
function isDismissLayer(name, id) {
  return /backdrop|overlay|scrim/i.test(`${name} ${id}`);
}

/**
 * @param {string} html
 * @param {Element} el
 * @param {string|null} onclick
 * @returns {number|null}
 */
function locateHtml(html, el, onclick) {
  /** @type {string[]} */
  const needles = [];
  if (el.id) {
    needles.push(`id="${el.id}"`, `id='${el.id}'`);
  }
  if (onclick) needles.push(onclick.slice(0, 80));
  const role = el.getAttribute('role');
  if (role) needles.push(`role="${role}"`);
  for (const needle of needles) {
    const idx = html.indexOf(needle);
    if (idx >= 0) return lineNumberAt(html, idx);
  }
  return null;
}

/**
 * @param {string} source
 * @param {number} index
 * @returns {number}
 */
function lineNumberAt(source, index) {
  let line = 1;
  for (let i = 0; i < index; i += 1) {
    if (source.charCodeAt(i) === 10) line += 1;
  }
  return line;
}

/**
 * @param {string} tag
 * @param {string} id
 * @param {string|null} className
 * @returns {string}
 */
function describeElement(tag, id, className) {
  const classToken = (className || '').trim().split(/\s+/).filter(Boolean)[0];
  if (id) return `${tag}#${id}`;
  if (classToken) return `${tag}.${classToken}`;
  return tag;
}

/**
 * @param {Finding} finding
 * @returns {string}
 */
function formatWhere(finding) {
  return finding.line ? `${finding.file}:${finding.line}` : finding.file;
}

/**
 * @param {Finding} a
 * @param {Finding} b
 * @returns {number}
 */
function compareFindings(a, b) {
  if (a.severity !== b.severity) return a.severity === 'error' ? -1 : 1;
  if (a.file !== b.file) return a.file < b.file ? -1 : 1;
  return (a.line || 0) - (b.line || 0);
}

/**
 * @param {string} value
 * @returns {string}
 */
function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function main() {
  const findings = scanSite(ROOT);
  if (process.argv.includes('--json')) {
    process.stdout.write(`${JSON.stringify(findings, null, 2)}\n`);
  } else {
    process.stdout.write(`${reportText(findings)}\n`);
  }
  const errors = findings.filter((f) => f.severity === 'error').length;
  process.exitCode = errors > 0 ? 1 : 0;
}

const entry = process.argv[1] ? resolve(process.argv[1]) : '';
if (entry === fileURLToPath(import.meta.url)) main();
