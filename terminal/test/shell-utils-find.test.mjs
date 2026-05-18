import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  parseFindExpr,
  parseSizeArg,
  parseTimeArg,
  isPredicateToken,
  globToRegex,
  iglobToRegex,
  exprMaxDepth,
  exprMinDepth,
  exprHasAction
} from '../commands/filesystem/find.js';

test('isPredicateToken: recognizes operators and predicates', () => {
  assert.equal(isPredicateToken('-name'), true);
  assert.equal(isPredicateToken('-type'), true);
  assert.equal(isPredicateToken('-print'), true);
  assert.equal(isPredicateToken('('), true);
  assert.equal(isPredicateToken('!'), true);
  assert.equal(isPredicateToken('-bogus'), false);
});

test('parseFindExpr: simple -name', () => {
  const e = parseFindExpr(['-name', '*.js']);
  assert.equal(e.type, 'pred');
  assert.equal(e.name, '-name');
  assert.equal(e.arg, '*.js');
});

test('parseFindExpr: AND implicit and explicit', () => {
  const e1 = parseFindExpr(['-name', '*.js', '-type', 'f']);
  assert.equal(e1.type, 'and');
  const e2 = parseFindExpr(['-name', '*.js', '-a', '-type', 'f']);
  assert.equal(e2.type, 'and');
});

test('parseFindExpr: OR precedence (OR is looser)', () => {
  const e = parseFindExpr(['-name', '*.js', '-o', '-name', '*.ts', '-type', 'f']);
  assert.equal(e.type, 'or');
});

test('parseFindExpr: NOT', () => {
  const e = parseFindExpr(['!', '-name', '*.md']);
  assert.equal(e.type, 'not');
  assert.equal(e.child.name, '-name');
});

test('parseFindExpr: grouping', () => {
  const e = parseFindExpr(['(', '-name', 'a', '-o', '-name', 'b', ')', '-type', 'f']);
  assert.equal(e.type, 'and');
});

test('parseFindExpr: -exec ... ; collects cmd', () => {
  const e = parseFindExpr(['-exec', 'echo', '{}', ';']);
  assert.equal(e.type, 'pred');
  assert.equal(e.name, '-exec');
  assert.deepEqual(e.cmd, ['echo', '{}']);
  assert.equal(e.terminator, ';');
});

test('parseFindExpr: -exec ... + collects cmd', () => {
  const e = parseFindExpr(['-exec', 'rm', '{}', '+']);
  assert.equal(e.terminator, '+');
});

test('parseFindExpr: missing arg errors', () => {
  assert.throws(() => parseFindExpr(['-name']));
});

test('parseSizeArg: bytes with +/-', () => {
  assert.deepEqual(parseSizeArg('+10c'), { cmp: '>', bytes: 10, unit: 'c' });
  assert.deepEqual(parseSizeArg('-100c'), { cmp: '<', bytes: 100, unit: 'c' });
  assert.deepEqual(parseSizeArg('1k'), { cmp: '=', bytes: 1024, unit: 'k' });
});

test('parseTimeArg: days with +/-', () => {
  assert.deepEqual(parseTimeArg('+7'), { cmp: '>', n: 7 });
  assert.deepEqual(parseTimeArg('-1'), { cmp: '<', n: 1 });
  assert.deepEqual(parseTimeArg('0'), { cmp: '=', n: 0 });
});

test('globToRegex: matches *.js', () => {
  const re = globToRegex('*.js');
  assert.ok(re.test('foo.js'));
  assert.ok(!re.test('foo.md'));
});

test('iglobToRegex: case-insensitive', () => {
  const re = iglobToRegex('README*');
  assert.ok(re.test('readme.md'));
  assert.ok(re.test('Readme.txt'));
});

test('exprMaxDepth / exprMinDepth: extract depth limits', () => {
  const e = parseFindExpr(['-maxdepth', '3', '-mindepth', '1', '-print']);
  assert.equal(exprMaxDepth(e), 3);
  assert.equal(exprMinDepth(e), 1);
});

test('exprHasAction: detects -print/-delete/-exec', () => {
  assert.equal(exprHasAction(parseFindExpr(['-name', '*.js'])), false);
  assert.equal(exprHasAction(parseFindExpr(['-name', '*.js', '-print'])), true);
  assert.equal(exprHasAction(parseFindExpr(['-delete'])), true);
  assert.equal(exprHasAction(parseFindExpr(['-exec', 'echo', '{}', ';'])), true);
});
