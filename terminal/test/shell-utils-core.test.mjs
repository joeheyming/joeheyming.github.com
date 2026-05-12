import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ShellCore } from '../lib/shell-core.js';
const {
  resolveVirtualPath,
  coerceShellString,
  normalizeRedirectFilename,
  isEmptyRedirectTarget,
  splitShellList,
  mergeRedirectDupStderrTokens,
  normalizeCommandResult,
  normalizeHandlerResult,
  normalizeExitByte,
  expandVariablesInString,
  combinedFetchSignal,
  parseExitStatus,
  parseHelpArgs,
  parseKillArgv
} = ShellCore;

test('combinedFetchSignal: user abort aborts merged signal', () => {
  const ac = new AbortController();
  const sig = combinedFetchSignal(600_000, ac.signal);
  assert.equal(sig.aborted, false);
  ac.abort();
  assert.equal(sig.aborted, true);
});

test('normalizeRedirectFilename: strips one pair of quotes', () => {
  assert.equal(normalizeRedirectFilename('"out.txt"'), 'out.txt');
  assert.equal(normalizeRedirectFilename("'x'"), 'x');
  assert.equal(normalizeRedirectFilename('plain'), 'plain');
});

test('isEmptyRedirectTarget: empty after quotes', () => {
  assert.equal(isEmptyRedirectTarget(''), true);
  assert.equal(isEmptyRedirectTarget('""'), true);
  assert.equal(isEmptyRedirectTarget("''"), true);
  assert.equal(isEmptyRedirectTarget('a'), false);
});

test('splitShellList: && || ; at top level', () => {
  const a = splitShellList('echo a && echo b');
  assert.equal(a.ok, true);
  assert.deepEqual(a.pipelines, ['echo a', 'echo b']);
  assert.deepEqual(a.ops, ['&&']);

  const b = splitShellList('false || echo x');
  assert.equal(b.ok, true);
  assert.deepEqual(b.pipelines, ['false', 'echo x']);
  assert.deepEqual(b.ops, ['||']);

  const c = splitShellList('echo one; echo two');
  assert.equal(c.ok, true);
  assert.deepEqual(c.pipelines, ['echo one', 'echo two']);
  assert.deepEqual(c.ops, [';']);
});

test('splitShellList: operators inside quotes are literal', () => {
  const q = splitShellList('echo "a&&b"; echo ok');
  assert.equal(q.ok, true);
  assert.deepEqual(q.pipelines, ['echo "a&&b"', 'echo ok']);
  assert.deepEqual(q.ops, [';']);
});

test('splitShellList: pipes are not list separators', () => {
  const p = splitShellList('echo a | cat');
  assert.equal(p.ok, true);
  assert.deepEqual(p.pipelines, ['echo a | cat']);
  assert.deepEqual(p.ops, []);
});

test('splitShellList: syntax errors for empty &&/|| operands', () => {
  assert.equal(splitShellList('&& echo').ok, false);
  assert.equal(splitShellList('echo &&').ok, false);
  assert.equal(splitShellList('a && && b').ok, false);
});

test('mergeRedirectDupStderrTokens: 2> + &1 becomes 2>&1', () => {
  assert.deepEqual(mergeRedirectDupStderrTokens(['echo', '2>', '&1']), ['echo', '2>&1']);
  assert.deepEqual(mergeRedirectDupStderrTokens(['2>', 'f']), ['2>', 'f']);
});

test('normalizeCommandResult: explicit zero with stderr empty', () => {
  const r = normalizeCommandResult('ok', '', 0);
  assert.equal(r.exitCode, 0);
  assert.equal(r.stdout, 'ok');
});

test('normalizeCommandResult: infers 1 when stderr set and code omitted', () => {
  const r = normalizeCommandResult('', 'err');
  assert.equal(r.exitCode, 1);
});

test('normalizeCommandResult: explicit 127 overrides stderr inference', () => {
  const r = normalizeCommandResult('', 'jsh: x: command not found', 127);
  assert.equal(r.exitCode, 127);
});

test('normalizeCommandResult: 126 permission denied', () => {
  const r = normalizeCommandResult('', 'jsh: /bin/foo: Permission denied', 126);
  assert.equal(r.exitCode, 126);
});

test('expandVariablesInString: $? and $HOME / ${HOME}', () => {
  const env = { HOME: '/home/u', USER: 'u' };
  assert.equal(
    expandVariablesInString('code=$? path=$HOME u=${USER}', env, 127),
    'code=127 path=/home/u u=u'
  );
});

test('expandVariablesInString: missing vars become empty', () => {
  assert.equal(expandVariablesInString('$NONE', {}, 0), '');
});

test('resolveVirtualPath: . .. components and trailing slash', () => {
  assert.equal(resolveVirtualPath('/a/b/../c//', '/'), '/a/c');
  assert.equal(resolveVirtualPath('foo/./bar', '/tmp'), '/tmp/foo/bar');
  assert.equal(resolveVirtualPath('..', '/a/b'), '/a');
  assert.equal(resolveVirtualPath('..', '/'), '/');
});

test('resolveVirtualPath: empty path is cwd', () => {
  assert.equal(resolveVirtualPath('', '/home/u'), '/home/u');
});

test('resolveVirtualPath: absolute ignores cwd for location', () => {
  assert.equal(resolveVirtualPath('/etc/hosts', '/nope'), '/etc/hosts');
});

test('normalizeHandlerResult: string is stdout only', () => {
  const n = normalizeHandlerResult('hello');
  assert.equal(n.stdout, 'hello');
  assert.equal(n.stderr, '');
  assert.equal(n.exitCode, undefined);
});

test('normalizeHandlerResult: structured stderr + exitCode', () => {
  const n = normalizeHandlerResult({ stderr: 'cat: x: No such file', exitCode: 1 });
  assert.equal(n.stdout, '');
  assert.equal(n.stderr, 'cat: x: No such file');
  assert.equal(n.exitCode, 1);
  const r = normalizeCommandResult(n.stdout, n.stderr, n.exitCode);
  assert.equal(r.exitCode, 1);
});

test('normalizeCommandResult: coerces non-string stdout (e.g. mistaken object)', () => {
  const r = normalizeCommandResult({ nested: 1 }, '', 0);
  assert.equal(typeof r.stdout, 'string');
  assert.ok(r.stdout.includes('Object'));
});

test('coerceShellString: preserves numeric zero', () => {
  assert.equal(coerceShellString(0), '0');
});

test('expandVariablesInString: lowercase env names', () => {
  assert.equal(expandVariablesInString('$path ${path}', { path: '/tmp' }, 0), '/tmp /tmp');
});

test('normalizeExitByte: wraps like bash', () => {
  assert.equal(normalizeExitByte(0), 0);
  assert.equal(normalizeExitByte(256), 0);
  assert.equal(normalizeExitByte(-1), 255);
  assert.equal(normalizeExitByte(999), 231);
});

test('parseExitStatus: no args uses last exit code byte', () => {
  const r = parseExitStatus([], 127);
  assert.equal(r.ok, true);
  assert.equal(r.status, 127);
});

test('parseExitStatus: decimal operand wraps', () => {
  const r = parseExitStatus(['256'], 0);
  assert.equal(r.ok, true);
  assert.equal(r.status, 0);
});

test('parseExitStatus: negative operand', () => {
  const r = parseExitStatus(['-1'], 0);
  assert.equal(r.ok, true);
  assert.equal(r.status, 255);
});

test('parseExitStatus: too many arguments', () => {
  const r = parseExitStatus(['1', '2'], 0);
  assert.equal(r.ok, false);
  assert.equal(r.exitCode, 1);
  assert.ok(String(r.stderr).includes('too many'));
});

test('parseExitStatus: non-numeric operand', () => {
  const r = parseExitStatus(['foo'], 0);
  assert.equal(r.ok, false);
  assert.equal(r.exitCode, 2);
  assert.ok(String(r.stderr).includes('numeric argument required'));
});

test('parseExitStatus: -- then operand', () => {
  const r = parseExitStatus(['--', '2'], 0);
  assert.equal(r.ok, true);
  assert.equal(r.status, 2);
});

test('parseExitStatus: -- alone uses last status', () => {
  const r = parseExitStatus(['--'], 5);
  assert.equal(r.ok, true);
  assert.equal(r.status, 5);
});

test('parseExitStatus: --help alone', () => {
  const r = parseExitStatus(['--help'], 9);
  assert.equal(r.ok, true);
  assert.equal(r.help, true);
});

test('parseExitStatus: --help with extra args', () => {
  const r = parseExitStatus(['--help', '0'], 0);
  assert.equal(r.ok, false);
  assert.equal(r.exitCode, 1);
});

test('parseHelpArgs: empty → catalog', () => {
  const r = parseHelpArgs([]);
  assert.equal(r.ok, true);
  assert.equal(r.sawHelpFlag, false);
  assert.deepEqual(r.rest, []);
});

test('parseHelpArgs: -h → usage', () => {
  const r = parseHelpArgs(['-h']);
  assert.equal(r.ok, true);
  assert.equal(r.sawHelpFlag, true);
  assert.deepEqual(r.rest, []);
});

test('parseKillArgv: empty → usage', () => {
  const r = parseKillArgv([]);
  assert.equal(r.kind, 'usage');
  assert.equal(r.exitCode, 1);
  assert.match(r.stderr, /kill: usage:/);
});

test('parseKillArgv: -l → list', () => {
  assert.equal(parseKillArgv(['-l']).kind, 'list');
});

test('parseKillArgv: numeric PIDs', () => {
  const r = parseKillArgv(['123', '456']);
  assert.equal(r.kind, 'run');
  assert.deepEqual(r.pids, [123, 456]);
});

test('parseKillArgv: -9 PID', () => {
  const r = parseKillArgv(['-9', '42']);
  assert.equal(r.kind, 'run');
  assert.equal(r.signal, 'SIGKILL');
  assert.deepEqual(r.pids, [42]);
});

test('parseKillArgv: invalid signal', () => {
  const r = parseKillArgv(['-z', '1']);
  assert.equal(r.kind, 'error');
  assert.equal(r.exitCode, 1);
});
