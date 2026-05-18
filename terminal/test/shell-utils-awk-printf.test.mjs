import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  awkApplyPrintfFormat,
  awkRunPrintfOnce,
  awkRunPrintProgram,
  awkBeginCtx
} from '../commands/filesystem/awk-runtime.js';
import { parseAwkFullProgram, parseAwkPrintBlockBody } from '../commands/filesystem/awk-parse-program.js';

test('awkApplyPrintfFormat: %s width and prec', () => {
  assert.equal(awkApplyPrintfFormat('%5s', ['hi']), '   hi');
  assert.equal(awkApplyPrintfFormat('%-5s|', ['hi']), 'hi   |');
  assert.equal(awkApplyPrintfFormat('%.3s', ['hello']), 'hel');
});

test('awkApplyPrintfFormat: %d zero pad', () => {
  assert.equal(awkApplyPrintfFormat('%04d', ['7']), '0007');
});

test('awkApplyPrintfFormat: %x hex', () => {
  assert.equal(awkApplyPrintfFormat('%x', ['255']), 'ff');
  assert.equal(awkApplyPrintfFormat('%04x', ['255']), '00ff');
});

test('awkApplyPrintfFormat: %f precision', () => {
  assert.equal(awkApplyPrintfFormat('%.2f', ['3.14159']), '3.14');
});

test('awkApplyPrintfFormat: %% literal', () => {
  assert.equal(awkApplyPrintfFormat('%d%%', ['50']), '50%');
});

test('awkRunPrintfOnce: from BEGIN context', () => {
  const r = awkRunPrintfOnce(['"hi %s\\n"', '"world"'], awkBeginCtx(' '));
  assert.equal(r.ok, true);
  // Note: awkEvalPrintExpr will strip quotes from "..." string literals.
  // We pass raw string-literal exprs.
  assert.ok(r.stdout.includes('hi world'));
});

test('parseAwkFullProgram: BEGIN with printf', () => {
  const p = parseAwkFullProgram('BEGIN { printf "x=%d\\n", 42 }');
  assert.equal(p.ok, true);
  assert.equal(p.beginKind, 'printf');
});

test('parseAwkFullProgram: /pattern/ {action}', () => {
  const p = parseAwkFullProgram('/foo/ { print $1 }');
  assert.equal(p.ok, true);
  assert.ok(p.mainCondition);
  assert.equal(p.mainCondition.type, 'regex');
  assert.equal(p.mainCondition.source, 'foo');
});

test('parseAwkFullProgram: /pat/ with no action prints matching lines', () => {
  const p = parseAwkFullProgram('/foo/');
  assert.equal(p.ok, true);
  assert.ok(p.mainCondition);
  assert.deepEqual(p.mainExprs, ['$0']);
});

test('parseAwkPrintBlockBody: detects printf vs print', () => {
  assert.equal(parseAwkPrintBlockBody('print $1').kind, 'print');
  assert.equal(parseAwkPrintBlockBody('printf "%s\\n", $1').kind, 'printf');
});

test('awkRunPrintProgram: condition filters lines', () => {
  const r = awkRunPrintProgram(
    'foo\nbar\nfoofoo\n',
    ['$0'],
    ' ',
    1,
    undefined,
    { kind: 'print', condition: { type: 'regex', source: 'foo', flags: '' } }
  );
  assert.equal(r.ok, true);
  // 'foo' and 'foofoo' match
  assert.equal(r.stdout, 'foo\nfoofoo\n');
});
