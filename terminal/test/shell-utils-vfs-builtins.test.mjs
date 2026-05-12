import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ShellCore } from '../lib/shell-core.js';
import { VfsUtils } from '../lib/vfs-utils.js';
import { LsLib } from '../commands/filesystem/ls-lib.js';
import { MkdirLib } from '../commands/filesystem/mkdir-lib.js';
import { ChmodLib } from '../commands/filesystem/chmod-lib.js';
import { StatLib } from '../commands/filesystem/stat-lib.js';
import { BuiltinsLib } from '../commands/system/builtins-lib.js';

const {
  formatDeclareXLine,
  escapeBashDoubleQuotedContent,
  escapeTypeAliasBody
} = ShellCore;

const {
  fileItemUtf8ForDisplay,
  filterDirectoryEntriesForTabCompletion,
  sortDirectoryEntriesByName
} = VfsUtils;

const { parseLsDisplayFlags } = LsLib;

const { parseMkdirArgv } = MkdirLib;

const { parseChmodArgv } = ChmodLib;

const { parseStatArgv } = StatLib;

const { parseTypeArgv, parseWhichArgv, parseAliasArgv } = BuiltinsLib;

test('fileItemUtf8ForDisplay: prefers non-empty content string', () => {
  const buf = new TextEncoder().encode('bytes');
  const r = fileItemUtf8ForDisplay({
    type: 'file',
    content: 'hello',
    contentBytes: buf.buffer
  });
  assert.equal(r.text, 'hello');
  assert.equal(r.isBinary, false);
});

test('fileItemUtf8ForDisplay: decodes contentBytes when content empty', () => {
  const enc = new TextEncoder();
  const u8 = enc.encode('#!/bin/bash\necho hi\n');
  const r = fileItemUtf8ForDisplay({
    type: 'file',
    content: '',
    contentBytes: u8.buffer.slice(u8.byteOffset, u8.byteOffset + u8.byteLength)
  });
  assert.equal(r.text, '#!/bin/bash\necho hi\n');
  assert.equal(r.isBinary, false);
});

test('fileItemUtf8ForDisplay: Uint8Array view', () => {
  const u8 = new Uint8Array([0x61, 0x62, 0x63]);
  const r = fileItemUtf8ForDisplay({ type: 'file', contentBytes: u8 });
  assert.equal(r.text, 'abc');
  assert.equal(r.isBinary, false);
});

test('fileItemUtf8ForDisplay: NUL marks binary', () => {
  const u8 = new Uint8Array([0x48, 0x69, 0, 0x50]);
  const r = fileItemUtf8ForDisplay({ type: 'file', contentBytes: u8 });
  assert.equal(r.isBinary, true);
  assert.equal(r.text, '');
});

test('filterDirectoryEntriesForTabCompletion: hides dotfiles unless prefix starts with .', () => {
  const entries = [
    { name: 'normal.txt', type: 'file' },
    { name: '.hidden', type: 'file' },
    { name: '.profile', type: 'file' }
  ];
  assert.deepEqual(
    filterDirectoryEntriesForTabCompletion(entries, '').map((e) => e.name),
    ['normal.txt']
  );
  assert.deepEqual(
    filterDirectoryEntriesForTabCompletion(entries, 'n').map((e) => e.name),
    ['normal.txt']
  );
  assert.deepEqual(
    filterDirectoryEntriesForTabCompletion(entries, '.').map((e) => e.name),
    ['.hidden', '.profile']
  );
  assert.deepEqual(
    filterDirectoryEntriesForTabCompletion(entries, '.p').map((e) => e.name),
    ['.profile']
  );
});

test('parseLsDisplayFlags: -la and --all/--long', () => {
  assert.deepEqual(parseLsDisplayFlags(['-la', '/']), { showDetails: true, showAll: true });
  assert.deepEqual(parseLsDisplayFlags(['-l']), { showDetails: true, showAll: false });
  assert.deepEqual(parseLsDisplayFlags(['-a']), { showDetails: false, showAll: true });
  assert.deepEqual(parseLsDisplayFlags(['--long', '--all']), { showDetails: true, showAll: true });
});

test('sortDirectoryEntriesByName: locale order', () => {
  const a = [{ name: 'b' }, { name: 'a' }, { name: 'c' }];
  assert.deepEqual(
    sortDirectoryEntriesByName(a).map((e) => e.name),
    ['a', 'b', 'c']
  );
});

test('formatDeclareXLine / escapeBashDoubleQuotedContent: bash-style declare -x', () => {
  assert.equal(formatDeclareXLine('PATH', '/bin'), 'declare -x PATH="/bin"');
  assert.equal(formatDeclareXLine('X', 'say "hi"\n'), 'declare -x X="say \\"hi\\"\\n"');
  assert.equal(escapeBashDoubleQuotedContent('a\nb'), 'a\\nb');
});

test('parseMkdirArgv: -p and operands', () => {
  assert.deepEqual(parseMkdirArgv(['-p', 'a/b']), { ok: true, parents: true, operands: ['a/b'] });
  assert.deepEqual(parseMkdirArgv(['--parents', '--', '-p']), {
    ok: true,
    parents: true,
    operands: ['-p']
  });
  assert.deepEqual(parseMkdirArgv(['-pp', 'x']), { ok: true, parents: true, operands: ['x'] });
  const bad = parseMkdirArgv(['--mode=755', 'x']);
  assert.equal(bad.ok, false);
});

test('parseChmodArgv: mode + files, help, errors', () => {
  const ok = parseChmodArgv(['755', 'a.txt', 'b']);
  assert.equal(ok.ok, true);
  assert.equal(ok.mode, '755');
  assert.deepEqual(ok.files, ['a.txt', 'b']);

  assert.equal(parseChmodArgv(['--help']).ok, true);
  assert.equal(parseChmodArgv(['--help']).help, true);

  assert.equal(parseChmodArgv([]).ok, false);
  assert.equal(parseChmodArgv(['755']).ok, false);
  assert.match(parseChmodArgv(['755']).stderr, /missing operand/);

  const u = parseChmodArgv(['--foo']);
  assert.equal(u.ok, false);
});

test('parseStatArgv: -L, --, help, operands, errors', () => {
  assert.deepEqual(parseStatArgv(['-L', 'a']), { ok: true, dereference: true, operands: ['a'] });
  assert.deepEqual(parseStatArgv(['--dereference', 'b']), {
    ok: true,
    dereference: true,
    operands: ['b']
  });
  assert.deepEqual(parseStatArgv(['--', '-x']), { ok: true, dereference: false, operands: ['-x'] });
  assert.equal(parseStatArgv(['--help']).ok, true);
  assert.equal(parseStatArgv(['--help']).help, true);
  assert.equal(parseStatArgv(['-h']).help, true);

  const miss = parseStatArgv(['-L']);
  assert.equal(miss.ok, false);
  assert.match(miss.stderr, /missing operand/);

  const bad = parseStatArgv(['--format=%s']);
  assert.equal(bad.ok, false);
  assert.match(bad.stderr, /unrecognized option/);

  const shortBad = parseStatArgv(['-z']);
  assert.equal(shortBad.ok, false);
  assert.match(shortBad.stderr, /invalid option/);
});

test('parseTypeArgv: -a, --, help, names, usage, errors', () => {
  assert.deepEqual(parseTypeArgv(['ls']), { ok: true, showAll: false, names: ['ls'] });
  assert.deepEqual(parseTypeArgv(['-a', 'ls']), { ok: true, showAll: true, names: ['ls'] });
  assert.deepEqual(parseTypeArgv(['--', '-h']), { ok: true, showAll: false, names: ['-h'] });
  assert.equal(parseTypeArgv(['--help']).ok, true);
  assert.equal(parseTypeArgv(['--help']).help, true);
  assert.equal(parseTypeArgv(['-h']).help, true);

  const empty = parseTypeArgv([]);
  assert.equal(empty.ok, false);
  assert.match(empty.stderr, /usage/);

  const bad = parseTypeArgv(['-t', 'x']);
  assert.equal(bad.ok, false);
  assert.match(bad.stderr, /invalid option/);
});

test('parseWhichArgv: -a, --all, --, help, names, missing operand, errors', () => {
  assert.deepEqual(parseWhichArgv(['ls']), { ok: true, showAll: false, names: ['ls'] });
  assert.deepEqual(parseWhichArgv(['-a', 'ls']), { ok: true, showAll: true, names: ['ls'] });
  assert.deepEqual(parseWhichArgv(['--all', 'x']), { ok: true, showAll: true, names: ['x'] });
  assert.deepEqual(parseWhichArgv(['--', '-h']), { ok: true, showAll: false, names: ['-h'] });
  assert.equal(parseWhichArgv(['--help']).help, true);
  assert.equal(parseWhichArgv(['-h']).help, true);

  const miss = parseWhichArgv([]);
  assert.equal(miss.ok, false);
  assert.match(miss.stderr, /missing operand/);

  const bad = parseWhichArgv(['-z', 'x']);
  assert.equal(bad.ok, false);
  assert.match(bad.stderr, /invalid option/);
});

test('parseAliasArgv: -p, --, help, operands, option errors', () => {
  assert.deepEqual(parseAliasArgv([]), { ok: true, printReusable: false, operands: [] });
  assert.deepEqual(parseAliasArgv(['-p']), { ok: true, printReusable: true, operands: [] });
  assert.deepEqual(parseAliasArgv(['-p', 'a=b']), {
    ok: true,
    printReusable: true,
    operands: ['a=b']
  });
  assert.deepEqual(parseAliasArgv(['--', '-p=x']), {
    ok: true,
    printReusable: false,
    operands: ['-p=x']
  });
  assert.equal(parseAliasArgv(['--help']).help, true);
  assert.equal(parseAliasArgv(['-h']).help, true);

  const bad = parseAliasArgv(['-z']);
  assert.equal(bad.ok, false);
  assert.match(bad.stderr, /invalid option/);
  assert.equal(bad.exitCode, 2);
});

test('escapeTypeAliasBody: backslashes and backticks', () => {
  assert.equal(escapeTypeAliasBody('a'), 'a');
  assert.equal(escapeTypeAliasBody('a`b'), 'a\\`b');
  assert.equal(escapeTypeAliasBody('a\\b'), 'a\\\\b');
});

