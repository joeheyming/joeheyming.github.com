// HTML check for public pages, using htmllint and .htmllintrc.
//
// The published htmllint preset wants 4-space indents, underscore class
// names, and a ban on <style> and style attributes. Those rules are off
// here. What stays is structure: doctype, language, titles, duplicate ids,
// closed tags, image alt/src, labels, and obsolete presentational attributes.
import { createRequire } from 'node:module';
import { readdirSync, readFileSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const htmllint = require('htmllint');

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const SKIP_DIRS = new Set(['node_modules', '.git', 'tests', 'coverage', 'dist']);
const EXTRA_PAGES = ['privacy-policy.html', 'terms-of-service.html'];

/**
 * @typedef {object} HtmlIssue
 * @property {string} file
 * @property {number} line
 * @property {number} column
 * @property {string} code
 * @property {string} message
 */

/**
 * @param {string} root
 * @returns {Record<string, unknown>}
 */
export function loadOptions(root) {
  return JSON.parse(readFileSync(join(root, '.htmllintrc'), 'utf8'));
}

/**
 * @param {string} root
 * @returns {string[]}
 */
export function listPages(root) {
  /** @type {string[]} */
  const files = [];
  /**
   * @param {string} dir
   */
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
  for (const extra of EXTRA_PAGES) files.push(join(root, extra));
  return files.sort();
}

/**
 * @param {string} html
 * @param {Record<string, unknown>} [options]
 * @returns {Promise<HtmlIssue[]>}
 */
export async function lintHtml(html, options) {
  const opts = options || loadOptions(ROOT);
  const issues = await htmllint(html, opts);
  return issues.map((issue) => ({
    file: '',
    line: issue.line,
    column: issue.column,
    code: issue.code,
    message: htmllint.messages.renderIssue(issue)
  }));
}

/**
 * @param {string} root
 * @returns {Promise<{ pages: number, issues: HtmlIssue[], failures: { file: string, message: string }[] }>}
 */
export async function lintSite(root) {
  const options = loadOptions(root);
  const pages = listPages(root);
  /** @type {HtmlIssue[]} */
  const issues = [];
  /** @type {{ file: string, message: string }[]} */
  const failures = [];
  for (const page of pages) {
    const file = relative(root, page);
    try {
      const pageIssues = await lintHtml(readFileSync(page, 'utf8'), options);
      for (const issue of pageIssues) issues.push({ ...issue, file });
    } catch (err) {
      failures.push({ file, message: err instanceof Error ? err.message : String(err) });
    }
  }
  issues.sort(
    (a, b) => a.code.localeCompare(b.code) || a.file.localeCompare(b.file) || a.line - b.line
  );
  return { pages: pages.length, issues, failures };
}

/**
 * @param {{ pages: number, issues: HtmlIssue[], failures: { file: string, message: string }[] }} report
 * @returns {string}
 */
export function reportText(report) {
  const lines = [`HTML lint`, `Pages: ${report.pages}`, `Issues: ${report.issues.length}`];
  if (report.failures.length) {
    lines.push(`Scan errors: ${report.failures.length}`);
    for (const failure of report.failures) lines.push(`  ${failure.file}  ${failure.message}`);
  }
  /** @type {string} */
  let current = '';
  for (const issue of report.issues) {
    if (issue.code !== current) {
      current = issue.code;
      lines.push('');
      lines.push(`${issue.code}  ${issue.message}`);
    }
    lines.push(`  ${issue.file}:${issue.line}:${issue.column}`);
  }
  return lines.join('\n');
}

async function main() {
  const report = await lintSite(ROOT);
  process.stdout.write(`${reportText(report)}\n`);
  process.exitCode = report.issues.length > 0 || report.failures.length > 0 ? 1 : 0;
}

const entry = process.argv[1] ? resolve(process.argv[1]) : '';
if (entry === fileURLToPath(import.meta.url)) main();
