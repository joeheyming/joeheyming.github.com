import { test } from 'node:test';
import assert from 'node:assert/strict';
import { StatLib } from '../commands/filesystem/stat-lib.js';

const { parseStatArgv, statApplyFormat, statDecodePrintfFormat } = StatLib;

test('parseStatArgv: -c FORMAT', () => {
  const r = parseStatArgv(['-c', '%n %s', 'a']);
  assert.equal(r.ok, true);
  assert.equal(r.format, '%n %s');
  assert.equal(r.addNewline, true);
  assert.deepEqual(r.operands, ['a']);
});

test('parseStatArgv: --format=FORMAT', () => {
  const r = parseStatArgv(['--format=%a', 'b']);
  assert.equal(r.ok, true);
  assert.equal(r.format, '%a');
  assert.equal(r.addNewline, true);
});

test('parseStatArgv: --printf=FORMAT decodes escapes and no newline', () => {
  const r = parseStatArgv(['--printf=%n\\n', 'c']);
  assert.equal(r.ok, true);
  assert.equal(r.format, '%n\n');
  assert.equal(r.addNewline, false);
});

test('parseStatArgv: -cFORMAT short form', () => {
  const r = parseStatArgv(['-c%s', 'a']);
  assert.equal(r.ok, true);
  assert.equal(r.format, '%s');
});

test('parseStatArgv: -c without arg errors', () => {
  const r = parseStatArgv(['-c']);
  assert.equal(r.ok, false);
});

test('statDecodePrintfFormat: handles common escapes', () => {
  assert.equal(statDecodePrintfFormat('%n\\n'), '%n\n');
  assert.equal(statDecodePrintfFormat('a\\tb'), 'a\tb');
  assert.equal(statDecodePrintfFormat('\\\\'), '\\');
});

test('statApplyFormat: substitutes %n %s %a %A %U %F', () => {
  const vars = {
    n: 'foo.txt',
    s: '42',
    a: '644',
    A: '-rw-r--r--',
    U: 'alice',
    F: 'regular file'
  };
  assert.equal(
    statApplyFormat('%n %s %a %A %U %F', vars),
    'foo.txt 42 644 -rw-r--r-- alice regular file'
  );
});

test('statApplyFormat: %% is literal', () => {
  assert.equal(statApplyFormat('100%%', {}), '100%');
});

test('statApplyFormat: unknown specifier becomes ?', () => {
  assert.equal(statApplyFormat('%n=%Q', { n: 'x' }), 'x=?');
});
