import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ShellCore } from '../lib/shell-core.js';

test('expandBraces: simple comma list', () => {
  assert.deepEqual(ShellCore.expandBraces('a{b,c,d}e'), ['abe', 'ace', 'ade']);
});

test('expandBraces: numeric sequence ascending', () => {
  assert.deepEqual(ShellCore.expandBraces('{1..5}'), ['1', '2', '3', '4', '5']);
});

test('expandBraces: numeric sequence descending', () => {
  assert.deepEqual(ShellCore.expandBraces('{3..1}'), ['3', '2', '1']);
});

test('expandBraces: numeric sequence with step', () => {
  assert.deepEqual(ShellCore.expandBraces('{0..10..2}'), ['0', '2', '4', '6', '8', '10']);
});

test('expandBraces: alpha sequence', () => {
  assert.deepEqual(ShellCore.expandBraces('{a..e}'), ['a', 'b', 'c', 'd', 'e']);
});

test('expandBraces: no comma and no range is literal', () => {
  assert.deepEqual(ShellCore.expandBraces('{notalist}'), ['{notalist}']);
});

test('expandBraces: nested', () => {
  assert.deepEqual(ShellCore.expandBraces('a{b,c{1,2}}'), ['ab', 'ac1', 'ac2']);
});

test('expandBraces: multiple groups', () => {
  assert.deepEqual(ShellCore.expandBraces('{a,b}{1,2}'), ['a1', 'a2', 'b1', 'b2']);
});

test('expandBracesInArgv: pass-through for plain args', () => {
  assert.deepEqual(ShellCore.expandBracesInArgv(['foo', 'bar.txt']), ['foo', 'bar.txt']);
});

test('expandBracesInArgv: expands one arg', () => {
  assert.deepEqual(
    ShellCore.expandBracesInArgv(['cp', 'src/{a,b}.txt', 'dest/']),
    ['cp', 'src/a.txt', 'src/b.txt', 'dest/']
  );
});

test('expandVariablesInString: ${VAR:-default} unset uses default', () => {
  assert.equal(ShellCore.expandVariablesInString('${MISSING:-hi}', {}, 0), 'hi');
});

test('expandVariablesInString: ${VAR:-default} set uses value', () => {
  assert.equal(ShellCore.expandVariablesInString('${X:-hi}', { X: 'set' }, 0), 'set');
});

test('expandVariablesInString: ${VAR:-default} empty uses default', () => {
  assert.equal(ShellCore.expandVariablesInString('${X:-fb}', { X: '' }, 0), 'fb');
});

test('expandVariablesInString: ${VAR-default} unset only', () => {
  assert.equal(ShellCore.expandVariablesInString('${X-fb}', { X: '' }, 0), '');
  assert.equal(ShellCore.expandVariablesInString('${X-fb}', {}, 0), 'fb');
});

test('expandVariablesInString: ${VAR:+alt}', () => {
  assert.equal(ShellCore.expandVariablesInString('${X:+yes}', { X: 'v' }, 0), 'yes');
  assert.equal(ShellCore.expandVariablesInString('${X:+yes}', { X: '' }, 0), '');
});

test('expandVariablesInString: ${#VAR} length', () => {
  assert.equal(ShellCore.expandVariablesInString('${#X}', { X: 'hello' }, 0), '5');
  assert.equal(ShellCore.expandVariablesInString('${#Y}', {}, 0), '0');
});

test('expandVariablesInString: ${VAR#pat} strip prefix', () => {
  assert.equal(
    ShellCore.expandVariablesInString('${PATH#*:}', { PATH: '/a:/b:/c' }, 0),
    '/b:/c'
  );
});

test('expandVariablesInString: ${VAR##pat} strip longest prefix', () => {
  assert.equal(
    ShellCore.expandVariablesInString('${PATH##*:}', { PATH: '/a:/b:/c' }, 0),
    '/c'
  );
});

test('expandVariablesInString: ${VAR%pat} strip shortest suffix', () => {
  assert.equal(
    ShellCore.expandVariablesInString('${F%.*}', { F: 'a.tar.gz' }, 0),
    'a.tar'
  );
});

test('expandVariablesInString: ${VAR%%pat} strip longest suffix', () => {
  assert.equal(
    ShellCore.expandVariablesInString('${F%%.*}', { F: 'a.tar.gz' }, 0),
    'a'
  );
});

test('expandVariablesInString: $? expands to exit code', () => {
  assert.equal(ShellCore.expandVariablesInString('exit=$?', {}, 42), 'exit=42');
});

test('expandVariablesInString: $VAR no braces', () => {
  assert.equal(ShellCore.expandVariablesInString('hi $USER!', { USER: 'alice' }, 0), 'hi alice!');
});

test('expandVariablesInString: positional $1', () => {
  assert.equal(
    ShellCore.expandVariablesInString('first=$1', { 1: 'foo' }, 0),
    'first=foo'
  );
});

test('shellPatternToRegexSrc: * and ? glob basics', () => {
  const src = ShellCore.shellPatternToRegexSrc('*.txt');
  const re = new RegExp('^' + src + '$');
  assert.ok(re.test('a.txt'));
  assert.ok(re.test('.txt'));
  assert.ok(!re.test('a.txts'));
});
