// Tests for the ANSI processing path that addOutput auto-engages whenever
// the rendered text contains \x1b[ — the fix that made `heyming`, `neofetch`,
// and `cal`'s today-highlight render their colors instead of leaking
// bracket codes (e.g. literal "[33m") into the DOM.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { TerminalOutputMixin } from '../terminal-output.js';

// processAnsiSequences is a string-in / string-out method with no DOM deps,
// so we can call it on a bare instance.
const renderer = new TerminalOutputMixin();
const ansi = (s) => renderer.processAnsiSequences(s);

test('plain text without escape codes passes through unchanged', () => {
  assert.equal(ansi('hello world'), 'hello world');
  assert.equal(ansi(''), '');
  assert.equal(ansi('line one\nline two\n'), 'line one\nline two\n');
});

test('basic foreground color: \\x1b[31m … \\x1b[0m wraps in colored span', () => {
  const out = ansi('\x1b[31mred-text\x1b[0m');
  assert.match(out, /<span style="color: red;">red-text<\/span>/);
});

test('the bracket-code leak: \\x1b[33m no longer surfaces literal "[33m"', () => {
  // Before the renderer fix, this exact input rendered "[33mYELLOW[0m" in the
  // DOM because addOutput's plain-text path stripped \x1b but not the [33m.
  // processAnsiSequences itself already handled this correctly — the bug was
  // upstream in addOutput. We assert here that the sequence converts cleanly.
  const out = ansi('\x1b[33mYELLOW\x1b[0m');
  assert.doesNotMatch(out, /\[33m/);
  assert.doesNotMatch(out, /\[0m/);
  assert.match(out, /color: yellow/);
  assert.match(out, /YELLOW/);
});

test('every common color code maps to a CSS color name', () => {
  const cases = [
    ['30', 'black'],
    ['31', 'red'],
    ['32', 'green'],
    ['33', 'yellow'],
    ['34', 'blue'],
    ['35', 'magenta'],
    ['36', 'cyan'],
    ['37', 'white'],
    ['91', 'lightred'],
    ['92', 'lightgreen']
  ];
  for (const [code, name] of cases) {
    const out = ansi(`\x1b[${code}mX\x1b[0m`);
    assert.match(out, new RegExp(`color: ${name}`), `code ${code} → ${name}`);
  }
});

test('bold (\\x1b[1m): emits font-weight span', () => {
  const out = ansi('\x1b[1mbold\x1b[0m');
  assert.match(out, /font-weight: bold/);
});

test('underline (\\x1b[4m): emits text-decoration span', () => {
  const out = ansi('\x1b[4mline\x1b[0m');
  assert.match(out, /text-decoration: underline/);
});

test('background color (\\x1b[44m): emits background-color span', () => {
  const out = ansi('\x1b[44mbg\x1b[0m');
  assert.match(out, /background-color: blue/);
});

test('clear-screen and cursor-home sequences are stripped silently', () => {
  assert.equal(ansi('\x1b[2Jhello'), 'hello');
  assert.equal(ansi('\x1b[Hhi'), 'hi');
  assert.equal(ansi('\x1b[1;1Hgo'), 'go');
});

test('cursor-movement codes are stripped', () => {
  assert.equal(ansi('a\x1b[5Ab'), 'ab');
  assert.equal(ansi('a\x1b[3Db'), 'ab');
});

test('unknown codes are dropped without leaving "[Nm" residue', () => {
  // 7 (reverse video) is not in the lookup table; we just want it to vanish
  // rather than surface as visible "[7m" text.
  const out = ansi('\x1b[7mX\x1b[27m');
  assert.doesNotMatch(out, /\[7m/);
  assert.doesNotMatch(out, /\[27m/);
  assert.match(out, /X/);
});

test('multiple sequential colored runs render independently', () => {
  const out = ansi('\x1b[31mred\x1b[0m \x1b[32mgreen\x1b[0m');
  assert.match(out, /<span style="color: red;">red<\/span>/);
  assert.match(out, /<span style="color: green;">green<\/span>/);
});

test('chained codes \\x1b[1;33m emit a span per code', () => {
  const out = ansi('\x1b[1;33mhi');
  assert.match(out, /font-weight: bold/);
  assert.match(out, /color: yellow/);
});
