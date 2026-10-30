// General accessibility scan. axe-core checks the initial HTML of every page.
// It does not execute page scripts, so controls created in JavaScript are
// outside this pass (the remote scan covers those for focus). Contrast is
// measured from brand.css tokens, not from jsdom's computed colors.
import { createRequire } from 'node:module';
import { readdirSync, readFileSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { JSDOM, VirtualConsole } from 'jsdom';

import { auditThemeContrast } from './theme-contrast.mjs';

const require = createRequire(import.meta.url);
const axe = require('axe-core');

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const SKIP_DIRS = new Set(['node_modules', '.git', 'tests', 'coverage', 'dist']);

/** @type {Record<string, { enabled: false }>} */
const DISABLED_RULES = {
  'color-contrast': { enabled: false },
  'color-contrast-enhanced': { enabled: false }
};

const IMPACT_ORDER = ['critical', 'serious', 'moderate', 'minor'];

/**
 * @typedef {'critical' | 'serious' | 'moderate' | 'minor'} Impact
 */

/**
 * @typedef {object} A11yNode
 * @property {string} target
 * @property {string} html
 * @property {string} summary
 */

/**
 * @typedef {object} A11yHit
 * @property {string} file
 * @property {string} id
 * @property {Impact} impact
 * @property {string} help
 * @property {number} count
 * @property {A11yNode[]} nodes
 */

/**
 * @param {string | null | undefined} impact
 * @returns {Impact}
 */
function normalizeImpact(impact) {
  if (impact === 'critical' || impact === 'serious' || impact === 'moderate') return impact;
  return 'minor';
}

/**
 * @param {string} html
 * @returns {string}
 */
function stripScripts(html) {
  // Comments first. A comment that mentions "<script>" would otherwise
  // swallow the next real closing tag and hide the rest of the page.
  return html.replace(/<!--[\s\S]*?-->/g, '').replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, '');
}

/**
 * @param {string} html
 * @param {string} file
 * @returns {Promise<A11yHit[]>}
 */
export async function auditHtml(html, file) {
  const virtualConsole = new VirtualConsole();
  const dom = new JSDOM(stripScripts(html), {
    url: `https://joeheyming.github.io/${file.replace(/index\.html$/, '')}`,
    pretendToBeVisual: true,
    runScripts: 'dangerously',
    virtualConsole
  });
  try {
    const script = dom.window.document.createElement('script');
    script.textContent = axe.source;
    const head = dom.window.document.head || dom.window.document.documentElement;
    head.appendChild(script);
    const runner = dom.window.axe;
    if (!runner || typeof runner.run !== 'function') {
      throw new Error('axe-core did not attach to the page');
    }
    const results = await runner.run(dom.window.document, {
      resultTypes: ['violations'],
      rules: DISABLED_RULES
    });
    /** @type {A11yHit[]} */
    const hits = [];
    for (const violation of results.violations) {
      const nodes = violation.nodes.slice(0, 5).map((node) => ({
        target: node.target.join(' '),
        html: (node.html || '').replace(/\s+/g, ' ').trim().slice(0, 180),
        summary: (node.failureSummary || '').split('\n')[0]
      }));
      hits.push({
        file,
        id: violation.id,
        impact: normalizeImpact(violation.impact),
        help: violation.help,
        count: violation.nodes.length,
        nodes
      });
    }
    return hits;
  } finally {
    dom.window.close();
  }
}

/**
 * @param {string} root
 * @returns {string[]}
 */
export function listPages(root) {
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
  return files.sort();
}

/**
 * @param {string} root
 * @param {{ onPage?: (file: string, index: number, total: number) => void }} [options]
 * @returns {Promise<{ hits: A11yHit[], errors: { file: string, message: string }[], pages: number }>}
 */
export async function auditSite(root, options = {}) {
  const pages = listPages(root);
  /** @type {A11yHit[]} */
  const hits = [];
  /** @type {{ file: string, message: string }[]} */
  const errors = [];
  for (let i = 0; i < pages.length; i += 1) {
    const file = relative(root, pages[i]);
    if (options.onPage) options.onPage(file, i, pages.length);
    try {
      const pageHits = await auditHtml(readFileSync(pages[i], 'utf8'), file);
      hits.push(...pageHits);
    } catch (err) {
      errors.push({
        file,
        message: err instanceof Error ? err.message : String(err)
      });
    }
  }
  hits.sort(compareHits);
  return { hits, errors, pages: pages.length };
}

/**
 * @param {A11yHit} a
 * @param {A11yHit} b
 * @returns {number}
 */
function compareHits(a, b) {
  const impact = IMPACT_ORDER.indexOf(a.impact) - IMPACT_ORDER.indexOf(b.impact);
  if (impact !== 0) return impact;
  if (a.id !== b.id) return a.id < b.id ? -1 : 1;
  return a.file < b.file ? -1 : 1;
}

/**
 * @param {{ hits: A11yHit[], errors: { file: string, message: string }[], pages: number }} report
 * @returns {string}
 */
export function reportText(report) {
  const lines = [
    'Accessibility scan (axe-core)',
    '',
    'Checks the initial HTML of each page. JavaScript-built controls are not',
    'in this pass. Contrast uses the colors brand.css assigns, in light and dark.',
    '',
    `Pages: ${report.pages}`,
    `Rules failing: ${new Set(report.hits.map((hit) => hit.id)).size}`,
    `Failing elements: ${report.hits.reduce((sum, hit) => sum + hit.count, 0)}`
  ];
  for (const impact of IMPACT_ORDER) {
    const group = report.hits.filter((hit) => hit.impact === impact);
    const elements = group.reduce((sum, hit) => sum + hit.count, 0);
    lines.push(`${impact}: ${elements} element(s) across ${group.length} page-rule hit(s)`);
  }
  if (report.errors.length) {
    lines.push('');
    lines.push(`Scan errors: ${report.errors.length}`);
    for (const error of report.errors) lines.push(`  ${error.file}  ${error.message}`);
  }
  /** @type {string} */
  let current = '';
  for (const hit of report.hits) {
    if (hit.id !== current) {
      current = hit.id;
      lines.push('');
      lines.push(`${hit.impact}  ${hit.id}  ${hit.help}`);
    }
    const sample = hit.nodes[0] ? `  ${hit.nodes[0].html}` : '';
    lines.push(`  ${hit.file}  ${hit.count}${sample}`);
  }
  if (report.contrast) {
    const failing = report.contrast.results.filter((row) => !row.pass);
    lines.push('');
    lines.push(
      `Theme contrast: ${failing.length} of ${report.contrast.results.length} pair(s) below AA.`
    );
    for (const row of report.contrast.drift) lines.push(`  drift  ${row}`);
    for (const row of failing) {
      lines.push(
        `  ${row.theme}  ${row.ratio.toFixed(2)}:1  need ${row.minimum}:1  ${row.fgHex} on ${
          row.bgHex
        }  ${row.where}`
      );
    }
  }
  return lines.join('\n');
}

/**
 * @param {{ hits: A11yHit[], errors: { file: string, message: string }[], pages: number }} report
 * @returns {number}
 */
export function seriousCount(report) {
  return report.hits.filter((hit) => hit.impact === 'critical' || hit.impact === 'serious').length;
}

async function main() {
  const report = await auditSite(ROOT, {
    onPage(file, index, total) {
      process.stderr.write(`[${index + 1}/${total}] ${file}\n`);
    }
  });
  report.contrast = auditThemeContrast(readFileSync(join(ROOT, 'brand.css'), 'utf8'));
  if (process.argv.includes('--json')) {
    process.stdout.write(`${JSON.stringify(report)}\n`);
  } else {
    process.stdout.write(`${reportText(report)}\n`);
  }
  const contrastFails = report.contrast.results.filter((row) => !row.pass).length;
  process.exitCode =
    seriousCount(report) > 0 || report.errors.length > 0 || contrastFails > 0 ? 1 : 0;
}

const entry = process.argv[1] ? resolve(process.argv[1]) : '';
if (entry === fileURLToPath(import.meta.url)) main();
