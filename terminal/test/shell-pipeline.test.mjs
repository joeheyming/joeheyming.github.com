import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ShellCore } from '../lib/shell-core.js';
const {
  splitShellList,
  normalizeCommandResult,
  normalizeHandlerResult,
  coerceShellString,
  expandVariablesInString,
  mergeRedirectDupStderrTokens,
  normalizeExitByte
} = ShellCore;

// ---------------------------------------------------------------------------
// coerceShellString – lock down every branch before the split moves it
// ---------------------------------------------------------------------------

test('coerceShellString: null → empty', () => {
  assert.equal(coerceShellString(null), '');
});

test('coerceShellString: undefined → empty', () => {
  assert.equal(coerceShellString(undefined), '');
});

test('coerceShellString: string passthrough', () => {
  assert.equal(coerceShellString('hello'), 'hello');
});

test('coerceShellString: number 0 → "0"', () => {
  assert.equal(coerceShellString(0), '0');
});

test('coerceShellString: boolean true → "true"', () => {
  assert.equal(coerceShellString(true), 'true');
});

test('coerceShellString: boolean false → "false"', () => {
  assert.equal(coerceShellString(false), 'false');
});

test('coerceShellString: array joins with newlines', () => {
  assert.equal(coerceShellString(['a', 'b', 'c']), 'a\nb\nc');
});

test('coerceShellString: array with null element → empty string element', () => {
  assert.equal(coerceShellString(['a', null, 'c']), 'a\n\nc');
});

test('coerceShellString: object → String(obj)', () => {
  assert.equal(coerceShellString({}), '[object Object]');
});

test('coerceShellString: bigint → string', () => {
  assert.equal(coerceShellString(42n), '42');
});

// ---------------------------------------------------------------------------
// normalizeCommandResult – every inference path
// ---------------------------------------------------------------------------

test('normalizeCommandResult: all empty → exit 0', () => {
  const r = normalizeCommandResult('', '', undefined);
  assert.equal(r.stdout, '');
  assert.equal(r.stderr, '');
  assert.equal(r.exitCode, 0);
});

test('normalizeCommandResult: stderr present, exitCode omitted → infers 1', () => {
  const r = normalizeCommandResult('', 'error msg', undefined);
  assert.equal(r.exitCode, 1);
});

test('normalizeCommandResult: stderr present, exitCode null → infers 1', () => {
  const r = normalizeCommandResult('', 'error msg', null);
  assert.equal(r.exitCode, 1);
});

test('normalizeCommandResult: stderr present, explicit exitCode 0 → keeps 0', () => {
  const r = normalizeCommandResult('out', 'warn', 0);
  assert.equal(r.exitCode, 0);
});

test('normalizeCommandResult: stderr present, explicit exitCode 2 → keeps 2', () => {
  const r = normalizeCommandResult('', 'usage error', 2);
  assert.equal(r.exitCode, 2);
});

test('normalizeCommandResult: exit 127 command not found', () => {
  const r = normalizeCommandResult('', 'not found', 127);
  assert.equal(r.exitCode, 127);
});

test('normalizeCommandResult: exit 126 permission denied', () => {
  const r = normalizeCommandResult('', 'permission denied', 126);
  assert.equal(r.exitCode, 126);
});

test('normalizeCommandResult: coerces non-string stdout', () => {
  const r = normalizeCommandResult(42, '', 0);
  assert.equal(r.stdout, '42');
});

test('normalizeCommandResult: coerces null stdout to empty', () => {
  const r = normalizeCommandResult(null, '', 0);
  assert.equal(r.stdout, '');
});

// ---------------------------------------------------------------------------
// normalizeHandlerResult – command return value coercion
// ---------------------------------------------------------------------------

test('normalizeHandlerResult: null → empty stdout, no exitCode', () => {
  const r = normalizeHandlerResult(null);
  assert.equal(r.stdout, '');
  assert.equal(r.stderr, '');
  assert.equal(r.exitCode, undefined);
});

test('normalizeHandlerResult: undefined → empty stdout, no exitCode', () => {
  const r = normalizeHandlerResult(undefined);
  assert.equal(r.stdout, '');
  assert.equal(r.stderr, '');
  assert.equal(r.exitCode, undefined);
});

test('normalizeHandlerResult: string → stdout, no stderr', () => {
  const r = normalizeHandlerResult('hello world');
  assert.equal(r.stdout, 'hello world');
  assert.equal(r.stderr, '');
  assert.equal(r.exitCode, undefined);
});

test('normalizeHandlerResult: number → string stdout', () => {
  const r = normalizeHandlerResult(42);
  assert.equal(r.stdout, '42');
  assert.equal(r.exitCode, undefined);
});

test('normalizeHandlerResult: array → string stdout', () => {
  const r = normalizeHandlerResult([1, 2]);
  assert.equal(r.stdout, '1,2');
  assert.equal(r.exitCode, undefined);
});

test('normalizeHandlerResult: object with stdout/stderr/exitCode', () => {
  const r = normalizeHandlerResult({ stdout: 'ok', stderr: 'warn', exitCode: 2 });
  assert.equal(r.stdout, 'ok');
  assert.equal(r.stderr, 'warn');
  assert.equal(r.exitCode, 2);
});

test('normalizeHandlerResult: object without stdout/stderr/exitCode → String(obj)', () => {
  const r = normalizeHandlerResult({ foo: 'bar' });
  assert.equal(r.stdout, '[object Object]');
  assert.equal(r.stderr, '');
  assert.equal(r.exitCode, undefined);
});

test('normalizeHandlerResult: object with only exitCode', () => {
  const r = normalizeHandlerResult({ exitCode: 1 });
  assert.equal(r.stdout, '');
  assert.equal(r.stderr, '');
  assert.equal(r.exitCode, 1);
});

test('normalizeHandlerResult: object with null stdout → empty', () => {
  const r = normalizeHandlerResult({ stdout: null, stderr: 'err', exitCode: 1 });
  assert.equal(r.stdout, '');
  assert.equal(r.stderr, 'err');
});

// ---------------------------------------------------------------------------
// splitShellList – edge cases for the list/pipeline splitter
// ---------------------------------------------------------------------------

test('splitShellList: null → single empty pipeline', () => {
  const r = splitShellList(null);
  assert.equal(r.ok, true);
  assert.deepEqual(r.pipelines, ['']);
  assert.deepEqual(r.ops, []);
});

test('splitShellList: empty string → single empty pipeline', () => {
  const r = splitShellList('');
  assert.equal(r.ok, true);
  assert.deepEqual(r.pipelines, ['']);
  assert.deepEqual(r.ops, []);
});

test('splitShellList: single command', () => {
  const r = splitShellList('ls -la');
  assert.equal(r.ok, true);
  assert.deepEqual(r.pipelines, ['ls -la']);
  assert.deepEqual(r.ops, []);
});

test('splitShellList: && splits into two pipelines', () => {
  const r = splitShellList('cmd1 && cmd2');
  assert.equal(r.ok, true);
  assert.deepEqual(r.pipelines, ['cmd1', 'cmd2']);
  assert.deepEqual(r.ops, ['&&']);
});

test('splitShellList: || splits into two pipelines', () => {
  const r = splitShellList('cmd1 || cmd2');
  assert.equal(r.ok, true);
  assert.deepEqual(r.pipelines, ['cmd1', 'cmd2']);
  assert.deepEqual(r.ops, ['||']);
});

test('splitShellList: ; splits into two pipelines', () => {
  const r = splitShellList('cmd1; cmd2');
  assert.equal(r.ok, true);
  assert.deepEqual(r.pipelines, ['cmd1', 'cmd2']);
  assert.deepEqual(r.ops, [';']);
});

test('splitShellList: trailing semicolon → empty trailing pipeline allowed', () => {
  const r = splitShellList('cmd1;');
  assert.equal(r.ok, true);
  assert.deepEqual(r.pipelines, ['cmd1', '']);
  assert.deepEqual(r.ops, [';']);
});

test('splitShellList: pipe inside segment stays together', () => {
  const r = splitShellList('echo hi | grep hi && echo done');
  assert.equal(r.ok, true);
  assert.deepEqual(r.pipelines, ['echo hi | grep hi', 'echo done']);
  assert.deepEqual(r.ops, ['&&']);
});

test('splitShellList: quoted && is literal', () => {
  const r = splitShellList('echo "a && b"');
  assert.equal(r.ok, true);
  assert.deepEqual(r.pipelines, ['echo "a && b"']);
  assert.deepEqual(r.ops, []);
});

test('splitShellList: single-quoted || is literal', () => {
  const r = splitShellList("echo 'a || b'");
  assert.equal(r.ok, true);
  assert.deepEqual(r.pipelines, ["echo 'a || b'"]);
  assert.deepEqual(r.ops, []);
});

test('splitShellList: error on empty before &&', () => {
  const r = splitShellList('&& cmd');
  assert.equal(r.ok, false);
  assert.ok(r.error.includes('syntax error'));
});

test('splitShellList: error on empty after &&', () => {
  const r = splitShellList('cmd &&');
  assert.equal(r.ok, false);
  assert.ok(r.error.includes('syntax error'));
});

test('splitShellList: error on empty after ||', () => {
  const r = splitShellList('cmd ||');
  assert.equal(r.ok, false);
  assert.ok(r.error.includes('syntax error'));
});

test('splitShellList: mixed operators', () => {
  const r = splitShellList('a && b || c; d');
  assert.equal(r.ok, true);
  assert.deepEqual(r.pipelines, ['a', 'b', 'c', 'd']);
  assert.deepEqual(r.ops, ['&&', '||', ';']);
});

// ---------------------------------------------------------------------------
// mergeRedirectDupStderrTokens
// ---------------------------------------------------------------------------

test('mergeRedirectDupStderrTokens: merges 2> &1 → 2>&1', () => {
  assert.deepEqual(mergeRedirectDupStderrTokens(['2>', '&1']), ['2>&1']);
});

test('mergeRedirectDupStderrTokens: preserves other tokens', () => {
  assert.deepEqual(mergeRedirectDupStderrTokens(['echo', 'hello', '>', 'out.txt']), [
    'echo',
    'hello',
    '>',
    'out.txt'
  ]);
});

test('mergeRedirectDupStderrTokens: 2> without &1 stays separate', () => {
  assert.deepEqual(mergeRedirectDupStderrTokens(['2>', 'err.txt']), ['2>', 'err.txt']);
});

test('mergeRedirectDupStderrTokens: multiple 2>&1 in one line', () => {
  assert.deepEqual(mergeRedirectDupStderrTokens(['cmd', '2>', '&1', '|', 'cmd2', '2>', '&1']), [
    'cmd',
    '2>&1',
    '|',
    'cmd2',
    '2>&1'
  ]);
});

// ---------------------------------------------------------------------------
// expandVariablesInString
// ---------------------------------------------------------------------------

test('expandVariablesInString: null → empty', () => {
  assert.equal(expandVariablesInString(null, {}, 0), '');
});

test('expandVariablesInString: $? with exit code 0', () => {
  assert.equal(expandVariablesInString('exit=$?', {}, 0), 'exit=0');
});

test('expandVariablesInString: $? with exit code 127', () => {
  assert.equal(expandVariablesInString('code=$?', {}, 127), 'code=127');
});

test('expandVariablesInString: $VAR from env', () => {
  assert.equal(expandVariablesInString('hello $USER', { USER: 'joe' }, 0), 'hello joe');
});

test('expandVariablesInString: ${VAR} braced form', () => {
  assert.equal(expandVariablesInString('${HOME}/bin', { HOME: '/home/joe' }, 0), '/home/joe/bin');
});

test('expandVariablesInString: undefined var → empty string', () => {
  assert.equal(expandVariablesInString('$NONEXISTENT', {}, 0), '');
});

test('expandVariablesInString: multiple vars in one string', () => {
  assert.equal(expandVariablesInString('$A and $B', { A: 'x', B: 'y' }, 0), 'x and y');
});

test('expandVariablesInString: $? default when lastExitCode is null', () => {
  assert.equal(expandVariablesInString('$?', {}, null), '0');
});

test('expandVariablesInString: no env object → no crash', () => {
  assert.equal(expandVariablesInString('$FOO', null, 0), '');
});

// ---------------------------------------------------------------------------
// normalizeExitByte – bash-style 8-bit wrap
// ---------------------------------------------------------------------------

test('normalizeExitByte: 0 stays 0', () => {
  assert.equal(normalizeExitByte(0), 0);
});

test('normalizeExitByte: 1 stays 1', () => {
  assert.equal(normalizeExitByte(1), 1);
});

test('normalizeExitByte: 256 wraps to 0', () => {
  assert.equal(normalizeExitByte(256), 0);
});

test('normalizeExitByte: -1 wraps to 255', () => {
  assert.equal(normalizeExitByte(-1), 255);
});

test('normalizeExitByte: null → 0', () => {
  assert.equal(normalizeExitByte(null), 0);
});

test('normalizeExitByte: 130 (SIGINT) stays 130', () => {
  assert.equal(normalizeExitByte(130), 130);
});

test('normalizeExitByte: 137 (128+SIGKILL) stays 137', () => {
  assert.equal(normalizeExitByte(137), 137);
});
