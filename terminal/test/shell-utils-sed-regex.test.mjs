import { test } from 'node:test';
import assert from 'node:assert/strict';
import { sedApplySubstituteLine } from '../commands/filesystem/sed-runtime.js';
import { parseSedArgv } from '../commands/filesystem/sed-help.js';

test('sedApplySubstituteLine: regex mode replaces JS RegExp', () => {
  const r = sedApplySubstituteLine('hello123world', {
    pattern: '\\d+',
    replacement: 'NUM',
    global: false,
    ignoreCase: false,
    regex: true
  });
  assert.equal(r.line, 'helloNUMworld');
  assert.equal(r.subbed, true);
});

test('sedApplySubstituteLine: regex with capture groups', () => {
  const r = sedApplySubstituteLine('Joe Heyming', {
    pattern: '(\\w+) (\\w+)',
    replacement: '\\2 \\1',
    global: false,
    ignoreCase: false,
    regex: true
  });
  assert.equal(r.line, 'Heyming Joe');
});

test('sedApplySubstituteLine: regex global', () => {
  const r = sedApplySubstituteLine('abc abc abc', {
    pattern: 'a',
    replacement: 'X',
    global: true,
    ignoreCase: false,
    regex: true
  });
  assert.equal(r.line, 'Xbc Xbc Xbc');
});

test('sedApplySubstituteLine: regex case insensitive', () => {
  const r = sedApplySubstituteLine('FOO foo', {
    pattern: 'foo',
    replacement: 'X',
    global: true,
    ignoreCase: true,
    regex: true
  });
  assert.equal(r.line, 'X X');
});

test('sedApplySubstituteLine: invalid regex returns line unchanged', () => {
  const r = sedApplySubstituteLine('abc', {
    pattern: '[invalid',
    replacement: 'X',
    global: false,
    ignoreCase: false,
    regex: true
  });
  assert.equal(r.line, 'abc');
  assert.equal(r.subbed, false);
});

test('parseSedArgv: -E sets extended', () => {
  const r = parseSedArgv(['-E', 's/a/b/']);
  assert.equal(r.ok, true);
  assert.equal(r.extended, true);
});

test('parseSedArgv: -r sets extended', () => {
  const r = parseSedArgv(['-r', 's/a/b/']);
  assert.equal(r.ok, true);
  assert.equal(r.extended, true);
});

test('parseSedArgv: -i sets inPlace', () => {
  const r = parseSedArgv(['-i', 's/a/b/', 'file.txt']);
  assert.equal(r.ok, true);
  assert.equal(r.inPlace, true);
});

test('parseSedArgv: no -E means literal default', () => {
  const r = parseSedArgv(['s/a/b/']);
  assert.equal(r.ok, true);
  assert.equal(r.extended, false);
});
